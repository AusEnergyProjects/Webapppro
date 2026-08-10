import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0126_public_trade_lead_contact_release.sql");
const schema = read("../db/schema.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const tradeRoute = read("../src/app/api/trade-opportunities/route.ts");
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
        THEN release.customer_name ELSE '' END customer_name,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_email')
        THEN release.customer_email ELSE '' END customer_email,
      CASE WHEN EXISTS (SELECT 1 FROM json_each(${disclosureJson}) field WHERE field.value = 'customer_phone')
        THEN release.customer_phone ELSE '' END customer_phone,
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

test("a public contact release contains only the consented basic lead fields", () => {
  const database = new DatabaseSync(":memory:");
  createOpportunitySourceTable(database);
  apply(database, migration);
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
    "customer_name",
    "customer_email",
    "customer_phone",
    "postcode",
    "customer_message",
    "notice_version",
    "consent_purpose",
    "disclosed_fields",
    "granted_at",
  ]) assert.equal(columns.includes(allowed), true, allowed);
  assert.match(schema, /sqliteTable\("public_trade_lead_contact_releases"/);
  assert.match(schema, /trade_opportunities_source_reference_idx/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_opportunities_source_reference_idx`/);
  assert.match(migration, /WHERE `source_reference` <> ''/);
  database.close();
});

test("every allocated trade sees routing fields and written notes while name and phone remain independently optional", () => {
  const database = new DatabaseSync(":memory:");
  createOpportunitySourceTable(database);
  apply(database, migration);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases
    (id, opportunity_id, source_reference, status, notice_version, consent_purpose,
     disclosed_fields, customer_name, customer_email, customer_phone, postcode,
     customer_message, granted_at, withdrawn_at, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
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
      "jamie@example.test",
      "0400000000",
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
    customer_name: "",
    customer_email: "jamie@example.test",
    customer_phone: "",
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
    customer_name: "Jamie Example",
    customer_email: "jamie@example.test",
    customer_phone: "",
    postcode: "3000",
    customer_message: "Please call after 4 pm.",
  });
  changeDisclosure.run(JSON.stringify([
    "customer_email", "postcode", "service_categories", "customer_message", "customer_name", "customer_phone",
  ]));
  assert.deepEqual({ ...disclosedContactForTrade(database, "trade-a") }, {
    customer_name: "Jamie Example",
    customer_email: "jamie@example.test",
    customer_phone: "0400000000",
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
     disclosed_fields, customer_name, customer_email, customer_phone, postcode,
     customer_message, granted_at, withdrawn_at, created_at, updated_at)
    SELECT 'release-duplicate', opportunity_id, 'AEA-OTHER', status, notice_version,
      consent_purpose, disclosed_fields, customer_name, customer_email, customer_phone,
      postcode, customer_message, granted_at, withdrawn_at, created_at, updated_at
    FROM public_trade_lead_contact_releases WHERE id = 'release-1'`).run(), /UNIQUE constraint failed/);
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
  assert.match(opportunityServer, /customerMessage \? \["customer_message"\] : \[\]/);
  assert.match(opportunityServer, /json_valid\(contact\.disclosed_fields\)/);
  assert.match(opportunityServer, /disclosed\.value = 'customer_name'/);
  assert.match(opportunityServer, /disclosed\.value = 'customer_phone'/);
  assert.match(opportunityServer, /disclosed\.value = 'customer_message'/);
  assert.match(opportunityServer, /CASE WHEN contact\.id IS NULL THEN 1 ELSE 0 END/);
  assert.match(opportunityServer, /ON CONFLICT\(opportunity_id, firebase_uid\) DO NOTHING/);
  assert.match(tradeRoute, /public_trade_lead_contact_releases public_contact/);
  assert.match(tradeRoute, /WHERE m\.firebase_uid = \?/);
  assert.match(tradeRoute, /verifiedTradeAccountPredicate\("current_public_trade_account"\)/);
  assert.match(tradeRoute, /public_contact\.notice_version = '\$\{PUBLIC_PLAN_CONSENT_NOTICE_VERSION\}'/);
  assert.match(tradeRoute, /function publicTradeContact\(/);
  assert.match(tradeRoute, /parseJsonList\(row\.public_contact_disclosed_fields\)/);
  assert.match(tradeRoute, /!disclosedFields\.has\("customer_email"\)/);
  assert.match(tradeRoute, /!disclosedFields\.has\("postcode"\)/);
  assert.match(tradeRoute, /!disclosedFields\.has\("service_categories"\)/);
  assert.match(tradeRoute, /name: disclosedFields\.has\("customer_name"\)/);
  assert.match(tradeRoute, /phone: disclosedFields\.has\("customer_phone"\)/);
  assert.match(tradeRoute, /message: disclosedFields\.has\("customer_message"\)/);
  assert.match(tradeEnquiriesRoute, /currentPublicMarketplaceAccessSql/);
  assert.match(tradeEnquiriesRoute, /verifiedTradeAccountPredicate\("current_public_account"\)/);
  assert.match(tradeEnquiriesRoute, /current_public_release\.withdrawn_at = ''/);
  assert.match(tradeEnquiriesRoute, /json_valid\(current_public_release\.disclosed_fields\)/);
  assert.match(tradeEnquiriesRoute, /disclosed\.value = 'customer_email'/);
  assert.match(tradeEnquiriesRoute, /disclosed\.value = 'postcode'/);
  assert.match(tradeEnquiriesRoute, /disclosed\.value = 'service_categories'/);
  assert.match(adminMatchesRoute, /accountHasFeature\(firebaseUid, "installer", "installer_leads"\)/);
  assert.match(adminMatchesRoute, /qualifyingServiceArea\(account, String\(opportunity\.postcode\)\)/);
  assert.doesNotMatch(`${opportunityServer}\n${tradeRoute}\n${tradeEnquiriesRoute}\n${adminMatchesRoute}`, /trade_capability|capability_review|service qualification/i);
  assert.match(tradeRoute, /releaseScope: "all_qualified_trades"/);
  assert.doesNotMatch(tradeRoute, /SELECT \* FROM public_trade_lead_contact_releases/);
  assert.match(tradeDashboard, /every verified matching trade/);
  assert.doesNotMatch(tradeDashboard, /Allocation \{opportunity\.allocationRank\} of 6/);
});
