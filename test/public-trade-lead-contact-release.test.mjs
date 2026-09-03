import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  isRecognizedPublicPlanContactReleaseConsent,
  publicPlanContactReleaseAccessSql,
  publicPlanContactReleaseConsentSql,
  publicPlanContactReleaseDisclosedFieldsAreValid,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
} from "../src/lib/quick-upgrade-enquiry.mjs";
import { projectPublicMarketplaceEnquiry } from "../src/lib/public-marketplace-enquiry-projection.mjs";

const LEGACY_V4_NOTICE = "2026-08-10-customer-selected-trade-sharing-v4";
const LEGACY_V4_PURPOSE =
  "Share my email, postcode, service and any message I write with all approved TLink trades in my area, plus chosen name or phone, and email my private plan";
const LEGACY_V6_NOTICE = "2026-08-10-structured-service-address-sharing-v6";
const LEGACY_V6_PURPOSE =
  "Share my email, postcode, services and message with all approved TLink trades in my area, plus name, phone or full service address, and email my private plan";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const baseMigration = read("../drizzle/0126_public_trade_lead_contact_release.sql");
const addressMigration = read("../drizzle/0127_public_trade_lead_customer_address.sql");
const schema = read("../db/schema.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");
const tradeLeadAccess = read("../src/lib/public-trade-lead-access.mjs");
const tradeEnquiriesRoute = read("../src/app/api/trade-enquiries/route.ts");
const adminMatchesRoute = read("../src/app/api/admin/opportunities/matches/route.ts");
const tradeDashboard = read("../src/components/DirectTradeDashboard.tsx");

function apply(database, sql) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

function createOpportunitySourceTable(database) {
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY,
    source_reference text NOT NULL DEFAULT ''
  );
  CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY,
    opportunity_id text NOT NULL,
    firebase_uid text NOT NULL,
    status text NOT NULL DEFAULT 'offered',
    matched_at text NOT NULL,
    UNIQUE (opportunity_id, firebase_uid)
  );`);
}

function disclosedContactForTrade(database, firebaseUid) {
  const disclosureJson = "CASE WHEN json_valid(release.disclosed_fields) THEN release.disclosed_fields ELSE '[]' END";
  return database.prepare(`SELECT
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_name')
        THEN release.customer_first_name ELSE '' END customer_first_name,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_name')
        THEN release.customer_last_name ELSE '' END customer_last_name,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_email')
        THEN release.customer_email ELSE '' END customer_email,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_phone')
        THEN release.customer_phone ELSE '' END customer_phone,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_address')
        THEN release.customer_unit_number ELSE '' END customer_unit_number,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_address')
        THEN release.customer_street_address ELSE '' END customer_street_address,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_address')
        THEN release.customer_suburb ELSE '' END customer_suburb,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_address')
        THEN release.customer_address_state ELSE '' END customer_address_state,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'postcode')
        THEN release.postcode ELSE '' END postcode,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_message')
        THEN release.customer_message ELSE '' END customer_message
    FROM trade_opportunity_matches allocation
    JOIN public_trade_lead_contact_releases release
      ON release.opportunity_id = allocation.opportunity_id AND release.status = 'active'
    WHERE allocation.firebase_uid = ?
      AND EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_email')
      AND EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'postcode')
      AND EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'service_categories')`)
    .get(firebaseUid);
}

function marketplaceSyncSql() {
  const sql = opportunityServer.match(
    /export async function syncMarketplaceEnquiries[\s\S]*?db\.prepare\(`([\s\S]*?)`\)\s*\.bind/,
  )?.[1];
  assert.ok(sql, "marketplace sync SQL must be extractable for execution");
  return sql
    .replace(
      '${publicPlanContactReleaseAccessSql("contact")}',
      publicPlanContactReleaseAccessSql("contact"),
    )
    .replaceAll("${PUBLIC_PLAN_CONSENT_NOTICE_VERSION}", PUBLIC_PLAN_CONSENT_NOTICE_VERSION)
    .replaceAll("${PUBLIC_PLAN_CONSENT_PURPOSE}", PUBLIC_PLAN_CONSENT_PURPOSE)
    .replace(
      '${verifiedTradeAccountPredicate("current_trade_account")}',
      "current_trade_account.status = 'approved'",
    );
}

function marketplaceReadAccessSql() {
  const sql = tradeEnquiriesRoute.match(
    /const currentPublicMarketplaceAccessSql = \(enquiryAlias: string\) => `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(sql, "marketplace read-access SQL must be extractable for execution");
  return sql
    .replaceAll("${enquiryAlias}", "enquiry")
    .replace(
      '${publicPlanContactReleaseAccessSql("current_public_release")}',
      publicPlanContactReleaseAccessSql("current_public_release"),
    )
    .replace(
      '${verifiedTradeAccountPredicate("current_public_account")}',
      "current_public_account.status = 'approved'",
    );
}

