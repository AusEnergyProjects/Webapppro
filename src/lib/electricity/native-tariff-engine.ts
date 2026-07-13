import type { HalfHourlyGrid, Nem12AllocatedDay } from "./nem12-types.ts";

export const NATIVE_ENGINE_VERSION = "aea-native-electricity-0.4.0";
const GST = 1.1;
const DAY_INDEX: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

type PublishedRate = { unitPrice: number | string; volume?: number | string | null };
type TimeWindow = { days?: string[]; startTime?: string; endTime?: string };
type SingleRateBlock = { period?: string; rates?: PublishedRate[] };
type TouRate = { type?: string; period?: string; rates?: PublishedRate[]; timeOfUse?: TimeWindow[] };
type TariffPeriod = {
  startDate?: string;
  endDate?: string;
  dailySupplyCharge?: number | string;
  dailySupplyCharges?: number | string;
  rateBlockUType?: string;
  singleRate?: SingleRateBlock;
  timeOfUseRates?: TouRate[];
  demandCharges?: DemandCharge[];
};
type DemandCharge = {
  displayName?: string;
  amount?: number | string;
  startTime?: string;
  endTime?: string;
  days?: string[] | { weekdays?: boolean; saturday?: boolean; sunday?: boolean };
  measurementPeriod?: string;
  chargePeriod?: string;
  minDemand?: number | string;
  maxDemand?: number | string;
};
type ControlledLoad = {
  displayName?: string;
  dailyCharge?: number | string;
  rateBlockUType?: string;
  singleRate?: SingleRateBlock;
  timeOfUseRates?: TouRate[];
};
type Discount = {
  displayName?: string;
  type?: string;
  methodUType?: string;
  percentOfBill?: { rate?: number | string };
  percentOfUse?: { rate?: number | string };
  fixedAmount?: { amount?: number | string };
};
type FeedInRate = { unitPrice?: number | string };
type FeedInTariff = {
  scheme?: string;
  singleTariff?: { rates?: FeedInRate[] };
  timeVaryingTariffs?: Array<{ rates?: FeedInRate[]; timeVariations?: TimeWindow[]; timeOfUse?: TimeWindow[] }>;
};

export interface NativeElectricityContract {
  tariffPeriod?: TariffPeriod[];
  controlledLoad?: ControlledLoad[];
  discounts?: Discount[];
  solarFeedInTariff?: FeedInTariff[];
  eligibility?: Array<{ type?: string; information?: string; description?: string }>;
}

export interface NativePlanInput {
  planId: string;
  name: string;
  brand: string;
  logo?: string | null;
  base?: string | null;
  type?: string;
  distributors?: string[];
  link?: string | null;
  tariffHash?: string;
  fees?: number;
  validation?: { schemaVersion?: string; limitations?: string[] };
  contract: NativeElectricityContract;
}

export interface NativeEstimateInputs {
  annualGeneralKwh: number;
  annualControlledKwh: number;
  profile: HalfHourlyGrid;
  controlledProfile?: HalfHourlyGrid;
  assumeConditional: boolean;
  demandReady?: boolean;
  demandSeries?: Nem12AllocatedDay[];
  intervalSeries?: Nem12AllocatedDay[];
  annualExportKwh?: number;
  exportProfile?: HalfHourlyGrid;
  hasSolar?: boolean;
  hasBattery?: boolean;
  hasEv?: boolean;
  evidenceLabel?: string;
  registerEvidence?: NativeAuditRegister[];
}

export interface NativeRateDisplay {
  label: string;
  centsPerKwh: number;
}

export interface NativePlanResult extends NativePlanInput {
  annualCost: number;
  supply: number;
  usage: number;
  controlled: number;
  demand: number;
  demandPeakKw: number;
  feedIn: number;
  feedInCentsPerKwh: number;
  discounts: number;
  tariffKind: "single" | "tou" | "demand";
  supplyCentsPerDay: number;
  rates: NativeRateDisplay[];
  controlledRates: NativeRateDisplay[];
  touMix: Record<string, number> | null;
  audit: NativeCalculationAudit;
}

