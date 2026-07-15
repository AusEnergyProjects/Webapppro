import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const baseMigration = read("../drizzle/0020_lying_stick.sql");
const migration = read("../drizzle/0021_mushy_gamora.sql");
const paymentLinks = read("../src/app/api/trade-payment-links/route.ts");
const reconciliation = read("../src/lib/trade-payment-reconciliation.ts");
const stripeWebhook = read("../src/app/api/stripe/webhook/route.ts");
const squareWebhook = read("../src/app/api/square/webhook/route.ts");
const integrations = read("../src/app/api/trade-integrations/route.ts");
const providerSettings = read("../src/lib/trade-integrations-server.ts");
const paymentUi = read("../src/components/TradePaymentPanel.tsx");

function apply(database, sql) {
  sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)
    .forEach((statement) => database.exec(statement));
}

test("payment reconciliation ledger migration applies after the integration tables", () => {
  const database = new DatabaseSync(":memory:");
  apply(database, baseMigration);
  apply(database, migration);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trade_crm_payment_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_payment_events", "trade_crm_payment_links"]);
  const columns = database.prepare("PRAGMA table_info('trade_crm_payment_links')").all().map((row) => row.name);
  for (const column of ["provider_order_id", "provider_payment_id", "paid_amount_cents", "paid_at", "failure_code", "last_event_id", "last_event_at"]) {
    assert.ok(columns.includes(column), `${column} should be durable`);
  }
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_payment_events_provider_event_idx"));
  assert.ok(indexes.includes("trade_crm_payment_links_provider_order_idx"));
  database.close();
});

test("Stripe Connect reconciliation requires signed connected-account events", () => {
  assert.match(stripeWebhook, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(stripeWebhook, /verifyStripeSignature/);
  assert.match(stripeWebhook, /stringId\(event\.account\)/);
  assert.match(stripeWebhook, /applyTradeCrmCheckout/);
  assert.match(stripeWebhook, /checkout\.session\.async_payment_succeeded/);
  assert.match(reconciliation, /i\.external_account_id = \?/);
  assert.match(reconciliation, /l\.external_id/);
  assert.match(paymentLinks, /metadata\[aea_payment_link_id\]/);
  assert.match(paymentLinks, /payment_intent_data\[metadata\]\[aea_payment_link_id\]/);
});

test("Square reconciliation validates the raw body and matches merchant plus order", () => {
  assert.match(squareWebhook, /x-square-hmacsha256-signature/);
  assert.match(squareWebhook, /SQUARE_WEBHOOK_SIGNATURE_KEY/);
  assert.match(squareWebhook, /new TextEncoder\(\)\.encode\(`\$\{notificationUrl\}\$\{rawBody\}`\)/);
  assert.match(squareWebhook, /payment\.created/);
  assert.match(squareWebhook, /payment\.updated/);
  assert.match(squareWebhook, /payment\.order_id/);
  assert.match(paymentLinks, /payment_link\?\.order_id/);
  assert.match(providerSettings, /"PAYMENTS_READ"/);
  assert.match(reconciliation, /l\.provider_order_id/);
});

test("only verified, exact AUD totals change the installer job ledger", () => {
  assert.match(reconciliation, /currency !== "AUD"/);
  assert.match(reconciliation, /reportedAmount !== Number\(link\.amount_cents\)/);
  assert.match(reconciliation, /review_required/);
  assert.match(reconciliation, /No job balance was changed/);
  assert.match(reconciliation, /paid_value_cents = CASE/);
  assert.match(reconciliation, /Provider-verified payment added to the job ledger/);
  assert.match(reconciliation, /trade_crm_payment_events/);
  assert.match(reconciliation, /trade\.payment_received/);
  assert.match(reconciliation, /trade\.payment_review_required/);
});

test("browser returns remain non-authoritative and installers see provider status", () => {
  assert.doesNotMatch(paymentLinks, /status:\s*"paid"/);
  assert.match(paymentLinks, /payment_status=returned/);
  assert.match(integrations, /paid_amount_cents/);
  assert.match(integrations, /last_event_at/);
  assert.match(paymentUi, /Paid and reconciled/);
  assert.match(paymentUi, /Admin review required/);
  assert.match(paymentUi, /Refresh status/);
});

test("payment ledger schema and copy remain privacy-safe and avoid prohibited dash characters", () => {
  const paymentEventBlock = schema.match(/tradeCrmPaymentEvents[\s\S]*?\]\);/)?.[0] || "";
  assert.doesNotMatch(paymentEventBlock, /email|phone|address|customer_name|raw_payload/);
  for (const source of [paymentLinks, reconciliation, stripeWebhook, squareWebhook, integrations, paymentUi]) {
    assert.doesNotMatch(source, /[\u2013\u2014]/);
  }
});
