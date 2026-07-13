/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../scripts/compat/load-electricity-model.cjs');

test('daily and monthly tariff blocks scale their published thresholds to the priced period', () => {
  const rates = [{ unitPrice: 0.1, volume: 10 }, { unitPrice: 0.3 }];
  assert.equal(model.blockCost(rates, 7300, 365, 'P1D'), 1460);
  assert.equal(model.blockCost(rates, 240, 365, 'P1M'), 48);
  const detail = model.blockCostDetails(rates, 7300, 365, 'P1D');
  assert.equal(detail.tiers.length, 2);
  assert.equal(detail.tiers.reduce((sum, tier) => sum + tier.cost, 0), detail.total);
  assert.equal(model.ENGINE_VERSION, 'aea-electricity-engine-2.4.0');
});

test('controlled-load usage is costed against its separately published rate', () => {
  const result = model.controlledLoadCost([{ dailyCharge: 0.1, rateBlockUType: 'singleRate', singleRate: { rates: [{ unitPrice: 0.15 }] } }], 1000);
  assert.equal(result.supported, true);
  assert.equal(result.usage, 150);
  assert.equal(result.supply, 36.5);
  assert.equal(result.total, 186.5);
  assert.equal(result.details.reduce((sum, line) => sum + line.cost, 0), result.total);
});

test('daily and monthly demand charges use measured interval peaks', () => {
  const series = [
    { date: '20260105', dow: 0, general: new Array(48).fill(0) },
    { date: '20260106', dow: 1, general: new Array(48).fill(0) },
  ];
  series[0].general[34] = 0.5;
  series[1].general[34] = 1;
  const charge = { amount: 0.2, startTime: '15:00', endTime: '21:00', days: ['MON', 'TUE'], measurementPeriod: 'DAY', chargePeriod: 'DAY' };
  const daily = model.demandChargeCost([{ startDate: '01-01', endDate: '12-31', rateBlockUType: 'demandCharges', demandCharges: [charge] }], series);
  assert.equal(daily.supported, true);
  assert.equal(daily.peakKw, 2);
  assert.ok(Math.abs(daily.total - 0.6) < 1e-9);
  assert.equal(daily.details.length, 1);
  assert.ok(Math.abs(daily.details[0].total - daily.total) < 1e-9);
  const monthlyDaily = model.demandChargeCost([{ startDate: '01-01', endDate: '12-31', rateBlockUType: 'demandCharges', demandCharges: [{ ...charge, measurementPeriod: 'MONTH' }] }], series);
  assert.ok(Math.abs(monthlyDaily.total - 0.8) < 1e-9);
  const monthly = model.demandChargeCost([{ startDate: '01-01', endDate: '12-31', rateBlockUType: 'demandCharges', demandCharges: [{ ...charge, measurementPeriod: 'MONTH', chargePeriod: 'MONTH' }] }], series);
  assert.ok(Math.abs(monthly.total - 0.4) < 1e-9);
});

function record300(date, values, quality = 'A') {
  return ['300', date].concat(values.map(String), [quality, '', '', '', '']).join(',');
}

function simpleNem12(days) {
  const rows = [
    '100,NEM12,202607112215,FROM,TO',
    '200,6400000000,E1,E1,E1,,METER1,kWh,30,'
  ];
  days.forEach(({ date, values, quality }) => rows.push(record300(date, values, quality)));
  rows.push('900');
  return rows.join('\r\n');
}

function multiRegisterNem12(days) {
  const rows = ['100,NEM12,202607112215,FROM,TO'];
  rows.push('200,6400000000,E1,E1,E1,,METER1,kWh,30,');
  days.forEach(date => rows.push(record300(date, new Array(48).fill(1))));
  rows.push('200,6400000000,E2,E2,E2,,METER1,kWh,30,');
  days.forEach(date => rows.push(record300(date, new Array(48).fill(0.25))));
  rows.push('900');
  return rows.join('\r\n');
}

test('NEM12 registers remain separate until their roles are explicitly allocated', () => {
  const dates = ['20260701', '20260702', '20260703', '20260704', '20260705', '20260706', '20260707'];
  const parsed = model.parseNem12(multiRegisterNem12(dates));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.registers.length, 2);
  assert.equal(parsed.registers[0].suggestedRole, 'general');
  assert.equal(parsed.registers[1].suggestedRole, null);
  assert.equal(model.allocateRegisters(parsed.registers, { 'import-1': 'general' }).ok, false);
  const allocated = model.allocateRegisters(parsed.registers, { 'import-1': 'general', 'import-2': 'controlled' });
  assert.equal(allocated.ok, true);
  assert.equal(allocated.generalObservedKwh, 336);
  assert.equal(allocated.controlledObservedKwh, 84);
  assert.equal(allocated.series[0].general[0], 1);
  assert.equal(allocated.series[0].controlled[0], 0.25);
});

test('NEM12 parser sorts records, retains interval shape, and audits quality', () => {
  const base = new Array(48).fill(0.1);
  base[34] = 1.1;
  const dates = ['20260707', '20260701', '20260702', '20260703', '20260704', '20260705', '20260706'];
  const result = model.parseNem12(simpleNem12(dates.map(date => ({ date, values: base }))));

  assert.equal(result.ok, true);
  assert.equal(result.spanDays, 7);
  assert.equal(result.series[0].date, '20260701');
  assert.equal(result.actualPct, 1);
  assert.equal(result.confidence, 'low');
  assert.ok(result.warnings.some(warning => warning.includes('out of order')));
  assert.equal(result.intervalLengths[0], 30);
});

