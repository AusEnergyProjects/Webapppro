import test from "node:test";
import assert from "node:assert/strict";
import { estimateGasContract, gasUsageByDay } from "../src/lib/gas-tariff-engine.ts";

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test("gas heating profile preserves annual MJ and allocates more usage to winter", () => {
  const heating = gasUsageByDay(36500, "heating");
  const steady = gasUsageByDay(36500, "steady");
  assert.ok(Math.abs(sum(heating) - 36500) < 1e-6);
  assert.ok(Math.abs(sum(steady) - 36500) < 1e-6);
  const july = heating.slice(181, 212).reduce((total, value) => total + value, 0);
  const january = heating.slice(0, 31).reduce((total, value) => total + value, 0);
  assert.ok(july > january * 4);
});

test("seasonal gas tariffs use the selected household profile", () => {
  const contract = { tariffPeriod: [
    { displayName: "Cooler months", startDate: "05-01", endDate: "09-30", dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { period: "P1Y", rates: [{ unitPrice: 0.04 }] } },
    { displayName: "Warmer months", startDate: "10-01", endDate: "04-30", dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { period: "P1Y", rates: [{ unitPrice: 0.01 }] } },
  ] };
  const heating = estimateGasContract(contract, 36500, false, "heating");
  const steady = estimateGasContract(contract, 36500, false, "steady");
  assert.ok(heating && steady);
  assert.ok(heating.annualCost > steady.annualCost);
  assert.ok(heating.seasons[0].usageMj > steady.seasons[0].usageMj);
  assert.ok(Math.abs(sum(heating.seasons.map((season) => season.usageMj)) - 36500) < 1e-6);
});

test("daily gas blocks reset on every priced day", () => {
  const contract = { tariffPeriod: [{
    dailySupplyCharge: 0,
    rateBlockUType: "singleRate",
    singleRate: { period: "P1D", rates: [{ unitPrice: 0.1, volume: 10 }, { unitPrice: 0.01 }] },
  }] };
  const result = estimateGasContract(contract, 3650, false, "steady");
  assert.ok(result);
  assert.ok(Math.abs(result.usage - 401.5) < 1e-9);
});

test("overlapping or incomplete gas tariff calendars are rejected", () => {
  const overlap = { tariffPeriod: [
    { startDate: "01-01", endDate: "07-31", dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.02 }] } },
    { startDate: "07-01", endDate: "12-31", dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.02 }] } },
  ] };
  assert.equal(estimateGasContract(overlap, 20000, false, "heating"), null);
});

test("uncosted gas fees and incentives remain visible limitations", () => {
  const contract = {
    tariffPeriod: [{ dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.02 }] } }],
    fees: [{ type: "EXIT" }],
    incentives: [{ displayName: "Welcome credit" }],
  };
  const result = estimateGasContract(contract, 20000, false, "heating");
  assert.ok(result);
  assert.deepEqual(result.limitations, ["published fees not costed", "published incentives not costed"]);
});
