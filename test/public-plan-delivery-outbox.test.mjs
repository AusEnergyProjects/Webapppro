import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import {
  confirmPublicPlanIntakeOpportunityWrite,
  persistPublicPlanDeliveryIntake,
} from "../src/lib/public-plan-intake-write.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  publicPlanContactReleaseAccessSql,
} from "../src/lib/public-plan-enquiry.mjs";
import * as deliveryPayload from "../src/lib/public-plan-delivery-payload.mjs";
import * as quickReceipt from "../src/lib/quick-upgrade-receipt.mjs";
import * as quickDelivery from "../src/lib/quick-upgrade-receipt-delivery.mjs";
import { QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE } from "../src/lib/quick-upgrade-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
} from "../src/lib/public-plan-quote-preparation.mjs";
import { cleanupPublicPlanDeliveryObjectsWrite } from "../src/lib/public-plan-delivery-cleanup.mjs";
import { recordPublicPlanCustomerPdfWrite } from "../src/lib/public-plan-customer-email-write.mjs";
import {
  publicPlanDeliveryRetryAt,
  shouldDrainPublicPlanDeliveryBacklog,
  takePublicPlanDeliveryDispatch,
} from "../src/lib/public-plan-delivery-retry.ts";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "../src/lib/service-reminder-delivery.ts";

