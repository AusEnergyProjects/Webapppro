import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { activityConsumerDocuments } from "../src/lib/trade-activity-forms-library.ts";
import { renderCreditexConsumerRightsPdf } from "../src/lib/trade-activity-forms-pdf.ts";
import {
  reminderProviderFailureOutcome,
  sendServiceReminderProviderMessage,
} from "../src/lib/service-reminder-delivery.ts";
import * as receipt from "../src/lib/scheduled-activity-customer-document-receipt.ts";

const source = fs.readFileSync(
  new URL("../src/lib/scheduled-activity-customer-documents-server.ts", import.meta.url),
  "utf8",
);
const deliveryMigration = fs.readFileSync(
  new URL("../drizzle/0173_trade_activity_customer_document_delivery.sql", import.meta.url),
  "utf8",
);

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database, { failAcceptanceBatch = false } = {}) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
      if (failAcceptanceBatch && statements.some((statement) => statement.sql.includes("status = 'provider_accepted'"))) {
        throw new Error("simulated acceptance persistence failure");
      }
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function deliveryDatabase(options) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id TEXT PRIMARY KEY NOT NULL,
      firebase_uid TEXT NOT NULL,
      work_number TEXT NOT NULL,
      record_status TEXT NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_member_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id TEXT PRIMARY KEY NOT NULL,
      firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id TEXT PRIMARY KEY NOT NULL,
      firebase_uid TEXT NOT NULL,
      customer_type TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      email TEXT NOT NULL,
      record_status TEXT NOT NULL
    );
    CREATE TABLE trade_accounts (
      firebase_uid TEXT PRIMARY KEY NOT NULL,
      business_name TEXT NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  database.exec(deliveryMigration);
  database.exec(`
    INSERT INTO trade_work_orders VALUES ('job-1', 'owner-1', 'TLJ-100', 'active');
    INSERT INTO trade_crm_appointments VALUES
      ('appointment-1', 'job-1', 'owner-1', 'scheduled', 'member-1', '2026-09-10T10:00:00.000Z', '2026-09-01T00:00:00.000Z');
    INSERT INTO trade_crm_job_details VALUES ('job-1', 'owner-1', 'customer-1');
    INSERT INTO trade_crm_customers VALUES
      ('customer-1', 'owner-1', 'residential', 'Pat', 'Customer', '', 'pat@example.com', 'active');
    INSERT INTO trade_accounts VALUES ('owner-1', 'Example <Trade>');
  `);
  return { database, db: testD1(database, options) };
}

