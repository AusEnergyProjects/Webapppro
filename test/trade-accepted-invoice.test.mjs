import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildAcceptedInvoiceSnapshot } from "../src/lib/trade-accepted-invoice.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0138_trade_quote_acceptance_invoice.sql");
const schema = read("../db/schema.ts");

const scope = [
  {
    lineId: "call-out",
    lineType: "labour",
    section: "Included work",
    description: "Call-out",
    quantityMilli: 6_000,
    subtotalCents: 120_000,
    taxCents: 12_000,
    totalCents: 132_000,
  },
  {
    lineId: "heat-pump",
    lineType: "product",
    section: "Included work",
    description: "Istore Heatpump",
    quantityMilli: 1_000,
    subtotalCents: 350_000,
    taxCents: 35_000,
    totalCents: 385_000,
  },
  {
    lineId: "stc",
    lineType: "adjustment",
    section: "Included work",
    description: "STC rebate",
    quantityMilli: 30_000,
    subtotalCents: -114_000,
    taxCents: -11_400,
    totalCents: -125_400,
  },
];

function input(overrides = {}) {
  return {
    invoiceId: "invoice-1",
    invoiceNumber: "INV-TLJ-X4LMAQXU",
    acceptanceId: "acceptance-1",
    commercialHandoffId: "handoff-1",
    quoteId: "quote-1",
    quoteVersionId: "version-1",
    workOrderId: "work-1",
    firebaseUid: "owner-1",
    crmCustomerId: "customer-1",
    issuedAt: "2026-08-13T04:15:00.000Z",
    dueAt: "2026-08-27",
    scope,
    totals: {
      subtotalCents: 356_000,
      taxCents: 35_600,
      totalCents: 391_600,
    },
    business: {
      name: "Australian Energy Assessments",
      email: "info@example.com",
      phone: "0400000000",
      abn: "12345678901",
      address: "Melbourne VIC 3000",
    },
    customer: {
      name: "James William",
      email: "james@example.com",
      phone: "0412345678",
      number: "CUS-001",
    },
    site: {
      label: "Service address",
      addressLine1: "1 Example Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Example Street, Melbourne VIC 3000",
    },
    work: {
      number: "TLJ-X4LMAQXU",
      title: "Heat-pump installation",
    },
    payment: {
      accountName: "Australian Energy Assessments",
      bsb: "123-456",
      accountNumber: "12345678",
      reference: "INV-TLJ-X4LMAQXU",
      terms: "Payment due within 14 days.",
    },
    ...overrides,
  };
}

test("accepted invoice preserves exact signed STC scope and reconciled totals", async () => {
  const built = await buildAcceptedInvoiceSnapshot(input());
  assert.equal(built.documentLabel, "Invoice");
  assert.equal(built.status, "issued");
  assert.deepEqual(built.documentSnapshot.lines, scope);
  assert.deepEqual(built.documentSnapshot.totals, {
    subtotalCents: 356_000,
    taxCents: 35_600,
    totalCents: 391_600,
  });
  assert.equal(built.documentSnapshot.lines[2].totalCents, -125_400);
  assert.match(built.sourceSnapshotSha256, /^[a-f0-9]{64}$/);
  assert.match(built.documentSnapshotSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(built.documentSnapshotJson).invoice.documentLabel, "Invoice");
});

test("bank payment is frozen only when all required details are complete", async () => {
  const complete = await buildAcceptedInvoiceSnapshot(input());
  assert.deepEqual(complete.paymentSnapshot, {
    method: "bank_transfer",
    available: true,
    accountName: "Australian Energy Assessments",
    bsb: "123-456",
    accountNumber: "12345678",
    reference: "INV-TLJ-X4LMAQXU",
    terms: "Payment due within 14 days.",
  });

  const incomplete = await buildAcceptedInvoiceSnapshot(input({
    payment: {
      ...input().payment,
      accountNumber: "",
    },
  }));
  assert.deepEqual(incomplete.paymentSnapshot, {
    method: "unavailable",
    available: false,
  });
  assert.equal(incomplete.status, "issued");
  assert.doesNotMatch(incomplete.paymentSnapshotJson, /123-456/);

  const attention = await buildAcceptedInvoiceSnapshot(input({
    issueBlockerCode: "ACCEPTED_INVOICE_CONFLICT",
  }));
  assert.equal(attention.status, "attention_required");
  assert.deepEqual(attention.paymentSnapshot, {
    method: "unavailable",
    available: false,
  });
});