function databaseAdapter(database) {
  const statement = (sql, initialBindings = []) => ({
    bind(...bindings) {
      return statement(sql, bindings);
    },
    async first() {
      return database.prepare(sql).get(...initialBindings) || null;
    },
    async run() {
      const result = database.prepare(sql).run(...initialBindings);
      return { ...result, meta: { changes: Number(result.changes) } };
    },
    async all() {
      return { results: database.prepare(sql).all(...initialBindings) };
    },
  });
  return {
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function sourceDatabase() {
  const database = new DatabaseSync(":memory:");
  const migration = fs.readFileSync("drizzle/0129_public_plan_delivery_outboxes.sql", "utf8")
    .replaceAll("--> statement-breakpoint", "");
  database.exec(migration);
  return database;
}

function memoryBucket() {
  const objects = new Map();
  let deleteCalls = 0;
  return {
    objects,
    get deleteCalls() { return deleteCalls; },
    async put(key, value) { objects.set(key, value); },
    async head(key) { return objects.has(key) ? {} : null; },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { async arrayBuffer() { return bytes; } } : null;
    },
    async delete(key) { deleteCalls += 1; objects.delete(key); },
  };
}

function record(overrides = {}) {
  return {
    intakeId: "intake-1",
    customerDeliveryId: "customer-1",
    relayDeliveryId: "relay-1",
    sourceReference: "AEA-20260812-12345678ABCD4ABC",
    submissionFingerprint: "a".repeat(64),
    payloadObjectKey: `public-plan/intake/AEA-20260812-12345678ABCD4ABC/${"a".repeat(64)}.json`,
    payloadBytes: new TextEncoder().encode('{"private":true}').buffer,
    customerIdempotencyKey: "b".repeat(64),
    relayIdempotencyKey: "c".repeat(64),
    metadata: { purpose: "public-plan-durable-intake" },
    now: "2026-08-12T10:00:00.000Z",
    ...overrides,
  };
}

function loadDeliveryModule(path, dependencies, expose = "") {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  Function("require", "exports", `${compiled}\n${expose}`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected delivery dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

async function hubDeliveryFixture(t, { status = "open", services = ["solar"], quick = false } = {}) {
  const database = sourceDatabase();
  t.after(() => database.close());
  const db = databaseAdapter(database), bucket = memoryBucket(), value = record();
  database.exec(`CREATE TABLE trade_opportunities (id TEXT PRIMARY KEY, source_reference TEXT, created_by_uid TEXT,
    status TEXT, expires_at TEXT, service_categories TEXT);
    CREATE TABLE public_trade_lead_contact_releases (id TEXT PRIMARY KEY, opportunity_id TEXT, source_reference TEXT,
      customer_first_name TEXT, customer_email TEXT, status TEXT, notice_version TEXT, consent_purpose TEXT,
      disclosed_fields TEXT, granted_at TEXT, withdrawn_at TEXT, postcode TEXT);
    CREATE TABLE trade_opportunity_matches (opportunity_id TEXT, status TEXT);
    CREATE TABLE admin_notifications (event_key TEXT, entity_type TEXT, entity_id TEXT);`);
  database.exec(fs.readFileSync("drizzle/0245_customer_quote_hub.sql", "utf8").split("--> statement-breakpoint")[0]);
  database.prepare("INSERT INTO trade_opportunities VALUES (?, ?, 'lead-intake', ?, '2099-12-31T00:00:00.000Z', ?)")
    .run("opportunity-1", value.sourceReference, status, JSON.stringify(services));
  database.prepare("INSERT INTO public_trade_lead_contact_releases VALUES ('contact-1', 'opportunity-1', ?, 'Jamie', 'jamie@example.test', 'active', ?, ?, ?, ?, '', '3000')")
    .run(value.sourceReference, quick ? QUICK_UPGRADE_CONSENT_NOTICE_VERSION : PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      quick ? QUICK_UPGRADE_CONSENT_PURPOSE : PUBLIC_PLAN_CONSENT_PURPOSE,
      JSON.stringify(["customer_email", "postcode", "service_categories", ...(quick ? ["customer_address"] : [])]), value.now);
  database.exec("INSERT INTO admin_notifications VALUES ('quick-upgrade-no-match:opportunity-1', 'trade_opportunity', 'opportunity-1')");
  if (status === "open") database.exec("INSERT INTO trade_opportunity_matches VALUES ('opportunity-1', 'offered')");
  // Production dispatch and capability SQL run unchanged. Only the environment-owned
  // encryption boundary is replaced; provider requests are captured below.
  const protection = { encryptProtectedPayload: async data => JSON.stringify(data), decryptProtectedPayload: async data => JSON.parse(data) };
  const quoteLinks = loadDeliveryModule("../src/lib/trade-quote-links.ts", { "@/lib/trade-integration-crypto": protection });
  const hubLinks = loadDeliveryModule("../src/lib/customer-hub-links.ts", {
    "./trade-integration-crypto": protection, "./trade-quote-links": quoteLinks,
    "./public-plan-enquiry.mjs": { publicPlanContactReleaseAccessSql },
  });
  const unavailable = () => { throw new Error("This fixture must use its injected database, bucket and cached PDF"); };
  const server = loadDeliveryModule("../src/lib/public-plan-delivery-server.ts", {
    "../../db": { getD1: unavailable },
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: unavailable },
    "@/lib/customer-plan-pdf-fonts": { loadCustomerPlanPdfFonts: unavailable },
    "@/lib/public-plan-delivery-payload.mjs": deliveryPayload,
    "@/lib/public-plan-delivery-retry": { publicPlanDeliveryRetryAt },
    "@/lib/public-plan-delivery-cleanup.mjs": { cleanupPublicPlanDeliveryObjectsWrite },
    "@/lib/public-plan-customer-email-write.mjs": { recordPublicPlanCustomerPdfWrite },
    "@/lib/customer-hub-links": hubLinks,
    "@/lib/quick-upgrade-receipt.mjs": quickReceipt,
    "@/lib/quick-upgrade-receipt-delivery.mjs": quickDelivery,
    "@/lib/public-plan-intake-write.mjs": { confirmPublicPlanIntakeOpportunityWrite, persistPublicPlanDeliveryIntake },
    "@/lib/public-plan-enquiry.mjs": { PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE },
    "@/lib/public-plan-quote-preparation.mjs": { PUBLIC_PLAN_QUOTE_PREPARATION_VERSION, PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION, PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE },
    "@/lib/service-reminder-delivery": { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration },
  }, "exports.dispatchCustomer=dispatchCustomer; exports.dispatchInternalRelay=dispatchInternalRelay;");
  const sent = [], relayed = [];
  const dependencies = { db, bucket, runtime: { RESEND_API_KEY: "synthetic-key", RESEND_FROM_EMAIL: "receipts@example.test",
    AEA_LEAD_WEBHOOK_URL: "https://relay.example.test/intake", AEA_LEAD_WEBHOOK_SIGNING_SECRET: "synthetic-signing-secret-at-least-32-characters" },
    fetchImpl: async (url, options) => {
      if (url === "https://relay.example.test/intake") { relayed.push(JSON.parse(options.body)); return new Response("ok"); }
      sent.push(JSON.parse(options.body)); return Response.json({ id: `provider-${sent.length}` });
    } };
  const payload = { envelope: { reference: value.sourceReference, email: "jamie@example.test", name: "Jamie", projectCategories: services,
    customerPlanDelivery: { private: "customer PDF input" } } };
  const originalEnvelope = structuredClone(payload.envelope);
  const row = () => database.prepare(`SELECT intake.*, customer.id customer_delivery_id, customer.status customer_status,
    customer.attempts customer_attempts, customer.idempotency_key customer_idempotency_key,
    customer.attachment_object_key, customer.attachment_filename, customer.attachment_sha256,
    relay.id relay_delivery_id, relay.status relay_status, relay.attempts relay_attempts, relay.idempotency_key relay_idempotency_key
    FROM public_plan_lead_intakes intake JOIN public_plan_customer_email_deliveries customer ON customer.intake_id=intake.id
    LEFT JOIN public_plan_internal_relay_deliveries relay ON relay.intake_id=intake.id`).get();
  if (!quick) {
    await persistPublicPlanDeliveryIntake(db, bucket, value);
    database.exec("UPDATE public_plan_lead_intakes SET opportunity_id='opportunity-1'");
    database.exec("UPDATE public_plan_customer_email_deliveries SET attachment_object_key='cached-private-plan.pdf', attachment_filename='plan.pdf'");
    await bucket.put("cached-private-plan.pdf", new TextEncoder().encode("Synthetic cached PDF fixture").buffer);
  }
  return { database, server, hubLinks, dependencies, payload, originalEnvelope, row, sent, relayed, value, bucket };
}

test("open public-plan dispatch creates a customer hub without adding its capability to the shared envelope or relay", async t => {
  const f = await hubDeliveryFixture(t);
  await f.server.dispatchCustomer(f.row(), f.payload, f.dependencies);
  await f.server.dispatchInternalRelay(f.row(), f.payload, f.dependencies);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].to, ["jamie@example.test"]);
  const url = f.sent[0].text.match(/https:\/\/ausenergyassessments\.com\/customer-hub\/[^\s]+/)?.[0];
  assert.ok(url, "customer email must contain its private hub link");
  assert.ok(f.sent[0].html.includes(url));
  assert.equal(f.sent[0].attachments.length, 1);
  const token = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  assert.equal((await f.hubLinks.authoriseCustomerHub(f.dependencies.db, token)).opportunity_id, "opportunity-1");
  assert.deepEqual(f.payload.envelope, f.originalEnvelope);
  assert.equal(f.relayed.length, 1);
  const relay = JSON.parse(Buffer.from(f.relayed[0].payload, "base64url").toString("utf8"));
  assert.deepEqual(relay, deliveryPayload.internalRelayPayload(f.originalEnvelope));
  assert.doesNotMatch(JSON.stringify(relay), /customer-hub|customer PDF input/);
  assert.equal(JSON.stringify(relay).includes(token), false);
  assert.equal(f.row().customer_status, "sent");
  assert.equal(f.row().relay_status, "sent");
});