test('time of use fractions follow the measured half hourly load', () => {
  const profile = model.emptyGrid();
  for (let day = 0; day < 5; day++) profile[day][34] = 2;
  profile[5][20] = 1;
  profile[6][20] = 1;
  const peak = [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], startTime: '16:00', endTime: '21:00' }];

  assert.equal(model.profileFraction(profile, peak), 10 / 12);
});

test('equal annual usage with different measured timing can reverse the best plan', () => {
  const peakWindows = [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], startTime: '16:00', endTime: '21:00' }];
  const peakMeter = { series: [] };
  const offPeakMeter = { series: [] };
  for (let day = 0; day < 5; day++) {
    const peakImport = new Array(48).fill(0);
    const offPeakImport = new Array(48).fill(0);
    peakImport[34] = 10;
    offPeakImport[4] = 10;
    peakMeter.series.push({ date: `2026070${day + 1}`, dow: day, import: peakImport });
    offPeakMeter.series.push({ date: `2026070${day + 1}`, dow: day, import: offPeakImport });
  }

  const annualKwh = 5000;
  const flatCost = annualKwh * 0.30;
  const touCost = (meter) => {
    const peakShare = model.meterFraction(meter, null, peakWindows, 'import');
    return annualKwh * (peakShare * 0.50 + (1 - peakShare) * 0.15);
  };

  assert.equal(touCost(peakMeter), 2500);
  assert.equal(touCost(offPeakMeter), 750);
  assert.ok(flatCost < touCost(peakMeter), 'flat plan should win for the peak-heavy household');
  assert.ok(touCost(offPeakMeter) < flatCost, 'TOU plan should win for the off-peak household');
});

test('distributor selection removes plans from overlapping postcode networks', () => {
  const plans = [
    { id: 'ausgrid-plan', distributors: ['Ausgrid'] },
    { id: 'endeavour-plan', distributors: ['Endeavour Energy'] },
    { id: 'both-plan', distributors: ['Ausgrid', 'Endeavour Energy'] },
    { id: 'unknown-plan', distributors: [] },
  ];

  assert.deepEqual(
    model.filterPlansByDistributor(plans, 'Ausgrid').map(plan => plan.id),
    ['ausgrid-plan', 'both-plan']
  );
  assert.deepEqual(
    model.filterPlansByDistributor(plans, 'Endeavour Energy').map(plan => plan.id),
    ['endeavour-plan', 'both-plan']
  );
});

test('solar self consumption changes with the household load pattern', () => {
  const daytime = model.emptyGrid();
  const evening = model.emptyGrid();
  for (let day = 0; day < 7; day++) {
    daytime[day][24] = 1;
    evening[day][38] = 1;
  }
  const dayResult = model.simulateSolar(daytime, 5000, 5000);
  const eveningResult = model.simulateSolar(evening, 5000, 5000);

  assert.ok(dayResult.annualSelfUse > eveningResult.annualSelfUse);
  assert.ok(dayResult.annualImport < eveningResult.annualImport);
});

test('battery dispatch uses exports, reduces imports, and respects round trip losses', () => {
  const imports = model.emptyGrid();
  const exports = model.emptyGrid();
  for (let day = 0; day < 7; day++) {
    exports[day][24] = 1;
    imports[day][38] = 1;
  }
  const result = model.simulateBattery(imports, exports, 3650, 3650, 5, 0.9);

  assert.ok(result.annualImport < 3650);
  assert.ok(result.annualExport < 3650);
  assert.ok(result.annualDischarge < result.annualCharge);
});

test('battery results retain different load timing for households with equal annual imports', () => {
  const peakImports = model.emptyGrid();
  const offPeakImports = model.emptyGrid();
  const exports = model.emptyGrid();
  for (let day = 0; day < 7; day++) {
    peakImports[day][36] = 1;
    offPeakImports[day][4] = 1;
    exports[day][24] = 1;
  }
  const peakResult = model.simulateBattery(peakImports, exports, 3650, 3650, 3, 0.9);
  const offPeakResult = model.simulateBattery(offPeakImports, exports, 3650, 3650, 3, 0.9);
  const evening = [{ startTime: '16:00', endTime: '21:00' }];

  assert.notDeepEqual(peakResult.importProfile, offPeakResult.importProfile);
  assert.ok(
    model.profileFraction(peakResult.importProfile, evening) > model.profileFraction(offPeakResult.importProfile, evening),
    'post-battery tariff exposure should still reflect when each household imports power'
  );
});

const suppliedFixture = process.env.NEM12_FIXTURE;
test('supplied Origin demo file regression', { skip: !suppliedFixture }, () => {
  const result = model.parseNem12(fs.readFileSync(path.resolve(suppliedFixture), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.spanDays, 10);
  assert.equal(result.dateSpanDays, 10);
  assert.equal(Math.round(result.annualImport), 5164);
  assert.equal(result.actualPct, 1);
  assert.equal(result.confidence, 'low');
  assert.ok(result.warnings.some(warning => warning.includes('out of order')));
});
