/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.resolve(__dirname, "../src/app/compare/page.tsx"), "utf8");
const previewPage = fs.readFileSync(path.resolve(__dirname, "../src/app/compare/electricity-next/page.tsx"), "utf8");
const rollbackRoute = fs.readFileSync(path.resolve(__dirname, "../src/app/compare/electricity-legacy/route.ts"), "utf8");
const component = fs.readFileSync(path.resolve(__dirname, "../src/components/electricity/NativeElectricityComparator.tsx"), "utf8");

test("native electricity is primary with noindex regression and rollback routes", () => {
  assert.match(page, /Electricity plan comparison/);
  assert.match(page, /<NativeElectricityComparator \/>/);
  assert.match(previewPage, /robots: \{ index: false, follow: false \}/);
  assert.match(previewPage, /<NativeElectricityComparator preview \/>/);
  assert.match(rollbackRoute, /electricity-comparator\.html/);
  assert.match(rollbackRoute, /X-Robots-Tag/);
});

test("native results use the same-origin plan route and strict typed estimator", () => {
  assert.match(component, /fetch\(`\/api\/electricity-plans\?postcode=/);
  assert.match(component, /estimateNativePlan\(plan/);
  assert.match(component, /parseNem12\(await file\.text\(\)\)/);
  assert.match(component, /allocateNem12Registers\(meter\.registers, registerRoles\)/);
  assert.match(component, /Confirm whether every meter register is general usage or controlled load/);
  assert.match(component, /demandReady,/);
  assert.match(component, /Supported demand plans use peaks measured in the uploaded general-usage register/);
  assert.match(component, /simulateSolar\(pricingContext\.profile/);
  assert.match(component, /simulateBattery\(solar\.importProfile/);
  assert.match(component, /annualExportKwh: annualExport/);
  assert.match(component, /Solar, battery, EV and controlled-load eligibility/);
  assert.match(component, /Open calculation audit/);
  assert.match(component, /Open scenario calculation audit/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /auditReturnRef\.current\?\.focus\(\)/);
  assert.match(component, /Reconciled exactly to the ranked plan total/);
});

test("native input flow preserves location, privacy and reasoned override parity", () => {
  assert.match(component, /distributorFromNmi\(nmi\)/);
  assert.match(component, /customerType=\$\{encodeURIComponent\(customerType\)\}/);
  assert.match(component, /The full NMI stays in this browser/);
  assert.match(component, /onDrop=\{handleMeterDrop\}/);
  assert.match(component, /Drag your NEM12 meter-data CSV here/);
  assert.match(component, /Step-by-step: find your NMI and download meter data/);
  assert.match(component, /reason\.length < 5/);
  assert.match(component, /scaleNem12AnnualAllocation\(meterAllocation, totalKwh\)/);
  assert.match(component, /The measured interval proportions were retained and scaled/);
});

test("native manual inputs use bill-friendly periods and clear choice cards", () => {
  assert.match(component, /Typical quarterly bill/);
  assert.match(component, /Monthly bill/);
  assert.match(component, /Annual total/);
  assert.match(component, /annualiseUsage\(value, usagePeriod\)/);
  assert.match(component, /When do you usually use the most power/);
  assert.match(component, /Current solar and battery setup/);
  assert.match(component, /native-assumption-card/);
  assert.doesNotMatch(component, /<Field label="Usage pattern"><select/);
});

test("native meter help provides plain-language steps and official distributor links", () => {
  assert.match(component, /Your NMI and meter data are different/);
  assert.match(component, /Step-by-step: find your NMI and download meter data/);
  assert.match(component, /Object\.entries\(DISTRIBUTOR_INFO\)/);
  assert.match(component, /Open official meter-data page/);
  assert.match(component, /The downloaded file is read locally/);
  assert.doesNotMatch(component, /id="meter-data-help" open/);
});

test("native plan actions stay grouped and resident-facing audits hide internal evidence clutter", () => {
  assert.match(component, /className="plan-actions"/);
  assert.match(component, /plan\.link \|\| plan\.retailerUrl/);
  assert.doesNotMatch(component, /plan\.link \|\| plan\.base/);
  assert.match(component, /Plan dates and eligibility/);
  assert.doesNotMatch(component, /<b>Plan tariff evidence<\/b>/);
  assert.doesNotMatch(component, /<b>Calculation versions<\/b>/);
  assert.doesNotMatch(component, /<b>Market source evidence<\/b>/);
  assert.doesNotMatch(component, /<b>Not included<\/b>/);
});

test("upgrade scenarios distinguish editable quotes from model assumptions", () => {
  assert.match(component, /Replace the prefilled cost with a written installed quote/);
  assert.match(component, /Annual solar yield/);
  assert.match(component, /Battery round-trip efficiency/);
  assert.match(component, /using first-year bill saving/);
  assert.match(component, /Indicative scenario, not an installation recommendation/);
  assert.match(component, /SunSPOT calculator/);
});
