import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/native-system-calls.ts', import.meta.url), 'utf8');
const swift = fs.readFileSync(new URL('../modules/tlink-calls/ios/TLinkCallsModule.swift', import.meta.url), 'utf8');
function load(native) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    assert.equal(id, 'expo');
    return { requireOptionalNativeModule: () => native };
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const entry = (overrides = {}) => ({ timestamp: new Date(Date.now() - 1000).toISOString(), stage: 'push_received',
  localEnabled: true, appState: 'background', managedCallCount: 0, managedConnectedCount: 0,
  systemCallCount: 0, systemConnectedCount: 0, ...overrides });
const read = snapshot => load({ diagnostics: async () => snapshot,
  configure: () => assert.fail('diagnostic reads must not configure calls'),
  registration: () => assert.fail('diagnostic reads must not inspect tokens') }).getNativeCallDiagnostics();

test('unsupported Android and older native modules return no diagnostic snapshot', async () => {
  for (const native of [null, {}]) assert.deepEqual(await load(native).getNativeCallDiagnostics(), []);
});

test('diagnostic failure never prevents a device registration', async () => {
  assert.deepEqual(await load({ diagnostics: async () => { throw new Error('bridge unavailable'); } }).getNativeCallDiagnostics(), []);
  for (const malformed of [null, 'private native error', { payload: 'private' }]) assert.deepEqual(await read(malformed), []);
});

test('a stalled diagnostic bridge returns an empty snapshot after 250ms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = load({ diagnostics: () => new Promise(() => {}) }).getNativeCallDiagnostics()
    .then(result => { settled = true; return result; });
  t.mock.timers.tick(249);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, []);
});

test('diagnostic timeout is cleared after a successful or rejected bridge read', async t => {
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  assert.deepEqual(await read([]), []);
  assert.equal(cleared.mock.callCount(), 1);
  assert.deepEqual(await load({ diagnostics: () => Promise.reject(new Error('bridge unavailable')) }).getNativeCallDiagnostics(), []);
  assert.equal(cleared.mock.callCount(), 2);
});

test('diagnostics expose fixed facts and discard names, UUIDs, tokens and arbitrary error text', async () => {
  const safe = entry({ stage: 'call_report_failed', errorDomain: 'callkit_incoming', errorCode: 3 });
  const result = await read([{ ...safe, callId: 'private-uuid', threadId: 'private-thread', callerName: 'Private person',
    answerToken: 'secret-grant', token: 'secret-token', payload: { name: 'private' }, message: 'private error',
    rejectionReason: 'expired' }]);
  assert.deepEqual(result, [safe]);
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
});

test('only twelve recent diagnostic events are returned, with no entries beyond 24 hours', async () => {
  const events = Array.from({ length: 20 }, (_, i) => entry({ timestamp: new Date(Date.now() - (20 - i) * 1000).toISOString() }));
  assert.deepEqual(await read(events), events.slice(-12));
  assert.deepEqual(await read([
    entry({ timestamp: new Date(Date.now() - 86_401_000).toISOString() }),
    entry({ timestamp: new Date(Date.now() + 60_000).toISOString() }),
    entry({ timestamp: 'not a date' }),
  ]), []);
});

test('invalid stages, rejection codes and unrestricted errors cannot enter the snapshot', async () => {
  const rejected = entry({ stage: 'push_rejected', rejectionReason: 'expired' });
  const duplicate = entry({ stage: 'duplicate_report_failed', errorDomain: 'other', errorCode: -1 });
  assert.deepEqual(await read([
    entry({ stage: 'private stage' }), entry({ appState: 'private state' }),
    entry({ stage: 'push_rejected', rejectionReason: 'private payload' }),
    entry({ stage: 'call_report_failed', errorDomain: 'private.domain', errorCode: 3 }),
    entry({ stage: 'call_report_failed', errorDomain: 'other', errorCode: 9000 }),
    entry({ stage: 'call_report_failed', errorDomain: 'other', errorCode: 1.5 }),
    rejected, duplicate,
  ]), [rejected, duplicate]);
});

