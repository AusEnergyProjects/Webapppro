import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as services from "../src/lib/energy-service-catalogue.mjs";
import * as branding from "../src/lib/trade-business-branding.ts";
import * as abn from "../src/lib/trade-abn.ts";
import * as entitlements from "../src/lib/direct-trade-entitlements.ts";
import * as states from "../src/lib/australian-postcodes.mjs";
import { AEA_RESERVED_SERVICE_IDS } from "../src/lib/aea-service-identity.mjs";
import { matchedServiceCategories } from "../src/lib/trade-service-matching.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const uiSource = read("../src/components/TradeBusinessSettingsWorkspace.tsx");
const routeSource = read("../src/app/api/trade-profile/route.ts");
const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const uiCompiled = compile(uiSource);
const routeCompiled = compile(routeSource);
const text = (node) => node == null || typeof node === "boolean" ? ""
  : typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? []
  : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate))
    : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];

function renderBusiness(capabilities) {
  const hooks = { useState: (value) => [typeof value === "function" ? value() : value, () => {}],
    useRef: (value) => ({ current: value }), useMemo: (callback) => callback(), useEffect() {} };
  const exports = {};
  const dependencies = {
    react: hooks, "react/jsx-runtime": jsx, "next/dynamic": { default: () => () => null },
    "@/lib/trade-business-branding": branding, "@/lib/energy-service-catalogue.mjs": services,
  };
  Function("require", "exports", uiCompiled)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected UI dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports.TradeBusinessSettingsWorkspace({ user: {}, profile: { businessName: "Test trade", partnerType: "installer",
    serviceStates: ["VIC"], capabilities, availabilityStatus: "open", postcode: "3000",
    serviceBasePostcode: "3000", serviceRadiusKm: 50, accountStatus: "active", verificationStatus: "approved" },
  onProfileChange() {}, onAccountClosed() {} });
}

