export type GasUsageProfile = "heating" | "steady";

export type GasRateDisplay = { label: string; centsPerMj: number };
export type GasSeasonResult = {
  label: string;
  days: number;
  usageMj: number;
  supply: number;
  usage: number;
  rates: GasRateDisplay[];
};

export type GasEstimate = {
  annualCost: number;
  supply: number;
  usage: number;
  discounts: number;
  supplyChargeDaily: number;
  rates: GasRateDisplay[];
  seasonal: boolean;
  seasons: GasSeasonResult[];
  conditionalDiscounts: string[];
  limitations: string[];
};

type Rate = { unitPrice?: number | string; volume?: number | string | null };
type TariffPeriod = {
  displayName?: string;
  startDate?: string;
  endDate?: string;
  dailySupplyCharge?: number | string;
  dailySupplyCharges?: number | string;
  dailySupplyChargeType?: string;
  bandedDailySupplyCharges?: Rate[];
  rateBlockUType?: string;
  singleRate?: { displayName?: string; generalUnitPrice?: number | string; rates?: Rate[]; period?: string };
};
type Discount = {
  type?: string;
  displayName?: string;
  methodUType?: string;
  percentOfBill?: { rate?: number | string };
  percentOfUse?: { rate?: number | string };
  fixedAmount?: { amount?: number | string };
};
type GasContract = {
  tariffPeriod?: TariffPeriod[];
  discounts?: Discount[];
  fees?: unknown[];
  incentives?: unknown[];
  greenPowerCharges?: unknown[];
};

const GST = 1.1;
const HEATING_MONTH_SHARES = [0.035, 0.03, 0.045, 0.07, 0.11, 0.145, 0.17, 0.145, 0.095, 0.065, 0.045, 0.045];
const YEAR = 2025;

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dayIndex(month: number, day: number): number | null {
  const date = new Date(Date.UTC(YEAR, month - 1, day));
  if (date.getUTCFullYear() !== YEAR || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor((date.getTime() - Date.UTC(YEAR, 0, 1)) / 86400000);
}

function parseMonthDay(value: unknown, fallback: [number, number]): number | null {
  const parts = String(value || `${String(fallback[0]).padStart(2, "0")}-${String(fallback[1]).padStart(2, "0")}`).split("-").map(Number);
  return parts.length === 2 ? dayIndex(parts[0], parts[1]) : null;
}

function periodIndexes(period: TariffPeriod): number[] | null {
  const start = parseMonthDay(period.startDate, [1, 1]);
  const end = parseMonthDay(period.endDate, [12, 31]);
  if (start == null || end == null) return null;
  const indexes: number[] = [];
  if (end >= start) for (let index = start; index <= end; index += 1) indexes.push(index);
  else {
    for (let index = start; index < 365; index += 1) indexes.push(index);
    for (let index = 0; index <= end; index += 1) indexes.push(index);
  }
  return indexes;
}

export function gasUsageByDay(annualMj: number, profile: GasUsageProfile): number[] {
  const annual = Number.isFinite(annualMj) ? Math.max(0, annualMj) : 0;
  if (profile === "steady") return new Array(365).fill(annual / 365);
  const days = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(YEAR, 0, index + 1)));
  const monthDays = days.reduce((counts, date) => {
    counts[date.getUTCMonth()] += 1;
    return counts;
  }, new Array(12).fill(0));
  return days.map((date) => annual * HEATING_MONTH_SHARES[date.getUTCMonth()] / monthDays[date.getUTCMonth()]);
}

function priceBlock(rates: Rate[], usage: number): number | null {
  let remaining = usage;
  let total = 0;
  for (let index = 0; index < rates.length && remaining > 0; index += 1) {
    const unitPrice = finiteNonNegative(rates[index].unitPrice);
    if (unitPrice == null) return null;
    let volume = rates[index].volume == null ? Infinity : finiteNonNegative(rates[index].volume);
    if (volume == null) return null;
    if (index === rates.length - 1) volume = Infinity;
    const used = Math.min(remaining, volume);
    total += used * unitPrice;
    remaining -= used;
  }
  return remaining > 0 ? null : total;
}

function groupedUsage(indexes: number[], dailyUsage: number[], period: string): number[][] {
  if (period === "P1D") return indexes.map((index) => [dailyUsage[index]]);
  if (period === "P1M") {
    const months = new Map<number, number[]>();
    indexes.forEach((index) => {
      const month = new Date(Date.UTC(YEAR, 0, index + 1)).getUTCMonth();
      months.set(month, [...(months.get(month) || []), dailyUsage[index]]);
    });
    return [...months.values()];
  }
  return [indexes.map((index) => dailyUsage[index])];
}

function priceUsage(rates: Rate[], indexes: number[], dailyUsage: number[], period = "P1Y"): number | null {
  let total = 0;
  for (const group of groupedUsage(indexes, dailyUsage, period)) {
    const priced = priceBlock(rates, group.reduce((sum, value) => sum + value, 0));
    if (priced == null) return null;
    total += priced;
  }
  return total;
}

