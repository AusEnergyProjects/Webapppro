import { createHash } from "node:crypto";
import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import { buildDirectTradeTriage } from "./direct-trade-matching.mjs";
import { buildParticipantApplicationReview } from "./direct-trade-participants.mjs";
import { isPublicPlanEnquiry } from "./public-plan-enquiry.mjs";
import {
  isPublicRentalAssessmentRequest,
  PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY,
} from "./public-rental-assessment-request.mjs";

const EVENT_TYPES = new Set([
  "comparison.results",
  "electricity.upgrade",
  "gas.upgrade",
  "direct_trade.project",
  "direct_trade.partner",
]);

const ELECTRICITY_ENQUIRIES = new Set([
  "electricity-solar",
  "electricity-solar-battery",
  "electricity-battery",
  "solar",
  "solar-battery",
  "battery",
]);

const GAS_ENQUIRIES = new Set(["gas-heating", "gas-hot-water"]);

export function leadEventType(payload) {
  if (payload?.submissionType === "comparison") return "comparison.results";
  if (isPublicPlanEnquiry(payload?.enquiry)) return "direct_trade.project";
  if (isPublicRentalAssessmentRequest(payload?.enquiry)) return "direct_trade.project";
  if (payload?.enquiry === "direct-trade-project")
    return "direct_trade.project";
  if (payload?.enquiry === "direct-trade-partner")
    return "direct_trade.partner";
  if (GAS_ENQUIRIES.has(payload?.enquiry)) return "gas.upgrade";
  if (ELECTRICITY_ENQUIRIES.has(payload?.enquiry)) return "electricity.upgrade";
  return "";
}

function referenceDate(isoDate) {
  return String(isoDate || "")
    .slice(0, 10)
    .replaceAll("-", "");
}

function publicPlanReference(submissionId) {
  const match = /^(\d{8})\.([0-9a-f-]{36})$/i.exec(String(submissionId || ""));
  if (!match) return "";
  const suffix = match[2].replaceAll("-", "").slice(0, 16).toUpperCase();
  return `AEA-${match[1]}-${suffix}`;
}

function canonicalFingerprintValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(canonicalFingerprintValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalFingerprintValue(value[key])]),
    );
  }
  return value;
}

export function publicPlanSubmissionFingerprint(payload) {
  const core = canonicalFingerprintValue({
    submissionType: payload?.submissionType || "",
    enquiry: payload?.enquiry || "",
    name: payload?.name || "",
    customerFirstName: payload?.customerFirstName || "",
    customerLastName: payload?.customerLastName || "",
    email: payload?.email || "",
    phone: payload?.phone || "",
    customerUnitNumber: payload?.customerUnitNumber || "",
    customerStreetAddress: payload?.customerStreetAddress || "",
    customerSuburb: payload?.customerSuburb || "",
    customerState: payload?.customerState || "",
    postcode: payload?.postcode || "",
    projectCategories: payload?.projectCategories || [],
    projectNotes: payload?.projectNotes || "",
    requesterRole: payload?.requesterRole || "",
    agencyName: payload?.agencyName || "",
    requestedOptionalModules: payload?.requestedOptionalModules || [],
    authorityConfirmed: payload?.authorityConfirmed === true,
    tradeSharing: payload?.tradeSharing || null,
    quotePreparation: payload?.quotePreparation || null,
    planSnapshot: payload?.planSnapshot || null,
    consent: {
      accepted: payload?.consent?.accepted === true,
      purpose: payload?.consent?.purpose || "",
      noticeVersion: payload?.consent?.noticeVersion || "",
    },
  });
  return createHash("sha256").update(JSON.stringify(core)).digest("hex");
}

