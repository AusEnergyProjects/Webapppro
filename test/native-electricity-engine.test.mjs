import test from "node:test";
import assert from "node:assert/strict";
import { estimateNativePlan, NATIVE_ENGINE_VERSION } from "../src/lib/electricity/native-tariff-engine.ts";

function profile({ peak = 1, offPeak = 1 } = {}) {
  return Array.from({ length: 7 }, (_, day) => Array.from({ length: 48 }, (_, bin) => {
    const hour = bin / 2;
    return day < 5 && hour >= 15 && hour < 21 ? peak : offPeak;
  }));
}

function plan(rateBlock, extra = {}) {
  return {
    planId: "test-plan",
    name: "Test plan",
    brand: "Test Energy",
    distributors: ["CITIPOWER"],
    contract: { tariffPeriod: [{ startDate: "01-01", endDate: "12-31", dailySupplyCharge: 1, ...rateBlock }], ...extra },
  };
}

test("native single-rate pricing reconciles supply, usage, controlled load and discounts", () => {
  const input = plan({ rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.25 }] } }, {
    controlledLoad: [{ displayName: "Controlled load", rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.1 }] } }],
    discounts: [{ type: "CONDITIONAL", methodUType: "percentOfBill", percentOfBill: { rate: 0.1 } }],
  });
  const estimate = estimateNativePlan(input, { annualGeneralKwh: 4000, annualControlledKwh: 1000, profile: profile(), assumeConditional: true });
  assert.equal(estimate.ok, true);
  assert.equal(NATIVE_ENGINE_VERSION, "aea-native-electricity-0.4.0");
  const result = estimate.result;
  assert.ok(Math.abs(result.supply - 401.5) < 1e-9);
  assert.ok(Math.abs(result.usage - 1100) < 1e-9);
  assert.ok(Math.abs(result.controlled - 110) < 1e-9);
  assert.ok(Math.abs(result.annualCost - (result.supply + result.usage + result.controlled - result.discounts)) < 1e-9);
  assert.ok(Math.abs(result.audit.supply.reduce((sum, line) => sum + line.amount, 0) - result.supply) < 1e-9);
  assert.ok(Math.abs(result.audit.usage.reduce((sum, line) => sum + line.amount, 0) - result.usage) < 1e-9);
  assert.ok(Math.abs(result.audit.controlled.reduce((sum, line) => sum + line.amount, 0) - result.controlled) < 1e-9);
  assert.equal(result.audit.discounts[0].applied, true);
  assert.equal(result.audit.reconciliation.difference, 0);
});

test("native TOU pricing preserves different load patterns with the same annual usage", () => {
  const tou = plan({ rateBlockUType: "timeOfUseRates", timeOfUseRates: [
    { type: "PEAK", rates: [{ unitPrice: 0.5 }], timeOfUse: [{ days: ["MON", "TUE", "WED", "THU", "FRI"], startTime: "15:00", endTime: "21:00" }] },
    { type: "OFF_PEAK", rates: [{ unitPrice: 0.1 }], timeOfUse: [{ days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], startTime: "21:00", endTime: "15:00" }] },
  ] });
  const evening = estimateNativePlan(tou, { annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile({ peak: 8, offPeak: 1 }), assumeConditional: false });
  const overnight = estimateNativePlan(tou, { annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile({ peak: 1, offPeak: 8 }), assumeConditional: false });
  assert.equal(evening.ok, true);
  assert.equal(overnight.ok, true);
  assert.ok(evening.result.annualCost > overnight.result.annualCost);
});

test("native preview excludes demand plans without high-quality full-year intervals", () => {
  const demand = plan({ rateBlockUType: "demandCharges", demandCharges: [{ amount: 0.2 }] });
  const estimate = estimateNativePlan(demand, { annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile(), assumeConditional: false });
  assert.equal(estimate.ok, false);
  assert.match(estimate.reason, /near-complete year/);
});

