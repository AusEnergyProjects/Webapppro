export type UsagePeriod = "quarterly" | "monthly" | "annual";
export type ElectricityUsageMode = "annual" | "bill";

export const AEMO_NSLP_REFERENCE_VERSION = "AEMO frozen NSLP 2025 weeks 01-52";
export const AEMO_NSLP_REFERENCE_URL = "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/metering-data/load-profiles";

type ElectricityUsageInput = {
  usageKwh: number;
  mode: ElectricityUsageMode;
  billStart?: string;
  billEnd?: string;
  distributor?: string;
  postcode?: string;
};

export type AnnualisedElectricityUsage =
  | { ok: true; annualKwh: number; billDays: number | null; profileShare: number; profileAreas: string[]; source: "annual" | "nslp-seasonal" }
  | { ok: false; error: string };

const PERIOD_MULTIPLIERS: Record<UsagePeriod, number> = {
  quarterly: 4,
  monthly: 12,
  annual: 1,
};

const DAY_MS = 86_400_000;
const REFERENCE_WEIGHT = 0.35;

/*
 * Monthly shares derived from AEMO's frozen 2025 NSLP files on 16 July 2026.
 * The public profile is an aggregate settlement shape, so annualisation blends a
 * bounded 35% of its seasonal signal with calendar-day weighting. This avoids
 * treating volatile residual network load as an individual household forecast.
 */
const NSLP_MONTH_SHARES_2025: Record<string, number[]> = {
  ACTEWAGL: [0.06639925, 0.06262454, 0.06400972, 0.060018, 0.09056961, 0.13822636, 0.13395088, 0.11598405, 0.08616309, 0.06522194, 0.05788475, 0.05894781],
  AURORA: [0.10377695, 0.09376615, 0.10377695, 0.10042931, 0.10378478, 0.10058668, 0.07487396, 0.0667994, 0.06451419, 0.06294271, 0.06037162, 0.06437728],
  CITIPOWER: [0.04325855, 0.10544052, 0.05595134, 0.07989875, 0.03436068, 0.07288758, 0.25697427, 0.11150204, 0.06465434, 0.06545767, 0.06193169, 0.04768257],
  COUNTRYENERGY: [0.08970663, 0.07856392, 0.08012706, 0.0677308, 0.08314683, 0.11045741, 0.11385066, 0.09847467, 0.07536368, 0.06703535, 0.0641648, 0.07137819],
  ENERGEX: [0.10940596, 0.09440617, 0.09059849, 0.07223959, 0.07118254, 0.08342694, 0.08825637, 0.08003151, 0.06410807, 0.07472051, 0.08122244, 0.0904014],
  ENERGYAUST: [0.08324895, 0.07812826, 0.08175311, 0.06807832, 0.0831941, 0.11207082, 0.1136752, 0.10474643, 0.06995897, 0.06593277, 0.06558151, 0.07363155],
  ERGON1: [0.1117923, 0.09051926, 0.09690256, 0.08118271, 0.07992534, 0.08000657, 0.0775587, 0.07378505, 0.06851208, 0.07893744, 0.0782542, 0.0826238],
  INTEGRAL: [0.08920546, 0.08443618, 0.08560715, 0.07093335, 0.08177298, 0.10581471, 0.10555111, 0.09384278, 0.06890432, 0.06832827, 0.06790394, 0.07769975],
  POWERCOR: [0.04985842, 0.04019692, 0.04007659, 0.03911986, 0.07260153, 0.12816387, 0.12779599, 0.11603074, 0.11678192, 0.10743789, 0.08869918, 0.07323709],
  TXU: [0.09137752, 0.06911922, 0.06672251, 0.06712929, 0.05527778, 0.08195222, 0.10254975, 0.09248267, 0.10374948, 0.09657355, 0.08820441, 0.08486162],
  UMPLP: [0.08717488, 0.0833309, 0.08259101, 0.06430829, 0.07981966, 0.10470602, 0.12130311, 0.10322816, 0.07768029, 0.06694734, 0.06239725, 0.0665131],
  UNITED: [0.11866422, 0.10143527, 0.09415408, 0.08923446, 0.05870567, 0.09468823, 0.09428452, 0.07739373, 0.06714357, 0.073447, 0.06046779, 0.07038145],
  VICAGL: [0.08632495, 0.08711492, 0.08907726, 0.06969854, 0.09084879, 0.12747263, 0.12165805, 0.09550096, 0.06853137, 0.0554324, 0.05628217, 0.05205795],
};

