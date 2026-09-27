import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as routing from "../src/lib/aea-trade-routing.mjs";
import * as publicContact from "../src/lib/public-trade-lead-access.mjs";
import * as projectContact from "../src/lib/trade-opportunity-read-projection.mjs";
import { PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE } from "../src/lib/public-plan-enquiry.mjs";
import { CUSTOMER_CONTACT_RELEASE_FIELDS, CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION } from "../src/lib/customer-projects.mjs";
import { PUBLIC_SITE } from "../src/lib/public-site.ts";
import * as abn from "../src/lib/trade-abn.ts";

const cache = new Map();
function load(path, dependencies) {
  if (!cache.has(path)) cache.set(path, ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText);
  const record = { exports: {} };
  new Function("require", "module", "exports", cache.get(path))((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected recipient dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}
const aea = load("../src/lib/aea-trade-owner-server.ts", { "./aea-trade-routing.mjs": routing, "./public-site": { PUBLIC_SITE }, "./trade-abn": abn });
const certificate = load("../src/lib/trade-certificate-leads.ts", { "./aea-trade-owner-server": aea, "./aea-trade-routing.mjs": routing });
const owner = { ownerUid: "owner", actorUid: "owner", memberId: "", isOwner: true, canViewCustomers: true, canManageCustomers: true, canManageJobs: true, canSendQuotes: true, canManageInvoices: true, canSearchCustomers: true, jobScope: "team" };
const assignedMember = { ...owner, actorUid: "staff", memberId: "member", isOwner: false, canSearchCustomers: false, jobScope: "assigned" };
const now = new Date().toISOString();
const tomorrow = new Date(Date.now() + 86400000).toISOString();

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const tables = {
    trade_crm_customers: "id firebase_uid email record_status",
    trade_crm_job_details: "work_order_id firebase_uid crm_customer_id customer_source",
    trade_work_orders: "id firebase_uid partner_type record_status source_type assignee_member_id",
    trade_opportunity_matches: "id firebase_uid opportunity_id status matched_categories",
    trade_opportunities: "id source_reference postcode state service_categories status expires_at created_at",
    customer_projects: "id opportunity_id firebase_uid postcode address_state",
    customer_consent_receipts: "project_id firebase_uid purpose withdrawn_at",
    customer_project_quotes: "id opportunity_match_id project_id opportunity_id installer_uid updated_at",
    customer_project_contact_releases: "id opportunity_match_id project_id opportunity_id quote_id customer_uid installer_uid status notice_version disclosed_fields customer_name customer_email customer_phone address_line_1 address_line_2 suburb address_state postcode granted_at withdrawn_at updated_at",
    public_trade_lead_contact_releases: "id opportunity_id source_reference status withdrawn_at disclosed_fields customer_first_name customer_last_name customer_email customer_phone customer_unit_number customer_street_address customer_suburb customer_address_state postcode customer_message notice_version consent_purpose granted_at updated_at",
    trade_accounts: "firebase_uid abn verified_abn business_name partner_type account_status verification_status verification_review_id verification_reviewed_by_uid verification_reviewed_at capabilities",
    admin_users: "firebase_uid status role",
    trade_account_verification_reviews: "id firebase_uid abn business_name partner_type decision review_method reviewed_by_uid reviewed_at",
    creditex_current_business_jurisdictions: "owner_uid state",
  };
  for (const [table, columns] of Object.entries(tables)) sqlite.exec(`CREATE TABLE ${table} (${columns.split(" ").map((column) => `${column} TEXT NOT NULL DEFAULT ''`).join(",")})`);
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  insert("trade_accounts", { firebase_uid: "owner", capabilities: '["solar"]' });
  insert("creditex_current_business_jurisdictions", { owner_uid: "owner", state: "VIC" });
  const statement = (sql, bindings = []) => ({ bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null });
  const db = { prepare: statement };
  const recipient = load("../src/lib/trade-email-recipient-server.ts", {
    "../../db": { getD1: () => db }, "./aea-trade-owner-server": aea, "./trade-certificate-leads": certificate,
    "./public-trade-lead-access.mjs": publicContact, "./trade-opportunity-read-projection.mjs": projectContact,
  });
  const publicRelease = (changes = {}) => insert("public_trade_lead_contact_releases", {
    id: "release", opportunity_id: "opportunity", source_reference: "public:source", status: "active",
    disclosed_fields: JSON.stringify(["customer_email", "postcode", "service_categories"]), customer_email: "lead@example.test",
    customer_first_name: "Jane", customer_last_name: "Citizen", customer_phone: "0412000000", postcode: "3000",
    notice_version: PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: PUBLIC_PLAN_CONSENT_PURPOSE, granted_at: now, updated_at: now, ...changes,
  });
  const lead = (source = "public:source", categories = '["solar"]') => {
    insert("trade_opportunities", { id: "opportunity", source_reference: source, postcode: "3000", state: "VIC", service_categories: categories, status: "open", expires_at: tomorrow, created_at: now });
    insert("trade_opportunity_matches", { id: "match", firebase_uid: "owner", opportunity_id: "opportunity", status: "offered", matched_categories: categories });
  };
  const customer = (changes = {}) => insert("trade_crm_customers", { id: "customer", firebase_uid: "owner", email: "customer@example.test", record_status: "active", ...changes });
  const job = (changes = {}, details = {}) => {
    insert("trade_work_orders", { id: "job", firebase_uid: "owner", partner_type: "installer", record_status: "active", source_type: "manual", assignee_member_id: "member", ...changes });
    insert("trade_crm_job_details", { work_order_id: changes.id || "job", firebase_uid: changes.firebase_uid || "owner", crm_customer_id: "customer", customer_source: "trade_crm", ...details });
  };
  const project = () => {
    lead("customer-project:project");
    insert("customer_projects", { id: "project", opportunity_id: "opportunity", firebase_uid: "customer-uid", postcode: "3000", address_state: "VIC" });
    insert("customer_consent_receipts", { project_id: "project", firebase_uid: "customer-uid", purpose: "anonymized_installer_matching" });
    insert("customer_project_quotes", { id: "quote", opportunity_match_id: "match", project_id: "project", opportunity_id: "opportunity", installer_uid: "owner", updated_at: now });
  };
  const projectRelease = (changes = {}) => insert("customer_project_contact_releases", {
    id: "project-release", opportunity_match_id: "match", project_id: "project", opportunity_id: "opportunity", quote_id: "quote",
    customer_uid: "customer-uid", installer_uid: "owner", status: "active", notice_version: CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
    disclosed_fields: JSON.stringify(CUSTOMER_CONTACT_RELEASE_FIELDS), customer_name: "Jane Citizen", customer_email: "project@example.test", customer_phone: "0412000000",
    address_line_1: "1 Example Street", suburb: "Melbourne", address_state: "VIC", postcode: "3000", granted_at: now, updated_at: now, ...changes,
  });
  return { sqlite, insert, recipient, db, publicRelease, lead, customer, job, project, projectRelease, close: () => sqlite.close() };
}

test("Target selection rejects missing, multiple, malformed and raw recipient-only targets", () => {
  const f = fixture();
  try {
    for (const input of [{}, { recipient: "attacker@example.test" }, { customerId: "c", enquiryId: "e" }, { customerId: null }, { customerId: "../other" }, { customerId: ["c"] }, { customerId: "c".repeat(181) }]) assert.throws(() => f.recipient.tradeEmailTarget(input), /EMAIL_INPUT_INVALID/);
    assert.deepEqual(f.recipient.tradeEmailTarget({ customerId: "c-123", enquiryId: "" }), { customerId: "c-123" });
  } finally { f.close(); }
});

test("Saved customer and job addresses remain owner scoped and active", async () => {
  const f = fixture();
  try {
    f.customer(); f.job();
    const resolve = (target, access = owner) => f.recipient.resolveTradeEmailRecipient(access, target, f.db);
    assert.equal(await resolve({ customerId: "customer" }), "customer@example.test");
    assert.equal(await resolve({ workOrderId: "job" }), "customer@example.test");
    await assert.rejects(resolve({ customerId: "customer" }, { ...owner, ownerUid: "other" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    await assert.rejects(resolve({ workOrderId: "job" }, { ...owner, ownerUid: "other" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    f.sqlite.exec("UPDATE trade_crm_customers SET record_status = 'archived'");
    await assert.rejects(resolve({ customerId: "customer" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    await assert.rejects(resolve({ workOrderId: "job" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
  } finally { f.close(); }
});

test("Assigned staff cannot send to unassigned customers, protected opportunity jobs or platform-private contacts", async () => {
  const f = fixture();
  try {
    f.customer(); f.job();
    const resolve = (target, access = assignedMember) => f.recipient.resolveTradeEmailRecipient(access, target, f.db);
    assert.equal(await resolve({ customerId: "customer" }), "customer@example.test");
    assert.equal(await resolve({ workOrderId: "job" }), "customer@example.test");
    await assert.rejects(resolve({ customerId: "customer" }, { ...assignedMember, memberId: "different" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    await assert.rejects(resolve({ workOrderId: "job" }, { ...assignedMember, memberId: "different" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    for (const update of ["UPDATE trade_work_orders SET source_type = 'opportunity'", "UPDATE trade_work_orders SET source_type = 'manual'; UPDATE trade_crm_job_details SET customer_source = 'platform_private'"]) {
      f.sqlite.exec(update);
      await assert.rejects(resolve({ workOrderId: "job" }, owner), /EMAIL_RECIPIENT_UNAVAILABLE/);
      await assert.rejects(resolve({ customerId: "customer" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    }
    await assert.rejects(resolve({ customerId: "customer" }, { ...owner, canViewCustomers: false }), /EMAIL_ACCESS_REQUIRED/);
    await assert.rejects(resolve({ customerId: "customer" }, { ...assignedMember, canManageCustomers: false, canManageJobs: false, canSendQuotes: false, canManageInvoices: false }), /EMAIL_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test("Public lead email requires current match, scope, jurisdiction and explicit disclosure", async () => {
  const f = fixture();
  try {
    f.lead(); f.publicRelease();
    const resolve = (access = owner) => f.recipient.resolveTradeEmailRecipient(access, { enquiryId: "match" }, f.db);
    assert.equal(await resolve(), "lead@example.test");
    await assert.rejects(resolve(assignedMember), /EMAIL_ACCESS_REQUIRED/);
    await assert.rejects(resolve({ ...owner, ownerUid: "other" }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    f.sqlite.exec("DELETE FROM creditex_current_business_jurisdictions");
    await assert.rejects(resolve(), /EMAIL_RECIPIENT_UNAVAILABLE/);
    f.insert("creditex_current_business_jurisdictions", { owner_uid: "owner", state: "VIC" });
    f.sqlite.exec("UPDATE public_trade_lead_contact_releases SET disclosed_fields = '[\"postcode\",\"service_categories\"]'");
    await assert.rejects(resolve(), /EMAIL_RECIPIENT_UNAVAILABLE/);
  } finally { f.close(); }
});

test("A newer withdrawn public release prevents fallback to an older active release", async () => {
  const f = fixture();
  try {
    f.lead(); f.publicRelease();
    f.publicRelease({ id: "withdrawn-release", status: "withdrawn", withdrawn_at: tomorrow, updated_at: tomorrow, granted_at: tomorrow });
    await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
  } finally { f.close(); }
});

test("Expired and closed opportunities and inactive matches cannot receive email", async () => {
  const changes = ["UPDATE trade_opportunities SET expires_at = '2000-01-01'", "UPDATE trade_opportunities SET expires_at = '', created_at = '2000-01-01'", "UPDATE trade_opportunities SET status = 'closed'", "UPDATE trade_opportunity_matches SET status = 'declined'"];
  for (const sql of changes) {
    const f = fixture();
    try {
      f.lead(); f.publicRelease(); f.sqlite.exec(sql);
      await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
    } finally { f.close(); }
  }
});

test("Mixed AEA scope cannot escape to another trade, including a lookalike name", async () => {
  const f = fixture();
  try {
    f.lead("public:source", '["solar","assessment"]'); f.publicRelease();
    f.sqlite.exec("UPDATE trade_accounts SET business_name = 'Australian Energy Assessments', capabilities = '[\"solar\",\"assessment\"]'");
    await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
    const aeaAbn = PUBLIC_SITE.abn.replace(/\D/g, "");
    f.sqlite.prepare("UPDATE trade_accounts SET abn = ?, verified_abn = ?, partner_type = 'installer', account_status = 'active', verification_status = 'approved', verification_review_id = 'review', verification_reviewed_by_uid = 'reviewer', verification_reviewed_at = ?").run(aeaAbn, aeaAbn, now);
    f.insert("admin_users", { firebase_uid: "owner", status: "active", role: "owner" });
    f.insert("trade_account_verification_reviews", { id: "review", firebase_uid: "owner", abn: aeaAbn, business_name: "Australian Energy Assessments", partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "reviewer", reviewed_at: now });
    assert.equal(await f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), "lead@example.test");
    f.sqlite.exec("UPDATE admin_users SET status = 'inactive'");
    await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
  } finally { f.close(); }
});

test("Private project email requires matching quote, release, customer and location", async () => {
  for (const mutation of [null, "UPDATE customer_project_contact_releases SET quote_id = 'other'", "UPDATE customer_project_contact_releases SET customer_uid = 'other'", "UPDATE customer_project_contact_releases SET postcode = '2000'", "UPDATE customer_project_contact_releases SET disclosed_fields = '[\"email\"]'", "UPDATE customer_consent_receipts SET withdrawn_at = '2026-01-01'"]) {
    const f = fixture();
    try {
      f.project(); f.projectRelease();
      if (mutation) {
        f.sqlite.exec(mutation);
        await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
      } else assert.equal(await f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), "project@example.test");
    } finally { f.close(); }
  }
});

test("A newer withdrawn private project release cannot fall back to old permission", async () => {
  const f = fixture();
  try {
    f.project(); f.projectRelease();
    f.projectRelease({ id: "withdrawn", status: "withdrawn", withdrawn_at: tomorrow, updated_at: tomorrow });
    await assert.rejects(f.recipient.resolveTradeEmailRecipient(owner, { enquiryId: "match" }, f.db), /EMAIL_RECIPIENT_UNAVAILABLE/);
  } finally { f.close(); }
});
