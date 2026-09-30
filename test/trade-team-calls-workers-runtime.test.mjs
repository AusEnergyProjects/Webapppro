import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('actual Workers runtime obtains bounded call relay credentials without following redirects or retrying', async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/trade-team-calls-provider.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const settings = { TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'b'.repeat(32) };
  const ice = [{ urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:global.turn.twilio.com:3478?transport=udp', username: 'fixture-username', credential: 'fixture-temporary' }];
  const calls = [];
  let status = 200, mode = 'success';
  const runtime = new Miniflare({
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], port: 0,
    modules: [
      { type: 'ESModule', path: 'entry.js', contents: `
        import { teamCallTurnCredentials, teamCallIceServers } from './provider.js';
        export default { async fetch(request) {
          try {
            const credentials = teamCallTurnCredentials(${JSON.stringify(settings)});
            const ice = await teamCallIceServers(credentials, Number(new URL(request.url).searchParams.get('ttl')));
            return Response.json({ ok: true, ice });
          } catch (error) { return Response.json({ ok: false, error: error.message }); }
        } }
      ` },
      { type: 'ESModule', path: 'provider.js', contents: bundle.outputFiles[0].text },
    ],
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ hostname: url.hostname, pathname: url.pathname, method: request.method,
        authorization: request.headers.get('authorization'), body: await request.text() });
      assert.equal(url.hostname, 'api.twilio.com', 'Server credentials must never reach a redirect target');
      if (status >= 300 && status < 400) return new Response('Untrusted redirect response', {
        status, headers: { Location: 'https://credential-collector.invalid/collect' },
      });
      if (mode === 'invalid-json') return new Response('Not provider JSON');
      if (mode === 'invalid-relay') return Response.json({ ice_servers: [{ urls: 'turn:untrusted.invalid', username: 'x', credential: 'y' }] });
      return Response.json({ ice_servers: ice, account_sid: settings.TWILIO_ACCOUNT_SID, secret: settings.TWILIO_AUTH_TOKEN }, { status });
    },
  });
  const invoke = async ttl => (await runtime.dispatchFetch(`https://local.test/?ttl=${ttl}`)).json();
  try {
    for (const ttl of [1, 3600]) {
      const before = calls.length;
      const result = await invoke(ttl);
      assert.deepEqual(result, { ok: true, ice }, 'A real Workers fetch must reach the mocked relay provider');
      assert.equal(calls.length, before + 1);
      assert.equal(new URLSearchParams(calls.at(-1).body).get('Ttl'), String(ttl));
      assert.ok(!JSON.stringify(result).includes(settings.TWILIO_AUTH_TOKEN));
      assert.ok(!JSON.stringify(result).includes(settings.TWILIO_ACCOUNT_SID));
    }
    for (status of [301, 302, 303, 307, 308, 401, 403, 429, 503]) {
      const before = calls.length;
      assert.deepEqual(await invoke(60), { ok: false, error: 'CALL_RELAY_UNAVAILABLE' });
      assert.equal(calls.length, before + 1, `HTTP ${status} never follows a redirect or retries credential issuance`);
    }
    status = 200;
    for (mode of ['invalid-json', 'invalid-relay']) {
      const before = calls.length;
      assert.deepEqual(await invoke(60), { ok: false, error: 'CALL_RELAY_UNAVAILABLE' });
      assert.equal(calls.length, before + 1);
    }
    for (const ttl of [0, 3601, 1.5]) {
      const before = calls.length;
      assert.deepEqual(await invoke(ttl), { ok: false, error: 'CALL_INPUT_INVALID' });
      assert.equal(calls.length, before);
    }
    assert.ok(calls.every(call => call.method === 'POST'
      && call.pathname === `/2010-04-01/Accounts/${settings.TWILIO_ACCOUNT_SID}/Tokens.json`
      && call.authorization === `Basic ${btoa(`${settings.TWILIO_ACCOUNT_SID}:${settings.TWILIO_AUTH_TOKEN}`)}`));
  } finally { await runtime.dispose(); }
});
