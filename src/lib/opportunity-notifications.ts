export const OPPORTUNITY_INBOX_URL =
  "https://compare.ausenergyassessments.com/direct-trade/dashboard?workspace=leads#opportunity-inbox";

type OpportunityNotificationDraftInput = {
  businessName: string;
  sourceKind?: "customer_project" | "public_plan_enquiry" | "legacy_marketplace";
  customerName?: string;
  customerMessage?: string;
  suburb: string;
  postcode: string;
  state: string;
  matchedCategories: string[];
  timing: string;
  expiresAt: string;
  customerSharedEvidenceCount: number;
};

export type OpportunityNotificationSourceKind =
  | "customer_project"
  | "public_plan_enquiry"
  | "legacy_marketplace";

export function opportunityNotificationEmailPreferenceAllows(
  sourceKind: OpportunityNotificationSourceKind,
  emailOpportunities: unknown,
) {
  return sourceKind === "public_plan_enquiry" || Boolean(emailOpportunities);
}

const CATEGORY_LABELS: Record<string, string> = {
  assessment: "Energy assessment",
  solar: "Rooftop solar",
  battery: "Home battery",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "draught-proofing": "Draught-proofing",
  insulation: "Insulation",
  glazing: "Glazing",
  "window-coverings": "Blinds, shutters and external shading",
  "ev-charging": "EV charging",
  other: "Energy upgrade",
};

const TIMING_LABELS: Record<string, string> = {
  urgent: "Urgent",
  within_3_months: "Within 3 months",
  planning: "Planning",
};

const AUSTRALIAN_STATES = new Set([
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
]);

function bounded(value: unknown, maximum: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function broadState(value: unknown) {
  const state = bounded(value, 3).toUpperCase();
  return AUSTRALIAN_STATES.has(state) ? state : "your service area";
}

function broadPostcode(value: unknown) {
  const postcode = bounded(value, 4);
  return /^\d{4}$/.test(postcode) ? postcode : "";
}

function broadLocation(suburbValue: unknown, postcodeValue: unknown, stateValue: unknown) {
  const suburb = bounded(suburbValue, 80);
  const postcode = broadPostcode(postcodeValue);
  const state = broadState(stateValue);
  const locality = [suburb, postcode].filter(Boolean).join(" ");
  return locality ? `${locality}, ${state}` : state;
}

function serviceLabels(values: unknown) {
  if (!Array.isArray(values)) return ["Energy upgrade"];
  const labels = Array.from(new Set(values
    .map((value) => CATEGORY_LABELS[bounded(value, 40)])
    .filter((value): value is string => Boolean(value))));
  return labels.length ? labels.slice(0, 8) : ["Energy upgrade"];
}

function expiryLabel(value: unknown) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "Check the signed-in workspace";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(parsed);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function opportunityNotificationDraft(input: OpportunityNotificationDraftInput) {
  const businessName = bounded(input.businessName, 120) || "Your business";
  const location = broadLocation(input.suburb, input.postcode, input.state);
  const services = serviceLabels(input.matchedCategories);
  const timing = TIMING_LABELS[bounded(input.timing, 40)] || "Planning";
  if (input.sourceKind === "public_plan_enquiry") {
    const customerName = bounded(input.customerName, 120);
    const customerMessage = bounded(input.customerMessage, 500);
    const postcode = broadPostcode(input.postcode);
    const subject = `New TLink customer enquiry in ${postcode || broadState(input.state)}`
      .slice(0, 160);
    const body = [
      `Hello ${businessName},`,
      "",
      "A customer chose to share a matched energy upgrade enquiry with your verified business.",
      "",
      ...(customerName ? [`Customer: ${customerName}`] : []),
      `Postcode: ${postcode || "Check the signed-in workspace"}`,
      `Selected ${services.length === 1 ? "service" : "services"}: ${services.join(", ")}`,
      `Timing: ${timing}`,
      ...(customerMessage ? [`Customer message: ${customerMessage}`] : []),
      "",
      `Review the enquiry and contact details: ${OPPORTUNITY_INBOX_URL}`,
      "",
      "Only the contact details named in the customer's consent are available after sign-in. The customer's private home plan is not shared with trades.",
    ].join("\n");
    return { subject, body: body.slice(0, 1800) };
  }
  const evidenceCount = Math.max(
    0,
    Math.min(999, Math.floor(Number(input.customerSharedEvidenceCount) || 0)),
  );
  const evidence = evidenceCount === 0
    ? "No customer-shared photos or documents are attached yet."
    : `The complete set of ${evidenceCount} customer-shared ${
      evidenceCount === 1 ? "photo or document" : "photos or documents"
    } is available after sign-in.`;
  const subject = `New TLink opportunity in ${location}`.slice(0, 160);
  const body = [
    `Hello ${businessName},`,
    "",
    "A new matched opportunity is ready in your private TLink workspace.",
    "",
    `Broad location: ${location}`,
    `Matched services: ${services.join(", ")}`,
    `Timing: ${timing}`,
    `Opportunity closes: ${expiryLabel(input.expiresAt)}`,
    "Complete privacy-safe customer plan: available after sign-in.",
    `Customer-shared evidence: ${evidence}`,
    "",
    `Review the opportunity: ${OPPORTUNITY_INBOX_URL}`,
    "",
    "Customer identity, contact details, street and unit address, and private evidence remain protected in the signed-in workflow.",
  ].join("\n");
  return { subject, body: body.slice(0, 1800) };
}

export function opportunityNotificationIdempotencyKey(matchId: string) {
  return sha256(`tlink-opportunity-email-v1|${bounded(matchId, 200)}`);
}

export function opportunityNotificationEmailHash(email: string) {
  return sha256(`tlink-opportunity-email-suppression-v1|${bounded(email, 320).toLowerCase()}`);
}
