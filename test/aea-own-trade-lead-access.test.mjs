import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL } from "../src/lib/firebase-mfa.ts";
import * as routing from "../src/lib/aea-trade-routing.mjs";
import * as plan from "../src/lib/public-plan-enquiry.mjs";
import * as quick from "../src/lib/quick-upgrade-enquiry.mjs";
import * as preparation from "../src/lib/public-plan-quote-preparation.mjs";
import * as workflow from "../src/lib/public-lead-quote-workflow.mjs";
import { publicTradeContactForMatchedLead } from "../src/lib/public-trade-lead-access.mjs";
import { projectPublicMarketplaceEnquiry } from "../src/lib/public-marketplace-enquiry-projection.mjs";
import { ensureTlinkSchemaGuards } from "../src/lib/tlink-schema-guards.ts";
import * as customerProjects from "../src/lib/customer-projects.mjs";
import * as locality from "../src/lib/customer-matching-locality.mjs";
import * as readProjection from "../src/lib/trade-opportunity-read-projection.mjs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = "2026-09-22T01:04:00.000Z";
const matchId = "39c16039-4acd-4664-a2e5-3d8ad0dd7dd6";
const reference = "AEA-20260922-0011223344556677";
const categories = '["assessment","solar"]';
const quickContact = {
  notice_version: quick.AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  consent_purpose: quick.AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
  // AEA-only quick enquiries submit email/name/phone sharing as false.
  disclosed_fields: '["postcode","service_categories","customer_address","customer_message"]',
  customer_first_name: "Alex", customer_last_name: "Customer",
  customer_email: "alex@example.test", customer_phone: "0412345678",
  customer_street_address: "10 Example Street", customer_suburb: "Melbourne",
  customer_address_state: "VIC", customer_message: "Please arrange an assessment.",
};
const modules = new Map([
  ["aea-trade-routing.mjs", routing],
  ["public-plan-enquiry.mjs", plan],
  ["public-plan-quote-preparation.mjs", preparation],
  ["public-lead-quote-workflow.mjs", workflow],
  ["firebase-server", { requireFirebaseIdentity: () => { throw new Error("Unexpected authentication call"); } }],
  ["creditex-schema-guards", { ensureCreditexSchemaGuards: async () => {} }],
  ["db", { getD1: () => { throw new Error("An explicit test database is required"); } }],
]);

function loadTypescript(path, overrides = {}) {
  const result = { exports: {} };
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const require = (specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    const name = specifier.split("/").at(-1).replace(/\.ts$/, "");
    if (modules.has(name)) return modules.get(name);
    assert.ok(["public-site", "trade-abn", "firebase-mfa", "myob-security-audit", "trade-mfa-server", "trade-access-server", "aea-trade-owner-server", "trade-certificate-leads"].includes(name), `Unexpected dependency: ${specifier}`);
    const loaded = loadTypescript(`src/lib/${name}.ts`);
    modules.set(name, loaded);
    return loaded;
  };
  new Function("require", "module", "exports", output)(require, result, result.exports);
  return result.exports;
}

// These tests exercise generic verification directly; do not depend on the AEA
// helper importing it transitively to populate the module registry.
modules.set("trade-access-server", loadTypescript("src/lib/trade-access-server.ts"));
const owner = loadTypescript("src/lib/aea-trade-owner-server.ts");
modules.set("aea-trade-owner-server", owner);
const certificate = loadTypescript("src/lib/trade-certificate-leads.ts");
modules.set("trade-certificate-leads", certificate);
const server = loadTypescript("src/lib/public-lead-quote-workflow-server.ts", {
  "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => ({
    get: async () => { throw new Error("No photo was seeded"); },
  }) },
  "@/lib/trade-job-number-server": { nextTlinkJobNumber: async () => "JOB-000001" },
  "@/lib/tlink-schema-guards": { ensureTlinkSchemaGuards },
});

