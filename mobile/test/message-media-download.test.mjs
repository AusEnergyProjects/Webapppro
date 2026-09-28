import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function harness(response) {
  const requests = [];
  const dependencies = {
    'expo-crypto': {},
    'expo/fetch': { fetch: async (url, init) => { requests.push({ url, init }); return response; } },
    '@/lib/config': { API_BASE_URL: 'https://tlink.example', APP_VERSION: '1.0.2', MOBILE_PLATFORM: 'android' },
    '@/lib/device': { getDeviceId: async () => 'device-1' },
    '@/lib/auth': { firebaseAuth: { currentUser: null } },
    '@/lib/field-session': { getFieldSessionToken: async () => 'field-test-token' },
  };
  const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((id) => {
    assert.ok(id in dependencies, `Unknown dependency ${id}`);
    return dependencies[id];
  }, exports);
  return { ...exports, requests };
}

test('message media stays on the authenticated API with device binding and no redirects', async () => {
  const h = harness(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg', 'content-length': '3' } }));
  const result = await h.apiDownloadMessageMedia('attachment-1');
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(h.requests[0].url, 'https://tlink.example/api/trade-message-media?id=attachment-1');
  assert.equal(h.requests[0].init.headers.get('authorization'), 'TLinkField field-test-token');
  assert.equal(h.requests[0].init.headers.get('x-aea-device-id'), 'device-1');
  assert.equal(h.requests[0].init.redirect, 'error');
});

test('media URL injection and cancelled downloads never issue a request', async () => {
  const h = harness(new Response('x'));
  await assert.rejects(() => h.apiDownloadMessageMedia('../admin?token=secret'), /invalid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => h.apiDownloadMessageMedia('attachment-1', controller.signal), /cancelled/);
  assert.equal(h.requests.length, 0);
});

test('media rejects server errors, unsupported formats and incomplete content', async () => {
  const cases = [
    new Response(JSON.stringify({ error: 'Access ended.' }), { status: 403, headers: { 'content-type': 'application/json' } }),
    new Response('<script>', { headers: { 'content-type': 'text/html' } }),
    new Response('abc', { headers: { 'content-type': 'image/png', 'content-length': '4' } }),
    new Response('', { headers: { 'content-type': 'image/jpeg' } }),
  ];
  for (const response of cases) {
    const h = harness(response);
    await assert.rejects(() => h.apiDownloadMessageMedia('attachment-1'));
  }
});

test('streamed media is bounded even without a Content-Length header', async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(3 * 1024 * 1024));
    controller.enqueue(new Uint8Array(3 * 1024 * 1024));
    controller.close();
  } });
  const h = harness(new Response(stream, { headers: { 'content-type': 'audio/mp4' } }));
  await assert.rejects(() => h.apiDownloadMessageMedia('attachment-1'), /too large/);
});
