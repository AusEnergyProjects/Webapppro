import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0079_trade_abn_access_gate.sql");
const paymentRouteUrl = new URL("../src/app/api/trade-payment-links/route.ts", import.meta.url);
const integrations = read("../src/app/api/trade-integrations/route.ts");
const callback = read("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const providerLayer = read("../src/lib/trade-integrations-server.ts");
const stripeWebhook = read("../src/app/api/stripe/webhook/route.ts");
const squareWebhook = read("../src/app/api/square/webhook/route.ts");
const paymentUi = read("../src/components/TradePaymentPanel.tsx");
const accessServer = read("../src/lib/trade-access-server.ts");

function apply(database, sql) {
  sql.split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => database.exec(statement));
}

test("the reviewed-ABN expansion adds access evidence without changing legacy state", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY,
      email text NOT NULL,
      business_name text NOT NULL,
      abn text NOT NULL,
      partner_type text NOT NULL,
      account_status text NOT NULL,
      verification_status text NOT NULL,
      plan_key text NOT NULL,
      billing_status text NOT NULL
    );
    CREATE INDEX trade_accounts_eligibility_idx
      ON trade_accounts(partner_type, account_status, verification_status, billing_status, firebase_uid);
    CREATE TABLE stripe_memberships (id text PRIMARY KEY);
    CREATE TABLE stripe_webhook_events (id text PRIMARY KEY);
    CREATE TABLE trade_membership_credits (id text PRIMARY KEY);
    CREATE TABLE trade_referrals (id text PRIMARY KEY);
    CREATE TABLE trade_referral_codes (id text PRIMARY KEY);
    CREATE TABLE trade_account_feature_grants (id text PRIMARY KEY);
    CREATE TABLE trade_crm_oauth_states (id text PRIMARY KEY, provider text NOT NULL);
    CREATE TABLE trade_crm_integrations (id text PRIMARY KEY, provider text NOT NULL);
    CREATE TABLE trade_crm_payment_events (id text PRIMARY KEY);
    CREATE TABLE trade_crm_payment_links (id text PRIMARY KEY);
    CREATE TABLE trade_work_orders (id text PRIMARY KEY);
    CREATE TABLE trade_crm_quick_invoices (id text PRIMARY KEY);
    INSERT INTO trade_accounts VALUES
      ('demo-owner', 'demo@example.test', 'Demo Trade', '51824753556', 'installer', 'active', 'approved', 'legacy_paid', 'active');
    INSERT INTO stripe_memberships VALUES ('membership-demo');
    INSERT INTO stripe_webhook_events VALUES ('event-demo');
    INSERT INTO trade_membership_credits VALUES ('credit-demo');
    INSERT INTO trade_referrals VALUES ('referral-demo');
    INSERT INTO trade_referral_codes VALUES ('code-demo');
    INSERT INTO trade_account_feature_grants VALUES ('grant-demo');
    INSERT INTO trade_crm_oauth_states VALUES ('stripe-state', 'stripe'), ('xero-state', 'xero');
    INSERT INTO trade_crm_integrations VALUES ('square-connection', 'square'), ('xero-connection', 'xero');
    INSERT INTO trade_crm_payment_events VALUES ('payment-event-demo');
    INSERT INTO trade_crm_payment_links VALUES ('checkout-demo');
    INSERT INTO trade_work_orders VALUES ('job-demo');
    INSERT INTO trade_crm_quick_invoices VALUES ('invoice-demo');
  `);

  apply(database, migration);

  const columns = database.prepare("PRAGMA table_info(trade_accounts)").all().map((row) => row.name);
  for (const column of ["verified_abn", "verification_review_id", "verification_reviewed_at", "verification_reviewed_by_uid"]) {
    assert.ok(columns.includes(column), `${column} should be added`);
  }
  assert.ok(columns.includes("plan_key"));
  assert.ok(columns.includes("billing_status"));

  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const retired of [
    "stripe_memberships",
    "stripe_webhook_events",
    "trade_membership_credits",
    "trade_referrals",
    "trade_referral_codes",
    "trade_account_feature_grants",
  ]) {
    assert.ok(tables.has(retired), `${retired} must remain until the contract release`);
  }
  assert.ok(tables.has("trade_account_verification_reviews"));
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_payment_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_payment_links").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_oauth_states").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_integrations").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_orders").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_quick_invoices").get().count, 1);
  assert.equal(database.prepare("SELECT plan_key FROM trade_accounts WHERE firebase_uid = 'demo-owner'").get().plan_key, "legacy_paid");
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN|INDEX)|DELETE FROM|UPDATE `trade_accounts`|INSERT INTO/i);
  database.close();
});

test("Sites cannot initiate or expose a checkout", () => {
  assert.equal(fs.existsSync(paymentRouteUrl), false);
  const integrationGet = integrations.slice(
    integrations.indexOf("export async function GET"),
    integrations.indexOf("export async function POST"),
  );
  assert.doesNotMatch(integrationGet, /checkout_url|checkoutUrl|external_id|externalId/);
  assert.match(paymentUi, /Financial transactions are unavailable while TLink is hosted on ChatGPT Sites/);
  assert.doesNotMatch(paymentUi, /api\/trade-payment-links|Open checkout|checkoutUrl|Request with Stripe|Request with Square/);
});

test("payment providers are absent while legacy webhooks remain safely ignored", () => {
  assert.doesNotMatch(`${providerLayer}\n${integrations}\n${callback}`, /stripe|square|PAYMENT_PROVIDERS/i);
  for (const webhook of [stripeWebhook, squareWebhook]) {
    assert.match(webhook, /ignored: true/);
    assert.match(webhook, /status: 200/);
    assert.doesNotMatch(webhook, /getD1|fetch\(|request\.text|request\.json|\.prepare\(/);
  }
});

test("free reviewed trade access has no invoice or payment dependency", () => {
  assert.doesNotMatch(accessServer, /payment|invoice|checkout|stripe|square/i);
  assert.match(accessServer, /ABN_REVIEW_REQUIRED/);
  assert.match(accessServer, /trade_account_verification_reviews/);
});

test("retired reconciliation code and prohibited dash characters are absent", () => {
  assert.equal(fs.existsSync(new URL("../src/lib/trade-payment-reconciliation.ts", import.meta.url)), false);
  for (const source of [migration, integrations, callback, stripeWebhook, squareWebhook, paymentUi]) {
    assert.doesNotMatch(source, /[\u2013\u2014]/);
  }
});
