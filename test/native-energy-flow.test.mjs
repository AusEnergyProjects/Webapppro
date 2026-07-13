import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  SCENARIO_COST_ASSUMPTIONS,
  batteryRebate,
  defaultBatteryNetCost,
  defaultSolarNetCost,
  simulateBattery,
  simulateSolar,
  solarYieldForPostcode,
  suggestedSolarSize,
} from "../src/lib/electricity/energy-flow.ts";

const require = createRequire(import.meta.url);
const compatibility = require("../scripts/compat/load-electricity-model.cjs");

function grid(bin) {
  return Array.from({ length: 7 }, () => Array.from({ length: 48 }, (_, index) => index === bin ? 1 : 0));
}

test("native solar simulation stays in exact compatibility parity", () => {
  const load = grid(24);
  const native = simulateSolar(load, 5000, 6500);
  const legacy = compatibility.simulateSolar(load, 5000, 6500);
  assert.deepEqual(native, legacy);
});

test("native battery dispatch stays in exact compatibility parity", () => {
  const imports = grid(38);
  const exports = grid(24);
  const native = simulateBattery(imports, exports, 3650, 3650, 10, 0.9);
  const legacy = compatibility.simulateBattery(imports, exports, 3650, 3650, 10, 0.9);
  assert.deepEqual(native, legacy);
  assert.ok(native.annualImport < 3650);
  assert.ok(native.annualDischarge < native.annualCharge);
});

test("solar sizing uses the household postcode yield", () => {
  assert.equal(solarYieldForPostcode("3000"), 1250);
  assert.equal(solarYieldForPostcode("4000"), 1500);
  assert.equal(suggestedSolarSize(5000, "3000"), 4);
  assert.equal(suggestedSolarSize(5000, "4000"), 4);
});

test("scenario cost defaults expose the current dated assumptions", () => {
  assert.equal(SCENARIO_COST_ASSUMPTIONS.version, "2026-07-14");
  assert.deepEqual(batteryRebate(10), { stcs: 68, amount: 2720 });
  assert.deepEqual(batteryRebate(40), { stcs: 164, amount: 6560 });
  assert.deepEqual(batteryRebate(60), { stcs: 174, amount: 6960 });
  assert.deepEqual(batteryRebate(Number.NaN), { stcs: 0, amount: 0 });
  assert.equal(defaultBatteryNetCost(10), 7300);
  assert.equal(defaultSolarNetCost(4), 3400);
});
