import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { Miniflare } from "miniflare";

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const credentials = { username: "sms-runtime-fixture", apiKey: "local-fixture-key-never-live" };
const stripeKey = "rk_live_LocalRuntimeFixture";
const messageId = "1abc3200-c38c-6308-be4b-c7c51d01dcf0";
const from = "+61400000001", to = "+61412345678";
const currency = { currency_name_short: "AUD" };
const envelope = data => ({ http_code: 200, response_code: "SUCCESS", data });

test("actual Workers runtime reaches SMS and Stripe providers, rejects redirects and never retries uncertain mutations", async () => {
  const calls = [];
  let mode = "success", redirectStatus = 0;
  const runtime = new Miniflare({
    compatibilityDate: "2026-05-01", port: 0,
    modules: [
      { type: "ESModule", path: "entry.js", contents: `
        import { searchAustralianClickSendNumbers, submitClickSendSms } from './provider.js';
        import { createSmsCheckout } from './stripe.js';
        const credentials = ${JSON.stringify(credentials)};
        const input = { from: '${from}', to: '${to}', body: 'Local runtime fixture only',
          localMessageId: 'runtime-message-1', subaccountId: '123' };
        export default { async fetch(request) {
          const operation = new URL(request.url).searchParams.get('operation');
          try {
            let result;
            if (operation === 'inventory') result = await searchAustralianClickSendNumbers(credentials);
            else if (operation === 'send') result = await submitClickSendSms(credentials, input);
            else if (operation === 'checkout') result = await createSmsCheckout('${stripeKey}', {
              id: 'runtime-topup-1', ownerUid: 'runtime-owner', amountCents: 5000, origin: 'https://portal.example.test' });
            else throw new Error('Unsupported fixture operation');
            return Response.json({ ok: true, result });
          } catch (error) {
            return Response.json({ ok: false, code: error.message, definitiveRejection: error.definitiveRejection === true });
          }
        } }
      ` },
      { type: "ESModule", path: "provider.js", contents: compile("../src/lib/trade-clicksend-provider.ts") },
      { type: "ESModule", path: "stripe.js", contents: compile("../src/lib/trade-sms-stripe.ts") },
    ],
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ url, method: request.method, authorization: request.headers.get("authorization"),
        idempotencyKey: request.headers.get("idempotency-key"), body: await request.text() });
      assert.ok(["rest.clicksend.com", "api.stripe.com"].includes(url.hostname), "No credentials or request may reach any redirect target");
      if (redirectStatus) return new Response("Redirect", { status: redirectStatus, headers: { Location: "https://redirect.example.test/collect" } });
      if (mode === "uncertain-http") return Response.json({ error: "Temporary fixture failure" }, { status: 503 });
      if (mode === "uncertain-body") return new Response("Not provider JSON", { headers: { "Content-Type": "text/html" } });
      if (url.pathname === "/v3/numbers/search/AU") {
        const page = Number(url.searchParams.get("page"));
        return Response.json(envelope({ data: [{ dedicated_number: page === 1 ? from : "+61400000002", country: "AU",
          price_setup: "0.000000", price_monthly: "20.710000", price_total: "20.710000" }],
          current_page: page, last_page: 2, next_page_url: page === 1 ? "/?page=2" : null, _currency: currency }));
      }
      if (url.pathname === "/v3/sms/send") return Response.json(envelope({ _currency: currency, total_count: 1, queued_count: 1,
        messages: [{ from, to, custom_string: "runtime-message-1", subaccount_id: 123, country: "AU", is_shared_system_number: false,
          status: "SUCCESS", message_id: messageId, message_parts: 1, message_price: "0.054000" }] }));
      if (url.pathname === "/v1/checkout/sessions") return Response.json({ id: "cs_fixture_runtime", url: "https://checkout.stripe.com/c/pay/fixture-runtime" });
      throw new Error("Unexpected provider fixture endpoint");
    },
  });
  const invoke = async operation => (await runtime.dispatchFetch(`https://local.test/?operation=${operation}`)).json();
  try {
    const inventory = await invoke("inventory");
    assert.equal(inventory.ok, true, "The actual Workers fetch must accept the adapter RequestInit");
    assert.deepEqual(inventory.result.map(row => row.number), [from, "+61400000002"]);
    assert.equal(inventory.result[0].monthlyMicro, 20710000);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.url.pathname), ["/v3/numbers/search/AU", "/v3/numbers/search/AU"]);
    assert.ok(calls.every(call => call.method === "GET" && call.url.searchParams.get("limit") === "100"));

    const beforeSend = calls.length;
    assert.deepEqual(await invoke("send"), { ok: true, result: { sid: messageId, status: "queued", errorCode: "", segments: 1, priceMicro: 54000, definitiveRejection: false } });
    assert.equal(calls.length, beforeSend + 1);
    assert.equal(calls.at(-1).method, "POST");
    assert.equal(JSON.parse(calls.at(-1).body).messages[0].custom_string, "runtime-message-1");

    const beforeCheckout = calls.length;
    assert.deepEqual(await invoke("checkout"), { ok: true, result: { sessionId: "cs_fixture_runtime", checkoutUrl: "https://checkout.stripe.com/c/pay/fixture-runtime" } });
    assert.equal(calls.length, beforeCheckout + 1);
    assert.equal(calls.at(-1).method, "POST");
    assert.equal(calls.at(-1).idempotencyKey, "tlink-sms-topup-runtime-topup-1");
    const checkoutBody = new URLSearchParams(calls.at(-1).body);
    assert.equal(checkoutBody.get("metadata[tlink_owner_uid]"), "runtime-owner");
    assert.equal(checkoutBody.get("line_items[0][price_data][unit_amount]"), "5000");

    for (redirectStatus of [301, 302, 303, 307, 308]) {
      for (const operation of ["inventory", "send", "checkout"]) {
        const before = calls.length;
        const result = await invoke(operation);
        if (operation === "send") {
          assert.equal(result.ok, true);
          assert.equal(result.result.status, "failed");
          assert.equal(result.result.errorCode, "SMS_PROVIDER_REJECTED");
          assert.equal(result.result.definitiveRejection, true);
        } else {
          assert.equal(result.ok, false);
          assert.equal(result.code, operation === "checkout" ? "SMS_PAYMENT_UNAVAILABLE" : "SMS_PROVIDER_REJECTED");
          if (operation === "inventory") assert.equal(result.definitiveRejection, true);
        }
        assert.equal(calls.length, before + 1, `${operation} HTTP ${redirectStatus} makes exactly one request`);
      }
    }
    redirectStatus = 0;
    for (mode of ["uncertain-http", "uncertain-body"]) {
      for (const operation of ["send", "checkout"]) {
        const before = calls.length;
        const result = await invoke(operation);
        if (operation === "send") {
          assert.equal(result.ok, true);
          assert.equal(result.result.status, "unknown");
          assert.equal(result.result.definitiveRejection, false);
        } else {
          assert.equal(result.ok, false);
          assert.equal(result.code, "SMS_PAYMENT_UNCERTAIN");
        }
        assert.equal(calls.length, before + 1, "An uncertain mutation must never be retried automatically");
      }
    }
    assert.ok(calls.every(call => call.url.hostname === "rest.clicksend.com"
      ? call.authorization === `Basic ${btoa(`${credentials.username}:${credentials.apiKey}`)}`
      : call.url.hostname === "api.stripe.com" && call.authorization === `Bearer ${stripeKey}`));
  } finally { await runtime.dispose(); }
});