export interface NativeAuditChargeLine {
  label: string;
  quantity: string;
  allocation?: string;
  rate: string;
  amount: number;
}

export interface NativeAuditDiscountLine {
  label: string;
  method: string;
  conditional: boolean;
  applied: boolean;
  amount: number;
}

export interface NativeAuditRegister {
  id: string;
  role: "general" | "controlled";
  annualKwh: number;
  intervalMinutes: number;
}

export interface NativeCalculationAudit {
  engineVersion: string;
  evidenceLabel: string;
  inputs: { annualGeneralKwh: number; annualControlledKwh: number; annualExportKwh: number };
  registers: NativeAuditRegister[];
  supply: NativeAuditChargeLine[];
  usage: NativeAuditChargeLine[];
  controlled: NativeAuditChargeLine[];
  demand: NativeAuditChargeLine[];
  feedIn: NativeAuditChargeLine[];
  discounts: NativeAuditDiscountLine[];
  reconciliation: {
    supply: number;
    usage: number;
    controlled: number;
    demand: number;
    feedIn: number;
    discounts: number;
    componentTotal: number;
    rankedTotal: number;
    difference: number;
  };
  eligibility: string[];
  limitations: string[];
}

export type NativeEstimateResult = { ok: true; result: NativePlanResult } | { ok: false; reason: string };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function periodDays(period: TariffPeriod): number {
  if (!period.startDate || !period.endDate) return 365;
  const [startMonth, startDay] = period.startDate.split("-").map(Number);
  const [endMonth, endDay] = period.endDate.split("-").map(Number);
  const start = Date.UTC(2025, startMonth - 1, startDay);
  const end = Date.UTC(2025, endMonth - 1, endDay);
  let days = (end - start) / 86400000 + 1;
  if (days <= 0) days += 365;
  return Number.isFinite(days) && days > 0 ? days : 365;
}

function blockCostDetails(rates: PublishedRate[] | undefined, usageKwh: number, days: number, period?: string): { total: number; tiers: Array<{ kwh: number; unitPrice: number; cost: number }> } {
  if (!rates?.length) return { total: 0, tiers: [] };
  let remaining = Math.max(0, usageKwh);
  let total = 0;
  const tiers: Array<{ kwh: number; unitPrice: number; cost: number }> = [];
  rates.forEach((rate, index) => {
    if (remaining <= 0) return;
    let volume = rate.volume == null ? Number.POSITIVE_INFINITY : Math.max(0, number(rate.volume));
    if (rate.volume != null && period === "P1D") volume *= days;
    else if (rate.volume != null && period === "P1M") volume *= days * 12 / 365;
    if (index === rates.length - 1) volume = Number.POSITIVE_INFINITY;
    const used = Math.min(remaining, volume);
    const unitPrice = Math.max(0, number(rate.unitPrice));
    const cost = used * unitPrice;
    total += cost;
    tiers.push({ kwh: used, unitPrice, cost });
    remaining -= used;
  });
  return { total, tiers };
}

function time(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = value.match(/^(\d{1,2})(?::?)(\d{2})?/);
  if (!match) return fallback;
  return Number(match[1]) + Number(match[2] || 0) / 60;
}

function matchesWindow(day: number, bin: number, windows: TimeWindow[] | undefined): boolean {
  if (!windows?.length) return true;
  const hour = bin / 2 + 0.25;
  return windows.some((window) => {
    const days = new Set<number>();
    (window.days || []).forEach((raw) => {
      const key = String(raw).toUpperCase();
      if (key === "BUSINESS_DAYS" || key === "WEEKDAYS") [0, 1, 2, 3, 4].forEach((value) => days.add(value));
      else if (DAY_INDEX[key] != null) days.add(DAY_INDEX[key]);
      else if (DAY_INDEX[key.slice(0, 3)] != null) days.add(DAY_INDEX[key.slice(0, 3)]);
    });
    if (!days.size) for (let index = 0; index < 7; index += 1) days.add(index);
    if (!days.has(day)) return false;
    const start = time(window.startTime, 0);
    let end = time(window.endTime, 24);
    if (end === 0) end = 24;
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  });
}