export function createLeadEnvelope(payload, options = {}) {
  const leadPayload = { ...(payload || {}) };
  const publicPlanEnquiry = isPublicPlanEnquiry(leadPayload.enquiry);
  const rentalAssessmentRequest = isPublicRentalAssessmentRequest(leadPayload.enquiry);
  const publicRequest = publicPlanEnquiry || rentalAssessmentRequest;
  const submissionFingerprint = publicRequest
    ? publicPlanSubmissionFingerprint(leadPayload)
    : "";
  delete leadPayload.planSnapshot;
  const submittedAt =
    leadPayload.submittedAt ||
    (options.now ? options.now() : new Date()).toISOString();
  const eventType = leadEventType(leadPayload);
  if (!EVENT_TYPES.has(eventType))
    throw new Error("Unsupported lead event type.");
  const createId = options.createId || (() => crypto.randomUUID());
  const suffix = String(createId())
    .replaceAll("-", "")
    .slice(0, 10)
    .toUpperCase();
  const inferredPublicReference = publicRequest
    ? publicPlanReference(leadPayload.submissionId)
    : "";
  const reference = inferredPublicReference
    || `AEA-${referenceDate(submittedAt)}-${suffix}`;
  const inferredState = publicRequest
    ? ""
    : residentialStateFromPostcode(leadPayload.postcode);
  const resolvedState = publicRequest
    ? leadPayload.customerState || ""
    : leadPayload.state || inferredState || "";
  const directTradeTriage =
    rentalAssessmentRequest
      ? {
          version: "public-rental-assessment-request-1",
          status: "manual_review_required",
          priority: "standard_review",
          autoSend: false,
          reviewFlags: ["booking_not_created"],
          contactConsentReceipt: {
            accepted: true,
            purpose: leadPayload.consent?.purpose || "",
            noticeVersion: leadPayload.consent?.noticeVersion || "",
            grantedAt: leadPayload.consent?.grantedAt || "",
            disclosedFields: [
              "customer_name",
              "customer_email",
              ...(leadPayload.phone ? ["customer_phone"] : []),
              "customer_address",
              "requester_authority",
              "requested_assessment_modules",
              ...(leadPayload.projectNotes ? ["customer_message"] : []),
            ],
          },
        }
      : publicPlanEnquiry
      ? {
          version: "public-home-plan-open-matching-2",
          status: "automatic_verified_area_allocation",
          priority: "standard_allocation",
          autoSend: true,
          reviewFlags: [],
          contactConsentReceipt: {
            accepted: true,
            purpose: leadPayload.consent?.purpose || "",
            noticeVersion: leadPayload.consent?.noticeVersion || "",
            grantedAt: leadPayload.consent?.grantedAt || "",
            disclosedFields: [
              "customer_email",
              "postcode",
              "service_categories",
              ...(leadPayload.tradeSharing?.name ? ["customer_name"] : []),
              ...(leadPayload.tradeSharing?.phone ? ["customer_phone"] : []),
              ...(leadPayload.tradeSharing?.address ? ["customer_address"] : []),
              ...(leadPayload.projectNotes ? ["customer_message"] : []),
            ],
          },
          matchCriteria: {
            state: resolvedState,
            postcode: leadPayload.postcode || "",
            capabilities: leadPayload.projectCategories || [],
            participantStatus: "active_verified",
            credentials: "verified_current",
          },
          quoteEvidence: [],
        }
      : eventType === "direct_trade.project"
      ? buildDirectTradeTriage({
          ...leadPayload,
          state: resolvedState,
        })
      : null;
  const participantReview =
    eventType === "direct_trade.partner"
      ? buildParticipantApplicationReview(leadPayload)
      : null;

  return {
    ...leadPayload,
    schemaVersion: "7",
    eventType,
    reference,
    submittedAt,
    state: resolvedState,
    source: "aea-energy-web",
    ...(publicPlanEnquiry ? { sourceJourney: "public-home-energy-plan" } : {}),
    ...(rentalAssessmentRequest ? { sourceJourney: PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY } : {}),
    ...(publicRequest ? { submissionFingerprint } : {}),
    ...(directTradeTriage ? { directTradeTriage } : {}),
    ...(participantReview ? { participantReview } : {}),
  };
}
