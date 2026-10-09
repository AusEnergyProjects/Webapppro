import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { solarClimateForPostcode, solarYieldForPostcode, suggestedSolarSize } from "../src/lib/electricity/energy-flow.ts";

const read = name => fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url));
const estimates = JSON.parse(read("postcode-solar-estimates.json"));
const source = JSON.parse(read("postcode-solar-estimates.source.json"));
const centroids = JSON.parse(read("postcode-centroids.json"));

test("the PVGIS snapshot covers the source postcode centres with usable generated-energy values", () => {
  assert.equal(source.coverage, 2640);
  assert.equal(source.period, "2005-2023");
  assert.equal(source.units, "kWh per installed kWp per year");
  assert.match(source.source, /PVGIS53_annual_yield_optimal_era5_2005_2023\.tif$/);
  assert.equal(source.centroidsSha256, createHash("sha256").update(read("postcode-centroids.json")).digest("hex"));
  assert.deepEqual(Object.keys(estimates).sort(), Object.keys(centroids).sort());
  for (const value of Object.values(estimates)) assert.ok(Number.isInteger(value) && value >= 500 && value <= 3000);
});

test("local solar generation differs within a state and drives suggested sizing", () => {
  assert.equal(solarYieldForPostcode("3000"), 1462);
  assert.equal(solarYieldForPostcode("3500"), 1662);
  assert.equal(solarClimateForPostcode("3000").source, "pvgis-local");
  assert.equal(solarYieldForPostcode("800"), solarYieldForPostcode("0800"));
  assert.equal(suggestedSolarSize(6400, "3000"), 5);
  assert.equal(suggestedSolarSize(6400, "3500"), 4);
});

test("uncovered postcodes use a labelled broad estimate instead of claiming local precision", () => {
  assert.deepEqual(solarClimateForPostcode("3999"), { annualKwhPerKw: 1250, source: "regional" });
  assert.deepEqual(solarClimateForPostcode("9999"), { annualKwhPerKw: 1350, source: "regional" });
});
