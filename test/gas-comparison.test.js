import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(path.resolve(directory, "../src/components/GasComparator.tsx"), "utf8");
const questionnaire = fs.readFileSync(path.resolve(directory, "../src/components/GasUpgradeQuestionnaire.tsx"), "utf8");
const route = fs.readFileSync(path.resolve(directory, "../src/app/api/gas-plans/route.ts"), "utf8");

test("gas comparison sends an explicit seasonal profile and excludes conditional discounts by default", () => {
  assert.match(component, /useState<GasUsageProfile>\("heating"\)/);
  assert.match(component, /useState\(false\)/);
  assert.match(component, /usageProfile, includeConditional/);
  assert.match(component, /onUsageProfileChange=\{setUsageProfile\}/);
  assert.match(questionnaire, /hasGasHeating \? "heating" : "steady"/);
  assert.doesNotMatch(component, /name="gas-usage-profile"/);
});

test("gas appliances have separate behaviour-led sections", () => {
  assert.match(questionnaire, />Home heating</);
  assert.match(questionnaire, />Hot water</);
  assert.match(questionnaire, />Cooking</);
  assert.match(questionnaire, />Clothes dryer</);
  assert.match(questionnaire, />Pool or spa heating</);
  assert.match(questionnaire, /hotWaterUse/);
  assert.match(questionnaire, /cooktopUse/);
  assert.match(questionnaire, /dryerUse/);
  assert.match(questionnaire, /spaUse/);
  assert.match(questionnaire, /Pool or spa replacement energy is not included/);
});

test("gas plan retrieval uses current CDR detail v3 with source coverage", () => {
  assert.match(route, /DETAIL_API_VERSION = "3"/);
  assert.match(route, /"x-min-v": version/);
  assert.doesNotMatch(route, /for \(const version of \["3", "2", "1"\]\)/);
  assert.match(route, /retailerCoverage/);
  assert.match(route, /plansMissingLastUpdated/);
  assert.match(route, /resolveCustomerPlanUrl/);
  assert.match(route, /safeCdrBase/);
});

test("gas results disclose seasonal allocation and uncosted plan features", () => {
  assert.match(component, /allocates usage across each seasonal tariff period/);
  assert.match(component, /Published fees not included/);
  assert.match(component, /Confirm eligibility before switching/);
  assert.match(component, /Gas tariff evidence/);
  assert.doesNotMatch(component, /complete eligible set of current gas offers/);
});

test("ambiguous gas postcodes require an explicit distribution network", () => {
  assert.match(route, /distributors: \[\.\.\.new Set/);
  assert.match(component, /needsDistributor/);
  assert.match(component, /Choose the network from your bill/);
  assert.match(component, /plan\.distributors\.includes\(distributor\)/);
  assert.match(component, /plans\.length > 0 && !needsDistributor/);
});

test("residents can compare up to three gas offers side by side", () => {
  assert.match(component, /selectedPlanIds/);
  assert.match(component, /current\.length < 3/);
  assert.match(component, /Compare selected offers/);
  assert.match(component, /Estimated annual cost/);
  assert.match(component, /Usage rates/);
  assert.match(component, /Conditions to check/);
  assert.match(component, /Comparison full \(3\)/);
});
