import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  publicPlanContactReleaseAccessSql,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
} from "../src/lib/public-plan-quote-preparation.mjs";
import {
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
} from "../src/lib/quick-upgrade-enquiry.mjs";
import {
  publicLeadAcceptedDisclosure,
  publicLeadAcceptedCrmCustomerName,
  publicLeadQuoteNavigationTarget,
  publicLeadQuoteAccessSnapshot,
  publicLeadIssueAccessGuard,
  publicLeadQuoteWorkflowIds,
  publicLeadQuoteWorkflowSnapshot,
} from "../src/lib/public-lead-quote-workflow.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const server = read("../src/lib/public-lead-quote-workflow-server.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const quoteRoute = read("../src/app/api/trade-quotes/route.ts");
const quoteDeliveryServer = read("../src/lib/trade-quote-delivery-server.ts");
const quoteDocumentServer = read("../src/lib/trade-quote-review-server.ts");
const issuedCleanup = read("../src/lib/trade-issued-document-cleanup.ts");
const issuedCleanupMigration = read("../drizzle/0130_trade_issued_document_cleanup.sql");
const worker = read("../worker/index.ts");
const quoteUi = read("../src/components/TradeQuotePanel.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");

const matchId = "39c16039-4acd-4664-a2e5-3d8ad0dd7dd6";
const legacyStructuredAddressNoticeVersion =
  "2026-08-10-structured-service-address-sharing-v6";
const legacyStructuredAddressPurpose =
  "Share my email, postcode, services and message with all approved TLink trades in my area, plus name, phone or full service address, and email my private plan";

function workflowAccessSql() {
  const sql = server.match(/const row = await db\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql, "workflow access SQL must be extractable for execution");
  return sql.replace(
    '${publicPlanContactReleaseAccessSql("contact")}',
    publicPlanContactReleaseAccessSql("contact"),
  );
}

function publicLeadRow(disclosedFields, overrides = {}) {
  return {
    public_contact_release_id: "release-1",
    public_contact_status: "active",
    public_contact_source_reference: "AEA-20260812-0011223344556677",
    source_reference: "AEA-20260812-0011223344556677",
    public_contact_withdrawn_at: "",
    public_contact_disclosed_fields: JSON.stringify(disclosedFields),
    public_customer_first_name: "Private",
    public_customer_last_name: "Name",
    public_customer_email: "customer@example.com",
    public_customer_phone: "0400000000",
    public_customer_street_address: "1 Secret Street",
    public_customer_unit_number: "Unit 9",
    public_customer_suburb: "Melbourne",
    public_customer_address_state: "VIC",
    public_contact_postcode: "3000",
    opportunity_postcode: "3000",
    state: "VIC",
    public_customer_message: "Please quote the selected work.",
    public_contact_notice_version: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    public_contact_granted_at: "2026-08-12T01:00:00.000Z",
    public_contact_updated_at: "2026-08-12T01:00:00.000Z",
    matched_categories: JSON.stringify(["hot-water"]),
    public_quote_answers: JSON.stringify([
      { questionId: "timing", label: "When would you like the work done?", answer: "Within 3 months", services: ["hot-water"] },
      { questionId: "battery-priority", label: "What matters most for the battery quote?", answer: "Use more solar and lower bills", services: ["battery"] },
    ]),
    public_quote_preparation_id: "preparation-1",
    public_quote_preparation_version: "quote-preparation-v1",
    public_quote_preparation_granted_at: "2026-08-12T01:00:00.000Z",
    public_quote_preparation_updated_at: "2026-08-12T01:00:00.000Z",
    work_source_reference: matchId,
    title: "Heat-pump hot-water quote",
    opportunity_title: "Heat-pump hot-water quote",
    summary: "Replace the existing hot-water unit.",
    priority: "standard",
    opportunity_priority: "standard",
    match_status: "interested",
    opportunity_status: "open",
    expires_at: "2099-08-12T01:00:00.000Z",
    ...overrides,
  };
}

test("public lead quote workflow identifiers are stable and reject invalid matches", () => {
  assert.deepEqual(publicLeadQuoteWorkflowIds(matchId), publicLeadQuoteWorkflowIds(matchId.toUpperCase()));
  assert.equal(publicLeadQuoteWorkflowIds("not-a-match"), null);
  assert.equal(publicLeadQuoteWorkflowIds(matchId)?.workOrderId, `public-lead-work-${matchId}`);
});

