import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  australiaLocalDateTime,
  nextAppointmentSlot,
} from "../src/lib/trade-schedule.ts";
import { quickInvoiceTotals } from "../src/lib/trade-quick-invoice.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const form = read("../src/components/TradeNewJobForm.tsx");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const invoiceRoute = read("../src/app/api/trade-quick-invoices/route.ts");
const invoiceServer = read("../src/lib/trade-quick-invoice-server.ts");
const invoicePanel = read("../src/components/TradeQuickInvoicePanel.tsx");
const accountingPanel = read("../src/components/TradeAccountingPanel.tsx");
const paymentPanel = read("../src/components/TradePaymentPanel.tsx");
const accountingRoute = read("../src/app/api/trade-accounting/route.ts");
const paymentRouteUrl = new URL("../src/app/api/trade-payment-links/route.ts", import.meta.url);
const migration = read("../drizzle/0075_guided_quick_invoices.sql");
const correctionMigration = read("../drizzle/0076_invoice_corrections_credits.sql");
const documentMigration = read("../drizzle/0122_trade_invoice_documents.sql");
const issuedDocumentMigration = read("../drizzle/0123_immutable_issued_pdf_artifacts.sql");
const apply = (db, sql) => {
  for (
    const statement of sql
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)
  ) db.exec(statement);
};
const applyMatching = (db, sql, pattern) => {
  for (
    const statement of sql
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter((item) => item && pattern.test(item))
  ) db.exec(statement);
};

function sourceSql(source, constantName) {
  const match = source.match(
    new RegExp(`export const ${constantName} = \`([\\s\\S]*?)\`;`),
  );
  assert.ok(match, `Missing source SQL constant ${constantName}`);
  return match[1];
}

