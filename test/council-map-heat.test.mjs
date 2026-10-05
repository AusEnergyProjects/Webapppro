import test from "node:test";
import assert from "node:assert/strict";
import { councilMapHeat, createCouncilMapHeatScale, COUNCIL_MAP_HEAT_GRADIENT } from "../src/lib/council-map-heat.ts";

const colours = ["rgb(37, 99, 235)", "rgb(6, 182, 212)", "rgb(250, 204, 21)", "rgb(249, 115, 22)", "rgb(220, 38, 38)"];

test("skewed reporting values use all five occupied colour bands with exact observed ranges", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 500, 80000];
  const scale = createCouncilMapHeatScale(values);
  assert.equal(scale.positiveCount, 10);
  assert.deepEqual(scale.bands.map(({ lower, upper, minimum, count }) => ({ lower, upper, minimum, count })), [
    { lower: 0, upper: 2, minimum: 1, count: 2 },
    { lower: 2, upper: 4, minimum: 3, count: 2 },
    { lower: 4, upper: 6, minimum: 5, count: 2 },
    { lower: 6, upper: 8, minimum: 7, count: 2 },
    { lower: 8, upper: 80000, minimum: 500, count: 2 },
  ]);
  scale.bands.forEach((band, index) => {
    assert.equal(band.color, colours[index]);
    assert.deepEqual(councilMapHeat(band.minimum, scale), { color: band.color, ratio: index / 4 });
    assert.deepEqual(councilMapHeat(band.upper, scale), { color: band.color, ratio: index / 4 });
  });
  assert.equal(councilMapHeat(7, scale).color, colours[3], "Low absolute counts still reveal their relative position in a skewed distribution");
  assert.equal(councilMapHeat(80000, scale).color, colours[4]);
});

test("quantile boundaries do not split ties or create empty legend bands", () => {
  const values = [1, 1, 1, 1, 1, 1, 2, 3, 4, 5];
  const scale = createCouncilMapHeatScale(values);
  assert.deepEqual(scale.bands.map(band => [band.minimum, band.upper, band.count]), [[1, 1, 6], [2, 3, 2], [4, 5, 2]]);
  assert.deepEqual(scale.bands.map(band => band.color), [colours[0], colours[2], colours[4]]);
  assert.equal(scale.bands.reduce((count, band) => count + band.count, 0), values.length);
  assert.ok(values.filter(value => value === 1).every(value => councilMapHeat(value, scale).color === colours[0]));
  assert.deepEqual(createCouncilMapHeatScale([...values].reverse()), scale, "Input order cannot affect ties or legend ranges");
});

test("small and uniform positive datasets show only supported ranges", () => {
  assert.deepEqual(createCouncilMapHeatScale([7, 7, 7]).bands, [
    { lower: 0, upper: 7, minimum: 7, count: 3, color: colours[2], ratio: 0.5 },
  ]);
  const two = createCouncilMapHeatScale([1, 80000]);
  assert.deepEqual(two.bands.map(band => [band.minimum, band.upper, band.color]), [[1, 1, colours[0]], [80000, 80000, colours[4]]]);
  assert.deepEqual(createCouncilMapHeatScale([3]).bands.map(band => [band.minimum, band.upper, band.color]), [[3, 3, colours[2]]]);
});

test("zero and unavailable values do not distort positive quantiles or merge into one state", () => {
  const valid = [1, 2, 3, 4, 5], invalid = [null, NaN, Infinity, -Infinity, -1];
  const values = [...Array(20).fill(0), ...valid, ...invalid];
  const scale = createCouncilMapHeatScale(values);
  assert.deepEqual(scale.bands, createCouncilMapHeatScale(valid).bands);
  assert.equal(scale.zeroCount, 20);
  assert.equal(scale.positiveCount, 5);
  assert.equal(scale.unavailableCount, invalid.length);
  assert.deepEqual(councilMapHeat(0, scale), { color: colours[0], ratio: 0 });
  for (const value of invalid) assert.equal(councilMapHeat(value, scale), null);
  assert.deepEqual(createCouncilMapHeatScale([0, 0, null]), { bands: [], positiveCount: 0, zeroCount: 2, unavailableCount: 1 });
  assert.deepEqual(createCouncilMapHeatScale([]), { bands: [], positiveCount: 0, zeroCount: 0, unavailableCount: 0 });
  assert.equal(councilMapHeat(1, createCouncilMapHeatScale([0, null])), null);
});

test("classification boundaries are lower-exclusive and upper-inclusive even for decimals", () => {
  const scale = createCouncilMapHeatScale([0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.equal(councilMapHeat(0.1, scale).color, colours[0]);
  assert.equal(councilMapHeat(0.100000000000001, scale).color, colours[1]);
  assert.equal(councilMapHeat(0.2, scale).color, colours[1]);
  assert.equal(councilMapHeat(0.200000000000001, scale).color, colours[2]);
  assert.equal(councilMapHeat(0.5, scale).color, colours[4]);
  assert.equal(councilMapHeat(0.500000000000001, scale), null, "An unrepresented value must not silently exceed its legend range");
  const extreme = createCouncilMapHeatScale([Number.MIN_VALUE, Number.MAX_VALUE]);
  assert.deepEqual(councilMapHeat(Number.MIN_VALUE, extreme), { color: colours[0], ratio: 0 });
  assert.deepEqual(councilMapHeat(Number.MAX_VALUE, extreme), { color: colours[4], ratio: 1 });
});

test("the complete reporting distribution stays reusable as the visible subset changes", () => {
  const allReportingValues = Object.freeze([1, 5, 8, 12, 18, 25, 42, 75, 100, 9000]);
  const scale = createCouncilMapHeatScale(allReportingValues);
  const original = structuredClone(scale);
  const visibleFirst = [1, 8, 18], visibleSecond = [18, 75, 9000];
  const first = visibleFirst.map(value => councilMapHeat(value, scale));
  const second = visibleSecond.map(value => councilMapHeat(value, scale));
  assert.deepEqual(first[2], second[0], "The same postcode keeps its colour after panning");
  assert.deepEqual(scale, original);
  const rescaled = createCouncilMapHeatScale(allReportingValues.map(value => value * 100));
  allReportingValues.forEach(value => assert.deepEqual(councilMapHeat(value, scale), councilMapHeat(value * 100, rescaled)));
});

test("the palette preview uses discrete colour swatches rather than a false linear numeric legend", () => {
  colours.forEach((colour, index) => assert.ok(COUNCIL_MAP_HEAT_GRADIENT.includes(`${colour} ${index * 20}%, ${colour} ${(index + 1) * 20}%`)));
});
