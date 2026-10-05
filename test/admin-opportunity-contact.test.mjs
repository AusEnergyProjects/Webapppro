import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { isAdminSubmittedEnquiryResult } from "../src/lib/admin-submitted-enquiry.ts";
import { publicPlanContactReleaseAccessSql } from "../src/lib/public-plan-enquiry.mjs";
import { AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION, AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE } from "../src/lib/quick-upgrade-enquiry.mjs";

const route = readFileSync(new URL("../src/app/api/admin/opportunities/route.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/AdminOpportunityWorkspace.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/components/AdminSubmittedEnquiryDetails.tsx", import.meta.url), "utf8");
const query = route.match(/const contact = await db\.prepare\(`([\s\S]*?)`\)/)[1]
  .replace('${publicPlanContactReleaseAccessSql("contact")}', publicPlanContactReleaseAccessSql("contact"));

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunities (id TEXT, source_reference TEXT, postcode TEXT, title TEXT, service_categories TEXT, created_at TEXT, status TEXT);
    INSERT INTO trade_opportunities VALUES ('opportunity-1', 'source-1', '3000', 'Hot water request', '["hot-water"]', '2026-09-04T00:00:00Z', 'open');
    CREATE TABLE public_trade_lead_contact_releases (
      id TEXT, opportunity_id TEXT, source_reference TEXT, postcode TEXT, status TEXT,
      withdrawn_at TEXT, granted_at TEXT, updated_at TEXT, notice_version TEXT,
      consent_purpose TEXT, disclosed_fields TEXT, customer_first_name TEXT,
      customer_last_name TEXT, customer_email TEXT, customer_phone TEXT,
      customer_unit_number TEXT, customer_street_address TEXT, customer_suburb TEXT,
      customer_address_state TEXT, customer_message TEXT
    );`);
  const contact = {
    id: "contact-1", opportunity_id: "opportunity-1", source_reference: "source-1", postcode: "3000",
    status: "active", withdrawn_at: "", granted_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
    notice_version: AEA_SERVICE_QUICK_UPGRADE_CONSENT_NOTICE_VERSION, consent_purpose: AEA_SERVICE_QUICK_UPGRADE_CONSENT_PURPOSE,
    disclosed_fields: JSON.stringify(["postcode", "service_categories", "customer_address"]),
    customer_first_name: "Jamie", customer_last_name: "Customer", customer_email: "jamie@example.test",
    customer_phone: "0400000000", customer_unit_number: "4", customer_street_address: "15 Example Street",
    customer_suburb: "MELBOURNE", customer_address_state: "VIC", customer_message: "Please call after 4pm.\nHot water replacement needed.",
  };
  const insert = (overrides = {}) => {
    const row = { ...contact, ...overrides };
    db.prepare(`INSERT INTO public_trade_lead_contact_releases (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  };
  insert();
  return { db, insert, read: (id = "opportunity-1") => db.prepare(query).get(id) };
}

test("retained contact is available for the exact enquiry with trade sharing off", () => {
  const { db, read } = fixture();
  const row = read();
  assert.equal(row.customer_first_name, "Jamie");
  assert.equal(row.customer_last_name, "Customer");
  assert.equal(row.customer_email, "jamie@example.test");
  assert.equal(row.customer_phone, "0400000000");
  assert.equal(row.customer_message, "Please call after 4pm.\nHot water replacement needed.");
  assert.equal(row.opportunity_id, "opportunity-1");
  assert.equal(row.service_categories, '["hot-water"]');
  assert.equal(read("other-opportunity"), undefined);
  db.close();
});

test("retained contact fails closed for source, locality, consent and withdrawal mismatches", () => {
  for (const [column, value] of [
    ["source_reference", "wrong-source"], ["postcode", "2000"], ["status", "withdrawn"],
    ["withdrawn_at", "2026-09-04T01:00:00Z"], ["granted_at", "invalid"],
    ["notice_version", "unknown"], ["consent_purpose", "other purpose"],
    ["disclosed_fields", '["customer_email"]'], ["disclosed_fields", "not-json"],
  ]) {
    const { db, read } = fixture();
    db.prepare(`UPDATE public_trade_lead_contact_releases SET ${column} = ?`).run(value);
    assert.equal(read(), undefined, column);
    db.close();
  }
});

test("an older active release cannot override the latest withdrawn release", () => {
  const { db, insert, read } = fixture();
  insert({ id: "contact-2", status: "withdrawn", withdrawn_at: "2026-09-04T01:00:00Z", updated_at: "2026-09-04T01:00:00Z" });
  assert.equal(read(), undefined);
  db.close();
});

