import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0019_melodic_unus.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const hub = read("../src/components/TradeBusinessHub.tsx");
const customerAssets = read("../src/components/CustomerAssetOwnershipCentre.tsx");
const customerLifecycle = read("../src/components/CustomerAssetLifecycle.tsx");
const numberer = read("../src/lib/trade-job-number-server.ts");

test("installer CRM customers, job details, appointments and notes are durable and indexed", () => {
  assert.match(schema, /sqliteTable\("trade_crm_customers"/);
  assert.match(schema, /sqliteTable\("trade_crm_job_details"/);
  assert.match(schema, /sqliteTable\("trade_crm_appointments"/);
  assert.match(schema, /sqliteTable\("trade_crm_job_notes"/);
  assert.match(schema, /trade_crm_customers_owner_status_idx/);
  assert.match(schema, /trade_crm_job_details_owner_pipeline_idx/);
  assert.match(schema, /trade_crm_appointments_owner_start_idx/);
  assert.match(schema, /trade_crm_job_notes_work_order_idx/);
});

test("the CRM migration applies cleanly to SQLite", () => {
  const db = new DatabaseSync(":memory:");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_appointments", "trade_crm_customers", "trade_crm_job_details", "trade_crm_job_notes"]);
});

test("CRM access is same-origin, installer-only, active, paywalled and owner scoped", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /account\.partner_type !== "installer"/);
  assert.match(route, /account\.account_status !== "active"/);
  assert.match(route, /entitlements\.features\.business_operations/);
  assert.match(route, /WHERE firebase_uid = \?/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /TEAM_ACCESS_REQUIRED/);
  assert.match(route, /MEMBER_ACTIVE_JOB_LIMIT = 500/);
  assert.match(route, /CRM_CUSTOMER_LIMIT = 5000/);
});

test("platform households stay separate from installer-owned contacts", () => {
  assert.match(route, /sourceType === "opportunity" \? "platform_private"/);
  assert.match(route, /customerSource === "platform_private" \? ""/);
  assert.match(route, /platformPrivate \? ""/);
  assert.match(crm, /AEA manages the household relationship/);
  assert.match(crm, /project scope, broad service region and protected reference/);
  assert.match(crm, /Only add contacts who came directly to your business/);
  assert.match(crm, /AEA protected households never appear here/);
});

test("direct customers have full addresses while job IDs are chronological and read only", () => {
  assert.match(crm, /name="addressLine1"/);
  assert.match(crm, /name="addressLine2"/);
  assert.match(crm, /Assigned automatically/);
  assert.match(crm, /cannot be edited/);
  assert.doesNotMatch(crm, /name="customerReference"/);
  assert.match(route, /nextTradeWorkNumber/);
  assert.match(numberer, /ON CONFLICT\(firebase_uid, counter_key\) DO UPDATE/);
  assert.match(numberer, /last_value = last_value \+ 1/);
  assert.match(numberer, /padStart\(6, "0"\)/);
});

test("paid installers receive a complete progressive CRM while free accounts keep the foundation", () => {
  assert.match(hub, /props\.partnerType === "installer" && props\.fullAccess/);
  assert.match(hub, /BusinessHubFoundation/);
  for (const label of ["My day", "Jobs", "Schedule", "Customers", "Reports", "Field work", "Money", "Notes", "Handover"]) {
    assert.match(crm, new RegExp(label));
  }
  assert.match(crm, /NewJobForm/);
  assert.match(crm, /CustomerForm/);
  assert.match(crm, /TradeHandoverCentre/);
  assert.match(crm, /outstandingCents/);
});

test("large installer job and customer directories use server paging, sorting and lazy detail", () => {
  assert.match(route, /mode === "index"/);
  assert.match(route, /mode === "detail"/);
  assert.match(route, /PAGE_SIZES = new Set\(\[25, 50, 100\]\)/);
  assert.match(route, /LIMIT \? OFFSET \?/);
  assert.match(route, /SELECT COUNT\(\*\) total/);
  assert.match(route, /"number-asc"/);
  assert.match(route, /"name-desc"/);
  assert.match(crm, /mode: "index", resource: "jobs"/);
  assert.match(crm, /mode: "index", resource: "customers"/);
  assert.match(crm, /mode=detail&resource=job/);
  assert.match(crm, /mode=detail&resource=customer/);
  assert.match(crm, /Recently updated/);
  assert.match(crm, /Name A to Z/);
});

test("bulk CRM actions are bounded, owner scoped and protect active customer work", () => {
  assert.match(route, /function cleanIds/);
  assert.match(route, /slice\(0, 100\)/);
  assert.match(route, /action === "bulk_set_job_priority"/);
  assert.match(route, /action === "bulk_archive_customers"/);
  assert.match(route, /firebase_uid = \? AND partner_type = 'installer'/);
  assert.match(route, /Customers with active jobs cannot be archived/);
  assert.match(route, /jobSyncChangeStatements/);
  assert.match(crm, /ids: selectedJobIds/);
  assert.match(crm, /ids: selectedCustomerIds/);
  assert.match(crm, /Only customers with no active jobs can be archived/);
});

test("customer home records use plain language and progressive disclosure", () => {
  assert.match(customerAssets, /Free home records/);
  assert.match(customerAssets, /Your products, warranties and documents/);
  assert.match(customerAssets, /customer-asset-move-tools/);
  assert.match(customerAssets, /customer-pack-transfer/);
  assert.match(customerLifecycle, /customer-lifecycle-simple/);
  assert.match(customerLifecycle, /Care and warranty reminders/);
});

test("new CRM and customer copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${crm}\n${customerAssets}\n${customerLifecycle}`, /[\u2013\u2014]/);
});
