import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0018_military_starhawk.sql");
const ownershipRoute = read("../src/app/api/customer-asset-ownership/route.ts");
const ownershipServer = read("../src/lib/customer-asset-ownership-server.ts");
const transferAdminRoute = read("../src/app/api/admin/asset-transfers/route.ts");
const correctionRoute = read("../src/app/api/trade-handover-corrections/route.ts");
const correctionAdminRoute = read("../src/app/api/admin/handover-corrections/route.ts");
const documentRoute = read("../src/app/api/trade-handover/documents/route.ts");
const lifecycleRoute = read("../src/app/api/customer-asset-lifecycle/route.ts");
const projectRoute = read("../src/app/api/customer-projects/route.ts");
const customerUi = read("../src/components/CustomerAssetOwnershipCentre.tsx");
const customerDashboard = read("../src/components/CustomerDashboard.tsx");
const tradeUi = read("../src/components/TradeHandoverCorrections.tsx");
const adminUi = read("../src/components/AdminAssetGovernance.tsx");

test("asset ownership, consent events and handover corrections are durable and indexed", () => {
  assert.match(schema, /sqliteTable\("customer_asset_ownerships"/);
  assert.match(schema, /sqliteTable\("customer_asset_transfer_requests"/);
  assert.match(schema, /sqliteTable\("customer_asset_transfer_events"/);
  assert.match(schema, /sqliteTable\("trade_handover_corrections"/);
  assert.match(migration, /customer_asset_ownerships_active_key_idx/);
  assert.match(migration, /customer_asset_transfer_requests_code_idx/);
  assert.match(migration, /trade_handover_corrections_pack_version_idx/);
});

test("the asset ownership migration applies cleanly and enforces one active owner", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("customer_asset_ownerships"));
  assert.ok(tables.includes("customer_asset_transfer_requests"));
  assert.ok(tables.includes("customer_asset_transfer_events"));
  assert.ok(tables.includes("trade_handover_corrections"));
  const insert = database.prepare(`INSERT INTO customer_asset_ownerships
    (id, handover_pack_id, customer_uid, active_key, status, source_type, transfer_id, started_at, ended_at, created_at, updated_at)
    VALUES (?, 'pack-1', ?, 'pack-1', 'active', 'original', '', '2026-07-15', '', '2026-07-15', '2026-07-15')`);
  insert.run("owner-1", "customer-1");
  assert.throws(() => insert.run("owner-2", "customer-2"), /UNIQUE constraint failed/);
});

test("one-time claim codes are hashed, expiring and require both customer consents", () => {
  assert.match(ownershipRoute, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(ownershipRoute, /claim_code_hash/);
  assert.doesNotMatch(migration, /claim_code`|raw_claim|plain.*code/i);
  assert.match(ownershipRoute, /sender_consent_at/);
  assert.match(ownershipRoute, /recipient_consent_at/);
  assert.match(ownershipRoute, /Date\.now\(\) \+ 7 \* 86400000/);
  assert.match(ownershipRoute, /if \(body\.consent !== true\)/);
  assert.match(ownershipRoute, /if \(!identity\.emailVerified\)/);
  assert.match(ownershipRoute, /SELF_TRANSFER/);
  assert.match(ownershipRoute, /status = 'awaiting_admin'/);
  assert.match(customerUi, /Shown once/);
  assert.match(customerUi, /AEA stores only its secure hash/);
});

test("administrator approval changes the active owner atomically and keeps a consent ledger", () => {
  assert.match(transferAdminRoute, /requireAdminIdentity\(request, \["owner", "admin", "reviewer"\]\)/);
  assert.match(transferAdminRoute, /sender_consent_at/);
  assert.match(transferAdminRoute, /recipient_consent_at/);
  assert.match(transferAdminRoute, /status = 'transferred_out'/);
  assert.match(transferAdminRoute, /source_type, transfer_id/);
  assert.match(transferAdminRoute, /transfer_approved/);
  assert.match(transferAdminRoute, /writeAdminAudit/);
  assert.match(ownershipRoute, /transfer_cancelled/);
  assert.match(ownershipServer, /status = 'expired'/);
  assert.match(ownershipServer, /transfer_expired/);
  assert.match(adminUi, /Dual household consent/);
});

test("active ownership overrides the original project link across documents and lifecycle views", () => {
  assert.match(ownershipServer, /WHEN EXISTS \(SELECT 1 FROM customer_asset_ownerships/);
  assert.match(ownershipServer, /customer_uid = \? AND status = 'active'/);
  assert.match(documentRoute, /canCustomerAccessHandover\(identity\.uid, record\.handover_pack_id\)/);
  assert.match(lifecycleRoute, /canCustomerAccessHandover\(customerUid, packId\)/);
  assert.match(lifecycleRoute, /customer_asset_ownerships history/);
  assert.match(projectRoute, /customer_asset_ownerships ownership/);
  assert.match(customerDashboard, /Home records/);
  assert.match(customerUi, /Moving out\? Transfer this home record/);
});

test("published handover corrections retain the previous value and require administrator review", () => {
  assert.match(correctionRoute, /p\.status = 'published'/);
  assert.match(correctionRoute, /previous_value, proposed_value/);
  assert.match(correctionRoute, /MAX\(version_number\)/);
  assert.match(correctionRoute, /status = 'submitted'/);
  assert.match(correctionRoute, /entitlements\.features\.business_operations/);
  assert.match(correctionAdminRoute, /currentValue !== String\(correction\.previous_value/);
  assert.match(correctionAdminRoute, /status = 'published'/);
  assert.match(correctionAdminRoute, /handover_correction\.approve/);
  assert.match(correctionAdminRoute, /writeAdminAudit/);
  assert.match(tradeUi, /previous approved value remains active/i);
  assert.match(adminUi, /Current approved value/);
});

test("ownership and correction workflows preserve platform privacy and account boundaries", () => {
  const ownershipSchema = schema.slice(schema.indexOf("export const customerAssetOwnerships"), schema.indexOf("export const tradeOpportunities"));
  assert.doesNotMatch(ownershipSchema, /customer_name|customer_email|customer_phone|street_address|address_line|private_notes/i);
  assert.doesNotMatch(transferAdminRoute, /sender\.email|recipient\.email|display_name|fromCustomerUid:|toCustomerUid:/);
  assert.match(correctionRoute, /account\.partner_type !== "installer"/);
  assert.doesNotMatch(correctionRoute, /supplier|wholesaler.*lead/i);
  assert.match(customerUi, /Free home records/);
  assert.match(customerUi, /Trades cannot see your account or contact details/);
  assert.doesNotMatch(`${ownershipRoute}\n${ownershipServer}\n${transferAdminRoute}\n${correctionRoute}\n${correctionAdminRoute}\n${customerUi}\n${tradeUi}\n${adminUi}`, /[\u2013\u2014]/);
});
