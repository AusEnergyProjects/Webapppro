import { HEATING_MONTH_SHARES, type GasUsageProfile } from "./gas-tariff-engine.ts";

export type GasUsageInputMode = "annual" | "bill";

type GasUsageInput = {
  usageMj: number;
  mode: GasUsageInputMode;
  profile: GasUsageProfile;
  billStart?: string;
  billEnd?: string;
};

export type AnnualisedGasUsage =
  | { ok: true; annualMj: number; billDays: number | null; profileShare: number }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function dailyProfileShare(date: Date, profile: GasUsageProfile): number {
  const yearDays = (Date.UTC(date.getUTCFullYear() + 1, 0, 1) - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS;
  if (profile === "steady") return 1 / yearDays;
  return HEATING_MONTH_SHARES[date.getUTCMonth()] / daysInMonth(date.getUTCFullYear(), date.getUTCMonth());
}

export function annualiseGasUsage(input: GasUsageInput): AnnualisedGasUsage {
  if (!Number.isFinite(input.usageMj) || input.usageMj <= 0) return { ok: false, error: "Enter gas use greater than 0 MJ." };
  if (input.mode === "annual") return { ok: true, annualMj: input.usageMj, billDays: null, profileShare: 1 };

  const start = parseDate(input.billStart);
  const end = parseDate(input.billEnd);
  if (!start || !end) return { ok: false, error: "Enter the first and last date covered by the gas bill." };
  const billDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (billDays < 14) return { ok: false, error: "The bill period must cover at least 14 days." };
  if (billDays > 366) return { ok: false, error: "The bill period cannot be longer than 366 days." };

  let profileShare = 0;
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    profileShare += dailyProfileShare(cursor, input.profile);
  }
  if (!(profileShare > 0)) return { ok: false, error: "The bill period could not be annualised." };
  return { ok: true, annualMj: input.usageMj / profileShare, billDays, profileShare };
}
