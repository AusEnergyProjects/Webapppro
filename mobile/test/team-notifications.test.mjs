import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadModule(file, dependencies) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', javascript)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

function deviceHarness({ permission = { granted: true, canAskAgain: true }, muted = false, tokenError = false, permissionError = false } = {}) {
  const store = new Map([['aea-field-native-push-token-v1', 'old-token']]);
  if (muted) store.set('aea-field-notifications-muted-v1', 'true');
  const calls = { requests: 0, tokens: 0, channels: [] };
  const api = loadModule('../src/lib/device.ts', {
    'expo-application': {}, 'expo-crypto': {}, 'expo-device': { isDevice: true },
    'expo-notifications': {
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
      setNotificationChannelAsync: async (id) => calls.channels.push(id),
      getPermissionsAsync: async () => { if (permissionError) throw new Error('Permission unavailable'); return permission; },
      requestPermissionsAsync: async () => { calls.requests++; return { granted: true, canAskAgain: true }; },
      getDevicePushTokenAsync: async () => { calls.tokens++; if (tokenError) throw new Error('Registration offline'); return { data: 'fresh-token' }; },
    },
    'expo-secure-store': {
      getItemAsync: async (key) => store.get(key),
      setItemAsync: async (key, value) => { store.set(key, value); },
      deleteItemAsync: async (key) => { store.delete(key); },
    },
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/config': { APP_VERSION: '1.0.1', MOBILE_PLATFORM: 'android' },
  });
  return { api, calls, store };
}

test('denied notifications clear the stale token and sync never repeats the permission prompt', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: true } });
  assert.deepEqual(await h.api.getNativePushToken(), { token: '', provider: 'fcm' });
  assert.equal(h.store.has('aea-field-native-push-token-v1'), false);
  assert.equal(h.calls.requests, 0);
  assert.equal(h.calls.tokens, 0);
});

test('the explicit enable action requests permission and registers channels before obtaining a token', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: true } });
  assert.deepEqual(await h.api.getNativePushToken(true), { token: 'fresh-token', provider: 'fcm' });
  assert.equal(h.calls.requests, 1);
  assert.deepEqual(h.calls.channels, ['field-sync', 'team-messages', 'team-calls']);
});

test('blocked system permission is not requested again even from enable', async () => {
  const h = deviceHarness({ permission: { granted: false, canAskAgain: false } });
  assert.equal((await h.api.getNativePushToken(true)).token, '');
  assert.equal(h.calls.requests, 0);
});

test('muted devices cannot silently re-register a cached push token', async () => {
  const h = deviceHarness();
  await h.api.setNotificationsMuted(true);
  assert.equal(h.store.has('aea-field-native-push-token-v1'), false);
  assert.equal((await h.api.getNativePushToken(true)).token, '');
  assert.equal(h.calls.requests, 0);
  assert.equal(h.calls.tokens, 0);
});

test('registration outage reuses cache only after current permission is confirmed', async () => {
  assert.equal((await deviceHarness({ tokenError: true }).api.getNativePushToken()).token, 'old-token');
  assert.equal((await deviceHarness({ permissionError: true }).api.getNativePushToken()).token, '');
});

function teamHarness() {
  const calls = { requests: [], opened: [] };
  const trusted = 'https://tlink.example/direct-trade/messages#handoff=abcdefghijklmnopqrstuvwx';
  const api = loadModule('../src/lib/team-messages.ts', {
    'react-native': { Linking: { openURL: async (value) => calls.opened.push(value) } },
    '@/lib/config': { API_BASE_URL: 'https://tlink.example' },
    '@/lib/api': { apiRequest: async (...args) => { calls.requests.push(args); return { ok: true, url: trusted }; } },
  });
  return { api, calls, trusted };
}

test('team notifications accept only bounded conversation references, never supplied URLs', () => {
  const { api } = teamHarness();
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_call', threadId: 'thread-1', callId: 'call-1', url: 'https://evil.example' }), { threadId: 'thread-1', callId: 'call-1' });
  for (const data of [null, {}, [], { type: 'other', threadId: 'a' }, { type: 'team_message', threadId: '../admin' }, { type: 'team_message', threadId: 'a'.repeat(161) }]) {
    assert.equal(api.teamNotificationTarget(data), null);
  }
});

test('handoff URLs cannot escape the configured HTTPS origin, messages route or opaque fragment', () => {
  const { api, trusted } = teamHarness();
  assert.equal(api.trustedTeamHandoffUrl(trusted), trusted);
  for (const url of [trusted.replace('https:', 'http:'), trusted.replace('tlink.example', 'evil.example'), trusted.replace('tlink.example', 'user@tlink.example'), trusted.replace('/messages', '/dashboard'), trusted.replace('#handoff', '?token=secret#handoff'), trusted.replace('abcdefghijklmnopqrstuvwx', 'bad%20code'), '//evil.example', null]) {
    assert.throws(() => api.trustedTeamHandoffUrl(url));
  }
});

test('opening a conversation uses authenticated POST and opens only the returned handoff', async () => {
  const { api, calls, trusted } = teamHarness();
  await api.openTeamMessages({ threadId: 'thread-1', callId: 'call-1' });
  assert.equal(calls.requests[0][0], '/api/trade-team-handoff');
  assert.deepEqual(JSON.parse(calls.requests[0][1].body), { action: 'issue', threadId: 'thread-1', callId: 'call-1' });
  assert.deepEqual(calls.opened, [trusted]);
  assert.equal(calls.opened.some((url) => url.includes('thread-1') || url.includes('call-1')), false);
});