function marketplaceProjectionSql() {
  const sql = tradeEnquiriesRoute.match(
    /const publicMarketplaceProjectionSql = `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(sql, "marketplace contact projection SQL must be extractable for execution");
  return sql;
}

function marketplaceReadJoinsSql() {
  const sql = tradeEnquiriesRoute.match(
    /const publicMarketplaceReadJoins = \(enquiryAlias: string\) => `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(sql, "marketplace read joins must be extractable for execution");
  return sql.replaceAll("${enquiryAlias}", "enquiry");
}

function marketplaceSearchTextSql() {
  const sql = tradeEnquiriesRoute.match(
    /const enquirySearchTextSql = \(enquiryAlias: string\) => `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(sql, "enquiry search text SQL must be extractable for execution");
  return sql.replaceAll("${enquiryAlias}", "enquiry");
}

test("stored public contact releases accept only recognized policy and field pairs", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE releases (
    id text PRIMARY KEY,
    notice_version text NOT NULL,
    consent_purpose text NOT NULL,
    disclosed_fields text NOT NULL,
    customer_email text NOT NULL DEFAULT 'customer@example.test',
    postcode text NOT NULL DEFAULT '3000'
  )`);
  const insert = database.prepare(`INSERT INTO releases
    (id, notice_version, consent_purpose, disclosed_fields) VALUES (?, ?, ?, ?)`);
  const required = ["customer_email", "postcode", "service_categories"];
  const quickRequired = ["postcode", "service_categories", "customer_address"];
  insert.run("v4-good", LEGACY_V4_NOTICE, LEGACY_V4_PURPOSE, JSON.stringify([
    ...required,
    "customer_name",
    "customer_phone",
    "customer_message",
  ]));
  insert.run("v6-good", LEGACY_V6_NOTICE, LEGACY_V6_PURPOSE, JSON.stringify([
    ...required,
    "customer_address",
  ]));
  insert.run("v7-good", PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE, JSON.stringify(required));
  insert.run("quick-good", QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE, JSON.stringify([
    ...quickRequired,
  ]));
  insert.run("quick-v1-good", LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION, LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE, JSON.stringify([
    ...required,
    "customer_address",
  ]));
  insert.run("quick-missing-address", QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE, JSON.stringify(quickRequired.slice(0, 2)));
  insert.run("wrong-purpose", LEGACY_V6_NOTICE, LEGACY_V4_PURPOSE, JSON.stringify(required));
  insert.run("unknown-version", "2026-08-10-unknown-v5", LEGACY_V6_PURPOSE, JSON.stringify(required));
  insert.run("malformed-fields", LEGACY_V6_NOTICE, LEGACY_V6_PURPOSE, "not-json");
  insert.run("missing-services", LEGACY_V6_NOTICE, LEGACY_V6_PURPOSE, JSON.stringify(required.slice(0, 2)));
  insert.run("v4-address-overreach", LEGACY_V4_NOTICE, LEGACY_V4_PURPOSE, JSON.stringify([
    ...required,
    "customer_address",
  ]));
  insert.run("duplicate-field", LEGACY_V6_NOTICE, LEGACY_V6_PURPOSE, JSON.stringify([
    ...required,
    "customer_email",
  ]));

  const eligible = database.prepare(`SELECT id FROM releases release
    WHERE ${publicPlanContactReleaseAccessSql("release")} ORDER BY id`)
    .all().map((row) => row.id);
  assert.deepEqual(eligible, ["quick-good", "quick-v1-good", "v4-good", "v6-good", "v7-good"]);
  const recognizedConsentPairs = database.prepare(`SELECT id FROM releases release
    WHERE ${publicPlanContactReleaseConsentSql("release")} ORDER BY id`)
    .all().map((row) => row.id);
  assert.deepEqual(recognizedConsentPairs, [
    "duplicate-field",
    "malformed-fields",
    "missing-services",
    "quick-good",
    "quick-missing-address",
    "quick-v1-good",
    "v4-address-overreach",
    "v4-good",
    "v6-good",
    "v7-good",
  ]);
  assert.equal(isRecognizedPublicPlanContactReleaseConsent(LEGACY_V6_NOTICE, LEGACY_V6_PURPOSE), true);
  assert.equal(isRecognizedPublicPlanContactReleaseConsent(LEGACY_V6_NOTICE, LEGACY_V4_PURPOSE), false);
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    LEGACY_V4_NOTICE,
    LEGACY_V4_PURPOSE,
    [...required, "customer_address"],
  ), false);
  database.close();
});

