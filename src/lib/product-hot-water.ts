import type { HotWaterNoise, HotWaterPerformance, HotWaterRecovery, ProductHotWaterFacts, ProductMeasurement } from "./product-guides";

function publishedWaterTemperatureRise(recovery: HotWaterRecovery): number {
  if (recovery.waterTemperatureRiseC !== undefined) {
    if (recovery.waterStartC !== undefined || recovery.waterEndC !== undefined || !Number.isFinite(recovery.waterTemperatureRiseC) || recovery.waterTemperatureRiseC <= 0) throw new Error("Invalid published heat-pump recovery conditions");
    return recovery.waterTemperatureRiseC;
  }
  if (!Number.isFinite(recovery.waterStartC) || !Number.isFinite(recovery.waterEndC) || recovery.waterEndC <= recovery.waterStartC) throw new Error("Invalid published heat-pump recovery conditions");
  return recovery.waterEndC - recovery.waterStartC;
}

// Water heat capacity 4.186 kJ/(kg °C), expressed as litres per hour.
export function heatPumpRecoveryLitresPerHour(recovery: HotWaterRecovery): number {
  if ([recovery.thermalOutputKw, recovery.litresPerHour, recovery.minutes].filter(value => value !== undefined).length !== 1 || (recovery.minutes === undefined && recovery.heatedLitres !== undefined)) throw new Error("Invalid mixed heat-pump recovery measurements");
  const temperatureRise = publishedWaterTemperatureRise(recovery);
  if (!recovery.basis.trim() || !/^https:\/\//.test(recovery.sourceUrl) || (recovery.airTemperatureC !== null && !Number.isFinite(recovery.airTemperatureC))) throw new Error("Invalid published heat-pump recovery conditions");
  let litresPerHour: number;
  if (recovery.thermalOutputKw !== undefined) {
    if (!Number.isFinite(recovery.thermalOutputKw) || recovery.thermalOutputKw <= 0) throw new Error("Invalid heat-pump thermal output");
    litresPerHour = 3600 * recovery.thermalOutputKw / (4.186 * temperatureRise);
  } else if (recovery.litresPerHour !== undefined) {
    if (!Number.isFinite(recovery.litresPerHour) || recovery.litresPerHour <= 0) throw new Error("Invalid measured hot-water recovery rate");
    litresPerHour = recovery.litresPerHour;
  } else {
    if (!Number.isFinite(recovery.minutes) || recovery.minutes <= 0 || !Number.isFinite(recovery.heatedLitres) || recovery.heatedLitres <= 0) throw new Error("Invalid measured hot-water recovery time");
    litresPerHour = recovery.heatedLitres * 60 / recovery.minutes;
  }
  return roundedRecoveryRate(litresPerHour);
}

function roundedRecoveryRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid calculated heat-pump recovery rate");
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded) || rounded <= 0) throw new Error("Invalid calculated heat-pump recovery rate");
  return rounded;
}

