import type { HalfHourlyGrid } from "./nem12-types.ts";

export interface SolarFlow {
  importProfile: HalfHourlyGrid;
  exportProfile: HalfHourlyGrid;
  annualImport: number;
  annualExport: number;
  annualSelfUse: number;
  selfUsePct: number;
}

export interface BatteryFlow {
  importProfile: HalfHourlyGrid;
  exportProfile: HalfHourlyGrid;
  annualImport: number;
  annualExport: number;
  annualDischarge: number;
  annualCharge: number;
  dailyDischarge: number;
}

export const SOLAR_YIELD_KWH_PER_KW: Record<string, number> = {
  VIC: 1250, NSW: 1400, QLD: 1500, SA: 1450, TAS: 1150, ACT: 1400, WA: 1500, NT: 1600,
};

export const BATTERY_ROUND_TRIP_EFFICIENCY = 0.9;
export const COMMON_SOLAR_SIZES = [3, 4, 5, 6.6, 8, 10, 13.2];
export const COMMON_BATTERY_SIZES = [5, 10, 13.5, 16, 20];
export const SCENARIO_COST_ASSUMPTIONS = {
  version: "2026-07-14",
  solarNetInstalledPerKw: 850,
  batteryGrossInstalledPerUsableKwh: 1000,
  batteryStcFactor: 6.8,
  assumedStcValue: 40,
  batterySupportedUsableKwh: 50,
} as const;

function emptyGrid(): HalfHourlyGrid {
  return Array.from({ length: 7 }, () => new Array(48).fill(0));
}

export function gridSum(grid: HalfHourlyGrid): number {
  let total = 0;
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) total += Number(grid[day]?.[bin]) || 0;
  return total;
}

export function scaleGrid(grid: HalfHourlyGrid, target: number): HalfHourlyGrid {
  const total = gridSum(grid);
  if (!(total > 0)) return emptyGrid();
  return grid.map((row) => row.map((value) => (Number(value) || 0) * target / total));
}

export function solarShape(): number[] {
  const shape: number[] = [];
  let total = 0;
  for (let bin = 0; bin < 48; bin += 1) {
    const hour = bin / 2 + 0.25;
    const value = hour >= 6.5 && hour <= 19 ? Math.max(0, Math.sin(Math.PI * (hour - 6.5) / 12.5)) : 0;
    shape.push(value);
    total += value;
  }
  return shape.map((value) => value / total);
}

export function genericExportProfile(annualExportKwh: number): HalfHourlyGrid {
  const shape = solarShape();
  return scaleGrid(Array.from({ length: 7 }, () => shape.slice()), Math.max(0, annualExportKwh) * 7 / 365);
}

export function simulateSolar(loadProfile: HalfHourlyGrid, annualLoadKwh: number, annualGenerationKwh: number): SolarFlow {
  const weeklyLoad = scaleGrid(loadProfile, annualLoadKwh * 7 / 365);
  const shape = solarShape();
  const dailyGeneration = Math.max(0, annualGenerationKwh) / 365;
  const imports = emptyGrid();
  const exports = emptyGrid();
  let selfUseWeekly = 0;
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
    const generation = dailyGeneration * shape[bin];
    const used = Math.min(weeklyLoad[day][bin], generation);
    selfUseWeekly += used;
    imports[day][bin] = Math.max(0, weeklyLoad[day][bin] - generation);
    exports[day][bin] = Math.max(0, generation - weeklyLoad[day][bin]);
  }
  const annualSelfUse = selfUseWeekly * 365 / 7;
  return {
    importProfile: imports,
    exportProfile: exports,
    annualImport: gridSum(imports) * 365 / 7,
    annualExport: gridSum(exports) * 365 / 7,
    annualSelfUse,
    selfUsePct: annualGenerationKwh > 0 ? annualSelfUse / annualGenerationKwh : 0,
  };
}

