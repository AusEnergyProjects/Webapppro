import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function registrationQueue(sample) {
  const exports = {};
  const source = readFileSync(new URL('../src/lib/device-registration.ts', import.meta.url), 'utf8');
  new Function('require', 'exports', compile(source))(id => {
    assert.equal(id, '@/lib/device'); return { deviceRegistration: sample };
  }, exports);
  return exports;
}

test('a slow cold-start registration cannot overwrite the newer PushKit token', async () => {
  const oldRequest = deferred(), writes = [];
  let voipPushToken = '', samples = 0;
  const queue = registrationQueue(async () => { samples++; return { voipPushToken, nativeCallCapable: true }; });
  const first = queue.persistDeviceRegistration(async registration => {
    await oldRequest.promise; writes.push(registration.voipPushToken);
  });
  await flush(); assert.equal(samples, 1);
  voipPushToken = 'synthetic-current-token';
  const refresh = queue.persistDeviceRegistration(async registration => { writes.push(registration.voipPushToken); });
  await flush(); assert.equal(samples, 1, 'the later token is not sampled or posted before the first write settles');
  oldRequest.resolve(); await Promise.all([first, refresh]);
  assert.deepEqual(writes, ['', 'synthetic-current-token']);
});

test('background sync uses the same queue as a foreground token refresh', async () => {
  const firstRequest = deferred(), writes = [];
  let voipPushToken = '';
  const queue = registrationQueue(async () => ({ voipPushToken }));
  const source = ts.createSourceFile('sync.ts', readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['devicePath', 'registerDevice'].includes(node.name?.text));
  assert.equal(functions.length, 2);
  const registerSync = new Function('persistDeviceRegistration', 'apiRequest', compile(`${functions.map(node => node.getText(source)).join('\n')}\nreturn registerDevice;`))(
    queue.persistDeviceRegistration, async (path, init, _identity, options) => {
      assert.equal(path, '/api/trade-team/devices');
      assert.equal(options.expectedBusinessKey, 'synthetic-business');
      const body = JSON.parse(init.body); await firstRequest.promise; writes.push(body.voipPushToken);
    });
  const sync = registerSync('trade_team', 'synthetic-business'); await flush();
  voipPushToken = 'synthetic-rotated-token';
  const refresh = queue.persistDeviceRegistration(async registration => { writes.push(registration.voipPushToken); });
  await flush(); assert.deepEqual(writes, []);
  firstRequest.resolve(); await Promise.all([sync, refresh]);
  assert.deepEqual(writes, ['', 'synthetic-rotated-token']);
});

test('token invalidation and explicit disable replace earlier delivery tokens', async () => {
  let current = { voipPushToken: 'synthetic-token', nativeCallCapable: true };
  const writes = [], queue = registrationQueue(async () => ({ ...current }));
  const write = registration => { writes.push(registration); return Promise.resolve(); };
  await queue.persistDeviceRegistration(write);
  current = { voipPushToken: '', nativeCallCapable: true };
  await queue.persistDeviceRegistration(write);
  current = { voipPushToken: '', nativeCallCapable: false };
  await queue.persistDeviceRegistration(write);
  assert.deepEqual(writes, [
    { voipPushToken: 'synthetic-token', nativeCallCapable: true },
    { voipPushToken: '', nativeCallCapable: true },
    { voipPushToken: '', nativeCallCapable: false },
  ]);
});

test('notification settings share the queue and disabled tokens follow a pending sync write', async () => {
  const oldRequest = deferred(), writes = [];
  let current = { voipPushToken: 'synthetic-token', nativeCallCapable: true };
  const queue = registrationQueue(async () => ({ ...current }));
  const sync = queue.persistDeviceRegistration(async registration => { await oldRequest.promise; writes.push(registration); });
  await flush();
  const source = ts.createSourceFile('settings.tsx', readFileSync(new URL('../src/components/device-notification-settings.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let change;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'changeEnabled') change = node.getText(source); ts.forEachChild(node, visit); }
  visit(source); assert.ok(change);
  const dependencies = {
    busy: false, setBusy() {}, setMessage(message) { assert.equal(message, ''); },
    setNotificationsMuted: async muted => { assert.equal(muted, true); current = { voipPushToken: '', nativeCallCapable: false }; },
    waitForNotificationRegistrations: queue.waitForDeviceRegistrations,
    sync: { online: true }, resolveFieldAccessModes: async () => ['trade_team'],
    persistDeviceRegistration: queue.persistDeviceRegistration,
    apiRequest: async (path, init) => { assert.equal(path, '/api/trade-team/devices'); writes.push(JSON.parse(init.body)); },
    refresh: async () => undefined,
  };
  const changeEnabled = new Function(...Object.keys(dependencies), compile(`${change}\nreturn changeEnabled;`))(...Object.values(dependencies));
  const mute = changeEnabled(false); await flush(); assert.deepEqual(writes, []);
  oldRequest.resolve(); await Promise.all([sync, mute]);
  assert.deepEqual(writes, [
    { voipPushToken: 'synthetic-token', nativeCallCapable: true },
    { voipPushToken: '', nativeCallCapable: false },
  ]);
});

test('an obsolete queued identity neither samples nor persists device credentials', async () => {
  const firstRequest = deferred(); let samples = 0, current = true;
  const queue = registrationQueue(async () => { samples++; return {}; });
  const first = queue.persistDeviceRegistration(async () => firstRequest.promise);
  await flush();
  const obsolete = queue.persistDeviceRegistration(async () => assert.fail('Obsolete registration wrote credentials'), undefined, () => current);
  current = false; firstRequest.resolve(); await Promise.all([first, obsolete]);
  assert.equal(samples, 1);
});

test('identity loss while tokens are being sampled prevents their device write', async () => {
  const sampled = deferred(); let current = true;
  const queue = registrationQueue(async () => sampled.promise);
  const operation = queue.persistDeviceRegistration(async () => assert.fail('Obsolete registration wrote credentials'), undefined, () => current);
  await flush(); current = false; sampled.resolve({}); await operation;
});

test('a failed registration reaches its caller and does not block a later token refresh', async () => {
  const queue = registrationQueue(async () => ({})); let refreshed = false;
  const failed = queue.persistDeviceRegistration(async () => { throw new Error('Synthetic offline failure'); });
  const rejection = assert.rejects(failed, /Synthetic offline failure/);
  const next = queue.persistDeviceRegistration(async () => { refreshed = true; });
  await Promise.all([rejection, next, queue.waitForDeviceRegistrations()]);
  assert.equal(refreshed, true);
});

test('the registration barrier waits for every writer already queued', async () => {
  const firstRequest = deferred(), secondRequest = deferred(); let drained = false;
  const queue = registrationQueue(async () => ({}));
  const first = queue.persistDeviceRegistration(async () => firstRequest.promise);
  const second = queue.persistDeviceRegistration(async () => secondRequest.promise);
  const barrier = queue.waitForDeviceRegistrations().then(() => { drained = true; });
  firstRequest.resolve(); await first; await flush(); assert.equal(drained, false);
  secondRequest.resolve(); await Promise.all([second, barrier]); assert.equal(drained, true);
});
