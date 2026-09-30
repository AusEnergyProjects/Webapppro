import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('actual Workers runtime encrypts browser push and rejects redirects without leaking VAPID authorization', async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/trade-push-provider.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const b64 = bytes => Buffer.from(bytes).toString('base64url');
  const subscriber = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const credentials = { publicKey: b64(await crypto.subtle.exportKey('raw', signing.publicKey)),
    privateKey: (await crypto.subtle.exportKey('jwk', signing.privateKey)).d, subject: 'mailto:fixture@example.test' };
  const subscription = { expirationTime: null, keys: { p256dh: b64(await crypto.subtle.exportKey('raw', subscriber.publicKey)), auth: b64(new Uint8Array(16).fill(8)) } };
  const endpoints = ['https://fcm.googleapis.com/fcm/send/runtime-fixture',
    'https://web.push.apple.com/Qruntime-fixture', 'https://updates.push.services.mozilla.com/wpush/v2/runtime-fixture'];
  const calls = [];
  let status = 201;
  const runtime = new Miniflare({
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], port: 0,
    modules: [
      { type: 'ESModule', path: 'entry.js', contents: `
        import { sendTradePush } from './provider.js';
        export default { async fetch(request) {
          const url = new URL(request.url);
          const subscription = { ...${JSON.stringify(subscription)}, endpoint: url.searchParams.get('endpoint') };
          const payload = { v: 1, kind: 'team-message', id: 'message-1234', threadId: 'thread-1234', title: 'TLink',
            body: 'New team message', url: '/direct-trade/messages',
            expiresAt: url.searchParams.has('expired') ? '2000-01-01' : new Date(Date.now() + 60_000).toISOString() };
          return Response.json({ result: await sendTradePush(subscription, payload, ${JSON.stringify(credentials)}) });
        } }
      ` },
      { type: 'ESModule', path: 'provider.js', contents: bundle.outputFiles[0].text },
    ],
    outboundService: async request => {
      calls.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers),
        body: Buffer.from(await request.arrayBuffer()) });
      assert.ok(endpoints.includes(request.url), 'VAPID authorization and encrypted payload must never reach a redirect target');
      return new Response(null, { status, ...(status >= 300 && status < 400
        ? { headers: { Location: 'https://credential-collector.invalid/collect' } } : {}) });
    },
  });
  const invoke = async (endpoint, expired = false) => (await runtime.dispatchFetch(
    `https://local.test/?endpoint=${encodeURIComponent(endpoint)}${expired ? '&expired=1' : ''}`)).json();
  try {
    for (status of [201, 202, 301, 302, 303, 307, 308, 404, 410, 429, 503]) {
      for (const endpoint of endpoints) {
        const before = calls.length;
        assert.deepEqual(await invoke(endpoint), { result: [201, 202].includes(status) ? 'accepted' : [404, 410].includes(status) ? 'expired' : 'failed' }, `HTTP ${status}`);
        assert.equal(calls.length, before + 1, 'Each outcome makes exactly one request with no follow-up send');
      }
    }
    const before = calls.length;
    assert.deepEqual(await invoke('https://127.0.0.1/private'), { result: 'failed' });
    assert.deepEqual(await invoke(endpoints[0], true), { result: 'stale' });
    assert.equal(calls.length, before, 'Invalid and expired subscriptions never send');
    for (const call of calls) {
      assert.equal(call.method, 'POST');
      assert.equal(call.headers['content-encoding'], 'aes128gcm');
      assert.match(call.headers.authorization, /^vapid /i);
      assert.ok(Number(call.headers.ttl) > 0 && Number(call.headers.ttl) <= 60);
      assert.ok(call.body.length > 0);
      assert.equal(call.body.includes(Buffer.from('New team message')), false);
      assert.equal(JSON.stringify(call.headers).includes(credentials.privateKey), false);
    }
  } finally { await runtime.dispose(); }
});
