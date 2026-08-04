import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  compareTradeAssetTimelineRows,
  mergeTradeAssetTimeline,
} from "../src/lib/trade-asset-timeline.mjs";

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
  for (const boundary of ["requireVerifiedTradeAccess", "sameOrigin", "partnerTypes: \\[\"installer\"\\]", "business_operations", "firebase_uid = ?"]) {
    assert.match(route, new RegExp(boundary));
  }
  assert.match(route, /accountEntitlements\(access\.identity\.uid, "installer"\)/);
  assert.match(route, /action === "review_handover_asset"/);
  assert.match(route, /review_status = 'pending_review'/);
  assert.match(route, /review_status = 'confirmed'/);
  assert.match(route, /source_reference = \?/);
  assert.match(route, /action !== "create_asset"/);
  assert.match(route, /await ownedCustomer\(uid, customerId\); await ownedSite\(uid, customerId, siteId\)/);
  assert.match(handoverRoute, /directCustomerId && directSiteId \? "confirmed" : "pending_review"/);
});

test("the asset register writes the four first-class home-fabric categories", () => {
  const allowed = route.match(/const ASSET_CATEGORIES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  const selectable = workspace.match(/const CATEGORIES = \[([\s\S]*?)\];/)?.[1] || "";
  for (const category of ["draught-proofing", "insulation", "glazing", "window-coverings"]) {
    assert.match(allowed, new RegExp(`"${category}"`));
    assert.match(selectable, new RegExp(`"${category}"`));
  }
  assert.doesNotMatch(allowed, /insulation-draughts/);
  assert.doesNotMatch(selectable, /insulation-draughts/);
});

test("the timeline unifies all required direct-customer sources deterministically", () => {
  for (const source of ["'enquiry' source_type", "'job' source_type", "'appointment' source_type", "'note' source_type", "'handover' source_type", "'asset' source_type", "'service' source_type"]) assert.match(route, new RegExp(source));
  for (const table of ["trade_crm_enquiry_events", "trade_work_order_events", "trade_crm_appointments", "trade_crm_job_notes", "trade_handover_packs", "trade_installed_assets", "trade_asset_service_events"]) assert.match(route, new RegExp(table));
  assert.equal((route.match(/LIMIT 500`\)\.bind\(uid, customerId, siteId, siteId\)/g) || []).length, 7);
  assert.match(route, /db\.batch<Record<string, unknown>>\(statements\)/);
  assert.match(route, /mergeTradeAssetTimeline\(results\)/);
  assert.match(route, /d\.crm_customer_id = \?/);
  assert.doesNotMatch(route, /UNION ALL/);
  assert.doesNotMatch(route, /trade_opportunities|customer_name_revealed|customer_address_revealed/);
});

test("split timeline results retain the prior global order and 500-row bound", () => {
  const at = "2026-08-04T10:00:00.000Z";
  const tied = [
    { id: "a", source_type: "job", event_type: "updated", title: "Job A", occurred_at: at },
    { id: "b", source_type: "job", event_type: "updated", title: "Job B", occurred_at: at },
    { id: "z", source_type: "asset", event_type: "registered", title: "Asset", occurred_at: at },
  ];
  const ordered = tied.map((row) => ({
    id: String(row.id), sourceType: String(row.source_type), eventType: String(row.event_type), title: String(row.title),
    summary: "", occurredAt: String(row.occurred_at), sourceReference: "", serviceSiteId: "", workOrderId: "",
  })).sort(compareTradeAssetTimelineRows);
  assert.deepEqual(ordered.map((row) => `${row.sourceType}:${row.id}`), ["asset:z", "job:b", "job:a"]);

  const candidates = Array.from({ length: 520 }, (_, index) => ({
    id: `event-${String(index).padStart(3, "0")}`,
    source_type: index % 2 ? "job" : "appointment",
    event_type: "updated",
    title: `Event ${index}`,
    summary: "",
    occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    source_reference: "",
    service_site_id: "site-1",
    work_order_id: "job-1",
  }));
  const merged = mergeTradeAssetTimeline([
    { results: candidates.slice(0, 260) },
    { results: candidates.slice(260) },
  ]);
  assert.equal(merged.length, 500);
  assert.equal(merged[0].id, "event-519");
  assert.equal(merged.at(-1).id, "event-020");
});

test("asset list, review and split timeline SQL execute against the production migration chain", () => {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0004_mixed_chat.sql", "0015_aromatic_black_knight.sql", "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0019_melodic_unus.sql", "0047_customer_service_site_foundation.sql", "0048_unified_enquiry_inbox.sql", "0049_customer_asset_timeline.sql"]) apply(db, fs.readFileSync(new URL(file, migrationDirectory), "utf8"));
  for (const functionName of ["assetRows", "pendingHandoverRows"]) {
    const match = route.match(new RegExp(`async function ${functionName}[\\s\\S]*?prepare\\(\\\`([\\s\\S]*?)\\\`\\)\\s*\\.bind`));
    assert.ok(match, `${functionName} SQL should be discoverable`);
    const bindings = Array((match[1].match(/\?/g) || []).length).fill("");
    assert.doesNotThrow(() => db.prepare(match[1]).all(...bindings), `${functionName} SQL should execute`);
  }
  const timelineSource = route.slice(route.indexOf("async function timelineRows"), route.indexOf("export async function GET"));
  const statements = [...timelineSource.matchAll(/db\.prepare\(`([\s\S]*?)`\)\.bind/g)].map((match) => match[1]);
  assert.equal(statements.length, 7);
  for (const [index, sql] of statements.entries()) {
    assert.match(sql, /^\s*SELECT /);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|UNION)\b/);
    assert.match(sql, /firebase_uid = \?/);
    assert.match(sql, /customer_id = \?/);
    assert.match(sql, /\(\? = '' OR .*service_site_id = \?\)/);
    assert.equal((sql.match(/\?/g) || []).length, 4);
    const bindings = Array((sql.match(/\?/g) || []).length).fill("");
    assert.doesNotThrow(() => db.prepare(sql).all(...bindings), `timeline source ${index + 1} SQL should execute`);
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
