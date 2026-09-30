import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/native-system-calls.ts', import.meta.url), 'utf8');
function load(native) {
  const record = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    assert.equal(id, 'expo'); return { requireOptionalNativeModule: () => native };
  }, record, record.exports);
  return record.exports;
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const event = (type, overrides = {}) => ({ id: 'event', type, callId: 'f1346c80-a1af-4ef5-901e-5bf21a068a11', threadId: 'thread-123456', mode: 'audio', expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides });

test('older binaries do not claim native call capability', async () => {
  const bridge = load(null);
  assert.equal(bridge.nativeSystemCallsAvailable, false);
  assert.deepEqual(await bridge.getNativeCallRegistration(), { voipPushToken: '', nativeCallCapable: false });
});
test('token refresh reads registration without reconfiguring PushKit', async () => {
  const configured = [];
  const bridge = load({ configure: async (...value) => configured.push(value), registration: async () => ({ voipPushToken: 'synthetic', nativeCallCapable: true }) });
  await bridge.getNativeCallRegistration(); await bridge.getNativeCallRegistration(false); await bridge.disableNativeCalls(true); await bridge.disableNativeCalls();
  assert.deepEqual(configured, [[true, false], [false, true], [false, false]]);
});
test('cold-start answer is suppressed when a terminal event is already queued', async () => {
  const seen = [];
  const bridge = load({ addListener: () => ({ remove() {} }), drainEvents: async () => [event('incoming'), event('answer'), event('end')] });
  const remove = bridge.subscribeSystemCalls(async value => seen.push(value.type));
  await flush(); assert.deepEqual(seen, ['end']); remove();
});
test('End interrupts a pending authenticated Answer instead of waiting for permission completion', async () => {
  let listener, resolve;
  const queue = [event('answer')], seen = [];
  const bridge = load({ addListener: (_name, callback) => { listener = callback; return { remove() {} }; }, drainEvents: async () => queue.splice(0) });
  const remove = bridge.subscribeSystemCalls(async value => { seen.push(value.type); if (value.type === 'answer') await new Promise(done => { resolve = done; }); });
  await flush(); queue.push(event('end')); listener(); await flush(); assert.deepEqual(seen, ['answer', 'end']);
  resolve(); await flush(); assert.deepEqual(seen, ['answer', 'end']); remove();
});
test('expired or malformed native invitations cannot be answered', () => {
  const bridge = load(null);
  assert.equal(bridge.currentSystemCall(event('answer')), true);
  assert.equal(bridge.currentSystemCall(event('answer', { expiresAt: '2000-01-01T00:00:00.000Z' })), false);
  assert.equal(bridge.currentSystemCall(event('answer', { callId: 'invalid' })), false);
  assert.equal(bridge.currentSystemCall(event('answer', { mode: 'screen' })), false);
});
