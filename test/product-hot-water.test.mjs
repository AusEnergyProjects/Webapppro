import assert from "node:assert/strict";
import test from "node:test";
import { heatPumpRecoveryLitresPerHour, hotWaterComparisonFacts, hotWaterComparisonMeasurements } from "../src/lib/product-hot-water.ts";

const conditions = { airTemperatureC: 20, waterStartC: 15, waterEndC: 55, sourceUrl: "https://example.com/au-test.pdf", basis: "Published compressor-only test" };

test("recovery compares litres per hour while preserving the actual temperature rise and test conditions", () => {
  assert.equal(heatPumpRecoveryLitresPerHour({ ...conditions, thermalOutputKw: 2.8 }), 60.2);
  assert.equal(heatPumpRecoveryLitresPerHour({ ...conditions, waterEndC: 60, thermalOutputKw: 2.8 }), 53.5);
  assert.equal(heatPumpRecoveryLitresPerHour({ ...conditions, litresPerHour: 70 }), 70);
  assert.equal(heatPumpRecoveryLitresPerHour({ ...conditions, minutes: 180, heatedLitres: 250 }), 83.3);
  const facts = hotWaterComparisonFacts({ noise: null, recovery: { ...conditions, thermalOutputKw: 2.8 } });
  assert.equal(facts.recovery, "About 60.2 litres per hour");
  assert.match(facts.conditions, /Calculated.*Water 15 to 55°C; air 20°C/);
  assert.equal(facts.recoverySourceUrl, conditions.sourceUrl);
});

test("tank volume alone never becomes a recovery claim and missing air conditions remain explicit", () => {
  const unknown = hotWaterComparisonFacts({ noise: null, recovery: null });
  assert.equal(unknown.noise, "Not published for this model");
  assert.equal(unknown.recovery, "Not published with usable test conditions");
  assert.equal(unknown.recoverySourceUrl, null);
  const measured = hotWaterComparisonFacts({ noise: null, recovery: { ...conditions, airTemperatureC: null, litresPerHour: 70 } });
  assert.match(measured.conditions, /Published recovery test.*air temperature not specified/);
});

test("published temperature rise supports the recovery-rate calculation without inventing water endpoints", () => {
  const recovery = { airTemperatureC: 19, waterTemperatureRiseC: 45, litresPerHour: 56, sourceUrl: conditions.sourceUrl, basis: "Maker recovery test at 19°C air, 66% humidity, 45°C water rise" };
  const facts = hotWaterComparisonFacts({ noise: null, recovery });
  assert.equal(facts.recovery, "About 56 litres per hour");
  assert.equal(facts.recoveryLabel, "Reheating speed");
  assert.match(facts.conditions, /Water warmed by 45°C; air 19°C/);
  assert.doesNotMatch(facts.conditions, /15 to 60/);
  for (const change of [{ waterTemperatureRiseC: 0 }, { waterTemperatureRiseC: NaN }, { waterStartC: 15, waterEndC: 60 }]) {
    assert.throws(() => heatPumpRecoveryLitresPerHour({ ...recovery, ...change }), /Invalid/);
  }
});

test("published heating-time ranges become litres per hour with the range endpoints in the right order", () => {
  const estimate = { minutesMinimum: 180, minutesMaximum: 240, heatedLitres: 270, basis: "Starting water and air temperatures are not specified by the maker.", sourceUrl: conditions.sourceUrl };
  const facts = hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: estimate });
  assert.equal(facts.recoveryLabel, "Reheating speed");
  assert.equal(facts.recovery, "About 67.5 to 90 litres per hour");
  assert.equal(facts.recoverySourceUrl, estimate.sourceUrl);
  assert.match(facts.conditions, /maker's heating-time estimate/);
  const smaller = hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: { ...estimate, minutesMinimum: 240, minutesMaximum: 300, heatedLitres: 180 } });
  assert.equal(smaller.recovery, "About 36 to 45 litres per hour");
  const exact = hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: { ...estimate, minutesMaximum: 180 } });
  assert.equal(exact.recovery, "About 90 litres per hour");
  for (const change of [{ basis: " " }, { heatedLitres: 0 }, { minutesMinimum: NaN }, { minutesMaximum: 100 }, { sourceUrl: "" }]) {
    assert.throws(() => hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: { ...estimate, ...change } }), /Invalid/);
  }
});

test("a published litres-per-hour rate retains its exact figure when water temperatures are unspecified", () => {
  const estimate = { litresPerHour: 53, basis: "Published production rate at 20°C air; water temperatures not specified.", sourceUrl: conditions.sourceUrl };
  const facts = hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: estimate });
  assert.equal(facts.recovery, "About 53 litres per hour");
  assert.match(facts.conditions, /published heating rate.*water temperatures not specified/);
  for (const change of [{ litresPerHour: 0 }, { litresPerHour: NaN }, { minutesMinimum: 120 }, { heatedLitres: 200 }]) {
    assert.throws(() => hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: { ...estimate, ...change } }), /Invalid/);
  }
});

