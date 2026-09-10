import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { QUICK_UPGRADE_RECEIPT_PREFIX, quickUpgradeReceiptDraft } from "../src/lib/quick-upgrade-receipt.mjs";
import { enqueueQuickUpgradeReceipt, dispatchQuickUpgradeReceipt } from "../src/lib/quick-upgrade-receipt-delivery.mjs";
import { cleanupPublicPlanDeliveryObjectsWrite } from "../src/lib/public-plan-delivery-cleanup.mjs";
import { QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE } from "../src/lib/quick-upgrade-enquiry.mjs";

const reference = "AEA-20260911-12345678ABCD4ABC";
const input = { reference, opportunityId: "opportunity-1", fingerprint: "a".repeat(64), recipient: "attacker@example.test" };
const receipt = { reference, firstName: "Jamie", services: ["solar", "battery"], matchingState: "matched" };

function fixture(t, { matched = true, reviewed = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0129_public_plan_delivery_outboxes.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  sqlite.exec(`CREATE TABLE trade_opportunities (id TEXT PRIMARY KEY, source_reference TEXT, created_by_uid TEXT, status TEXT, service_categories TEXT);
    CREATE TABLE public_trade_lead_contact_releases (opportunity_id TEXT, source_reference TEXT, customer_first_name TEXT, customer_email TEXT,
      status TEXT, notice_version TEXT, consent_purpose TEXT, granted_at TEXT, withdrawn_at TEXT);
    CREATE TABLE trade_opportunity_matches (opportunity_id TEXT, status TEXT);
    CREATE TABLE admin_notifications (event_key TEXT, entity_type TEXT, entity_id TEXT);`);
  sqlite.prepare("INSERT INTO trade_opportunities VALUES (?, ?, 'lead-intake', 'open', ?)")
    .run(input.opportunityId, reference, JSON.stringify(receipt.services));
  sqlite.prepare("INSERT INTO public_trade_lead_contact_releases VALUES (?, ?, ?, ?, 'active', ?, ?, ?, '')")
    .run(input.opportunityId, reference, receipt.firstName, "jamie@example.test", QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
      QUICK_UPGRADE_CONSENT_PURPOSE, "2026-09-11T00:00:00.000Z");
  if (matched) sqlite.prepare("INSERT INTO trade_opportunity_matches VALUES (?, 'offered')").run(input.opportunityId);
  if (reviewed) sqlite.prepare("INSERT INTO admin_notifications VALUES (?, 'trade_opportunity', ?)")
    .run(`quick-upgrade-no-match:${input.opportunityId}`, input.opportunityId);
  const statement = (sql, bindings = []) => ({
    bind(...values) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...bindings) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }; },
  });
  const db = { prepare: statement, async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const entry of statements) results.push(await entry.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const objects = new Map();
  const bucket = {
    async put(key, bytes) { objects.set(key, bytes); }, async head(key) { return objects.has(key) ? {} : null; },
    async get(key) { const bytes = objects.get(key); return bytes ? { async arrayBuffer() { return bytes; } } : null; },
    async delete(key) { objects.delete(key); },
  };
  let clock = Date.parse("2026-09-11T00:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const runtime = { RESEND_API_KEY: "synthetic-test-key", RESEND_FROM_EMAIL: "receipts@example.test", RESEND_WEBHOOK_SECRET: "synthetic-webhook-secret-value" };
  const row = () => sqlite.prepare(`SELECT intake.*, customer.id customer_delivery_id FROM public_plan_lead_intakes intake
    JOIN public_plan_customer_email_deliveries customer ON customer.intake_id = intake.id`).get();
  const delivery = () => sqlite.prepare("SELECT * FROM public_plan_customer_email_deliveries").get();
  return { sqlite, db, bucket, objects, runtime, now, row, delivery, advance: (minutes) => { clock += minutes * 60_000; } };
}

test("receipt copy distinguishes a matched request from the queued AEA review without promising quotes", () => {
  const matched = quickUpgradeReceiptDraft(receipt);
  const review = quickUpgradeReceiptDraft({ ...receipt, matchingState: "review" });
  assert.match(matched.body, /suitable approved TLink businesses/);
  assert.match(matched.body, /provide quotes if they can help/);
  assert.match(review.body, /not found an available matching business/);
  assert.match(review.body, /team has been notified to review/);
  for (const draft of [matched, review]) {
    assert.match(draft.body, /1300 241 149/);
    assert.match(draft.body, /info@ausenergyassessments.com/);
    assert.match(draft.body, /Australian Energy Assessments and TLink/);
    assert.match(draft.body, /email, name and phone.*only where you chose/);
    assert.doesNotMatch(draft.body, /quotes (?:will|are about to)|within \d|attached|booking confirmed/i);
    assert.match(draft.html, /#071d30/);
    assert.match(draft.html, /#9af3d3/);
    assert.equal(draft.replyTo, "info@ausenergyassessments.com");
  }
});

test("receipt HTML escapes submitted text and excludes addresses, notes and phone from its snapshot", async (t) => {
  const escaped = quickUpgradeReceiptDraft({ ...receipt, firstName: '<img src=x onerror="bad">', reference: '<unsafe&"ref>' });
  assert.doesNotMatch(escaped.html, /<img src=x|<unsafe/);
  assert.match(escaped.html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  const stored = JSON.parse(new TextDecoder().decode(f.objects.values().next().value));
  assert.equal(stored.receipt.email, "jamie@example.test");
  assert.doesNotMatch(JSON.stringify(stored), /attacker@example.test|customerStreetAddress|projectNotes|customerPhone/);
});

test("one durable source creates one receipt only, preserving its original content when matching changes", async (t) => {
  const f = fixture(t);
  const first = await enqueueQuickUpgradeReceipt(input, f);
  const original = new TextDecoder().decode(f.objects.values().next().value);
  f.sqlite.exec("DELETE FROM trade_opportunity_matches");
  const retry = await enqueueQuickUpgradeReceipt(input, f);
  assert.deepEqual(retry, first);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM public_plan_lead_intakes").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM public_plan_customer_email_deliveries").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM public_plan_internal_relay_deliveries").get().n, 0);
  assert.equal(new TextDecoder().decode(f.objects.values().next().value), original);
  await assert.rejects(enqueueQuickUpgradeReceipt({ ...input, fingerprint: "b".repeat(64) }, f), /IDENTITY_CONFLICT/);
});

test("a receipt cannot be queued without durable intake and required no-match review", async (t) => {
  const f = fixture(t, { matched: false, reviewed: false });
  await assert.rejects(enqueueQuickUpgradeReceipt(input, f), /INTAKE_INCOMPLETE/);
  assert.equal(f.objects.size, 0);
  assert.equal(f.delivery(), undefined);
  await assert.rejects(enqueueQuickUpgradeReceipt({ ...input, opportunityId: "not-saved" }, f), /INTAKE_INCOMPLETE/);
});

test("queue rollback leaves no receipt and a post-commit transport failure resolves idempotently", async (t) => {
  const f = fixture(t);
  await assert.rejects(enqueueQuickUpgradeReceipt(input, { ...f, db: { ...f.db, batch: async () => { throw new Error("queue rollback"); } } }), /queue rollback/);
  assert.equal(f.objects.size, 0);
  assert.equal(f.delivery(), undefined);
  const result = await enqueueQuickUpgradeReceipt(input, { ...f, db: { ...f.db, batch: async (statements) => {
    await f.db.batch(statements); throw new Error("post-commit transport failure");
  } } });
  assert.equal(result.id, f.row().id);
  assert.deepEqual(await enqueueQuickUpgradeReceipt(input, f), result);
});

test("a rolled-back concurrent enqueue cannot delete the winning writer's private receipt", async (t) => {
  const f = fixture(t);
  let releaseWinner;
  let winnerReachedBatch;
  const waiting = new Promise((resolve) => { releaseWinner = resolve; });
  const reached = new Promise((resolve) => { winnerReachedBatch = resolve; });
  const winner = enqueueQuickUpgradeReceipt(input, { ...f, db: { ...f.db, batch: async (statements) => {
    winnerReachedBatch(); await waiting; return f.db.batch(statements);
  } } });
  await reached;
  await assert.rejects(enqueueQuickUpgradeReceipt(input, { ...f, db: { ...f.db, batch: async () => {
    throw new Error("concurrent rollback");
  } } }), /concurrent rollback/);
  releaseWinner();
  const saved = await winner;
  assert.equal(f.objects.size, 1);
  assert.ok(await f.bucket.head(f.row().payload_object_key));
  assert.deepEqual(await enqueueQuickUpgradeReceipt(input, f), saved);
});

test("provider failure respects retry timing and reuses the exact message and idempotency key", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push({ key: options.headers["Idempotency-Key"], body: JSON.parse(options.body) });
    if (calls.length === 1) throw new Error("uncertain provider transport");
    return Response.json({ id: "provider-receipt-1" });
  };
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl });
  assert.equal(f.delivery().status, "failed");
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl });
  assert.equal(calls.length, 1);
  f.advance(6);
  f.sqlite.exec("DELETE FROM trade_opportunity_matches");
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(calls[1].body.to, ["jamie@example.test"]);
  assert.equal(calls[1].body.attachments, undefined);
  assert.equal(f.delivery().status, "sent");
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl });
  assert.equal(calls.length, 2);
});

