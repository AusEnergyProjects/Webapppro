import assert from "node:assert/strict";
import test from "node:test";
import { calculateProductRating, productRatingMethods } from "../src/lib/product-ratings.ts";

function measurement(method, value, overrides = {}) {
  return { value, unit: method.unit, basisId: method.basisId, variant: "Exact AU model", basis: "Comparable test or complete equipment package", sourceUrl: "https://example.com/official-model", checkedAt: "2026-10-10", ...overrides };
}

test("unavailable figures stay unknown, while an actual zero remains zero", () => {
  const method = productRatingMethods("solar")[0];
  for (const absent of [null, undefined]) {
    const result = calculateProductRating(method, absent);
    assert.equal(result.score, null);
    assert.equal(result.measurement, null);
    assert.equal(result.reason, "No comparable published figure");
  }
  assert.equal(calculateProductRating(method, measurement(method, 0)).score, 0);
});

test("fixed rulers preserve differences, ties and scores when the catalogue changes", () => {
  const method = productRatingMethods("solar")[0];
  const figures = [0.2, 0.5, 0.5, 1, 2].map(value => measurement(method, value));
  assert.deepEqual(figures.map(value => calculateProductRating(method, value).score), [1, 2.5, 2.5, 5, 5]);
  assert.equal(calculateProductRating(method, figures[1]).score, 2.5);
  const conversion = productRatingMethods("inverters")[1];
  assert.deepEqual([97, 98].map(value => calculateProductRating(conversion, measurement(conversion, value)).score), [4.9, 4.9], "tiny conversion differences must not become exaggerated ranking differences");
});

test("different price packages, climates and efficiency methods are never silently substituted", () => {
  for (const [category, index, override] of [
    ["batteries", 0, { basisId: "battery-module-after-rebate" }],
    ["batteries", 1, { unit: "dc-round-trip-percent" }],
    ["air-conditioning", 1, { basisId: "hot-climate-cooling-stars" }],
    ["hot-water", 1, { basisId: "cop-a32-w15-55" }],
    ["inverters", 1, { unit: "peak-efficiency-percent" }],
    ["inverters", 1, { basisId: "inverter-cec-weighted" }],
    ["solar", 2, { basisId: "panel-output-guarantee" }],
  ]) {
    const method = productRatingMethods(category)[index];
    const figure = measurement(method, 4, override);
    const result = calculateProductRating(method, figure);
    assert.equal(result.score, null);
    assert.equal(result.measurement, figure, "the different figure remains inspectable in Specs");
    assert.equal(result.reason, "Different measurement or package basis");
  }
});

test("invalid measured values and missing model or source evidence are rejected", () => {
  const method = productRatingMethods("solar")[1];
  for (const override of [{ value: NaN }, { value: Infinity }, { value: -1 }, { variant: " " }, { basis: "" }, { sourceUrl: "http://example.com/spec" }]) {
    assert.throws(() => calculateProductRating(method, measurement(method, 23, override)), /Invalid efficiency product measurement/);
  }
});

test("equipment categories use consistent measures and reject unknown category methods", () => {
  for (const category of ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split"]) {
    const methods = productRatingMethods(category);
    assert.deepEqual(methods.map(method => method.id), ["cost", "efficiency", "warranty"]);
    assert.deepEqual(methods.map(method => method.label), ["Cost level", "Energy efficiency", "Parts warranty"]);
    assert.ok(methods.every(method => method.maximum > 0));
    const warranty = methods[2];
    assert.equal(calculateProductRating(warranty, measurement(warranty, warranty.maximum)).score, 5);
    assert.match(methods[0].explanation, /More bars means higher equipment cost/);
  }
  assert.throws(() => productRatingMethods("unknown"), /Unknown product rating category/);
});

test("EV charger bars compare rated AC power rather than inventing an efficiency figure", () => {
  const methods = productRatingMethods("ev-chargers");
  assert.deepEqual(methods.map(method => method.id), ["cost", "chargingPower", "warranty"]);
  assert.equal(methods[1].label, "Charging power");
  assert.deepEqual([7, 11, 22].map(value => calculateProductRating(methods[1], measurement(methods[1], value)).score), [1.6, 2.5, 5]);
  assert.equal(calculateProductRating(methods[1], measurement(methods[1], 22, { basisId: "ev-dc-output" })).score, null);
  assert.match(methods[1].explanation, /car's onboard charger.*limit actual speed/);
});
