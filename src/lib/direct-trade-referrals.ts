export const ACTIVE_REFERRAL_BILLING_STATUSES = new Set([
  "active",
  "active_cancels_at_period_end",
]);

const REFERRAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeReferralCode(value: unknown) {
  if (typeof value !== "string") return "";
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith("AEA") || compact.length !== 13) return "";
  return `AEA-${compact.slice(3)}`;
}

export function generateReferralCode(randomBytes?: Uint8Array) {
  const bytes = randomBytes || crypto.getRandomValues(new Uint8Array(10));
  if (bytes.length < 10) throw new Error("REFERRAL_RANDOMNESS_REQUIRED");
  let suffix = "";
  for (let index = 0; index < 10; index += 1) {
    suffix += REFERRAL_ALPHABET[bytes[index] % REFERRAL_ALPHABET.length];
  }
  return `AEA-${suffix}`;
}

export function addCalendarMonthUnix(timestamp: number) {
  if (!Number.isInteger(timestamp) || timestamp <= 0)
    throw new Error("REFERRAL_EXTENSION_DATE_INVALID");
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDayNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(month + 1);
  result.setUTCFullYear(year + Math.floor((month + 1) / 12));
  result.setUTCDate(Math.min(day, lastDayNextMonth));
  return Math.floor(result.getTime() / 1000);
}

export function referralStatusLabel(status: string) {
  const labels: Record<string, string> = {
    registered: "Joined, membership not started",
    review_required: "Waiting for eligibility review",
    qualified: "First payment confirmed",
    rewarding: "Applying both free months",
    rewarded: "Both free months applied",
    reward_failed: "Reward retry required",
    rejected: "Not eligible",
  };
  return labels[status] || status.replaceAll("_", " ");
}