export function simulateBattery(importProfile: HalfHourlyGrid, exportProfile: HalfHourlyGrid, annualImportKwh: number, annualExportKwh: number, sizeKwh: number, roundTripEfficiency = BATTERY_ROUND_TRIP_EFFICIENCY): BatteryFlow {
  const imports = scaleGrid(importProfile, Math.max(0, annualImportKwh) * 7 / 365);
  const exports = scaleGrid(exportProfile, Math.max(0, annualExportKwh) * 7 / 365);
  const efficiency = Math.sqrt(roundTripEfficiency || BATTERY_ROUND_TRIP_EFFICIENCY);
  const capacity = Math.max(0, Number(sizeKwh) || 0);
  let state = 0;
  let capturedImport = emptyGrid();
  let capturedExport = emptyGrid();
  let capturedDischarge = 0;
  let capturedCharge = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    const outImport = emptyGrid();
    const outExport = emptyGrid();
    let discharge = 0;
    let charge = 0;
    for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
      let imported = imports[day][bin];
      let exported = exports[day][bin];
      const chargeInput = Math.min(exported, Math.max(0, capacity - state) / efficiency);
      state += chargeInput * efficiency;
      exported -= chargeInput;
      charge += chargeInput;
      const dischargeOutput = Math.min(imported, state * efficiency);
      state -= dischargeOutput / efficiency;
      imported -= dischargeOutput;
      discharge += dischargeOutput;
      outImport[day][bin] = imported;
      outExport[day][bin] = exported;
    }
    if (pass === 7) {
      capturedImport = outImport;
      capturedExport = outExport;
      capturedDischarge = discharge;
      capturedCharge = charge;
    }
  }
  return {
    importProfile: capturedImport,
    exportProfile: capturedExport,
    annualImport: gridSum(capturedImport) * 365 / 7,
    annualExport: gridSum(capturedExport) * 365 / 7,
    annualDischarge: capturedDischarge * 365 / 7,
    annualCharge: capturedCharge * 365 / 7,
    dailyDischarge: capturedDischarge / 7,
  };
}

export function stateFromPostcode(postcode: string): string | null {
  const value = Number(postcode);
  if ((value >= 2600 && value <= 2618) || (value >= 2900 && value <= 2920)) return "ACT";
  if (value >= 2000 && value <= 2999) return "NSW";
  if (value >= 3000 && value <= 3999) return "VIC";
  if (value >= 4000 && value <= 4999) return "QLD";
  if (value >= 5000 && value <= 5999) return "SA";
  if (value >= 6000 && value <= 6999) return "WA";
  if (value >= 7000 && value <= 7999) return "TAS";
  if (value >= 800 && value <= 999) return "NT";
  return null;
}

export function solarYieldForPostcode(postcode: string): number {
  return SOLAR_YIELD_KWH_PER_KW[stateFromPostcode(postcode) || ""] || 1350;
}

export function suggestedSolarSize(annualKwh: number, postcode: string): number {
  const raw = Math.max(0, annualKwh) / solarYieldForPostcode(postcode);
  return COMMON_SOLAR_SIZES.find((size) => size >= raw) || COMMON_SOLAR_SIZES[COMMON_SOLAR_SIZES.length - 1];
}

export function suggestedBatterySize(importProfile: HalfHourlyGrid, annualImportKwh: number, annualExportKwh: number): number {
  let windowUsage = 0;
  let totalUsage = 0;
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
    const value = Number(importProfile[day]?.[bin]) || 0;
    const hour = bin / 2;
    totalUsage += value;
    if (hour >= 16 || hour < 7) windowUsage += value;
  }
  const eveningDaily = Math.max(0, annualImportKwh) / 365 * (totalUsage > 0 ? windowUsage / totalUsage : 0.6);
  const usefulDaily = Math.min(Math.max(0, annualExportKwh) / 365 * BATTERY_ROUND_TRIP_EFFICIENCY, eveningDaily);
  const raw = usefulDaily / BATTERY_ROUND_TRIP_EFFICIENCY;
  return COMMON_BATTERY_SIZES.find((size) => size >= raw) || COMMON_BATTERY_SIZES[COMMON_BATTERY_SIZES.length - 1];
}

export function batteryRebate(sizeKwh: number): { stcs: number; amount: number } {
  const size = Number.isFinite(sizeKwh) ? Math.max(0, sizeKwh) : 0;
  const effective = Math.min(size, 14)
    + Math.max(0, Math.min(size, 28) - 14) * 0.6
    + Math.max(0, Math.min(size, 50) - 28) * 0.15;
  const stcs = Math.floor(effective * SCENARIO_COST_ASSUMPTIONS.batteryStcFactor);
  return { stcs, amount: Math.round(stcs * SCENARIO_COST_ASSUMPTIONS.assumedStcValue) };
}

export function defaultBatteryNetCost(sizeKwh: number): number {
  const size = Number.isFinite(sizeKwh) ? Math.max(0, sizeKwh) : 0;
  return Math.max(0, Math.round((size * SCENARIO_COST_ASSUMPTIONS.batteryGrossInstalledPerUsableKwh - batteryRebate(size).amount) / 100) * 100);
}

export function defaultSolarNetCost(sizeKw: number): number {
  const size = Number.isFinite(sizeKw) ? Math.max(0, sizeKw) : 0;
  return Math.max(0, Math.round(size * SCENARIO_COST_ASSUMPTIONS.solarNetInstalledPerKw / 100) * 100);
}