test("a public contact release stores the private admin address without adding plan or usage data", () => {
  const database = new DatabaseSync(":memory:");
  createOpportunitySourceTable(database);
  apply(database, baseMigration);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases
      (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
       disclosed_fields, customer_name, customer_email, customer_phone, postcode,
       customer_message, granted_at, withdrawn_at, created_at, updated_at)
      VALUES ('legacy-release', 'legacy-opportunity', 'AEA-LEGACY', 'active', 'legacy-notice',
        'legacy-purpose', '[]', 'Jamie Example Family', 'jamie@example.test', '0400000000',
        '3000', '', '2026-08-10T04:00:00.000Z', '', '2026-08-10T04:00:00.000Z',
        '2026-08-10T04:00:00.000Z')`).run();
  apply(database, addressMigration);
  const columns = database
    .prepare("PRAGMA table_info(public_trade_lead_contact_releases)")
    .all()
    .map((column) => column.name);
  for (const prohibited of [
    "address_line_1",
    "address_line_2",
    "suburb",
    "plan_snapshot",
    "bill_data",
    "meter_data",
    "documents",
  ]) assert.equal(columns.includes(prohibited), false, prohibited);
  for (const allowed of [
    "customer_first_name",
    "customer_last_name",
    "customer_name",
    "customer_email",
    "customer_phone",
    "customer_unit_number",
    "customer_street_address",
    "customer_suburb",
    "customer_address_state",
    "postcode",
    "customer_message",
    "notice_version",
    "consent_purpose",
    "disclosed_fields",
    "granted_at",
  ]) assert.equal(columns.includes(allowed), true, allowed);
  assert.equal(columns.includes("customer_name"), true);
  assert.deepEqual({ ...database.prepare(`SELECT customer_name, customer_first_name, customer_last_name
    FROM public_trade_lead_contact_releases WHERE id = 'legacy-release'`).get() }, {
    customer_name: "Jamie Example Family",
    customer_first_name: "Jamie",
    customer_last_name: "Example Family",
  });
  assert.match(schema, /sqliteTable\("public_trade_lead_contact_releases"/);
  assert.match(schema, /customerName: text\("customer_name"\)\.notNull\(\)/);
  assert.match(
    schema,
    /customerFirstName: text\("customer_first_name"\)\.notNull\(\)\.default\(""\)/,
  );
  assert.match(
    schema,
    /customerLastName: text\("customer_last_name"\)\.notNull\(\)\.default\(""\)/,
  );
  assert.match(schema, /trade_opportunities_source_reference_idx/);
  assert.match(baseMigration, /CREATE UNIQUE INDEX `trade_opportunities_source_reference_idx`/);
  assert.match(baseMigration, /WHERE `source_reference` <> ''/);
  for (const column of [
    "customer_first_name",
    "customer_last_name",
    "customer_unit_number",
    "customer_street_address",
    "customer_suburb",
    "customer_address_state",
  ]) assert.match(addressMigration, new RegExp(`ADD .${column}. text DEFAULT '' NOT NULL`));
  database.close();
});

test("every allocated trade sees routing fields and written notes while name and phone remain independently optional", () => {
  const database = new DatabaseSync(":memory:");
  createOpportunitySourceTable(database);
  apply(database, baseMigration);
  apply(database, addressMigration);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases
    (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
     disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone, customer_unit_number,
     customer_street_address, customer_suburb, customer_address_state, postcode,
     customer_message, granted_at, withdrawn_at, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
    .run(
      "release-1",
      "opportunity-1",
      "AEA-20260810-EXAMPLE",
      "2026-08-10",
      "Share my selected contact details with every verified matching trade",
      JSON.stringify([
        "customer_email",
        "postcode",
        "service_categories",
        "customer_message",
      ]),
      "Jamie Example",
      "Jamie",
      "Example",
      "jamie@example.test",
      "0400000000",
      "Unit 4",
      "15 Example Street",
      "MELBOURNE",
      "VIC",
      "3000",
      "Please call after 4 pm.",
      "2026-08-10T04:00:00.000Z",
      "2026-08-10T04:00:00.000Z",
      "2026-08-10T04:00:00.000Z",
    );
  const insertMatch = database.prepare(
    "INSERT INTO trade_opportunity_matches (id, opportunity_id, firebase_uid, matched_at) VALUES (?, 'opportunity-1', ?, '2026-08-10T04:00:00.000Z')",
  );
  insertMatch.run("match-a", "trade-a");
  insertMatch.run("match-b", "trade-b");
  assert.deepEqual({ ...disclosedContactForTrade(database, "trade-a") }, {
    customer_first_name: "",
    customer_last_name: "",
    customer_email: "jamie@example.test",
    customer_phone: "",
    customer_unit_number: "",
    customer_street_address: "",
    customer_suburb: "",
    customer_address_state: "",
    postcode: "3000",
    customer_message: "Please call after 4 pm.",
  });
  const changeDisclosure = database.prepare(
    "UPDATE public_trade_lead_contact_releases SET disclosed_fields = ? WHERE id = 'release-1'",
  );
  changeDisclosure.run(JSON.stringify([
    "customer_email", "postcode", "service_categories", "customer_message", "customer_name",
  ]));
  assert.deepEqual({ ...disclosedContactForTrade(database, "trade-a") }, {
    customer_first_name: "Jamie",
    customer_last_name: "Example",
    customer_email: "jamie@example.test",
    customer_phone: "",
    customer_unit_number: "",
    customer_street_address: "",
    customer_suburb: "",
    customer_address_state: "",
    postcode: "3000",
    customer_message: "Please call after 4 pm.",
  });
  changeDisclosure.run(JSON.stringify([
    "customer_email", "postcode", "service_categories", "customer_message", "customer_name", "customer_phone", "customer_address",
  ]));
  assert.deepEqual({ ...disclosedContactForTrade(database, "trade-a") }, {
    customer_first_name: "Jamie",
    customer_last_name: "Example",
    customer_email: "jamie@example.test",
    customer_phone: "0400000000",
    customer_unit_number: "Unit 4",
    customer_street_address: "15 Example Street",
    customer_suburb: "MELBOURNE",
    customer_address_state: "VIC",
    postcode: "3000",
    customer_message: "Please call after 4 pm.",
  });
  assert.equal(disclosedContactForTrade(database, "trade-not-allocated"), undefined);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_opportunity_matches allocation
    JOIN public_trade_lead_contact_releases release
      ON release.opportunity_id = allocation.opportunity_id AND release.status = 'active'
    WHERE allocation.firebase_uid = ?`).get("trade-not-allocated").count, 0);
  assert.throws(() => database.prepare(`INSERT INTO public_trade_lead_contact_releases
    (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
     disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone, customer_unit_number,
     customer_street_address, customer_suburb, customer_address_state, postcode,
     customer_message, granted_at, withdrawn_at, created_at, updated_at)
    SELECT 'release-duplicate', opportunity_id, 'AEA-OTHER', status, notice_version,
      consent_purpose, disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone,
      customer_unit_number, customer_street_address, customer_suburb, customer_address_state,
      postcode, customer_message, granted_at, withdrawn_at, created_at, updated_at
    FROM public_trade_lead_contact_releases WHERE id = 'release-1'`).run(), /UNIQUE constraint failed/);
  database.close();
});