function d1(database, { beforeWorkflowBatch, beforeReadBatch } = {}) {
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return database.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
    execute() {
      const statement = database.prepare(this.sql);
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(this.sql)) return { results: statement.all(...this.values), success: true, meta: {} };
      return { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async run() { return this.execute(); }
  }
  return {
    prepare: (sql) => new Statement(sql),
    batch: async (statements) => {
      if (statements.some((statement) => statement.sql.includes("workflow_guard"))) beforeWorkflowBatch?.();
      if (statements.some((statement) => statement.sql.includes("m.id match_id, m.firebase_uid installer_uid"))) beforeReadBatch?.(statements);
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function insert(database, table, values) {
  const supplied = { ...values };
  for (const column of database.prepare(`PRAGMA table_info(${table})`).all()) {
    if (column.notnull && column.dflt_value === null && !Object.hasOwn(supplied, column.name)) {
      supplied[column.name] = column.type === "INTEGER" ? 0 : "";
    }
  }
  const keys = Object.keys(supplied);
  database.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => supplied[key]));
}

function fixture(contactOverrides = {}) {
  const database = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of fs.readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    for (const statement of fs.readFileSync(new URL(name, directory), "utf8").split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      try { database.exec(statement); }
      catch (error) {
        const fts = statement.match(/^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is);
        if (!fts || !error.message.includes("no such module: fts5")) throw error;
        // Node SQLite lacks FTS5; only unrelated search tables use plain columns.
        // All lead, consent, verification and quote constraints remain the real schema.
        const columns = fts[2].split(",").map((value) => value.trim()).filter((value) => !value.startsWith("tokenize="))
          .map((value) => `${value.split(/\s+/)[0]} text`);
        database.exec(`CREATE TABLE ${fts[1]} (${columns.join(",")})`);
      }
    }
  }
  for (const uid of ["aea-owner", "external-owner"]) {
    const abn = uid === "aea-owner" ? "73675233557" : "53004085616";
    insert(database, "trade_accounts", { firebase_uid: uid, email: `${uid}@example.test`,
      business_name: uid, abn, verified_abn: abn, partner_type: "installer",
      account_status: "active", verification_status: "approved", verification_review_id: `review-${uid}`,
      verification_reviewed_at: now, verification_reviewed_by_uid: "reviewer", capabilities: '["solar"]',
      service_states: '["VIC"]', address_state: "VIC", created_at: now, updated_at: now });
    insert(database, "trade_account_verification_reviews", { id: `review-${uid}`, firebase_uid: uid,
      abn, business_name: uid, partner_type: "installer", decision: "approved", review_method: "official_abr_lookup",
      reviewed_by_uid: "reviewer", reviewed_at: now });
  }
  insert(database, "admin_users", { id: "admin-aea", firebase_uid: "aea-owner", email: "aea-owner@example.test", role: "owner", status: "active", created_at: now, updated_at: now });
  insert(database, "trade_opportunities", { id: "opportunity-1", title: "Energy assessment", project_type: "assessment",
    postcode: "3000", state: "VIC", service_categories: categories, status: "open", source_reference: reference,
    expires_at: "2099-09-22T01:04:00.000Z", created_at: now, updated_at: now });
  insert(database, "trade_opportunity_matches", { id: matchId, opportunity_id: "opportunity-1", firebase_uid: "aea-owner",
    status: "offered", matched_categories: categories, matched_at: now, updated_at: now });
  insert(database, "public_trade_lead_contact_releases", { id: "release-1", opportunity_id: "opportunity-1", source_reference: reference,
    status: "active", notice_version: plan.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: plan.PUBLIC_PLAN_CONSENT_PURPOSE,
    disclosed_fields: '["customer_email","postcode","service_categories"]', customer_email: "customer@example.test",
    customer_first_name: "Not", customer_last_name: "Disclosed", customer_phone: "0400000000",
    customer_street_address: "1 Private Street", postcode: "3000", granted_at: now, withdrawn_at: "", created_at: now, updated_at: now,
    ...contactOverrides });
  insert(database, "trade_crm_enquiries", { id: `marketplace-${matchId}`, firebase_uid: "aea-owner", source_type: "tlink_marketplace",
    source_reference: matchId, opportunity_match_id: matchId, status: "new", record_status: "active", protected_source: 1, created_at: now, updated_at: now });
  return { database, db: d1(database) };
}

