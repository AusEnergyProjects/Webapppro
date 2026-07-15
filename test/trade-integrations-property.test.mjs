import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0020_lying_stick.sql");
const integrations = read("../src/app/api/trade-integrations/route.ts");
const callback = read("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const payments = read("../src/app/api/trade-payment-links/route.ts");
const property = read("../src/app/api/trade-property-map/route.ts");
const cryptoLayer = read("../src/lib/trade-integration-crypto.ts");
const providerLayer = read("../src/lib/trade-integrations-server.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const integrationUi = read("../src/components/TradeIntegrationCentre.tsx");
const paymentUi = read("../src/components/TradePaymentPanel.tsx");
const propertyUi = read("../src/components/TradePropertyView.tsx");

test("integration, OAuth state, payment link and property records are durable and indexed", () => {
  for (const table of ["trade_crm_integrations", "trade_crm_oauth_states", "trade_crm_payment_links", "trade_crm_property_views"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
  }
  assert.match(schema, /trade_crm_integrations_owner_provider_idx/);
  assert.match(schema, /trade_crm_oauth_states_hash_idx/);
  assert.match(schema, /trade_crm_payment_links_idempotency_idx/);
  assert.match(schema, /trade_crm_property_views_work_order_idx/);
  assert.match(schema, /encryptedCredentials: text\("encrypted_credentials"\)/);
  assert.doesNotMatch(schema, /accessToken|refreshToken/);
});

test("the integrations migration applies cleanly to SQLite", () => {
  const db = new DatabaseSync(":memory:");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_integrations", "trade_crm_oauth_states", "trade_crm_payment_links", "trade_crm_property_views"]);
});

test("all business connections are installer-only, paid, same-origin and owner scoped", () => {
  assert.match(providerLayer, /requireInstallerOperations/);
  assert.match(providerLayer, /account\.partner_type !== "installer"/);
  assert.match(providerLayer, /account\.account_status !== "active"/);
  assert.match(providerLayer, /entitlements\.features\.business_operations/);
  assert.match(integrations, /sameOrigin\(request\)/);
  assert.match(integrations, /WHERE firebase_uid = \?/);
  assert.match(payments, /sameOrigin\(request\)/);
  assert.match(property, /sameOrigin\(request\)/);
  assert.match(providerLayer, /\["xero", "myob", "stripe", "square"\]/);
});

test("OAuth credentials are encrypted and state is one-time, hashed and short-lived", () => {
  assert.match(cryptoLayer, /AES-GCM/);
  assert.match(cryptoLayer, /CRM_INTEGRATION_ENCRYPTION_KEY/);
  assert.match(cryptoLayer, /SHA-256/);
  assert.match(integrations, /integrationStateHash\(state\)/);
  assert.match(integrations, /10 \* 60 \* 1000/);
  assert.match(callback, /consumed_at = '' AND expires_at > \?/);
  assert.match(callback, /consumed_at = \?/);
  assert.match(callback, /encryptIntegrationCredentials\(credentials\)/);
  assert.doesNotMatch(`${cryptoLayer}\n${providerLayer}\n${integrations}\n${callback}`, /sk_live_|sq0csp-|client_secret\s*:\s*["'][^"']{8}/);
});

test("Xero, MYOB, Stripe and Square use their real OAuth endpoints", () => {
  assert.match(providerLayer, /login\.xero\.com\/identity\/connect\/authorize/);
  assert.match(providerLayer, /identity\.xero\.com\/connect\/token/);
  assert.match(providerLayer, /secure\.myob\.com\/oauth2\/account\/authorize/);
  assert.match(providerLayer, /secure\.myob\.com\/oauth2\/v1\/authorize/);
  assert.match(providerLayer, /connect\.stripe\.com\/oauth\/authorize/);
  assert.match(providerLayer, /connect\.stripe\.com\/oauth\/token/);
  assert.match(providerLayer, /connect\.squareup\.com\/oauth2\/authorize/);
  assert.match(callback, /api\.xero\.com\/connections/);
  assert.match(callback, /\/v2\/locations/);
});

test("online payment links are direct-customer only and provider hosted", () => {
  assert.match(payments, /job\.source_type !== "internal" \|\| job\.customer_source !== "trade_owned"/);
  assert.match(payments, /DIRECT_CUSTOMER_REQUIRED/);
  assert.match(payments, /api\.stripe\.com\/v1\/checkout\/sessions/);
  assert.match(payments, /"Stripe-Account"/);
  assert.match(payments, /online-checkout\/payment-links/);
  assert.match(payments, /Idempotency-Key/);
  assert.match(payments, /idempotency_key/);
  assert.match(paymentUi, /AEA protected payment path/);
  assert.match(paymentUi, /Card data stays with Stripe or Square/);
});

test("Google property tools never reveal or search an AEA protected address", () => {
  assert.match(property, /row\.source_type !== "internal" \|\| row\.customer_source !== "trade_owned"/);
  assert.match(property, /DIRECT_CUSTOMER_REQUIRED/);
  assert.match(property, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
  assert.match(property, /maps\.googleapis\.com\/maps\/api\/staticmap/);
  assert.match(property, /maptype", "satellite"/);
  assert.match(property, /place_id/);
  assert.doesNotMatch(property, /body\.address|body\.latitude|body\.longitude/);
  assert.doesNotMatch(schema.match(/tradeCrmPropertyViews[\s\S]*?\]\);/)?.[0] || "", /latitude|longitude|formatted_address/);
  assert.match(propertyUi, /Exact property tools are unavailable/);
  assert.match(propertyUi, /never the customer&apos;s street address/);
});

test("installer CRM exposes progressive integrations, property and payment workflows", () => {
  for (const label of ["integrations", "Property", "Quote and invoice"]) assert.match(crm, new RegExp(label));
  assert.match(crm, /TradeIntegrationCentre/);
  assert.match(crm, /TradePropertyView/);
  assert.match(crm, /TradePaymentPanel/);
  for (const label of ["Xero", "MYOB", "Stripe", "Square", "Google property tools"]) assert.match(integrationUi, new RegExp(label));
  assert.match(integrationUi, /never asks for or stores the provider password/);
  assert.match(propertyUi, /Each search is deliberate|Search only when it helps the job/);
});

test("new integration and property copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${integrations}\n${callback}\n${payments}\n${property}\n${crm}\n${integrationUi}\n${paymentUi}\n${propertyUi}`, /[\u2013\u2014]/);
});
