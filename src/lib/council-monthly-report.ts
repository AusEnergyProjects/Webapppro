import type { CouncilCommunityReport } from "./council-community";
import type { CouncilProfile } from "./council-profile";
import type { CouncilReport } from "./council-reporting";
import type { CouncilVeuReport } from "./council-veu";

export type CouncilMonthlySettingsInput = { enabled: boolean; recipients: string[] };
export type CouncilMonthlyReportBundle = {
  profile: CouncilProfile;
  community: CouncilCommunityReport;
  veu: CouncilVeuReport | null;
  tlink: CouncilReport;
  generatedAt: string;
  demonstration: boolean;
};
export type CouncilMonthlySettings = {
  enabled: boolean; recipients: string[]; canManage: boolean;
  latestSourceAsOf: string | null; nextEligibleAt: string | null;
  lastReport: { id: string; sourceAsOf: string; generatedAt: string; status: string; acceptedRecipients: number; totalRecipients: number } | null;
  emailConfigured: boolean;
};

export function parseCouncilMonthlySettings(value: unknown): CouncilMonthlySettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter the monthly report settings.");
  const entries = Object.entries(value);
  if (entries.some(([key]) => !["enabled", "recipients"].includes(key))) throw new Error("Unsupported report setting.");
  const input = Object.fromEntries(entries);
  if (typeof input.enabled !== "boolean" || !Array.isArray(input.recipients) || input.recipients.length > 10) throw new Error("Choose up to 10 report recipients.");
  const recipients: string[] = [];
  for (const raw of input.recipients) {
    if (typeof raw !== "string" || raw.length > 254 || /[\r\n\u0000]/.test(raw)) throw new Error("Enter a valid recipient email address.");
    const address = raw.trim().toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(address)) throw new Error("Enter a valid recipient email address.");
    if (!recipients.includes(address)) recipients.push(address);
  }
  if (input.enabled && !recipients.length) throw new Error("Add a recipient before enabling monthly reports.");
  return { enabled: input.enabled, recipients };
}

/** A postcode change invalidates queued reports even when the number of postcodes is unchanged. */
export function councilMonthlyScopeKey(scope: { id?: string; councilId?: string; state: string; postcodes: string[] }): string {
  const id = scope.id ?? scope.councilId;
  if (!id || !/^[A-Z]{2,3}$/.test(scope.state) || !scope.postcodes.length || scope.postcodes.length > 100 || scope.postcodes.some(value => !/^\d{4}$/.test(value))) throw new Error("Invalid council report scope.");
  return JSON.stringify([id, scope.state, [...new Set(scope.postcodes)].sort()]);
}

export function councilMonthlyFilename(profile: Pick<CouncilProfile, "name">, sourceAsOf: string, demo = false): string {
  const name = profile.name.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "Council";
  return `${demo ? "DEMONSTRATION-" : ""}${name}-energy-progress-${sourceAsOf}.pdf`;
}