function loadModule(imports) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`);
    return imports[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture({ validPdf = true, providerFailure = false, providerIndeterminateOnce = false, deferProvider = false, failAcceptanceBatch = false } = {}) {
  const { database, db } = deliveryDatabase({ failAcceptanceBatch });
  const messages = [];
  let releaseProvider;
  const providerGate = deferProvider
    ? new Promise((resolve) => { releaseProvider = resolve; })
    : Promise.resolve();
  const pdf = new TextEncoder().encode(validPdf ? "%PDF-1.7\ncustomer-document" : "not-a-pdf");
  const server = loadModule({
    "../../db": { getD1: () => db },
    "./trade-activity-forms-library.ts": { activityConsumerDocuments },
    "./trade-activity-forms-server.ts": {
      readActivityConsumerDocument: async () => ({
        bytes: pdf,
        fileName: "Creditex Statement of Rights.pdf",
      }),
    },
    "./scheduled-activity-customer-document-receipt.ts": receipt,
    "./service-reminder-delivery": {
      serviceReminderProviderConfiguration: () => ({ email: { configured: true } }),
      ReminderProviderDeliveryError: class ReminderProviderDeliveryError extends Error {
        constructor(outcome, message) { super(message); this.outcome = outcome; this.providerOutcome = outcome; }
      },
      reminderProviderFailureOutcome: (error) => error?.providerOutcome === "indeterminate" ? "indeterminate" : "definite_failure",
      sendServiceReminderProviderMessage: async (message) => {
        messages.push(message);
        await providerGate;
        if (providerFailure) {
          const error = new Error("provider rejected");
          error.providerOutcome = "definite_failure";
          throw error;
        }
        if (providerIndeterminateOnce && messages.length === 1) {
          const error = new Error("connection closed before response");
          error.providerOutcome = "indeterminate";
          throw error;
        }
        return {
          provider: "resend",
          providerMessageId: `email-${messages.length}`,
          providerStatus: "sent",
        };
      },
    },
  });
  const fetchImpl = async () => new Response(pdf, {
    status: 200,
    headers: { "Content-Type": "application/pdf" },
  });
  return {
    database,
    db,
    server,
    messages,
    fetchImpl,
    releaseProvider: () => releaseProvider?.(),
  };
}

const residentialActivity = {
  activityTemplateId: "veu-6",
  variantId: "veu_6_residential",
};

test("Resend classifies an explicit HTTP rejection separately from an indeterminate transport outcome", async () => {
  const message = {
    channel: "email",
    recipient: "pat@example.com",
    subject: "Required documents",
    body: "Attached documents",
    idempotencyKey: "a".repeat(64),
    callbackUrl: "https://ausenergyassessments.com/api/service-reminder-provider-events/resend",
  };
  const runtime = {
    RESEND_API_KEY: "re_test_credential",
    RESEND_FROM_EMAIL: "TLink <noreply@example.com>",
  };
  assert.equal(reminderProviderFailureOutcome(new Error("local validation failed")), "definite_failure");
  await assert.rejects(
    () => sendServiceReminderProviderMessage(message, {
      runtime,
      fetchImpl: async () => new Response("{}", { status: 422, headers: { "Content-Type": "application/json" } }),
    }),
    (error) => reminderProviderFailureOutcome(error) === "definite_failure",
  );
  for (const status of [408, 409, 500, 503]) {
    await assert.rejects(
      () => sendServiceReminderProviderMessage(message, {
        runtime,
        fetchImpl: async () => new Response("{}", { status, headers: { "Content-Type": "application/json" } }),
      }),
      (error) => reminderProviderFailureOutcome(error) === "indeterminate",
    );
  }
  await assert.rejects(
    () => sendServiceReminderProviderMessage(message, {
      runtime,
      fetchImpl: async () => { throw new Error("connection reset"); },
    }),
    (error) => reminderProviderFailureOutcome(error) === "indeterminate",
  );
  await assert.rejects(
    () => sendServiceReminderProviderMessage(message, {
      runtime,
      fetchImpl: async () => new Response("{}", { status: 202, headers: { "Content-Type": "application/json" } }),
    }),
    (error) => reminderProviderFailureOutcome(error) === "indeterminate",
  );
});

test("VEU Activities 1, 3 and 6 booking documents follow the premises variant", () => {
  for (const [activity, activityFactSheet] of [
    ["1", "veu-water-heating-consumer-factsheet"],
    ["3", "veu-water-heating-consumer-factsheet"],
    ["6", "veu-heating-cooling-consumer-factsheet"],
  ]) {
    const residential = activityConsumerDocuments(`veu-${activity}`, `veu_${activity}_residential`);
    assert.deepEqual(residential.map((document) => document.key), [
      "veu-consumer-factsheet",
      "creditex-veu-statement-of-rights-v1",
      activityFactSheet,
    ]);
    const business = activityConsumerDocuments(`veu-${activity}`, `veu_${activity}_business`);
    assert.deepEqual(business.map((document) => document.key), [
      "veu-consumer-factsheet",
      "creditex-veu-statement-of-rights-v1",
    ]);
    assert.ok(residential.every((document) => document.requiredTiming === "booking_before_customer_agreement"));
    assert.match(residential[1].title, /^Creditex Statement of Rights/);
  }
});

test("SRES and PDRS activities without an official booking fact sheet do not fabricate one", () => {
  assert.deepEqual(activityConsumerDocuments("sres-pv"), []);
  assert.deepEqual(activityConsumerDocuments("nsw-pdrs-hvac2"), []);
});

test("booking persists the exact Resend binding, variant, hashes and immutable receipt", async () => {
  const { server, database, messages, fetchImpl } = fixture();
  const result = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity, residentialActivity],
    fetchImpl,
  });
  assert.equal(result.status, "provider_accepted");
  assert.equal(result.canRetry, false);
  assert.equal(result.documentIds.length, 3);
  assert.equal(result.documentSha256Set.length, 3);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].attachments.length, 3);
  assert.match(messages[0].html, /Example &lt;Trade&gt;/);
  assert.doesNotMatch(messages[0].html, /Example <Trade>/);
  assert.match(messages[0].idempotencyKey, /^[0-9a-f]{64}$/);

  const delivery = database.prepare(`SELECT * FROM trade_activity_customer_document_deliveries`).get();
  assert.equal(delivery.provider, "resend");
  assert.equal(delivery.provider_message_id, "email-1");
  assert.equal(delivery.status, "provider_accepted");
  assert.equal(delivery.delivery_generation, 1);
  assert.deepEqual(JSON.parse(delivery.activity_bindings), [residentialActivity]);
  assert.deepEqual(JSON.parse(delivery.document_ids), result.documentIds);
  assert.deepEqual(JSON.parse(delivery.document_sha256_set), result.documentSha256Set);

  const event = database.prepare(`SELECT * FROM trade_work_order_events
    WHERE event_type = 'customer_documents_provider_accepted'`).get();
  const parsed = receipt.parseScheduledActivityCustomerDocumentReceipt(event.summary);
  assert.equal(parsed.deliveryId, delivery.id);
  assert.equal(parsed.providerMessageId, "email-1");
  assert.equal(parsed.recipient, "pat@example.com");
  assert.equal(parsed.appointmentId, "appointment-1");
  assert.deepEqual(parsed.documentIds, result.documentIds);
  assert.deepEqual(parsed.documentSha256Set, result.documentSha256Set);

  const replay = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  assert.equal(replay.status, "provider_accepted");
  assert.equal(replay.acceptedAt, result.acceptedAt);
  assert.equal(messages.length, 1, "an exact accepted pack must not be emailed twice");
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_activity_customer_document_deliveries`).get().count, 1);
});