function contactRow(overrides = {}) {
  return {
    source_type: "tlink_marketplace", source_reference: reference, public_opportunity_source_reference: reference,
    opportunity_service_categories: categories, opportunity_postcode: "3000", state: "VIC", opportunity_state: "VIC",
    public_contact_release_id: "release-1", public_contact_status: "active", public_contact_source_reference: reference,
    public_contact_withdrawn_at: "", public_contact_disclosed_fields: '["customer_email","postcode","service_categories"]',
    public_contact_notice_version: plan.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, public_contact_consent_purpose: plan.PUBLIC_PLAN_CONSENT_PURPOSE,
    public_contact_postcode: "3000", public_contact_granted_at: now, public_customer_email: "customer@example.test",
    public_customer_first_name: "Not", public_customer_last_name: "Disclosed", public_customer_phone: "0400000000", matched_categories: categories,
    match_status: "interested", opportunity_status: "open", expires_at: "2099-09-22T00:00:00.000Z", ...overrides,
  };
}

test("current AEA handling consent exposes retained contacts only with explicit AEA authorization", () => {
  const row = contactRow();
  for (const authorization of [undefined, false, 1, "true"]) {
    assert.equal(publicTradeContactForMatchedLead(row, authorization), null);
    assert.equal(projectPublicMarketplaceEnquiry(row, authorization), null);
    assert.equal(workflow.publicLeadQuoteWorkflowSnapshot(row, authorization), null);
  }
  const contact = publicTradeContactForMatchedLead(row, true);
  assert.equal(contact.releaseScope, "aea_only");
  assert.equal(contact.email, "customer@example.test");
  assert.equal(contact.firstName, "Not");
  assert.equal(contact.lastName, "Disclosed");
  assert.equal(contact.phone, "0400000000");
  assert.deepEqual(contact.redactedFields, []);
  const projected = projectPublicMarketplaceEnquiry(row, true);
  assert.equal(projected.email, contact.email);
  assert.equal(projected.phone, "0400000000");
  assert.equal(Object.hasOwn(projected, "public_customer_first_name"), false);
  assert.deepEqual(workflow.publicLeadQuoteWorkflowSnapshot(row, true).categories, ["assessment", "solar"]);
  assert.ok(workflow.publicLeadQuoteAccessSnapshot(row, now, true));
  for (const change of [{ public_contact_withdrawn_at: now }, { public_contact_status: "withdrawn" },
    { public_contact_consent_purpose: "different purpose" }, { public_contact_source_reference: "another" },
    { opportunity_service_categories: '["assessment",null]' }, { opportunity_service_categories: "invalid" }]) {
    assert.equal(publicTradeContactForMatchedLead(contactRow(change), true), null);
    assert.equal(workflow.publicLeadQuoteWorkflowSnapshot(contactRow(change), true), null);
  }
});

function quickContactRow(overrides = {}) {
  return contactRow({
    public_contact_notice_version: quickContact.notice_version,
    public_contact_consent_purpose: quickContact.consent_purpose,
    public_contact_disclosed_fields: quickContact.disclosed_fields,
    public_customer_first_name: quickContact.customer_first_name,
    public_customer_last_name: quickContact.customer_last_name,
    public_customer_email: quickContact.customer_email,
    public_customer_phone: quickContact.customer_phone,
    public_customer_street_address: quickContact.customer_street_address,
    public_customer_suburb: quickContact.customer_suburb,
    public_customer_address_state: quickContact.customer_address_state,
    public_customer_message: quickContact.customer_message,
    ...overrides,
  });
}

test("AEA quick enquiry retains its contact in lead and quote projections without changing trade consent", () => {
  const row = quickContactRow();
  const before = structuredClone(row);
  const contact = publicTradeContactForMatchedLead(row, true);
  assert.equal(contact.name, "Alex Customer");
  assert.equal(contact.email, "alex@example.test");
  assert.equal(contact.phone, "0412345678");
  assert.equal(contact.releaseScope, "aea_only");
  assert.deepEqual(contact.redactedFields, []);
  const enquiry = projectPublicMarketplaceEnquiry(row, true);
  assert.equal(enquiry.first_name, "Alex");
  assert.equal(enquiry.email, contact.email);
  assert.equal(enquiry.phone, contact.phone);
  const snapshot = workflow.publicLeadQuoteWorkflowSnapshot(row, true);
  assert.deepEqual(snapshot.contact, contact);
  const disclosure = workflow.publicLeadAcceptedDisclosure(snapshot, row, now);
  assert.equal(disclosure.customer.firstName, "Alex");
  assert.equal(disclosure.customer.phone, contact.phone);
  assert.deepEqual(disclosure.source.disclosedFields, JSON.parse(row.public_contact_disclosed_fields).sort());
  assert.equal(disclosure.source.contactAccessBasis, "aea_service_handling");
  assert.deepEqual(row, before, "reading AEA contact must not rewrite the customer's sharing choices");
});

