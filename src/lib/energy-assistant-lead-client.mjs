import { normalizeEnergyServiceIds } from "./energy-service-catalogue.mjs";
import {
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
} from "./public-plan-enquiry.mjs";
import { energyAssistantQuoteQuestionsForServices } from "./public-plan-quote-preparation.mjs";

export const ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION =
  "aea-energy-assistant-service-contact/v1";
export const ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE =
  "respond_to_requested_energy_assistance";
export const ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION =
  "energy-assistant-quote-brief/v1";
export {
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
};

const PROPERTY_TYPES = new Set(["house", "townhouse", "apartment-unit", "other", "not-sure"]);
const TENURES = new Set(["owner-occupier", "landlord", "renter", "strata", "trade-client", "not-sure"]);
const BUDGET_RANGES = new Set(["under-5000", "5000-15000", "15000-30000", "30000-plus", "not-set"]);
const CONTACT_PREFERENCES = new Set(["email", "phone", "either"]);
const CONTACT_TIMES = new Set(["business-hours", "after-hours", "any-time"]);

function safeEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function cleanLine(value, maximum) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function additionalContext(message, documentSummary) {
  const structuredSummary = cleanLine(documentSummary, 720);
  return [
    cleanLine(message, 800),
    structuredSummary
      ? `Visitor explicitly included this structured local document summary: ${structuredSummary}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 800);
}

function bytesToBase64Url(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;
    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    if (index + 1 < bytes.length) output += alphabet[(combined >> 6) & 63];
    if (index + 2 < bytes.length) output += alphabet[combined & 63];
  }
  return output;
}

export function createEnergyAssistantSubmissionKey(cryptoImplementation = globalThis.crypto) {
  if (!cryptoImplementation || typeof cryptoImplementation.getRandomValues !== "function") {
    throw new Error("Secure browser randomness is unavailable. Refresh in a current browser before sending this request.");
  }
  return bytesToBase64Url(cryptoImplementation.getRandomValues(new Uint8Array(32)));
}

/**
 * Builds the exact, client-safe contract accepted by createEnergyAssistantLead.
 * Raw guide transcripts and local document bytes are deliberately not accepted.
 */
export function buildEnergyAssistantLeadPayload({
  lead,
  requestId,
  submissionKey,
  grantedAt,
  documentSummary = "",
}) {
  const services = normalizeEnergyServiceIds(lead?.services);
  if (!services?.length) throw new Error("Choose at least one service.");
  const questions = energyAssistantQuoteQuestionsForServices(services);
  const suppliedAnswers = lead?.quoteAnswers && typeof lead.quoteAnswers === "object"
    ? lead.quoteAnswers
    : {};
  const answers = questions.flatMap((question) => {
    const answer = suppliedAnswers[question.id];
    return typeof answer === "string" && question.options.includes(answer)
      ? [{ questionId: question.id, answer }]
      : [];
  });
  const acceptedAt = new Date(grantedAt);
  if (!Number.isFinite(acceptedAt.getTime())) throw new Error("Confirm the service-contact consent again.");

  return {
    requestId: cleanLine(requestId, 80),
    submissionKey: cleanLine(submissionKey, 43),
    name: cleanLine(lead?.name, 120),
    email: cleanLine(lead?.email, 254),
    phone: cleanLine(lead?.phone, 32),
    postcode: cleanLine(lead?.postcode, 4),
    suburb: cleanLine(lead?.suburb, 80),
    state: cleanLine(lead?.state, 3).toUpperCase(),
    services,
    interestConfirmed: true,
    quoteBrief: {
      version: ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
      propertyType: safeEnum(lead?.propertyType, PROPERTY_TYPES, "not-sure"),
      tenure: safeEnum(lead?.tenure, TENURES, "not-sure"),
      budgetRange: safeEnum(lead?.budgetRange, BUDGET_RANGES, "not-set"),
      contactPreference: safeEnum(lead?.contactPreference, CONTACT_PREFERENCES, "either"),
      bestContactTime: safeEnum(lead?.bestContactTime, CONTACT_TIMES, "business-hours"),
      answers,
      knownFacts: [],
      siteConstraints: [],
      explicitUnknowns: [],
      additionalContext: additionalContext(lead?.message, documentSummary),
    },
    serviceConsent: {
      accepted: true,
      noticeVersion: ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
      purpose: ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
      grantedAt: acceptedAt.toISOString(),
    },
    marketingConsent: lead?.marketingConsent === true,
    tradeSharingConsent: lead?.tradeSharingConsent === true
      ? {
        accepted: true,
        noticeVersion: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
        purpose: ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
        grantedAt: acceptedAt.toISOString(),
        sharePhone: lead?.sharePhone === true,
      }
      : { accepted: false },
  };
}
