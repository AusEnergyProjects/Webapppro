import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const quickInvoiceMigration = read("../drizzle/0075_guided_quick_invoices.sql");
const correctionMigration = read("../drizzle/0076_invoice_corrections_credits.sql");
const documentMigration = read("../drizzle/0122_trade_invoice_documents.sql");
const immutablePdfMigration = read("../drizzle/0123_immutable_issued_pdf_artifacts.sql");
const invoiceServer = read("../src/lib/trade-quick-invoice-server.ts");
const invoiceRoute = read("../src/app/api/trade-quick-invoices/route.ts");
const invoicePdfRoute = read("../src/app/api/trade-quick-invoices/[invoiceId]/pdf/route.ts");
const resendWebhook = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const issuedDocumentStore = read("../src/lib/trade-issued-document-store.ts");

function apply(db, sql) {
  for (
    const statement of sql
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)
  ) {
    db.exec(statement);
  }
}

function applyQuickInvoicePdfMigration(db) {
  for (
    const statement of immutablePdfMigration
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter((item) => item.includes("trade_crm_quick_invoice"))
  ) {
    db.exec(statement);
  }
}

function sourceSql(source, constantName) {
  const match = source.match(
    new RegExp(`export const ${constantName} = \`([\\s\\S]*?)\`;`),
  );
  assert.ok(match, `Missing source SQL constant ${constantName}`);
  return match[1];
}

function invoiceDatabase() {
  const db = new DatabaseSync(":memory:");
  apply(db, quickInvoiceMigration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text,
    commercial_reference text, purpose text, provider text,
    provider_payment_id text, paid_amount_cents integer,
    paid_at text, status text
  )`);
  apply(db, correctionMigration);
  apply(db, documentMigration);
  applyQuickInvoicePdfMigration(db);
  return db;
}

function insertDraft(
  db,
  {
    id,
    ownerUid = "owner-1",
    revision = 1,
    deliveryStatus = "queued",
    snapshot = "snapshot-1",
  },
) {
  const now = "2026-08-05T00:00:00.000Z";
  db.prepare(`INSERT INTO trade_crm_quick_invoices (
      id, work_order_id, firebase_uid, crm_customer_id, invoice_number,
      due_at, status, delivery_status, document_snapshot_json,
      consent_confirmed_at, created_by_uid, created_at, updated_at, revision
    ) VALUES (?, ?, ?, ?, ?, '2026-08-12', 'draft', ?, ?, '', ?, ?, ?, ?)`)
    .run(
      id,
      `job-${id}`,
      ownerUid,
      `customer-${id}`,
      `INV-${id}`,
      deliveryStatus,
      snapshot,
      ownerUid,
      now,
      now,
      revision,
    );
}

function applyProviderEvent(
  db,
  {
    status,
    eventType,
    invoiceId,
    ownerUid = "owner-1",
    providerMessageId = "provider-message-1",
    now = "2026-08-05T00:02:00.000Z",
  },
) {
  return db.prepare(
    sourceSql(invoiceServer, "QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL"),
  ).run(
    status,
    status,
    status,
    status,
    status,
    status,
    eventType,
    status,
    eventType,
    status,
    now,
    invoiceId,
    ownerUid,
    providerMessageId,
  );
}

test("quick invoice send claims the exact draft revision before provider work", () => {
  const db = invoiceDatabase();
  insertDraft(db, { id: "invoice-lock" });
  const lockSql = sourceSql(invoiceServer, "QUICK_INVOICE_SEND_LOCK_SQL");
  const now = "2026-08-05T00:01:00.000Z";
  const staleBefore = "2026-08-04T23:51:00.000Z";

  assert.equal(
    db.prepare(lockSql).run(
      now,
      "invoice-lock",
      "owner-1",
      1,
      staleBefore,
    ).changes,
    1,
  );
  assert.equal(
    db.prepare(lockSql).run(
      now,
      "invoice-lock",
      "owner-1",
      1,
      staleBefore,
    ).changes,
    0,
  );
  assert.equal(
    db.prepare("SELECT delivery_status FROM trade_crm_quick_invoices WHERE id = ?")
      .get("invoice-lock").delivery_status,
    "sending",
  );
  assert.ok(
    invoiceServer.indexOf("QUICK_INVOICE_SEND_LOCK_SQL")
      < invoiceServer.indexOf("sendServiceReminderProviderMessage({"),
    "The database claim must happen before provider submission.",
  );
});

test("quick invoice issue CAS requires the claimed revision and immutable snapshot", () => {
  const db = invoiceDatabase();
  insertDraft(db, { id: "invoice-issue" });
  const now = "2026-08-05T00:01:00.000Z";
  db.prepare(sourceSql(invoiceServer, "QUICK_INVOICE_SEND_LOCK_SQL"))
    .run(now, "invoice-issue", "owner-1", 1, "2026-08-04T23:51:00.000Z");

  assert.equal(
    db.prepare(sourceSql(invoiceServer, "QUICK_INVOICE_SUCCESS_UPDATE_SQL"))
      .run(
        "resend",
        "provider-message-1",
        "trade-issued-documents/invoice/invoice-issue/revision-1/file.pdf",
        "a".repeat(64),
        1234,
        now,
        now,
        now,
        "invoice-issue",
        "owner-1",
        1,
        "snapshot-1",
      ).changes,
    1,
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT status, delivery_status, provider_message_id,
          issued_pdf_object_key, issued_pdf_sha256, issued_pdf_size_bytes,
          consent_confirmed_at, sent_at, attempts
        FROM trade_crm_quick_invoices WHERE id = ?`).get("invoice-issue"),
    },
    {
      status: "issued",
      delivery_status: "provider_accepted",
      provider_message_id: "provider-message-1",
      issued_pdf_object_key:
        "trade-issued-documents/invoice/invoice-issue/revision-1/file.pdf",
      issued_pdf_sha256: "a".repeat(64),
      issued_pdf_size_bytes: 1234,
      consent_confirmed_at: now,
      sent_at: now,
      attempts: 1,
    },
  );
});

