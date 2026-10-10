import type { HotWaterPerformance, HotWaterRecovery, ProductHotWaterFacts } from "./product-guides";

// 100 litres, water heat capacity 4.186 kJ/(kg °C), expressed as minutes.
export function heatPumpRecoveryMinutesPer100Litres(recovery: HotWaterRecovery): number {
  if ([recovery.thermalOutputKw, recovery.litresPerHour, recovery.minutes].filter(value => value !== undefined).length !== 1 || (recovery.minutes === undefined && recovery.heatedLitres !== undefined)) throw new Error("Invalid mixed heat-pump recovery measurements");
  if (!Number.isFinite(recovery.waterStartC) || !Number.isFinite(recovery.waterEndC) || recovery.waterEndC <= recovery.waterStartC || !recovery.basis.trim() || !/^https:\/\//.test(recovery.sourceUrl) || (recovery.airTemperatureC !== null && !Number.isFinite(recovery.airTemperatureC))) throw new Error("Invalid published heat-pump recovery conditions");
  let minutes: number;
  if (recovery.thermalOutputKw !== undefined) {
    if (!Number.isFinite(recovery.thermalOutputKw) || recovery.thermalOutputKw <= 0) throw new Error("Invalid heat-pump thermal output");
    minutes = 100 * 4.186 * (recovery.waterEndC - recovery.waterStartC) / (60 * recovery.thermalOutputKw);
  } else if (recovery.litresPerHour !== undefined) {
    if (!Number.isFinite(recovery.litresPerHour) || recovery.litresPerHour <= 0) throw new Error("Invalid measured hot-water recovery rate");
    minutes = 6000 / recovery.litresPerHour;
  } else {
    if (!Number.isFinite(recovery.minutes) || recovery.minutes <= 0 || !Number.isFinite(recovery.heatedLitres) || recovery.heatedLitres <= 0) throw new Error("Invalid measured hot-water recovery time");
    minutes = recovery.minutes * 100 / recovery.heatedLitres;
  }
  return Math.round(minutes);
}

export function hotWaterComparisonFacts(performance: HotWaterPerformance): ProductHotWaterFacts {
  let noise = "Not published for this model";
  if (performance.noise) {
    const figure = performance.noise;
    if (!Number.isFinite(figure.value) || figure.value < 0 || !["sound-pressure", "sound-power", "not-stated"].includes(figure.metric) || !figure.mode.trim() || !/^https:\/\//.test(figure.sourceUrl) || (figure.distanceMetres !== null && (!Number.isFinite(figure.distanceMetres) || figure.distanceMetres <= 0))) throw new Error("Invalid published heat-pump noise measurement");
    const distance = figure.distanceMetres === null ? "distance not specified" : `at ${figure.distanceMetres} m`;
    const basis = figure.metric === "sound-power" ? "sound power, not a distance reading" : figure.metric === "not-stated" ? `${distance}; noise test type not specified` : distance;
    noise = `${figure.value} dB(A), ${basis}; ${figure.mode}`;
  }
  const recovery = performance.recovery;
  if (!recovery) return { noise, recovery: "Not published with usable test conditions", conditions: "No recovery time inferred from tank size alone.", recoverySourceUrl: null };
  const kind = recovery.thermalOutputKw !== undefined ? "Calculated from published heating output" : "Scaled from the published recovery test";
  return { noise, recovery: `About ${heatPumpRecoveryMinutesPer100Litres(recovery)} minutes per 100 L`, conditions: `${kind}. Water ${recovery.waterStartC} to ${recovery.waterEndC}°C; ${recovery.airTemperatureC === null ? "air temperature not specified" : `air ${recovery.airTemperatureC}°C`}. Different test conditions and colder weather affect recovery.`, recoverySourceUrl: recovery.sourceUrl };
}
