import test from "node:test";
import assert from "node:assert/strict";
import { australianStateLabel, canonicalAustralianState, postcodeMatchesState, residentialStateFromPostcode } from "../src/lib/australian-postcodes.mjs";

test("residential postcodes identify the usual state or territory", () => {
  assert.equal(residentialStateFromPostcode("2600"), "ACT");
  assert.equal(residentialStateFromPostcode("2000"), "NSW");
  assert.equal(residentialStateFromPostcode("0800"), "NT");
  assert.equal(residentialStateFromPostcode("3000"), "VIC");
  assert.equal(residentialStateFromPostcode("4000"), "QLD");
  assert.equal(residentialStateFromPostcode("5000"), "SA");
  assert.equal(residentialStateFromPostcode("6000"), "WA");
  assert.equal(residentialStateFromPostcode("7000"), "TAS");
  assert.equal(residentialStateFromPostcode("not-a-postcode"), null);
});

test("state aliases compare consistently without rejecting unknown ranges", () => {
  assert.equal(canonicalAustralianState("Vic"), "VIC");
  assert.equal(canonicalAustralianState("qld"), "QLD");
  assert.equal(postcodeMatchesState("3000", "Vic"), true);
  assert.equal(postcodeMatchesState("3000", "NSW"), false);
  assert.equal(postcodeMatchesState("0000", "NT"), true);
  assert.equal(australianStateLabel("VIC"), "Victoria");
});
