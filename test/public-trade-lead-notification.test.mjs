import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  OPPORTUNITY_INBOX_URL,
  opportunityNotificationDraft,
} from "../src/lib/opportunity-notifications.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const deliveryServer = read("../src/lib/opportunity-notification-server.ts");
const migration = read("../drizzle/0087_trade_opportunity_notifications.sql");
const worker = read("../worker/index.ts");

test("public lead notification omits name and message when the customer supplied neither", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Example Energy",
    sourceKind: "public_plan_enquiry",
    customerName: "",
    customerMessage: "",
    suburb: "Private suburb",
    postcode: "3000",
    state: "VIC",
    matchedCategories: ["heating-cooling", "hot-water"],
    timing: "within_3_months",
    expiresAt: "2026-09-09T00:00:00.000Z",
    customerSharedEvidenceCount: 99,
  });
  for (const value of [
    "Postcode: 3000",
    "Selected services: Heating and cooling, Hot water",
    OPPORTUNITY_INBOX_URL,
    "private home plan is not shared with trades",
  ]) assert.match(draft.body, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(draft.body, /Customer:|Customer message:/);
  assert.doesNotMatch(draft.body, /private suburb|customer-shared evidence|complete privacy-safe customer plan/i);
  assert.doesNotMatch(draft.body, /jamie@example\.test|0400000000|street|unit address|bill|meter|document/i);
  assert.ok(draft.subject.length <= 160 && draft.body.length <= 1800);
});

test("public lead notification includes a shared name and the customer's written message", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Example Energy",
    sourceKind: "public_plan_enquiry",
    customerName: "Jamie Example",
    customerMessage: "Please call after 4 pm.",
    suburb: "Private suburb",
    postcode: "3000",
    state: "VIC",
    matchedCategories: ["heating-cooling"],
    timing: "within_3_months",
    expiresAt: "2026-09-09T00:00:00.000Z",
    customerSharedEvidenceCount: 99,
  });
  assert.match(draft.body, /Customer: Jamie Example/);
  assert.match(draft.body, /Customer message: Please call after 4 pm\./);
  assert.doesNotMatch(draft.body, /Private suburb|jamie@example\.test|0400000000/i);
});

test("public notification dispatch rechecks the exact current consent and reads no private plan fields", () => {
  for (const boundary of [
    "public_trade_lead_contact_releases public_contact",
    "public_contact.notice_version public_contact_notice_version",
    "public_contact.consent_purpose public_contact_consent_purpose",
    "PUBLIC_PLAN_CONSENT_NOTICE_VERSION",
    "PUBLIC_PLAN_CONSENT_PURPOSE",
    "public_contact.withdrawn_at public_contact_withdrawn_at",
    "public_contact.disclosed_fields public_contact_disclosed_fields",
    "sourceKind:",
    "public_customer_name",
    "public_customer_message",
  ]) assert.match(deliveryServer, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(deliveryServer, /verifiedTradeAccountPredicate\("account"\)/);
  assert.match(deliveryServer, /current_account\.partner_type = 'installer'/);
  assert.match(deliveryServer, /!disclosedFields\.includes\("customer_email"\)/);
  assert.match(deliveryServer, /!disclosedFields\.includes\("postcode"\)/);
  assert.match(deliveryServer, /!disclosedFields\.includes\("service_categories"\)/);
  assert.match(deliveryServer, /const publicDisclosedFields = new Set/);
  assert.match(deliveryServer, /publicDisclosedFields\.has\("customer_name"\)/);
  assert.match(deliveryServer, /publicDisclosedFields\.has\("customer_message"\)/);
  assert.match(deliveryServer, /sharesAddress && !hasAddress/);
  assert.match(deliveryServer, /public_contact_has_address/);
  assert.doesNotMatch(deliveryServer, /public_contact\.customer_address public_customer_address/);
  assert.doesNotMatch(deliveryServer, /trade_capability|public_capability_current|service qualification/i);
  assert.doesNotMatch(deliveryServer, /public_contact\.(customer_email|customer_phone)\s+public_/);
  assert.doesNotMatch(deliveryServer, /public_contact\.(address_line|plan_snapshot|bill_data|meter_data|documents)/);
});

test("every inserted match has one durable queued notification and the minute drain retries failures", () => {
  assert.match(migration, /CREATE TRIGGER `trade_opportunity_matches_notification_enqueue`/);
  assert.match(migration, /AFTER INSERT ON `trade_opportunity_matches`/);
  assert.match(migration, /INSERT OR IGNORE INTO `trade_opportunity_notification_deliveries`/);
  assert.match(deliveryServer, /SET status = 'failed'.*next_attempt_at = \?/s);
  assert.match(deliveryServer, /serviceReminderRetryAt\(attempts\)/);
  assert.match(worker, /const NOTIFICATION_DELIVERY_CRON = "\* \* \* \* \*"/);
  assert.match(worker, /drainOpportunityNotificationDeliveries\(\)/);
});
