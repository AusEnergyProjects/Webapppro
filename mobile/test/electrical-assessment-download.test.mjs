import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness(response = new Response('%PDF-1.7 assessment', { headers: { 'content-type': 'application/pdf' } })) {
  const state = { requests: [], revision: 0, ownerKey: 'business-one' };
  const deps = {
    'expo-crypto': {}, 'expo/fetch': { fetch: async (url, init) => {
      state.requests.push({ url, init, transport: 'expo' }); if (state.switchDuringResponse) state.revision++;
      init.signal.addEventListener('abort', () => state.abortStream?.(), { once: true }); return response;
    } },
    '@/lib/config': { API_BASE_URL: 'https://tlink.example', APP_VERSION: '1.3.4', MOBILE_PLATFORM: 'android' },
    '@/lib/device': { getDeviceId: async () => 'device-one' }, '@/lib/auth': { firebaseAuth: { currentUser: null } },
    '@/lib/field-session': { getFieldSessionToken: async () => 'fixture-token', getFieldPrincipal: async () => ({ localOwnerKey: state.ownerKey }) },
    '@/lib/business-session': { businessSessionRevision: () => state.revision, getBusinessSession: async () => null },
  };
  const exports = {}; new Function('require', 'exports', 'fetch', 'setTimeout', 'clearTimeout', code)(id => { assert.ok(id in deps, id); return deps[id]; }, exports,
    async () => { throw new Error('React Native global fetch has no readable response.body.'); },
    (callback, delay) => { state.abort = callback; state.deadline = delay; return 1; }, () => { state.cleared = true; });
  return { state, ...exports };
}

test('private assessment PDF bytes keep selected-business, device and nonredirecting API authority', async () => {
  const h = harness(); const result = await h.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one');
  assert.equal(new TextDecoder().decode(result.bytes), '%PDF-1.7 assessment'); assert.equal(result.contentType, 'application/pdf');
  const request = h.state.requests[0]; assert.equal(request.url, 'https://tlink.example/api/trade-veu-electrical-assessments?recordId=assessment-one&view=pdf');
  assert.equal(request.init.headers.get('authorization'), 'TLinkField fixture-token'); assert.equal(request.init.headers.get('x-aea-device-id'), 'device-one');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.transport, 'expo', 'React Native global fetch cannot stream private assessment bytes'); assert.equal(h.state.cleared, true);
});

test('the download deadline remains active through stalled native streamed bytes', async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const h = harness(new Response(stream, { headers: { 'content-type': 'application/pdf' } }));
  h.state.abortStream = () => controller.error(new Error('Native stream aborted'));
  const pending = h.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(h.state.deadline, 120_000); assert.notEqual(h.state.cleared, true); h.state.abort();
  await assert.rejects(pending, error => error.code === 'NETWORK_TIMEOUT'); assert.equal(h.state.cleared, true);
});

test('wrong business, injected identifiers and missing evidence never send a private request', async () => {
  const h = harness();
  for (const args of [['../admin?x=1', 'pdf', 'business-one'], ['assessment-one', 'pdf', 'wrong-business'], ['assessment-one', 'evidence', 'business-one', ''], ['assessment-one', 'evidence', 'business-one', 'https://other.invalid']]) {
    await assert.rejects(() => h.downloadElectricalAssessmentFile(...args));
  }
  assert.equal(h.state.requests.length, 0);
});

test('a business switch before or during streamed bytes rejects the entire download', async () => {
  const early = harness(); early.state.switchDuringResponse = true; await assert.rejects(() => early.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one'), error => error.code === 'BUSINESS_CHANGED');
  let h;
  const stream = new ReadableStream({ pull(controller) { h.state.revision++; controller.enqueue(new TextEncoder().encode('%PDF-1.7')); controller.close(); } });
  h = harness(new Response(stream, { headers: { 'content-type': 'application/pdf' } }));
  await assert.rejects(() => h.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one'), error => error.code === 'BUSINESS_CHANGED');
});

test('denied or malformed binary error responses remain explicit failures', async () => {
  const denied = harness(new Response(JSON.stringify({ error: 'Assignment access ended.', code: 'PIESA_ACCESS' }), { status: 403 }));
  await assert.rejects(() => denied.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one'), error => error.status === 403 && error.code === 'PIESA_ACCESS');
  const malformed = harness(new Response('<html>outage</html>', { status: 502 }));
  await assert.rejects(() => malformed.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one'), error => error.code === 'INVALID_SERVER_RESPONSE');
});

test('wrong content types, mismatched magic, invalid lengths and truncated files are rejected', async () => {
  for (const response of [
    new Response('<html>outage</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('<html>outage</html>', { headers: { 'content-type': 'application/pdf' } }),
    new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf', 'content-length': 'invalid' } }),
    new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf', 'content-length': '100' } }),
    new Response('', { headers: { 'content-type': 'application/pdf' } }),
    new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
  ]) {
    const h = harness(response); await assert.rejects(() => h.downloadElectricalAssessmentFile('assessment-one', 'pdf', 'business-one'), error => error.code === 'PIESA_FILE_INVALID');
  }
});

test('streamed private evidence stays bounded with no advertised length and cancels overflow', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(7 * 1024 * 1024)); controller.enqueue(new Uint8Array(7 * 1024 * 1024)); }, cancel() { cancelled = true; } });
  const h = harness(new Response(stream, { headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(() => h.downloadElectricalAssessmentFile('assessment-one', 'evidence', 'business-one', 'evidence-one'), error => error.code === 'PIESA_FILE_INVALID'); assert.equal(cancelled, true);
  const valid = harness(new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  assert.equal((await valid.downloadElectricalAssessmentFile('assessment-one', 'evidence', 'business-one', 'evidence-one')).contentType, 'image/jpeg');
});