test("appointment minimums are stable quarter-hour values", () => {
  assert.equal(nextAppointmentSlot(new Date("2026-07-21T05:11:20Z"), 15).slice(14, 16), "30");
  assert.equal(nextAppointmentSlot(new Date("2026-07-21T05:30:00Z"), 15).slice(14, 16), "45");
  assert.doesNotMatch(form, /reportValidity\(/);
  assert.match(form, /15-minute interval/);
  assert.match(form, /min=\{minimumStart\} step="900"/);
});

test("quick invoice totals retain integer cents and explicit GST", () => {
  assert.deepEqual(quickInvoiceTotals([
    { subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
    { subtotalCents: 8_500, taxCents: 0, totalCents: 8_500 },
  ]), {
    subtotalCents: 28_500,
    discountCents: 0,
    taxableDiscountCents: 0,
    gstFreeDiscountCents: 0,
    taxCents: 2_000,
    totalCents: 30_500,
  });
});

test("invoice due dates use the Australia Sydney calendar day at UTC boundaries", () => {
  const utcBoundary = new Date("2026-08-03T14:30:00.000Z");
  assert.equal(utcBoundary.toISOString().slice(0, 10), "2026-08-03");
  assert.equal(
    australiaLocalDateTime("NSW", utcBoundary).slice(0, 10),
    "2026-08-04",
  );
  assert.match(
    invoiceRoute,
    /australiaLocalDateTime\([\s\S]*"NSW",[\s\S]*new Date\(now\),[\s\S]*\)\.slice\(0, 10\)/,
  );
  assert.match(invoiceRoute, /dueAt < australiaSydneyToday/);
  assert.doesNotMatch(invoiceRoute, /dueAt < now\.slice\(0, 10\)/);
  assert.match(
    invoicePanel,
    /addCalendarDays\(australiaSydneyCalendarDate\(\), 7\)/,
  );
  assert.match(invoicePanel, /min=\{australiaSydneyToday\}/);
});

test("saved direct-customer jobs can create and recover a quick invoice without cluttering New Job", () => {
  assert.match(form, /const steps = \["Work", "Customer", "Program", "Appointment", "Review"\]/);
  assert.doesNotMatch(form, /TradeQuickInvoiceStep|invoiceMode|quickInvoiceLines/);
  assert.doesNotMatch(crmRoute, /INSERT INTO trade_crm_quick_invoices|sendQuickInvoiceDelivery/);
  assert.match(invoiceRoute, /action === "create_draft"/);
  assert.match(invoiceRoute, /details\.customer_source = 'trade_owned'/);
  assert.match(
    invoiceRoute,
    /resolveQuickInvoiceDraft\(access\.ownerUid, body\.lines, body\.discountCents\)/,
  );
  assert.match(invoiceRoute, /INSERT INTO trade_crm_quick_invoices/);
  assert.match(invoiceRoute, /INSERT INTO trade_crm_quick_invoice_revisions/);
  assert.match(invoiceRoute, /quick_invoice_created/);
  assert.match(invoicePanel, /Create the invoice from this job/);
  assert.match(invoicePanel, /action: "create_draft"/);
  assert.match(invoicePanel, /Create invoice draft/);
  assert.match(invoiceRoute, /retry_delivery/);
  assert.match(invoiceServer, /idempotencyKey: `quick-invoice:/);
});

test("successful delivery atomically records consent with the issued invoice", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, migration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text, commercial_reference text, purpose text,
    provider text, provider_payment_id text, paid_amount_cents integer, paid_at text, status text
  )`);
  apply(db, correctionMigration);
  apply(db, documentMigration);
  applyMatching(db, issuedDocumentMigration, /trade_crm_quick_invoice/);
  const createdAt = "2026-08-03T00:00:00.000Z";
  const sentAt = "2026-08-03T00:01:00.000Z";
  const documentSnapshot = '{"invoiceId":"invoice-1","revision":1}';
  db.prepare(`INSERT INTO trade_crm_quick_invoices (
      id, work_order_id, firebase_uid, crm_customer_id, invoice_number,
      due_at, delivery_status, document_snapshot_json, consent_confirmed_at,
      created_by_uid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, '', ?, ?, ?)`)
    .run(
      "invoice-1",
      "job-1",
      "owner-1",
      "customer-1",
      "INV-TLJ-1",
      "2026-08-10",
      documentSnapshot,
      "owner-1",
      createdAt,
      createdAt,
    );
  const sql = sourceSql(
    invoiceServer,
    "QUICK_INVOICE_SUCCESS_UPDATE_SQL",
  );
  assert.equal(
    db.prepare(sql).run(
      "resend",
      "provider-message-1",
      "trade-issued-documents/invoice/invoice-1/revision-1/test.pdf",
      "a".repeat(64),
      1234,
      sentAt,
      sentAt,
      sentAt,
      "invoice-1",
      "owner-1",
      1,
      documentSnapshot,
    ).changes,
    1,
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT
        status, delivery_status, provider_message_id,
        consent_confirmed_at, sent_at, attempts
      FROM trade_crm_quick_invoices
      WHERE id = 'invoice-1'`).get() },
    {
      status: "issued",
      delivery_status: "provider_accepted",
      provider_message_id: "provider-message-1",
      consent_confirmed_at: sentAt,
      sent_at: sentAt,
      attempts: 1,
    },
  );
  assert.match(
    invoiceRoute,
    /body\.consentConfirmed !== true[\s\S]*sendQuickInvoiceDelivery/,
  );
});

test("provider acceptance recovers only the exact claimed invoice snapshot", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, migration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text, commercial_reference text, purpose text,
    provider text, provider_payment_id text, paid_amount_cents integer, paid_at text, status text
  )`);
  apply(db, correctionMigration);
  apply(db, documentMigration);
  applyMatching(db, issuedDocumentMigration, /trade_crm_quick_invoice/);
  const createdAt = "2026-08-05T00:00:00.000Z";
  const acceptedAt = "2026-08-05T00:01:00.000Z";
  const claimedSnapshot = '{"invoiceId":"invoice-recover","revision":1}';
  const storedPdf = {
    key: "trade-issued-documents/invoice/invoice-recover/revision-1/test.pdf",
    sha256: "a".repeat(64),
    sizeBytes: 1234,
  };
  const insert = db.prepare(`INSERT INTO trade_crm_quick_invoices (
      id, work_order_id, firebase_uid, crm_customer_id, invoice_number,
      due_at, delivery_status, document_snapshot_json, consent_confirmed_at,
      created_by_uid, created_at, updated_at
    ) VALUES (?, ?, 'owner-1', 'customer-1', ?, '2026-08-12', ?, ?, '', 'owner-1', ?, ?)`);
  insert.run(
    "invoice-recover",
    "job-recover",
    "INV-RECOVER",
    "failed",
    claimedSnapshot,
    createdAt,
    createdAt,
  );
  const successSql = sourceSql(
    invoiceServer,
    "QUICK_INVOICE_SUCCESS_UPDATE_SQL",
  );
  assert.equal(
    db.prepare(successSql).run(
      "resend",
      "provider-recover",
      storedPdf.key,
      storedPdf.sha256,
      storedPdf.sizeBytes,
      acceptedAt,
      acceptedAt,
      acceptedAt,
      "invoice-recover",
      "owner-1",
      1,
      claimedSnapshot,
    ).changes,
    0,
  );
  const recoverySql = sourceSql(
    invoiceServer,
    "QUICK_INVOICE_PROVIDER_ACCEPTED_RECOVERY_SQL",
  );
  assert.equal(
    db.prepare(recoverySql).run(
      "resend",
      "provider-recover",
      storedPdf.key,
      storedPdf.sha256,
      storedPdf.sizeBytes,
      acceptedAt,
      acceptedAt,
      acceptedAt,
      "invoice-recover",
      "owner-1",
      1,
      claimedSnapshot,
    ).changes,
    1,
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT
        status, delivery_status, provider_message_id,
        issued_pdf_object_key, issued_pdf_sha256, issued_pdf_size_bytes
      FROM trade_crm_quick_invoices
      WHERE id = 'invoice-recover'`).get() },
    {
      status: "issued",
      delivery_status: "provider_accepted",
      provider_message_id: "provider-recover",
      issued_pdf_object_key: storedPdf.key,
      issued_pdf_sha256: storedPdf.sha256,
      issued_pdf_size_bytes: storedPdf.sizeBytes,
    },
  );

  insert.run(
    "invoice-conflict",
    "job-conflict",
    "INV-CONFLICT",
    "sending",
    '{"invoiceId":"invoice-conflict","revision":2}',
    createdAt,
    createdAt,
  );
  assert.equal(
    db.prepare(recoverySql).run(
      "resend",
      "provider-conflict",
      "trade-issued-documents/invoice/invoice-conflict/revision-1/test.pdf",
      "b".repeat(64),
      1234,
      acceptedAt,
      acceptedAt,
      acceptedAt,
      "invoice-conflict",
      "owner-1",
      1,
      claimedSnapshot,
    ).changes,
    0,
  );
  const conflictSql = sourceSql(
    invoiceServer,
    "QUICK_INVOICE_PROVIDER_ACCEPTED_CONFLICT_SQL",
  );
  assert.equal(
    db.prepare(conflictSql).run(
      "resend",
      "provider-conflict",
      acceptedAt,
      "invoice-conflict",
      "owner-1",
    ).changes,
    1,
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT
        status, delivery_status, provider_message_id, last_error,
        issued_pdf_object_key
      FROM trade_crm_quick_invoices
      WHERE id = 'invoice-conflict'`).get() },
    {
      status: "draft",
      delivery_status: "reconciliation_required",
      provider_message_id: "provider-conflict",
      last_error: "PROVIDER_ACCEPTED_RECONCILIATION_REQUIRED",
      issued_pdf_object_key: "",
    },
  );
});