test("successful Interested response opens the created job directly in the editable quote tab", () => {
  assert.deepEqual(publicLeadQuoteNavigationTarget({
    workOrderId: "public-lead-work-39c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
    quoteId: "public-lead-quote-39c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
  }), {
    workspace: "work",
    kind: "job",
    id: "public-lead-work-39c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
    query: "",
    jobTab: "quote",
  });
  assert.equal(publicLeadQuoteNavigationTarget({ workOrderId: "job-1" }), null,
    "the UI must not report a complete quote workflow without the canonical quote id");
  assert.equal(publicLeadQuoteNavigationTarget({ quoteId: "quote-1" }), null,
    "the UI must not navigate without the canonical job id");
  assert.equal(publicLeadQuoteNavigationTarget({
    workOrderId: "public-lead-work-39c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
    quoteId: "public-lead-quote-49c16039-4acd-4664-a2e5-3d8ad0dd7dd6",
  }), null, "the UI must not navigate when the job and quote belong to different matches");
  assert.match(dashboard, /const quoteTarget = publicLeadQuoteNavigationTarget\(quoteWorkflow\)/);
  assert.match(dashboard, /setCommandTarget\(\{[\s\S]*\.\.\.quoteTarget,[\s\S]*nonce: Date\.now\(\)/);
});

test("accepted CRM names redact each missing component independently", () => {
  assert.deepEqual(publicLeadAcceptedCrmCustomerName({ firstName: "Private", lastName: "Name" }), {
    firstName: "Private",
    lastName: "Name",
  });
  assert.deepEqual(publicLeadAcceptedCrmCustomerName({ firstName: "", lastName: "" }), {
    firstName: "Redacted",
    lastName: "Redacted",
  });
  assert.deepEqual(publicLeadAcceptedCrmCustomerName({ firstName: "Private", lastName: "  " }), {
    firstName: "Private",
    lastName: "Redacted",
  });
  assert.deepEqual(publicLeadAcceptedCrmCustomerName({ firstName: "  ", lastName: "Name" }), {
    firstName: "Redacted",
    lastName: "Name",
  });
});

test("workflow snapshot keeps undisclosed private fields out and filters quote answers to matched services", () => {
  const snapshot = publicLeadQuoteWorkflowSnapshot(publicLeadRow([
    "customer_email",
    "postcode",
    "service_categories",
    "customer_message",
  ]));
  assert.ok(snapshot);
  assert.equal(snapshot.contact.email, "customer@example.com");
  assert.equal(snapshot.contact.message, "Please quote the selected work.");
  assert.equal(snapshot.contact.firstName, "");
  assert.equal(snapshot.contact.lastName, "");
  assert.equal(snapshot.contact.phone, "");
  assert.equal(snapshot.contact.addressLine1, "");
  assert.deepEqual(snapshot.categories, ["hot-water"]);
  assert.deepEqual(snapshot.serviceLabels, ["Hot water"]);
  assert.deepEqual(snapshot.answers.map((answer) => answer.questionId), ["timing"]);
  assert.equal(publicLeadQuoteWorkflowSnapshot({
    ...publicLeadRow(["customer_email", "postcode", "service_categories", "customer_message"]),
    opportunity_title: "   ",
    title: "   ",
  })?.title, "Customer enquiry");
});

test("quick request quote workflow keeps collected contact details private unless the customer shares them", () => {
  const row = publicLeadRow([
    "postcode",
    "service_categories",
    "customer_address",
  ], {
    public_contact_notice_version: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
    public_quote_preparation_id: "",
    public_quote_answers: "[]",
  });
  const snapshot = publicLeadQuoteWorkflowSnapshot(row);
  assert.ok(snapshot);
  assert.equal(snapshot.contact.email, "");
  assert.equal(snapshot.contact.firstName, "");
  assert.equal(snapshot.contact.lastName, "");
  assert.equal(snapshot.contact.phone, "");
  assert.equal(snapshot.contact.addressLine1, "1 Secret Street");
  assert.equal(snapshot.contact.addressLine2, "Unit 9");

  const disclosure = publicLeadAcceptedDisclosure(
    snapshot,
    { ...row, match_id: matchId },
    "2026-09-04T01:00:00.000Z",
  );
  assert.ok(disclosure);
  assert.deepEqual({
    firstName: disclosure.customer.firstName,
    lastName: disclosure.customer.lastName,
    email: disclosure.customer.email,
    phone: disclosure.customer.phone,
  }, {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  assert.equal(disclosure.customer.addressLine1, "1 Secret Street");
});

test("released lead quote access fails closed after withdrawal, expiry, closure or invalid consent", () => {
  const active = publicLeadRow([
    "customer_email", "postcode", "service_categories", "customer_message",
  ]);
  assert.ok(publicLeadQuoteAccessSnapshot(active, "2026-08-12T02:00:00.000Z"));
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, public_contact_status: "withdrawn" }, "2026-08-12T02:00:00.000Z"), null);
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, public_contact_withdrawn_at: "2026-08-12T01:30:00.000Z" }, "2026-08-12T02:00:00.000Z"), null);
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, expires_at: "2026-08-12T01:59:59.000Z" }, "2026-08-12T02:00:00.000Z"), null);
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, match_status: "closed" }, "2026-08-12T02:00:00.000Z"), null);
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, opportunity_status: "expired" }, "2026-08-12T02:00:00.000Z"), null);
  assert.equal(publicLeadQuoteAccessSnapshot({ ...active, public_contact_disclosed_fields: "not-json" }, "2026-08-12T02:00:00.000Z"), null);
});

