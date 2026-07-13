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
  assert.match(component, /Drag your NEM12 CSV here/);
  assert.match(component, /How to get your meter data/);
  assert.match(component, /reason\.length < 5/);
  assert.match(component, /scaleNem12AnnualAllocation\(meterAllocation, totalKwh\)/);
  assert.match(component, /The measured interval proportions were retained and scaled/);
});
