import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";

export const OPPORTUNITY_INBOX_URL =
  "https://ausenergyassessments.com/direct-trade/dashboard?workspace=leads#opportunity-inbox";

type OpportunityNotificationDraftInput = {
  businessName: string;
  sourceKind?: "customer_project" | "public_plan_enquiry" | "quick_upgrade_enquiry" | "legacy_marketplace";
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
  | "quick_upgrade_enquiry"
  | "legacy_marketplace";

export function opportunityNotificationEmailPreferenceAllows(
  sourceKind: OpportunityNotificationSourceKind,
  emailOpportunities: unknown,
) {
  return sourceKind === "public_plan_enquiry"
    || sourceKind === "quick_upgrade_enquiry"
    || Boolean(emailOpportunities);
}

const CATEGORY_LABELS = ENERGY_SERVICE_LABELS as Readonly<Record<string, string>>;

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
  if (input.sourceKind === "public_plan_enquiry" || input.sourceKind === "quick_upgrade_enquiry") {
    const quickUpgradeEnquiry = input.sourceKind === "quick_upgrade_enquiry";
    const customerName = bounded(input.customerName, 120);
    const customerMessage = bounded(input.customerMessage, 500);
    const postcode = broadPostcode(input.postcode);
    const subject = `New TLink customer enquiry in ${postcode || broadState(input.state)}`
      .slice(0, 160);
    const body = [
      `Hello ${businessName},`,
      "",
      quickUpgradeEnquiry
        ? "A customer sent a quick upgrade request to verified businesses that match their services and area."
        : "A customer chose to share a matched energy upgrade enquiry with your verified business.",
      "",
      ...(customerName ? [`Customer: ${customerName}`] : []),
      `Postcode: ${postcode || "Check the signed-in workspace"}`,
      `Selected ${services.length === 1 ? "service" : "services"}: ${services.join(", ")}`,
      `Timing: ${timing}`,
      ...(customerMessage ? [`Customer message: ${customerMessage}`] : []),
      "",
      `Review the enquiry and contact details: ${OPPORTUNITY_INBOX_URL}`,
      "",
      quickUpgradeEnquiry
        ? "Only the contact details named in the customer's consent are available after sign-in. No home plan or PDF was created for this request."
        : "Only the contact details named in the customer's consent are available after sign-in. The customer's private home plan is not shared with trades.",
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

function escapeHtml(value: unknown, maximum = 2_000) {
  return bounded(value, maximum)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function opportunityNotificationHtml(draft: { subject: string; body: string }) {
  const subject = bounded(draft.subject, 160);
  const lines = String(draft.body || "")
    .split("\n")
    .map((line) => bounded(line, 700))
    .filter(Boolean);
  const greeting = lines.shift() || "Hello,";
  const privacyBoundary = lines.pop() ||
    "Customer details remain protected in the signed-in TLink workflow.";
  const actionIndex = lines.findIndex((line) => line.includes(OPPORTUNITY_INBOX_URL));
  if (actionIndex >= 0) lines.splice(actionIndex, 1);
  const publicPlanEnquiry = subject.includes("customer enquiry");
  const heading = publicPlanEnquiry
    ? "A new customer enquiry matches your services"
    : "A new opportunity matches your services";
  const intro = lines.find((line) => !line.includes(":")) ||
    "A customer enquiry matches your saved services and service area.";
  const details = lines.filter((line) => line !== intro && line.includes(":"));
  const selectedServiceLine = details.find((line) =>
    line.startsWith("Selected service:")
    || line.startsWith("Selected services:")
    || line.startsWith("Matched services:"),
  );
  const services = selectedServiceLine
    ? selectedServiceLine.slice(selectedServiceLine.indexOf(":") + 1)
      .split(",").map((value) => bounded(value, 100)).filter(Boolean)
    : ["Energy upgrade"];
  const serviceRows = services.map((service) =>
    `<span style="display:inline-block;margin:0 6px 7px 0;padding:7px 10px;border-radius:999px;background:#f1eaf7;color:#4b2268;font-size:13px;font-weight:700;">${escapeHtml(service, 100)}</span>`,
  ).join("");
  const customerMessage = details.find((line) => line.startsWith("Customer message:"));
  const detailRows = details.filter((line) =>
    line !== selectedServiceLine && line !== customerMessage,
  ).map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  });
  const detailHtml = detailRows.map(([label, value]) =>
    `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;">${escapeHtml(label, 80)}</td><td style="padding:8px 0 8px 16px;color:#172033;font-size:14px;font-weight:700;text-align:right;vertical-align:top;">${escapeHtml(value, 240)}</td></tr>`,
  ).join("");
  return `<!doctype html>
<html lang="en-AU">
  <body style="margin:0;background:#f3eef7;color:#172033;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject, 160)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f3eef7;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;border-radius:20px;overflow:hidden;background:#ffffff;border:1px solid #dfd4e7;box-shadow:0 16px 42px rgba(49,20,72,.14);">
          <tr><td style="padding:28px 32px;background:#311448;background-image:linear-gradient(135deg,#27113d 0%,#5f2f78 56%,#b54d73 100%);border-bottom:6px solid #63dfc6;color:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
              <td width="52" valign="middle"><div style="width:44px;height:44px;border-radius:13px;background:#092f34;color:#63f1d7;font-size:20px;font-weight:900;line-height:44px;text-align:center;">TL</div></td>
              <td valign="middle"><div style="font-size:21px;font-weight:800;line-height:1.1;">TLink</div><div style="padding-top:3px;color:#eadff0;font-size:12px;">Installer control centre</div></td>
            </tr></table>
            <div style="margin-top:25px;color:#8ff3df;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">New matched lead</div>
            <h1 style="margin:10px 0 0;color:#ffffff;font-size:29px;line-height:1.18;">${escapeHtml(heading, 180)}</h1>
          </td></tr>
          <tr><td style="padding:30px 32px 34px;">
            <p style="margin:0 0 18px;color:#293246;font-size:17px;line-height:1.6;">${escapeHtml(greeting, 180)}</p>
            <p style="margin:0 0 22px;color:#536074;font-size:15px;line-height:1.65;">${escapeHtml(intro, 700)}</p>
            <div style="margin:0 0 22px;">${serviceRows}</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-collapse:collapse;border-top:1px solid #e8e0ed;border-bottom:1px solid #e8e0ed;">${detailHtml}</table>
            ${customerMessage ? `<div style="margin:0 0 24px;padding:16px 18px;border-radius:13px;background:#f8f5fa;border-left:5px solid #8a4ca1;color:#495369;font-size:14px;line-height:1.6;"><strong style="display:block;margin-bottom:5px;color:#392047;">Customer message</strong>${escapeHtml(customerMessage.slice(customerMessage.indexOf(":") + 1), 500)}</div>` : ""}
            <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:11px;background:#0b765d;"><a href="${escapeHtml(OPPORTUNITY_INBOX_URL, 500)}" style="display:inline-block;padding:14px 21px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;">Open this lead in TLink</a></td></tr></table>
            <p style="margin:17px 0 0;color:#6d7788;font-size:13px;line-height:1.55;">Sign in to review the complete authorised enquiry and respond from your workspace.</p>
            <div style="margin-top:24px;padding:15px 17px;border-radius:13px;background:#eaf8f4;border-left:5px solid #19a77b;color:#315f56;font-size:13px;line-height:1.6;">${escapeHtml(privacyBoundary, 500)}</div>
          </td></tr>
          <tr><td style="padding:18px 32px;background:#241135;border-top:1px solid #3f2451;color:#cdbed5;font-size:12px;line-height:1.55;">TLink by Australian Energy Assessments<br><span style="color:#9f8fab;">This operational email was sent because your approved business is open to matched customer enquiries.</span></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function opportunityNotificationIdempotencyKey(matchId: string) {
  return sha256(`tlink-opportunity-email-v1|${bounded(matchId, 200)}`);
}

export function opportunityNotificationEmailHash(email: string) {
  return sha256(`tlink-opportunity-email-suppression-v1|${bounded(email, 320).toLowerCase()}`);
}