test("workflow start validates only the latest exact contact release", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY, opportunity_id text NOT NULL, firebase_uid text NOT NULL,
      status text NOT NULL, matched_categories text NOT NULL
    );
    CREATE TABLE trade_opportunities (
      id text PRIMARY KEY, title text NOT NULL, summary text NOT NULL,
      priority text NOT NULL, source_reference text NOT NULL, postcode text NOT NULL,
      state text NOT NULL, status text NOT NULL, expires_at text NOT NULL
    );
    CREATE TABLE public_trade_lead_contact_releases (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL,
      status text NOT NULL, withdrawn_at text NOT NULL, disclosed_fields text NOT NULL,
      customer_first_name text NOT NULL, customer_last_name text NOT NULL,
      customer_email text NOT NULL, customer_phone text NOT NULL,
      customer_unit_number text NOT NULL, customer_street_address text NOT NULL,
      customer_suburb text NOT NULL, customer_address_state text NOT NULL,
      postcode text NOT NULL, customer_message text NOT NULL, notice_version text NOT NULL,
      consent_purpose text NOT NULL, granted_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE public_trade_lead_quote_preparations (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL, status text NOT NULL,
      notice_version text NOT NULL, consent_purpose text NOT NULL, granted_at text NOT NULL,
      withdrawn_at text NOT NULL, question_answers text NOT NULL
    );
    INSERT INTO trade_opportunities VALUES (
      'opportunity-1', 'Hot-water quote', 'Replace hot water.', 'standard',
      'AEA-20260812-0011223344556677', '3000', 'VIC', 'open',
      '2099-08-12T00:00:00.000Z'
    );
    INSERT INTO trade_opportunity_matches VALUES (
      '${matchId}', 'opportunity-1', 'trade-a', 'interested', '["hot-water"]'
    );
    INSERT INTO public_trade_lead_quote_preparations VALUES (
      'preparation-1', 'opportunity-1', 'AEA-20260812-0011223344556677', 'active',
      '${PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION}', '${PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE}',
      '2026-08-12T00:00:00.000Z', '', '[]'
    );`);
  const insertRelease = database.prepare(`INSERT INTO public_trade_lead_contact_releases
    VALUES (?, 'opportunity-1', 'AEA-20260812-0011223344556677', ?, ?, ?, '', '',
      'customer@example.com', '', '', '', '', '', '3000', '', ?, ?, ?, ?)`);
  const requiredFields = JSON.stringify(["customer_email", "postcode", "service_categories"]);
  insertRelease.run(
    "release-older-active", "active", "", requiredFields,
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE,
    "2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z",
  );
  insertRelease.run(
    "release-newer-withdrawn", "withdrawn", "2026-08-12T01:01:00.000Z", requiredFields,
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE,
    "2026-08-12T01:00:00.000Z", "2026-08-12T01:01:00.000Z",
  );
  const query = database.prepare(workflowAccessSql());
  const bindings = [
    PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
    matchId,
    "trade-a",
    "interested",
    "2026-08-12T02:00:00.000Z",
  ];
  assert.equal(query.get(...bindings), undefined,
    "a newer withdrawn release blocks the older active release");
  database.prepare("DELETE FROM public_trade_lead_contact_releases WHERE id = 'release-newer-withdrawn'").run();
  assert.equal(query.get(...bindings)?.public_contact_release_id, "release-older-active");
  database.prepare(`UPDATE public_trade_lead_contact_releases
    SET notice_version = ?, consent_purpose = ?
    WHERE id = 'release-older-active'`)
    .run(legacyStructuredAddressNoticeVersion, legacyStructuredAddressPurpose);
  assert.equal(
    query.get(...bindings)?.public_contact_release_id,
    "release-older-active",
    "a legacy consent recognised by lead access also prepares the quote workflow",
  );
  database.prepare(`UPDATE public_trade_lead_contact_releases
    SET consent_purpose = 'unrecognised purpose'
    WHERE id = 'release-older-active'`).run();
  assert.equal(query.get(...bindings), undefined,
    "an unrecognised legacy consent remains closed");
  database.close();
});

test("deterministic workflow writes replay once and an incomplete transaction rolls back", () => {
  const ids = publicLeadQuoteWorkflowIds(matchId);
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE customers (id text PRIMARY KEY);
    CREATE TABLE jobs (id text PRIMARY KEY, customer_id text NOT NULL REFERENCES customers(id));
    CREATE TABLE quotes (id text PRIMARY KEY, job_id text NOT NULL REFERENCES jobs(id));`);
  const create = () => {
    database.exec("BEGIN IMMEDIATE");
    try {
    database.prepare("INSERT OR IGNORE INTO customers (id) VALUES (?)").run(ids.customerId);
    database.prepare("INSERT OR IGNORE INTO jobs (id, customer_id) VALUES (?, ?)").run(ids.workOrderId, ids.customerId);
    database.prepare("INSERT OR IGNORE INTO quotes (id, job_id) VALUES (?, ?)").run(ids.quoteId, ids.workOrderId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  create();
  create();
  assert.equal(database.prepare("SELECT COUNT(*) count FROM customers").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM jobs").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM quotes").get().count, 1);

  const broken = new DatabaseSync(":memory:");
  broken.exec(`CREATE TABLE customers (id text PRIMARY KEY);
    CREATE TABLE quotes (id text PRIMARY KEY, total integer NOT NULL CHECK (total > 0));`);
  const failAtomically = () => {
    broken.exec("BEGIN IMMEDIATE");
    try {
    broken.prepare("INSERT INTO customers (id) VALUES (?)").run(ids.customerId);
    broken.prepare("INSERT INTO quotes (id, total) VALUES (?, 0)").run(ids.quoteId);
      broken.exec("COMMIT");
    } catch (error) {
      broken.exec("ROLLBACK");
      throw error;
    }
  };
  assert.throws(failAtomically, /CHECK constraint failed/);
  assert.equal(broken.prepare("SELECT COUNT(*) count FROM customers").get().count, 0);
  assert.match(server, /const existing = await existingWorkflow\(db, installerUid, matchId, ids\);[\s\S]*if \(existing\) return workflowResponse\(existing, true\);[\s\S]*if \(expectedMatchStatus === "connected"\)[\s\S]*PUBLIC_LEAD_QUOTE_WORKFLOW_UNAVAILABLE/);
  assert.match(opportunityRoute, /\? = 'open_public_quote' AND o\.status IN \('open', 'paused'\)[\s\S]*\? != 'open_public_quote' AND o\.status = 'open'[\s\S]*o\.expires_at > \?/);
  assert.match(server, /JOIN trade_crm_quote_versions v[\s\S]*v\.quote_id = q\.id[\s\S]*v\.version_number = q\.current_version_number/);
  assert.doesNotMatch(server, /JOIN trade_crm_quote_versions v\s*ON v\.id = \?/);
  assert.match(server, /PUBLIC_LEAD_QUOTE_STATE_CHANGED[\s\S]*UPDATE trade_opportunity_matches[\s\S]*INSERT OR IGNORE INTO trade_crm_customers/);
  assert.match(server, /guarded_release\.status = 'active'[\s\S]*public_trade_lead_contact_releases current_release[\s\S]*guarded_opportunity\.expires_at > \?/);
  database.close();
  broken.close();
});

