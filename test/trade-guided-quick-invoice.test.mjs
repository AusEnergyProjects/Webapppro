import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { nextAppointmentSlot } from "../src/lib/trade-schedule.ts";
import { quickInvoiceTotals } from "../src/lib/trade-quick-invoice.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const form = read("../src/components/TradeNewJobForm.tsx");
const invoiceStep = read("../src/components/TradeQuickInvoiceStep.tsx");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const invoiceRoute = read("../src/app/api/trade-quick-invoices/route.ts");
const invoiceServer = read("../src/lib/trade-quick-invoice-server.ts");
const invoicePanel = read("../src/components/TradeQuickInvoicePanel.tsx");
const accountingPanel = read("../src/components/TradeAccountingPanel.tsx");
const paymentPanel = read("../src/components/TradePaymentPanel.tsx");
const accountingRoute = read("../src/app/api/trade-accounting/route.ts");
const paymentRoute = read("../src/app/api/trade-payment-links/route.ts");
const reconciliation = read("../src/lib/trade-payment-reconciliation.ts");
const migration = read("../drizzle/0075_guided_quick_invoices.sql");

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
  ]), { subtotalCents: 28_500, taxCents: 2_000, totalCents: 30_500 });
});

test("guided setup has an optional sixth invoice step with recoverable delivery", () => {
  assert.match(form, /"Evidence", "Invoice"/);
  assert.match(form, /<TradeQuickInvoiceStep/);
  assert.match(invoiceStep, /Skip for now/);
  assert.match(invoiceStep, /Send a quick invoice/);
  assert.match(invoiceStep, /Schedule, request info and send invoice/);
  assert.match(invoiceStep, /Included when you send/);
  assert.match(invoiceStep, /effectiveLines/);
  assert.match(invoiceStep, /provider\.status === "connected"/);
  assert.match(crmRoute, /resolveQuickInvoiceDraft/);
  assert.match(crmRoute, /INSERT INTO trade_crm_quick_invoices/);
  assert.match(crmRoute, /sendQuickInvoiceDelivery/);
  assert.match(invoiceRoute, /retry_delivery/);
  assert.match(invoiceServer, /idempotencyKey: `quick-invoice:/);
});

test("quick invoice migration creates owner-scoped durable invoice records", () => {
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const columns = db.prepare("PRAGMA table_info(trade_crm_quick_invoices)").all().map((row) => row.name);
  for (const name of ["work_order_id", "firebase_uid", "invoice_number", "line_items_json", "total_cents", "delivery_status", "provider_message_id", "consent_confirmed_at"]) assert.ok(columns.includes(name));
  const indexes = db.prepare("PRAGMA index_list(trade_crm_quick_invoices)").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_quick_invoices_owner_job_idx"));
  assert.ok(indexes.includes("trade_crm_quick_invoices_number_idx"));
});

test("quick invoice reuses authoritative totals in connected accounting and payment providers", () => {
  assert.match(accountingRoute, /q\.total_cents quick_total_cents/);
  assert.match(accountingRoute, /commercial_reference: row\.invoice_number/);
  assert.match(accountingRoute, /accepted_total_cents: row\.quick_total_cents/);
  assert.match(accountingRoute, /invoice_source: source/);
  assert.match(accountingRoute, /taxCents !== Number\(job\.accepted_tax_cents/);
  assert.match(accountingPanel, /invoiceSource/);
  assert.match(invoicePanel, /invoiceSource="quick_invoice"/);

  assert.match(paymentRoute, /purpose === "invoice"/);
  assert.match(paymentRoute, /invoice_number commercial_reference,[\s\S]*trade_crm_quick_invoice_credits[\s\S]*amount_cents/);
  assert.match(paymentRoute, /const idempotencyKey = `\$\{purpose\}-\$\{String\(source\.id\)\}`/);
  assert.match(paymentPanel, /purpose\?: "deposit" \| "invoice"/);
  assert.match(invoicePanel, /purpose="invoice"/);
});

test("verified full invoice payments reconcile without changing quote deposit state", () => {
  assert.match(reconciliation, /link\.purpose === "deposit" && link\.commercial_handoff_id/);
  assert.match(reconciliation, /link\.purpose === "invoice"/);
  assert.match(reconciliation, /UPDATE trade_crm_quick_invoices SET status = 'paid'/);
  assert.match(reconciliation, /trade_crm_invoice_payment_allocations/);
  assert.match(reconciliation, /reportedAmount !== Number\(link\.amount_cents\)/);
});
