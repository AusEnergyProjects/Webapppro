import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as billing from "../src/lib/trade-sms-billing.ts";
import * as stripe from "../src/lib/trade-sms-stripe.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected wallet dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}
const secret = "whsec_test_fixture_only";
const actor = { ownerUid: "owner", actorUid: "owner", isOwner: true };
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_team_members(id TEXT PRIMARY KEY);");
  for (const migration of ["0182_trade_sms", "0212_trade_team_sms", "0220_trade_managed_sms"]) sqlite.exec(read(`../drizzle/${migration}.sql`).replaceAll("--> statement-breakpoint", ""));
  const statement = (sql, bindings = []) => {
    const execute = () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } });
    return { bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }), run: async () => execute(), execute };
  };
  const db = { prepare: statement, batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const results = statements.map((item) => item.execute()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const env = { TLINK_SMS_STRIPE_SECRET_KEY: "sk_test_FixtureOnly", TLINK_SMS_STRIPE_WEBHOOK_SECRET: secret, TLINK_SMS_PUBLIC_ORIGIN: "https://example.test" };
  const environment = load("../src/lib/trade-sms-environment.ts", { "cloudflare:workers": { env } });
  const wallet = load("../src/lib/trade-sms-wallet-server.ts", { "../../db": { getD1: () => db }, "./trade-sms-environment": environment,
    "./trade-sms-billing": billing, "./trade-sms-stripe": stripe });
  const topup = (ownerUid = "owner", id = "topup-1", sessionId = "cs_test_1") => {
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO trade_sms_topups(id,owner_uid,request_id,amount_cents,status,session_id,created_at,updated_at) VALUES(?,?,?,5000,'open',?,?,?)").run(id, ownerUid, `request-${id}-000001`, sessionId, now, now);
    return { id: sessionId, client_reference_id: id, metadata: { tlink_sms_topup_id: id, tlink_owner_uid: ownerUid }, amount_total: 5000, currency: "aud", livemode: false, mode: "payment", payment_status: "paid", status: "complete", payment_intent: `pi_${id.replaceAll("-", "")}` };
  };
  return { sqlite, db, env, wallet, topup, close: () => sqlite.close() };
}
function webhook(type, object, changes = {}, signatureChanges = {}) {
  const body = JSON.stringify({ id: "evt_fixture", type, livemode: false, data: { object }, ...changes });
  const timestamp = signatureChanges.timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", signatureChanges.secret ?? secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://example.test/api/trade-sms/stripe", { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${digest}` }, body });
}
const refund = (session, amount, changes = {}) => ({ id: "ch_fixture", livemode: false, metadata: session.metadata, amount: session.amount_total, amount_refunded: amount, currency: "aud", payment_intent: session.payment_intent, ...changes });

test("top-up uses hosted checkout and credits nothing until verified payment; same request reuses checkout", async () => {
  const f = fixture();
  try {
    let requests = 0;
    const transport = async (url, init) => {
      requests++;
      assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
      assert.equal(init.redirect, "error");
      assert.equal(init.body.get("line_items[0][price_data][unit_amount]"), "5000");
      assert.equal(init.body.get("metadata[tlink_owner_uid]"), "owner");
      assert.equal(init.body.get("payment_intent_data[metadata][tlink_owner_uid]"), "owner");
      assert.match(init.headers["Idempotency-Key"], /^tlink-sms-topup-/);
      return Response.json({ id: "cs_test_hosted", url: "https://checkout.stripe.com/c/pay/cs_test_hosted" });
    };
    const input = { amountCents: 5000, requestId: "checkout-request-0001" };
    const first = await f.wallet.startSmsTopUp(actor, input, f.db, transport);
    assert.deepEqual(await f.wallet.startSmsTopUp(actor, input, f.db, transport), first);
    assert.equal(requests, 1);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    await assert.rejects(f.wallet.startSmsTopUp(actor, { ...input, amountCents: 10000 }, f.db, transport), /SMS_REQUEST_CONFLICT/);
    await assert.rejects(f.wallet.startSmsTopUp({ ...actor, isOwner: false }, input, f.db, transport), /SMS_OWNER_REQUIRED/);
  } finally { f.close(); }
});

test("verified paid checkout credits exact owner and amount once across duplicate and concurrent events", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    await Promise.all([f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db), f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.async_payment_succeeded", session), f.db)]);
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    assert.deepEqual(await f.wallet.smsWallet("owner", f.db), { balanceMicro: 50_000_000, reservedMicro: 0 });
    assert.equal((await f.wallet.smsWallet("other-owner", f.db)).balanceMicro, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 1);
  } finally { f.close(); }
});

test("checkout credit rejects wrong amount, owner, currency, mode, session and payment identity", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    const invalid = [{ amount_total: 4999 }, { amount_total: "5000" }, { currency: "usd" }, { mode: "subscription" }, { livemode: true }, { id: "cs_other" }, { client_reference_id: "another-topup" }, { metadata: { ...session.metadata, tlink_owner_uid: "other" } }, { payment_intent: "wrong" }, { status: "open" }];
    for (const changes of invalid) await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", { ...session, ...changes }), f.db), /SMS_WEBHOOK_INVALID/);
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", { ...session, payment_status: "unpaid" }), f.db);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
  } finally { f.close(); }
});

test("payment callback requires a fresh valid signature and matching live/test environment", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    for (const request of [webhook("checkout.session.completed", session, {}, { secret: "attacker" }), webhook("checkout.session.completed", session, {}, { timestamp: 1 }), webhook("checkout.session.completed", session, { livemode: true })]) await assert.rejects(f.wallet.receiveSmsStripeWebhook(request, f.db), /SMS_WEBHOOK_INVALID/);
    const signed = webhook("checkout.session.completed", session);
    const body = (await signed.text()).replace('"amount_total":5000', '"amount_total":10000');
    await assert.rejects(f.wallet.receiveSmsStripeWebhook(new Request(signed.url, { method: "POST", headers: signed.headers, body }), f.db), /SMS_WEBHOOK_INVALID/);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
  } finally { f.close(); }
});

test("refunds arriving before payment debit only cumulative increases despite replay and reordering", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    for (const amount of [2000, 1000, 2000, 3000, 3000]) await f.wallet.receiveSmsStripeWebhook(webhook("charge.refunded", refund(session, amount)), f.db);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, -30_000_000);
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 20_000_000);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger WHERE kind='refund'").get().n, 2);
    assert.equal(f.sqlite.prepare("SELECT refunded_cents n FROM trade_sms_topups").get().n, 3000);
  } finally { f.close(); }
});

test("refunds cannot exceed paid amount, move between owners/currencies or bind to a different payment", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    for (const changes of [{ amount_refunded: 5001 }, { amount_refunded: -1 }, { amount_refunded: 0.5 }, { amount: 10000 }, { currency: "usd" }, { payment_intent: "pi_other" }, { metadata: { ...session.metadata, tlink_owner_uid: "other-owner" } }]) {
      await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("charge.refunded", refund(session, 1000, changes)), f.db), /SMS_WEBHOOK_INVALID/);
    }
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
  } finally { f.close(); }
});

test("refund object live/test mode must match its signed event", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("charge.refunded", refund(session, 1000, { livemode: true })), f.db), /SMS_WEBHOOK_INVALID/);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
  } finally { f.close(); }
});

test("lost checkout response preserves one Stripe idempotency key and never recreates an expired intent", async () => {
  const f = fixture();
  try {
    const keys = [];
    const transport = async (_url, options) => { keys.push(options.headers["Idempotency-Key"]); throw new Error("lost response"); };
    const input = { amountCents: 5000, requestId: "uncertain-checkout-01" };
    await assert.rejects(f.wallet.startSmsTopUp(actor, input, f.db, transport), /SMS_PAYMENT_UNCERTAIN/);
    await assert.rejects(f.wallet.startSmsTopUp(actor, input, f.db, transport), /SMS_PAYMENT_UNCERTAIN/);
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
    f.sqlite.prepare("UPDATE trade_sms_topups SET created_at='2020-01-01T00:00:00.000Z'").run();
    await assert.rejects(f.wallet.startSmsTopUp(actor, input, f.db, transport), /SMS_PAYMENT_RECONCILIATION_REQUIRED/);
    assert.equal(keys.length, 2);
  } finally { f.close(); }
});

test("disputed payment freezes its owner account without minting credit", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    f.sqlite.exec("INSERT INTO trade_sms_accounts(owner_uid,status,created_at,updated_at) VALUES('owner','ready','now','now'),('other-owner','ready','now','now')");
    await f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", { id: "dp_fixture", payment_intent: session.payment_intent }), f.db);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid='owner'").get().status, "payment_review");
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid='other-owner'").get().status, "ready");
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
  } finally { f.close(); }
});

test("restricted live Stripe keys support checkout, live callback and authenticated payment sync", async () => {
  const f = fixture();
  try {
    f.env.TLINK_SMS_STRIPE_SECRET_KEY = "rk_live_FixtureOnly";
    const checkout = await f.wallet.startSmsTopUp(actor, { amountCents: 5000, requestId: "restricted-live-checkout" }, f.db, async (url, init) => {
      assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
      assert.equal(init.headers.Authorization, "Bearer rk_live_FixtureOnly");
      assert.equal(init.redirect, "error");
      return Response.json({ id: "cs_live_hosted", url: "https://checkout.stripe.com/c/pay/cs_live_hosted" });
    });
    assert.equal(checkout.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_live_hosted");
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    const row = f.sqlite.prepare("SELECT id FROM trade_sms_topups WHERE owner_uid='owner'").get();
    const session = { id: "cs_live_hosted", client_reference_id: row.id, metadata: { tlink_sms_topup_id: row.id, tlink_owner_uid: "owner" },
      amount_total: 5000, currency: "aud", livemode: true, mode: "payment", payment_status: "paid", status: "complete", payment_intent: "pi_livehosted" };
    await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db), /SMS_WEBHOOK_INVALID/);
    await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", { ...session, livemode: false }, { livemode: true }), f.db), /SMS_WEBHOOK_INVALID/);
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session, { livemode: true }), f.db);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
    const synced = { ...f.topup("sync-owner", "topup-sync", "cs_live_sync"), livemode: true };
    let requests = 0;
    await f.wallet.syncSmsPayments("sync-owner", f.db, async (url, init) => {
      requests++;
      assert.equal(url, "https://api.stripe.com/v1/checkout/sessions/cs_live_sync");
      assert.equal(init.headers.Authorization, "Bearer rk_live_FixtureOnly");
      assert.equal(init.method, "GET");
      return Response.json(synced);
    });
    assert.equal(requests, 1);
    assert.equal((await f.wallet.smsWallet("sync-owner", f.db)).balanceMicro, 50_000_000);
  } finally { f.close(); }
});

test("signed unrelated checkout events are acknowledged without changing SMS credit or orders", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
      for (const metadata of [{}, { tlink_invoice_id: "other-product-invoice", tlink_owner_uid: "owner" }]) {
        await f.wallet.receiveSmsStripeWebhook(webhook(type, { ...session, id: "cs_test_unrelated", client_reference_id: "unrelated-order", metadata }), f.db);
      }
    }
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_topups WHERE id='topup-1'").get().status, "open");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_accounts").get().n, 0);
  } finally { f.close(); }
});

test("dispute received before SMS account onboarding creates a persistent owner-only payment review", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    f.sqlite.exec("INSERT INTO trade_sms_accounts(owner_uid,status,created_at,updated_at) VALUES('other-owner','ready','now','now')");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_accounts WHERE owner_uid='owner'").get().n, 0);
    for (let replay = 0; replay < 2; replay++) {
      await f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", { id: "dp_beforeonboarding", payment_intent: session.payment_intent }), f.db);
    }
    const account = f.sqlite.prepare("SELECT * FROM trade_sms_accounts WHERE owner_uid='owner'").get();
    assert.equal(account.status, "payment_review");
    assert.equal(account.subaccount_id, "");
    assert.equal(account.encrypted_credentials, "");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_accounts WHERE owner_uid='owner'").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid='other-owner'").get().status, "ready");
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 1);
  } finally { f.close(); }
});

test("dispute before checkout confirmation retries a failed lookup and freezes verified owner before later credit", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    const dispute = { id: "dp_reordered", payment_intent: session.payment_intent };
    let requests = 0;
    await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", dispute), f.db, async () => {
      requests++;
      throw new Error("Temporary Stripe transport failure");
    }), /SMS_PAYMENT_UNCERTAIN/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_accounts").get().n, 0);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    await f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", dispute), f.db, async (url, init) => {
      requests++;
      assert.equal(url, `https://api.stripe.com/v1/payment_intents/${session.payment_intent}`);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer sk_test_FixtureOnly");
      return Response.json({ id: session.payment_intent, metadata: session.metadata, amount: session.amount_total, currency: "aud", livemode: false });
    });
    assert.equal(requests, 2);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid='owner'").get().status, "payment_review");
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 0);
    await f.wallet.receiveSmsStripeWebhook(webhook("checkout.session.completed", session), f.db);
    assert.equal((await f.wallet.smsWallet("owner", f.db)).balanceMicro, 50_000_000);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_sms_accounts WHERE owner_uid='owner'").get().status, "payment_review");
    await f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", dispute), f.db, async () => { throw new Error("Bound payment must not require another lookup"); });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 1);
  } finally { f.close(); }
});

test("unbound dispute lookup rejects mismatched payment identity, owner, amount, currency and live mode", async () => {
  const f = fixture();
  try {
    const session = f.topup();
    const intent = { id: session.payment_intent, metadata: session.metadata, amount: session.amount_total, currency: "aud", livemode: false };
    for (const changes of [{ id: "pi_other" }, { metadata: { ...session.metadata, tlink_owner_uid: "other-owner" } },
      { metadata: { ...session.metadata, tlink_sms_topup_id: "other-topup" } }, { amount: 4999 }, { amount: "5000" }, { currency: "usd" }, { livemode: true }]) {
      await assert.rejects(f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", { id: "dp_invalid", payment_intent: session.payment_intent }),
        f.db, async () => Response.json({ ...intent, ...changes })), /SMS_WEBHOOK_INVALID/);
    }
    await f.wallet.receiveSmsStripeWebhook(webhook("charge.dispute.created", { id: "dp_unrelated", payment_intent: "pi_unrelated" }),
      f.db, async () => Response.json({ id: "pi_unrelated", metadata: { product: "other-service" } }));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_accounts").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_sms_ledger").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT payment_intent_id FROM trade_sms_topups WHERE id='topup-1'").get().payment_intent_id, "");
  } finally { f.close(); }
});
