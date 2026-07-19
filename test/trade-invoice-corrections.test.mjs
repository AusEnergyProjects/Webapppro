import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { creditTotals, invoiceBalance } from "../src/lib/trade-invoice-balance.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0076_invoice_corrections_credits.sql");
const quickInvoiceMigration = read("../drizzle/0075_guided_quick_invoices.sql");
const route = read("../src/app/api/trade-quick-invoices/route.ts");
const panel = read("../src/components/TradeQuickInvoicePanel.tsx");
const reconciliation = read("../src/lib/trade-payment-reconciliation.ts");
const apply = (db, sql) => { for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement); };

test("invoice balances retain exact cents and reject over-allocation", () => {
  assert.deepEqual(invoiceBalance({ totalCents: 11000, creditedCents: 2200, paidCents: 3000 }), {
    originalCents: 11000, creditedCents: 2200, netCents: 8800, paidCents: 3000, outstandingCents: 5800,
  });
  assert.deepEqual(creditTotals(2000, "gst"), { subtotalCents: 2000, taxCents: 200, totalCents: 2200 });
  assert.deepEqual(creditTotals(2000, "none"), { subtotalCents: 2000, taxCents: 0, totalCents: 2000 });
  assert.throws(() => invoiceBalance({ totalCents: 1000, creditedCents: 600, paidCents: 500 }), /INVOICE_BALANCE_EXCEEDED/);
});

test("invoice correction migration preserves the initial snapshot and creates bounded ledgers", () => {
  const db = new DatabaseSync(":memory:");
  apply(db, quickInvoiceMigration);
  db.exec(`CREATE TABLE trade_crm_payment_links (
    id text PRIMARY KEY, work_order_id text, firebase_uid text, commercial_reference text, purpose text,
    provider text, provider_payment_id text, paid_amount_cents integer, paid_at text, status text
  )`);
  db.prepare(`INSERT INTO trade_crm_quick_invoices
    (id, work_order_id, firebase_uid, crm_customer_id, invoice_number, due_at, consent_confirmed_at, created_by_uid, created_at, updated_at,
     line_items_json, subtotal_cents, tax_cents, total_cents)
    VALUES ('invoice-1', 'job-1', 'owner-1', 'customer-1', 'INV-TLJ-1', '2026-08-01', '2026-07-19', 'owner-1', '2026-07-19', '2026-07-19', '[]', 10000, 1000, 11000)`).run();
  apply(db, migration);
  const columns = db.prepare("PRAGMA table_info(trade_crm_quick_invoices)").all().map((row) => row.name);
  assert.ok(columns.includes("revision"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_crm_quick_invoice_revisions").get().count, 1);
  for (const table of ["trade_crm_quick_invoice_revisions", "trade_crm_quick_invoice_credits", "trade_crm_invoice_payment_allocations"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  }
});

test("draft correction, issued credit and provider allocation are explicit guarded actions", () => {
  assert.match(route, /action === "correct_draft"/);
  assert.match(route, /expectedRevision/);
  assert.match(route, /INSERT INTO trade_crm_quick_invoice_revisions/);
  assert.match(route, /action === "issue_credit"/);
  assert.match(route, /trade_crm_quick_invoice_credits/);
  assert.match(route, /payment_activity/);
  assert.match(route, /accounting_activity/);
  assert.match(reconciliation, /INSERT OR IGNORE INTO trade_crm_invoice_payment_allocations/);
  assert.match(panel, /Correct this draft before sending/);
  assert.match(panel, /Issue a credit/);
  assert.match(panel, /outstandingCents/);
});