test("provider reconciliation is never presented as issued or resendable", () => {
  assert.match(
    invoiceServer,
    /delivery_status = 'reconciliation_required'/,
  );
  assert.match(
    invoiceServer,
    /delivery_status = 'reconciliation_required' THEN delivery_status/,
  );
  assert.match(invoicePanel, /const reconciliationRequired =/);
  assert.match(invoicePanel, /Reconciliation required/);
  assert.match(invoicePanel, /Do not resend it/);
  assert.match(
    invoicePanel,
    /!providerAccepted && !reconciliationRequired/,
  );
  assert.match(
    invoicePanel,
    /invoice\.status !== "draft" &&[\s\S]*invoice\.canDownloadPdf/,
  );
});

test("invoice sending fails clearly without a customer email", () => {
  assert.match(
    invoiceRoute,
    /QUICK_INVOICE_RECIPIENT_INVALID[\s\S]*Add a valid email to the customer record/,
  );
  assert.match(
    invoiceServer,
    /customer_email[\s\S]*QUICK_INVOICE_RECIPIENT_INVALID/,
  );
  assert.match(invoicePanel, /const canSendInvoice = Boolean\(invoice\.deliveryEmail\.trim\(\)\)/);
  assert.match(
    invoicePanel,
    /disabled=\{Boolean\(busy\) \|\| !canSendInvoice\}[\s\S]*Sending is unavailable until a valid email is added to the customer record/,
  );
  assert.doesNotMatch(
    invoicePanel,
    /invoice\.deliveryEmail \|\| "the customer email saved on this job"/,
  );
});