test("a queued delivery is claimed once before contacting Resend", async () => {
  const { server, database, messages, fetchImpl, releaseProvider } = fixture({ deferProvider: true });
  const firstPromise = server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  for (let attempt = 0; attempt < 50 && messages.length === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(messages.length, 1);
  assert.equal(database.prepare(`SELECT status FROM trade_activity_customer_document_deliveries`).get().status, "sending");

  const concurrent = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  assert.equal(concurrent.status, "unavailable");
  assert.equal(concurrent.canRetry, true);
  assert.equal(messages.length, 1, "only the CAS claimant may contact Resend");
  releaseProvider();
  assert.equal((await firstPromise).status, "provider_accepted");
});

test("a complaint recorded while documents load suppresses the queued request before provider dispatch", async () => {
  const { server, database, messages } = fixture();
  const recipientHash = createHash("sha256").update("pat@example.com").digest("hex");
  const initialAt = "2026-09-08T00:00:00.000Z";
  database.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, work_order_id, appointment_id, firebase_uid, recipient_email_sha256,
     activity_bindings, document_ids, document_sha256_set, pack_sha256,
     delivery_generation, retry_of_delivery_id, provider, provider_message_id,
     provider_status, idempotency_key, status, accepted_at, sent_at,
     delivered_at, failed_at, last_error, created_at, updated_at)
    VALUES ('complaint-source', 'job-1', 'appointment-1', 'owner-1', ?, ?, '["legacy-document"]', ?, ?,
      1, '', 'resend', 'provider-source', 'sent', 'legacy-key', 'provider_accepted', ?, ?, '', '', '', ?, ?)`)
    .run(
      recipientHash,
      JSON.stringify([residentialActivity]),
      JSON.stringify(["a".repeat(64)]),
      "b".repeat(64),
      initialAt,
      initialAt,
      initialAt,
      initialAt,
    );
  let callbackApplied = false;
  const pdf = new TextEncoder().encode("%PDF-1.7\ncustomer-document");
  const fetchImpl = async () => {
    if (!callbackApplied) {
      callbackApplied = true;
      const complainedAt = new Date().toISOString();
      database.prepare(`UPDATE trade_activity_customer_document_deliveries
        SET status = 'complained', provider_status = 'email.complained', failed_at = ?,
          last_error = 'Recipient complaint', updated_at = ? WHERE id = 'complaint-source'`)
        .run(complainedAt, complainedAt);
    }
    return new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } });
  };

  const result = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.canRetry, false);
  assert.equal(messages.length, 0, "suppression must win before the provider request starts");
  const blocked = database.prepare(`SELECT status, provider_message_id, failed_at
    FROM trade_activity_customer_document_deliveries WHERE id != 'complaint-source'`).get();
  assert.equal(blocked.status, "suppressed");
  assert.equal(blocked.provider_message_id, "");
  assert.ok(Number.isFinite(Date.parse(blocked.failed_at)));
});

test("provider acceptance racing recipient suppression cannot issue a compliance receipt", async () => {
  const { server, database, messages, fetchImpl, releaseProvider } = fixture({ deferProvider: true });
  const pending = server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  for (let attempt = 0; attempt < 50 && messages.length === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(messages.length, 1);
  const delivery = database.prepare(`SELECT id FROM trade_activity_customer_document_deliveries`).get();
  const suppressedAt = new Date().toISOString();
  database.prepare(`UPDATE trade_activity_customer_document_deliveries
    SET status = 'suppressed', provider_status = 'email.suppressed', failed_at = ?,
      last_error = 'Provider suppression', updated_at = ? WHERE id = ?`)
    .run(suppressedAt, suppressedAt, delivery.id);
  releaseProvider();

  const result = await pending;
  assert.equal(result.status, "unavailable");
  assert.equal(result.canRetry, false);
  const stored = database.prepare(`SELECT status, provider_message_id, accepted_at, last_error
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get(delivery.id);
  assert.equal(stored.status, "suppressed");
  assert.equal(stored.provider_message_id, "email-1", "the late provider binding remains auditable");
  assert.equal(stored.accepted_at, "", "suppression cannot become an accepted compliance receipt");
  assert.match(stored.last_error, /no compliance receipt was issued/i);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_provider_accepted'`).get().count, 0);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_provider_accepted_after_suppression'`).get().count, 1);
});

test("a terminal provider outcome forces a new, linked delivery generation", async () => {
  const { server, database, messages, fetchImpl } = fixture();
  const send = () => server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  assert.equal((await send()).status, "provider_accepted");
  const first = database.prepare(`SELECT id FROM trade_activity_customer_document_deliveries`).get();
  const failedAt = new Date().toISOString();
  database.prepare(`UPDATE trade_activity_customer_document_deliveries
    SET status = 'bounced', provider_status = 'email.bounced', failed_at = ?, last_error = 'Recipient bounced', updated_at = ?
    WHERE id = ?`).run(failedAt, failedAt, first.id);

  assert.equal((await send()).status, "provider_accepted");
  assert.equal(messages.length, 2);
  const deliveries = database.prepare(`SELECT id, delivery_generation, retry_of_delivery_id, status
    FROM trade_activity_customer_document_deliveries ORDER BY delivery_generation`).all();
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].status, "bounced");
  assert.equal(deliveries[1].delivery_generation, 2);
  assert.equal(deliveries[1].retry_of_delivery_id, deliveries[0].id);
  assert.equal(deliveries[1].status, "provider_accepted");
});

for (const terminalStatus of ["complained", "suppressed"]) {
  test(`${terminalStatus} blocks scheduled documents for the same owner and email until the CRM email changes`, async () => {
    const { server, database, messages, fetchImpl } = fixture();
    const send = () => server.sendScheduledActivityCustomerDocuments({
      appointmentId: "appointment-1",
      workOrderId: "job-1",
      ownerUid: "owner-1",
      origin: "https://ausenergyassessments.com",
      activities: [residentialActivity],
      fetchImpl,
    });
    assert.equal((await send()).status, "provider_accepted");
    const first = database.prepare(`SELECT id FROM trade_activity_customer_document_deliveries`).get();
    const terminalAt = new Date().toISOString();
    database.prepare(`UPDATE trade_activity_customer_document_deliveries
      SET status = ?, provider_status = ?, failed_at = ?, last_error = 'Recipient suppression', updated_at = ?
      WHERE id = ?`).run(terminalStatus, `email.${terminalStatus}`, terminalAt, terminalAt, first.id);

    const blocked = await send();
    assert.equal(blocked.status, "unavailable");
    assert.equal(blocked.canRetry, false);
    assert.match(blocked.message, /Correct the customer's email in the CRM/);
    assert.equal(messages.length, 1, "the suppressed recipient must not be sent another message");
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_activity_customer_document_deliveries`).get().count, 1);

    database.prepare(`UPDATE trade_crm_customers SET email = 'corrected@example.com' WHERE id = 'customer-1'`).run();
    const corrected = await send();
    assert.equal(corrected.status, "provider_accepted");
    assert.equal(corrected.canRetry, false);
    assert.equal(messages.length, 2, "a corrected email address starts a separate recipient lineage");
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_activity_customer_document_deliveries`).get().count, 2);
  });
}

test("activity identity remains part of the delivery binding when two activities use the same documents", async () => {
  const { server, database, messages, fetchImpl } = fixture();
  const send = (activity) => server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [activity],
    fetchImpl,
  });
  assert.equal((await send({ activityTemplateId: "veu-1", variantId: "veu_1_business" })).status, "provider_accepted");
  assert.equal((await send({ activityTemplateId: "veu-6", variantId: "veu_6_business" })).status, "provider_accepted");
  assert.equal(messages.length, 2);
  const rows = database.prepare(`SELECT activity_bindings, document_ids, pack_sha256
    FROM trade_activity_customer_document_deliveries ORDER BY created_at, id`).all();
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].document_ids), JSON.parse(rows[1].document_ids));
  assert.notEqual(rows[0].pack_sha256, rows[1].pack_sha256);
  assert.notDeepEqual(JSON.parse(rows[0].activity_bindings), JSON.parse(rows[1].activity_bindings));
});

test("job delivery status uses the selected visible appointment and exact current activity bindings", async () => {
  const { server, database, fetchImpl } = fixture();
  database.prepare(`INSERT INTO trade_crm_appointments
    (id, work_order_id, firebase_uid, status, assignee_member_id, starts_at, created_at)
    VALUES ('appointment-2', 'job-1', 'owner-1', 'scheduled', 'member-2',
      '2026-09-09T10:00:00.000Z', '2026-09-02T00:00:00.000Z')`).run();
  const send = (appointmentId, activity) => server.sendScheduledActivityCustomerDocuments({
    appointmentId,
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [activity],
    fetchImpl,
  });
  await send("appointment-1", residentialActivity);
  const selectedDelivery = await send("appointment-2", residentialActivity);
  await send("appointment-2", { activityTemplateId: "veu-1", variantId: "veu_1_business" });

  const ownerAppointment = await server.selectedScheduledActivityCustomerDocumentAppointment({
    ownerUid: "owner-1",
    workOrderId: "job-1",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(ownerAppointment, "appointment-2", "owners see the nearest scheduled appointment");
  const assignedAppointment = await server.selectedScheduledActivityCustomerDocumentAppointment({
    ownerUid: "owner-1",
    workOrderId: "job-1",
    visibleAssigneeMemberId: "member-1",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(assignedAppointment, "appointment-1", "workers see their assigned scheduled appointment");

  const current = await server.currentScheduledActivityCustomerDocumentDelivery({
    ownerUid: "owner-1",
    workOrderId: "job-1",
    appointmentId: ownerAppointment,
    recipientEmail: "pat@example.com",
    activities: [residentialActivity],
  });
  assert.equal(current.appointment_id, "appointment-2");
  assert.equal(current.accepted_at, selectedDelivery.acceptedAt);
  assert.deepEqual(JSON.parse(database.prepare(`SELECT activity_bindings
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get(current.id).activity_bindings), [residentialActivity]);
  assert.equal(await server.currentScheduledActivityCustomerDocumentDelivery({
    ownerUid: "owner-1",
    workOrderId: "job-1",
    appointmentId: ownerAppointment,
    recipientEmail: "corrected@example.com",
    activities: [residentialActivity],
  }), null, "an earlier recipient's delivery cannot satisfy the current CRM email");
});