test("new mandatory-email AEA consent retains name and phone without external sharing", () => {
  const row = quickContactRow({
    public_contact_notice_version: quick.QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: quick.QUICK_UPGRADE_CONSENT_PURPOSE,
    public_contact_disclosed_fields: JSON.stringify([...JSON.parse(quickContact.disclosed_fields), "customer_email"]),
  });
  const contact = publicTradeContactForMatchedLead(row, true);
  assert.equal(contact.name, "Alex Customer");
  assert.equal(contact.email, "alex@example.test");
  assert.equal(contact.phone, "0412345678");
  assert.deepEqual(contact.redactedFields, []);
  assert.equal(publicTradeContactForMatchedLead(row), null);
});

test("retained AEA contact never widens external sharing or older consent", () => {
  for (const authorization of [undefined, false, 1, "true"]) {
    assert.equal(publicTradeContactForMatchedLead(quickContactRow(), authorization), null);
  }
  for (const allowAeaDelivery of [false, true]) {
    const noEmail = quickContactRow({ opportunity_service_categories: '["solar"]' });
    assert.equal(publicTradeContactForMatchedLead(noEmail, allowAeaDelivery), null);
    const externalScope = publicTradeContactForMatchedLead(quickContactRow({
      opportunity_service_categories: '["solar"]',
      public_contact_disclosed_fields: JSON.stringify([...JSON.parse(quickContact.disclosed_fields), "customer_email"]),
    }), allowAeaDelivery);
    assert.equal(externalScope.name, "");
    assert.equal(externalScope.email, "alex@example.test");
    assert.equal(externalScope.phone, "");
    assert.equal(externalScope.releaseScope, "all_qualified_trades");
    assert.deepEqual(externalScope.redactedFields, ["name", "phone"]);
    assert.equal(externalScope.accessBasis, undefined);
  }
  const olderQuickRow = quickContactRow({
    public_contact_notice_version: quick.PREVIOUS_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: quick.PREVIOUS_QUICK_UPGRADE_CONSENT_PURPOSE,
  });
  assert.equal(publicTradeContactForMatchedLead(olderQuickRow, true), null);
  const olderQuick = publicTradeContactForMatchedLead({ ...olderQuickRow,
    public_contact_disclosed_fields: JSON.stringify([...JSON.parse(quickContact.disclosed_fields), "customer_email"]),
  }, true);
  assert.equal(olderQuick.name, "");
  assert.equal(olderQuick.email, "alex@example.test");
  assert.equal(olderQuick.phone, "");
  assert.deepEqual(olderQuick.redactedFields, ["name", "phone"]);
  const olderPlan = publicTradeContactForMatchedLead(contactRow({
    public_contact_notice_version: "2026-08-21-quote-preparation-sharing-notice-v8",
    public_contact_consent_purpose: "Email my private plan and share my email, postcode, services, message, quote answers and selected photos with approved trades matched to my area",
  }), true);
  assert.equal(olderPlan.email, "customer@example.test");
  assert.equal(olderPlan.name, "");
  assert.equal(olderPlan.phone, "");
  assert.deepEqual(olderPlan.redactedFields, ["name", "phone"]);
});

