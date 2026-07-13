import test from "node:test";
import assert from "node:assert/strict";
import { annualiseGasUsage } from "../src/lib/gas-usage-input.ts";

test("annual gas input is retained without conversion", () => {
  assert.deepEqual(annualiseGasUsage({ usageMj: 58000, mode: "annual", profile: "heating" }), {
    ok: true, annualMj: 58000, billDays: null, profileShare: 1,
  });
});

test("steady bill usage is annualised by the exact bill dates", () => {
  const result = annualiseGasUsage({ usageMj: 3100, mode: "bill", profile: "steady", billStart: "2026-03-01", billEnd: "2026-03-31" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.billDays, 31);
    assert.ok(Math.abs(result.annualMj - 36500) < 1);
  }
});

test("heating profile recognises that winter bills represent a larger annual share", () => {
  const heating = annualiseGasUsage({ usageMj: 10000, mode: "bill", profile: "heating", billStart: "2026-07-01", billEnd: "2026-07-31" });
  const steady = annualiseGasUsage({ usageMj: 10000, mode: "bill", profile: "steady", billStart: "2026-07-01", billEnd: "2026-07-31" });
  assert.equal(heating.ok, true);
  assert.equal(steady.ok, true);
  if (heating.ok && steady.ok) assert.ok(heating.annualMj < steady.annualMj);
});

test("heating profile recognises that summer bills represent a smaller annual share", () => {
  const heating = annualiseGasUsage({ usageMj: 3000, mode: "bill", profile: "heating", billStart: "2026-01-01", billEnd: "2026-01-31" });
  const steady = annualiseGasUsage({ usageMj: 3000, mode: "bill", profile: "steady", billStart: "2026-01-01", billEnd: "2026-01-31" });
  assert.equal(heating.ok, true);
  assert.equal(steady.ok, true);
  if (heating.ok && steady.ok) assert.ok(heating.annualMj > steady.annualMj);
});

test("invalid gas bill periods are rejected", () => {
  assert.equal(annualiseGasUsage({ usageMj: 1000, mode: "bill", profile: "steady", billStart: "2026-04-30", billEnd: "2026-04-01" }).ok, false);
  assert.equal(annualiseGasUsage({ usageMj: 1000, mode: "bill", profile: "steady", billStart: "2026-04-01", billEnd: "2026-04-05" }).ok, false);
});