test("invoice preview contains focus and restores the opening control", () => {
  assert.match(invoicePanel, /previewDialogRef/);
  assert.match(invoicePanel, /previewCloseButtonRef\.current\?\.focus\(\)/);
  assert.match(invoicePanel, /event\.key === "Escape"/);
  assert.match(invoicePanel, /event\.key !== "Tab"/);
  assert.match(invoicePanel, /dialog\.querySelectorAll<HTMLElement>/);
  assert.match(invoicePanel, /event\.shiftKey/);
  assert.match(invoicePanel, /restoreFocusTo\?\.isConnected[\s\S]*restoreFocusTo\.focus\(\)/);
  assert.match(invoicePanel, /aria-modal="true"/);
  assert.match(invoicePanel, /aria-describedby="invoice-preview-delivery"/);
});

test("quick invoice migration creates owner-scoped durable invoice records", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, migration);
  const columns = db.prepare("PRAGMA table_info(trade_crm_quick_invoices)").all().map((row) => row.name);
  for (const name of ["work_order_id", "firebase_uid", "invoice_number", "line_items_json", "total_cents", "delivery_status", "provider_message_id", "consent_confirmed_at"]) assert.ok(columns.includes(name));
  const indexes = db.prepare("PRAGMA index_list(trade_crm_quick_invoices)").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_quick_invoices_owner_job_idx"));
  assert.ok(indexes.includes("trade_crm_quick_invoices_number_idx"));
});

test("quick invoice reuses authoritative totals in accounting while payment initiation stays disabled", () => {
  assert.match(accountingRoute, /q\.total_cents quick_total_cents/);
  assert.match(accountingRoute, /commercial_reference: row\.invoice_number/);
  assert.match(accountingRoute, /accepted_total_cents: row\.quick_total_cents/);
  assert.match(accountingRoute, /invoice_source: source/);
  assert.match(accountingRoute, /taxCents !== Number\(job\.accepted_tax_cents/);
  assert.match(accountingPanel, /invoiceSource/);
  assert.match(invoicePanel, /invoiceSource="quick_invoice"/);

  assert.equal(fs.existsSync(paymentRouteUrl), false);
  assert.match(paymentPanel, /purpose\?: "deposit" \| "invoice"/);
  assert.match(invoicePanel, /purpose="invoice"/);
});

test("invoice payment processing is external and exposes no checkout control", () => {
  assert.match(paymentPanel, /Payment processing is outside TLink/);
  assert.match(paymentPanel, /Use your own approved process outside TLink/);
  assert.doesNotMatch(paymentPanel, /checkoutUrl|Open checkout|Request with Stripe|Request with Square/);
});
