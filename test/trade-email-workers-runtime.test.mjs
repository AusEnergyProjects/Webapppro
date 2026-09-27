import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { Miniflare } from "miniflare";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const compile = path => ts.transpileModule(read(path), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const server = read("../src/lib/trade-email-server.ts");
const platformFetch = server.match(/fetchImpl: (\(url, init\) => fetch\(url, \{[^\n]+?\}\))/)?.[1];
assert.ok(platformFetch, "Exercise the actual platform-email fetch wrapper from the central sender");

test("actual Workers runtime sends OAuth, identity, mailbox and platform requests without following redirects", async () => {
  const calls = [];
  let redirectStatus = 0;
  const runtime = new Miniflare({
    compatibilityDate: "2026-05-01", port: 0,
    modules: [
      { type: "ESModule", path: "entry.js", contents: `
        import { exchangeEmailCode, refreshEmailCredentials, getEmailIdentity, sendMailboxEmail } from './provider.js';
        import { sendServiceReminderProviderMessage } from './reminder.js';
        const config = { clientId: 'fixture-client', clientSecret: 'fixture-secret' };
        const code = { code: 'fixture-code', redirectUri: 'https://portal.example.test/callback', verifier: 'v'.repeat(43) };
        const message = { senderEmail: 'trade@example.test', senderName: 'Trade', recipient: 'trade@example.test',
          subject: 'Runtime fixture', text: 'Local test only', messageId: '<fixture@tlink.test>' };
        export default { async fetch(request) {
          const url = new URL(request.url); const operation = url.searchParams.get('operation');
          const provider = url.searchParams.get('provider') || 'google';
          try {
            if (operation === 'unsupported') new Request('https://unsupported.example.test', { redirect: 'error' });
            else if (operation === 'exchange') await exchangeEmailCode(provider, config, code);
            else if (operation === 'refresh') await refreshEmailCredentials(provider, config, { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: '2026-01-01T00:00:00Z' });
            else if (operation === 'identity') await getEmailIdentity(provider, 'fixture-access');
            else if (operation === 'send') await sendMailboxEmail(provider, 'fixture-access', message);
            else if (operation === 'platform') await sendServiceReminderProviderMessage({ channel: 'email', recipient: message.recipient,
              subject: message.subject, body: message.text, idempotencyKey: 'fixture-request', callbackUrl: '' },
              { runtime: { RESEND_API_KEY: 'fixture-key', RESEND_FROM_EMAIL: 'platform@example.test' }, fetchImpl: ${platformFetch} });
            else throw new Error('Unknown test operation');
            return Response.json({ ok: true });
          } catch (error) { return Response.json({ ok: false, name: error.name, code: error.code || '', outcome: error.outcome || '' }); }
        } }
      ` },
      { type: "ESModule", path: "provider.js", contents: compile("../src/lib/trade-email-provider.ts") },
      { type: "ESModule", path: "reminder.js", contents: compile("../src/lib/service-reminder-delivery.ts") },
    ],
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ hostname: url.hostname, pathname: url.pathname, method: request.method });
      if (url.hostname === "redirect.example.test") throw new Error("Credentials must never be forwarded to the redirect target");
      if (redirectStatus) return new Response("Redirect", { status: redirectStatus, headers: { Location: "https://redirect.example.test/collect" } });
      if (url.pathname.endsWith("/token")) return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 3600 });
      if (url.hostname === "openidconnect.googleapis.com") return Response.json({ sub: "fixture-account", email: "trade@example.test", email_verified: true });
      if (url.pathname === "/v1.0/me") return Response.json({ id: "fixture-account", mail: "trade@example.test", displayName: "Trade" });
      if (url.pathname.endsWith("/sendMail")) return new Response(null, { status: 202 });
      return Response.json({ id: "fixture-receipt" });
    },
  });
  const invoke = async (operation, provider = "google") => (await runtime.dispatchFetch(
    `https://local.test/?operation=${operation}&provider=${provider}`,
  )).json();
  try {
    // This catches the original failure using Workerd's real Request implementation.
    const unsupported = await invoke("unsupported");
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.name, "TypeError");
    assert.equal(calls.length, 0);
    for (const provider of ["google", "microsoft"]) {
      for (const operation of ["exchange", "refresh", "identity", "send"]) {
        const before = calls.length;
        assert.deepEqual(await invoke(operation, provider), { ok: true }, `${provider} ${operation}`);
        assert.equal(calls.length, before + 1);
      }
    }
    assert.deepEqual(await invoke("platform"), { ok: true });
    assert.equal(calls.at(-1).hostname, "api.resend.com");
    for (redirectStatus of [301, 302, 303, 307, 308]) {
      for (const operation of ["exchange", "refresh", "identity", "send", "platform"]) {
        const before = calls.length;
        const result = await invoke(operation);
        assert.equal(result.ok, false);
        assert.equal(result.outcome, operation === "platform" ? "definite_failure" : "rejected");
        if (operation !== "platform") assert.equal(result.code, "email_provider_rejected");
        assert.equal(calls.length, before + 1, "Each rejected redirect makes exactly one outbound request");
      }
    }
    assert.ok(calls.every(call => call.hostname !== "redirect.example.test"));
  } finally { await runtime.dispose(); }
});