test("quick invoice provider idempotency is scoped to the exact claimed revision", () => {
  assert.match(
    invoiceServer,
    /idempotencyKey: `quick-invoice:\$\{input\.invoiceId\}:revision:\$\{expectedRevision\}`/,
  );
  assert.doesNotMatch(
    invoiceServer,
    /idempotencyKey: `quick-invoice:\$\{input\.invoiceId\}`/,
  );
});

test("issued invoice PDF bytes are stored before provider submission and downloads read the verified artifact", () => {
  assert.ok(
    invoiceServer.indexOf("storeImmutableIssuedPdf({")
      < invoiceServer.indexOf("sendServiceReminderProviderMessage({"),
    "The immutable PDF must be retained before the provider can accept it.",
  );
  assert.match(invoiceServer, /issued_pdf_object_key/);
  assert.match(invoiceServer, /issued_pdf_sha256/);
  assert.match(invoiceServer, /issued_pdf_size_bytes/);
  assert.match(invoicePdfRoute, /issuedQuickInvoicePdf/);
  assert.doesNotMatch(invoicePdfRoute, /renderTradeQuickInvoicePdf/);
  assert.match(issuedDocumentStore, /readImmutableIssuedPdf/);
  assert.match(issuedDocumentStore, /ISSUED_PDF_INTEGRITY/);
});

