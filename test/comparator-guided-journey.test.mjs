import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const chrome = read("../src/components/ComparatorChrome.tsx");
const chromeStyles = read("../src/components/ComparatorChrome.module.css");
const progress = read("../src/components/ComparisonProgress.tsx");
const electricity = read("../src/components/electricity/NativeElectricityComparator.tsx");
const electricityPage = read("../src/app/compare/page.tsx");
const gas = read("../src/components/GasComparator.tsx");
const gasQuestionnaire = read("../src/components/GasUpgradeQuestionnaire.tsx");
const gasPage = read("../src/app/gas-compare/page.tsx");
const planner = read("../src/components/HomeEnergyPlanner.tsx");
const styles = read("../src/app/globals.css");
const rollback = read("../src/app/compare/electricity-legacy/route.ts");

test("public electricity and gas comparisons use one clear four-step journey", () => {
  assert.match(progress, /export function ComparisonJourney/);
  assert.match(progress, /export function ComparisonStepActions/);
  assert.match(progress, /aria-current=\{state === "current" \? "step"/);
  assert.match(progress, /role="progressbar"/);
  assert.match(electricity, /ELECTRICITY_JOURNEY_STEPS/);
  assert.match(electricity, /Your home[\s\S]*Your usage[\s\S]*Your setup[\s\S]*Results/);
  assert.match(electricity, /activeStep === 1[\s\S]*activeStep === 2[\s\S]*activeStep === 3/);
  assert.match(electricity, /setActiveStep\(4\)/);
  assert.match(electricity, /Step 4 of 4/);
  assert.match(electricity, /Compare electricity plans/);
  assert.doesNotMatch(electricity, /Run native comparison/);
  assert.match(gas, /GAS_JOURNEY_STEPS/);
  assert.match(gas, /Your home[\s\S]*Your usage[\s\S]*Your setup[\s\S]*Results/);
  assert.match(gas, /activeStep === 1[\s\S]*activeStep === 2[\s\S]*activeStep === 3/);
  assert.match(gas, /setActiveStep\(4\)/);
  assert.match(gas, /Step 4 of 4/);
  assert.match(gas, /Compare gas plans/);
});

test("comparisons show one truthful indeterminate working state while current offers are checked", () => {
  assert.match(progress, /export function ComparisonWorkingState/);
  assert.match(progress, /className=\{chromeStyles\.working\} role="status" aria-live="polite" aria-busy="true"/);
  assert.match(progress, /className=\{chromeStyles\.workingTrack\} aria-hidden="true"/);
  assert.doesNotMatch(electricity, /setProgress|progress\s*=/);
  assert.doesNotMatch(gas, /setProgress|progress\s*=/);
  assert.match(electricity, /Finding current plans for your area/);
  assert.match(electricity, /Checking rates, eligibility and conditions/);
  assert.match(electricity, /loading && <ComparisonWorkingState title="Comparing electricity plans"/);
  assert.match(gas, /Finding current plans for your area/);
  assert.match(gas, /Checking rates, eligibility and conditions/);
  assert.match(gas, /loading && <ComparisonWorkingState title="Comparing gas plans"/);
  assert.match(chromeStyles, /\.workingTrack > span \{[^}]*animation: workingSlide/);
  assert.match(chromeStyles, /@keyframes workingSlide/);
  assert.match(chromeStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workingMark,[\s\S]*\.workingTrack > span[\s\S]*animation: none/);
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

test("gas comparison requires the seasonal-use answer while keeping appliance refinement optional", () => {
  const setupStep = gas.indexOf("activeStep === 3");
  const heatingQuestion = gas.indexOf("Is gas used for home heating?");
  const primaryAction = gas.indexOf("comparison-primary-action");
  const optionalRefinement = gas.indexOf("comparison-refinement");
  assert.ok(setupStep > 0);
  assert.ok(heatingQuestion > setupStep);
  assert.ok(optionalRefinement > heatingQuestion);
  assert.ok(primaryAction > optionalRefinement);
  assert.match(gas, /if \(!gasHeating\) \{ setError\("Confirm whether gas is used for home heating\."\)/);
  assert.match(gas, /It is not required to compare plans/);
  assert.match(gas, /<details className="comparison-refinement">/);
});

test("electricity comparison uses only the explicitly selected usage evidence", () => {
  assert.match(electricity, /const usingMeter = usageEvidence === "meter" && meter;/);
  assert.match(electricity, /const annualUsageNumber = usingMeter \? usageOverride\?\.value \|\| automaticMeterAnnualKwh : manualAnnualised\.ok \? manualAnnualised\.annualKwh : 0;/);
  assert.match(electricity, /if \(usingMeter && !meterAllocation\?\.ok\)/);
  assert.match(electricity, /if \(!usingMeter && !manualAnnualised\.ok\)/);
  assert.match(electricity, /hasIntervalMeter: Boolean\(usingMeter\)/);
  assert.match(electricity, /function removeMeterData\(\) \{[\s\S]*setMeter\(null\);[\s\S]*setUsageEvidence\("bill"\);/);
  assert.doesNotMatch(electricity, /const annualUsageNumber = [^;]*\(meter \?/);
  assert.doesNotMatch(electricity, /hasIntervalMeter: Boolean\(meter\)/);
});

test("Enter advances the current step and cannot bypass either guided comparison", () => {
  for (const source of [electricity, gas]) {
    assert.match(source, /function submitCurrentStep\(event: FormEvent<HTMLFormElement>\)/);
    assert.match(source, /if \(activeStep === 1\) \{[\s\S]*continueFromProperty\(\);[\s\S]*if \(activeStep === 2\) \{[\s\S]*continueFromUsage\(\);[\s\S]*if \(activeStep === 3\) void compare\(\);/);
    assert.match(source, /onSubmit=\{submitCurrentStep\}/);
    assert.doesNotMatch(source, /onSubmit=\{compare\}/);
  }
});

test("guided step changes are announced, focused and motion-safe", () => {
  assert.match(progress, /role="status" aria-live="polite" aria-atomic="true">Step \{safeCurrent\} of \{steps\.length\}/);
  assert.match(chrome, /export function comparisonScrollBehavior/);
  assert.match(chrome, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches \? "auto" : "smooth"/);
  assert.match(chrome, /<h2 ref=\{headingRef\} tabIndex=\{-1\}>/);
  for (const source of [electricity, gas]) {
    assert.match(source, /stepHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /scrollIntoView\(\{ behavior: comparisonScrollBehavior\(\), block: "start" \}\)/);
    assert.match(source, /headingRef=\{stepHeadingRef\}/);
  }
});

test("results can be edited and a cross-network electricity choice stays on the review step", () => {
  assert.match(electricity, /activeStep === 4 && plans\.length > 0/);
  assert.match(gas, /activeStep === 4 && hasCurrentPricing && !needsDistributor/);
  for (const source of [electricity, gas]) {
    assert.match(source, />Edit answers<\/button>/);
    assert.match(source, /onClick=\{\(\) => moveToStep\(3\)\}/);
  }
  const electricitySetup = electricity.slice(electricity.indexOf('activeStep === 3'), electricity.indexOf('activeStep === 4'));
  assert.match(electricitySetup, /This postcode crosses network boundaries/);
  assert.match(electricitySetup, /<select value=\{distributor\}/);
});

test("gas appliance refinement follows the parent heating answer in both directions", () => {
  assert.match(gasQuestionnaire, /function alignHeatingSelection\(current: string\[\], usageProfile: "heating" \| "steady"\)/);
  assert.match(gasQuestionnaire, /usageProfile === "heating"[\s\S]*\["gas-ducted", \.\.\.current\.filter/);
  assert.match(gasQuestionnaire, /current\.filter\(\(value\) => !value\.startsWith\("gas-"\)\)/);
  assert.match(gasQuestionnaire, /alignHeatingSelection\(heatingSelection, initialUsageProfile\)/);
  assert.match(gasQuestionnaire, /onChange=\{\(\) => changeHeating\(option\.value\)\}/);
  assert.match(gas, /onUsageProfileChange=\{updateUsageProfileFromQuestionnaire\}/);
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
  assert.match(chromeStyles, /\.journey ol \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(chromeStyles, /@media \(max-width: 720px\)[\s\S]*\.journey li small \{[\s\S]*display: none;/);
  assert.match(chromeStyles, /@media \(max-width: 720px\)[\s\S]*\.stepActions :global\(\.btn\)[\s\S]*min-width: 0;[\s\S]*width: 100%;/);
  assert.match(chromeStyles, /\.journey \{[\s\S]*max-width: 100%;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(electricity, /fetch\(`\/api\/electricity-plans\?postcode=/);
  assert.match(electricity, /estimateNativePlan\(plan/);
  assert.match(gas, /fetch\("\/api\/gas-plans\?" \+ query/);
  assert.match(gas, /annualiseGasUsage/);
  assert.match(rollback, /new URL\("\/electricity-comparator", request\.url\)/);
  assert.match(rollback, /X-Robots-Tag/);
});
