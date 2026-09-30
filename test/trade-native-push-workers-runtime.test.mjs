import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exportPKCS8, generateKeyPair } from 'jose';
import { Miniflare } from 'miniflare';

test('actual Workers runtime authorizes FCM and delivers native push without forwarding redirects or retrying', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/trade-native-push-provider.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  });
  const keys = await generateKeyPair('RS256', { extractable: true });
  const credentials = { clientEmail: 'runtime-fixture@australian-energy-assessments.iam.gserviceaccount.com', privateKey: await exportPKCS8(keys.privateKey) };
  const calls = [];
  let responseStatus = 200;
  const operations = ['authorize', 'fcm-message', 'fcm-call', 'fcm-end', 'apns-message', 'apns-call', 'apns-end', 'apns-sandbox'];
  const runtime = new Miniflare({
    // Match the deployed Sites worker configuration and exercise its real fetch.
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], port: 0,
    modules: [
      { type: 'ESModule', path: 'entry.js', contents: `
        import { authorizeTradeNativePush, sendTradeNativePush, sendTradeApns } from './provider.js';
        const credentials = ${JSON.stringify(credentials)};
        export default { async fetch(request) {
          const operation = new URL(request.url).searchParams.get('operation');
          if (operation === 'unsupported') {
            try { new Request('https://unsupported.example.test', { redirect: 'error' }); }
            catch (error) { return Response.json({ name: error.name, message: error.message }); }
            return Response.json({ name: 'accepted' });
          }
          const authorization = { accessToken: 'synthetic-fcm-bearer', expiresAt: Date.now() + 60_000 };
          const payload = { v: 1, kind: operation.endsWith('message') ? 'team-message' : 'team-call',
            id: 'call-1234', threadId: 'thread-1234', title: 'TLink', body: 'Incoming team voice call',
            url: '/direct-trade/messages', expiresAt: new Date(Date.now() + 60_000).toISOString() };
          let result;
          if (operation === 'authorize') result = await authorizeTradeNativePush(credentials) ? 'authorized' : 'failed';
          else if (operation.startsWith('fcm-')) result = await sendTradeNativePush('synthetic:device_token_123456789', payload, authorization,
            fetch, { nativeCall: true, ended: operation.endsWith('end') });
          else result = await sendTradeApns('ab'.repeat(32), payload,
            { token: 'synthetic-apns-bearer', expiresAt: Date.now() + 60_000, environment: operation === 'apns-sandbox' ? 'sandbox' : 'production' },
            fetch, { voip: operation.endsWith('call'), ended: operation.endsWith('end') });
          return Response.json({ result });
        } }
      ` },
      { type: 'ESModule', path: 'provider.js', contents: bundle.outputFiles[0].text },
    ],
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ hostname: url.hostname, pathname: url.pathname, method: request.method,
        authorization: request.headers.get('authorization'), body: await request.text() });
      assert.ok(['oauth2.googleapis.com', 'fcm.googleapis.com', 'api.push.apple.com', 'api.sandbox.push.apple.com'].includes(url.hostname),
        'A provider credential or device token must never reach a redirect target');
      if (responseStatus >= 300 && responseStatus < 400) return new Response('Untrusted redirect response', {
        status: responseStatus, headers: { Location: 'https://credential-collector.invalid/collect' },
      });
      if (responseStatus >= 500) return Response.json({ error: 'Local fixture unavailable' }, { status: responseStatus });
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600 });
      if (url.hostname === 'fcm.googleapis.com') return Response.json({ name: 'projects/australian-energy-assessments/messages/runtime-fixture' });
      return new Response(null, { status: 200 });
    },
  });
  const invoke = async operation => (await runtime.dispatchFetch(`https://local.test/?operation=${operation}`)).json();
  try {
    const unsupported = await invoke('unsupported');
    assert.equal(unsupported.name, 'TypeError');
    assert.match(unsupported.message, /redirect|manual|follow/i);
    assert.equal(calls.length, 0, 'Unsupported RequestInit fails before contacting a provider');
    for (const operation of operations) {
      const before = calls.length;
      assert.deepEqual(await invoke(operation), { result: operation === 'authorize' ? 'authorized' : 'accepted' }, operation);
      assert.equal(calls.length, before + 1);
    }
    for (responseStatus of [301, 302, 303, 307, 308, 503]) {
      for (const operation of operations) {
        const before = calls.length;
        assert.deepEqual(await invoke(operation), { result: 'failed' }, `${operation} HTTP ${responseStatus}`);
        assert.equal(calls.length, before + 1, 'Failures and redirects make exactly one request and never retry');
      }
    }
    assert.ok(calls.every(call => call.method === 'POST'));
    for (const call of calls) {
      if (call.hostname === 'oauth2.googleapis.com') {
        assert.equal(call.authorization, null);
        assert.ok(new URLSearchParams(call.body).get('assertion'));
      } else assert.equal(call.authorization, call.hostname === 'fcm.googleapis.com' ? 'Bearer synthetic-fcm-bearer' : 'bearer synthetic-apns-bearer');
    }
  } finally { await runtime.dispose(); }
});