test("AEA-only and mixed draft public plans still send their PDF without creating a hub", async t => {
  for (const services of [["assessment"], ["solar", "assessment"]]) {
    const f = await hubDeliveryFixture(t, { status: "draft", services });
    await f.server.dispatchCustomer(f.row(), f.payload, f.dependencies);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0].to, ["jamie@example.test"]);
    assert.equal(f.sent[0].attachments.length, 1);
    assert.doesNotMatch(f.sent[0].text + f.sent[0].html, /customer-hub|private project/);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM customer_quote_hubs").get().n, 0);
    assert.equal(f.row().customer_status, "sent");
    assert.deepEqual(f.payload.envelope, f.originalEnvelope);
  }
});

test("production quick-receipt hook creates a hub only for eligible open enquiries", async t => {
  for (const [status, services] of [["open", ["solar"]], ["draft", ["assessment"]], ["draft", ["solar", "assessment"]]]) {
    const f = await hubDeliveryFixture(t, { status, services, quick: true });
    await f.server.enqueueQuickUpgradeReceiptDelivery({ opportunityId: "opportunity-1", reference: f.value.sourceReference,
      fingerprint: f.value.submissionFingerprint }, f.dependencies);
    await quickDelivery.dispatchQuickUpgradeReceipt(f.row(), f.dependencies);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0].to, ["jamie@example.test"]);
    assert.equal(f.sent[0].text.includes("/customer-hub/"), status === "open");
    assert.equal(f.sent[0].html.includes("/customer-hub/"), status === "open");
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM customer_quote_hubs").get().n, status === "open" ? 1 : 0);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM public_plan_internal_relay_deliveries").get().n, 0);
    assert.equal(f.row().customer_status, "sent");
  }
});

