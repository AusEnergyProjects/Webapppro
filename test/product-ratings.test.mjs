import assert from "node:assert/strict";
import test from "node:test";
import * as ratingExports from "../src/lib/product-ratings.ts";
const { calculateProductRating, productRatingMethods } = ratingExports;

function measurement(method, value, overrides = {}) {
  return { value, unit: method.unit, basisId: method.basisId, variant: "Exact AU model", basis: "Comparable published test or main-product warranty", sourceUrl: "https://example.com/official-model", checkedAt: "2026-10-10", ...overrides };
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
  const figures = [5, 12.5, 12.5, 25, 30].map(value => measurement(method, value));
  assert.deepEqual(figures.map(value => calculateProductRating(method, value).score), [1, 2.5, 2.5, 5, 5]);
  assert.equal(calculateProductRating(method, figures[1]).score, 2.5);
  const conversion = productRatingMethods("inverters")[0];
  assert.deepEqual([97, 98].map(value => calculateProductRating(conversion, measurement(conversion, value)).score), [4.9, 4.9], "tiny conversion differences must not become exaggerated ranking differences");
});

test("different capacity, climate, efficiency and warranty measures are never silently substituted", () => {
  for (const [category, index, override] of [
    ["batteries", 0, { unit: "nominal-kwh" }],
    ["air-conditioning", 0, { basisId: "hot-climate-cooling-stars" }],
    ["hot-water", 0, { basisId: "daily-delivered-hot-water" }],
    ["multi-split", 0, { basisId: "sum-indoor-capacities" }],
    ["inverters", 0, { unit: "weighted-efficiency-percent" }],
    ["inverters", 0, { basisId: "inverter-cec-weighted" }],
    ["solar", 1, { basisId: "panel-output-guarantee" }],
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
  const method = productRatingMethods("solar")[0];
  for (const override of [{ value: NaN }, { value: Infinity }, { value: -1 }, { variant: " " }, { basis: "" }, { sourceUrl: "http://example.com/spec" }]) {
    assert.throws(() => calculateProductRating(method, measurement(method, 23, override)), /Invalid efficiency product measurement/);
  }
});

test("equipment categories use consistent measures and reject unknown category methods", () => {
  for (const category of ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split"]) {
    const methods = productRatingMethods(category);
    const capacityCategories = ["batteries", "hot-water", "multi-split"];
    assert.deepEqual(methods.map(method => method.id), [capacityCategories.includes(category) ? "capacity" : "efficiency", "warranty", ...(category === "hot-water" ? ["noise", "recovery"] : [])]);
    assert.equal(methods[1].label, "Parts warranty");
    assert.ok(methods.every(method => method.maximum > 0));
    const warranty = methods[1];
    assert.equal(warranty.basisId, "main-product-parts");
    assert.equal(calculateProductRating(warranty, measurement(warranty, warranty.maximum)).score, 5);
    assert.doesNotMatch(JSON.stringify(methods), /Cost level|equipment cost|aud-|price|referenceFor/i);
  }
  assert.throws(() => productRatingMethods("unknown"), /Unknown product rating category/);
});

test("main-product warranty never substitutes accessory cover or an output guarantee", () => {
  const method = productRatingMethods("inverters")[1];
  assert.equal(calculateProductRating(method, measurement(method, 10)).score, 3.3);
  assert.equal(calculateProductRating(method, measurement(method, 2, { basisId: "included-all-parts" })).score, null);
  assert.equal(calculateProductRating(method, measurement(method, 25, { basisId: "output-guarantee" })).score, null);
  assert.match(method.explanation, /paid extensions are excluded/);
});

test("capacity bars use actual published storage, tank volume or simultaneous output", () => {
  for (const [slug, unit, basisId, value, score] of [["batteries", "usable-kwh", "battery-usable-storage", 20, 2.5], ["hot-water", "tank-litres", "hot-water-tank-volume", 300, 3.8], ["multi-split", "cooling-kw", "multi-split-rated-cooling", 10, 2.5]]) {
    const method = productRatingMethods(slug)[0];
    assert.equal(method.unit, unit);
    assert.equal(method.basisId, basisId);
    assert.equal(calculateProductRating(method, measurement(method, value)).score, score);
  }
});

test("all catalogue methods and rating payloads omit cost and its obsolete public projection", () => {
  for (const slug of ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split", "ev-chargers"]) {
    const methods = productRatingMethods(slug);
    assert.equal(methods.length, slug === "hot-water" ? 4 : 2);
    assert.ok(methods.every(method => method.id !== "cost"));
    for (const method of methods) {
      const midpoint = method.direction === "lower" ? ((method.minimum ?? 0) + method.maximum) / 2 : method.maximum / 2;
      const known = calculateProductRating(method, measurement(method, midpoint));
      assert.equal(known.score, 2.5);
      assert.equal(Object.hasOwn(known, "costEvidence"), false);
      assert.equal(Object.hasOwn(calculateProductRating(method, null), "costEvidence"), false);
      assert.doesNotMatch(JSON.stringify(known), /aud-|referenceFor|priceEvidence|costEvidence/);
    }
  }
  assert.equal(Object.hasOwn(ratingExports, "publicProductRating"), false);
});

test("noise bars favour quieter readings and never turn a missing reading into a quiet score", () => {
  const method = productRatingMethods("hot-water").find(method => method.id === "noise");
  assert.equal(method.unit, "published-noise-db");
  assert.equal(method.direction, "lower");
  assert.deepEqual([25, 35, 45, 50, 55, 65, 75].map(value => calculateProductRating(method, measurement(method, value)).score), [5, 5, 3.3, 2.5, 1.7, 0, 0]);
  assert.equal(calculateProductRating(method, null).score, null);
  assert.match(method.explanation, /More bars means quieter/);
});

test("reheating bars use litres per hour and the slower end of a source range", () => {
  const method = productRatingMethods("hot-water").find(method => method.id === "recovery");
  assert.equal(method.unit, "recovery-litres-per-hour");
  assert.equal(calculateProductRating(method, measurement(method, 50, { valueMaximum: 60 })).score, 1.7);
  assert.equal(calculateProductRating(method, measurement(method, 150)).score, 5);
  assert.equal(calculateProductRating(method, null).score, null);
  assert.equal(calculateProductRating(method, measurement(method, 75, { unit: "minutes-per-100-litres" })).score, null);
  for (const valueMaximum of [49, NaN, Infinity]) {
    assert.throws(() => calculateProductRating(method, measurement(method, 50, { valueMaximum })), /Invalid recovery/);
  }
});

test("EV charger bars compare rated AC power rather than inventing an efficiency figure", () => {
  const methods = productRatingMethods("ev-chargers");
  assert.deepEqual(methods.map(method => method.id), ["chargingPower", "warranty"]);
  assert.equal(methods[0].label, "Charging power");
  assert.deepEqual([7, 11, 22].map(value => calculateProductRating(methods[0], measurement(methods[0], value)).score), [1.6, 2.5, 5]);
  assert.equal(calculateProductRating(methods[0], measurement(methods[0], 22, { basisId: "ev-dc-output" })).score, null);
  assert.match(methods[0].explanation, /car's onboard charger.*limit actual speed/);
});

test("unavailable figures retain a reviewed explanation and cannot coexist with a measurement", () => {
  const method = productRatingMethods("batteries")[1];
  const gap = { reason: "Current Australian policy does not name this model", sourceUrl: "https://example.com/au-policy.pdf" };
  const rating = calculateProductRating(method, null, gap);
  assert.equal(rating.score, null);
  assert.equal(rating.reason, gap.reason);
  assert.deepEqual(rating.unavailableEvidence, gap);
  assert.throws(() => calculateProductRating(method, measurement(method, 10), gap), /Invalid/);
  assert.throws(() => calculateProductRating(method, null, { ...gap, sourceUrl: "http://example.com" }), /Invalid/);
});
