import { requireCouncilAccess, type CouncilAccessScope } from "./council-access-server";
import { loadCouncilReport } from "./council-reporting-server";
import { loadCouncilEnquiries } from "./council-enquiries-server";
import type { CouncilBreakdown, CouncilReport } from "./council-reporting";
import { WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import { WattzunWorkContextError, type WattzunWorkContext, type WattzunWorkReference } from "./wattzun-work-context";

const REPORT_HREF = "/council?workspace=reports";
const MAX_CONTEXT_BYTES = 24_000;

function authority(council: CouncilAccessScope) {
  return { id: council.id, name: council.name, state: council.state, role: council.role, postcodes: [...council.postcodes].sort() };
}

function breakdown(row: CouncilBreakdown) {
  return { key: row.key, label: row.label, completedJobs: row.completedJobs, completedValueCents: row.completedValueCents,
    localJobs: row.localJobs, veecQuantity: row.veecQuantity, stcQuantity: row.stcQuantity, estimatedTonnesCo2e: row.estimatedTonnesCo2e };
}

function metrics(report: CouncilReport) {
  const value = report.metrics;
  return { completedJobs: value.completedJobs, completedValueCents: value.completedValueCents,
    localJobs: value.localJobs, outsideJobs: value.outsideJobs, unknownLocalityJobs: value.unknownLocalityJobs,
    localSharePercent: value.localSharePercent, registeredLocalBusinesses: value.registeredLocalBusinesses,
    attributedEnquiries: value.attributedEnquiries, attributedCompletedJobs: value.attributedCompletedJobs,
    veecQuantity: value.veecQuantity, stcQuantity: value.stcQuantity, estimatedTonnesCo2e: value.estimatedTonnesCo2e };
}

/** The model receives only the existing protected report, never underlying customer or job rows. */
export async function loadWattzunCouncilContext(request: Request, access: WattzunAccess,
  reference: Extract<WattzunWorkReference, { kind: "council_report" }>): Promise<WattzunWorkContext> {
  if (access.scope.portal !== "council") throw new WattzunAccessError(403, "Choose a council workspace to explain its report.");
  const selected = await requireCouncilAccess(request, access.scope.scopeId);
  if (!selected.ok) throw new WattzunAccessError(selected.response.status, "Current council access is required to explain this report.");
  if (selected.identity.uid !== access.actorUid || selected.council.id !== access.scope.scopeId) {
    throw new WattzunAccessError(403, "Current access to the selected council is required.");
  }
  const scope = authority(selected.council);
  const input = { councilId: scope.id, name: scope.name, state: scope.state, postcodes: scope.postcodes, period: reference.period };
  const now = new Date();
  const [report, enquiries] = await Promise.all([
    loadCouncilReport(selected.db, input, now), loadCouncilEnquiries(selected.db, input, now),
  ]);
  const current = await requireCouncilAccess(request, scope.id);
  if (!current.ok) throw new WattzunAccessError(current.response.status, "Current council access is required to explain this report.");
  if (current.identity.uid !== access.actorUid) throw new WattzunAccessError(403, "Your council sign-in changed. Reopen the report.");
  if (JSON.stringify(authority(current.council)) !== JSON.stringify(scope)) {
    throw new WattzunWorkContextError(409, "Your council access or reporting area changed. Refresh the report before asking Wattzun.");
  }
  if (report.mode !== "live" || report.scope.councilId !== scope.id || report.scope.state !== scope.state
    || JSON.stringify([...report.scope.postcodes].sort()) !== JSON.stringify(scope.postcodes) || report.period.key !== reference.period) {
    throw new WattzunWorkContextError(503, "The current council report could not be verified. Refresh the report and try again.");
  }
  const quality = report.dataQuality;
  const stableFacts = {
    scope: { councilId: scope.id, name: scope.name, state: scope.state, postcodes: scope.postcodes },
    permissions: { role: scope.role, canManage: scope.role === "owner" || scope.role === "editor" },
    period: { key: report.period.key, label: report.period.label, start: report.period.start, end: report.period.end, timeZone: report.period.timeZone },
    metrics: metrics(report),
    activities: report.activities.map(breakdown),
    postcodes: report.postcodes.map(row => ({ ...breakdown(row), registeredLocalBusinesses: row.registeredLocalBusinesses })),
    trend: report.trend.map(row => ({ ...breakdown(row), start: row.start, end: row.end })),
    campaigns: report.campaigns.map(row => ({ name: row.name, channel: row.channel, enquiries: row.enquiries,
      completedJobs: row.completedJobs, completedValueCents: row.completedValueCents })),
    enquiries: { total: enquiries.total, suppressed: enquiries.suppressed,
      postcodes: enquiries.postcodes.map(row => ({ postcode: row.postcode, count: row.count })),
      trend: enquiries.trend.map(row => ({ month: row.month, count: row.count })) },
    quality: { minimumCohort: quality.minimumCohort, suppressed: quality.suppressed, suppressedBreakdowns: [...quality.suppressedBreakdowns],
      missingInvoice: quality.missingInvoice, missingLocality: quality.missingLocality, missingCarbonMethod: quality.missingCarbonMethod,
      impactEvidence: quality.impactEvidence, impactCoverageJobs: quality.impactCoverageJobs, coverageNote: quality.coverageNote },
    methodology: [...report.methodology],
  };
  const context: WattzunWorkContext = {
    reference: { kind: "council_report", period: reference.period }, title: `${scope.name}: ${report.period.label}`,
    sourceSha256: "0".repeat(64),
    sources: [
      { id: "council_report_metrics", label: "Council report figures", href: REPORT_HREF, description: "Protected TLink completed-work, value and local participation totals for the stated period and full approved area." },
      { id: "council_report_breakdowns", label: "Activity and postcode breakdowns", href: REPORT_HREF, description: "The report's protected activity, postcode and monthly figures. Withheld values remain unavailable." },
      { id: "council_report_enquiries", label: "Community enquiries and attribution", href: REPORT_HREF, description: "Protected enquiry and campaign figures; enquiries and completions use their respective dates." },
      { id: "council_report_quality", label: "Coverage and privacy", href: REPORT_HREF, description: "Small-cohort protection, missing evidence and impact coverage for this report." },
      { id: "council_report_methodology", label: "Reporting methodology", href: REPORT_HREF, description: "Definitions and calculation basis, including provider-accepted certificates and lifetime VEU estimates." },
    ],
    facts: { generatedAt: report.generatedAt, ...stableFacts },
    limitations: [
      "This context contains recorded TLink reporting only. It has not loaded the separate CER or public VEU community reports.",
      "Null and withheld values are unavailable, not zero. Do not reconstruct protected figures by subtraction or infer individual customers.",
      "Reported work value excludes GST and is not council revenue, employment created or total local economic impact.",
      "VEU abatement is a deemed lifetime estimate, not annual measured savings. STCs and VEECs are separate units; provider acceptance is not registry issuance.",
      "Campaign attribution is not proof of additional impact, and enquiry/completion totals are not a conversion rate.",
      "This is read-only context. It cannot change reports, council access, campaigns or customer records.",
    ],
  };
  const encoder = new TextEncoder();
  if (encoder.encode(JSON.stringify(context)).byteLength > MAX_CONTEXT_BYTES) {
    throw new WattzunWorkContextError(413, "This council report is too large for Wattzun to explain in one request. Use the report and its methodology directly.");
  }
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify({ actorUid: access.actorUid, reference: context.reference, facts: stableFacts })));
  context.sourceSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  return context;
}