function checkedNoise(figure: HotWaterNoise | null): HotWaterNoise | null {
  if (figure && (!Number.isFinite(figure.value) || figure.value < 0 || !["sound-pressure", "sound-power", "not-stated"].includes(figure.metric) || !figure.mode.trim() || !/^https:\/\//.test(figure.sourceUrl) || (figure.distanceMetres !== null && (!Number.isFinite(figure.distanceMetres) || figure.distanceMetres <= 0)))) throw new Error("Invalid published heat-pump noise measurement");
  return figure;
}

type RecoveryRates = { minimum: number; maximum: number; conditions: string; sourceUrl: string };
function recoveryRates(performance: HotWaterPerformance): RecoveryRates | null {
  const recovery = performance.recovery;
  if (!recovery && performance.recoveryTimeEstimate) {
    const estimate = performance.recoveryTimeEstimate;
    if (!estimate.basis.trim() || !/^https:\/\//.test(estimate.sourceUrl)) throw new Error("Invalid published heat-pump recovery estimate");
    if (estimate.litresPerHourMinimum !== undefined || estimate.litresPerHourMaximum !== undefined) {
      if (!Number.isFinite(estimate.litresPerHourMinimum) || !Number.isFinite(estimate.litresPerHourMaximum)
          || estimate.litresPerHourMinimum <= 0 || estimate.litresPerHourMaximum < estimate.litresPerHourMinimum
          || estimate.litresPerHour !== undefined || estimate.minutesMinimum !== undefined || estimate.minutesMaximum !== undefined || estimate.heatedLitres !== undefined) throw new Error("Invalid published heat-pump recovery estimate");
      return { minimum: estimate.litresPerHourMinimum, maximum: estimate.litresPerHourMaximum, conditions: `Maker's published heating-rate range. ${estimate.basis}`, sourceUrl: estimate.sourceUrl };
    }
    if (estimate.litresPerHour !== undefined) {
      if (!Number.isFinite(estimate.litresPerHour) || estimate.litresPerHour <= 0 || estimate.minutesMinimum !== undefined || estimate.minutesMaximum !== undefined || estimate.heatedLitres !== undefined) throw new Error("Invalid published heat-pump recovery estimate");
      return { minimum: estimate.litresPerHour, maximum: estimate.litresPerHour, conditions: `Maker's published heating rate. ${estimate.basis}`, sourceUrl: estimate.sourceUrl };
    }
    if (![estimate.minutesMinimum, estimate.minutesMaximum, estimate.heatedLitres].every(value => Number.isFinite(value) && value > 0)
        || estimate.minutesMaximum < estimate.minutesMinimum) throw new Error("Invalid published heat-pump recovery estimate");
    const minimum = roundedRecoveryRate(estimate.heatedLitres * 60 / estimate.minutesMaximum);
    const maximum = roundedRecoveryRate(estimate.heatedLitres * 60 / estimate.minutesMinimum);
    return { minimum, maximum, conditions: `Converted from the maker's heating-time estimate. ${estimate.basis}`, sourceUrl: estimate.sourceUrl };
  }
  if (!recovery) return null;
  const kind = recovery.thermalOutputKw !== undefined ? "Calculated from published heating output" : "Published recovery test converted to litres per hour";
  const waterConditions = recovery.waterTemperatureRiseC !== undefined ? `Water warmed by ${recovery.waterTemperatureRiseC}°C` : `Water ${recovery.waterStartC} to ${recovery.waterEndC}°C`;
  const rate = heatPumpRecoveryLitresPerHour(recovery);
  return { minimum: rate, maximum: rate, conditions: `${kind}. ${waterConditions}; ${recovery.airTemperatureC === null ? "air temperature not specified" : `air ${recovery.airTemperatureC}°C`}. Different test conditions and colder weather affect recovery.`, sourceUrl: recovery.sourceUrl };
}

export function hotWaterComparisonFacts(performance: HotWaterPerformance): ProductHotWaterFacts {
  const noise = checkedNoise(performance.noise);
  const rates = recoveryRates(performance);
  return {
    noise: noise ? `${noise.value} dB` : "Not published for this model",
    recoveryLabel: "Reheating speed",
    recovery: rates ? `About ${rates.minimum === rates.maximum ? rates.minimum : `${rates.minimum} to ${rates.maximum}`} litres per hour` : "Not published with usable test conditions",
    conditions: rates?.conditions ?? "No heating rate inferred from tank size alone.",
    recoverySourceUrl: rates?.sourceUrl ?? null,
  };
}

/** Derive both visual bars from the same source records and conversion used by the facts. */
export function hotWaterComparisonMeasurements(performance: HotWaterPerformance, variant: string, checkedAt: string): { noise: ProductMeasurement | null; recovery: ProductMeasurement | null } {
  const noise = checkedNoise(performance.noise);
  const rates = recoveryRates(performance);
  return {
    noise: noise ? { value: noise.value, unit: "published-noise-db", basisId: "published-hot-water-noise", variant, checkedAt,
      basis: `Published ${noise.metric} figure; ${noise.mode}. Original test details remain in the product documents.`, sourceUrl: noise.sourceUrl } : null,
    recovery: rates ? { value: rates.minimum, ...(rates.maximum > rates.minimum ? { valueMaximum: rates.maximum } : {}), unit: "recovery-litres-per-hour", basisId: "hot-water-recovery-rate", variant, checkedAt,
      basis: `${rates.maximum > rates.minimum ? "The slower end of the published range is used for the bar and filter. " : ""}${rates.conditions}`, sourceUrl: rates.sourceUrl } : null,
  };
}
