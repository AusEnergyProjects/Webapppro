import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const handoverMigration = read("../drizzle/0016_fair_ultragirl.sql");
const assetMigration = read("../drizzle/0049_customer_asset_timeline.sql");
const route = read("../src/app/api/trade-assets/route.ts");
const handoverRoute = read("../src/app/api/trade-handover/route.ts");
const workspace = read("../src/components/TradeAssetWorkspace.tsx");
const crmWorkspace = read("../src/components/InstallerCrmWorkspace.tsx");
const styles = read("../src/app/globals.css");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("the existing installed asset source of truth gains customer, site and review links", () => {
  assert.equal((schema.match(/sqliteTable\("trade_installed_assets"/g) || []).length, 1);
  for (const field of ["crm_customer_id", "service_site_id", "source_type", "source_reference", "review_status", "asset_status", "asset_label", "commissioning_reference"]) {
    assert.match(schema, new RegExp(`text\\("${field}"\\)`));
  }
  assert.match(schema, /trade_installed_assets_customer_idx/);
  assert.match(schema, /trade_installed_assets_site_idx/);
  assert.match(schema, /trade_installed_assets_review_idx/);
});

test("the additive migration preserves handover provenance and requires installer review", () => {
  const db = new DatabaseSync(":memory:"); apply(db, handoverMigration);
  db.exec(`INSERT INTO trade_installed_assets
    (id, handover_pack_id, work_order_id, firebase_uid, asset_category, brand, model_number, record_status, created_at, updated_at)
    VALUES ('asset-1', 'pack-1', 'job-1', 'owner-1', 'battery', 'Example', 'B-10', 'active', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z')`);
  apply(db, assetMigration);
  const row = { ...db.prepare("SELECT source_type, source_reference, review_status, asset_status, crm_customer_id, service_site_id FROM trade_installed_assets WHERE id = 'asset-1'").get() };
  assert.deepEqual(row, { source_type: "handover", source_reference: "pack-1", review_status: "pending_review", asset_status: "active", crm_customer_id: "", service_site_id: "" });
});

test("asset APIs are owner scoped and require explicit handover review", () => {
  for (const boundary of ["requireFirebaseIdentity", "sameOrigin", "partner_type !== \"installer\"", "business_operations", "firebase_uid = ?"]) assert.match(route, new RegExp(boundary));
  assert.match(route, /action === "review_handover_asset"/);
  assert.match(route, /review_status = 'pending_review'/);
  assert.match(route, /review_status = 'confirmed'/);
  assert.match(route, /source_reference = \?/);
  assert.match(route, /action !== "create_asset"/);
  assert.match(route, /await ownedCustomer\(uid, customerId\); await ownedSite\(uid, customerId, siteId\)/);
  assert.match(handoverRoute, /directCustomerId && directSiteId \? "confirmed" : "pending_review"/);
});

test("the timeline unifies all required direct-customer sources deterministically", () => {
  for (const source of ["'enquiry' source_type", "'job' source_type", "'appointment' source_type", "'note' source_type", "'handover' source_type", "'asset' source_type", "'service' source_type"]) assert.match(route, new RegExp(source));
  for (const table of ["trade_crm_enquiry_events", "trade_work_order_events", "trade_crm_appointments", "trade_crm_job_notes", "trade_handover_packs", "trade_installed_assets", "trade_asset_service_events"]) assert.match(route, new RegExp(table));
  assert.match(route, /ORDER BY occurred_at DESC, source_type ASC, id DESC/);
  assert.match(route, /d\.crm_customer_id = \?/);
  assert.doesNotMatch(route, /trade_opportunities|customer_name_revealed|customer_address_revealed/);
});

test("asset list, review and timeline SQL compile against the production migration chain", () => {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0004_mixed_chat.sql", "0015_aromatic_black_knight.sql", "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0019_melodic_unus.sql", "0047_customer_service_site_foundation.sql", "0048_unified_enquiry_inbox.sql", "0049_customer_asset_timeline.sql"]) apply(db, fs.readFileSync(new URL(file, migrationDirectory), "utf8"));
  for (const functionName of ["assetRows", "pendingHandoverRows", "timelineRows"]) {
    const match = route.match(new RegExp(`async function ${functionName}[\\s\\S]*?prepare\\(\\\`([\\s\\S]*?)\\\`\\)\\s*\\.bind`));
    assert.ok(match, `${functionName} SQL should be discoverable`);
    assert.doesNotThrow(() => db.prepare(match[1]), `${functionName} SQL should compile`);
  }
});

test("the CRM exposes asset search, warranty filters, review and customer timeline", () => {
  for (const label of ["Installed asset register", "Search installed assets", "All warranties", "Ends within 90 days", "Installer review required", "Confirm link", "Customer and site timeline", "Add installed asset"]) assert.match(workspace, new RegExp(label));
  assert.match(crmWorkspace, /"assets"/);
  assert.match(crmWorkspace, /<TradeAssetWorkspace user=\{user\} customerId=\{customer\.id\}/);
  assert.match(styles, /\.asset-list \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.asset-list \{ grid-template-columns: 1fr; \}/);
});

test("asset register copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${handoverRoute}\n${workspace}`, /[\u2013\u2014]/);
});