test("public CRM lead storage stays pseudonymous while reads project only the current exact release", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunities (
      id text PRIMARY KEY, source_reference text NOT NULL DEFAULT '', postcode text NOT NULL,
      state text NOT NULL, summary text NOT NULL, priority text NOT NULL,
      status text NOT NULL, expires_at text NOT NULL
    );
    CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY, opportunity_id text NOT NULL, firebase_uid text NOT NULL,
      status text NOT NULL, matched_categories text NOT NULL, matched_at text NOT NULL, updated_at text NOT NULL,
      UNIQUE (opportunity_id, firebase_uid)
    );
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY, partner_type text NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_crm_enquiries (
      id text PRIMARY KEY, firebase_uid text NOT NULL, source_type text NOT NULL,
      source_reference text NOT NULL, external_record_id text NOT NULL, opportunity_match_id text NOT NULL,
      status text NOT NULL, customer_type text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
      business_name text NOT NULL DEFAULT '',
      email text NOT NULL, phone text NOT NULL, address_line_1 text NOT NULL, address_line_2 text NOT NULL,
      suburb text NOT NULL, address_state text NOT NULL, postcode text NOT NULL,
      service_category text NOT NULL, service_categories text NOT NULL,
      description text NOT NULL, urgency text NOT NULL, service_region text NOT NULL,
      protected_source integer NOT NULL, duplicate_decision text NOT NULL, record_status text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL,
      UNIQUE (firebase_uid, source_type, source_reference)
    );`);
  apply(database, baseMigration);
  apply(database, addressMigration);
  database.exec(`INSERT INTO trade_opportunities
      (id, source_reference, postcode, state, summary, priority, status, expires_at)
      VALUES ('opportunity-1', 'AEA-20260810-CRM', '3000', 'VIC', 'Customer project.', 'standard', 'open', '2099-08-10T04:00:00.000Z');
    INSERT INTO trade_accounts (firebase_uid, partner_type, status)
      VALUES ('trade-a', 'installer', 'approved');
    INSERT INTO trade_opportunity_matches
      (id, opportunity_id, firebase_uid, status, matched_categories, matched_at, updated_at)
      VALUES ('match-a', 'opportunity-1', 'trade-a', 'interested', '["solar","battery"]',
        '2026-08-10T04:00:00.000Z', '2026-08-10T04:00:00.000Z');`);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases
      (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
       disclosed_fields, customer_name, customer_first_name, customer_last_name, customer_email, customer_phone, customer_unit_number,
       customer_street_address, customer_suburb, customer_address_state,
       postcode, customer_message, granted_at, withdrawn_at, created_at, updated_at)
      VALUES ('release-1', 'opportunity-1', 'AEA-20260810-CRM', 'active', ?, ?, ?,
        'Jamie Example', 'Jamie', 'Example', 'jamie@example.test', '0400000000', 'Unit 4',
        '15 Example Street', 'MELBOURNE', 'VIC',
        '3000', 'Solar and battery help please.', '2026-08-10T04:00:00.000Z', '',
        '2026-08-10T04:00:00.000Z', '2026-08-10T04:00:00.000Z')`)
    .run(
      LEGACY_V6_NOTICE,
      LEGACY_V6_PURPOSE,
      JSON.stringify(["customer_email", "postcode", "service_categories", "customer_message"]),
    );
  const sync = database.prepare(marketplaceSyncSql());
  sync.run("opportunity-1", "", "");
  assert.deepEqual({ ...database.prepare(`SELECT first_name, last_name, email, phone, address_line_1, address_line_2, suburb, address_state, postcode,
      service_categories, description, protected_source, duplicate_decision FROM trade_crm_enquiries`).get() }, {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address_line_1: "",
    address_line_2: "",
    suburb: "",
    address_state: "",
    postcode: "",
    service_categories: '["solar","battery"]',
    description: "Customer project.",
    protected_source: 1,
    duplicate_decision: "protected",
  });
  const readCurrentLead = database.prepare(`SELECT enquiry.*,
      ${marketplaceProjectionSql()}
    FROM trade_crm_enquiries enquiry
    ${marketplaceReadJoinsSql()}
    WHERE ${marketplaceReadAccessSql()}`);
  const initialProjection = projectPublicMarketplaceEnquiry(readCurrentLead.get());
  assert.equal(initialProjection.id, "marketplace-match-a");
  assert.deepEqual({
    firstName: initialProjection.first_name,
    lastName: initialProjection.last_name,
    email: initialProjection.email,
    phone: initialProjection.phone,
    addressLine1: initialProjection.address_line_1,
    postcode: initialProjection.postcode,
    description: initialProjection.description,
  }, {
    firstName: "",
    lastName: "",
    email: "jamie@example.test",
    phone: "",
    addressLine1: "",
    postcode: "3000",
    description: "Customer project. Customer message: Solar and battery help please.",
  });
  database.prepare(`UPDATE trade_crm_enquiries SET first_name = 'Old Private',
      last_name = 'Customer', email = 'withdrawn@example.test',
      phone = '0499999999', description = 'Old private message needle'
    WHERE id = 'marketplace-match-a'`).run();
  const protectedSearch = database.prepare(`SELECT enquiry.id
    FROM trade_crm_enquiries enquiry
    ${marketplaceReadJoinsSql()}
    WHERE ${marketplaceReadAccessSql()}
      AND LOWER(${marketplaceSearchTextSql()}) LIKE '%' || ? || '%'`);
  assert.equal(protectedSearch.get("withdrawn@example.test"), undefined,
    "cached marketplace PII cannot affect protected search results");
  assert.equal(protectedSearch.get("old private message needle"), undefined,
    "a cached withdrawn message cannot be probed through search");
  assert.equal(protectedSearch.get("customer project")?.id, "marketplace-match-a",
    "non-private opportunity metadata remains searchable");
  database.prepare(`INSERT INTO trade_crm_enquiries
      (id, firebase_uid, source_type, source_reference, external_record_id, opportunity_match_id,
       status, customer_type, first_name, last_name, email, phone, address_line_1,
       address_line_2, suburb, address_state, postcode, service_category,
       service_categories, description, urgency, service_region, protected_source,
       duplicate_decision, record_status, created_at, updated_at)
      VALUES ('legacy-unknown', 'trade-a', 'tlink_marketplace', 'legacy-match', '',
        'legacy-match', 'new', 'residential', 'Legacy', 'Person', 'legacy@example.test',
        '0400000000', '1 Legacy Street', '', 'Melbourne', 'VIC', '3000', 'solar',
        '["solar"]', 'Legacy copied PII', 'standard', 'VIC', 0, 'unchecked',
        'active', '2026-08-10T04:00:00.000Z', '2026-08-10T04:00:00.000Z')`).run();
  assert.equal(database.prepare(`SELECT enquiry.id FROM trade_crm_enquiries enquiry
    ${marketplaceReadJoinsSql()}
    WHERE enquiry.id = 'legacy-unknown' AND ${marketplaceReadAccessSql()}`).get(), undefined,
  "an unknown marketplace row without an exact current release fails closed");
  database.prepare("UPDATE public_trade_lead_contact_releases SET disclosed_fields = ?")
    .run(JSON.stringify([
      "customer_email", "postcode", "service_categories", "customer_message", "customer_name", "customer_address",
    ]));
  const addressProjection = projectPublicMarketplaceEnquiry(readCurrentLead.get());
  assert.deepEqual({
    firstName: addressProjection.first_name,
    lastName: addressProjection.last_name,
    addressLine1: addressProjection.address_line_1,
    addressLine2: addressProjection.address_line_2,
    suburb: addressProjection.suburb,
    state: addressProjection.address_state,
  }, {
    firstName: "Jamie",
    lastName: "Example",
    addressLine1: "15 Example Street",
    addressLine2: "Unit 4",
    suburb: "MELBOURNE",
    state: "VIC",
  });
  const oldReleaseProjection = projectPublicMarketplaceEnquiry({
    ...readCurrentLead.get(),
    public_contact_status: "withdrawn",
    public_contact_withdrawn_at: "2026-08-10T03:00:00.000Z",
    public_contact_disclosed_fields: JSON.stringify([
      "customer_email", "postcode", "service_categories", "customer_name",
      "customer_phone", "customer_address", "customer_message",
    ]),
  });
  assert.equal(oldReleaseProjection, null, "an older withdrawn broader release cannot project any PII");
  database.prepare(`UPDATE public_trade_lead_contact_releases
    SET status = 'withdrawn', withdrawn_at = '2026-08-10T05:00:00.000Z'`).run();
  assert.equal(readCurrentLead.get(), undefined, "withdrawal blocks cached PII before cleanup runs");
  sync.run("opportunity-1", "", "");
  assert.deepEqual({ ...database.prepare(`SELECT first_name, last_name, email, phone,
      address_line_1, address_line_2, suburb, address_state, postcode,
      protected_source, duplicate_decision, description FROM trade_crm_enquiries`).get() }, {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address_line_1: "",
    address_line_2: "",
    suburb: "",
    address_state: "",
    postcode: "",
    protected_source: 1,
    duplicate_decision: "protected",
    description: "Customer project.",
  });
  database.prepare(`UPDATE public_trade_lead_contact_releases
    SET status = 'active', withdrawn_at = ''`).run();
  assert.equal(projectPublicMarketplaceEnquiry(readCurrentLead.get()).email, "jamie@example.test");
  database.prepare("UPDATE trade_opportunities SET status = 'expired'").run();
  assert.equal(readCurrentLead.get(), undefined, "expiry blocks cached PII before cleanup runs");
  sync.run("opportunity-1", "", "");
  assert.equal(database.prepare("SELECT email FROM trade_crm_enquiries").get().email, "");
  database.prepare("UPDATE trade_opportunities SET status = 'open'").run();
  database.prepare("UPDATE trade_opportunity_matches SET status = 'closed'").run();
  assert.equal(readCurrentLead.get(), undefined, "a closed exact match blocks current released fields");
  database.close();
});

