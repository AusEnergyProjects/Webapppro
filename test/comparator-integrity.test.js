/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const comparator = fs.readFileSync(path.resolve(__dirname, '../public/electricity-comparator.html'), 'utf8');

test('NMI-derived annual usage is locked behind a reasoned override flow', () => {
  assert.match(comparator, /\$\('usageKwh'\)\.readOnly = true/);
  assert.match(comparator, /\$\('usagePeriod'\)\.disabled = true/);
  assert.match(comparator, /\$\('profile'\)\.disabled = true/);
  assert.match(comparator, /reason\.length<5/);
  assert.match(comparator, /userAnnualOverride=\{value, reason, originalValue:/);
  assert.match(comparator, /Remove meter data and enter manually/);
});

test('plan cards disclose meter confidence and annualisation status', () => {
  assert.match(comparator, /Annual usage extrapolated from/);
  assert.match(comparator, /meter confidence<\/span>/);
  assert.match(comparator, /Published fees not fully costed/);
  assert.match(comparator, /Annual total manually adjusted/);
});

test('ambiguous postcodes require an explicit distributor before pricing', () => {
  assert.match(comparator, /setDistributorChoices\(dnsps, nmiDnsp, pc\)/);
  assert.match(comparator, /This postcode overlaps more than one electricity network/);
  assert.match(comparator, /filterPlansByDistributor\(candidates, selectedDnsp\)/);
});

test('plans requiring a controlled load are excluded unless the household has one', () => {
  assert.match(comparator, /id="hasControlledLoad"/);
  assert.match(comparator, /const needsControlledLoad = \/controlled load/);
  assert.match(comparator, /needsControlledLoad && !hasControlledLoad/);
  assert.match(comparator, /allocateRegisters\(r\.registers, roles\)/);
  assert.match(comparator, /Choose a role for every consumption register/);
  assert.match(comparator, /controlledLoadCost\(contract\.controlledLoad, opts\.controlledKwh/);
  assert.match(comparator, /const hasControlledLoad = \$\('hasControlledLoad'\)\.checked/);
});

test('demand plans require complete actual interval data and measured peak pricing', () => {
  assert.match(comparator, /dateSpanDays>=360&&S\.upload\.coverageRatio>=0\.98&&S\.upload\.actualPct>=0\.9/);
  assert.match(comparator, /demandChargeCost\(tps, opts\.demandSeries\)/);
  assert.match(comparator, /if\(!opts\.demandReady\) return null/);
});

test('every ranked plan exposes a charge-level calculation audit and reconciliation', () => {
  assert.match(comparator, /Open calculation audit/);
  assert.match(comparator, /audit:\{energyPeriods:\[\], controlled:\[\], demand:\[\]/);
  assert.match(comparator, /componentTotal:out\.supply\+out\.usage\+out\.controlledUsage/);
  assert.match(comparator, /Reconciled exactly to the ranked plan total/);
  assert.match(comparator, /Market source evidence/);
  assert.match(comparator, /Meter register allocation/);
  assert.match(comparator, /Manual assumption:.*profileAssumptionLabel\(I\.profileKind\).*determines the TOU allocation/);
});