test("receipt parsing rejects a missing provider binding, invalid recipient, timestamp or hashes", () => {
  const hash = "a".repeat(64);
  const valid = {
    deliveryId: "delivery-1",
    providerMessageId: "provider-1",
    acceptedAt: "2026-09-08T01:02:03.000Z",
    recipient: "pat@example.com",
    appointmentId: "appointment-1",
    documentIds: ["factsheet"],
    documentSha256Set: [hash],
  };
  assert.ok(receipt.parseScheduledActivityCustomerDocumentReceipt(
    receipt.scheduledActivityCustomerDocumentReceiptSummary(valid),
  ));
  for (const malformed of [
    { ...valid, deliveryId: "" },
    { ...valid, providerMessageId: "" },
    { ...valid, acceptedAt: "not-a-date" },
    { ...valid, recipient: "not-an-email" },
    { ...valid, appointmentId: "" },
    { ...valid, documentSha256Set: [] },
  ]) {
    assert.throws(
      () => receipt.scheduledActivityCustomerDocumentReceiptSummary(malformed),
      /INVALID_ACTIVITY_CUSTOMER_DOCUMENT_RECEIPT/,
    );
  }
});

test("the generated Creditex rights handout is deterministic for provider idempotency", async () => {
  const fonts = {
    regular: fs.readFileSync(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    bold: fs.readFileSync(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)),
  };
  const first = await renderCreditexConsumerRightsPdf(fonts);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const second = await renderCreditexConsumerRightsPdf(fonts);
  assert.equal(
    createHash("sha256").update(first).digest("hex"),
    createHash("sha256").update(second).digest("hex"),
  );
});