function windowSummary(windows: TimeWindow[] | undefined): string {
  if (!windows?.length) return "all hours";
  return windows.map((window) => {
    const days = (window.days || []).map((day) => String(day).slice(0, 3).toUpperCase());
    let dayLabel = "";
    if (days.length === 7) dayLabel = "Mon-Sun ";
    else if (["MON", "TUE", "WED", "THU", "FRI"].every((day) => days.includes(day)) && days.length === 5) dayLabel = "Mon-Fri ";
    else if (days.length) dayLabel = days.join(",") + " ";
    return `${dayLabel}${window.startTime || "00:00"}-${window.endTime === "00:00" ? "24:00" : window.endTime || "24:00"}`;
  }).join(" & ");
}

function profileFraction(profile: HalfHourlyGrid, windows: TimeWindow[] | undefined): number {
  let matched = 0;
  let total = 0;
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
    const value = number(profile[day]?.[bin]);
    total += value;
    if (matchesWindow(day, bin, windows)) matched += value;
  }
  return total > 0 ? matched / total : 0;
}

function priceFeedIn(contract: NativeElectricityContract, annualExportKwh: number, exportProfile: HalfHourlyGrid | undefined): { credit: number; effectiveRate: number } {
  if (!(annualExportKwh > 0)) return { credit: 0, effectiveRate: 0 };
  let effectiveRate = 0;
  for (const tariff of contract.solarFeedInTariff || []) {
    if (String(tariff.scheme || "").toUpperCase().includes("PREMIUM")) continue;
    const singleRate = number(tariff.singleTariff?.rates?.[0]?.unitPrice);
    effectiveRate = Math.max(effectiveRate, singleRate);
    if (tariff.timeVaryingTariffs?.length) {
      let weightedRate = 0;
      for (const variation of tariff.timeVaryingTariffs) {
        const rate = number(variation.rates?.[0]?.unitPrice);
        const windows = variation.timeVariations || variation.timeOfUse;
        weightedRate += rate * (exportProfile ? profileFraction(exportProfile, windows) : 0);
      }
      effectiveRate = Math.max(effectiveRate, weightedRate);
    }
  }
  return { credit: annualExportKwh * effectiveRate, effectiveRate };
}

function dateInPeriod(date: string, period: TariffPeriod): boolean {
  if (!period.startDate || !period.endDate) return true;
  const monthDay = Number(date.slice(4, 8));
  const start = Number(period.startDate.replace("-", ""));
  const end = Number(period.endDate.replace("-", ""));
  return start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end;
}

function measuredPeriodShare(series: Nem12AllocatedDay[] | undefined, period: TariffPeriod): number | null {
  if (!series?.length) return null;
  let total = 0;
  let inPeriod = 0;
  series.forEach((day) => {
    const dayTotal = day.general.reduce((sum, value) => sum + number(value), 0);
    total += dayTotal;
    if (dateInPeriod(day.date, period)) inPeriod += dayTotal;
  });
  return total > 0 ? inPeriod / total : null;
}

function measuredWindowFraction(series: Nem12AllocatedDay[] | undefined, period: TariffPeriod, windows: TimeWindow[] | undefined): number | null {
  if (!series?.length) return null;
  let total = 0;
  let matched = 0;
  series.filter((day) => dateInPeriod(day.date, period)).forEach((day) => {
    day.general.forEach((value, bin) => {
      const amount = number(value);
      total += amount;
      if (matchesWindow(day.dow, bin, windows)) matched += amount;
    });
  });
  return total > 0 ? matched / total : null;
}

function demandDayList(value: DemandCharge["days"]): string[] {
  if (Array.isArray(value)) return value;
  const days: string[] = [];
  if (value?.weekdays) days.push("MON", "TUE", "WED", "THU", "FRI");
  if (value?.saturday) days.push("SAT");
  if (value?.sunday) days.push("SUN");
  return days.length ? days : Object.keys(DAY_INDEX);
}

