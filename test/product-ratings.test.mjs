import assert from "node:assert/strict";
import test from "node:test";
import { calculateProductRating, productRatingMethods, publicProductRating } from "../src/lib/product-ratings.ts";

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
    ["batteries", 1, { unit: "nominal-kwh" }],
    ["air-conditioning", 1, { basisId: "hot-climate-cooling-stars" }],
    ["hot-water", 1, { basisId: "daily-delivered-hot-water" }],
    ["multi-split", 1, { basisId: "sum-indoor-capacities" }],
    ["inverters", 1, { unit: "weighted-efficiency-percent" }],
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
    const capacityCategories = ["batteries", "hot-water", "multi-split"];
    assert.deepEqual(methods.map(method => method.id), ["cost", capacityCategories.includes(category) ? "capacity" : "efficiency", "warranty"]);
    assert.equal(methods[0].label, "Cost level");
    assert.equal(methods[2].label, "Parts warranty");
    assert.ok(methods.every(method => method.maximum > 0));
    const warranty = methods[2];
    assert.equal(warranty.basisId, "main-product-parts");
    assert.equal(calculateProductRating(warranty, measurement(warranty, warranty.maximum)).score, 5);
    assert.match(methods[0].explanation, /More bars means higher equipment cost/);
  }
  assert.throws(() => productRatingMethods("unknown"), /Unknown product rating category/);
});

test("main-product warranty never substitutes accessory cover or an output guarantee", () => {
  const method = productRatingMethods("inverters")[2];
  assert.equal(calculateProductRating(method, measurement(method, 10)).score, 3.3);
  assert.equal(calculateProductRating(method, measurement(method, 2, { basisId: "included-all-parts" })).score, null);
  assert.equal(calculateProductRating(method, measurement(method, 25, { basisId: "output-guarantee" })).score, null);
  assert.match(method.explanation, /paid extensions are excluded/);
});

test("capacity bars use actual published storage, tank volume or simultaneous output", () => {
  for (const [slug, unit, basisId, value, score] of [["batteries", "usable-kwh", "battery-usable-storage", 20, 2.5], ["hot-water", "tank-litres", "hot-water-tank-volume", 300, 3.8], ["multi-split", "cooling-kw", "multi-split-rated-cooling", 10, 2.5]]) {
    const method = productRatingMethods(slug)[1];
    assert.equal(method.unit, unit);
    assert.equal(method.basisId, basisId);
    assert.equal(calculateProductRating(method, measurement(method, value)).score, score);
  }
});

test("public cost bars retain research provenance without serializing money or pricing basis", () => {
  for (const slug of ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split", "ev-chargers"]) {
    const method = productRatingMethods(slug)[0];
    const privateMeasurement = measurement(method, method.maximum / 2, { basis: "Retail price A$1234.56 including GST; private equipment research" });
    const raw = calculateProductRating(method, privateMeasurement);
    const publicRating = publicProductRating(raw);
    assert.equal(raw.measurement, privateMeasurement, "source calculation remains inspectable on the server");
    assert.equal(publicRating.score, 2.5);
    assert.equal(publicRating.measurement, null);
    assert.deepEqual(publicRating.costEvidence, { variant: privateMeasurement.variant, sourceUrl: privateMeasurement.sourceUrl, checkedAt: privateMeasurement.checkedAt });
    assert.doesNotMatch(JSON.stringify(publicRating), /1234\.56|aud-|Retail price|\$/);
    assert.doesNotMatch(method.explanation, /\$|AUD\s*\d/);
    assert.equal(publicProductRating(calculateProductRating(method, null)).score, null);
    assert.equal(publicProductRating(calculateProductRating(method, null)).costEvidence, undefined);
  }
  const method = productRatingMethods("inverters")[1];
  const efficiency = calculateProductRating(method, measurement(method, 97.35));
  assert.equal(publicProductRating(efficiency), efficiency);
});

test("EV charger bars compare rated AC power rather than inventing an efficiency figure", () => {
  const methods = productRatingMethods("ev-chargers");
  assert.deepEqual(methods.map(method => method.id), ["cost", "chargingPower", "warranty"]);
  assert.equal(methods[1].label, "Charging power");
  assert.deepEqual([7, 11, 22].map(value => calculateProductRating(methods[1], measurement(methods[1], value)).score), [1.6, 2.5, 5]);
  assert.equal(calculateProductRating(methods[1], measurement(methods[1], 22, { basisId: "ev-dc-output" })).score, null);
  assert.match(methods[1].explanation, /car's onboard charger.*limit actual speed/);
});

test("same-range cost references remain explicitly identified and cannot stand in for performance figures", () => {
  const cost = productRatingMethods("solar")[0];
  const figure = measurement(cost, 0.4, { variant: "Current range 470 W reference", referenceFor: "Current range 475 W" });
  const publicRating = publicProductRating(calculateProductRating(cost, figure));
  assert.equal(publicRating.score, 2);
  assert.equal(publicRating.measurement, null);
  assert.equal(publicRating.costEvidence.referenceFor, "Current range 475 W");
  assert.equal(publicRating.costEvidence.variant, "Current range 470 W reference");
  assert.throws(() => calculateProductRating(cost, { ...figure, referenceFor: " " }), /Invalid/);
  const efficiency = productRatingMethods("solar")[1];
  assert.throws(() => calculateProductRating(efficiency, measurement(efficiency, 23, { referenceFor: "Different size" })), /Invalid/);
});

test("published approximate cost guides stay identifiable without exposing their price", () => {
  const cost = productRatingMethods("solar")[0];
  const figure = measurement(cost, 0.33, { priceEvidence: "published-guide" });
  const publicRating = publicProductRating(calculateProductRating(cost, figure));
  assert.equal(publicRating.costEvidence.priceEvidence, "published-guide");
  assert.equal(publicRating.measurement, null);
  assert.equal(Object.hasOwn(publicRating.costEvidence, "value"), false);
  assert.throws(() => calculateProductRating(cost, { ...figure, priceEvidence: "guessed" }), /Invalid/);
  const efficiency = productRatingMethods("solar")[1];
  assert.throws(() => calculateProductRating(efficiency, measurement(efficiency, 23, { priceEvidence: "published-guide" })), /Invalid/);
});

test("unavailable figures retain a reviewed explanation and cannot coexist with a measurement", () => {
  const method = productRatingMethods("batteries")[2];
  const gap = { reason: "Current Australian policy does not name this model", sourceUrl: "https://example.com/au-policy.pdf" };
  const rating = calculateProductRating(method, null, gap);
  assert.equal(rating.score, null);
  assert.equal(rating.reason, gap.reason);
  assert.deepEqual(rating.unavailableEvidence, gap);
  assert.throws(() => calculateProductRating(method, measurement(method, 10), gap), /Invalid/);
  assert.throws(() => calculateProductRating(method, null, { ...gap, sourceUrl: "http://example.com" }), /Invalid/);
});