test("provider acceptance recovers only the exact claimed revision and snapshot", () => {
  const db = invoiceDatabase();
  insertDraft(db, { id: "invoice-recovery" });
  const now = "2026-08-05T00:01:00.000Z";
  const recovery = db.prepare(sourceSql(
    invoiceServer,
    "QUICK_INVOICE_PROVIDER_ACCEPTED_RECOVERY_SQL",
  )).run(
    "resend",
    "provider-message-recovery",
    "trade-issued-documents/invoice/invoice-recovery/revision-1/file.pdf",
    "c".repeat(64),
    1234,
    now,
    now,
    now,
    "invoice-recovery",
    "owner-1",
    1,
    "snapshot-1",
  );

  assert.equal(recovery.changes, 1);
  assert.deepEqual(
    {
      ...db.prepare(`SELECT status, revision, delivery_status,
          provider_message_id, issued_pdf_object_key, issued_pdf_sha256,
          issued_pdf_size_bytes, last_error
        FROM trade_crm_quick_invoices WHERE id = ?`).get("invoice-recovery"),
    },
    {
      status: "issued",
      revision: 1,
      delivery_status: "provider_accepted",
      provider_message_id: "provider-message-recovery",
      issued_pdf_object_key:
        "trade-issued-documents/invoice/invoice-recovery/revision-1/file.pdf",
      issued_pdf_sha256: "c".repeat(64),
      issued_pdf_size_bytes: 1234,
      last_error: "",
    },
  );
});