test("AEA quick enquiry contact still requires a current valid receipt and valid retained email", () => {
  for (const change of [
    { public_contact_withdrawn_at: now }, { public_contact_status: "withdrawn" },
    { public_contact_source_reference: "another" }, { public_contact_postcode: "3001" },
    { public_contact_granted_at: "invalid" }, { public_contact_release_id: "" },
    { public_contact_consent_purpose: plan.PUBLIC_PLAN_CONSENT_PURPOSE },
    { public_contact_notice_version: "unknown" }, { public_contact_disclosed_fields: "[]" },
    { opportunity_service_categories: '["assessment",null]' },
    { public_customer_email: "invalid" }, { public_customer_email: "" },
    { public_customer_first_name: "" }, { public_customer_last_name: "" }, { public_customer_phone: "" },
  ]) {
    const row = quickContactRow(change);
    assert.equal(publicTradeContactForMatchedLead(row, true), null, JSON.stringify(change));
    assert.equal(projectPublicMarketplaceEnquiry(row, true), null, JSON.stringify(change));
    assert.equal(workflow.publicLeadQuoteWorkflowSnapshot(row, true), null, JSON.stringify(change));
  }
});

test("real quote handoff creates one owner-scoped job and quote with retained AEA-only disclosure", async () => {
  const { database, db } = fixture();
  const first = await server.startPublicLeadQuoteWorkflow(db, "aea-owner", matchId, now, "offered");
  assert.equal(first.replayed, false);
  const second = await server.startPublicLeadQuoteWorkflow(db, "aea-owner", matchId, now, "interested");
  assert.equal(second.workOrderId, first.workOrderId);
  assert.equal(second.replayed, true);
  assert.equal(database.prepare("SELECT count(*) count FROM trade_work_orders").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM trade_crm_quotes").get().count, 1);
  const customer = database.prepare("SELECT * FROM trade_crm_customers WHERE id=?").get(first.customerId);
  assert.equal(customer.firebase_uid, "aea-owner");
  assert.equal(customer.email, "customer@example.test");
  assert.equal(customer.first_name, "Not");
  assert.equal(customer.phone, "0400000000");
  const detail = database.prepare("SELECT * FROM trade_crm_job_details WHERE work_order_id=?").get(first.workOrderId);
  const disclosure = JSON.parse(detail.accepted_disclosure_snapshot);
  assert.deepEqual(disclosure.enquiry.categories, ["assessment", "solar"]);
  assert.equal(disclosure.source.consentPurpose, plan.PUBLIC_PLAN_CONSENT_PURPOSE);
  assert.match(detail.accepted_disclosure_sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(server.startPublicLeadQuoteWorkflow(db, "external-owner", matchId, now), /UNAVAILABLE/);
  database.close();
});

test("AEA quick enquiry quote handoff uses saved contacts when no contacts were shared with other trades", async () => {
  const { database, db } = fixture(quickContact);
  const before = database.prepare("SELECT * FROM public_trade_lead_contact_releases").get();
  const result = await server.startPublicLeadQuoteWorkflow(db, "aea-owner", matchId, now, "offered");
  const customer = database.prepare("SELECT * FROM trade_crm_customers WHERE id=?").get(result.customerId);
  assert.equal(customer.first_name, "Alex");
  assert.equal(customer.last_name, "Customer");
  assert.equal(customer.email, "alex@example.test");
  assert.equal(customer.phone, "0412345678");
  const detail = database.prepare("SELECT * FROM trade_crm_job_details WHERE work_order_id=?").get(result.workOrderId);
  const disclosure = JSON.parse(detail.accepted_disclosure_snapshot);
  assert.equal(disclosure.customer.email, "alex@example.test");
  assert.equal(disclosure.customer.phone, "0412345678");
  assert.deepEqual(disclosure.source.disclosedFields, JSON.parse(quickContact.disclosed_fields).sort());
  assert.equal(disclosure.source.contactAccessBasis, "aea_service_handling");
  assert.deepEqual(database.prepare("SELECT * FROM public_trade_lead_contact_releases").get(), before);
  await assert.rejects(server.startPublicLeadQuoteWorkflow(db, "external-owner", matchId, now), /UNAVAILABLE/);
  database.close();
});

for (const [label, revoke] of [
  ["admin authority", (database) => database.exec("UPDATE admin_users SET status='suspended'")],
  ["ABN review", (database) => database.exec("UPDATE trade_accounts SET verification_status='pending' WHERE firebase_uid='aea-owner'")],
  ["contact consent", (database) => database.prepare("UPDATE public_trade_lead_contact_releases SET withdrawn_at=?").run(now)],
]) {
  test(`quote transaction rechecks ${label} after the initial read and rolls back`, async () => {
    const { database } = fixture(quickContact);
    let revokedBeforeCommit = false;
    const db = d1(database, { beforeWorkflowBatch: () => { revoke(database); revokedBeforeCommit = true; } });
    await assert.rejects(server.startPublicLeadQuoteWorkflow(db, "aea-owner", matchId, now, "offered"), /malformed JSON/);
    assert.equal(revokedBeforeCommit, true, "the test must reach the actual workflow transaction");
    assert.equal(database.prepare("SELECT count(*) count FROM trade_crm_customers").get().count, 0);
    assert.equal(database.prepare("SELECT count(*) count FROM trade_work_orders").get().count, 0);
    assert.equal(database.prepare("SELECT status FROM trade_opportunity_matches WHERE id=?").get(matchId).status, "offered");
    database.close();
  });
}

function expand(sql) {
  return sql
    .replaceAll(/\$\{tradeOpportunityOwnerScopeSql\("([^"]+)", "([^"]+)"\)\}/g, (_, alias, uid) => owner.tradeOpportunityOwnerScopeSql(alias, uid))
    .replaceAll(/\$\{(?:await )?certificateLeadEligibilitySql\("([^"]+)", "([^"]+)", "([^"]+)"\)\}/g,
      (_, uid, services, state) => certificate.certificateLeadEligibilitySql(uid, services, state))
    .replaceAll(/\$\{verifiedTradeAccountPredicate\("([^"]+)"\)\}/g,
      (_, alias) => modules.get("trade-access-server").verifiedTradeAccountPredicate(alias));
}

test("production lead list SQL admits AEA reserved scope and rejects other owners and revoked AEA", () => {
  const { database } = fixture();
  const source = read("src/app/api/trade-opportunities/route.ts");
  const sql = source.match(/const authorizedLeadIdsStatement = db\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const statement = database.prepare(expand(sql));
  assert.equal(statement.all("aea-owner", "", "").length, 1);
  assert.equal(statement.all("external-owner", "", "").length, 0);
  database.prepare("UPDATE trade_opportunity_matches SET firebase_uid='external-owner'").run();
  assert.equal(statement.all("external-owner", "", "").length, 0, "a legacy external match cannot disclose AEA scope");
  database.prepare("UPDATE trade_opportunity_matches SET firebase_uid='aea-owner'").run();
  database.exec("UPDATE admin_users SET status='suspended'");
  assert.equal(statement.all("aea-owner", "", "").length, 0);
  database.close();
});

test("legacy enquiry list and detail return the authorized projection once and deny revoked AEA", async () => {
  const { database, db } = fixture();
  database.exec("UPDATE trade_opportunity_matches SET status='interested'");
  const route = loadTypescript("src/app/api/trade-enquiries/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { sameOrigin: () => true, cleanAdminText: (value, length) => String(value || "").slice(0, length),
      mfaErrorResponse: (error) => error instanceof FirebaseMfaRequiredError ? Response.json({ ok: false, code: "MFA_REQUIRED", error: MFA_REQUIRED_MESSAGE, setupUrl: MFA_SETUP_URL }, { status: 403 }) : null,
      adminJson: (body, status = 200) => Response.json(body, { status }) },
    "@/lib/direct-trade-entitlements-server": { accountEntitlements: async () => ({ features: { business_operations: true } }) },
    "@/lib/trade-access-server": { ...modules.get("trade-access-server"),
      requireVerifiedTradeAccess: async () => ({ identity: { uid: "aea-owner" } }) },
    "@/lib/trade-customer-dedup-server": { findDirectCustomerDuplicates: () => { throw new Error("Protected contacts must not be used for duplicate search"); } },
    "@/lib/public-marketplace-enquiry-projection.mjs": { projectPublicMarketplaceEnquiry },
  });
  const listing = await route.GET(new Request("https://test/api/trade-enquiries"));
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).enquiries[0].email, "customer@example.test");
  const url = `https://test/api/trade-enquiries?id=marketplace-${matchId}`;
  const detail = await route.GET(new Request(url));
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.enquiry.email, "customer@example.test");
  assert.equal(body.enquiry.firstName, "Not");
  assert.equal(body.enquiry.phone, "0400000000");
  assert.equal(Object.hasOwn(body.enquiry, "publicCustomerFirstName"), false);
  database.exec("UPDATE admin_users SET status='suspended'");
  const denied = await route.GET(new Request(url));
  assert.equal(denied.status, 404);
  database.close();
});

