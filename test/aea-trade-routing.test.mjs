import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { expandCreditexLeadSql, qualifyLeadFixture } from "./helpers/creditex-training-sql.mjs";
import { AEA_RESERVED_SERVICE_IDS } from "../src/lib/aea-services.mjs";
import { aeaDeliveredServiceScopeSql, tradeOpportunityServiceScopeAllowed, tradeOpportunityServiceScopeSql } from "../src/lib/aea-trade-routing.mjs";
import { publicTradeContactForMatchedLead } from "../src/lib/public-trade-lead-access.mjs";
import { projectPublicMarketplaceEnquiry } from "../src/lib/public-marketplace-enquiry-projection.mjs";
import { PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE, publicPlanContactReleaseConsentSql } from "../src/lib/public-plan-enquiry.mjs";
import { certificateTestDependency, installAeaTradeOwnerFixtureSchema } from "./helpers/creditex-training-fixture.mjs";
const { OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL, OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL } = certificateTestDependency("opportunity-notification-retry");

const source = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const scopeSql = (sql) => expandCreditexLeadSql(sql).replaceAll(/\$\{tradeOpportunityServiceScopeSql\("([^"]+)"\)\}/g, (_, alias) => tradeOpportunityServiceScopeSql(alias));

test("complete stored scope rejects every AEA service and mixed enquiries in JS and SQLite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE opportunity (service_categories text)");
  const fixtures = [
    ['["solar"]', true], ['["legacy-upgrade"]', true], ['[]', false], ['{}', false],
    ['null', false], ['broken', false], ['', false], ['[1,"solar"]', false],
    ['[" ","solar"]', false], ['["Assessment","solar"]', false],
    ...AEA_RESERVED_SERVICE_IDS.flatMap((id) => [[JSON.stringify([id]), false], [JSON.stringify([id, "solar"]), false]]),
  ];
  for (const [services, expected] of fixtures) {
    db.exec("DELETE FROM opportunity");
    db.prepare("INSERT INTO opportunity VALUES (?)").run(services);
    assert.equal(tradeOpportunityServiceScopeAllowed(services), expected, services);
    assert.equal(Boolean(db.prepare(`SELECT ${tradeOpportunityServiceScopeSql("opportunity")} allowed FROM opportunity`).get().allowed), expected, services);
  }
  assert.throws(() => tradeOpportunityServiceScopeSql("opportunity; DROP TABLE opportunity"));
  db.close();
});

test("customer draft access positively requires a well-formed reserved service scope", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE opportunity (service_categories text)");
  const fixtures = [
    [null, false], ["", false], ["broken", false], ['{}', false], ['[]', false],
    ['null', false], ['"assessment"', false], ['["solar"]', false],
    ['["legacy-upgrade"]', false], ['["assessment",null]', false],
    ['["assessment",1]', false], ['["assessment",{}]', false],
    ['["assessment",""]', false], ['["assessment"," "]', false],
    ['[" Assessment ","solar"]', true],
    ...AEA_RESERVED_SERVICE_IDS.flatMap((id) => [
      [JSON.stringify([id]), true], [JSON.stringify(["solar", id]), true],
    ]),
  ];
  const query = db.prepare(`SELECT ${aeaDeliveredServiceScopeSql("opportunity")} allowed FROM opportunity`);
  for (const [services, expected] of fixtures) {
    db.exec("DELETE FROM opportunity");
    db.prepare("INSERT INTO opportunity VALUES (?)").run(services);
    assert.equal(Boolean(query.get().allowed), expected, String(services));
  }
  assert.throws(() => aeaDeliveredServiceScopeSql("opportunity; DROP TABLE opportunity"));
});

function contactRow() {
  return {
    source_type: "tlink_marketplace",
    source_reference: "AEA-routing-test",
    public_opportunity_source_reference: "AEA-routing-test",
    opportunity_service_categories: '["solar"]',
    opportunity_postcode: "3000", state: "VIC", opportunity_state: "VIC",
    public_contact_release_id: "release-1", public_contact_status: "active",
    public_contact_source_reference: "AEA-routing-test", public_contact_withdrawn_at: "",
    public_contact_disclosed_fields: '["customer_email","postcode","service_categories"]',
    public_contact_notice_version: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    public_contact_postcode: "3000", public_contact_granted_at: "2026-09-14T00:00:00.000Z",
    public_customer_email: "customer@example.test", matched_categories: '["solar"]',
  };
}

