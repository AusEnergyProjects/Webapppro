import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  ENERGY_RATING_CLIMATE_SOURCE,
  energyRatingClimateBandForPostcode,
  energyRatingClimateForPostcode,
} from "../src/lib/energy-rating-climate.mjs";

const artifactBytes = fs.readFileSync(new URL("../src/data/energy-rating-climate-zones.json", import.meta.url));
const artifact = JSON.parse(artifactBytes.toString("utf8"));

test("the official postcode-band snapshot has pinned provenance and valid records", () => {
  assert.equal(createHash("sha256").update(artifactBytes).digest("hex"), "af96d0a5a8a63df35d547f32dc2c3c845e45dd94f3fda5bfd3429c30dcffd1f5");
  assert.equal(Object.keys(artifact.zones).length, 2_612);
  assert.equal(artifact.retrievedAt, "2026-09-03T23:55:50Z");
  for (const [postcode, record] of Object.entries(artifact.zones)) {
    assert.match(postcode, /^\d{4}$/);
    assert.ok(["hot", "average", "cold"].includes(record.band));
    assert.ok(Array.isArray(record.choices) && record.choices.includes(record.band));
  }
});

test("official calculator bands resolve hot, average and cold postcodes", () => {
  assert.equal(energyRatingClimateBandForPostcode("4000"), "hot");
  assert.equal(energyRatingClimateBandForPostcode("2000"), "average");
  assert.equal(energyRatingClimateBandForPostcode("3000"), "cold");
  assert.equal(ENERGY_RATING_CLIMATE_SOURCE.sourceUrl, "https://calculator.energyrating.gov.au/ClimatePopupForAC.aspx?goPageName=Home");
});

test("postcodes spanning label bands preserve the calculator default and every choice", () => {
  assert.deepEqual(energyRatingClimateForPostcode("2150"), {
    band: "average",
    choices: ["hot", "cold", "average"],
    hasMultipleBands: true,
  });
});

test("climate lookup fails closed for malformed or unmapped postcodes", () => {
  for (const postcode of ["", "300", "30000", "abcd", "9999"]) {
    assert.equal(energyRatingClimateForPostcode(postcode), null);
  }
});