const DISTRIBUTOR_PROFILE_AREA: Record<string, string> = {
  Ausgrid: "ENERGYAUST",
  "Endeavour Energy": "INTEGRAL",
  "Essential Energy": "COUNTRYENERGY",
  Evoenergy: "ACTEWAGL",
  Energex: "ENERGEX",
  "Ergon Energy": "ERGON1",
  "SA Power Networks": "UMPLP",
  TasNetworks: "AURORA",
  CitiPower: "CITIPOWER",
  Powercor: "POWERCOR",
  Jemena: "VICAGL",
  "United Energy": "UNITED",
  "AusNet Services": "TXU",
};

const STATE_PROFILE_AREAS: Record<string, string[]> = {
  ACT: ["ACTEWAGL"],
  NSW: ["ENERGYAUST", "INTEGRAL", "COUNTRYENERGY"],
  QLD: ["ENERGEX", "ERGON1"],
  SA: ["UMPLP"],
  TAS: ["AURORA"],
  VIC: ["CITIPOWER", "POWERCOR", "VICAGL", "UNITED", "TXU"],
};

function postcodeState(postcode: string | undefined): string | null {
  const value = Number(postcode);
  if ((value >= 2600 && value <= 2618) || (value >= 2900 && value <= 2920)) return "ACT";
  if (value >= 2000 && value <= 2999) return "NSW";
  if (value >= 3000 && value <= 3999) return "VIC";
  if (value >= 4000 && value <= 4999) return "QLD";
  if (value >= 5000 && value <= 5999) return "SA";
  if (value >= 7000 && value <= 7999) return "TAS";
  return null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function profileAreas(distributor?: string, postcode?: string): string[] {
  const direct = distributor ? DISTRIBUTOR_PROFILE_AREA[distributor] : undefined;
  if (direct) return [direct];
  const state = postcodeState(postcode);
  return state ? STATE_PROFILE_AREAS[state] : Object.keys(NSLP_MONTH_SHARES_2025);
}

export function electricityReferenceMonthShares(distributor?: string, postcode?: string): { shares: number[]; areas: string[] } {
  const areas = profileAreas(distributor, postcode);
  const calendarShares = Array.from({ length: 12 }, (_, month) => daysInMonth(2025, month) / 365);
  const averageRaw = calendarShares.map((_, month) => areas.reduce((sum, area) => sum + NSLP_MONTH_SHARES_2025[area][month], 0) / areas.length);
  const bounded = averageRaw.map((share, month) => {
    const calendar = calendarShares[month];
    const boundedSignal = calendar * Math.min(1.5, Math.max(0.65, share / calendar));
    return calendar * (1 - REFERENCE_WEIGHT) + boundedSignal * REFERENCE_WEIGHT;
  });
  const total = bounded.reduce((sum, share) => sum + share, 0);
  return { shares: bounded.map((share) => share / total), areas };
}

export function annualiseElectricityUsage(input: ElectricityUsageInput): AnnualisedElectricityUsage {
  if (!Number.isFinite(input.usageKwh) || input.usageKwh <= 0) return { ok: false, error: "Enter electricity use greater than 0 kWh." };
  if (input.mode === "annual") return { ok: true, annualKwh: input.usageKwh, billDays: null, profileShare: 1, profileAreas: [], source: "annual" };

  const start = parseDate(input.billStart);
  const end = parseDate(input.billEnd);
  if (!start || !end) return { ok: false, error: "Enter the first and last date covered by the electricity bill." };
  const billDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (billDays < 14) return { ok: false, error: "The bill period must cover at least 14 days." };
  if (billDays > 366) return { ok: false, error: "The bill period cannot be longer than 366 days." };

  const reference = electricityReferenceMonthShares(input.distributor, input.postcode);
  let profileShare = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    profileShare += reference.shares[cursor.getUTCMonth()] / daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth());
  }
  if (!(profileShare > 0)) return { ok: false, error: "The bill period could not be annualised." };
  return {
    ok: true,
    annualKwh: input.usageKwh / profileShare,
    billDays,
    profileShare,
    profileAreas: reference.areas,
    source: "nslp-seasonal",
  };
}

export function annualiseUsage(value: string | number, period: UsagePeriod): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount * PERIOD_MULTIPLIERS[period] : 0;
}

export function usageForPeriod(annualKwh: string | number, period: UsagePeriod): string {
  if (annualKwh === "") return "";
  const annual = Number(annualKwh);
  if (!Number.isFinite(annual)) return "";
  const value = annual / PERIOD_MULTIPLIERS[period];
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