test("legacy matched subsets cannot expose reserved contact fields or a materialised CRM row", () => {
  const row = contactRow();
  assert.equal(publicTradeContactForMatchedLead(row).email, "customer@example.test");
  assert.equal(projectPublicMarketplaceEnquiry(row).email, "customer@example.test");
  for (const id of AEA_RESERVED_SERVICE_IDS) {
    const mixed = { ...row, opportunity_service_categories: JSON.stringify([id, "solar"]) };
    assert.equal(publicTradeContactForMatchedLead(mixed), null);
    assert.equal(projectPublicMarketplaceEnquiry(mixed), null);
  }
  assert.equal(publicTradeContactForMatchedLead({ ...row, opportunity_service_categories: undefined }), null);
  assert.deepEqual(projectPublicMarketplaceEnquiry({ source_type: "manual", email: "owner-customer@example.test" }),
    { source_type: "manual", email: "owner-customer@example.test" });
  assert.equal(Object.hasOwn(projectPublicMarketplaceEnquiry(row), "opportunity_service_categories"), false);
});

test("actual notification enqueue and final claim deny legacy mixed scope and a scope change before send", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunities (id text PRIMARY KEY, service_categories text, status text,
    expires_at text, created_at text, postcode text);
    CREATE TABLE trade_opportunity_matches (id text PRIMARY KEY, opportunity_id text, firebase_uid text, status text, matched_at text);
    CREATE TABLE trade_opportunity_notification_deliveries (id text PRIMARY KEY, match_id text UNIQUE, status text,
      eligibility_reason text, attempts integer, next_attempt_at text, provider text, provider_message_id text,
      provider_status text, recipient_email_hash text, idempotency_key text, subject text, body text,
      enqueued_at text, last_attempt_at text, sent_at text, delivered_at text, failed_at text,
      last_error text, created_at text, updated_at text);
    CREATE TABLE trade_opportunity_email_suppressions (email_hash text);
    CREATE TABLE trade_accounts (firebase_uid text, email text, email_opportunities integer,
      consent_at text, availability_status text, partner_type text, approved integer);
    CREATE TABLE public_trade_lead_contact_releases (id text, opportunity_id text, status text,
      notice_version text, consent_purpose text, postcode text, granted_at text, withdrawn_at text);
    INSERT INTO trade_opportunities VALUES ('opportunity-1','["assessment","solar"]','open','2099-09-14T00:00:00.000Z','2026-09-14T00:00:00.000Z','3000');
    INSERT INTO trade_opportunity_matches VALUES ('match-1','opportunity-1','trade-1','offered','2026-09-14T00:00:00.000Z');
    INSERT INTO trade_accounts VALUES ('trade-1','trade@example.test',1,'2026-09-14T00:00:00.000Z','open','installer',1);`);
  const now = "2026-09-14T01:00:00.000Z";
  installAeaTradeOwnerFixtureSchema(db);
  const enqueue = db.prepare(OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL);
  assert.equal(enqueue.run(now, "opportunity-1").changes, 0);
  db.prepare("UPDATE trade_opportunities SET service_categories = ?").run('["solar"]');
  assert.equal(enqueue.run(now, "opportunity-1").changes, 1);
  assert.equal(enqueue.run(now, "opportunity-1").changes, 0);
  const row = db.prepare("SELECT * FROM trade_opportunity_notification_deliveries").get();
  const code = source("../src/lib/opportunity-notification-server.ts");
  let sql = code.match(/const claim = await db\.prepare\(`([\s\S]*?)`\)\s*\.bind/)?.[1];
  assert.ok(sql, "execute the production send claim rather than a copied guard");
  sql = scopeSql(sql)
    .replace("${OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL}", OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL)
    .replace('${verifiedTradeAccountPredicate("current_account")}', "current_account.approved = 1")
    .replaceAll(/\$\{publicPlanContactReleaseConsentSql\("([^"]+)"\)\}/g, (_, alias) => publicPlanContactReleaseConsentSql(alias));
  qualifyLeadFixture(db);
  db.exec("DELETE FROM trade_training_completions; DELETE FROM trade_training_attempts"); // Lead receipt does not require completed training.
  const claim = db.prepare(sql);
  const bindings = [1, "email-hash", "idempotency", "Bounded subject", "Bounded body", now, now,
    row.id, row.status, row.attempts, "email-hash", now, now, "trade@example.test"];
  let providerCalls = 0;
  for (const id of AEA_RESERVED_SERVICE_IDS) {
    db.prepare("UPDATE trade_opportunities SET service_categories = ?").run(JSON.stringify(["solar", id]));
    const claimed = claim.run(...bindings);
    if (claimed.changes) providerCalls += 1;
    assert.equal(claimed.changes, 0, id);
    assert.equal(db.prepare("SELECT attempts FROM trade_opportunity_notification_deliveries").get().attempts, 0);
  }
  assert.equal(providerCalls, 0);
  db.prepare("UPDATE trade_opportunities SET service_categories = ?").run('["solar"]');
  assert.equal(claim.run(...bindings).changes, 1, "the unchanged pure-upgrade flow remains claimable");
  assert.equal(claim.run(...bindings).changes, 0, "a stale claimant cannot send twice");
  db.close();
});

test("actual manual assignment writes reject mixed scope while terminal cleanup remains available", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunities (id text PRIMARY KEY, service_categories text, status text);
    CREATE TABLE trade_accounts (firebase_uid text PRIMARY KEY, partner_type text, approved integer);
    CREATE TABLE trade_opportunity_matches (id text PRIMARY KEY, opportunity_id text, firebase_uid text,
      status text, admin_note text, partner_note text, matched_categories text, distance_metres integer,
      allocation_rank integer, match_source text, contact_attempt_count integer, last_contact_at text,
      connected_at text, matched_by_uid text, matched_at text, updated_at text,
      UNIQUE(opportunity_id,firebase_uid));
    INSERT INTO trade_opportunities VALUES ('opportunity-1','["assessment","solar"]','open');
    INSERT INTO trade_accounts VALUES ('trade-1','installer',1);`);
  const code = source("../src/app/api/admin/opportunities/matches/route.ts");
  qualifyLeadFixture(db);
  db.exec("DELETE FROM trade_training_completions; DELETE FROM trade_training_attempts"); // Lead receipt does not require completed training.
  const insertSql = code.match(/`(INSERT INTO trade_opportunity_matches[\s\S]*?)`,/)?.[1];
  assert.ok(insertSql);
  const insert = db.prepare(scopeSql(insertSql));
  const now = "2026-09-14T00:00:00.000Z";
  const bindings = ["match-1", "opportunity-1", "trade-1", "", '["solar"]', 500, 1, "owner", now, now,
    "trade-1", '["solar"]', "VIC", "opportunity-1"];
  assert.equal(insert.run(...bindings).changes, 0);
  db.prepare("UPDATE trade_opportunities SET service_categories = ?").run('["solar"]');
  assert.equal(insert.run(...bindings).changes, 1);
  let updateSql = code.match(/`(UPDATE trade_opportunity_matches SET status = \?[\s\S]*?)`,/)?.[1];
  assert.ok(updateSql);
  updateSql = scopeSql(updateSql).replace('${verifiedTradeAccountPredicate("a")}', "a.approved = 1");
  const update = db.prepare(updateSql);
  db.prepare("UPDATE trade_opportunities SET service_categories = ?").run('["assessment","solar"]');
  for (const status of ["offered", "viewed", "interested", "connected"]) {
    assert.equal(update.run(status, "", status, now, now, "match-1", status).changes, 0, status);
  }
  for (const status of ["declined", "closed"]) {
    assert.equal(update.run(status, "", status, now, now, "match-1", status).changes, 1, status);
  }
  db.close();
});
