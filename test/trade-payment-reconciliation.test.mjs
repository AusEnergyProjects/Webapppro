import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const baseMigration = read("../drizzle/0020_lying_stick.sql");
const migration = read("../drizzle/0021_mushy_gamora.sql");
const accountingMigration = read("../drizzle/0022_worried_sleepwalker.sql");
const commercialMigration = read("../drizzle/0068_accepted_quote_handoff.sql");
const attemptMigration = read("../drizzle/0078_payment_link_attempts.sql");
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
  apply(database, accountingMigration);
  apply(database, commercialMigration);
  apply(database, attemptMigration);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trade_crm_payment_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_payment_events", "trade_crm_payment_links"]);
  const columns = database.prepare("PRAGMA table_info('trade_crm_payment_links')").all().map((row) => row.name);
  for (const column of ["provider_order_id", "provider_payment_id", "paid_amount_cents", "paid_at", "failure_code", "last_event_id", "last_event_at", "attempt_number", "superseded_by_id", "superseded_at"]) {
    assert.ok(columns.includes(column), `${column} should be durable`);
  }
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_payment_events_provider_event_idx"));
  assert.ok(indexes.includes("trade_crm_payment_links_provider_order_idx"));
  assert.ok(indexes.includes("trade_crm_payment_links_commercial_attempt_idx"));
  assert.ok(indexes.includes("trade_crm_payment_links_collectible_idx"));
  database.close();
});

test("failed payment attempts can be replaced without allowing two collectible checkouts", () => {
  const database = new DatabaseSync(":memory:");
  apply(database, baseMigration);
  apply(database, migration);
  apply(database, accountingMigration);
  apply(database, commercialMigration);
  apply(database, attemptMigration);
  const insert = database.prepare(`INSERT INTO trade_crm_payment_links
    (id, work_order_id, firebase_uid, provider, external_id, amount_cents, checkout_url, status,
     idempotency_key, created_at, updated_at, commercial_reference, purpose, attempt_number)
    VALUES (?, 'job-1', 'owner-1', ?, ?, 10000, ?, ?, ?, '2026-07-20T00:00:00.000Z',
      '2026-07-20T00:00:00.000Z', 'INV-1', 'invoice', ?)`);
  insert.run("attempt-1", "stripe", "cs_failed", "https://stripe.test/failed", "failed", "attempt-key-1", 1);
  insert.run("attempt-2", "square", "square-open", "https://square.test/open", "open", "attempt-key-2", 2);
  assert.throws(() => insert.run("attempt-3", "stripe", "cs_open", "https://stripe.test/open", "open", "attempt-key-3", 3), /UNIQUE constraint failed/);
  assert.throws(() => insert.run("attempt-1-copy", "stripe", "cs_failed-copy", "", "failed", "attempt-key-copy", 1), /UNIQUE constraint failed/);
  database.prepare("UPDATE trade_crm_payment_links SET status = 'paid' WHERE id = 'attempt-2'").run();
  assert.throws(() => insert.run("attempt-4", "stripe", "cs_open-2", "https://stripe.test/open-2", "open", "attempt-key-4", 4), /UNIQUE constraint failed/);
  database.close();
});

test("a late review state defeats the replacement activation claim", () => {
  const database = new DatabaseSync(":memory:");
  apply(database, baseMigration);
  apply(database, migration);
  apply(database, accountingMigration);
  apply(database, commercialMigration);
  apply(database, attemptMigration);
  const insert = database.prepare(`INSERT INTO trade_crm_payment_links
    (id, work_order_id, firebase_uid, provider, external_id, amount_cents, checkout_url, status,
     idempotency_key, created_at, updated_at, commercial_reference, purpose, attempt_number)
    VALUES (?, 'job-1', 'owner-1', 'stripe', ?, 10000, ?, ?, ?, '2026-07-20T00:00:00.000Z',
      '2026-07-20T00:00:00.000Z', 'INV-RACE', 'invoice', ?)`);
  insert.run("prior", "cs_prior", "https://stripe.test/prior", "failed", "attempt-key-1", 1);
  insert.run("replacement", "", "", "creating", "attempt-key-2", 2);
  database.prepare("UPDATE trade_crm_payment_links SET status = 'review_required' WHERE id = 'prior'").run();
  const activation = database.prepare(`UPDATE trade_crm_payment_links SET status = 'open'
    WHERE id = 'replacement' AND status = 'creating'
      AND NOT EXISTS (SELECT 1 FROM trade_crm_payment_links review
        WHERE review.firebase_uid = 'owner-1' AND review.commercial_reference = 'INV-RACE'
          AND review.purpose = 'invoice' AND review.id <> 'replacement' AND review.status = 'review_required')
      AND EXISTS (SELECT 1 FROM trade_crm_payment_links prior
        WHERE prior.id = 'prior' AND prior.status = 'superseded' AND prior.superseded_by_id = 'replacement')`).run();
  assert.equal(activation.changes, 0);
  assert.equal(database.prepare("SELECT status FROM trade_crm_payment_links WHERE id = 'replacement'").get().status, "creating");
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
  assert.match(paymentLinks, /paymentLink\.order_id/);
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
  assert.match(reconciliation, /duplicate_commercial_payment/);
  assert.match(reconciliation, /superseded_attempt_paid/);
  assert.match(reconciliation, /other_collectible/);
  assert.match(reconciliation, /link\.status === "failed" && input\.status !== "paid"/);
  assert.match(reconciliation, /link\.status === "superseded" && input\.status !== "paid"/);
});

test("failed checkout reissue is claimed, idempotent and provider-safe", () => {
  assert.match(paymentLinks, /status IN \('creating', 'open', 'processing', 'paid'\)/);
  assert.match(paymentLinks, /`tlink-\$\{id\}`/);
  assert.match(paymentLinks, /\/expire/);
  assert.match(paymentLinks, /method: "DELETE"/);
  assert.match(paymentLinks, /superseded_by_id/);
  assert.match(paymentLinks, /activationResults\[activationIndex\]\?\.meta\.changes/);
  assert.match(paymentLinks, /closeUnclaimedCheckout/);
  assert.match(paymentLinks, /checkout_activation_claim_lost/);
  assert.match(paymentLinks, /checkout_deactivation_failed/);
  assert.match(paymentLinks, /prior\.status = 'superseded'/);
  assert.match(paymentLinks, /review\.status = 'review_required'/);
  assert.match(paymentLinks, /INSERT OR IGNORE INTO trade_work_order_events/);
  assert.match(paymentUi, /Finish \$\{label\} checkout/);
  assert.match(paymentUi, /Replace with \$\{label\}/);
  assert.match(paymentUi, /Request with Stripe/);
  assert.match(paymentUi, /Replaced after failure/);
});

test("provider checkout failures distinguish safe rejection from an uncertain response", () => {
  assert.match(paymentLinks, /class ProviderCheckoutFailure/);
  assert.match(paymentLinks, /response\.status >= 400 && response\.status < 500/);
  assert.match(paymentLinks, /checkout_transport_uncertain/);
  assert.match(paymentLinks, /checkout_response_incomplete/);
  assert.match(paymentLinks, /failure\.terminal \? "failed" : "creating"/);
  assert.match(paymentLinks, /PAYMENT_PROVIDER_REJECTED/);
  assert.match(paymentLinks, /PAYMENT_PROVIDER_UNCERTAIN/);
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