test("competing drains claim one provider send and terminal suppression prevents delivery", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const sendProvider = async () => { calls++; await pending; return { provider: "resend", providerMessageId: "provider-one", providerStatus: "accepted" }; };
  const sending = dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  for (let tries = 0; f.delivery().status !== "sending" && tries < 50; tries++) await new Promise((resolve) => setImmediate(resolve));
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  release(); await sending;
  assert.equal(calls, 1);
  f.sqlite.exec("UPDATE public_plan_customer_email_deliveries SET status='suppressed'");
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  assert.equal(calls, 1);
});

test("withdrawn consent and unavailable providers fail closed without sending", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  let calls = 0;
  const sendProvider = async () => { calls++; throw new Error("must not send"); };
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, runtime: {}, sendProvider });
  assert.equal(f.delivery().status, "waiting_for_channel");
  f.advance(6);
  f.sqlite.exec("UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-09-11T00:01:00.000Z'");
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  assert.equal(f.delivery().status, "suppressed");
  assert.equal(calls, 0);
});

test("uncertain delivery cannot be resent after the bounded provider deduplication window", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  let calls = 0;
  const sendProvider = async () => { calls++; throw new Error("uncertain"); };
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  f.advance(24 * 60);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  assert.equal(calls, 1);
  assert.match(f.delivery().last_error, /Review provider delivery/);
});

