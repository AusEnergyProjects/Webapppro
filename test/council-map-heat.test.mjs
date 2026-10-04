import test from "node:test";
import assert from "node:assert/strict";
import { councilMapHeat, COUNCIL_MAP_HEAT_GRADIENT } from "../src/lib/council-map-heat.ts";

test("map heat progresses from blue through cyan, yellow and orange to red", () => {
  const expected = ["rgb(37, 99, 235)", "rgb(6, 182, 212)", "rgb(250, 204, 21)", "rgb(249, 115, 22)", "rgb(220, 38, 38)"];
  const values = [0, 250, 500, 750, 1000];
  values.forEach((value, index) => {
    assert.deepEqual(councilMapHeat(value, 1000), { color: expected[index], ratio: value / 1000 });
    assert.ok(COUNCIL_MAP_HEAT_GRADIENT.includes(`${expected[index]} ${index * 25}%`), "Legend must share each rendered colour and position");
  });
});

test("counts use a linear scale with interpolated colours between legend stops", () => {
  const low = councilMapHeat(100, 1000);
  const high = councilMapHeat(200, 1000);
  assert.equal(low.ratio, 0.1);
  assert.equal(high.ratio, 0.2);
  assert.notEqual(low.color, high.color);
  assert.deepEqual(councilMapHeat(125, 1000), { color: "rgb(22, 141, 224)", ratio: 0.125 });
  assert.deepEqual(councilMapHeat(1.25, 10), councilMapHeat(125, 1000), "Scaling the unit must preserve the heat colour");
});

test("unknown and invalid inputs do not become a zero or a heat mark", () => {
  for (const value of [null, NaN, Infinity, -Infinity, -1]) assert.equal(councilMapHeat(value, 100), null);
  for (const maximum of [NaN, Infinity, -Infinity, -1]) assert.equal(councilMapHeat(0, maximum), null);
  assert.notEqual(councilMapHeat(0, 100), null);
});

test("all-zero data is blue and out-of-scale values remain finite and capped", () => {
  assert.deepEqual(councilMapHeat(0, 0), { color: "rgb(37, 99, 235)", ratio: 0 });
  assert.deepEqual(councilMapHeat(20, 10), councilMapHeat(10, 10));
  assert.deepEqual(councilMapHeat(1, 0), councilMapHeat(1, 1));
  assert.deepEqual(councilMapHeat(Number.MAX_VALUE, Number.MIN_VALUE), councilMapHeat(1, 1));
});
