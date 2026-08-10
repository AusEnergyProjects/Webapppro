import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const chrome = read("../src/components/ComparatorChrome.tsx");
const electricity = read("../src/components/electricity/NativeElectricityComparator.tsx");
const electricityPage = read("../src/app/compare/page.tsx");
const gas = read("../src/components/GasComparator.tsx");
const gasPage = read("../src/app/gas-compare/page.tsx");
const planner = read("../src/components/HomeEnergyPlanner.tsx");
const styles = read("../src/app/globals.css");
const rollback = read("../src/app/compare/electricity-legacy/route.ts");

test("public electricity and gas comparisons use one clear three-step journey", () => {
  assert.match(chrome, /export function ComparisonJourney/);
  assert.match(chrome, /aria-current=\{state === "current" \? "step"/);
  assert.match(chrome, /role="progressbar"/);
  assert.match(electricity, /ELECTRICITY_JOURNEY_STEPS/);
  assert.match(electricity, /Property[\s\S]*Usage[\s\S]*Results/);
  assert.match(electricity, /Compare electricity plans/);
  assert.doesNotMatch(electricity, /Run native comparison/);
  assert.match(gas, /GAS_JOURNEY_STEPS/);
  assert.match(gas, /Gas use[\s\S]*Compare[\s\S]*Choose/);
  assert.match(gas, /Compare gas plans/);
});

test("home-plan handoffs restore safe starting assumptions and explain the next action", () => {
  assert.match(planner, /href="\/compare\?from=home-plan"/);
  assert.match(planner, /href="\/gas-compare\?from=home-plan"/);
  assert.match(electricity, /query\.get\("from"\) === "home-plan"/);
  assert.match(electricity, /Continuing from your home plan/);
  assert.match(electricity, /Review the prefilled answers[\s\S]*Compare electricity plans/);
  assert.match(gas, /query\.get\("pc"\) \|\| query\.get\("postcode"\)/);
  assert.match(gas, /query\.get\("mj"\) \|\| query\.get\("annualMj"\)/);
  assert.match(gas, /Continuing from your home plan/);
  assert.match(gas, /Review the gas-use details[\s\S]*Compare gas plans/);
});

test("gas comparison keeps optional refinement out of the required path", () => {
  const primaryAction = gas.indexOf("comparison-primary-action");
  const optionalRefinement = gas.indexOf("comparison-refinement");
  assert.ok(primaryAction > 0);
  assert.ok(optionalRefinement > primaryAction);
  assert.match(gas, /That is enough to compare\. Appliance details below are optional\./);
  assert.match(gas, /It is not required to compare plans/);
  assert.match(gas, /<details className="comparison-refinement">/);
});

test("results give one obvious next step without hiding the audit or retailer checks", () => {
  assert.match(electricity, /id="electricity-results-title"/);
  assert.match(electricity, /Compare gas plans/);
  assert.match(electricity, /Open calculation audit/);
  assert.match(gas, /id="gas-results-title"/);
  assert.match(gas, /Compare electricity plans/);
  assert.match(gas, /check the conditions shown on the offer/);
  assert.match(styles, /\.comparison-complete-next > \.btn/);
  assert.match(styles, /\.comparison-secondary-link/);
});

test("public comparator chrome spells out the Australian Energy Assessments brand", () => {
  const publicSources = `${chrome}\n${electricityPage}\n${gasPage}`;
  assert.match(chrome, />Australian Energy Assessments</);
  assert.match(chrome, /aria-label="Australian Energy Assessments home"/);
  assert.match(electricityPage, /Australian Energy Assessments/);
  assert.match(gasPage, /Australian Energy Assessments/);
  assert.doesNotMatch(publicSources, />\s*AEA(?:\s|<)/);
  assert.doesNotMatch(chrome, /â†|â—/);
});

test("guided comparisons and the planner stay responsive without changing pricing contracts", () => {
  assert.match(styles, /@media \(min-width: 1440px\) \{\s*\.planner-page \{ max-width: 94vw; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.comparison-journey ol \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /\.comparison-journey,[\s\S]*max-width: 100%;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(electricity, /fetch\(`\/api\/electricity-plans\?postcode=/);
  assert.match(electricity, /estimateNativePlan\(plan/);
  assert.match(gas, /fetch\("\/api\/gas-plans\?" \+ query/);
  assert.match(gas, /annualiseGasUsage/);
  assert.match(rollback, /new URL\("\/electricity-comparator", request\.url\)/);
  assert.match(rollback, /X-Robots-Tag/);
});
