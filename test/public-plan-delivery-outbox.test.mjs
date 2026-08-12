import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  confirmPublicPlanIntakeOpportunityWrite,
  persistPublicPlanDeliveryIntake,
} from "../src/lib/public-plan-intake-write.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
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
      return database.prepare(sql).run(...initialBindings);
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
    created_by_uid text NOT NULL
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
  database.prepare("INSERT INTO trade_opportunities VALUES (?, ?, 'open', ?, '3000', 'VIC', 'lead-intake')")
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
