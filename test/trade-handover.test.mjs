import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HANDOVER_ASSET_CATEGORIES,
  HANDOVER_DOCUMENT_CATEGORIES,
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
  const fabricKeys = new Map([
    ["draught-proofing", "draught-installation-recorded"],
    ["insulation", "insulation-installation-recorded"],
    ["glazing", "glazing-installation-recorded"],
    ["window-coverings", "covering-installation-recorded"],
  ]);
  for (const [category, key] of fabricKeys) {
    assert.ok(complianceTemplateFor(category).some((item) => item.key === key), category);
  }
  const legacy = complianceTemplateFor("insulation-draughts");
  assert.ok(legacy.some((item) => item.key === "completion-evidence-ready"));
  for (const key of fabricKeys.values()) assert.equal(legacy.some((item) => item.key === key), false);

  const diagnosticKeys = new Map([
    ["blower-door-testing", ["blower-door-configuration-recorded", "blower-door-method-recorded", "blower-door-report-ready"]],
    ["thermal-imaging", ["thermal-conditions-recorded", "thermal-images-ready", "thermal-report-ready"]],
  ]);
  for (const [category, keys] of diagnosticKeys) {
    const items = complianceTemplateFor(category);
    for (const key of keys) assert.ok(items.some((item) => item.key === key), `${category}:${key}`);
    assert.equal(items.some((item) => item.key === "installed-products-recorded"), false);
    assert.equal(items.some((item) => item.key === "warranty-path-confirmed"), false);
    assert.ok(items.some((item) => item.key === "diagnostic-scope-confirmed"));
  }
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

test("diagnostic reports are customer documents and never installed lifecycle assets", () => {
  const assetCategories = new Set(HANDOVER_ASSET_CATEGORIES.map(([value]) => value));
  const documentCategories = new Set(HANDOVER_DOCUMENT_CATEGORIES.map(([value]) => value));
  for (const category of ["blower-door-report", "thermal-imaging-report"]) {
    assert.equal(assetCategories.has(category), false);
    assert.equal(documentCategories.has(category), true);
  }

  const shared = {
    assets: [],
    complianceItems: [{ status: "complete" }],
    workStage: "completed",
    customerProjectId: "project-1",
  };
  assert.deepEqual(handoverReadiness({
    ...shared,
    serviceCategory: "blower-door-testing",
    documents: [{ category: "blower-door-report", customerVisible: true }],
  }), { ready: true, blockers: [] });
  assert.deepEqual(handoverReadiness({
    ...shared,
    serviceCategory: "thermal-imaging",
    documents: [{ category: "commissioning-report", customerVisible: true }],
  }), { ready: false, blockers: ["Add the completed diagnostic report to the customer pack."] });
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

test("trade handover actions are authenticated, same-origin, installer-only, owner-scoped and verification protected", () => {
  assert.match(tradeRoute, /requireVerifiedTradeAccess/);
  assert.match(tradeRoute, /sameOrigin\(request\)/);
  assert.match(tradeRoute, /partnerTypes: \["installer"\]/);
  assert.match(tradeRoute, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(tradeRoute, /WHERE work_order_id = \? AND firebase_uid = \?/);
  assert.match(tradeRoute, /accountEntitlements\(access\.identity\.uid, "installer"\)/);
  assert.doesNotMatch(tradeRoute, /billing_status/);
  assert.match(tradeUi, /Verification required/);
  assert.doesNotMatch(tradeUi, /Premium Business Hub feature/);
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
  assert.match(customerUi, /Asset and handover history stays in your completed project\s+library/);
});

test("new handover user-facing copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${tradeUi}\n${adminUi}`, /[\u2013\u2014]/);
});