test("one source reference durably creates one intake and both independent outboxes", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const first = await persistPublicPlanDeliveryIntake(db, bucket, record());
  const retry = await persistPublicPlanDeliveryIntake(db, bucket, record({
    intakeId: "intake-retry",
    customerDeliveryId: "customer-retry",
    relayDeliveryId: "relay-retry",
  }));
  assert.deepEqual(first, { id: "intake-1", status: "pending" });
  assert.deepEqual(retry, first);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_lead_intakes").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_customer_email_deliveries").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_internal_relay_deliveries").get().count, 1);
  assert.equal(bucket.objects.size, 1);
});

test("an incomplete canonical intake is repaired without duplicate rows", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  database.prepare(`INSERT INTO public_plan_lead_intakes
    (id, source_reference, submission_fingerprint, payload_object_key, status, opportunity_id,
     attempts, next_attempt_at, last_attempt_at, completed_at, failed_at, last_error,
     payload_deleted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', '', 0, '', '', '', '', '', '', ?, ?)`)
    .run(value.intakeId, value.sourceReference, value.submissionFingerprint, value.payloadObjectKey, value.now, value.now);

  const repaired = await persistPublicPlanDeliveryIntake(db, bucket, value);
  assert.deepEqual(repaired, { id: value.intakeId, status: "pending" });
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_lead_intakes").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_customer_email_deliveries").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_internal_relay_deliveries").get().count, 1);
});

test("any existing source fingerprint mismatch fails before writing a private object", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  database.prepare(`INSERT INTO public_plan_lead_intakes
    (id, source_reference, submission_fingerprint, payload_object_key, status, opportunity_id,
     attempts, next_attempt_at, last_attempt_at, completed_at, failed_at, last_error,
     payload_deleted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', '', 0, '', '', '', '', '', '', ?, ?)`)
    .run(value.intakeId, value.sourceReference, "d".repeat(64), "canonical/private.json", value.now, value.now);
  await assert.rejects(
    () => persistPublicPlanDeliveryIntake(db, bucket, value),
    (error) => error.message === "PUBLIC_PLAN_INTAKE_FINGERPRINT_MISMATCH" && error.status === 409,
  );
  assert.equal(bucket.objects.size, 0);
});

test("a post-commit D1 transport error resolves from verified canonical rows and restores the private payload", async () => {
  const database = sourceDatabase();
  const base = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  const postCommitError = {
    prepare: (sql) => base.prepare(sql),
    async batch(statements) {
      await base.batch(statements);
      throw new Error("ambiguous D1 batch failure");
    },
  };
  assert.deepEqual(
    await persistPublicPlanDeliveryIntake(postCommitError, bucket, value),
    { id: value.intakeId, status: "pending" },
  );
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_lead_intakes").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_customer_email_deliveries").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_internal_relay_deliveries").get().count, 1);
});

test("an ambiguous post-commit recovery read rejects without deletion and an identical retry repairs it", async () => {
  const database = sourceDatabase();
  const base = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  let canonicalReads = 0;
  const ambiguous = {
    prepare(sql) {
      const statement = base.prepare(sql);
      if (sql.includes("WHERE intake.source_reference = ? LIMIT 1")) {
        const originalBind = statement.bind;
        statement.bind = (...bindings) => {
          const bound = originalBind(...bindings);
          const originalFirst = bound.first;
          bound.first = async () => {
            canonicalReads += 1;
            if (canonicalReads > 1) throw new Error("ambiguous D1 recovery read");
            return originalFirst();
          };
          return bound;
        };
      }
      return statement;
    },
    async batch(statements) {
      await base.batch(statements);
      throw new Error("ambiguous D1 batch failure");
    },
  };
  await assert.rejects(
    () => persistPublicPlanDeliveryIntake(ambiguous, bucket, value),
    /ambiguous D1 batch failure/,
  );
  assert.equal(bucket.objects.has(value.payloadObjectKey), false);
  assert.equal(bucket.deleteCalls, 0);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_lead_intakes").get().count, 1);
  assert.deepEqual(await persistPublicPlanDeliveryIntake(base, bucket, value), {
    id: value.intakeId,
    status: "pending",
  });
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_customer_email_deliveries").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_internal_relay_deliveries").get().count, 1);
});