test("a confirmed provider failure with a fresh key can retry after an old key's window expires", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  const keys = [];
  const sendProvider = async (message) => {
    keys.push(message.idempotencyKey);
    return { provider: "resend", providerMessageId: `provider-${keys.length}`, providerStatus: "sent" };
  };
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  f.advance(48 * 60);
  f.sqlite.exec(`UPDATE public_plan_customer_email_deliveries SET status='provider_failed',
    next_attempt_at='', idempotency_key='${"b".repeat(64)}'`);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, sendProvider });
  assert.equal(keys.length, 2);
  assert.notEqual(keys[1], keys[0]);
  assert.equal(f.delivery().status, "sent");
});

test("definite provider rejection can retry after a configuration correction beyond one day", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl: async () => Response.json({ message: "rejected" }, { status: 403 }) });
  f.advance(48 * 60);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl: async () => Response.json({ id: "provider-corrected" }) });
  assert.equal(f.delivery().status, "sent");
});

test("shared backlog recovers interrupted receipt sending, respects backoff and excludes plans without relays", async (t) => {
  const f = fixture(t);
  await enqueueQuickUpgradeReceipt(input, f);
  const source = fs.readFileSync(new URL("../src/lib/public-plan-delivery-server.ts", import.meta.url), "utf8");
  const recoverySql = source.match(/db\.prepare\(`(UPDATE public_plan_customer_email_deliveries SET status = 'failed', last_error = 'Recovered an interrupted provider attempt\.'[\s\S]+?)`\)/)[1];
  const backlogSql = source.match(/const rows = await db\.prepare\(`(SELECT intake\.\*,[\s\S]+?)`\)\.bind\(\.\.\.bindings/)[1]
    .replace('${clauses.join(" AND ")}', "intake.status IN ('pending', 'failed', 'completed')")
    .replaceAll("${QUICK_UPGRADE_RECEIPT_PREFIX}", QUICK_UPGRADE_RECEIPT_PREFIX);
  const rows = () => f.sqlite.prepare(backlogSql).all(f.now(), f.now(), f.now(), 10);
  f.sqlite.exec(`INSERT INTO public_plan_lead_intakes (id, source_reference, submission_fingerprint, payload_object_key, created_at, updated_at)
    VALUES ('missing-relay', 'plan-ref', '${"c".repeat(64)}', 'public-plan/without-relay.json', '${f.now()}', '${f.now()}');
    INSERT INTO public_plan_customer_email_deliveries (id, intake_id, source_reference, idempotency_key, created_at, updated_at)
    VALUES ('plan-customer', 'missing-relay', 'plan-ref', '${"d".repeat(64)}', '${f.now()}', '${f.now()}')`);
  assert.equal(rows().length, 1);
  f.sqlite.prepare("UPDATE public_plan_customer_email_deliveries SET status='sending', last_attempt_at=? WHERE id=?")
    .run(f.now(), f.row().customer_delivery_id);
  assert.equal(rows().length, 0);
  f.advance(11);
  f.sqlite.prepare(recoverySql).run(f.now(), f.now(), new Date(Date.parse(f.now()) - 10 * 60_000).toISOString());
  assert.equal(rows().length, 1);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl: async () => { throw new Error("uncertain"); } });
  assert.equal(rows().length, 0);
  f.advance(6);
  assert.equal(rows().length, 1);
  await dispatchQuickUpgradeReceipt(f.row(), { ...f, fetchImpl: async () => Response.json({ id: "recovered-receipt" }) });
  assert.equal(f.delivery().status, "sent");
  assert.equal(rows().length, 0);
});

test("completed receipt payloads are cleaned without a relay while ordinary plans still require one", async (t) => {
  const f = fixture(t, { matched: false });
  await enqueueQuickUpgradeReceipt(input, f);
  assert.match(JSON.parse(new TextDecoder().decode(f.objects.values().next().value)).draft.body, /team has been notified/);
  f.sqlite.exec("UPDATE public_plan_customer_email_deliveries SET status='delivered'");
  const result = await cleanupPublicPlanDeliveryObjectsWrite(f.db, f.bucket, { now: f.now });
  assert.equal(result.payloadsDeleted, 1);
  assert.equal(f.objects.size, 0);
  assert.equal(f.row().status, "completed");
  assert.equal((await enqueueQuickUpgradeReceipt(input, f)).status, "delivered");
  const sql = fs.readFileSync(new URL("../src/lib/public-plan-delivery-server.ts", import.meta.url), "utf8");
  assert.match(sql, /relay\.id IS NOT NULL OR \(intake\.payload_object_key LIKE/);
  assert.match(sql, /intake\.payload_object_key NOT LIKE/);
});
