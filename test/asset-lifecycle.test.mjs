import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  addMonthsToIsoDate,
  googleCalendarUrl,
  lifecycleStatus,
  safetyNoticeMatchesAsset,
} from "../src/lib/asset-lifecycle.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0017_brief_timeslip.sql");
const tradeRoute = read("../src/app/api/trade-asset-lifecycle/route.ts");
const customerRoute = read("../src/app/api/customer-asset-lifecycle/route.ts");
const adminRoute = read("../src/app/api/admin/asset-safety/route.ts");
const tradeUi = read("../src/components/TradeAssetLifecycle.tsx");
const customerUi = read("../src/components/CustomerAssetLifecycle.tsx");
const adminUi = read("../src/components/AdminAssetSafety.tsx");

test("service cadence dates preserve the last valid day of a target month", () => {
  assert.equal(addMonthsToIsoDate("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToIsoDate("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsToIsoDate("2026-07-15", 12), "2027-07-15");
  assert.equal(addMonthsToIsoDate("not-a-date", 12), "");
});

test("lifecycle due states distinguish overdue, due soon and future schedules", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  assert.equal(lifecycleStatus("2026-07-14", now), "overdue");
  assert.equal(lifecycleStatus("2026-08-14", now), "due_soon");
  assert.equal(lifecycleStatus("2026-08-15", now), "upcoming");
  assert.equal(lifecycleStatus("", now), "unscheduled");
});

test("safety notices match only the non-empty controlled product scope", () => {
  const asset = { assetCategory: "battery", brand: "Example Energy", modelNumber: "B100" };
  assert.equal(safetyNoticeMatchesAsset({ assetCategory: "battery", brand: "", modelNumber: "" }, asset), true);
  assert.equal(safetyNoticeMatchesAsset({ assetCategory: "battery", brand: "example energy", modelNumber: "b100" }, asset), true);
  assert.equal(safetyNoticeMatchesAsset({ assetCategory: "solar", brand: "", modelNumber: "" }, asset), false);
  assert.equal(safetyNoticeMatchesAsset({ assetCategory: "", brand: "Example Energy", modelNumber: "B200" }, asset), false);
});

test("Google Calendar actions contain only the supplied product reminder", () => {
  const url = new URL(googleCalendarUrl({ title: "Battery service", date: "2026-09-01", details: "Open the private dashboard." }));
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("dates"), "20260901/20260902");
  assert.equal(url.searchParams.get("text"), "Battery service");
});

test("service plans, immutable events, customer preferences and safety acknowledgements are durable and indexed", () => {
  assert.match(schema, /sqliteTable\("trade_asset_service_plans"/);
  assert.match(schema, /sqliteTable\("trade_asset_service_events"/);
  assert.match(schema, /sqliteTable\("customer_asset_lifecycle_preferences"/);
  assert.match(schema, /sqliteTable\("asset_safety_notices"/);
  assert.match(schema, /sqliteTable\("asset_safety_acknowledgements"/);
  assert.match(migration, /CREATE TABLE `trade_asset_service_plans`/);
  assert.match(migration, /CREATE TABLE `asset_safety_notices`/);
  assert.match(migration, /customer_asset_lifecycle_preferences_owner_asset_idx/);
});

test("the lifecycle migration applies cleanly to SQLite", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("trade_asset_service_plans"));
  assert.ok(tables.includes("asset_safety_notices"));
  assert.ok(tables.includes("customer_asset_lifecycle_preferences"));
});

test("installer lifecycle actions are authenticated, installer-only, owner-scoped and paywalled", () => {
  assert.match(tradeRoute, /requireFirebaseIdentity/);
  assert.match(tradeRoute, /sameOrigin\(request\)/);
  assert.match(tradeRoute, /account\.partner_type !== "installer"/);
  assert.match(tradeRoute, /entitlements\.features\.business_operations/);
  assert.match(tradeRoute, /work_order_id = \? AND firebase_uid = \?/);
  assert.match(tradeRoute, /Keep customer names, contact details and addresses out of service records/);
  assert.match(tradeUi, /No household identity was used/);
});

test("customer lifecycle reads require project ownership and approved handovers", () => {
  assert.match(customerRoute, /customer_projects WHERE id = \? AND firebase_uid = \?/);
  assert.match(customerRoute, /p\.status = 'published'/);
  assert.match(customerRoute, /record_status = 'active'/);
  assert.match(customerRoute, /ON CONFLICT\(customer_uid, notice_id, asset_id\)/);
  assert.match(customerUi, /Free for the life of your home/);
  assert.match(customerUi, /Add to Google Calendar/);
  assert.match(customerUi, /No contact details were shared/);
});

test("administrators require sourced HTTPS notices and audited publication controls", () => {
  assert.match(adminRoute, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(adminRoute, /new URL\(value\)\.protocol === "https:"/);
  assert.match(adminRoute, /writeAdminAudit/);
  assert.match(adminRoute, /asset_safety\.publish/);
  assert.match(adminUi, /official regulator or manufacturer HTTPS source/i);
  assert.match(adminUi, /never exposes customer contact details/);
});

test("asset lifecycle records do not add customer contact or address fields", () => {
  const lifecycleSchema = schema.slice(schema.indexOf("export const tradeAssetServicePlans"), schema.indexOf("export const tradeOpportunities"));
  assert.doesNotMatch(lifecycleSchema, /customer_name|customer_email|customer_phone|street_address|address_line|private_notes/i);
  assert.doesNotMatch(`${tradeUi}\n${customerUi}\n${adminUi}`, /[\u2013\u2014]/);
});