function tierDemand(value: number, charge: DemandCharge): number {
  const minimum = Math.max(0, number(charge.minDemand));
  const maximum = charge.maxDemand == null ? Number.POSITIVE_INFINITY : Math.max(minimum, number(charge.maxDemand));
  return Math.max(0, Math.min(value, maximum) - minimum);
}

function priceDemand(periods: TariffPeriod[], series: Nem12AllocatedDay[]): { total: number; peakKw: number; details: NativeAuditChargeLine[] } | null {
  let total = 0;
  let peakKw = 0;
  const details: NativeAuditChargeLine[] = [];
  for (const period of periods.filter((item) => item.rateBlockUType === "demandCharges")) {
    const periodSeries = series.filter((day) => dateInPeriod(day.date, period));
    for (const charge of period.demandCharges || []) {
      const measurement = String(charge.measurementPeriod || "").toUpperCase();
      const charging = String(charge.chargePeriod || "").toUpperCase();
      if (!((measurement === "DAY" && charging === "DAY") || (measurement === "MONTH" && (charging === "DAY" || charging === "MONTH")))) return null;
      const amount = number(charge.amount);
      if (amount < 0) return null;
      let billedKwUnits = 0;
      let chargeTotal = 0;
      let chargePeak = 0;
      const window: TimeWindow = { days: demandDayList(charge.days), startTime: charge.startTime, endTime: charge.endTime };
      const daily = periodSeries.map((day) => {
        let maximum = 0;
        let matched = false;
        for (let bin = 0; bin < 48; bin += 1) if (matchesWindow(day.dow, bin, [window])) {
          matched = true;
          maximum = Math.max(maximum, number(day.general[bin]) * 2);
        }
        return { date: day.date, demand: maximum, matched };
      });
      if (measurement === "DAY") {
        daily.filter((day) => day.matched).forEach((day) => {
          peakKw = Math.max(peakKw, day.demand);
          chargePeak = Math.max(chargePeak, day.demand);
          const billed = tierDemand(day.demand, charge);
          billedKwUnits += billed;
          chargeTotal += billed * amount;
        });
      } else {
        const months = new Map<string, { maximum: number; days: number }>();
        daily.forEach((day) => {
          const key = day.date.slice(0, 6);
          const month = months.get(key) || { maximum: 0, days: 0 };
          month.days += 1;
          if (day.matched) month.maximum = Math.max(month.maximum, day.demand);
          months.set(key, month);
        });
        months.forEach((month) => {
          peakKw = Math.max(peakKw, month.maximum);
          chargePeak = Math.max(chargePeak, month.maximum);
          const billed = tierDemand(month.maximum, charge) * (charging === "DAY" ? month.days : 1);
          billedKwUnits += billed;
          chargeTotal += billed * amount;
        });
      }
      total += chargeTotal;
      details.push({
        label: charge.displayName || `${measurement.toLowerCase()} measured demand`,
        quantity: `${billedKwUnits.toFixed(2)} billed kW units`,
        allocation: `${windowSummary([window])}; measured peak ${chargePeak.toFixed(2)} kW`,
        rate: `$${(amount * GST).toFixed(4)}/kW/${charging.toLowerCase()}`,
        amount: chargeTotal * GST,
      });
    }
  }
  return { total, peakKw, details };
}

