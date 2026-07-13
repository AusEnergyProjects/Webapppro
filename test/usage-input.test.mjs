import test from "node:test";
import assert from "node:assert/strict";
import { annualiseUsage, usageForPeriod } from "../src/lib/electricity/usage-input.ts";

test("bill usage periods convert to the same canonical annual kWh", () => {
  assert.equal(annualiseUsage(1250, "quarterly"), 5000);
  assert.equal(annualiseUsage(5000 / 12, "monthly"), 5000);
  assert.equal(annualiseUsage(5000, "annual"), 5000);
});

test("canonical annual kWh is displayed in the selected bill period", () => {
  assert.equal(usageForPeriod("5000", "quarterly"), "1250");
  assert.equal(usageForPeriod("5000", "monthly"), "416.67");
  assert.equal(usageForPeriod("5000", "annual"), "5000");
  assert.equal(usageForPeriod("", "quarterly"), "");
});

