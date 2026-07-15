import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const route = read("../src/app/api/trade-work-orders/route.ts");
const hub = read("../src/components/TradeBusinessHub.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const entitlements = read("../src/lib/direct-trade-entitlements.ts");
const migration = read("../drizzle/0015_aromatic_black_knight.sql");
const operationsSchema = schema.slice(
  schema.indexOf("export const tradeWorkOrders"),
  schema.indexOf("export const tradeOpportunities"),
);

test("Business Hub records, tasks and activity are durable and indexed", () => {
  assert.match(operationsSchema, /sqliteTable\("trade_work_orders"/);
  assert.match(operationsSchema, /sqliteTable\("trade_work_order_tasks"/);
  assert.match(operationsSchema, /sqliteTable\("trade_work_order_events"/);
  assert.match(operationsSchema, /trade_work_orders_owner_stage_idx/);
  assert.match(operationsSchema, /trade_work_order_tasks_owner_idx/);
  assert.match(operationsSchema, /trade_work_order_events_owner_idx/);
  assert.match(migration, /CREATE TABLE `trade_work_orders`/);
});

test("Business Hub deliberately excludes household contact fields", () => {
  assert.doesNotMatch(
    operationsSchema,
    /customer_name|household_name|customer_email|customer_phone|street_address|address_line/i,
  );
  assert.match(route, /PRIVATE_DATA/);
  assert.match(route, /Keep names, email addresses and phone numbers out/);
  assert.match(hub, /Customer names, emails, phone numbers and street addresses stay outside this workspace/);
  assert.match(hub, /No street address/);
});

test("every Business Hub read and write is authenticated, same-origin and owner scoped", () => {
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /WHERE firebase_uid = \?/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(route, /t\.firebase_uid = \? AND w\.firebase_uid = \?/);
  assert.match(route, /w\.record_status = 'active'/);
});

test("free access, membership expansion and premium team access are enforced server side", () => {
  assert.match(entitlements, /key: "business_operations"/);
  assert.match(entitlements, /key: "team_access"/);
  assert.match(route, /FREE_ACTIVE_LIMIT = 5/);
  assert.match(route, /entitlements\.features\.business_operations/);
  assert.match(route, /entitlements\.features\.team_access/);
  assert.match(route, /FULL_ACCESS_REQUIRED/);
  assert.match(route, /TEAM_ACCESS_REQUIRED/);
  assert.match(hub, /Free foundation/);
  assert.match(hub, /Unlock platform conversion/);
  assert.match(dashboard, /Manage up to five privacy-safe internal work records/);
});

test("platform conversion respects installer and wholesaler role boundaries", () => {
  assert.match(route, /identity\.partnerType !== "installer"/);
  assert.match(route, /m\.status IN \('interested', 'connected'\)/);
  assert.match(route, /identity\.partnerType !== "supplier"/);
  assert.match(route, /supplier_product_enquiries/);
  assert.match(hub, /Wholesalers convert product requests, never household leads/);
  assert.match(dashboard, /dashboard-workspace-nav/);
  assert.match(dashboard, /setWorkspace\("work"\)/);
});

test("Business Hub user-facing copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(hub, /[\u2013\u2014]/);
});
