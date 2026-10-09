import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { estimateGasContract } from "../src/lib/gas-tariff-engine.ts";
import { resolvePublishedPlanReference } from "../src/lib/published-plan-reference.ts";

const component = fs.readFileSync(new URL("../src/components/GasComparator.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../src/app/api/gas-plans/route.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("GasComparator.tsx", component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const compile = (source) => ts.transpileModule(source, { compilerOptions }).outputText;
function findNode(predicate) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(found);
  return found;
}
const declaration = (name) => findNode((node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);
const namedFunction = (name) => findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
const helpers = new Function(compile(`${namedFunction("gasPlanKey")}\n${namedFunction("gasPublishedReference")}`) + "return { gasPlanKey, gasPublishedReference };")();
const selectors = new Function("plans", "distributor", "hasCurrentPricing", "includeConditional", "currentPlanId", "selectedReferenceKey", "search", "showStanding", "selectedPlanKeys", "useMemo", "gasPublishedReference", "gasPlanKey", "resolvePublishedPlanReference",
  compile(["networkPlans", "referenceOptions", "referenceMatch", "visiblePlans", "selectedPlans"].map((name) => `const ${name} = ${declaration(name).initializer.getText(tree)};`).join("\n")) + "return { referenceMatch, visiblePlans, selectedPlans };");
function select(plans, overrides = {}) {
  const values = { distributor: "Network A", hasCurrentPricing: true, includeConditional: false, currentPlanId: "GAS123@VEC", selectedReferenceKey: "", search: "", showStanding: true, selectedPlanKeys: [], ...overrides };
  return selectors(plans, values.distributor, values.hasCurrentPricing, values.includeConditional, values.currentPlanId, values.selectedReferenceKey, values.search, values.showStanding, values.selectedPlanKeys, (callback) => callback(), helpers.gasPublishedReference, helpers.gasPlanKey, resolvePublishedPlanReference);
}
function plan(overrides = {}) {
  return { base: "https://retailer-a.example", id: "GAS123@VEC", name: "Current gas plan", brand: "Retailer A", type: "STANDING", distributors: ["Network A"], annualCost: 900, supplyChargeDaily: 100, rates: [{ label: "All usage", centsPerMj: 4 }], conditionalDiscounts: [], seasonal: false, effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: null, ...overrides };
}

test("gas reference uses all same-network priced offers independently of display filters", () => {
  const current = plan({ seasonal: true, conditionalDiscounts: ["Pay on time"] });
  const other = plan({ base: "https://retailer-b.example", id: "GAS456@VEC", name: "Alternative", brand: "Retailer B", annualCost: 700, type: "MARKET" });
  const result = select([current, other], { showStanding: false, search: "Alternative" });
  assert.equal(result.visiblePlans.length, 1);
  assert.equal(result.referenceMatch.status, "matched");
  assert.equal(result.referenceMatch.plan.annualCost, 900);
  assert.equal(result.referenceMatch.plan.key, `${current.base}|${current.id}`);
  assert.match(result.referenceMatch.plan.rateDescription, /100\.0c\/day supply; 4\.00c\/MJ All usage/);
  assert.match(result.referenceMatch.plan.rateDescription, /Seasonal rates/);
  assert.match(result.referenceMatch.plan.rateDescription, /conditional discounts are not applied/);
  assert.equal(select([current], { search: "does not exist", showStanding: false }).referenceMatch.status, "matched");
});

test("gas reference requires current pricing and the selected network, and does not guess suffixes", () => {
  const plans = [plan()];
  for (const overrides of [{ hasCurrentPricing: false }, { distributor: "" }, { distributor: "Network B" }, { currentPlanId: "GAS123@EME" }, { currentPlanId: "GAS123@OTHER" }]) {
    assert.equal(select(plans, overrides).referenceMatch.status, "missing");
  }
  assert.equal(select(plans, { currentPlanId: "" }).referenceMatch.status, "empty");
  assert.equal(select(plans, { currentPlanId: "https://retailer.example/plan" }).referenceMatch.status, "invalid");
  assert.equal(select(plans, { currentPlanId: "gas123" }).referenceMatch.status, "matched");
  assert.equal(select([plan({ effectiveTo: "2000-01-01" })]).referenceMatch.status, "missing");
  assert.equal(select([plan({ effectiveFrom: "2999-01-01" })]).referenceMatch.status, "missing");
  assert.equal(select([plan({ effectiveFrom: "not-a-date" })]).referenceMatch.status, "missing");
});

test("cross-retailer gas IDs remain ambiguous until a composite-key reference is selected", () => {
  const plans = [plan(), plan({ base: "https://retailer-b.example", brand: "Retailer B", annualCost: 700 })];
  assert.equal(select(plans).referenceMatch.status, "ambiguous");
  const selectedKey = helpers.gasPlanKey(plans[1]);
  const result = select(plans, { selectedReferenceKey: selectedKey, selectedPlanKeys: [selectedKey] });
  assert.equal(result.referenceMatch.status, "matched");
  assert.equal(result.referenceMatch.plan.brand, "Retailer B");
  assert.equal(result.selectedPlans.length, 1);
  assert.equal(result.selectedPlans[0].base, plans[1].base);
  assert.notEqual(helpers.gasPlanKey(plans[0]), selectedKey);
});

test("gas side-by-side selection retains the three-offer limit and removes only the composite key", () => {
  let selected = [];
  const toggle = new Function("setSelectedPlanKeys", compile(namedFunction("toggleSelectedPlan")) + "return toggleSelectedPlan;")((update) => { selected = update(selected); });
  for (const key of ["retailer-a|same-id", "retailer-b|same-id", "retailer-c|third", "retailer-d|fourth"]) toggle(key);
  assert.deepEqual(selected, ["retailer-a|same-id", "retailer-b|same-id", "retailer-c|third"]);
  toggle("retailer-a|same-id");
  assert.deepEqual(selected, ["retailer-b|same-id", "retailer-c|third"]);
});

test("changing the optional gas ID clears disambiguation without becoming a pricing or provider input", () => {
  const changed = [];
  const change = new Function("setCurrentPlanId", "setSelectedReferenceKey", compile(namedFunction("changeCurrentPlanId")) + "return changeCurrentPlanId;")((value) => changed.push(["id", value]), (value) => changed.push(["selection", value]));
  change("GAS456");
  assert.deepEqual(changed, [["id", "GAS456"], ["selection", ""]]);
  assert.doesNotMatch(declaration("comparisonInputKey").getText(tree), /currentPlanId|selectedReferenceKey/);
  assert.doesNotMatch(namedFunction("compare"), /currentPlanId|selectedReferenceKey/);
  assert.match(component, /<CurrentPlanInput value=\{currentPlanId\} onChange=\{changeCurrentPlanId\}/);
  assert.match(component, /<CurrentPlanComparison[^>]+fuel="gas"/);
  assert.match(component, /isReference=\{referencePlan\.key === gasPlanKey\(plan\)\}/);
});

test("gas-plan API preserves identically named IDs from separate retailer bases", async () => {
  const dependencies = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options.status }) } },
    "@/lib/gas-tariff-engine": { estimateGasContract },
    "@/lib/electricity-cdr.mjs": { safeCdrBase: (base) => base },
    "@/lib/operational-events.mjs": { createOperationalRecorder: () => ({ requestId: "fixture", record() {} }) },
    "@/lib/retailer-links.mjs": { retailerWebsite: (base) => base, resolveCustomerPlanUrl: (links, fallback) => links.find(Boolean) || fallback },
  };
  const retailers = ["a", "b"].map((suffix) => ({ brandName: `Retailer ${suffix}`, industries: ["energy"], productReferenceDataBaseUri: `https://retailer-${suffix}.example` }));
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    let body;
    if (url.endsWith("energy-prd-endpoints.json")) body = retailers;
    else if (url.includes("?fuelType=GAS")) body = { data: { plans: [{ planId: "GAS123@VEC", displayName: "Gas plan", fuelType: "GAS", customerType: "RESIDENTIAL", geography: { includedPostcodes: ["3000"], distributors: ["Network A"] } }] }, meta: { totalPages: 1 } };
    else body = { data: { type: "MARKET", gasContract: { tariffPeriod: [{ dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: url.includes("retailer-a") ? 0.04 : 0.02 }] } }] } } };
    return { ok: true, json: async () => body };
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", compile(route))((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, routeModule, routeModule.exports, fetch);
  const result = await routeModule.exports.GET({ nextUrl: new URL("https://site.example/api/gas-plans?postcode=3000&annualMj=20000&usageProfile=steady&includeConditional=false") });
  assert.equal(result.status, 200);
  assert.equal(result.body.plans.length, 2);
  assert.equal(new Set(result.body.plans.map((item) => item.base)).size, 2);
  assert.equal(result.body.plans[0].brand, "Retailer b");
  assert.equal(result.body.source.detailPlansSucceeded, 2);
  assert.equal(fetched.filter((url) => url.includes("/plans/GAS123%40VEC")).length, 2);
});
