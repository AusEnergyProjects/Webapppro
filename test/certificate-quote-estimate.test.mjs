import assert from "node:assert/strict";
import test from "node:test";
import { certificateQuoteEstimate } from "../src/lib/certificate-quote-estimate.ts";

const input = { code: "VEEC", activityCode: "6", certificateCount: 82, grossValueCents: 701100, asOf: "2026-10-05" };
const estimate = (changes = {}) => certificateQuoteEstimate({ ...input, ...changes });

test("quote value deducts the official creation fee and ten percent of gross separately", () => {
  const result = estimate();
  assert.equal(result.status, "estimated");
  assert.equal(result.registrationFee.unitAmountTenThousandths, 43500);
  assert.equal(result.registrationFeeCents, 35670);
  assert.equal(result.allowancePercent, 10);
  assert.equal(result.allowanceCents, 70110);
  assert.equal(result.estimatedValueCents, 595320);
  assert.equal(result.asOf, "2026-10-05");
  assert.equal(result.registrationFee.checkedOn, "2026-10-05");
  assert.match(result.registrationFee.officialUrl, /^https:\/\/www\.vic\.gov\.au\//);
});

test("PRC uses 3.15 cents per certificate and rounds the total fee only", () => {
  const one = estimate({ code: "PRC", certificateCount: 1, grossValueCents: 250 });
  assert.equal(one.status, "estimated");
  assert.equal(one.registrationFee.unitAmountTenThousandths, 315);
  assert.equal(one.registrationFeeCents, 3);
  const ten = estimate({ code: "PRC", certificateCount: 10, grossValueCents: 2500 });
  assert.equal(ten.status, "estimated");
  assert.equal(ten.registrationFeeCents, 32);
  assert.equal(ten.allowanceCents, 250);
  assert.equal(ten.estimatedValueCents, 2218);
  const hundred = estimate({ code: "PRC", certificateCount: 100, grossValueCents: 25000 });
  assert.equal(hundred.status, "estimated");
  assert.equal(hundred.registrationFeeCents, 315);
});

test("STC rates distinguish generation and batteries from water heating without a per-job exemption", () => {
  for (const activityCode of ["solar_pv", "small_wind", "small_hydro", "solar_battery", "solar_water_heater", "air_source_heat_pump"]) {
    const result = estimate({ code: "STC", activityCode, certificateCount: 100, grossValueCents: 400000 });
    assert.equal(result.status, "estimated", activityCode);
    assert.equal(result.registrationFeeCents, ["solar_water_heater", "air_source_heat_pump"].includes(activityCode) ? 800 : 4700);
    assert.equal(result.registrationFee.effectiveTo, null);
    assert.match(result.registrationFee.note, /provider's account exceeds 250 certificates/);
    assert.match(result.registrationFee.note, /No per-job exemption/);
    assert.match(result.registrationFee.officialUrl, /^https:\/\/cer\.gov\.au\//);
  }
});

test("published fee windows are inclusive and never project annual NSW indexation", () => {
  for (const [code, from, to, before, after] of [
    ["VEEC", "2026-01-01", "2027-12-31", "2025-12-31", "2028-01-01"],
    ["ESC", "2026-01-01", "2026-12-31", "2025-12-31", "2027-01-01"],
    ["PRC", "2025-11-01", "2026-10-31", "2025-10-31", "2026-11-01"],
  ]) {
    for (const asOf of [from, to]) assert.equal(estimate({ code, asOf }).status, "estimated", `${code} ${asOf}`);
    for (const asOf of [before, after]) {
      const result = estimate({ code, asOf });
      assert.equal(result.status, "unavailable", `${code} ${asOf}`);
      assert.match(result.reason, /quote date/);
    }
  }
  assert.equal(estimate({ code: "ESC" }).registrationFeeCents, 9102);
  assert.equal(estimate({ code: "STC", activityCode: "solar_battery", asOf: "2025-06-30" }).status, "unavailable");
  assert.equal(estimate({ code: "STC", activityCode: "solar_water_heater", asOf: "2026-04-30" }).status, "unavailable");
});

test("unknown certificate types and unsupported STC activities keep the fee unavailable", () => {
  for (const code of ["", "LGC", "ACCU", "SMC", "veec", "unknown"]) {
    assert.equal(estimate({ code }).status, "unavailable", code);
  }
  for (const activityCode of ["", "wind", "hydro", "solar", "battery", "unknown"]) {
    assert.equal(estimate({ code: "STC", activityCode }).status, "unavailable", activityCode);
  }
});

test("quote date accepts only real canonical calendar dates", () => {
  for (const asOf of ["", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-1", "2026-10-05T00:00:00Z", " 2026-10-05", null, 20261005]) {
    assert.equal(estimate({ asOf }).status, "unavailable", String(asOf));
  }
});

test("zero, half-cent ties and insufficient gross values retain honest monetary results", () => {
  const zero = estimate({ certificateCount: 0, grossValueCents: 0 });
  assert.equal(zero.status, "estimated");
  assert.deepEqual([zero.registrationFeeCents, zero.allowanceCents, zero.estimatedValueCents], [0, 0, 0]);
  for (const [grossValueCents, allowanceCents] of [[14, 1], [15, 2], [16, 2]]) {
    const result = estimate({ code: "PRC", certificateCount: 1, grossValueCents });
    assert.equal(result.status, "estimated");
    assert.equal(result.allowanceCents, allowanceCents);
  }
  const exactZero = estimate({ code: "STC", activityCode: "solar_water_heater", certificateCount: 1, grossValueCents: 9 });
  assert.equal(exactZero.status, "estimated");
  assert.equal(exactZero.estimatedValueCents, 0);
  assert.equal(estimate({ certificateCount: 1, grossValueCents: 0 }).status, "unavailable");
  assert.equal(estimate({ certificateCount: 1, grossValueCents: 435 }).status, "unavailable");
});

test("invalid and overflowing quantities or currency are unavailable without coercion", () => {
  for (const invalid of [-1, 1.5, NaN, Infinity, "82", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(estimate({ certificateCount: invalid }).status, "unavailable");
    assert.equal(estimate({ grossValueCents: invalid }).status, "unavailable");
  }
  assert.equal(estimate({ certificateCount: 0, grossValueCents: 1 }).status, "unavailable");
  assert.equal(estimate({ certificateCount: Number.MAX_SAFE_INTEGER, grossValueCents: Number.MAX_SAFE_INTEGER }).status, "unavailable");
  const large = estimate({ code: "PRC", certificateCount: 1, grossValueCents: Number.MAX_SAFE_INTEGER });
  assert.equal(large.status, "estimated");
  assert.equal(large.allowanceCents, 900719925474099);
  assert.equal(large.estimatedValueCents, 8106479329266889);
});

test("published registration fees stay unchanged and GST is explicitly not calculated", () => {
  for (const code of ["VEEC", "ESC", "PRC", "STC"]) {
    const result = estimate({ code, activityCode: "solar_pv" });
    assert.equal(result.status, "estimated");
    assert.match(result.registrationFee.note, /Published fee unchanged\. GST not calculated\./);
    assert.equal(result.estimatedValueCents, input.grossValueCents - result.registrationFeeCents - result.allowanceCents);
  }
});