function routeFixture(capabilities = ["solar"]) {
  const database = new DatabaseSync(":memory:");
  const textColumns = ["email", "business_name", "abn", "address_line_1", "suburb", "address_state", "postcode",
    "contact_name", "phone", "partner_type", "business_website", "service_states", "capabilities", "summary",
    "account_status", "verification_status", "verified_abn", "verification_review_id", "verification_reviewed_at",
    "verification_reviewed_by_uid", "availability_status", "service_base_postcode", "settings_updated_at",
    "brand_theme_key", "brand_border_style", "logo_object_key", "logo_content_type", "banner_object_key",
    "banner_content_type", "document_business_name", "document_phone", "document_email", "quote_email_subject_template",
    "quote_email_intro", "quote_default_terms", "invoice_payment_account_name", "invoice_payment_bsb",
    "invoice_payment_account_number", "invoice_payment_reference", "invoice_default_terms", "account_closed_at", "updated_at"];
  database.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,
    ${textColumns.map((column) => `${column} TEXT NOT NULL DEFAULT ''`).join(",")},
    service_radius_km INTEGER DEFAULT 50, email_opportunities INTEGER DEFAULT 1, email_weekly_summary INTEGER DEFAULT 1,
    banner_crop_x_basis_points INTEGER DEFAULT 0, banner_crop_y_basis_points INTEGER DEFAULT 0,
    banner_crop_width_basis_points INTEGER DEFAULT 10000, banner_crop_height_basis_points INTEGER DEFAULT 10000);
    CREATE TABLE trade_account_service_areas(id TEXT PRIMARY KEY, firebase_uid TEXT, position INTEGER, postcode TEXT,
      radius_km INTEGER, record_status TEXT, created_at TEXT, updated_at TEXT);`);
  database.prepare(`INSERT INTO trade_accounts(firebase_uid, email, business_name, phone, partner_type, postcode,
    capabilities, availability_status, account_status, verification_status) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run("owner-1", "owner@example.test", "Test trade", "0412345678", "installer", "3000", JSON.stringify(capabilities), "open", "active", "approved");
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return database.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
    run() { return { success: true, meta: { changes: database.prepare(this.sql).run(...this.values).changes } }; }
  }
  const d1 = { prepare: (sql) => new Statement(sql), async batch(statements) {
    database.exec("BEGIN");
    try { const result = statements.map((statement) => statement.run()); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
  const dependencies = {
    "../../../../db": { getD1: () => d1 },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: "owner-1", emailVerified: true }) },
    "@/lib/trade-access-server": { requireVerifiedTradeIdentity: async () => {}, approvedAbnAccess: () => true,
      approvedTradeReviewPredicate: () => "1 = 1" },
    "@/lib/postcode-distance": { postcodeCoordinate: (postcode) => postcode === "3000" ? [-37.81, 144.96] : null },
    "@/lib/admin-notifications": {}, "@/lib/direct-trade-entitlements": entitlements,
    "@/lib/australian-postcodes.mjs": states, "@/lib/trade-abn": abn,
    "@/lib/trade-business-branding": branding, "@/lib/energy-service-catalogue.mjs": services,
  };
  const exports = {};
  Function("require", "exports", routeCompiled)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected route dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return { database, async patch(body) {
    return exports.PATCH(new Request("https://tlink.test/api/trade-profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  }, async get() { return exports.GET(new Request("https://tlink.test/api/trade-profile")); } };
}

test("Business and Team expose the identical authoritative service catalogue", () => {
  const tree = renderBusiness([]);
  const fieldset = nodes(tree, (node) => node.type === "fieldset" && text(node).includes("Business services"))[0];
  const labels = nodes(fieldset, (node) => node.type === "strong").map(text);
  assert.deepEqual(labels, services.ENERGY_SERVICE_CATALOGUE.map((service) => service.label));
  assert.match(read("../src/components/TradeTeamSettings.tsx"), /ENERGY_SERVICE_CATALOGUE\.map/);
  assert.equal(nodes(fieldset, (node) => node.type === "input").length, services.ENERGY_SERVICE_IDS.length);
  assert.match(text(fieldset), /AEA-managed enquiries remain with Australian Energy Assessments/);
});

test("selected count only includes unique supported services and normalises legacy capabilities", () => {
  const tree = renderBusiness([...services.ENERGY_SERVICE_IDS, "solar", "rental-inspection", "insulation-draughts", "unknown-service"]);
  const fieldset = nodes(tree, (node) => node.type === "fieldset" && text(node).includes("Business services"))[0];
  const count = services.ENERGY_SERVICE_IDS.length;
  assert.match(text(fieldset).replace(/\s+/g, " "), new RegExp(`${count} of ${count} services selected`));
  assert.equal(nodes(fieldset, (node) => node.type === "input" && node.props.checked).length, count);
  assert.deepEqual(services.savedEnergyServiceIds(["rental-inspection", "minimum-rental-standards", "insulation-draughts", "insulation", "unknown"]),
    ["minimum-rental-standards", "insulation", "draught-proofing"]);
});

test("settings API roundtrip preserves every supported service without granting AEA enquiries", async () => {
  const f = routeFixture();
  try {
    const response = await f.patch({ capabilities: [...services.ENERGY_SERVICE_IDS, "solar"] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).settings.capabilities, services.ENERGY_SERVICE_IDS);
    assert.deepEqual((await (await f.get()).json()).profile.capabilities, services.ENERGY_SERVICE_IDS);
    assert.deepEqual(JSON.parse(f.database.prepare("SELECT capabilities FROM trade_accounts").get().capabilities), services.ENERGY_SERVICE_IDS);
    for (const reserved of AEA_RESERVED_SERVICE_IDS) {
      assert.deepEqual(matchedServiceCategories([reserved], services.ENERGY_SERVICE_IDS), []);
      assert.deepEqual(matchedServiceCategories([reserved, "solar"], services.ENERGY_SERVICE_IDS), []);
    }
    assert.deepEqual(matchedServiceCategories(["solar"], services.ENERGY_SERVICE_IDS), ["solar"]);
  } finally { f.database.close(); }
});

test("legacy stored services survive unrelated saves while duplicates and unknowns do not affect selections", async () => {
  const f = routeFixture(["rental-inspection", "minimum-rental-standards", "insulation-draughts", "solar", "solar", "obsolete-service"]);
  const expected = ["minimum-rental-standards", "insulation", "draught-proofing", "solar"];
  try {
    assert.deepEqual((await (await f.get()).json()).profile.capabilities, expected);
    const response = await f.patch({ emailWeeklySummary: false });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).settings.capabilities, expected);
    assert.deepEqual((await (await f.get()).json()).profile.capabilities, expected);
    const legacyWrite = await f.patch({ capabilities: ["rental-inspection", "insulation-draughts", "insulation"] });
    assert.equal(legacyWrite.status, 200);
    assert.deepEqual((await legacyWrite.json()).settings.capabilities, expected.slice(0, 3));
  } finally { f.database.close(); }
});

test("settings API rejects unknown, malformed and empty installer services without changing saved selections", async () => {
  const f = routeFixture(["solar", "assessment"]);
  try {
    for (const capabilities of [["solar", "not-a-service"], ["solar", 1], "solar", [], null]) {
      const response = await f.patch({ capabilities });
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(f.database.prepare("SELECT capabilities FROM trade_accounts").get().capabilities), ["solar", "assessment"]);
    }
  } finally { f.database.close(); }
});
