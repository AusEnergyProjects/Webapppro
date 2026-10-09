/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const directory = __dirname;
const component = fs.readFileSync(path.resolve(directory, "../src/components/GasComparator.tsx"), "utf8");
const questionnaire = fs.readFileSync(path.resolve(directory, "../src/components/GasUpgradeQuestionnaire.tsx"), "utf8");
const progress = fs.readFileSync(path.resolve(directory, "../src/components/ComparisonProgress.tsx"), "utf8");
const chromeStyles = fs.readFileSync(path.resolve(directory, "../src/components/ComparatorChrome.module.css"), "utf8");
const route = fs.readFileSync(path.resolve(directory, "../src/app/api/gas-plans/route.ts"), "utf8");
const styles = fs.readFileSync(path.resolve(directory, "../src/app/globals.css"), "utf8");

test("gas comparison sends an explicit seasonal profile and excludes conditional discounts by default", () => {
  assert.match(component, /useState<GasUsageProfile>\("steady"\)/);
  assert.match(component, /useState\(false\)/);
  assert.match(component, /usageProfile, includeConditional/);
  assert.match(component, /setGasHeating\(profile === null \? "" : profile === "heating" \? "yes" : "no"\)/);
  assert.match(component, /onUsageProfileChange=\{updateUsageProfileFromQuestionnaire\}/);
  assert.match(questionnaire, /onUsageProfileChange\(next\.length \? next\.some\(\(item\) => item\.startsWith\("gas-"\)\) \? "heating" : "steady" : null\)/);
  assert.doesNotMatch(component, /name="gas-heating"/);
  assert.doesNotMatch(component, /name="gas-usage-profile"/);
});

test("gas comparison gates LPG and supports dated bill usage with concession disclosure", () => {
  assert.match(component, /Reticulated mains gas/);
  assert.match(component, /LPG bottles or bulk tank/);
  assert.match(component, /supplyType !== "mains"/);
  assert.match(component, /annualiseGasUsage/);
  assert.match(component, /Bill period starts/);
  assert.match(component, /Bill period ends/);
  assert.match(component, /I receive an energy concession/);
  assert.match(component, /Concession not deducted/);
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
  assert.match(component, /hasCurrentPricing && !needsDistributor/);
});

test("edited gas inputs cannot reuse stale plan costs or bypass repricing through network selection", () => {
  assert.match(component, /const comparisonInputKey = useMemo\(\(\) => JSON\.stringify\(\{/);
  assert.match(component, /postcode: postcode\.trim\(\)[\s\S]*usageMj: usageMj\.trim\(\)[\s\S]*usageProfile,[\s\S]*gasHeating,[\s\S]*includeConditional/);
  assert.match(component, /const requestedInputKey = comparisonInputKey;/);
  assert.match(component, /comparisonInputKeyRef\.current !== requestedInputKey/);
  assert.match(component, /setPricedInputKey\(requestedInputKey\)/);
  assert.match(component, /const hasCurrentPricing = Boolean\(plans\.length && pricedInputKey === comparisonInputKey\)/);
  assert.match(component, /if \(!hasCurrentPricing\) \{[\s\S]*void compare\(value\);[\s\S]*return;/);
  assert.match(component, /preferredDistributor && nextDistributors\.includes\(preferredDistributor\)/);
  assert.match(component, /activeStep === 4 && hasCurrentPricing && !needsDistributor/);
  assert.match(component, /Your answers changed\. Current plans will be checked again before updated costs are shown\./);
});

test("residents can compare up to three gas offers side by side", () => {
  assert.match(component, /selectedPlanKeys/);
  assert.match(component, /current\.length < 3/);
  assert.match(component, /Compare selected offers/);
  assert.match(component, /Estimated annual cost/);
  assert.match(component, /Usage rates/);
  assert.match(component, /Conditions to check/);
  assert.match(component, /Comparison full \(3\)/);
});

test("gas comparison keeps loading feedback and opens the current on-page enquiry", () => {
  assert.match(component, /loading && <ComparisonWorkingState title="Comparing gas plans" message=\{status\} \/>/);
  assert.match(component, /loading \? "Comparing gas plans\.\.\." : "Compare gas plans"/);
  assert.match(progress, /className=\{chromeStyles\.working\} role="status" aria-live="polite" aria-busy="true"/);
  assert.doesNotMatch(questionnaire, /saving-direct-trade|createDirectTradeHandoffUrl|UpgradeEnquiryModal/);
  assert.match(questionnaire, /onClick=\{onEnquire\}/);
  assert.match(questionnaire, /createPortal\(<QuickUpgradeEnquiryDialog/);
  assert.match(chromeStyles, /\.working \{[\s\S]*margin: 0 0 20px;/);
  assert.match(questionnaire, /initialServices=\{\[enquiryService\]\}/);
  assert.match(component, /questionsVisible=\{activeStep === 3\}/);
});

test("gas plan service emits privacy-safe operational evidence and a request ID", () => {
  assert.match(route, /createOperationalRecorder/);
  assert.match(route, /event: "api\.gas_plans"/);
  assert.match(route, /"X-Request-Id": operations\.requestId/);
  assert.match(route, /detailPlansUnavailable: body\.source\.detailPlansUnavailable/);
  assert.doesNotMatch(route, /operations\.record\([^)]*(postcode|annualMj)/);
});