test("public plan delivery retries daily indefinitely and uses response, health and minute triggers", () => {
  const seventh = publicPlanDeliveryRetryAt(7, Date.parse("2026-08-12T00:00:00.000Z"));
  const fiftieth = publicPlanDeliveryRetryAt(50, Date.parse("2026-08-12T00:00:00.000Z"));
  assert.equal(seventh, "2026-08-13T00:00:00.000Z");
  assert.equal(fiftieth, seventh);
  assert.equal(shouldDrainPublicPlanDeliveryBacklog({ method: "POST", pathname: "/api/leads", responseOk: true }), true);
  assert.equal(shouldDrainPublicPlanDeliveryBacklog({ method: "GET", pathname: "/api/health", responseOk: true }), true);
  const response = new Response("ok", { headers: { "X-AEA-Public-Plan-Delivery-Dispatch": "intake-1" } });
  const dispatch = takePublicPlanDeliveryDispatch(response);
  assert.equal(dispatch.intakeId, "intake-1");
  assert.equal(dispatch.response.headers.has("X-AEA-Public-Plan-Delivery-Dispatch"), false);
  const worker = fs.readFileSync("worker/index.ts", "utf8");
  assert.match(worker, /drainPublicPlanDeliveries/);
  assert.match(worker, /NOTIFICATION_DELIVERY_CRON/);
  assert.match(worker, /drainOpportunityNotificationDeliveriesForOpportunity/);
});

test("Resend API and sender credentials submit once even when callback observability is unavailable", async () => {
  const runtime = {
    RESEND_API_KEY: "re_1234567890123456",
    RESEND_FROM_EMAIL: "AEA <plans@example.com>",
  };
  const configuration = serviceReminderProviderConfiguration(runtime);
  assert.equal(configuration.email.configured, true);
  assert.equal(configuration.email.callbacks, false);
  let calls = 0;
  let idempotencyKey = "";
  const result = await sendServiceReminderProviderMessage({
    channel: "email",
    recipient: "customer@example.com",
    subject: "Your plan",
    body: "Your plan is attached.",
    idempotencyKey: "public-plan-stable-key",
    callbackUrl: "https://compare.example/resend",
    messageType: "public_plan_customer",
  }, {
    runtime,
    fetchImpl: async (_url, init) => {
      calls += 1;
      idempotencyKey = String(init?.headers?.["Idempotency-Key"] || "");
      return Response.json({ id: "provider-message-1" });
    },
  });
  assert.equal(calls, 1);
  assert.equal(idempotencyKey, "public-plan-stable-key");
  assert.equal(result.providerMessageId, "provider-message-1");
  const server = fs.readFileSync("src/lib/public-plan-delivery-server.ts", "utf8");
  assert.doesNotMatch(server, /!provider\.email\.configured\s*\|\|\s*!provider\.email\.callbacks/);
});

test("public lead acceptance stays free of PDF and provider work and verifies upload-ready records before 200", () => {
  const handler = fs.readFileSync("src/lib/lead-route-handler.mjs", "utf8");
  const route = fs.readFileSync("src/app/api/leads/route.js", "utf8");
  assert.doesNotMatch(route, /createPublicPlanCustomerPdfBundle|loadCustomerPlanPdfFonts/);
  assert.match(handler, /enqueuePublicPlanDelivery/);
  assert.match(handler, /createOpportunityFromLead/);
  assert.match(handler, /confirmPublicPlanIntakeOpportunity/);
  assert.match(handler, /expectedQuotePreparation/);
  assert.match(handler, /planEmailStatus: \["sent", "delivered"\]/);
  const deliveryServer = fs.readFileSync("src/lib/public-plan-delivery-server.ts", "utf8");
  assert.match(deliveryServer, /setTimeout\(\(\) => controller\.abort\(\), 15_000\)/);
});