function priceRateBlock(block: ControlledLoad, annualKwh: number, profile: HalfHourlyGrid): { cost: number; rates: NativeRateDisplay[]; details: NativeAuditChargeLine[] } | null {
  let usage = 0;
  const rates: NativeRateDisplay[] = [];
  const details: NativeAuditChargeLine[] = [];
  if (block.rateBlockUType === "singleRate" && block.singleRate?.rates?.length) {
    const priced = blockCostDetails(block.singleRate.rates, annualKwh, 365, block.singleRate.period);
    usage = priced.total;
    priced.tiers.forEach((tier, index) => details.push({
      label: `${block.displayName || "Controlled load"}${priced.tiers.length > 1 ? ` tier ${index + 1}` : ""}`,
      quantity: `${tier.kwh.toFixed(1)} kWh`, allocation: "separately metered controlled load",
      rate: `${(tier.unitPrice * GST * 100).toFixed(2)}c/kWh`, amount: tier.cost * GST,
    }));
    rates.push({ label: block.displayName || "Controlled load", centsPerKwh: number(block.singleRate.rates[0].unitPrice) * GST * 100 });
  } else if (block.rateBlockUType === "timeOfUseRates" && block.timeOfUseRates?.length) {
    const fractions = block.timeOfUseRates.map((rate) => profileFraction(profile, rate.timeOfUse));
    const totalFraction = fractions.reduce((sum, value) => sum + value, 0);
    block.timeOfUseRates.forEach((rate, index) => {
      const fraction = totalFraction > 0 ? fractions[index] / totalFraction : 1 / block.timeOfUseRates!.length;
      const priced = blockCostDetails(rate.rates, annualKwh * fraction, 365, rate.period);
      usage += priced.total;
      priced.tiers.forEach((tier, tierIndex) => details.push({
        label: `${(rate.type || block.displayName || "Controlled load").toLowerCase().replaceAll("_", " ")}${priced.tiers.length > 1 ? ` tier ${tierIndex + 1}` : ""}`,
        quantity: `${tier.kwh.toFixed(1)} kWh`, allocation: `${(fraction * 100).toFixed(1)}%; ${windowSummary(rate.timeOfUse)}`,
        rate: `${(tier.unitPrice * GST * 100).toFixed(2)}c/kWh`, amount: tier.cost * GST,
      }));
      if (rate.rates?.[0]) rates.push({ label: (rate.type || block.displayName || "Controlled load").toLowerCase().replaceAll("_", " "), centsPerKwh: number(rate.rates[0].unitPrice) * GST * 100 });
    });
  } else return null;
  const daily = number(block.dailyCharge) * 365;
  if (daily > 0) details.unshift({ label: `${block.displayName || "Controlled load"} daily charge`, quantity: "365 days", rate: `${(number(block.dailyCharge) * GST * 100).toFixed(2)}c/day`, amount: daily * GST });
  return { cost: (usage + daily) * GST, rates, details };
}

