import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
function harness(response = new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })) {
  const state = { requests: [], revision: 0, ownerKey: 'business-one', fieldToken: 'fixture-token' };
  const deps = {
    'expo-crypto': {}, 'expo/fetch': { fetch: async (url, init) => {
      state.requests.push({ url, init }); if (state.switchDuringResponse) state.revision++;
      init.signal.addEventListener('abort', () => state.abortStream?.(), { once: true }); return response;
    } },
    '@/lib/config': { API_BASE_URL: 'https://tlink.example', APP_VERSION: '1.3.4', MOBILE_PLATFORM: 'ios' },
    '@/lib/device': { getDeviceId: async () => 'device-one' },
    '@/lib/auth': { firebaseAuth: { currentUser: { uid: 'actor-one', getIdToken: async () => 'bearer-fixture' } } },
    '@/lib/field-session': { getFieldSessionToken: async () => state.fieldToken, getFieldPrincipal: async () => ({ localOwnerKey: state.ownerKey }) },
    '@/lib/business-session': { businessSessionRevision: () => state.revision,
      getBusinessSession: async () => ({ principal: { localOwnerKey: state.ownerKey }, business: { ownerUid: 'owner-one', manualOnly: false } }) },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', 'setTimeout', 'clearTimeout', code)(id => {
    assert.ok(id in deps, id); return deps[id];
  }, exports, async () => { throw new Error('Native global fetch cannot stream evidence bytes.'); },
  (callback, delay) => { state.abort = callback; state.deadline = delay; return 1; }, () => { state.cleared = true; });
  return { state, ...exports };
}

test('saved rental photo previews use the exact private media ID with field and device authority', async () => {
  const h = harness(); const result = await h.downloadRentalEvidencePhoto('job-media_one', 'business-one');
  assert.deepEqual(result.bytes, jpeg); assert.equal(result.contentType, 'image/jpeg');
  const { url, init } = h.state.requests[0];
  assert.equal(url, 'https://tlink.example/api/trade-field-work?preview=job-media_one');
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
  assert.equal(init.headers.get('authorization'), 'TLinkField fixture-token');
  assert.equal(init.headers.get('x-aea-device-id'), 'device-one');
  assert.equal(init.headers.get('x-aea-platform'), 'ios');
  assert.equal(init.headers.get('x-aea-app-version'), '1.3.4');
  assert.equal(h.state.cleared, true);
});

test('business sign-in previews retain selected owner and bearer authority', async () => {
  const h = harness(); h.state.fieldToken = '';
  await h.downloadRentalEvidencePhoto('job-media_one', 'business-one');
  const headers = h.state.requests[0].init.headers;
  assert.equal(headers.get('authorization'), 'Bearer bearer-fixture');
  assert.equal(headers.get('x-tlink-business'), 'owner-one');
});

test('injected IDs, missing business, wrong business and pre-cancelled previews send no request', async () => {
  const h = harness();
  for (const args of [['../admin?secret=1', 'business-one'], ['https://external.invalid/photo.jpg', 'business-one'], ['', 'business-one'], ['media-one', ''], ['media-one', 'other-business']]) {
    await assert.rejects(() => h.downloadRentalEvidencePhoto(...args));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => h.downloadRentalEvidencePhoto('media-one', 'business-one', controller.signal), error => error.code === 'RENTAL_PHOTO_CANCELLED');
  h.state.fieldToken = '';
  await assert.rejects(() => h.downloadRentalEvidencePhoto('media-one', 'other-business'), error => error.code === 'BUSINESS_CHANGED');
  assert.equal(h.state.requests.length, 0);
});

test('assignment denial and upstream errors cannot become a successful photo preview', async () => {
  const denied = harness(new Response(JSON.stringify({ error: 'Job assignment ended.', code: 'FIELD_JOB_ACCESS' }), { status: 403 }));
  await assert.rejects(() => denied.downloadRentalEvidencePhoto('media-one', 'business-one'), error => error.status === 403 && error.code === 'FIELD_JOB_ACCESS');
  const malformed = harness(new Response('<html>outage</html>', { status: 502 }));
  await assert.rejects(() => malformed.downloadRentalEvidencePhoto('media-one', 'business-one'), error => error.code === 'INVALID_SERVER_RESPONSE');
});

test('preview rejects non-images, mismatched bytes, unsupported lengths and incomplete files', async () => {
  for (const response of [
    new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
    new Response('<svg></svg>', { headers: { 'content-type': 'image/svg+xml' } }),
    new Response('<html>outage</html>', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(jpeg, { headers: { 'content-type': 'image/png' } }),
    new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': 'invalid' } }),
    new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': '100' } }),
    new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(8 * 1024 * 1024 + 1) } }),
    new Response('', { headers: { 'content-type': 'image/jpeg' } }),
  ]) {
    const h = harness(response);
    await assert.rejects(() => h.downloadRentalEvidencePhoto('media-one', 'business-one'), error => error.code === 'RENTAL_PHOTO_INVALID');
  }
});

test('all three supported field evidence image formats can be opened', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const webp = new TextEncoder().encode('RIFFxxxxWEBPVP8 ');
  for (const [contentType, bytes] of [['image/jpeg', jpeg], ['image/png', png], ['image/webp', webp]]) {
    const h = harness(new Response(bytes, { headers: { 'content-type': contentType, 'content-length': String(bytes.length) } }));
    const result = await h.downloadRentalEvidencePhoto('media-one', 'business-one');
    assert.equal(result.contentType, contentType); assert.deepEqual(result.bytes, bytes);
  }
});

test('a business switch before or during the stream rejects the private photo and cancels its reader', async () => {
  const early = harness(); early.state.switchDuringResponse = true;
  await assert.rejects(() => early.downloadRentalEvidencePhoto('media-one', 'business-one'), error => error.code === 'BUSINESS_CHANGED');
  let h, controller, cancelled = false;
  const stream = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  h = harness(new Response(stream, { headers: { 'content-type': 'image/jpeg' } }));
  const pending = h.downloadRentalEvidencePhoto('media-one', 'business-one');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  h.state.revision++; controller.enqueue(jpeg);
  await assert.rejects(pending, error => error.code === 'BUSINESS_CHANGED');
  assert.equal(cancelled, true);
});

test('streams stay within the 8 MiB field upload limit even without content length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(5 * 1024 * 1024)); controller.enqueue(new Uint8Array(5 * 1024 * 1024));
  }, cancel() { cancelled = true; } });
  const h = harness(new Response(stream, { headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(() => h.downloadRentalEvidencePhoto('media-one', 'business-one'), error => error.status === 413 && error.code === 'RENTAL_PHOTO_INVALID');
  assert.equal(cancelled, true);
});

test('the deadline and caller cancellation remain active until streamed bytes finish', async () => {
  for (const external of [false, true]) {
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; } });
    const h = harness(new Response(stream, { headers: { 'content-type': 'image/jpeg' } }));
    h.state.abortStream = () => controller.error(new Error('Native stream aborted'));
    const caller = new AbortController();
    const pending = h.downloadRentalEvidencePhoto('media-one', 'business-one', caller.signal);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(h.state.deadline, 20_000); assert.notEqual(h.state.cleared, true);
    if (external) caller.abort(); else h.state.abort();
    await assert.rejects(pending, error => error.code === (external ? 'RENTAL_PHOTO_CANCELLED' : 'NETWORK_TIMEOUT'));
    assert.equal(h.state.cleared, true);
  }
});
