import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { acceptedScopeSnapshot, depositAmountCents } from "../src/lib/trade-commercial-handoff.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0068_accepted_quote_handoff.sql");
const handoffRoute = read("../src/app/api/trade-commercial-handoff/route.ts");
const paymentRoute = read("../src/app/api/trade-payment-links/route.ts");
const accountingRoute = read("../src/app/api/trade-accounting/route.ts");
const reconciliation = read("../src/lib/trade-payment-reconciliation.ts");
const ui = read("../src/components/TradeCommercialHandoffPanel.tsx");
const accountingUi = read("../src/components/TradeAccountingPanel.tsx");

test("deposit amounts use bounded integer cents", () => {
  assert.equal(depositAmountCents(123_45, "percentage", 1000), 1235);
  assert.equal(depositAmountCents(123_45, "percentage", 2500), 3086);
  assert.equal(depositAmountCents(123_45, "fixed", 5000), 5000);
  assert.throws(() => depositAmountCents(123_45, "percentage", 0), /INVALID_COMMERCIAL_HANDOFF/);
  assert.throws(() => depositAmountCents(123_45, "fixed", 20_000), /INVALID_COMMERCIAL_HANDOFF/);
});

test("accepted scope includes base lines and only selected choices", () => {
  const rows = [
    { id: "base", quote_choice_id: "", section_heading: "Work", description: "Install", quantity_milli: 1000, subtotal_cents: 1000, tax_cents: 100, total_cents: 1100 },
    { id: "good", quote_choice_id: "good", section_heading: "Package", description: "Good", quantity_milli: 1000, subtotal_cents: 2000, tax_cents: 200, total_cents: 2200 },
    { id: "best", quote_choice_id: "best", section_heading: "Package", description: "Best", quantity_milli: 1000, subtotal_cents: 3000, tax_cents: 300, total_cents: 3300 },
  ];
  assert.deepEqual(acceptedScopeSnapshot(rows, ["best"]).map((line) => line.lineId), ["base", "best"]);
});

test("the handoff migration is additive and deposit idempotency is commercial-reference scoped", () => {
  assert.match(schema, /sqliteTable\("trade_crm_commercial_handovers"/);
  assert.match(migration, /CREATE TABLE `trade_crm_commercial_handovers`/);
  assert.match(migration, /trade_crm_commercial_handovers_acceptance_idx/);
  assert.match(migration, /trade_crm_payment_links_commercial_provider_idx/);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_accounting_documents (id text); CREATE TABLE trade_crm_payment_links (id text, firebase_uid text, provider text);");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  const handoff = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_crm_commercial_handovers'").get();
  assert.equal(handoff.name, "trade_crm_commercial_handovers");
});

test("accepted quote drives one provider-hosted deposit and verified payment state", () => {
  for (const boundary of ["sameOrigin", "requireInstallerOperations", "trade_crm_commercial_handovers", "deposit_amount_cents", "commercial_reference"]) assert.match(paymentRoute, new RegExp(boundary));
  assert.match(paymentRoute, /\? "invoice" : "deposit"/);
  assert.match(paymentRoute, /AND purpose = \?/);
  assert.match(paymentRoute, /Idempotency-Key/);
  assert.match(paymentRoute, /online-checkout\/payment-links/);
  assert.match(reconciliation, /status = 'deposit_paid'/);
  assert.match(reconciliation, /amountMismatch/);
  assert.doesNotMatch(paymentRoute, /body\.amountCents/);
});

test("Xero, MYOB and QuickBooks reuse the accepted handoff", () => {
  for (const provider of ["xero", "myob", "quickbooks"]) assert.match(accountingRoute, new RegExp(provider));
  for (const field of ["commercial_handoff_id", "commercial_reference", "scope_snapshot_json", "accepted_total_cents"]) assert.match(accountingRoute, new RegExp(field));
  assert.match(accountingRoute, /quickbooks\.api\.intuit\.com\/v3\/company/);
  assert.match(accountingRoute, /minorversion=75/);
  assert.match(accountingRoute, /SELECT \* FROM Item WHERE Active = true/);
  assert.match(accountingRoute, /totalCents !== amountCents/);
  assert.match(accountingUi, /Create QuickBooks draft/);
});

test("the office flow is progressive and exposes one commercial timeline", () => {
  for (const copy of ["Accepted quote handoff", "10% is the simple default", "Request with Stripe", "Request with Square", "Commercial timeline", "No retyping or provider calculations"]) assert.match(`${ui}\n${read("../src/components/TradePaymentPanel.tsx")}`, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const copy of ["Invoice preview", "Draft, not sent", "Preview, then create the draft", "Accounting system", "Nothing is approved or emailed automatically"]) assert.match(accountingUi, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(accountingUi, /invoiceLines\.map/);
  assert.match(handoffRoute, /DEPOSIT_ALREADY_REQUESTED/);
  assert.match(handoffRoute, /timeline/);
  assert.doesNotMatch(`${handoffRoute}\n${paymentRoute}\n${accountingRoute}\n${ui}\n${accountingUi}`, /[\u2013\u2014]/);
});