export function estimateNativePlan(plan: NativePlanInput, inputs: NativeEstimateInputs): NativeEstimateResult {
  const periods = plan.contract.tariffPeriod || [];
  if (!periods.length) return { ok: false, reason: "No tariff periods were published." };
  const hasDemand = periods.some((period) => period.rateBlockUType === "demandCharges");
  if (hasDemand && (!inputs.demandReady || !inputs.demandSeries?.length)) return { ok: false, reason: "Demand pricing requires a near-complete year of high-quality interval data." };
  const eligibility = (plan.contract.eligibility || []).map((item) => `${item.type || ""} ${item.information || item.description || ""}`).join(" ").toLowerCase();
  if (/batter/.test(eligibility) && !inputs.hasBattery) return { ok: false, reason: "A battery is required." };
  if (/existing_solar|with solar|solar panels|solar pv|solar system|have solar|solar customers/.test(eligibility) && !inputs.hasSolar) return { ok: false, reason: "Solar is required." };
  if (/electric vehicle|\bev\b/.test(eligibility) && !inputs.hasEv) return { ok: false, reason: "An electric vehicle is required." };
  if (/controlled load|separately metered|off.?peak hot water/.test(eligibility) && inputs.annualControlledKwh <= 0) return { ok: false, reason: "A controlled load is required." };

  const energyPeriods = periods.filter((period) => period.rateBlockUType !== "demandCharges");
  const publishedDays = energyPeriods.reduce((sum, period) => sum + periodDays(period), 0);
  const normalizer = publishedDays >= 300 ? 365 / publishedDays : 1;
  let supplyExGst = 0;
  let usageExGst = 0;
  let hasTou = false;
  const rates: NativeRateDisplay[] = [];
  const mix: Record<string, number> = {};
  const supplyAudit: NativeAuditChargeLine[] = [];
  const usageAudit: NativeAuditChargeLine[] = [];
  energyPeriods.forEach((period) => {
    const days = periodDays(period) * normalizer;
    const measuredShare = measuredPeriodShare(inputs.intervalSeries, period);
    const share = measuredShare == null ? days / 365 : measuredShare;
    const periodKwh = inputs.annualGeneralKwh * share;
    const dailySupply = number(period.dailySupplyCharges ?? period.dailySupplyCharge);
    const supplyCost = dailySupply * days;
    supplyExGst += supplyCost;
    supplyAudit.push({
      label: `${period.startDate || "01-01"} to ${period.endDate || "12-31"} daily supply`,
      quantity: `${days.toFixed(1)} days`, rate: `${(dailySupply * GST * 100).toFixed(2)}c/day`, amount: supplyCost * GST,
    });
    if (period.rateBlockUType === "singleRate" && period.singleRate?.rates?.length) {
      const priced = blockCostDetails(period.singleRate.rates, periodKwh, days, period.singleRate.period);
      usageExGst += priced.total;
      priced.tiers.forEach((tier, tierIndex) => usageAudit.push({
        label: `Anytime usage${priced.tiers.length > 1 ? ` tier ${tierIndex + 1}` : ""}`,
        quantity: `${tier.kwh.toFixed(1)} kWh`, allocation: `${(share * 100).toFixed(1)}% ${measuredShare == null ? "calendar allocation" : "measured seasonal allocation"}`,
        rate: `${(tier.unitPrice * GST * 100).toFixed(2)}c/kWh`, amount: tier.cost * GST,
      }));
      const first = period.singleRate.rates[0];
      rates.push({ label: "anytime", centsPerKwh: number(first.unitPrice) * GST * 100 });
    } else if (period.rateBlockUType === "timeOfUseRates" && period.timeOfUseRates?.length) {
      hasTou = true;
      const fractions = period.timeOfUseRates.map((rate) => measuredWindowFraction(inputs.intervalSeries, period, rate.timeOfUse) ?? profileFraction(inputs.profile, rate.timeOfUse));
      const fractionTotal = fractions.reduce((sum, value) => sum + value, 0);
      period.timeOfUseRates.forEach((rate, index) => {
        const fraction = fractionTotal > 0 ? fractions[index] / fractionTotal : 1 / period.timeOfUseRates!.length;
        const type = (rate.type || "rate").toLowerCase().replaceAll("_", " ");
        const label = `${type}, ${windowSummary(rate.timeOfUse)}`;
        const priced = blockCostDetails(rate.rates, periodKwh * fraction, days, rate.period);
        usageExGst += priced.total;
        priced.tiers.forEach((tier, tierIndex) => usageAudit.push({
          label: `${label}${priced.tiers.length > 1 ? ` tier ${tierIndex + 1}` : ""}`,
          quantity: `${tier.kwh.toFixed(1)} kWh`, allocation: `${(fraction * share * 100).toFixed(1)}% of annual usage`,
          rate: `${(tier.unitPrice * GST * 100).toFixed(2)}c/kWh`, amount: tier.cost * GST,
        }));
        mix[label] = (mix[label] || 0) + fraction * share;
        if (rate.rates?.[0]) rates.push({ label, centsPerKwh: number(rate.rates[0].unitPrice) * GST * 100 });
      });
    }
  });

  let controlled = 0;
  let controlledRates: NativeRateDisplay[] = [];
  let controlledAudit: NativeAuditChargeLine[] = [];
  if (inputs.annualControlledKwh > 0) {
    if (plan.contract.controlledLoad?.length !== 1) return { ok: false, reason: "This household needs a single supported controlled-load tariff." };
    const priced = priceRateBlock(plan.contract.controlledLoad[0], inputs.annualControlledKwh, inputs.controlledProfile || inputs.profile);
    if (!priced) return { ok: false, reason: "The controlled-load tariff is unsupported." };
    controlled = priced.cost;
    controlledRates = priced.rates;
    controlledAudit = priced.details;
  }

  let demand = 0;
  let demandPeakKw = 0;
  let demandAudit: NativeAuditChargeLine[] = [];
  if (hasDemand) {
    const priced = priceDemand(periods, inputs.demandSeries!);
    if (!priced) return { ok: false, reason: "The published demand method is unsupported by the native engine." };
    demand = priced.total * GST;
    demandPeakKw = priced.peakKw;
    demandAudit = priced.details;
  }

  const supply = supplyExGst * GST;
  const usage = usageExGst * GST;
  const feedIn = priceFeedIn(plan.contract, Math.max(0, inputs.annualExportKwh || 0), inputs.exportProfile);
  let discounts = 0;
  const discountAudit: NativeAuditDiscountLine[] = [];
  (plan.contract.discounts || []).forEach((discount) => {
    const conditional = String(discount.type || "").toUpperCase() === "CONDITIONAL";
    const applied = !conditional || inputs.assumeConditional;
    let amount = 0;
    if (discount.methodUType === "percentOfBill") amount = (supply + usage + controlled + demand) * number(discount.percentOfBill?.rate);
    else if (discount.methodUType === "percentOfUse") amount = usage * number(discount.percentOfUse?.rate);
    else if (discount.methodUType === "fixedAmount") amount = number(discount.fixedAmount?.amount);
    if (applied) discounts += amount;
    discountAudit.push({ label: discount.displayName || "Published discount", method: discount.methodUType || "unsupported", conditional, applied, amount: applied ? amount : 0 });
  });
  const firstEnergyPeriod = energyPeriods[0];
  const annualCost = supply + usage + controlled + demand - feedIn.credit - discounts;
  const componentTotal = supply + usage + controlled + demand - feedIn.credit - discounts;
  const eligibilityLines = (plan.contract.eligibility || []).map((item) => item.information || item.description || item.type || "").filter(Boolean);
  const feedInAudit: NativeAuditChargeLine[] = feedIn.credit > 0 ? [{
    label: "Solar feed-in credit", quantity: `${Math.max(0, inputs.annualExportKwh || 0).toFixed(1)} kWh`,
    allocation: "effective rate weighted against the export timing profile", rate: `${(feedIn.effectiveRate * 100).toFixed(2)}c/kWh`, amount: feedIn.credit,
  }] : [];
  return { ok: true, result: {
    ...plan,
    annualCost,
    supply,
    usage,
    controlled,
    demand,
    demandPeakKw,
    feedIn: feedIn.credit,
    feedInCentsPerKwh: feedIn.effectiveRate * 100,
    discounts,
    tariffKind: hasDemand ? "demand" : hasTou ? "tou" : "single",
    supplyCentsPerDay: number(firstEnergyPeriod?.dailySupplyCharges ?? firstEnergyPeriod?.dailySupplyCharge) * GST * 100,
    rates,
    controlledRates,
    touMix: hasTou ? mix : null,
    audit: {
      engineVersion: NATIVE_ENGINE_VERSION,
      evidenceLabel: inputs.evidenceLabel || "Usage profile supplied to the native engine.",
      inputs: { annualGeneralKwh: inputs.annualGeneralKwh, annualControlledKwh: inputs.annualControlledKwh, annualExportKwh: Math.max(0, inputs.annualExportKwh || 0) },
      registers: inputs.registerEvidence || [],
      supply: supplyAudit,
      usage: usageAudit,
      controlled: controlledAudit,
      demand: demandAudit,
      feedIn: feedInAudit,
      discounts: discountAudit,
      reconciliation: {
        supply, usage, controlled, demand, feedIn: -feedIn.credit, discounts: -discounts,
        componentTotal, rankedTotal: annualCost, difference: componentTotal - annualCost,
      },
      eligibility: eligibilityLines,
      limitations: plan.validation?.limitations || [],
    },
  } };
}