test("accepted invoice hashes are canonical and stable", async () => {
  const first = await buildAcceptedInvoiceSnapshot(input());
  const second = await buildAcceptedInvoiceSnapshot(structuredClone(input()));
  assert.equal(first.sourceSnapshotSha256, second.sourceSnapshotSha256);
  assert.equal(first.documentSnapshotSha256, second.documentSnapshotSha256);
  assert.equal(first.documentSnapshotJson, second.documentSnapshotJson);

  const paymentChanged = await buildAcceptedInvoiceSnapshot(input({
    payment: { ...input().payment, reference: "A DIFFERENT REFERENCE" },
  }));
  assert.equal(first.sourceSnapshotSha256, paymentChanged.sourceSnapshotSha256);
  assert.notEqual(first.documentSnapshotSha256, paymentChanged.documentSnapshotSha256);
});

test("malformed accepted totals and non-adjustment negatives fail closed", async () => {
  await assert.rejects(
    buildAcceptedInvoiceSnapshot(input({
      totals: { subtotalCents: 356_001, taxCents: 35_600, totalCents: 391_601 },
    })),
    /INVALID_ACCEPTED_INVOICE/,
  );
  await assert.rejects(
    buildAcceptedInvoiceSnapshot(input({
      scope: [{
        ...scope[0],
        subtotalCents: -100,
        taxCents: -10,
        totalCents: -110,
      }],
      totals: { subtotalCents: -100, taxCents: -10, totalCents: 1 },
    })),
    /INVALID_ACCEPTED_INVOICE/,
  );
  await assert.rejects(
    buildAcceptedInvoiceSnapshot(input({
      scope: [{ ...scope[0], totalCents: 132_001 }, scope[1], scope[2]],
    })),
    /INVALID_ACCEPTED_INVOICE/,
  );
});

test("migration adds idempotent decisions and a tenant-safe accepted invoice record", async () => {
  assert.match(schema, /decisionRequestId: text\("decision_request_id"\)/);
  assert.match(schema, /sqliteTable\("trade_crm_accepted_invoices"/);
  assert.match(migration, /trade_crm_quote_acceptances_decision_request_idx/);
  assert.match(migration, /WHERE `decision_request_id` <> ''/);
  assert.match(migration, /trade_crm_accepted_invoices_owner_number_idx/);
  assert.match(migration, /`firebase_uid`,`invoice_number`/);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_quote_acceptances (id text PRIMARY KEY, quote_link_id text NOT NULL DEFAULT '', token_issue integer NOT NULL DEFAULT 0)");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  const built = await buildAcceptedInvoiceSnapshot(input());
  db.prepare(`INSERT INTO trade_crm_accepted_invoices (
    id, acceptance_id, commercial_handoff_id, quote_id, quote_version_id,
    work_order_id, firebase_uid, crm_customer_id, invoice_number, currency,
    document_label, source_snapshot_sha256, document_snapshot_json,
    subtotal_cents, tax_cents, total_cents, due_at, status,
    issue_blocker_code, payment_snapshot_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      "invoice-1", "acceptance-1", "handoff-1", "quote-1", "version-1",
      "work-1", "owner-1", "customer-1", "INV-TLJ-X4LMAQXU", built.currency,
      built.documentLabel, built.sourceSnapshotSha256, built.documentSnapshotJson,
      built.subtotalCents, built.taxCents, built.totalCents, built.dueAt,
      built.status, built.issueBlockerCode, built.paymentSnapshotJson,
      "2026-08-13T04:15:00.000Z", "2026-08-13T04:15:00.000Z",
    );
  assert.equal(
    db.prepare("SELECT total_cents FROM trade_crm_accepted_invoices WHERE id = ?").get("invoice-1").total_cents,
    391_600,
  );
  assert.throws(() => db.prepare(`INSERT INTO trade_crm_accepted_invoices (
    id, acceptance_id, commercial_handoff_id, quote_id, quote_version_id,
    work_order_id, firebase_uid, crm_customer_id, invoice_number, currency,
    document_label, source_snapshot_sha256, document_snapshot_json,
    subtotal_cents, tax_cents, total_cents, due_at, status,
    issue_blocker_code, payment_snapshot_json, created_at, updated_at
  ) SELECT 'invoice-2', 'acceptance-2', 'handoff-2', 'quote-2', 'version-2',
    'work-2', firebase_uid, 'customer-2', invoice_number, currency,
    document_label, source_snapshot_sha256,
    json_set(document_snapshot_json, '$.invoice.id', 'invoice-2'),
    subtotal_cents, tax_cents, total_cents, due_at, status,
    issue_blocker_code, payment_snapshot_json, created_at, updated_at
  FROM trade_crm_accepted_invoices WHERE id = 'invoice-1'`).run(), /UNIQUE/);
});
