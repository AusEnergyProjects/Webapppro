import { australiaLocalDateTime } from "./trade-schedule.ts";
import { reportWindow } from "./trade-business-reports.ts";

export const COUNCIL_MINIMUM_COHORT = 5 as const;
export type CouncilPeriodKey = "quarter" | "year" | "all";
export type CouncilReportInput = { councilId: string; name: string; state: string; postcodes: string[]; period: CouncilPeriodKey };
export type CouncilReportPeriod = { key: CouncilPeriodKey; label: string; start: string; end: string; timeZone: string };
export type CouncilMeasures = {
  completedJobs: number | null; completedValueCents: number | null;
  localJobs: number | null; outsideJobs: number | null; unknownLocalityJobs: number | null;
  localSharePercent: number | null; registeredLocalBusinesses: number | null;
  attributedEnquiries: number | null; attributedCompletedJobs: number | null;
  veecQuantity: number | null; stcQuantity: number | null; estimatedTonnesCo2e: number | null;
};
export type CouncilBreakdown = { key: string; label: string; completedJobs: number | null; completedValueCents: number | null; localJobs: number | null; veecQuantity: number | null; stcQuantity: number | null; estimatedTonnesCo2e: number | null };
export type CouncilPostcodeBreakdown = CouncilBreakdown & { registeredLocalBusinesses: number | null };
export type CouncilMapCell = { postcode: string; label: string; position: { lat: number; lng: number } | null; completedJobs: number | null; registeredLocalBusinesses: number | null };
export type CouncilCampaignReport = { id: string; name: string; referenceCode: string; channel: string; enquiries: number | null; completedJobs: number | null; completedValueCents: number | null };
export type CouncilEnquirySummary = { total: number | null; postcodes: Array<{ postcode: string; count: number | null }>; trend: Array<{ month: string; count: number | null }>; suppressed: boolean };
export type CouncilReport = {
  enquiries?: CouncilEnquirySummary;
  generatedAt: string; mode: "live" | "demonstration";
  scope: Omit<CouncilReportInput, "period">;
  period: CouncilReportPeriod;
  metrics: CouncilMeasures;
  activities: CouncilBreakdown[]; postcodes: CouncilPostcodeBreakdown[];
  map: { coordinateBasis: "postcode_centroid"; cells: CouncilMapCell[]; boundaryNote: string };
  trend: Array<CouncilBreakdown & { start: string; end: string }>;
  campaigns: CouncilCampaignReport[];
  dataQuality: { minimumCohort: typeof COUNCIL_MINIMUM_COHORT; suppressed: boolean; suppressedBreakdowns: string[]; missingInvoice: number | null; missingLocality: number | null; missingCarbonMethod: boolean; impactEvidence: "unavailable" | "provider_accepted" | "demonstration"; impactCoverageJobs: number | null; coverageNote: string };
  methodology: string[];
};

export class CouncilReportInputError extends Error {}

export function councilReportPeriod(period: CouncilPeriodKey, state: string, now = new Date()) {
  if (!["quarter", "year", "all"].includes(period)) throw new CouncilReportInputError("Choose this quarter, this year or all time.");
  const zones: Record<string, string> = { ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane", SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth" };
  if (!zones[state] || !Number.isFinite(now.getTime())) throw new CouncilReportInputError("A valid council state and reporting date are required.");
  const today = australiaLocalDateTime(state, now).slice(0, 10);
  const [year, month] = today.split("-").map(Number);
  const start = period === "all" ? "1970-01-01" : period === "year" ? `${year}-01-01` : `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return { key: period, label: period === "quarter" ? "This quarter" : period === "year" ? "This year" : "All time", ...reportWindow(start, today, state), timeZone: zones[state] };
}

export function councilSmallCohort(count: number) { return count > 0 && count < COUNCIL_MINIMUM_COHORT; }

export const COUNCIL_REPORT_METHODOLOGY = [
  "Reporting covers completed work recorded in TLink within the council's approved postcode area. It does not measure all activity in the municipality. Postcodes can cross council boundaries.",
  "A completed job is an active work order currently marked completed with a recorded completion event. Each job is counted once under its primary activity, including jobs with several activities.",
  "Work value is recorded issued TLink invoicing less issued credits, in AUD excluding GST, for those completed jobs. Quotes, estimates and unissued invoices are excluded. This is work value, not council revenue or total local economic impact.",
  "Local means the delivering business's recorded business address is in the approved council postcode area and state. Service coverage is not a business location. Unknown business locations are reported separately. Work orders do not measure employment created.",
  "Only active businesses with an authoritative approved ABN review are counted as registered local trades. Synthetic accounts and their work are excluded from live reporting.",
  "Map areas show postcode centroids, not customer or business addresses. Highlighted reporting areas are approximate and are not official council boundaries. Approved local business profiles are automatically visible in the trade directory to authorised council users, so business counts are shown directly. Customer and completed-work cohorts remain protected.",
  "Council referrals record an explicit campaign reference linked to an opportunity. Referrals demonstrate attribution, not proof that the activity would not otherwise have occurred. Campaign enquiry counts use referral date; completed work uses completion date.",
  "STCs and VEECs are separate scheme units and must not be added together. STCs are not tonnes of carbon. Carbon estimates require a documented emissions method, timeframe and protection against counting the same upgrade twice.",
  "Impact totals include only immutable, independently reviewed certificate packets with a retained, hash-verified provider acceptance, linked to the current completed job and case revision. Provider acceptance is not proof of registry issuance. Multiple ambiguous packets for the same job and scheme are withheld.",
  "VEEC quantities represent deemed lifetime tonnes of CO2 equivalent under VEU. Displayed abatement uses accepted VEEC quantities only, excludes STCs and is not annual or measured emissions reduction. Trend displays the latest 12 months of the selected period; all-time headline totals retain the complete history.",
  "Customer names, addresses, contacts, ABNs and job identifiers are never included. Small cohorts and complementary breakdowns are withheld. The minimum cohort is five distinct customer records, not proof of five distinct people. Live reports use fixed periods and the full approved area; changing totals over time are not a guarantee of anonymity.",
];