test('count fields are bounded whole numbers and connected counts cannot exceed active counts', async () => {
  const valid = entry({ managedCallCount: 1, managedConnectedCount: 1, systemCallCount: 32, systemConnectedCount: 20 });
  assert.deepEqual(await read([
    entry({ localEnabled: 'true' }), entry({ managedCallCount: -1 }), entry({ systemCallCount: 33 }),
    entry({ managedCallCount: 1.5 }), entry({ systemCallCount: '1' }), entry({ systemCallCount: Infinity }),
    entry({ managedConnectedCount: 1 }), entry({ systemConnectedCount: 1 }), valid,
  ]), [valid]);
});

test('Swift persistence encodes only typed diagnostic facts and retains twelve events for 24 hours', () => {
  const schema = swift.slice(swift.indexOf('private struct TLinkCallDiagnostic:'), swift.indexOf('// Created before the React Native bridge.'));
  assert.match(schema, /enum Stage: String, Codable/);
  assert.match(schema, /enum Rejection: String, Codable/);
  assert.doesNotMatch(schema, /callId|threadId|callerName|answerToken|voipPushToken|localizedDescription|userInfo/);
  const storage = swift.slice(swift.indexOf('private func recentDiagnostics()'), swift.indexOf('private override init()'));
  assert.match(storage, /JSONDecoder\(\)\.decode\(\[TLinkCallDiagnostic\]\.self/);
  assert.match(storage, /timeIntervalSince\(date\) <= 24 \* 60 \* 60/);
  assert.match(storage, /JSONEncoder\(\)\.encode\(events\)/);
  assert.match(storage, /suffix\(12\)/);
  assert.doesNotMatch(storage, /URLSession|SecureStore|Keychain|answerToken|dictionaryPayload|localizedDescription/);
  const scheduling = storage.slice(storage.indexOf('private func recordDiagnostic'), storage.indexOf('private func persistDiagnostic'));
  assert.match(scheduling, /let timestamp = Date\(\)[\s\S]*DispatchQueue\.main\.async[\s\S]*persistDiagnostic\(stage, timestamp: timestamp/);
  assert.doesNotMatch(scheduling, /UserDefaults|recentDiagnostics|saveDiagnostics|JSONEncoder|JSONDecoder|\.sync\(/,
    'PushKit receipt schedules persistence without doing storage work before reporting CallKit');
  const snapshot = storage.slice(storage.indexOf('func diagnostics()'), storage.indexOf('private func recordDiagnostic'));
  assert.doesNotMatch(snapshot, /saveDiagnostics|\.set\(/, 'reading diagnostics does not mutate stored state');
  assert.match(swift, /let changed = self\.enabled != enabled[\s\S]*if changed \{ recordDiagnostic\(\.configurationChanged\) \}/);
});

test('PushKit schedules receipt, rejection and presentation diagnostics before completion', () => {
  assert.match(swift, /provider\.setDelegate\(self, queue: \.main\)/, 'CallKit runs delegate methods and report completions on main');
  assert.match(swift, /PKPushRegistry\(queue: \.main\)/, 'PushKit shares the same queue');
  assert.match(swift, /AsyncFunction\("diagnostics"\)[^\n]+runOnQueue\(\.main\)/, 'snapshot reads cannot race native history writes');
  const push = swift.slice(swift.indexOf('func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith'), swift.indexOf('private func enqueue'));
  assert.match(push, /recordDiagnostic\(\.pushReceived\)[\s\S]*guard enabled/);
  assert.match(push, /recordDiagnostic\(\.pushRejected, rejection: enabled \? TLinkCall\.rejectionReason\(data\) : \.disabled\)/);
  assert.match(push, /recordDiagnostic\(error == nil \? \.callReported : \.callReportFailed, error: error\)[\s\S]*completion\(\)/);
  const incoming = swift.slice(swift.indexOf('private func incoming(_ call:'), swift.indexOf('func outgoing(_ data:'));
  assert.match(incoming, /recordDiagnostic\(error == nil \? \.duplicateReported : \.duplicateReportFailed, error: error\)[\s\S]*completion\(\)/);
  assert.match(incoming, /recordDiagnostic\(error == nil \? \.callReported : \.callReportFailed, error: error\)[\s\S]*completion\(\)/);
  assert.match(swift, /controller\.callObserver\.calls\.filter \{ !\$0\.hasEnded \}/);
});