function normalizedRates(singleRate: TariffPeriod["singleRate"]): Rate[] {
  if (Array.isArray(singleRate?.rates) && singleRate.rates.length) return singleRate.rates;
  return singleRate?.generalUnitPrice != null ? [{ unitPrice: singleRate.generalUnitPrice }] : [];
}

function rateDisplays(rates: Rate[], period = "P1Y"): GasRateDisplay[] {
  return rates.map((rate, index) => ({
    label: rate.volume != null && index < rates.length - 1
      ? `first ${rate.volume} MJ/${period === "P1D" ? "day" : period === "P1M" ? "month" : "year"}`
      : index ? "remaining usage" : "all usage",
    centsPerMj: Number(rate.unitPrice) * GST * 100,
  }));
}

function priceSupply(period: TariffPeriod, days: number): number | null {
  const daily = finiteNonNegative(period.dailySupplyCharges ?? period.dailySupplyCharge);
  if (daily != null) return daily * days;
  if (Array.isArray(period.bandedDailySupplyCharges) && period.bandedDailySupplyCharges.length) {
    return priceBlock(period.bandedDailySupplyCharges, days);
  }
  return null;
}

export function estimateGasContract(contract: GasContract | null | undefined, annualMj: number, includeConditional: boolean, profile: GasUsageProfile): GasEstimate | null {
  const safeContract = contract || {};
  const periods = Array.isArray(safeContract.tariffPeriod) ? safeContract.tariffPeriod as TariffPeriod[] : [];
  const priceable = periods.filter((period) => period.rateBlockUType === "singleRate" && normalizedRates(period.singleRate).length);
  if (!priceable.length) return null;

  const indexed = priceable.map((period) => ({ period, indexes: periodIndexes(period) }));
  if (indexed.some((item) => item.indexes == null)) return null;
  const coverage = new Array(365).fill(0);
  indexed.forEach((item) => item.indexes!.forEach((index) => { coverage[index] += 1; }));
  if (coverage.some((count) => count !== 1)) return null;

  const dailyUsage = gasUsageByDay(annualMj, profile);
  const seasons: GasSeasonResult[] = [];
  for (const item of indexed) {
    const rates = normalizedRates(item.period.singleRate);
    const period = item.period.singleRate?.period || "P1Y";
    if (!['P1D', 'P1M', 'P1Y'].includes(period)) return null;
    const supply = priceSupply(item.period, item.indexes!.length);
    const usage = priceUsage(rates, item.indexes!, dailyUsage, period);
    if (supply == null || usage == null) return null;
    seasons.push({
      label: item.period.displayName || `${item.period.startDate || "01-01"} to ${item.period.endDate || "12-31"}`,
      days: item.indexes!.length,
      usageMj: item.indexes!.reduce((sum, index) => sum + dailyUsage[index], 0),
      supply: supply * GST,
      usage: usage * GST,
      rates: rateDisplays(rates, period),
    });
  }

  const supply = seasons.reduce((sum, season) => sum + season.supply, 0);
  const usage = seasons.reduce((sum, season) => sum + season.usage, 0);
  let discounts = 0;
  const conditionalDiscounts: string[] = [];
  const limitations: string[] = [];
  for (const discount of safeContract.discounts || []) {
    const conditional = String(discount.type || "").toUpperCase() === "CONDITIONAL";
    if (conditional) conditionalDiscounts.push(discount.displayName || "Conditional discount");
    if (conditional && !includeConditional) continue;
    const value = discount.methodUType === "percentOfBill" ? finiteNonNegative(discount.percentOfBill?.rate)
      : discount.methodUType === "percentOfUse" ? finiteNonNegative(discount.percentOfUse?.rate)
        : discount.methodUType === "fixedAmount" ? finiteNonNegative(discount.fixedAmount?.amount) : null;
    if (value == null) limitations.push("published discount not costed");
    else if (discount.methodUType === "percentOfBill") discounts += (supply + usage) * value;
    else if (discount.methodUType === "percentOfUse") discounts += usage * value;
    else discounts += value;
  }
  if (Array.isArray(safeContract.fees) && safeContract.fees.length) limitations.push("published fees not costed");
  if (Array.isArray(safeContract.incentives) && safeContract.incentives.length) limitations.push("published incentives not costed");
  if (Array.isArray(safeContract.greenPowerCharges) && safeContract.greenPowerCharges.length) limitations.push("green gas charges not costed");

  return {
    annualCost: supply + usage - discounts,
    supply,
    usage,
    discounts,
    supplyChargeDaily: supply / 365 * 100,
    rates: seasons[0].rates,
    seasonal: seasons.length > 1,
    seasons,
    conditionalDiscounts,
    limitations: [...new Set(limitations)],
  };
}
