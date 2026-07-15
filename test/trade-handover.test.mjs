import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  complianceTemplateFor,
  handoverReadiness,
} from "../src/lib/trade-handover.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0016_fair_ultragirl.sql");
const tradeRoute = read("../src/app/api/trade-handover/route.ts");
const documentRoute = read("../src/app/api/trade-handover/documents/route.ts");
const adminRoute = read("../src/app/api/admin/handovers/route.ts");
const customerRoute = read("../src/app/api/customer-projects/route.ts");
const workOrderRoute = read("../src/app/api/trade-work-orders/route.ts");
const tradeUi = read("../src/components/TradeHandoverCentre.tsx");
const adminUi = read("../src/components/AdminHandoverReview.tsx");
const customerUi = read("../src/components/CustomerDashboard.tsx");
const handoverSchema = schema.slice(
  schema.indexOf("export const tradeHandoverPacks"),
  schema.indexOf("export const tradeOpportunities"),
);

test("handover templates combine a common record with category-aware completion prompts", () => {
  const solar = complianceTemplateFor("solar");
  const battery = complianceTemplateFor("battery");
  assert.ok(solar.some((item) => item.key === "installed-products-recorded"));
  assert.ok(solar.some((item) => item.key === "solar-commissioning-recorded"));
  assert.ok(battery.some((item) => item.key === "battery-safety-guidance"));
  assert.equal(new Set(solar.map((item) => item.key)).size, solar.length);
});

test("customer handover readiness requires a platform link, completed work, assets, resolved checks and a visible document", () => {
  const blocked = handoverReadiness({
    assets: [], complianceItems: [{ status: "pending" }], documents: [], workStage: "in_progress", customerProjectId: "",
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.length, 5);
  const ready = handoverReadiness({
    assets: [{ id: "asset-1" }],
    complianceItems: [{ status: "complete" }, { status: "not_applicable" }],
    documents: [{ customerVisible: true }],
    workStage: "completed",
    customerProjectId: "project-1",
  });
  assert.deepEqual(ready, { ready: true, blockers: [] });
});

test("installed assets, compliance, pack reviews and protected document metadata are durable and indexed", () => {
  assert.match(handoverSchema, /sqliteTable\("trade_handover_packs"/);
  assert.match(handoverSchema, /sqliteTable\("trade_installed_assets"/);
  assert.match(handoverSchema, /sqliteTable\("trade_compliance_items"/);
  assert.match(handoverSchema, /sqliteTable\("trade_handover_documents"/);
  assert.match(handoverSchema, /trade_handover_packs_customer_project_idx/);
  assert.match(handoverSchema, /trade_installed_assets_warranty_idx/);
  assert.match(migration, /CREATE TABLE `trade_handover_packs`/);
  assert.match(migration, /CREATE TABLE `trade_handover_documents`/);
});

test("handover storage excludes household contact and address fields", () => {
  assert.doesNotMatch(handoverSchema, /customer_name|household_name|customer_email|customer_phone|street_address|address_line/i);
  assert.match(tradeUi, /No customer name, email, phone or street address is stored here/);
  assert.match(adminUi, /Customer names, contact details, notes and street addresses are excluded/);
});

test("trade handover actions are authenticated, same-origin, installer-only, owner-scoped and paywalled", () => {
  assert.match(tradeRoute, /requireFirebaseIdentity/);
  assert.match(tradeRoute, /sameOrigin\(request\)/);
  assert.match(tradeRoute, /account\.partner_type !== "installer"/);
  assert.match(tradeRoute, /entitlements\.features\.business_operations/);
  assert.match(tradeRoute, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(tradeRoute, /WHERE work_order_id = \? AND firebase_uid = \?/);
  assert.match(tradeUi, /Premium Business Hub feature/);
});

test("protected documents use R2 and customers can download only published visible records they own", () => {
  assert.match(documentRoute, /EVIDENCE/);
  assert.match(documentRoute, /handovers\/\$\{identity\.uid\}/);
  assert.match(documentRoute, /canCustomerAccessHandover\(identity\.uid, record\.handover_pack_id\)/);
  assert.match(documentRoute, /record\.pack_status === "published"/);
  assert.match(documentRoute, /Boolean\(record\.customer_visible\)/);
  assert.match(documentRoute, /requireAdminIdentity/);
  assert.match(documentRoute, /handover\.document_download/);
});

test("admin approval resolves the notification, writes an audit record and controls publication", () => {
  assert.match(adminRoute, /requireAdminIdentity\(request, \["owner", "admin", "reviewer"\]\)/);
  assert.match(adminRoute, /Only submitted handover packs can be reviewed/);
  assert.match(adminRoute, /nextStatus = decision === "approve" \? "published"/);
  assert.match(adminRoute, /entity_type = 'trade_handover_pack'/);
  assert.match(adminRoute, /writeAdminAudit/);
  assert.match(tradeRoute, /trade\.handover_submitted/);
  assert.match(tradeRoute, /requiresAction: true/);
});

test("customer projects expose only published packs and customer-visible document metadata", () => {
  assert.match(customerRoute, /p\.status = 'published'/);
  assert.match(customerRoute, /customer_visible = 1/);
  assert.match(customerRoute, /handoverPacks/);
  assert.doesNotMatch(customerRoute, /objectKey:|object_key:/);
  assert.match(customerUi, /Your digital asset and handover library/);
  assert.match(customerUi, /this free household account/);
});

test("approved asset histories remain available instead of disappearing through archive actions", () => {
  assert.match(workOrderRoute, /ASSET_RECORD_RETAINED/);
  assert.match(workOrderRoute, /Work records with an installed asset or handover history stay available/);
  assert.match(customerRoute, /Projects with an approved asset and handover history stay available/);
  assert.match(customerUi, /Asset and handover history stays in your completed project library/);
});

test("new handover user-facing copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${tradeUi}\n${adminUi}`, /[\u2013\u2014]/);
});
