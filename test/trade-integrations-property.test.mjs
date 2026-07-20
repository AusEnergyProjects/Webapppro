import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calendarIntegrationState, calendarIntegrationStateWeekStart } from "../src/lib/trade-integration-state.ts";
import { readIntegrationReturn } from "../src/lib/trade-integration-return.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0020_lying_stick.sql");
const integrations = read("../src/app/api/trade-integrations/route.ts");
const callback = read("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const accounting = read("../src/app/api/trade-accounting/route.ts");
const payments = read("../src/app/api/trade-payment-links/route.ts");
const cryptoLayer = read("../src/lib/trade-integration-crypto.ts");
const providerLayer = read("../src/lib/trade-integrations-server.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const integrationUi = read("../src/components/TradeIntegrationCentre.tsx");
const integrationReturn = read("../src/lib/trade-integration-return.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const schedule = read("../src/components/TradeScheduleWorkspace.tsx");
const paymentUi = read("../src/components/TradePaymentPanel.tsx");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const fieldUi = read("../src/components/TradeFieldWorkPanel.tsx");
const fieldMigration = read("../drizzle/0023_petite_the_phantom.sql");
const propertyRetirementMigration = read("../drizzle/0024_lethal_purifiers.sql");

test("calendar OAuth preserves only a validated selected week", () => {
  const nonce = "a".repeat(43);
  const state = calendarIntegrationState(nonce, "2026-08-03");
  assert.equal(state, `v1.2026-08-03.${nonce}`);
  assert.equal(calendarIntegrationStateWeekStart(state), "2026-08-03");
  assert.equal(calendarIntegrationStateWeekStart(`v1.2026-08-04.${nonce}`), "");
  assert.throws(() => calendarIntegrationState(nonce, "2026-08-04"), /INVALID_WEEK/);
  assert.deepEqual(readIntegrationReturn("?integration=google_calendar&integration_status=connected&integration_week_start=2026-08-03"), {
    provider: "google_calendar", status: "connected", weekStart: "2026-08-03",
  });
  assert.deepEqual(readIntegrationReturn("?integration=microsoft_calendar&integration_status=connected&integration_week_start=2026-08-04"), {
    provider: "microsoft_calendar", status: "connected",
  });
});

test("integration, OAuth state and payment link records are durable and indexed", () => {
  for (const table of ["trade_crm_integrations", "trade_crm_oauth_states", "trade_crm_payment_links"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
  }
  assert.match(schema, /trade_crm_integrations_owner_provider_idx/);
  assert.match(schema, /trade_crm_oauth_states_hash_idx/);
  assert.match(schema, /trade_crm_payment_links_idempotency_idx/);
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

test("all business and calendar connections are installer-only, paid, same-origin and owner scoped", () => {
  assert.match(providerLayer, /requireInstallerOperations/);
  assert.match(providerLayer, /account\.partner_type !== "installer"/);
  assert.match(providerLayer, /account\.account_status !== "active"/);
  assert.match(providerLayer, /entitlements\.features\.business_operations/);
  assert.match(integrations, /sameOrigin\(request\)/);
  assert.match(integrations, /WHERE firebase_uid = \?/);
  assert.match(payments, /sameOrigin\(request\)/);
  assert.match(providerLayer, /\["xero", "myob", "quickbooks", "stripe", "square", "google_calendar", "microsoft_calendar"\]/);
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

test("OAuth callback failures emit only bounded operational diagnostics", () => {
  assert.match(callback, /callbackFailureDetails\(provider, error\)/);
  assert.match(callback, /stage: error\.stage/);
  assert.match(callback, /failure: error\.message/);
  assert.match(callback, /providerCode: error\.providerCode/);
  assert.match(callback, /responseStatus: error\.responseStatus/);
  assert.match(callback, /TOKEN_EXCHANGE_REJECTED/);
  assert.match(callback, /ACCOUNT_LOOKUP_FAILED/);
  assert.match(callback, /AUTHORIZATION_REJECTED/);
  assert.match(callback, /\[result\.error, result\.error_code, result\.code, nested\.code, nested\.category\]/);
  assert.doesNotMatch(callback, /error_description|error_uri|nested\.detail/);
  assert.doesNotMatch(callback, /console\.error\([^;]*(?:url\.searchParams|request\.url|\btoken\b|\bpayload\b|\bdecoded\b)/i);
});

test("Xero, MYOB, QuickBooks, Stripe and Square use their real OAuth endpoints", () => {
  assert.match(providerLayer, /login\.xero\.com\/identity\/connect\/authorize/);
  assert.match(providerLayer, /identity\.xero\.com\/connect\/token/);
  assert.match(providerLayer, /secure\.myob\.com\/oauth2\/account\/authorize/);
  assert.match(providerLayer, /secure\.myob\.com\/oauth2\/v1\/authorize/);
  assert.match(providerLayer, /appcenter\.intuit\.com\/connect\/oauth2/);
  assert.match(providerLayer, /oauth\.platform\.intuit\.com\/oauth2\/v1\/tokens\/bearer/);
  assert.match(providerLayer, /com\.intuit\.quickbooks\.accounting/);
  assert.match(callback, /realmId/);
  assert.match(providerLayer, /connect\.stripe\.com\/oauth\/authorize/);
  assert.match(providerLayer, /connect\.stripe\.com\/oauth\/token/);
  assert.match(providerLayer, /connect\.squareup\.com\/oauth2\/authorize/);
  assert.match(providerLayer, /accounting\.invoices/);
  assert.doesNotMatch(providerLayer, /accounting\.transactions/);
  assert.match(callback, /api\.xero\.com\/connections/);
  assert.match(callback, /\/v2\/locations/);
});

test("MYOB token exchange repeats the granted accounting scopes", () => {
  assert.match(callback, /provider === "myob"\) body\.set\("scope", setting\.scopes\.join\(" "\)\)/);
});

test("Xero binds the tenant and disconnect identity to the current authentication event", () => {
  assert.match(callback, /authentication_event_id/);
  assert.match(callback, /connections\.find\(\(item\) => cleanAdminText\(item\.authEventId, 180\) === authenticationEventId\)/);
  assert.match(callback, /externalMetadata: \{ tenantId, connectionId \}/);
  assert.match(callback, /credentials\.external_metadata = account\.externalMetadata/);
  assert.match(accounting, /external_metadata: credentials\.external_metadata/);
  assert.match(integrations, /externalMetadata\.connectionId/);
  assert.match(integrations, /activeXeroRevocationCredentials/);
  assert.match(integrations, /matchingConnection\?\.id/);
  assert.match(integrations, /The TLink connection was kept so you can try again safely/);
  assert.match(integrations, /connections\/\$\{encodeURIComponent\(xeroConnectionId\)\}/);
  assert.doesNotMatch(integrations, /connections\/\$\{encodeURIComponent\(String\(row\.external_account_id\)\)\}/);
});

test("provider readiness requires matching platform and payment reconciliation credentials", () => {
  assert.match(providerLayer, /STRIPE_CONNECT_SECRET_KEY/);
  assert.match(providerLayer, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(providerLayer, /SQUARE_WEBHOOK_SIGNATURE_KEY/);
  assert.match(providerLayer, /SQUARE_WEBHOOK_NOTIFICATION_URL/);
  assert.match(providerLayer, /providerConfigured/);
  assert.doesNotMatch(providerLayer, /STRIPE_REFERRAL_SECRET_KEY/);
  assert.match(integrations, /providerConfigured\(providerValue\)/);
  assert.match(payments, /providerConfigured\(provider\)/);
});

test("installer connection returns are validated, routed and confirmed", () => {
  assert.match(integrationReturn, /INTEGRATION_RETURN_PROVIDERS/);
  assert.match(integrationReturn, /status !== "connected" && status !== "cancelled" && status !== "failed"/);
  assert.match(dashboard, /readIntegrationReturn\(window\.location\.search\)/);
  assert.match(dashboard, /id: "integrations"/);
  assert.match(crm, /navigationTarget\.id === "integrations"/);
  assert.match(integrationUi, /connection could not be verified/);
  assert.match(integrationUi, /clearIntegrationReturnFromAddress/);
  assert.match(schedule, /firstSyncResponse/);
  assert.match(schedule, /first calendar sync needs another try/);
  assert.match(integrations, /newIntegrationState\(returnWeekStart\)/);
  assert.match(callback, /calendarIntegrationStateWeekStart\(state\)/);
  assert.match(callback, /integration_week_start/);
  assert.match(schedule, /JSON\.stringify\(\{ provider: provider\.provider, weekStart \}\)/);
  assert.match(schedule, /returned\.weekStart \? returned\.weekStart : monday\(\)/);
});

test("installer UI hides central application credentials and exposes truthful states", () => {
  assert.doesNotMatch(integrations, /callbackUrl:/);
  assert.doesNotMatch(integrationUi, /Administrator setup|callbackUrl|client credentials|Sites/);
  assert.match(integrationUi, /Available to connect/);
  assert.match(integrationUi, /TLink setup in progress/);
  assert.match(integrationUi, /disabled=\{Boolean\(busy\)/);
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
  assert.match(paymentUi, /Card data stays with the payment provider/);
});

test("field records are owner or assigned-team scoped and protected customer sign-off stays with AEA", () => {
  for (const table of ["trade_crm_time_entries", "trade_crm_job_media", "trade_crm_signoffs"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(fieldMigration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(fieldRoute, /requireInstallerTeamAccess/);
  assert.match(fieldRoute, /assignedJob/);
  assert.match(fieldRoute, /sameOrigin\(request\)/);
  assert.match(fieldRoute, /firebase_uid = \?/);
  assert.match(fieldRoute, /job\.source_type === "opportunity" && signerRole === "customer"/);
  assert.match(fieldRoute, /PROTECTED_CUSTOMER/);
  assert.match(fieldUi, /Customer sign-off stays with AEA/);
  assert.match(fieldUi, /Technician time/);
  assert.match(fieldUi, /Photos and files/);
  assert.match(fieldUi, /Digital sign-off/);
});

test("retired Google property storage is removed from the active schema", () => {
  assert.doesNotMatch(schema, /trade_crm_property_views|place_id/);
  assert.match(propertyRetirementMigration, /DROP TABLE `trade_crm_property_views`/);
  assert.doesNotMatch(`${providerLayer}\n${integrations}\n${crm}\n${integrationUi}`, /GOOGLE_MAPS_API_KEY|trade-property-map|TradePropertyView/);
});

test("installer CRM exposes progressive integrations, field and payment workflows", () => {
  for (const label of ["integrations", "Field work", "Quote", "Invoice"]) assert.match(crm, new RegExp(label));
  assert.match(crm, /TradeIntegrationCentre/);
  assert.match(crm, /TradeFieldWorkPanel/);
  assert.match(crm, /TradeCommercialHandoffPanel/);
  for (const label of ["Xero", "MYOB", "QuickBooks", "Stripe", "Square"]) assert.match(integrationUi, new RegExp(label));
  assert.match(integrationUi, /never asks for or stores the provider password/);
  assert.doesNotMatch(`${providerLayer}\n${integrationUi}\n${crm}`, /GOOGLE_MAPS_API_KEY|Google property tools|TradePropertyView/);
});

test("new integration and field copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${integrations}\n${callback}\n${payments}\n${crm}\n${integrationUi}\n${paymentUi}\n${fieldRoute}\n${fieldUi}`, /[\u2013\u2014]/);
});