test("production photo download query retains owner authority and both consent boundaries", () => {
  const { database } = fixture();
  insert(database, "public_trade_lead_quote_preparations", { id: "preparation-1", opportunity_id: "opportunity-1", source_reference: reference,
    status: "active", notice_version: preparation.PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    consent_purpose: preparation.PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE, granted_at: now, withdrawn_at: "", created_at: now, updated_at: now });
  insert(database, "public_trade_lead_quote_photos", { id: "photo-1", opportunity_id: "opportunity-1",
    status: "active", service_categories: categories, content_type: "image/jpeg", size_bytes: 10,
    object_key: "private/photo-1", sha256: "a".repeat(64), privacy_status: "metadata-stripped", created_at: now, updated_at: now });
  const source = read("src/app/api/public-plan-quote-preparation/route.ts").split("export async function GET(request: Request)")[1];
  const sql = source.match(/const row = await getD1\(\)\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const statement = database.prepare(expand(sql));
  const download = (uid) => statement.get(preparation.PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION, preparation.PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
    uid, plan.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, plan.PUBLIC_PLAN_CONSENT_PURPOSE, "photo-1");
  assert.ok(download("aea-owner"));
  assert.equal(download("external-owner"), undefined);
  database.exec("UPDATE admin_users SET status='suspended'");
  assert.equal(download("aea-owner"), undefined);
  database.exec("UPDATE admin_users SET status='active'");
  database.prepare("UPDATE public_trade_lead_quote_preparations SET withdrawn_at=?").run(now);
  assert.equal(download("aea-owner"), undefined);
  database.exec("UPDATE public_trade_lead_quote_preparations SET withdrawn_at=''");
  database.prepare("UPDATE public_trade_lead_contact_releases SET withdrawn_at=?").run(now);
  assert.equal(download("aea-owner"), undefined);
  database.close();
});

test("production household plan and evidence queries retain their separate consent checks for AEA", () => {
  const { database } = fixture();
  database.exec("UPDATE trade_opportunities SET source_reference='customer-project:project-1'");
  insert(database, "customer_projects", { id: "project-1", firebase_uid: "customer-1", opportunity_id: "opportunity-1",
    postcode: "3000", address_state: "VIC", service_categories: categories, created_at: now, updated_at: now });
  for (const purpose of ["anonymized_installer_matching", "installer_evidence_sharing"]) {
    insert(database, "customer_consent_receipts", { id: purpose, project_id: "project-1", firebase_uid: "customer-1",
      purpose, granted_at: now, withdrawn_at: "", created_at: now });
  }
  const planSql = read("src/app/api/trade-opportunity-plan/route.ts").match(/const project = await db\.prepare\(`([\s\S]*?)`\)/)?.[1];
  const evidenceSql = read("src/app/api/customer-project-evidence/route.ts").match(/const access = await getD1\(\)\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(planSql && evidenceSql);
  const viewPlan = database.prepare(expand(planSql));
  const viewEvidence = database.prepare(expand(evidenceSql));
  assert.ok(viewPlan.get(matchId, "aea-owner"));
  assert.ok(viewEvidence.get("project-1", "customer-1", "aea-owner"));
  assert.equal(viewPlan.get(matchId, "external-owner"), undefined);
  assert.equal(viewEvidence.get("project-1", "customer-1", "external-owner"), undefined);
  database.prepare("UPDATE customer_consent_receipts SET withdrawn_at=? WHERE purpose='installer_evidence_sharing'").run(now);
  assert.equal(viewEvidence.get("project-1", "customer-1", "aea-owner"), undefined);
  assert.ok(viewPlan.get(matchId, "aea-owner"));
  database.prepare("UPDATE customer_consent_receipts SET withdrawn_at=? WHERE purpose='anonymized_installer_matching'").run(now);
  assert.equal(viewPlan.get(matchId, "aea-owner"), undefined);
  database.close();
});

function leadRoute(db, uid = "aea-owner") {
  return loadTypescript("src/app/api/trade-opportunities/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { parseJsonList: (value) => JSON.parse(value || "[]") },
    "@/lib/opportunity-server": { expireStaleOpportunities: async () => {} },
    "@/lib/direct-trade-entitlements-server": { accountHasFeature: async () => true },
    "@/lib/trade-access-server": { ...modules.get("trade-access-server"),
      requireVerifiedTradeAccess: async () => ({ identity: { uid } }) },
    "@/lib/customer-projects.mjs": customerProjects,
    "@/lib/customer-matching-locality.mjs": locality,
    "@/lib/public-trade-lead-access.mjs": { publicTradeContactForMatchedLead },
    "@/lib/public-lead-quote-workflow-server": server,
    "@/lib/customer-plan-document.mjs": {},
    "@/lib/customer-project-arrivals.mjs": {},
    "@/lib/admin-notifications": {},
    "@/lib/admin-notification-delivery": {},
    "@/lib/customer-project-activity-notification-server": {},
    "@/lib/customer-project-activity-notifications": {},
    "@/lib/trade-opportunity-read-projection.mjs": readProjection,
  });
}

test("GET returns the saved AEA quick enquiry contact and denies an external legacy assignment", async () => {
  const { database, db } = fixture(quickContact);
  const response = await leadRoute(db).GET(new Request("https://test/api/trade-opportunities"));
  assert.equal(response.status, 200);
  const opportunities = (await response.json()).opportunities;
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].customerContact.name, "Alex Customer");
  assert.equal(opportunities[0].customerContact.email, "alex@example.test");
  assert.equal(opportunities[0].customerContact.phone, "0412345678");
  assert.equal(opportunities[0].customerContact.releaseScope, "aea_only");
  assert.deepEqual(opportunities[0].customerContact.redactedFields, []);
  database.exec("UPDATE trade_opportunity_matches SET firebase_uid='external-owner'");
  const denied = await leadRoute(db, "external-owner").GET(new Request("https://test/api/trade-opportunities"));
  assert.equal(denied.status, 200);
  assert.deepEqual((await denied.json()).opportunities, []);
  database.close();
});

