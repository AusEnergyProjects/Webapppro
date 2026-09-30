import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ firebase = false } = {}) {
  const state = { locked: false, revision: 0, reads: 0, bearer: 'first', gate: null, status: 200, fetchGate: null, requests: [] };
  const auth = { currentUser: firebase ? { uid: 'user-a', getIdToken: async () => state.bearer } : null };
  const stored = async value => { state.reads++; if (state.gate) await state.gate.promise; if (state.locked) throw new Error('Keychain locked'); return value; };
  const dependencies = {
    'expo-crypto': {}, 'expo/fetch': {},
    '@/lib/config': { API_BASE_URL: 'https://tlink.test', APP_VERSION: '1.2.0', MOBILE_PLATFORM: 'ios' },
    '@/lib/device': { getDeviceId: () => stored('device-a') },
    '@/lib/auth': { firebaseAuth: auth },
    '@/lib/field-session': { getFieldSessionToken: () => stored(firebase ? '' : 'field-a') },
    '@/lib/business-session': { businessSessionRevision: () => state.revision, getBusinessSession: () => stored({ business: { ownerUid: 'business-a' } }) },
  };
  const fetch = async (url, init) => {
    state.requests.push({ url, init });
    if (state.fetchGate) await state.fetchGate.promise;
    return new Response(JSON.stringify(state.status === 200 ? { ok: true } : { code: 'CALL_ACCESS_REQUIRED', error: 'Access revoked' }), { status: state.status });
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, loaded, loaded.exports, fetch);
  const lifetime = new AbortController();
  return { state, auth, lifetime, request: loaded.exports.createTeamCallRequest(lifetime.signal) };
}

test('a warm field call keeps its authorized device session when the keychain locks', async () => {
  const f = fixture();
  await f.request(); const reads = f.state.reads;
  f.state.locked = true;
  assert.deepEqual(await f.request('callId=call-a', { method: 'POST', body: '{"action":"answer"}' }), { ok: true });
  assert.equal(f.state.reads, reads);
  assert.equal(f.state.requests[1].url, 'https://tlink.test/api/trade-team-calls?callId=call-a');
  assert.equal(f.state.requests[1].init.headers.get('Authorization'), 'TLinkField field-a');
  assert.equal(f.state.requests[1].init.headers.get('x-aea-device-id'), 'device-a');
  f.lifetime.abort();
  await assert.rejects(f.request(), { code: 'CALL_SESSION_CLOSED' });
});

test('a cold locked call fails closed without dispatching an unauthenticated request', async () => {
  const f = fixture(); f.state.locked = true;
  await assert.rejects(f.request(), /Keychain locked/);
  assert.equal(f.state.requests.length, 0);
  f.lifetime.abort();
});

test('Firebase calls refresh their bearer while retaining the authorized business and device', async () => {
  const f = fixture({ firebase: true }); await f.request();
  const reads = f.state.reads; f.state.locked = true; f.state.bearer = 'renewed';
  await f.request();
  assert.equal(f.state.reads, reads);
  assert.equal(f.state.requests[1].init.headers.get('Authorization'), 'Bearer renewed');
  assert.equal(f.state.requests[1].init.headers.get('X-TLink-Business'), 'business-a');
  f.lifetime.abort();
});

test('concurrent call operations prepare credentials once', async () => {
  const f = fixture(); f.state.gate = deferred();
  const pending = Promise.all([f.request(), f.request()]);
  f.state.gate.resolve(); await pending;
  assert.equal(f.state.reads, 2); assert.equal(f.state.requests.length, 2);
  f.lifetime.abort();
});

test('closing a call cancels pending credential reads and prevents a late network request', async () => {
  const f = fixture(); f.state.gate = deferred();
  const pending = f.request(); f.lifetime.abort();
  await assert.rejects(pending, { code: 'CALL_REQUEST_CANCELLED' });
  f.state.gate.resolve(); await new Promise(setImmediate);
  assert.equal(f.state.requests.length, 0);
});

test('business or account changes discard the old authorization before dispatch', async () => {
  for (const change of ['business', 'account']) {
    const f = fixture({ firebase: true }); await f.request();
    if (change === 'business') f.state.revision++;
    else f.auth.currentUser = { uid: 'user-b', getIdToken: async () => 'other' };
    await assert.rejects(f.request(), { code: 'BUSINESS_CHANGED' });
    assert.equal(f.state.requests.length, 1); f.lifetime.abort();
  }
});

test('business changes during preparation or response cannot return another session result', async () => {
  for (const phase of ['prepare', 'response']) {
    const f = fixture(); const gate = deferred();
    if (phase === 'prepare') f.state.gate = gate;
    else { await f.request(); f.state.fetchGate = gate; }
    const pending = f.request(); await new Promise(setImmediate);
    f.state.revision++; gate.resolve();
    await assert.rejects(pending, { code: 'BUSINESS_CHANGED' });
    if (phase === 'prepare') assert.equal(f.state.requests.length, 0);
    f.lifetime.abort();
  }
});

test('request cancellation aborts transport without invalidating the mounted call session', async () => {
  const f = fixture(); await f.request(); f.state.fetchGate = deferred();
  const controller = new AbortController();
  const pending = f.request('', { signal: controller.signal }); await new Promise(setImmediate);
  controller.abort(); await assert.rejects(pending, { code: 'CALL_REQUEST_CANCELLED' });
  assert.equal(f.state.requests[1].init.signal.aborted, true);
  f.state.fetchGate.resolve(); f.state.fetchGate = null;
  assert.deepEqual(await f.request(), { ok: true }); f.lifetime.abort();
});

test('revoked or expired authorization remains a server error on warm calls', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); await f.request(); f.state.status = status;
    await assert.rejects(f.request(), { status, code: 'CALL_ACCESS_REQUIRED' });
    f.lifetime.abort();
  }
});
