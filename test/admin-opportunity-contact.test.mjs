import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { publicPlanContactReleaseAccessSql } from "../src/lib/public-plan-enquiry.mjs";
import { QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE } from "../src/lib/quick-upgrade-enquiry.mjs";

const route = readFileSync(new URL("../src/app/api/admin/opportunities/route.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/AdminOpportunityWorkspace.tsx", import.meta.url), "utf8");
const query = route.match(/const contact = await db\.prepare\(`([\s\S]*?)`\)/)[1]
  .replace('${publicPlanContactReleaseAccessSql("contact")}', publicPlanContactReleaseAccessSql("contact"));

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunities (id TEXT, source_reference TEXT, postcode TEXT);
    INSERT INTO trade_opportunities VALUES ('opportunity-1', 'source-1', '3000');
    CREATE TABLE public_trade_lead_contact_releases (
      id TEXT, opportunity_id TEXT, source_reference TEXT, postcode TEXT, status TEXT,
      withdrawn_at TEXT, granted_at TEXT, updated_at TEXT, notice_version TEXT,
      consent_purpose TEXT, disclosed_fields TEXT, customer_first_name TEXT,
      customer_last_name TEXT, customer_email TEXT, customer_phone TEXT,
      customer_unit_number TEXT, customer_street_address TEXT, customer_suburb TEXT,
      customer_address_state TEXT
    );`);
  const contact = {
    id: "contact-1", opportunity_id: "opportunity-1", source_reference: "source-1", postcode: "3000",
    status: "active", withdrawn_at: "", granted_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
    notice_version: QUICK_UPGRADE_CONSENT_NOTICE_VERSION, consent_purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
    disclosed_fields: JSON.stringify(["postcode", "service_categories", "customer_address"]),
    customer_first_name: "Jamie", customer_last_name: "Customer", customer_email: "jamie@example.test",
    customer_phone: "0400000000", customer_unit_number: "4", customer_street_address: "15 Example Street",
    customer_suburb: "MELBOURNE", customer_address_state: "VIC",
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
  assert.match(workspace, /Show retained contact/);
  assert.match(workspace, /\["owner", "admin", "support"\]\.includes\(role\)/);
  assert.match(workspace, /requestNumber !== retainedContactRequest\.current/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});
