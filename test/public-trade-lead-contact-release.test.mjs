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

test("every allocated trade can resolve one consented contact and a nonmatch resolves none", () => {
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
        "customer_name",
        "customer_email",
        "customer_phone",
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
  const visibleContact = database.prepare(`SELECT release.customer_name, release.customer_email,
      release.customer_phone, release.postcode, release.customer_message
    FROM trade_opportunity_matches allocation
    JOIN public_trade_lead_contact_releases release
      ON release.opportunity_id = allocation.opportunity_id AND release.status = 'active'
    WHERE allocation.firebase_uid = ?`).all("trade-a");
  assert.deepEqual(visibleContact.map((row) => ({ ...row })), [{
    customer_name: "Jamie Example",
    customer_email: "jamie@example.test",
    customer_phone: "0400000000",
    postcode: "3000",
    customer_message: "Please call after 4 pm.",
  }]);
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
  assert.match(opportunityServer, /Only the contact fields the customer consented to share are available to matched verified trades/);
  assert.match(opportunityServer, /The private home plan and PDF are not shared with trades/);
  assert.match(opportunityServer, /!sourceReference/);
  assert.match(opportunityServer, /public_trade_lead_contact_releases contact/);
  assert.match(opportunityServer, /CASE WHEN contact\.id IS NULL THEN 1 ELSE 0 END/);
  assert.match(opportunityServer, /ON CONFLICT\(opportunity_id, firebase_uid\) DO NOTHING/);
  assert.match(tradeRoute, /public_trade_lead_contact_releases public_contact/);
  assert.match(tradeRoute, /WHERE m\.firebase_uid = \?/);
  assert.match(tradeRoute, /verifiedTradeAccountPredicate\("current_public_trade_account"\)/);
  assert.match(tradeRoute, /public_contact\.notice_version = '\$\{PUBLIC_PLAN_CONSENT_NOTICE_VERSION\}'/);
  assert.match(tradeEnquiriesRoute, /currentPublicMarketplaceAccessSql/);
  assert.match(tradeEnquiriesRoute, /verifiedTradeAccountPredicate\("current_public_account"\)/);
  assert.match(tradeEnquiriesRoute, /current_public_release\.withdrawn_at = ''/);
  assert.match(adminMatchesRoute, /accountHasFeature\(firebaseUid, "installer", "installer_leads"\)/);
  assert.match(adminMatchesRoute, /qualifyingServiceArea\(account, String\(opportunity\.postcode\)\)/);
  assert.doesNotMatch(`${opportunityServer}\n${tradeRoute}\n${tradeEnquiriesRoute}\n${adminMatchesRoute}`, /trade_capability|capability_review|service qualification/i);
  assert.match(tradeRoute, /releaseScope: "all_qualified_trades"/);
  assert.doesNotMatch(tradeRoute, /SELECT \* FROM public_trade_lead_contact_releases/);
  assert.match(tradeDashboard, /every verified matching trade/);
  assert.doesNotMatch(tradeDashboard, /Allocation \{opportunity\.allocationRank\} of 6/);
});