test("server and trade workspace enforce the allocation-scoped contact boundary", () => {
  assert.match(opportunityServer, /contactConsentReceipt/);
  assert.match(opportunityServer, /noticeVersion !== PUBLIC_PLAN_CONSENT_NOTICE_VERSION/);
  assert.match(opportunityServer, /consentPurpose !== PUBLIC_PLAN_CONSENT_PURPOSE/);
  assert.match(opportunityServer, /Only the contact fields the customer consented to share are available to approved matching TLink trades/);
  assert.match(opportunityServer, /The private home plan and PDF are not shared with trades/);
  assert.match(opportunityServer, /!sourceReference/);
  assert.match(opportunityServer, /public_trade_lead_contact_releases contact/);
  assert.match(opportunityServer, /"customer_email",\s*"postcode",\s*"service_categories"/);
  assert.match(opportunityServer, /tradeSharing\.name \? \["customer_name"\] : \[\]/);
  assert.match(opportunityServer, /tradeSharing\.phone \? \["customer_phone"\] : \[\]/);
  assert.match(opportunityServer, /tradeSharing\.address \? \["customer_address"\] : \[\]/);
  assert.match(opportunityServer, /customerMessage \? \["customer_message"\] : \[\]/);
  assert.match(opportunityServer, /json_valid\(contact\.disclosed_fields\)/);
  const syncSource = opportunityServer.match(/export async function syncMarketplaceEnquiries[\s\S]*?^}/m)?.[0] || "";
  assert.match(syncSource, /'residential', '', '', '', '', '', '', '', '', ''/);
  assert.doesNotMatch(syncSource, /THEN contact\.(?:customer_first_name|customer_email|customer_message)/);
  assert.match(opportunityServer, /'residential', '', '', '', '', '', '', '', '', '',/);
  assert.match(opportunityServer, /o\.summary,[\s\S]*o\.priority, o\.state, 1,[\s\S]*'protected'/);
  assert.match(opportunityServer, /ON CONFLICT\(opportunity_id, firebase_uid\) DO NOTHING/);
  assert.match(tradeRoute, /public_trade_lead_contact_releases public_contact/);
  assert.match(tradeRoute, /WHERE m\.firebase_uid = \?/);
  assert.match(tradeRoute, /requireVerifiedTradeAccess\(request, \{ partnerTypes: \["installer"\] \}\)/);
  assert.doesNotMatch(tradeRoute, /verifiedTradeAccountPredicate\("current_public_trade_account"\)/);
  assert.doesNotMatch(tradeRoute, /publicPlanContactReleaseAccessSql\("(?:public_contact|active_public_contact)"\)/);
  assert.match(tradeRoute, /JOIN public_trade_lead_contact_releases public_contact[\s\S]*current_release\.opportunity_id = o\.id[\s\S]*current_release\.source_reference = o\.source_reference/);
  assert.match(tradeRoute, /ORDER BY datetime\(current_release\.updated_at\) DESC/);
  assert.match(tradeRoute, /publicTradeContactForMatchedLead\(item\)/);
  assert.match(tradeLeadAccess, /export function publicTradeContactForMatchedLead\(/);
  assert.match(tradeLeadAccess, /publicPlanContactReleaseDisclosedFieldsAreValid\(/);
  assert.match(tradeLeadAccess, /const firstName = disclosed\.has\("customer_name"\)/);
  assert.match(tradeLeadAccess, /const lastName = disclosed\.has\("customer_name"\)/);
  assert.match(tradeLeadAccess, /const name = \[firstName, lastName\]\.filter\(Boolean\)\.join\(" "\)/);
  assert.match(tradeLeadAccess, /const phone = disclosed\.has\("customer_phone"\)/);
  assert.match(tradeLeadAccess, /const addressLine1 = disclosed\.has\("customer_address"\)/);
  assert.match(tradeLeadAccess, /const addressLine2 = disclosed\.has\("customer_address"\)/);
  assert.match(tradeLeadAccess, /const suburb = disclosed\.has\("customer_address"\)/);
  assert.match(tradeLeadAccess, /const addressState = disclosed\.has\("customer_address"\)/);
  assert.match(tradeLeadAccess, /const message = disclosed\.has\("customer_message"\)/);
  assert.match(tradeLeadAccess, /disclosed\.has\("customer_address"\) && \(/);
  assert.match(tradeLeadAccess, /!addressLine1/);
  assert.match(tradeLeadAccess, /!suburb/);
  assert.match(tradeLeadAccess, /!addressState/);
  assert.match(tradeRoute, /publicReleaseMatches\.has\(matchId\) && !publicLeadContext/);
  assert.match(tradeRoute, /currentPublicContact && !publicTradeContactForMatchedLead\(currentPublicContact\)/);
  assert.match(tradeEnquiriesRoute, /currentPublicMarketplaceAccessSql/);
  assert.match(tradeEnquiriesRoute, /publicPlanContactReleaseAccessSql\("current_public_release"\)/);
  assert.match(tradeEnquiriesRoute, /verifiedTradeAccountPredicate\("current_public_account"\)/);
  assert.match(tradeEnquiriesRoute, /current_public_release\.withdrawn_at = ''/);
  assert.match(tradeEnquiriesRoute, /current_public_match\.status IN \('interested', 'connected'\)/);
  assert.match(tradeEnquiriesRoute, /current_public_opportunity\.status = 'open'/);
  assert.match(tradeEnquiriesRoute, /datetime\(current_public_opportunity\.expires_at\) > datetime\('now'\)/);
  assert.match(tradeEnquiriesRoute, /publicMarketplaceReadJoins/);
  assert.match(tradeEnquiriesRoute, /release_candidate\.source_reference = current_public_opportunity\.source_reference/);
  assert.match(tradeEnquiriesRoute, /ORDER BY datetime\(release_candidate\.updated_at\) DESC/);
  assert.match(tradeEnquiriesRoute, /const enquirySearchTextSql/);
  assert.match(tradeEnquiriesRoute, /WHEN \$\{enquiryAlias\}\.source_type = 'tlink_marketplace'/);
  assert.match(tradeEnquiriesRoute, /projectPublicMarketplaceEnquiry/);
  assert.match(adminMatchesRoute, /accountHasFeature\(firebaseUid, "installer", "installer_leads"\)/);
  assert.match(adminMatchesRoute, /qualifyingServiceArea\(account, String\(opportunity\.postcode\)\)/);
  assert.doesNotMatch(`${opportunityServer}\n${tradeRoute}\n${tradeEnquiriesRoute}\n${adminMatchesRoute}`, /trade_capability|capability_review|service qualification/i);
  assert.match(tradeLeadAccess, /releaseScope: "all_qualified_trades"/);
  assert.doesNotMatch(tradeRoute, /SELECT \* FROM public_trade_lead_contact_releases/);
  assert.match(tradeDashboard, /every verified matching trade/);
  assert.doesNotMatch(tradeDashboard, /Allocation \{opportunity\.allocationRank\} of 6/);
});