test("issue and email claims allow only one concurrent owner", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE quote_versions (
      id text PRIMARY KEY, status text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE quote_links (
      id text PRIMARY KEY, quote_version_id text NOT NULL UNIQUE
    );
    CREATE TABLE deliveries (
      id text PRIMARY KEY, idempotency_key text NOT NULL UNIQUE,
      status text NOT NULL, attempts integer NOT NULL, updated_at text NOT NULL
    );
    INSERT INTO quote_versions VALUES ('version-1', 'draft', '2026-08-12T00:00:00.000Z');`);
  const issue = database.prepare(`UPDATE quote_versions SET status = 'issuing', updated_at = ?
    WHERE id = ? AND status = 'draft'`);
  assert.equal(issue.run("2026-08-12T01:00:00.000Z", "version-1").changes, 1);
  assert.equal(issue.run("2026-08-12T01:00:00.000Z", "version-1").changes, 0);
  database.prepare("INSERT INTO quote_links VALUES ('link-1', 'version-1')").run();
  database.prepare("UPDATE quote_versions SET status = 'issued' WHERE id = 'version-1' AND status = 'issuing'").run();
  assert.equal(database.prepare("SELECT COUNT(*) count FROM quote_links").get().count, 1);

  const key = "quote:version-1:1:email:initial";
  const insert = database.prepare(`INSERT OR IGNORE INTO deliveries
    VALUES (?, ?, 'queued', 0, ?)`);
  insert.run("candidate-a", key, "2026-08-12T01:00:00.000Z");
  insert.run("candidate-b", key, "2026-08-12T01:00:00.000Z");
  const deliveryId = database.prepare("SELECT id FROM deliveries WHERE idempotency_key = ?").get(key).id;
  const claim = database.prepare(`UPDATE deliveries
    SET status = 'sending', attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND idempotency_key = ? AND (
      status IN ('queued', 'failed') OR (status = 'sending' AND updated_at <= ?)
    )`);
  assert.equal(claim.run("2026-08-12T01:00:01.000Z", deliveryId, key, "2026-08-12T00:50:00.000Z").changes, 1);
  assert.equal(claim.run("2026-08-12T01:00:01.000Z", deliveryId, key, "2026-08-12T00:50:00.000Z").changes, 0);
  assert.equal(database.prepare("SELECT attempts FROM deliveries WHERE id = ?").get(deliveryId).attempts, 1);
  database.prepare("UPDATE deliveries SET status = 'failed', updated_at = '2026-08-12T01:00:02.000Z' WHERE id = ?").run(deliveryId);
  assert.equal(claim.run("2026-08-12T01:00:03.000Z", deliveryId, key, "2026-08-12T00:50:00.000Z").changes, 1);
  assert.equal(claim.run("2026-08-12T01:00:03.000Z", deliveryId, key, "2026-08-12T00:50:00.000Z").changes, 0);
  assert.equal(database.prepare("SELECT attempts FROM deliveries WHERE id = ?").get(deliveryId).attempts, 2);
  database.close();
});

test("a sequential issue batch commits every side effect only for the exact claim token", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE versions (
      id text PRIMARY KEY, status text NOT NULL, claim_token text NOT NULL
    );
    CREATE TABLE quotes (id text PRIMARY KEY, status text NOT NULL);
    CREATE TABLE jobs (id text PRIMARY KEY, status text NOT NULL);
    CREATE TABLE links (id text PRIMARY KEY, version_id text NOT NULL UNIQUE);
    CREATE TABLE events (id text PRIMARY KEY, version_id text NOT NULL);
    INSERT INTO versions VALUES ('version-1', 'issuing', 'claim-winner');
    INSERT INTO quotes VALUES ('quote-1', 'draft');
    INSERT INTO jobs VALUES ('job-1', 'draft');`);
  const commit = (claim, suffix) => {
    const held = database.prepare("SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?").get(claim);
    if (!held) return;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`UPDATE quotes SET status = 'issued' WHERE id = 'quote-1'
        AND EXISTS (SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?)`)
        .run(claim);
      database.prepare(`UPDATE jobs SET status = 'issued' WHERE id = 'job-1'
        AND EXISTS (SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?)`)
        .run(claim);
      database.prepare(`INSERT INTO links SELECT ?, 'version-1'
        WHERE EXISTS (SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?)`)
        .run(`link-${suffix}`, claim);
      database.prepare(`INSERT INTO events SELECT ?, 'version-1'
        WHERE EXISTS (SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?)`)
        .run(`event-${suffix}`, claim);
      database.prepare("UPDATE versions SET status = 'issued', claim_token = '' WHERE id = 'version-1' AND status = 'issuing' AND claim_token = ?")
        .run(claim);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  commit("claim-loser", "loser");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM links").get().count, 0);
  commit("claim-winner", "winner");
  assert.equal(database.prepare("SELECT status FROM versions").get().status, "issued");
  assert.equal(database.prepare("SELECT status FROM quotes").get().status, "issued");
  assert.equal(database.prepare("SELECT status FROM jobs").get().status, "issued");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM links").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM events").get().count, 1);
  commit("claim-winner", "replay");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM links").get().count, 1);
  database.close();
});

