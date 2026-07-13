import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeComparisonUrl, parseNativeComparisonQuery } from "../src/lib/electricity/native-sharing.ts";

test("native meter reminder links contain only whitelisted non-sensitive inputs", () => {
  const url = buildNativeComparisonUrl("https://example.com", {
    postcode: "3000", annualKwh: 6123, profileKind: "evening", customerType: "RESIDENTIAL",
    setupMode: "solar", solarKw: 6.6, batteryKwh: 10, exportKwh: 2100,
    hasEv: true, hasControlledLoad: true, controlledKwh: 900, assumeConditional: false, usedMeter: true,
  });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/compare");
  assert.equal(parsed.searchParams.get("meter"), "reupload");
  assert.equal(parsed.searchParams.get("auto"), "0");
  assert.equal(parsed.searchParams.has("clkwh"), false, "meter register totals are not shared");
  for (const forbidden of ["nmi", "intervals", "filename", "overrideReason", "name", "email", "phone"]) {
    assert.equal(parsed.searchParams.has(forbidden), false);
  }
});

test("native comparison links restore safe manual assumptions without auto-running", () => {
  const url = buildNativeComparisonUrl("https://example.com", {
    postcode: "2000", annualKwh: 5000, profileKind: "daytime", customerType: "BUSINESS",
    setupMode: "none", hasEv: false, hasControlledLoad: true, controlledKwh: 800,
    assumeConditional: true, usedMeter: false,
  });
  const restored = parseNativeComparisonQuery(new URL(url).search);
  assert.equal(restored.postcode, "2000");
  assert.equal(restored.customerType, "BUSINESS");
  assert.equal(restored.profileKind, "daytime");
  assert.equal(restored.controlledKwh, 800);
  assert.equal(restored.assumeConditional, true);
  assert.equal(restored.meterReupload, false);
});

test("parser ignores sensitive and malformed query values", () => {
  const restored = parseNativeComparisonQuery("?pc=NMI123&kwh=-1&profile=secret&nmi=6407123456&email=x@example.com");
  assert.equal(restored.postcode, undefined);
  assert.equal(restored.annualKwh, undefined);
  assert.equal(restored.profileKind, undefined);
  assert.equal("nmi" in restored, false);
  assert.equal("email" in restored, false);
});
