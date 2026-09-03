import { gasPointAt } from "./gas-wholesale.ts";
import type { GasPoint } from "./gas-wholesale.ts";
import { NEM_INTERVAL_MS } from "./nem-wholesale.ts";
import type { NemPoint } from "./nem-wholesale.ts";
import { averageAvailablePriceCentsPerKwh } from "./useful-energy.ts";

export const MIN_RELIABLE_PRICE_INTERVALS = 276;

export type WholesalePriceSnapshot = {
  electricityIntervalCount: number;
  electricityPrice: number | null;
  gasPrice: number | null;
  hasReliableElectricityWindow: boolean;
  hasReliableGasWindow: boolean;
  matchedIntervalCount: number;
};

export function wholesalePriceSnapshot(electricityPoints: readonly NemPoint[], gasPoints: readonly GasPoint[] | null): WholesalePriceSnapshot {
  const electricityPrices = electricityPoints.flatMap(({ centsPerKwh }) => centsPerKwh === null ? [] : [centsPerKwh]);
  const matchedPrices = gasPoints ? electricityPoints.flatMap((point) => {
    if (point.centsPerKwh === null) return [];
    const gasPoint = gasPointAt(gasPoints, point.time - NEM_INTERVAL_MS / 2);
    return gasPoint ? [{ electricity: point.centsPerKwh, gas: gasPoint.centsPerKwh }] : [];
  }) : [];
  const hasReliableElectricityWindow = electricityPrices.length >= MIN_RELIABLE_PRICE_INTERVALS;
  const hasReliableGasWindow = matchedPrices.length >= MIN_RELIABLE_PRICE_INTERVALS;
  return {
    electricityIntervalCount: electricityPrices.length,
    electricityPrice: averageAvailablePriceCentsPerKwh(hasReliableGasWindow
      ? matchedPrices.map(({ electricity }) => electricity)
      : hasReliableElectricityWindow ? electricityPrices : []),
    gasPrice: averageAvailablePriceCentsPerKwh(hasReliableGasWindow ? matchedPrices.map(({ gas }) => gas) : []),
    hasReliableElectricityWindow,
    hasReliableGasWindow,
    matchedIntervalCount: matchedPrices.length,
  };
}