test("native demand pricing uses measured half-hour general-register peaks", () => {
  const demand = plan({ rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.25 }] } });
  demand.contract.tariffPeriod.push({
    startDate: "01-01", endDate: "12-31", rateBlockUType: "demandCharges",
    demandCharges: [{ amount: 0.2, startTime: "15:00", endTime: "21:00", days: ["MON", "TUE"], measurementPeriod: "DAY", chargePeriod: "DAY" }],
  });
  const first = new Array(48).fill(0); first[34] = 0.5;
  const second = new Array(48).fill(0); second[34] = 1;
  const estimate = estimateNativePlan(demand, {
    annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile(), assumeConditional: false,
    demandReady: true,
    demandSeries: [
      { date: "20260105", dow: 0, stamp: Date.UTC(2026, 0, 5), general: first, controlled: new Array(48).fill(0) },
      { date: "20260106", dow: 1, stamp: Date.UTC(2026, 0, 6), general: second, controlled: new Array(48).fill(0) },
    ],
  });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.result.tariffKind, "demand");
  assert.ok(Math.abs(estimate.result.demand - 0.66) < 1e-9);
  assert.equal(estimate.result.demandPeakKw, 2);
  assert.equal(estimate.result.audit.demand.length, 1);
  assert.ok(Math.abs(estimate.result.audit.demand[0].amount - estimate.result.demand) < 1e-9);
  assert.ok(Math.abs(estimate.result.annualCost - (estimate.result.supply + estimate.result.usage + estimate.result.demand)) < 1e-9);
});

test("native feed-in pricing follows the measured export window and equipment eligibility", () => {
  const solarPlan = plan({ rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.25 }] } }, {
    eligibility: [{ type: "EXISTING_SOLAR", information: "Customer must have solar panels" }],
    solarFeedInTariff: [{ timeVaryingTariffs: [
      { rates: [{ unitPrice: 0.2 }], timeVariations: [{ days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], startTime: "16:00", endTime: "21:00" }] },
      { rates: [{ unitPrice: 0.05 }], timeVariations: [{ days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], startTime: "00:00", endTime: "16:00" }, { days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], startTime: "21:00", endTime: "00:00" }] },
    ] }],
  });
  const noSolar = estimateNativePlan(solarPlan, { annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile(), assumeConditional: false });
  assert.equal(noSolar.ok, false);
  assert.match(noSolar.reason, /Solar is required/);
  const exports = profile({ peak: 8, offPeak: 1 });
  const withSolar = estimateNativePlan(solarPlan, {
    annualGeneralKwh: 5000, annualControlledKwh: 0, profile: profile(), assumeConditional: false,
    hasSolar: true, annualExportKwh: 2000, exportProfile: exports,
  });
  assert.equal(withSolar.ok, true);
  assert.ok(withSolar.result.feedIn > 100);
  assert.ok(withSolar.result.feedInCentsPerKwh > 5);
  assert.equal(withSolar.result.audit.feedIn.length, 1);
  assert.ok(Math.abs(withSolar.result.audit.feedIn[0].amount - withSolar.result.feedIn) < 1e-9);
  assert.ok(Math.abs(withSolar.result.annualCost - (withSolar.result.supply + withSolar.result.usage - withSolar.result.feedIn)) < 1e-9);
});

test("native seasonal audit allocation uses dated NEM12 intervals when available", () => {
  const seasonal = plan({ rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.1 }] } });
  seasonal.contract.tariffPeriod = [
    { startDate: "01-01", endDate: "06-30", dailySupplyCharge: 0, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.1 }] } },
    { startDate: "07-01", endDate: "12-31", dailySupplyCharge: 0, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.5 }] } },
  ];
  const january = new Array(48).fill(0); january[0] = 8;
  const july = new Array(48).fill(0); july[0] = 2;
  const estimate = estimateNativePlan(seasonal, {
    annualGeneralKwh: 1000, annualControlledKwh: 0, profile: profile(), assumeConditional: false,
    evidenceLabel: "Measured fixture", intervalSeries: [
      { date: "20260105", dow: 0, stamp: Date.UTC(2026, 0, 5), general: january, controlled: new Array(48).fill(0) },
      { date: "20260706", dow: 0, stamp: Date.UTC(2026, 6, 6), general: july, controlled: new Array(48).fill(0) },
    ],
  });
  assert.equal(estimate.ok, true);
  assert.ok(Math.abs(estimate.result.usage - 198) < 1e-9);
  assert.match(estimate.result.audit.usage[0].allocation, /80\.0% measured seasonal allocation/);
  assert.match(estimate.result.audit.usage[1].allocation, /20\.0% measured seasonal allocation/);
  assert.equal(estimate.result.audit.evidenceLabel, "Measured fixture");
});