test("provider acceptance survives a lost final CAS without falsely issuing a changed draft", () => {
  const db = invoiceDatabase();
  insertDraft(db, { id: "invoice-race" });
  const now = "2026-08-05T00:01:00.000Z";
  db.prepare(sourceSql(invoiceServer, "QUICK_INVOICE_SEND_LOCK_SQL"))
    .run(now, "invoice-race", "owner-1", 1, "2026-08-04T23:51:00.000Z");
  db.prepare(`UPDATE trade_crm_quick_invoices
    SET revision = 2, document_snapshot_json = 'snapshot-2',
      delivery_status = 'queued'
    WHERE id = 'invoice-race'`).run();

  assert.equal(
    db.prepare(sourceSql(invoiceServer, "QUICK_INVOICE_SUCCESS_UPDATE_SQL"))
      .run(
        "resend",
        "provider-message-race",
        "trade-issued-documents/invoice/invoice-race/revision-1/file.pdf",
        "b".repeat(64),
        1234,
        now,
        now,
        now,
        "invoice-race",
        "owner-1",
        1,
        "snapshot-1",
      ).changes,
    0,
  );
  assert.equal(
    db.prepare(sourceSql(
      invoiceServer,
      "QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL",
    )).run(
      "resend",
      "provider-message-race",
      now,
      "invoice-race",
      "owner-1",
    ).changes,
    1,
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT status, revision, delivery_status,
          provider_message_id, last_error
        FROM trade_crm_quick_invoices WHERE id = ?`).get("invoice-race"),
    },
    {
      status: "draft",
      revision: 2,
      delivery_status: "reconciliation_required",
      provider_message_id: "provider-message-race",
      last_error: "PROVIDER_ACCEPTED_RECONCILIATION_REQUIRED",
    },
  );
});

test("quick invoice routes use owner scope with actor attribution and block in-flight correction", () => {
  assert.match(invoiceRoute, /requireInstallerTeamAccess\(request\)/);
  assert.match(invoiceRoute, /canDispatch\(access\)/);
  assert.match(invoiceRoute, /ownerUid: access\.ownerUid/);
  assert.match(invoiceRoute, /actorUid: access\.actorUid/);
  assert.match(invoiceRoute, /created_by_uid[\s\S]*access\.actorUid/);
  assert.match(invoiceRoute, /firebase_uid = \?[\s\S]*access\.ownerUid/);
  assert.match(
    invoiceRoute,
    /current\.delivery_status === "sending"[\s\S]*QUICK_INVOICE_SENDING/,
  );
  assert.match(
    invoiceRoute,
    /status = 'draft' AND delivery_status IN \('queued', 'failed'\)/,
  );
  assert.doesNotMatch(invoiceRoute, /requireInstallerOperations|identity\.uid/);

  assert.match(invoicePdfRoute, /requireInstallerTeamAccess\(request\)/);
  assert.match(invoicePdfRoute, /canDispatch\(access\)/);
  assert.match(invoicePdfRoute, /access\.ownerUid/);
  assert.doesNotMatch(invoicePdfRoute, /requireInstallerOperations|identity\.uid/);
});

test("historical issued invoices without a stored document fail closed", () => {
  assert.match(
    invoiceServer,
    /if \(!stored && row\.status !== "draft"\)[\s\S]*QUICK_INVOICE_DOCUMENT_UNAVAILABLE/,
  );
  assert.match(
    invoiceServer,
    /revision_document_snapshot_json/,
  );
  assert.match(
    invoicePdfRoute,
    /QUICK_INVOICE_DOCUMENT_UNAVAILABLE[\s\S]*QUICK_INVOICE_PDF_UNAVAILABLE[\s\S]*no verified issued PDF artifact and cannot be regenerated/,
  );
  assert.match(
    invoiceRoute,
    /QUICK_INVOICE_DOCUMENT_UNAVAILABLE[\s\S]*no verified issued PDF artifact and cannot be regenerated/,
  );
  assert.match(
    invoiceRoute,
    /error\.message !== "QUICK_INVOICE_DOCUMENT_UNAVAILABLE"/,
  );
  assert.match(
    invoiceRoute,
    /canDownloadPdf:[\s\S]*row\.status !== "draft"[\s\S]*Boolean\(snapshot\)[\s\S]*Boolean\(row\.issued_pdf_object_key\)[\s\S]*Boolean\(row\.issued_pdf_sha256\)[\s\S]*Number\(row\.issued_pdf_size_bytes/,
  );
});

test("signature-verified Resend events reconcile quick invoice delivery monotonically and owner-safely", () => {
  const verification = resendWebhook.indexOf(
    "await verifyResendWebhook(rawBody, request.headers, secret)",
  );
  const lookup = resendWebhook.indexOf(
    "FROM trade_crm_quick_invoices",
  );
  assert.ok(verification >= 0 && lookup > verification);
  assert.match(
    resendWebhook,
    /WHERE delivery_provider = 'resend' AND provider_message_id = \?/,
  );
  assert.match(
    resendWebhook,
    /SELECT id FROM trade_work_order_events WHERE id = \?/,
  );
  assert.match(
    resendWebhook,
    /INSERT OR IGNORE INTO trade_work_order_events/,
  );
  assert.match(
    resendWebhook,
    /QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL/,
  );

  const db = invoiceDatabase();
  insertDraft(db, {
    id: "invoice-events",
    deliveryStatus: "provider_accepted",
  });
  db.prepare(`UPDATE trade_crm_quick_invoices
    SET status = 'issued', provider_message_id = 'provider-message-1'
    WHERE id = 'invoice-events'`).run();

  assert.equal(applyProviderEvent(db, {
    status: "sent",
    eventType: "email.sent",
    invoiceId: "invoice-events",
  }).changes, 1);
  assert.equal(
    db.prepare("SELECT delivery_status FROM trade_crm_quick_invoices WHERE id = ?")
      .get("invoice-events").delivery_status,
    "sent",
  );

  applyProviderEvent(db, {
    status: "delivered",
    eventType: "email.delivered",
    invoiceId: "invoice-events",
  });
  applyProviderEvent(db, {
    status: "sent",
    eventType: "email.sent",
    invoiceId: "invoice-events",
  });
  assert.equal(
    db.prepare("SELECT delivery_status FROM trade_crm_quick_invoices WHERE id = ?")
      .get("invoice-events").delivery_status,
    "delivered",
  );

  applyProviderEvent(db, {
    status: "bounced",
    eventType: "email.bounced",
    invoiceId: "invoice-events",
  });
  applyProviderEvent(db, {
    status: "delivered",
    eventType: "email.delivered",
    invoiceId: "invoice-events",
  });
  assert.deepEqual(
    {
      ...db.prepare(`SELECT delivery_status, last_error
        FROM trade_crm_quick_invoices WHERE id = ?`).get("invoice-events"),
    },
    {
      delivery_status: "bounced",
      last_error: "email.bounced",
    },
  );
  assert.equal(applyProviderEvent(db, {
    status: "failed",
    eventType: "email.failed",
    invoiceId: "invoice-events",
    ownerUid: "other-owner",
  }).changes, 0);
});