test("intake opportunity confirmation requires the active contact and selected quote preparation", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  await persistPublicPlanDeliveryIntake(db, bucket, value);
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY, source_reference text NOT NULL, status text NOT NULL,
    expires_at text NOT NULL, postcode text NOT NULL, state text NOT NULL,
    created_by_uid text NOT NULL, service_categories text NOT NULL DEFAULT '["solar"]'
  );
  CREATE TABLE public_trade_lead_contact_releases (
    id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL, status text NOT NULL,
    notice_version text NOT NULL, consent_purpose text NOT NULL, disclosed_fields text NOT NULL,
    granted_at text NOT NULL, withdrawn_at text NOT NULL, postcode text NOT NULL,
    customer_address_state text NOT NULL, customer_email text NOT NULL
  );
  CREATE TABLE public_trade_lead_quote_preparations (
    id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL, status text NOT NULL,
    version text NOT NULL, notice_version text NOT NULL, consent_purpose text NOT NULL,
    granted_at text NOT NULL, withdrawn_at text NOT NULL
  );`);
  database.prepare("INSERT INTO trade_opportunities VALUES (?, ?, 'open', ?, '3000', 'VIC', 'lead-intake', '[\"solar\"]')")
    .run("opportunity-1", value.sourceReference, "2026-09-12T00:00:00.000Z");
  database.prepare("INSERT INTO public_trade_lead_contact_releases VALUES (?, ?, ?, 'active', ?, ?, ?, ?, '', '3000', 'VIC', 'customer@example.com')")
    .run("contact-1", "opportunity-1", value.sourceReference,
      PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE,
      JSON.stringify(["customer_email", "postcode", "service_categories"]), value.now);
  const consent = {
    contactNoticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    contactConsentPurpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    quotePreparationVersion: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    quoteNoticeVersion: PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    quoteConsentPurpose: PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  };
  await assert.rejects(
    () => confirmPublicPlanIntakeOpportunityWrite(db, {
      intakeId: value.intakeId,
      opportunityId: "opportunity-1",
      expectedQuotePreparation: true,
      now: value.now,
      ...consent,
    }),
    /PUBLIC_PLAN_QUOTE_PREPARATION_INCOMPLETE/,
  );
  database.prepare("INSERT INTO public_trade_lead_quote_preparations VALUES (?, ?, ?, 'active', ?, ?, ?, ?, '')")
    .run("preparation-1", "opportunity-1", value.sourceReference,
      PUBLIC_PLAN_QUOTE_PREPARATION_VERSION, PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE, value.now);
  assert.deepEqual(await confirmPublicPlanIntakeOpportunityWrite(db, {
    intakeId: value.intakeId,
    opportunityId: "opportunity-1",
    expectedQuotePreparation: true,
    now: value.now,
    ...consent,
  }), { opportunityId: "opportunity-1" });
  assert.equal(database.prepare("SELECT opportunity_id FROM public_plan_lead_intakes").get().opportunity_id, "opportunity-1");
  const confirm = () => confirmPublicPlanIntakeOpportunityWrite(db, {
    intakeId: value.intakeId, opportunityId: "opportunity-1", expectedQuotePreparation: true,
    now: value.now, ...consent,
  });
  for (const [status, services, allowed] of [
    ["draft", '["assessment"]', true], ["draft", '["solar","assessment"]', true],
    ["draft", '["solar"]', false], ["draft", '["assessment",null]', false],
    ["draft", '["assessment",""]', false], ["draft", '[]', false],
    ["draft", '{}', false], ["draft", 'broken', false],
    ["closed", '["assessment"]', false], ["paused", '["assessment"]', false],
  ]) {
    database.exec("UPDATE public_plan_lead_intakes SET opportunity_id = ''");
    database.prepare("UPDATE trade_opportunities SET status = ?, service_categories = ?").run(status, services);
    if (allowed) assert.deepEqual(await confirm(), { opportunityId: "opportunity-1" });
    else await assert.rejects(confirm, /PUBLIC_PLAN_OPPORTUNITY_INTAKE_INCOMPLETE/);
    assert.equal(database.prepare("SELECT opportunity_id FROM public_plan_lead_intakes").get().opportunity_id,
      allowed ? "opportunity-1" : "", `${status}: ${services}`);
    assert.equal(database.prepare("SELECT status FROM trade_opportunities").get().status, status);
  }
  database.exec("UPDATE trade_opportunities SET status = 'draft', service_categories = '[\"assessment\"]'");
  for (const [mutation, restore, error] of [
    ["UPDATE public_trade_lead_contact_releases SET status = 'withdrawn'",
      "UPDATE public_trade_lead_contact_releases SET status = 'active'", /PUBLIC_PLAN_OPPORTUNITY_INTAKE_INCOMPLETE/],
    ["UPDATE public_trade_lead_contact_releases SET withdrawn_at = '2026-08-12T00:01:00.000Z'",
      "UPDATE public_trade_lead_contact_releases SET withdrawn_at = ''", /PUBLIC_PLAN_OPPORTUNITY_INTAKE_INCOMPLETE/],
    ["UPDATE public_trade_lead_quote_preparations SET withdrawn_at = '2026-08-12T00:01:00.000Z'",
      "UPDATE public_trade_lead_quote_preparations SET withdrawn_at = ''", /PUBLIC_PLAN_QUOTE_PREPARATION_INCOMPLETE/],
    ["UPDATE trade_opportunities SET expires_at = '2020-01-01T00:00:00.000Z'",
      "UPDATE trade_opportunities SET expires_at = '2026-09-12T00:00:00.000Z'", /PUBLIC_PLAN_OPPORTUNITY_INTAKE_INCOMPLETE/],
  ]) {
    database.exec(mutation);
    await assert.rejects(confirm, error);
    database.exec(restore);
    assert.equal(database.prepare("SELECT opportunity_id FROM public_plan_lead_intakes").get().opportunity_id, "");
  }
  assert.deepEqual(await confirm(), { opportunityId: "opportunity-1" });
});

test("delivered PDF and intake cleanup retry until the private objects are verifiably absent", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  await persistPublicPlanDeliveryIntake(db, bucket, value);
  const pdfKey = "public-plan/customer-email/test.pdf";
  bucket.objects.set(pdfKey, new Uint8Array([1, 2, 3]).buffer);
  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'delivered', provider_status = 'email.delivered', attachment_object_key = ?,
      sent_at = ?, delivered_at = ? WHERE intake_id = ?`)
    .run(pdfKey, value.now, value.now, value.intakeId);
  database.prepare("UPDATE public_plan_internal_relay_deliveries SET status = 'sent' WHERE intake_id = ?")
    .run(value.intakeId);
  database.prepare("UPDATE public_plan_lead_intakes SET opportunity_id = 'opportunity-1' WHERE id = ?")
    .run(value.intakeId);
  const originalDelete = bucket.delete;
  let failuresRemaining = 2;
  bucket.delete = async (key) => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error("simulated cleanup outage");
    }
    return originalDelete(key);
  };

  await cleanupPublicPlanDeliveryObjectsWrite(db, bucket);
  let customer = database.prepare("SELECT * FROM public_plan_customer_email_deliveries").get();
  let intake = database.prepare("SELECT * FROM public_plan_lead_intakes").get();
  assert.equal(customer.attachment_deleted_at, "");
  assert.notEqual(customer.attachment_cleanup_next_attempt_at, "");
  assert.equal(intake.payload_deleted_at, "");
  assert.equal(bucket.objects.has(pdfKey), true);
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);

  database.prepare("UPDATE public_plan_customer_email_deliveries SET attachment_cleanup_next_attempt_at = ''").run();
  database.prepare("UPDATE public_plan_lead_intakes SET next_attempt_at = ''").run();
  await cleanupPublicPlanDeliveryObjectsWrite(db, bucket);
  customer = database.prepare("SELECT * FROM public_plan_customer_email_deliveries").get();
  intake = database.prepare("SELECT * FROM public_plan_lead_intakes").get();
  assert.notEqual(customer.attachment_deleted_at, "");
  assert.notEqual(intake.payload_deleted_at, "");
  assert.equal(intake.status, "completed");
  assert.equal(bucket.objects.has(pdfKey), false);
  assert.equal(bucket.objects.has(value.payloadObjectKey), false);
});