test("provider failure leaves the committed job intact and records a retryable failed delivery", async () => {
  const { server, database, messages, fetchImpl } = fixture({ providerFailure: true });
  const result = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.canRetry, true);
  assert.equal(messages.length, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_orders WHERE id = 'job-1'`).get().count, 1);
  const delivery = database.prepare(`SELECT status, provider_status, failed_at FROM trade_activity_customer_document_deliveries`).get();
  assert.equal(delivery.status, "failed");
  assert.equal(delivery.provider_status, "send_failed");
  assert.ok(Number.isFinite(Date.parse(delivery.failed_at)));
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_email_failed'`).get().count, 1);
});

test("provider acceptance followed by receipt persistence failure keeps the idempotent delivery in progress", async () => {
  const { server, database, messages, fetchImpl } = fixture({ failAcceptanceBatch: true });
  const result = await server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.canRetry, true);
  assert.equal(messages.length, 1);
  const delivery = database.prepare(`SELECT status, provider_message_id, provider_status, failed_at
    FROM trade_activity_customer_document_deliveries`).get();
  assert.equal(delivery.status, "sending");
  assert.equal(delivery.provider_message_id, "");
  assert.equal(delivery.provider_status, "outcome_pending");
  assert.equal(delivery.failed_at, "");
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_receipt_persistence_pending'`).get().count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_email_failed'`).get().count, 0);
});

test("an indeterminate provider response reuses the same delivery generation and idempotency key", async () => {
  const { server, database, messages, fetchImpl } = fixture({ providerIndeterminateOnce: true });
  const send = () => server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });

  const pending = await send();
  assert.equal(pending.status, "unavailable");
  assert.equal(pending.canRetry, true);
  assert.match(pending.message, /outcome is not confirmed/);
  const first = database.prepare(`SELECT id, status, provider_status, delivery_generation, idempotency_key
    FROM trade_activity_customer_document_deliveries`).get();
  assert.equal(first.status, "sending");
  assert.equal(first.provider_status, "outcome_pending");
  assert.equal(first.delivery_generation, 1);
  assert.equal(messages.length, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_work_order_events
    WHERE event_type = 'customer_documents_provider_outcome_pending'`).get().count, 1);

  database.prepare(`UPDATE trade_activity_customer_document_deliveries SET created_at = ?, updated_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - (24 * 60 - 1) * 60 * 1000).toISOString(),
      new Date(Date.now() - 11 * 60 * 1000).toISOString(), first.id);
  const recovered = await send();
  assert.equal(recovered.status, "provider_accepted");
  assert.equal(messages.length, 2);
  assert.equal(messages[1].idempotencyKey, messages[0].idempotencyKey);
  const final = database.prepare(`SELECT id, status, delivery_generation, idempotency_key
    FROM trade_activity_customer_document_deliveries`).get();
  assert.equal(final.id, first.id);
  assert.equal(final.status, "provider_accepted");
  assert.equal(final.delivery_generation, 1);
  assert.equal(final.idempotency_key, first.idempotency_key);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM trade_activity_customer_document_deliveries`).get().count, 1);
});

