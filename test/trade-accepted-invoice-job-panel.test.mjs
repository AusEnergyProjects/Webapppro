import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/trade-quick-invoices/route.ts");
const panel = read("../src/components/TradeQuickInvoicePanel.tsx");

test("accepted invoice lookup remains tenant and assigned-job scoped", () => {
  assert.match(route, /await assignedJob\(access, workOrderId\)/);
  assert.match(route, /FROM trade_crm_accepted_invoices\s+WHERE firebase_uid = \? AND work_order_id = \?/);
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.ok(getBlock.indexOf("await assignedJob(access, workOrderId)") < getBlock.indexOf("acceptedInvoiceRow(access.ownerUid, workOrderId)"));
  assert.match(getBlock, /const acceptedRow = row\s+\? null\s+: await acceptedInvoiceRow/);
  const postPrelude = route.slice(route.indexOf("export async function POST"), route.indexOf('if (action === "create_draft")'));
  assert.match(postPrelude, /if \(scopedJobId\) await assignedJob\(access, scopedJobId\)/);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_crm_accepted_invoices (
    id text PRIMARY KEY, firebase_uid text NOT NULL, work_order_id text NOT NULL,
    invoice_number text NOT NULL
  )`);
  db.prepare("INSERT INTO trade_crm_accepted_invoices VALUES (?, ?, ?, ?)")
    .run("invoice-owner-a", "owner-a", "shared-job-id", "INV-A");
  db.prepare("INSERT INTO trade_crm_accepted_invoices VALUES (?, ?, ?, ?)")
    .run("invoice-owner-b", "owner-b", "shared-job-id", "INV-B");
  const selected = db.prepare(`SELECT invoice_number FROM trade_crm_accepted_invoices
    WHERE firebase_uid = ? AND work_order_id = ? LIMIT 1`)
    .get("owner-b", "shared-job-id");
  assert.equal(selected.invoice_number, "INV-B");
});

test("quick invoice creation rejects and transactionally guards accepted invoices", () => {
  assert.match(route, /ACCEPTED_INVOICE_EXISTS[\s\S]*409/);
  const createBlock = route.slice(route.indexOf('if \(action === "create_draft"\)'.replaceAll("\\", "")), route.indexOf("const invoiceId = cleanAdminText(body.invoiceId"));
  assert.match(createBlock, /if \(await acceptedInvoiceRow\(access\.ownerUid, workOrderId\)\)/);
  assert.match(createBlock, /INSERT INTO trade_crm_quick_invoices[\s\S]*WHERE NOT EXISTS \([\s\S]*FROM trade_crm_accepted_invoices accepted[\s\S]*accepted\.firebase_uid = \? AND accepted\.work_order_id = \?/);
  assert.match(createBlock, /const results = await db\.batch/);
  assert.match(createBlock, /Number\(results\[0\]\?\.meta\.changes \|\| 0\) !== 1/);
  assert.match(createBlock, /throw new Error\("ACCEPTED_INVOICE_EXISTS"\)/);
  assert.ok((createBlock.match(/EXISTS \(\s*SELECT 1 FROM trade_crm_quick_invoices invoice/g) || []).length >= 3);
});

test("accepted payment summary fails closed unless every bank field is complete", () => {
  const payloadBlock = route.slice(route.indexOf("function acceptedInvoicePayload"), route.indexOf("async function completePayload"));
  for (const condition of [
    'status === "issued"',
    "paymentValue.available === true",
    'paymentValue.method === "bank_transfer"',
    "&& accountName",
    "&& bsb",
    "&& accountNumber",
  ]) assert.match(payloadBlock, new RegExp(condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(payloadBlock, /method: "unavailable" as const, available: false as const/);
  assert.match(payloadBlock, /document_snapshot_json/);
  assert.match(payloadBlock, /document: documentValue/);
});

test("job Invoice tab renders the accepted invoice as a read-only exact summary", () => {
  const acceptedStart = panel.indexOf("if (!invoice && acceptedInvoice)");
  const createStart = panel.indexOf("if (!invoice && !canManageInvoice)");
  assert.ok(acceptedStart > 0 && createStart > acceptedStart);
  const acceptedView = panel.slice(acceptedStart, createStart);
  for (const copy of [
    "Invoice from accepted quote",
    "This read-only invoice matches the exact quote the customer accepted.",
    "Subtotal",
    "GST",
    "Invoice total",
    "Due",
    "Payment reference",
    "Bank transfer",
    "Reconciliation needed",
    "This accepted invoice needs reconciliation before payment details can be used.",
  ]) assert.match(acceptedView, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const field of [
    "acceptedInvoice.subtotalCents",
    "acceptedInvoice.taxCents",
    "acceptedInvoice.totalCents",
    "acceptedInvoice.dueAt",
    "bankPayment.accountName",
    "bankPayment.bsb",
    "bankPayment.accountNumber",
    "bankPayment.reference",
  ]) assert.match(acceptedView, new RegExp(field.replaceAll(".", "\\.")));
  for (const forbidden of [
    "Create invoice draft",
    "Preview and send invoice",
    "Issue credit",
    "correctDraft",
    "TradePaymentPanel",
  ]) assert.doesNotMatch(acceptedView, new RegExp(forbidden));
  assert.match(acceptedView, /Send to MYOB, Xero or QuickBooks/);
  assert.match(acceptedView, /<TradeAccountingPanel/);
  assert.match(acceptedView, /invoiceSource="accepted_quote"/);
  assert.match(acceptedView, /acceptedInvoice\.document\.lines/);
});