test("private contact requires operations roles and a successful audit before response", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /contactId\s*\? await requireAdminIdentity\(request, \["owner", "admin", "support"\]\)/);
  const branch = route.slice(route.indexOf("if (contactId)"), route.indexOf("await expireStaleOpportunities()"));
  assert.ok(branch.indexOf('await writeAdminAudit(admin, "opportunity.contact_view"') < branch.indexOf("return adminJson({ ok: true, retainedContact:"));
  assert.match(branch, /\{ role: admin\.role, releaseId: contact\.id, noticeVersion: contact\.notice_version \}/);
  const listShape = route.slice(route.indexOf("function shape("), route.indexOf("export async function GET"));
  const csv = workspace.slice(workspace.indexOf("function exportOpportunities()"), workspace.indexOf("return <div className={styles.workspace}>"));
  assert.doesNotMatch(listShape + csv, /retainedContact|customer_email|customer_phone|customer_first_name|streetAddress/);
  assert.match(workspace, /Show customer details/);
  assert.match(workspace, /\["owner", "admin", "support"\]\.includes\(role\)/);
  assert.match(detail, /if \(!active\) return/);
  assert.match(detail, /active = false; controller.abort\(\)/);
  assert.doesNotMatch(workspace + detail, /localStorage|sessionStorage/);
});

function routeHarness({ role = "owner", originAllowed = true, auditFails = false } = {}) {
  const fixtureDb = fixture();
  const events = [];
  const exports = {};
  const compiled = ts.transpileModule(route, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const admin = {
    sameOrigin: () => originAllowed,
    cleanAdminText: (value) => String(value || "").trim(),
    parseJsonList: (value) => JSON.parse(value),
    requireAdminIdentity: async (_request, roles) => { events.push(["auth", roles]); if (!roles.includes(role)) throw new Error("forbidden"); return { role }; },
    writeAdminAudit: async (...args) => { events.push(["audit", ...args]); if (auditFails) throw new Error("audit failed"); },
    adminJson: (body, status = 200) => ({ body, status }),
    adminError: () => ({ body: { ok: false, error: "Secure access failed." }, status: 403 }),
  };
  const require = (id) => id.endsWith("/db") ? { getD1: () => ({ prepare: (sql) => ({ bind: (...args) => ({ first: async () => fixtureDb.db.prepare(sql).get(...args) }) }) }) }
    : id.includes("admin-server") ? admin
    : id.includes("public-plan-enquiry") ? { publicPlanContactReleaseAccessSql }
    : id.includes("australian-postcodes") ? { AUSTRALIAN_STATE_CODES: ["VIC"] }
    : id.includes("energy-service-catalogue") ? { ENERGY_SERVICE_IDS: ["hot-water"] } : {};
  Function("require", "exports", compiled)(require, exports);
  return { ...fixtureDb, events, get: (query = "contact=opportunity-1") => exports.GET(new Request(`https://example.test/api/admin/opportunities?${query}`)) };
}

test("on-demand response returns the full retained submission only after audit, independently of list filters", async () => {
  const h = routeHarness();
  const response = await h.get("contact=opportunity-1&page=400&search=unrelated&status=closed");
  assert.equal(response.status, 200);
  assert.equal(isAdminSubmittedEnquiryResult(response.body, "opportunity-1"), true);
  assert.equal(response.body.submittedEnquiry.customerMessage, "Please call after 4pm.\nHot water replacement needed.");
  assert.deepEqual(response.body.submittedEnquiry.serviceCategories, ["hot-water"]);
  assert.deepEqual(response.body.submittedEnquiry.consent.disclosedFields, ["postcode", "service_categories", "customer_address"]);
  assert.deepEqual(h.events.map((event) => event[0]), ["auth", "audit"]);
  assert.doesNotMatch(JSON.stringify(h.events), /Jamie|jamie@example|040000|Please call|Example Street/);
  h.db.close();
});

test("contact endpoint denies reviewer, origin and audit failures without returning private fields", async () => {
  for (const config of [{ role: "reviewer" }, { originAllowed: false }, { auditFails: true }]) {
    const h = routeHarness(config);
    const response = await h.get();
    assert.equal(response.status, 403);
    assert.equal(response.body.retainedContact, undefined);
    assert.equal(response.body.submittedEnquiry, undefined);
    h.db.close();
  }
  for (const role of ["owner", "admin", "support"]) {
    const h = routeHarness({ role });
    assert.equal((await h.get()).status, 200);
    h.db.close();
  }
});

test("missing or withdrawn exact records return a truthful unavailable response without audit or customer details", async () => {
  for (const withdrawn of [false, true]) {
    const h = routeHarness();
    if (withdrawn) h.db.exec("UPDATE public_trade_lead_contact_releases SET status='withdrawn'");
    const response = await h.get(withdrawn ? "contact=opportunity-1" : "contact=missing");
    assert.equal(response.status, 404);
    assert.match(response.body.error, /No active retained contact record/);
    assert.equal(response.body.retainedContact, undefined);
    assert.equal(h.events.some((event) => event[0] === "audit"), false);
    h.db.close();
  }
});
