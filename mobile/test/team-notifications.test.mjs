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
  const api = loadModule('../src/lib/team-messages.ts', {});
  return { api };
}

test('team notifications accept only bounded conversation references, never supplied URLs', () => {
  const { api } = teamHarness();
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_call', threadId: 'thread-1', callId: 'call-1', url: 'https://evil.example' }), { threadId: 'thread-1', callId: 'call-1' });
  for (const data of [null, {}, [], { type: 'other', threadId: 'a' }, { type: 'team_message', threadId: '../admin' }, { type: 'team_message', threadId: 'a'.repeat(161) }]) {
    assert.equal(api.teamNotificationTarget(data), null);
  }
});

test('native notification targets never create browser handoffs or accept URLs', () => {
  const { api } = teamHarness();
  assert.equal(api.openTeamMessages, undefined);
  assert.equal(api.trustedTeamHandoffUrl, undefined);
  assert.equal(api.teamNotificationTarget({ type: 'team_message', threadId: 'https://evil.example' }), null);
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_message', threadId: 'thread-1', url: 'https://evil.example' }), { threadId: 'thread-1' });
});

test('call invitation navigation cannot carry an invalid call reference', () => {
  const { api } = teamHarness();
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_call', threadId: 'thread-1', callId: '../admin' }), { threadId: 'thread-1' });
  assert.deepEqual(api.teamNotificationTarget({ type: 'team_message', threadId: 'thread-1', callId: 'ignored-call' }), { threadId: 'thread-1' });
});