test("GET binds extension queries to authorized IDs and rechecks AEA authority in the same read batch", async () => {
  const { database } = fixture(quickContact);
  let batchCount = 0;
  const db = d1(database, { beforeReadBatch: (statements) => {
    batchCount += 1;
    const extensions = statements.filter((statement) => statement.sql.includes("FROM authoritative_matches authorized_match"));
    assert.equal(extensions.length, 7);
    for (const statement of extensions) assert.deepEqual(statement.values, ["aea-owner", JSON.stringify([matchId])]);
    if (batchCount === 2) database.exec("UPDATE admin_users SET status='suspended'");
  } });
  const route = leadRoute(db);
  const first = await route.GET(new Request("https://test/api/trade-opportunities"));
  assert.equal(first.status, 200);
  const visible = (await first.json()).opportunities;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].customerContact.email, "alex@example.test");
  assert.equal(visible[0].customerContact.phone, "0412345678");
  const revoked = await route.GET(new Request("https://test/api/trade-opportunities"));
  assert.equal(batchCount, 2, "revocation must occur after initial authorization and before the read batch");
  assert.equal(revoked.status, 200);
  assert.deepEqual((await revoked.json()).opportunities, []);
  database.close();
});

test("GET does not serialize contacts withdrawn between initial authorization and the read batch", async () => {
  const { database } = fixture(quickContact);
  let withdrew = false;
  const db = d1(database, { beforeReadBatch: () => {
    database.prepare("UPDATE public_trade_lead_contact_releases SET withdrawn_at=?").run(now);
    withdrew = true;
  } });
  const response = await leadRoute(db).GET(new Request("https://test/api/trade-opportunities"));
  assert.equal(withdrew, true);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).opportunities, []);
  database.close();
});