test("the issue commit no longer depends on mutable marketplace release state and failed object deletion is retried", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE releases (id text PRIMARY KEY, updated_at text NOT NULL);
    CREATE TABLE accepted_jobs (id text PRIMARY KEY, disclosure_sha256 text NOT NULL);
    CREATE TABLE versions (id text PRIMARY KEY, status text NOT NULL, claim text NOT NULL);
    CREATE TABLE links (id text PRIMARY KEY, version_id text NOT NULL);
    CREATE TABLE trade_issued_document_cleanup (
      object_key text PRIMARY KEY, status text NOT NULL, attempts integer NOT NULL,
      next_attempt_at text NOT NULL, last_error text NOT NULL
    );
    INSERT INTO releases VALUES ('release-1', 'withdrawn-after-acceptance');
    INSERT INTO accepted_jobs VALUES ('job-1', '${"a".repeat(64)}');
    INSERT INTO versions VALUES ('version-1', 'issuing', 'claim-1');`);
  const commit = database.prepare(`INSERT INTO links
    SELECT 'link-1', 'version-1' WHERE EXISTS (
      SELECT 1 FROM versions WHERE id = 'version-1' AND status = 'issuing' AND claim = 'claim-1'
    ) AND EXISTS (
      SELECT 1 FROM accepted_jobs WHERE id = 'job-1' AND disclosure_sha256 = '${"a".repeat(64)}'
    )`);
  assert.equal(commit.run().changes, 1,
    "withdrawal after acceptance does not revoke the business's immutable disclosure");
  database.prepare(`INSERT INTO trade_issued_document_cleanup VALUES
    ('orphan.pdf', 'pending', 1, '2026-08-12T00:00:00.000Z', 'first delete failed')`).run();
  database.prepare(`UPDATE trade_issued_document_cleanup
    SET attempts = attempts + 1, next_attempt_at = '2026-08-12T00:02:00.000Z',
      last_error = 'retry delete failed' WHERE object_key = 'orphan.pdf'`).run();
  assert.deepEqual({ ...database.prepare("SELECT status, attempts, last_error FROM trade_issued_document_cleanup").get() }, {
    status: "pending", attempts: 2, last_error: "retry delete failed",
  });
  database.close();
  assert.match(issuedCleanupMigration, /trade_issued_document_cleanup[\s\S]*next_attempt_at/);
  assert.match(issuedCleanup, /NOT EXISTS \([\s\S]*trade_crm_quote_versions[\s\S]*status = 'issued'/);
  assert.match(issuedCleanup, /deleteImmutableIssuedPdf[\s\S]*DELETE FROM trade_issued_document_cleanup/);
  assert.match(issuedCleanup, /catch \(error\)[\s\S]*attempts = \?[\s\S]*next_attempt_at = \?/);
  assert.match(issuedCleanup, /stageTradeIssuedDocumentCleanup[\s\S]*status = 'staged'/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON[\s\S]*cleanupUnreferencedTradeIssuedDocuments/);
  assert.match(worker, /url\.pathname === "\/api\/health"[\s\S]*cleanupUnreferencedTradeIssuedDocuments/);
});

test("issued document cleanup migration rejects malformed tombstones", () => {
  const database = new DatabaseSync(":memory:");
  for (const statement of issuedCleanupMigration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
  const insert = database.prepare(`INSERT INTO trade_issued_document_cleanup
    (object_key, document_kind, document_id, revision, sha256, size_bytes,
     status, attempts, next_attempt_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`);
  const valid = [
    "trade-issued-documents/quote/quote-1/revision-1/abc.pdf", "quote", "quote-1", 1,
    "a".repeat(64), 5, "staged", 0, "2026-08-12T01:00:00.000Z",
    "2026-08-12T01:00:00.000Z", "2026-08-12T01:00:00.000Z",
  ];
  assert.doesNotThrow(() => insert.run(...valid));
  const rejects = (index, value) => {
    const changed = [...valid]; changed[0] = `${valid[0]}-${index}`; changed[index] = value;
    assert.throws(() => insert.run(...changed), /CHECK constraint failed/);
  };
  rejects(0, "bad\nkey");
  rejects(1, "receipt");
  rejects(2, "bad/id");
  rejects(3, 0);
  rejects(4, "A".repeat(64));
  rejects(5, 12582913);
  rejects(6, "done");
  rejects(7, -1);
  rejects(8, "not-a-date");
  rejects(9, "not-a-date");
  rejects(10, "not-a-date");
  database.close();
});

test("the final public lead issue guard executes against the exact accepted disclosure", () => {
  const database = new DatabaseSync(":memory:");
  const disclosureSha256 = "a".repeat(64);
  database.exec(`CREATE TABLE trade_crm_job_details (
      work_order_id text NOT NULL, firebase_uid text NOT NULL,
      customer_source text NOT NULL, accepted_disclosure_sha256 text NOT NULL,
      accepted_disclosure_snapshot text NOT NULL
    );
    INSERT INTO trade_crm_job_details VALUES (
      'job-1', 'trade-a', 'public_lead_released', '${disclosureSha256}',
      '{"contract":"tlink-public-lead-accepted-disclosure-v1"}'
    );`);
  const guard = publicLeadIssueAccessGuard("trade-a", {
    id: "job-1",
    accepted_disclosure_sha256: disclosureSha256,
    public_lead_enquiry: 1,
  });
  const holds = () => Boolean(database.prepare(`SELECT 1 held WHERE ${guard.sql}`).get(...guard.bindings));
  assert.equal(holds(), true);
  database.prepare("UPDATE trade_crm_job_details SET accepted_disclosure_sha256 = ?")
    .run("b".repeat(64));
  assert.equal(holds(), false, "a changed durable disclosure fingerprint blocks the atomic issue commit");
  database.close();
});

test("Interested creates one explicit draft workflow and never sends a quote", () => {
  assert.match(server, /publicLeadQuoteWorkflowIds\(matchId\)/);
  assert.match(server, /INSERT OR IGNORE INTO trade_crm_customers/);
  assert.match(server, /INSERT OR IGNORE INTO trade_work_orders/);
  assert.match(server, /INSERT OR IGNORE INTO trade_crm_quotes/);
  assert.match(server, /INSERT OR IGNORE INTO trade_crm_quote_versions/);
  assert.match(server, /VALUES \(\?, \?, \?, 1, 'draft'/);
  assert.doesNotMatch(server, /sendServiceReminderProviderMessage|send_quote|issue_quote/);
  assert.match(opportunityRoute, /status === "interested" && currentPublicContact[\s\S]*startPublicLeadQuoteWorkflow/);
  assert.doesNotMatch(opportunityRoute, /Interest is recorded, but the job and quote could not be prepared/);
  assert.match(opportunityRoute, /No interest was recorded\. Try again/);
  assert.match(server, /PUBLIC_LEAD_QUOTE_WORKFLOW_INCOMPLETE/);
  assert.match(server, /publicPlanContactReleaseAccessSql\("contact"\)/);
  assert.match(server, /d\.customer_source = 'public_lead_released'/);
  assert.match(server, /w\.source_type = 'public_lead'/);
  assert.match(server, /ORDER BY datetime\(current_release\.updated_at\) DESC/);
  assert.match(server, /VALUES \(\?, \?, \?, 1, 'draft', '',/);
  assert.match(server, /acceptedCrmName\.firstName, acceptedCrmName\.lastName[\s\S]*snapshot\.contact\.email, snapshot\.contact\.phone/);
  assert.match(server, /snapshot\.contact\.addressLine1, snapshot\.contact\.addressLine2[\s\S]*snapshot\.contact\.postcode/);
  assert.match(server, /publicLeadAcceptedDisclosure\([\s\S]*snapshot,[\s\S]*row,[\s\S]*now/);
  assert.match(server, /acceptedDisclosureJson, acceptedDisclosureSha256, now/);
  assert.match(opportunityRoute, /if \(!result\.meta\.changes\)[\s\S]*SELECT status FROM trade_opportunity_matches[\s\S]*String\(raced\?\.status \|\| ""\) === status[\s\S]*publicLeadQuoteWorkflowOutcome/);
});

test("Interested opens the existing editable quote tool and the brief stays privacy bounded", () => {
  assert.equal(publicLeadQuoteNavigationTarget({
    workOrderId: `public-lead-work-${matchId}`,
    quoteId: `public-lead-quote-${matchId}`,
  })?.jobTab, "quote");
  assert.match(dashboard, /kind: "job"/);
  assert.match(
    dashboard,
    /void respondToOpportunity\(opportunity\.matchId, "interested"\)/,
  );
  assert.match(
    dashboard,
    /opportunity\.platformOnly && opportunity\.matchStatus === "interested"[\s\S]*\? "Edit quote"[\s\S]*\? "Continue quote"[\s\S]*: "Quote"/,
  );
  assert.match(
    dashboard,
    /document\.getElementById\(`lead-quote-\$\{opportunity\.matchId\}`\)[\s\S]*scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)[\s\S]*querySelector<HTMLElement>\("input, textarea, select, button"\)\?\.focus/,
  );
  assert.doesNotMatch(dashboard, /Open customer quote|Your customer quote is ready/);
  assert.doesNotMatch(dashboard, /Account readiness|dashboard-readiness|dashboard-main-grid/);
  const directJob = quoteRoute.slice(quoteRoute.indexOf("async function directJob"), quoteRoute.indexOf("async function currentPublicLeadJob"));
  assert.match(directJob, /accepted_disclosure_snapshot, d\.accepted_disclosure_sha256, d\.accepted_disclosure_at/);
  assert.doesNotMatch(directJob, /public_trade_lead_contact_releases|trade_opportunity_matches|trade_opportunities/);
  assert.match(quoteRoute, /enquiryServices:/);
  assert.match(quoteRoute, /enquiryBrief:/);
  assert.match(quoteUi, /Customer enquiry brief/);
  assert.match(quoteUi, /full private plan is not included/);
  assert.match(quoteUi, /currentLines\.length \? currentLines : \[blankLine\(\)\]/);
});

test("public lead save, issue and send use one immutable accepted recipient", () => {
  assert.match(quoteRoute, /PUBLIC_LEAD_QUOTE_ACCESS_ENDED/);
  assert.match(quoteRoute, /if \(acceptedEmail\)[\s\S]*return EMAIL_PATTERN\.test\(acceptedEmail\) \? \[acceptedEmail\] : \[\]/);
  assert.match(quoteRoute, /const storedCustomerEmail = job\.public_lead_enquiry \? "" : customerEmail/);
  assert.match(quoteRoute, /acceptanceEmail: customerEmail/);
  assert.doesNotMatch(quoteRoute, /ORDER BY datetime\(current_release\.updated_at\) DESC/);
  assert.match(quoteRoute, /action === "save_draft"[\s\S]*authorisedEmails\(access\.ownerUid, String\(job\.crm_customer_id\), acceptedPublicEmail\(job\)\)/);
  assert.match(quoteRoute, /action === "issue_quote"[\s\S]*authorisedEmails\(access\.ownerUid, String\(job\.crm_customer_id\), acceptedPublicEmail\(job\)\)/);
  assert.match(quoteRoute, /\["replace_link", "revoke_link", "send_quote", "retry_quote_delivery", "answer_question"\][\s\S]*authorisedEmails\(access\.ownerUid, String\(job\.crm_customer_id\), acceptedPublicEmail\(job\)\)/);
  assert.match(quoteRoute, /acceptedQuoteSnapshotOverrides\(job\)/);
  const accessGuard = read("../src/lib/public-lead-quote-workflow.mjs");
  assert.doesNotMatch(quoteRoute, /sendServiceReminderProviderMessage/);
  assert.match(worker, /drainTradeQuoteDeliveries\(\{ db: getD1\(\) \}\)/);
  assert.match(quoteDeliveryServer, /provider\?\.sendServiceReminderProviderMessage/);
  assert.match(quoteDeliveryServer, /String\(row\.source_type \|\| ""\) === "public_lead"[\s\S]*acceptedDisclosure\.contract !== "tlink-public-lead-accepted-disclosure-v1"[\s\S]*acceptedDisclosure\.customer as Row \| undefined\)\?\.email[\s\S]*row\.customer_email/);
  assert.match(quoteDeliveryServer, /tradeQuoteRecipientEmailSha256\(email\) !== String\(row\.recipient_email_sha256 \|\| ""\)/);
  assert.match(quoteRoute, /INSERT OR IGNORE INTO trade_crm_quote_deliveries[\s\S]*'queued'/);
  assert.match(quoteRoute, /await tradeQuoteRecipientEmailSha256\(customerEmail\), providerIdempotencyKey/);
  assert.match(quoteRoute, /deliveryAccepted: accepted[\s\S]*accepted \? 200 : 202/);
  assert.match(quoteDeliveryServer, /SET status = 'sending', attempts = \?, next_attempt_at = ''[\s\S]*WHERE id = \? AND firebase_uid = \? AND status = \? AND attempts = \?/);
  assert.match(quoteRoute, /status = 'issuing'[\s\S]*WHERE id = \? AND firebase_uid = \? AND status = 'draft'/);
  assert.match(quoteRoute, /await currentPublicLeadJob\(access\.ownerUid, workOrderId, job\);[\s\S]*storeTradeQuoteIssuedPdf/);
  assert.match(quoteRoute, /deleteTradeQuoteIssuedPdf/);
  assert.match(quoteRoute, /const issueClaimToken = `issuing:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(quoteRoute, /const claimStillHeld = `EXISTS/);
  const issueStart = quoteRoute.indexOf('action === "issue_quote"');
  const issueBatch = quoteRoute.indexOf("await db.batch([", issueStart);
  const issueStore = quoteRoute.indexOf("await storeTradeQuoteIssuedPdf", issueStart);
  const issueFinalTransition = quoteRoute.indexOf(
    "SET status = 'issued', acceptance_email",
    issueBatch,
  );
  assert.ok(issueStore < issueBatch, "the exact R2 PDF must exist before its DB reference commits");
  assert.ok(issueFinalTransition > quoteRoute.indexOf("INSERT INTO trade_crm_quote_links", issueBatch),
    "the claim token remains valid until the last version transition");
  assert.match(quoteRoute, /SELECT 1 referenced[\s\S]*issued_pdf_object_key = \?[\s\S]*status = 'issued'[\s\S]*if \(!referenced\)[\s\S]*deleteTradeQuoteIssuedPdf/);
  assert.match(quoteRoute, /verifyTradeQuoteIssuedPdf/);
  assert.match(quoteRoute, /publicLeadQuoteAccessFingerprint\(current\)[\s\S]*publicLeadQuoteAccessFingerprint\(priorJob\)/);
  assert.match(quoteRoute, /const publicAccessHeld = publicLeadIssueAccessGuard\(/);
  assert.match(accessGuard, /trade_crm_job_details accepted_detail[\s\S]*accepted_detail\.accepted_disclosure_sha256 = \?/);
  assert.doesNotMatch(accessGuard, /current_release|current_match|current_opportunity|current_preparation/);
  assert.match(quoteRoute, /publicLeadIssueAccessGuard\(\s*access\.ownerUid/);
  assert.match(quoteRoute, /stageTradeIssuedDocumentCleanup[\s\S]*storeTradeQuoteIssuedPdf/);
});

test("issued link access remains immutable and owner revoke does not require released lead PII", () => {
  assert.doesNotMatch(quoteDocumentServer, /publicLeadQuoteAccessSnapshot|public_trade_lead_contact_releases/);
  assert.match(quoteDocumentServer, /row\.status !== "active"[\s\S]*row\.version_status !== "issued"/);
  const revoke = quoteRoute.slice(
    quoteRoute.indexOf("async function revokeOwnedQuoteLink"),
    quoteRoute.indexOf("function errorResponse"),
  );
  assert.match(revoke, /work\.firebase_uid = \?/);
  assert.match(revoke, /token_hash = '', encrypted_token = ''/);
  assert.doesNotMatch(revoke, /public_trade_lead_contact_releases|customer_email|first_name|last_name/);
  const post = quoteRoute.indexOf("export async function POST");
  assert.ok(quoteRoute.indexOf('action === "revoke_link"', post) < quoteRoute.indexOf("const job = await directJob", post));
});
