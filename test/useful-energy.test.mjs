import test from "node:test";
import assert from "node:assert/strict";
import { USEFUL_ENERGY_EXAMPLES, averageAvailablePriceCentsPerKwh, purchasedEnergyReductionPercent, usefulEnergyExample, wholesaleInputCostCents } from "../src/lib/useful-energy.ts";

test("room heating compares the same useful output with official example performance", () => {
  const example = usefulEnergyExample("room-heating");
  assert.equal(example.label, "Room heating · 5 hours");
  assert.match(example.description, /five-hour example.*2 kW.*10 kWh/);
  assert.equal(example.costBasisLabel, "Illustrative five-hour cost at the 24-hour average");
  assert.equal(example.options[0].inputKwh, 10);
  assert.equal(Number(example.options[1].inputKwh.toFixed(3)), 2.703);
  assert.equal(Number(example.options[2].inputKwh.toFixed(3)), 11.765);
  assert.deepEqual(example.options.filter(({ lowestEnergyUse }) => lowestEnergyUse).map(({ id }) => id), ["reverse-cycle"]);
  assert.equal(purchasedEnergyReductionPercent(example.options[1].inputKwh, example.options[2].inputKwh), 77);
  assert.equal(wholesaleInputCostCents(example.options[0].inputKwh, 10), 100);
  assert.equal(Number(wholesaleInputCostCents(example.options[1].inputKwh, 10).toFixed(2)), 27.03);
  assert.equal(Number(wholesaleInputCostCents(example.options[2].inputKwh, 3.6).toFixed(2)), 42.35);
});

test("hot water retains the official 300 litre worked example inputs", () => {
  const example = usefulEnergyExample("hot-water");
  assert.equal(example.label, "Hot water · full tank");
  assert.match(example.description, /whole heating task, not a fixed number of running hours/);
  assert.deepEqual(example.options.map(({ inputKwh }) => inputKwh), [14, 4.7, 16.5]);
  assert.deepEqual(example.options.map(({ fuel }) => fuel), ["electricity", "electricity", "gas"]);
  assert.deepEqual(example.options.filter(({ lowestEnergyUse }) => lowestEnergyUse).map(({ id }) => id), ["heat-pump-water-heater"]);
  assert.equal(purchasedEnergyReductionPercent(example.options[1].inputKwh, example.options[2].inputKwh), 72);
  assert.equal(wholesaleInputCostCents(14, 10), 140);
  assert.equal(wholesaleInputCostCents(4.7, 10), 47);
  assert.equal(wholesaleInputCostCents(16.5, 3.6), 59.4);
  assert.equal(USEFUL_ENERGY_EXAMPLES.length, 2);
});

test("postcode climate bands update transparent planning inputs without changing useful output", () => {
  const hotRoom = usefulEnergyExample("room-heating", "hot");
  const coldRoom = usefulEnergyExample("room-heating", "cold");
  assert.equal(hotRoom.climateBand, "hot");
  assert.equal(hotRoom.heatPumpCop, 4.7);
  assert.equal(coldRoom.heatPumpCop, 3.7);
  assert.ok(hotRoom.options[1].inputKwh < coldRoom.options[1].inputKwh);
  assert.equal(hotRoom.options[0].inputKwh, coldRoom.options[0].inputKwh);
  assert.equal(hotRoom.options[2].inputKwh, coldRoom.options[2].inputKwh);

  const hotWater = usefulEnergyExample("hot-water", "hot");
  const averageWater = usefulEnergyExample("hot-water", "average");
  const coldWater = usefulEnergyExample("hot-water", "cold");
  assert.deepEqual([hotWater.heatPumpCop, averageWater.heatPumpCop, coldWater.heatPumpCop], [4, 3.5, 3]);
  assert.deepEqual([hotWater.options[1].inputKwh, averageWater.options[1].inputKwh, coldWater.options[1].inputKwh], [3.5, 4, 4.7]);
  assert.deepEqual(hotWater.options.filter(({ id }) => id !== "heat-pump-water-heater").map(({ inputKwh }) => inputKwh), [14, 16.5]);
});

test("wholesale cost preserves missing and negative market readings", () => {
  assert.equal(wholesaleInputCostCents(5, null), null);
  assert.equal(wholesaleInputCostCents(5, -2), -10);
  assert.throws(() => wholesaleInputCostCents(-1, 10), /non-negative/);
  assert.throws(() => wholesaleInputCostCents(1, Number.NaN), /finite or null/);
});

test("purchased energy reduction rejects invalid inputs", () => {
  assert.throws(() => purchasedEnergyReductionPercent(-1, 5), /non-negative/);
  assert.throws(() => purchasedEnergyReductionPercent(Number.NaN, 5), /non-negative/);
  assert.throws(() => purchasedEnergyReductionPercent(1, 0), /above zero/);
  assert.throws(() => purchasedEnergyReductionPercent(1, Number.POSITIVE_INFINITY), /above zero/);
});

test("24-hour price snapshots average available finite readings without inventing gaps", () => {
  assert.equal(averageAvailablePriceCentsPerKwh([1, null, 3]), 2);
  assert.equal(averageAvailablePriceCentsPerKwh([null, null]), null);
  assert.throws(() => averageAvailablePriceCentsPerKwh([1, Number.NaN]), /finite or null/);
});
