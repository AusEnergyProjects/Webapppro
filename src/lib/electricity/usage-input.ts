export type UsagePeriod = "quarterly" | "monthly" | "annual";

const PERIOD_MULTIPLIERS: Record<UsagePeriod, number> = {
  quarterly: 4,
  monthly: 12,
  annual: 1,
};

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