test("a maker's published rate range retains both endpoints without selecting an invented average", () => {
  const estimate = { litresPerHourMinimum: 50, litresPerHourMaximum: 60, basis: "Typical maker range; depends on weather and model.", sourceUrl: conditions.sourceUrl };
  assert.equal(hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: estimate }).recovery, "About 50 to 60 litres per hour");
  for (const change of [{ litresPerHourMinimum: 0 }, { litresPerHourMaximum: 40 }, { litresPerHourMaximum: NaN }, { litresPerHourMaximum: undefined }, { litresPerHour: 55 }, { heatedLitres: 300 }]) {
    assert.throws(() => hotWaterComparisonFacts({ noise: null, recovery: null, recoveryTimeEstimate: { ...estimate, ...change } }), /Invalid/);
  }
});

test("bar measurements and visible facts share one source calculation without mutating the evidence", () => {
  const performance = {
    noise: { value: 46.6, metric: "sound-pressure", distanceMetres: 1, mode: "Published operating noise", sourceUrl: conditions.sourceUrl },
    recovery: null,
    recoveryTimeEstimate: { litresPerHourMinimum: 50, litresPerHourMaximum: 60, basis: "Maker range", sourceUrl: conditions.sourceUrl },
  };
  const before = structuredClone(performance);
  const figures = hotWaterComparisonMeasurements(performance, "Exact model", "2026-10-12");
  assert.equal(figures.noise.value, 46.6);
  assert.equal(figures.noise.unit, "published-noise-db");
  assert.equal(figures.recovery.value, 50);
  assert.equal(figures.recovery.valueMaximum, 60);
  assert.equal(figures.recovery.unit, "recovery-litres-per-hour");
  assert.match(figures.recovery.basis, /slower end/);
  assert.equal(hotWaterComparisonFacts(performance).recovery, "About 50 to 60 litres per hour");
  assert.deepEqual(performance, before);
  assert.deepEqual(hotWaterComparisonMeasurements({ noise: null, recovery: null }, "Exact model", "2026-10-12"), { noise: null, recovery: null });
});

test("noise shows the exact sourced number without inventing a shared test distance", () => {
  const noise = { value: 43, metric: "sound-pressure", distanceMetres: 1, mode: "Compressor mode", sourceUrl: conditions.sourceUrl };
  for (const change of [
    {},
    { distanceMetres: 1.5 },
    { distanceMetres: 2 },
    { distanceMetres: null },
    { metric: "sound-power", distanceMetres: null },
    { metric: "not-stated" },
    { value: 43.5, metric: "not-stated", distanceMetres: null },
  ]) {
    const evidence = { ...noise, ...change };
    const original = structuredClone(evidence);
    assert.equal(hotWaterComparisonFacts({ noise: evidence, recovery: null }).noise, `${evidence.value} dB`);
    assert.deepEqual(evidence, original, "display formatting cannot rewrite the published metric, distance, mode or source");
  }
});

test("invalid measurements, zero output and incomplete recovery conditions are rejected", () => {
  assert.throws(() => heatPumpRecoveryLitresPerHour({ ...conditions, thermalOutputKw: 2.8, litresPerHour: 70 }), /Invalid mixed/);
  assert.throws(() => heatPumpRecoveryLitresPerHour({ ...conditions, thermalOutputKw: 2.8, heatedLitres: 250 }), /Invalid mixed/);
  for (const recovery of [{ ...conditions, thermalOutputKw: 0 }, { ...conditions, thermalOutputKw: -1 }, { ...conditions, litresPerHour: NaN }, { ...conditions, minutes: 120, heatedLitres: 0 }, { ...conditions, thermalOutputKw: 2.8, waterEndC: 15 }, { ...conditions, thermalOutputKw: 2.8, sourceUrl: "http://example.com/test" }, { ...conditions, thermalOutputKw: 2.8, airTemperatureC: Infinity }]) {
    assert.throws(() => heatPumpRecoveryLitresPerHour(recovery), /Invalid/);
  }
  for (const change of [{ value: -1 }, { value: NaN }, { distanceMetres: 0 }, { mode: " " }, { sourceUrl: "" }]) {
    assert.throws(() => hotWaterComparisonFacts({ noise: { value: 43, metric: "sound-pressure", distanceMetres: 1, mode: "Compressor mode", sourceUrl: conditions.sourceUrl, ...change }, recovery: null }), /Invalid/);
  }
});