test("an outcome pending beyond Resend's idempotency window fails closed without contacting the provider", async () => {
  const { server, database, messages, fetchImpl } = fixture({ providerIndeterminateOnce: true });
  const send = () => server.sendScheduledActivityCustomerDocuments({
    appointmentId: "appointment-1",
    workOrderId: "job-1",
    ownerUid: "owner-1",
    origin: "https://ausenergyassessments.com",
    activities: [residentialActivity],
    fetchImpl,
  });

  assert.equal((await send()).status, "unavailable");
  const delivery = database.prepare(`SELECT id, idempotency_key FROM trade_activity_customer_document_deliveries`).get();
  database.prepare(`UPDATE trade_activity_customer_document_deliveries SET created_at = ?, updated_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000).toISOString(),
      new Date().toISOString(), delivery.id);

  const expired = await send();
  assert.equal(expired.status, "unavailable");
  assert.equal(expired.canRetry, false);
  assert.match(expired.message, /more than 24 hours old/);
  assert.match(expired.message, /administrator to reconcile/);
  assert.equal(messages.length, 1, "an expired indeterminate request must not be sent after provider idempotency expires");
  const stored = database.prepare(`SELECT status, provider_status, delivery_generation, idempotency_key, last_error
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get(delivery.id);
  assert.equal(stored.status, "sending");
  assert.equal(stored.provider_status, "reconciliation_required");
  assert.equal(stored.delivery_generation, 1);
  assert.equal(stored.idempotency_key, delivery.idempotency_key);
  assert.match(stored.last_error, /administrator to reconcile/);
});

test("job creation commits before mail while delivery recovery stays in the desktop office flow", () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-crm/route.ts", import.meta.url), "utf8");
  const desktop = fs.readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");
  const desktopDelivery = fs.readFileSync(new URL("../src/components/TradeCustomerDocumentDeliveryPanel.tsx", import.meta.url), "utf8");
  const mobile = fs.readFileSync(new URL("../mobile/src/app/new-job.tsx", import.meta.url), "utf8");
  const mobileJob = fs.readFileSync(new URL("../mobile/src/app/job/[id].tsx", import.meta.url), "utf8");
  const mobileTypes = fs.readFileSync(new URL("../mobile/src/lib/types.ts", import.meta.url), "utf8");
  const syncRoute = fs.readFileSync(new URL("../src/app/api/trade-team/sync/route.ts", import.meta.url), "utf8");
  const commit = route.indexOf("await db.batch(batchStatements)");
  const send = route.indexOf("customerDocuments = await sendScheduledActivityCustomerDocuments", commit);
  const openPacks = route.indexOf("complianceWorkPacks = await autoOpenReadyPlannedComplianceWorkPacks", send);
  assert.ok(commit >= 0 && commit < send && send < openPacks);
  assert.match(route, /activities: preparedComplianceIntents\.map/);
  assert.match(route, /variantId: item\.intent\.snapshot\.activity\.variantId/);
  assert.match(route, /bookingDocumentCount = activityConsumerDocuments\(activityTemplateId, activityVariantId\)\.length/);
  assert.match(route, /calendarInvite, customerDocuments/);
  assert.match(desktop, /result\.customerDocuments\?\.requested \? result\.customerDocuments\.message/);
  assert.match(desktop, /dynamic\(\(\) => import\("\.\/TradeCustomerDocumentDeliveryPanel"\)/);
  assert.match(desktopDelivery, /action: "resend_activity_customer_documents"/);
  assert.match(desktopDelivery, /Customer document delivery/);
  assert.match(desktop, /complianceIntents\.some\(\(intent\) => intent\.bookingDocumentCount > 0\)/);
  assert.match(route, /provider_status \|\| ""\) !== "reconciliation_required"/);
  assert.match(desktopDelivery, /delivery\?\.canRetry !== false/);
  assert.match(mobile, /Alert\.alert\('Job added'/);
  assert.doesNotMatch(mobile, /documentsNeedAttention|documentsRecipientNeedsUpdate|Job added, documents need attention/);
  assert.match(mobile, /router\.replace\('\/\(tabs\)\/work'\)/);
  assert.match(syncRoute, /delivery\.id customer_document_delivery_id/);
  assert.match(syncRoute, /providerStatus !== "reconciliation_required"/);
  assert.match(syncRoute, /bookingDocumentCount:/);
  assert.match(mobileTypes, /customerDocuments\?: FieldCustomerDocumentDelivery/);
  assert.doesNotMatch(mobileJob, /Send required documents|resend_activity_customer_documents|before the customer declaration is signed/);
});

test("an assigned field worker can resend the same variant-bound pack from the job", () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-crm/route.ts", import.meta.url), "utf8");
  assert.match(route, /assignedJobActions = new Set\(\["resend_activity_customer_documents"\]\)/);
  assert.match(route, /action === "resend_activity_customer_documents"/);
  assert.match(route, /selectedScheduledActivityCustomerDocumentAppointment\(\{/);
  assert.match(source, /CASE WHEN starts_at >= \? THEN 0 ELSE 1 END ASC/);
  assert.match(source, /AND \(\? = '' OR assignee_member_id = \?\)/);
  assert.match(route, /status IN \('planned', 'case_linked'\)/);
  assert.match(route, /SELECT activity_template_id, intent_snapshot, status/);
  assert.match(route, /scheduledCustomerDocumentActivities\(activityRows\.results\)/);
  assert.match(route, /currentScheduledActivityCustomerDocumentDelivery\(\{/);
  assert.match(source, /AND recipient_email_sha256 = \? AND activity_bindings = \? AND document_ids = \?/);
  assert.match(route, /return adminJson\(\{ ok: true, customerDocuments \}\)/);
});

test("Resend callbacks bind to delivery rows and invalidate terminal outcomes", () => {
  const webhook = fs.readFileSync(
    new URL("../src/app/api/service-reminder-provider-events/resend/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(webhook, /trade_activity_customer_document_deliveries/);
  assert.match(webhook, /trade_activity_customer_document_delivery_events/);
  assert.match(webhook, /customer_documents_delivery_invalidated/);
  assert.match(webhook, /\["failed", "bounced", "complained", "suppressed"\]\.includes\(bookingDocumentStatus\)/);
  assert.match(webhook, /provider_event_key/);
});