test("provider acceptance retains intake for retry, and regenerated PDF clears stale cleanup markers", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  await persistPublicPlanDeliveryIntake(db, bucket, value);
  const firstPdf = "public-plan/customer-email/first.pdf";
  bucket.objects.set(firstPdf, new Uint8Array([1]).buffer);
  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'sent', provider_status = 'sent_callback_pending', attachment_object_key = ?,
      attachment_deleted_at = ?, sent_at = ? WHERE intake_id = ?`)
    .run(firstPdf, value.now, value.now, value.intakeId);
  database.prepare("UPDATE public_plan_internal_relay_deliveries SET status = 'sent' WHERE intake_id = ?")
    .run(value.intakeId);
  database.prepare("UPDATE public_plan_lead_intakes SET opportunity_id = 'opportunity-1' WHERE id = ?")
    .run(value.intakeId);

  const acceptedCleanup = await cleanupPublicPlanDeliveryObjectsWrite(db, bucket);
  assert.equal(acceptedCleanup.payloadsDeleted, 0);
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);

  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'provider_failed', provider_status = 'email.failed', next_attempt_at = ?,
      idempotency_key = ? WHERE intake_id = ?`)
    .run(value.now, "d".repeat(64), value.intakeId);
  const secondPdf = "public-plan/customer-email/second.pdf";
  bucket.objects.set(secondPdf, new Uint8Array([2]).buffer);
  await recordPublicPlanCustomerPdfWrite(db, {
    deliveryId: value.customerDeliveryId,
    objectKey: secondPdf,
    filename: "plan.pdf",
    sizeBytes: 1,
    sha256: "e".repeat(64),
    now: value.now,
  });
  let customer = database.prepare("SELECT * FROM public_plan_customer_email_deliveries").get();
  assert.equal(customer.attachment_deleted_at, "");
  assert.equal(customer.attachment_cleanup_next_attempt_at, "");

  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'sent', provider_status = 'sent_callback_pending', sent_at = ? WHERE id = ?`)
    .run(value.now, value.customerDeliveryId);
  bucket.delete = async () => { throw new Error("second PDF cleanup failed"); };
  await cleanupPublicPlanDeliveryObjectsWrite(db, bucket);
  customer = database.prepare("SELECT * FROM public_plan_customer_email_deliveries").get();
  assert.equal(customer.attachment_deleted_at, "");
  assert.notEqual(customer.attachment_cleanup_next_attempt_at, "");
  assert.equal(bucket.objects.has(secondPdf), true);
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);
});

test("callback-pending acceptance retains retry material beyond thirty days for a late provider failure", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  await persistPublicPlanDeliveryIntake(db, bucket, value);
  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'sent', provider_status = 'sent_callback_pending', sent_at = '2026-06-01T00:00:00.000Z',
      attachment_object_key = 'public-plan/customer-email/old.pdf', attachment_deleted_at = '2026-06-01T00:01:00.000Z'
    WHERE intake_id = ?`).run(value.intakeId);
  database.prepare("UPDATE public_plan_internal_relay_deliveries SET status = 'sent' WHERE intake_id = ?")
    .run(value.intakeId);
  database.prepare("UPDATE public_plan_lead_intakes SET opportunity_id = 'opportunity-1' WHERE id = ?")
    .run(value.intakeId);
  const cleanup = await cleanupPublicPlanDeliveryObjectsWrite(db, bucket, {
    now: () => "2026-08-12T00:00:00.000Z",
  });
  assert.equal(cleanup.payloadsDeleted, 0);
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);

  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'provider_failed', provider_status = 'email.failed', next_attempt_at = '2026-08-12T00:00:00.000Z',
      idempotency_key = ? WHERE intake_id = ?`).run("f".repeat(64), value.intakeId);
  const replacementPdf = "public-plan/customer-email/late-retry.pdf";
  bucket.objects.set(replacementPdf, new Uint8Array([3]).buffer);
  await recordPublicPlanCustomerPdfWrite(db, {
    deliveryId: value.customerDeliveryId,
    objectKey: replacementPdf,
    filename: "plan.pdf",
    sizeBytes: 1,
    sha256: "1".repeat(64),
    now: "2026-08-12T00:00:01.000Z",
  });
  assert.equal(database.prepare("SELECT status FROM public_plan_customer_email_deliveries").get().status, "provider_failed");
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);
  assert.equal(bucket.objects.has(replacementPdf), true);
});

test("callback-unavailable delivery retains intake through day six and cleans it after day seven", async () => {
  const database = sourceDatabase();
  const db = databaseAdapter(database);
  const bucket = memoryBucket();
  const value = record();
  await persistPublicPlanDeliveryIntake(db, bucket, value);
  database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'sent', provider_status = 'sent_callback_unavailable',
      sent_at = '2026-08-01T00:00:00.000Z' WHERE intake_id = ?`).run(value.intakeId);
  database.prepare("UPDATE public_plan_internal_relay_deliveries SET status = 'sent' WHERE intake_id = ?")
    .run(value.intakeId);
  database.prepare("UPDATE public_plan_lead_intakes SET opportunity_id = 'opportunity-1' WHERE id = ?")
    .run(value.intakeId);

  const beforeBoundary = await cleanupPublicPlanDeliveryObjectsWrite(db, bucket, {
    now: () => "2026-08-07T23:59:59.999Z",
  });
  assert.equal(beforeBoundary.payloadsDeleted, 0);
  assert.equal(bucket.objects.has(value.payloadObjectKey), true);

  const atBoundary = await cleanupPublicPlanDeliveryObjectsWrite(db, bucket, {
    now: () => "2026-08-08T00:00:00.000Z",
  });
  assert.equal(atBoundary.payloadsDeleted, 1);
  assert.equal(bucket.objects.has(value.payloadObjectKey), false);
  const intake = database.prepare("SELECT status, payload_deleted_at FROM public_plan_lead_intakes").get();
  assert.equal(intake.status, "completed");
  assert.equal(intake.payload_deleted_at, "2026-08-08T00:00:00.000Z");
});
