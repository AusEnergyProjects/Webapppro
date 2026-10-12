import assert from "node:assert/strict";
import test from "node:test";
import { heatPumpRecoveryMinutesPer100Litres, hotWaterComparisonFacts } from "../src/lib/product-hot-water.ts";

const conditions = { airTemperatureC: 20, waterStartC: 15, waterEndC: 55, sourceUrl: "https://example.com/au-test.pdf", basis: "Published compressor-only test" };

test("recovery compares 100 litres while preserving the actual temperature rise and test conditions", () => {
  assert.equal(heatPumpRecoveryMinutesPer100Litres({ ...conditions, thermalOutputKw: 2.8 }), 100);
  assert.equal(heatPumpRecoveryMinutesPer100Litres({ ...conditions, waterEndC: 60, thermalOutputKw: 2.8 }), 112);
  assert.equal(heatPumpRecoveryMinutesPer100Litres({ ...conditions, litresPerHour: 70 }), 86);
  assert.equal(heatPumpRecoveryMinutesPer100Litres({ ...conditions, minutes: 180, heatedLitres: 250 }), 72);
  const facts = hotWaterComparisonFacts({ noise: null, recovery: { ...conditions, thermalOutputKw: 2.8 } });
  assert.equal(facts.recovery, "About 100 minutes per 100 L");
  assert.match(facts.conditions, /Calculated.*Water 15 to 55°C; air 20°C/);
  assert.equal(facts.recoverySourceUrl, conditions.sourceUrl);
});

test("tank volume alone never becomes a recovery claim and missing air conditions remain explicit", () => {
  const unknown = hotWaterComparisonFacts({ noise: null, recovery: null });
  assert.equal(unknown.noise, "Not published for this model");
  assert.equal(unknown.recovery, "Not published with usable test conditions");
  assert.equal(unknown.recoverySourceUrl, null);
  const measured = hotWaterComparisonFacts({ noise: null, recovery: { ...conditions, airTemperatureC: null, litresPerHour: 70 } });
  assert.match(measured.conditions, /Scaled.*air temperature not specified/);
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
  assert.throws(() => heatPumpRecoveryMinutesPer100Litres({ ...conditions, thermalOutputKw: 2.8, litresPerHour: 70 }), /Invalid mixed/);
  assert.throws(() => heatPumpRecoveryMinutesPer100Litres({ ...conditions, thermalOutputKw: 2.8, heatedLitres: 250 }), /Invalid mixed/);
  for (const recovery of [{ ...conditions, thermalOutputKw: 0 }, { ...conditions, thermalOutputKw: -1 }, { ...conditions, litresPerHour: NaN }, { ...conditions, minutes: 120, heatedLitres: 0 }, { ...conditions, thermalOutputKw: 2.8, waterEndC: 15 }, { ...conditions, thermalOutputKw: 2.8, sourceUrl: "http://example.com/test" }, { ...conditions, thermalOutputKw: 2.8, airTemperatureC: Infinity }]) {
    assert.throws(() => heatPumpRecoveryMinutesPer100Litres(recovery), /Invalid/);
  }
  for (const change of [{ value: -1 }, { value: NaN }, { distanceMetres: 0 }, { mode: " " }, { sourceUrl: "" }]) {
    assert.throws(() => hotWaterComparisonFacts({ noise: { value: 43, metric: "sound-pressure", distanceMetres: 1, mode: "Compressor mode", sourceUrl: conditions.sourceUrl, ...change }, recovery: null }), /Invalid/);
  }
});
