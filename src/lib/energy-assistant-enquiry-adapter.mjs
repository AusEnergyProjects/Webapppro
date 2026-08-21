import { resolveAddressLocalityTuple } from "./address-localities.mjs";
import { normalizeEnergyServiceIds } from "./energy-service-catalogue.mjs";
import {
  isPublicPlanSubmissionId,
  normalizePublicPlanSnapshot,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  PUBLIC_PLAN_ENQUIRY_KIND,
} from "./public-plan-enquiry.mjs";
import {
  normalizePublicPlanQuotePreparation,
  publicPlanQuotePlanFactsForSnapshot,
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
} from "./public-plan-quote-preparation.mjs";
export {
  ENERGY_ASSISTANT_MATCHING_EXPLANATION,
  ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION,
} from "./energy-assistant-enquiry-copy.mjs";

const ADAPTER_KEYS = new Set(["destination", "assistantPayload", "tradeEnquiry"]);
const TRADE_ENQUIRY_KEYS = new Set([
  "submissionId",
  "clientStartedAt",
  "consentAccepted",
  "consentGrantedAt",
  "customerFirstName",
  "customerLastName",
  "email",
  "phone",
  "customerUnitNumber",
  "customerStreetAddress",
  "customerSuburb",
  "customerState",
  "postcode",
  "services",
  "customerMessage",
  "shareContact",
  "quoteAnswers",
  "shareKnownPlanFacts",
  "planSnapshot",
]);
const CONTACT_SHARING_KEYS = new Set(["name", "phone", "address"]);
const PRIVATE_IDENTIFIER_PATTERN = /\b(?:nmi|account|customer|meter)\s*(?:number|no\.?|id|identifier)\b|\b\d{10,13}\b/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[+\d() .-]+$/;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} could not be read.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} contained an unsupported field.`);
  }
}

function singleLine(value, maximum, label, minimum = 1) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const clean = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length < minimum || clean.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} characters.`);
  }
  return clean;
}

function optionalSingleLine(value, maximum, label) {
  if (value === undefined || value === null || value === "") return "";
  return singleLine(value, maximum, label);
}

function tradeContactSharing(value) {
  const sharing = record(value, "Trade contact sharing");
  exactKeys(sharing, CONTACT_SHARING_KEYS, "Trade contact sharing");
  if ([sharing.name, sharing.phone, sharing.address].some((choice) => typeof choice !== "boolean")) {
    throw new Error("Choose each optional trade contact field explicitly.");
  }
  return {
    email: true,
    postcode: true,
    name: sharing.name,
    phone: sharing.phone,
    address: sharing.address,
  };
}

function quoteAnswerInput(value) {
  if (!Array.isArray(value)) throw new Error("Quote answers could not be read.");
  return value.map((entry) => {
    const answer = record(entry, "A quote answer");
    exactKeys(answer, new Set(["questionId", "answer"]), "A quote answer");
    return {
      questionId: singleLine(answer.questionId, 100, "Quote question ID"),
      answer: singleLine(answer.answer, 160, "Quote answer"),
    };
  });
}

function buildPublicPlanPayload(raw) {
  const input = record(raw, "The matched-trade enquiry");
  exactKeys(input, TRADE_ENQUIRY_KEYS, "The matched-trade enquiry");
  if (input.consentAccepted !== true) {
    throw new Error("Confirm the current private-plan and trade-matching notice before continuing.");
  }
  if (!isPublicPlanSubmissionId(input.submissionId)) {
    throw new Error("Start a new matched-trade enquiry and try again.");
  }
  if (!Number.isSafeInteger(input.clientStartedAt) || input.clientStartedAt < 0) {
    throw new Error("The enquiry start time could not be verified.");
  }
  const consentGrantedAt = singleLine(input.consentGrantedAt, 40, "Consent time");
  if (!Number.isFinite(Date.parse(consentGrantedAt))) {
    throw new Error("Confirm the current private-plan and trade-matching notice again.");
  }

  const services = normalizeEnergyServiceIds(input.services);
  if (!services?.length) throw new Error("Choose at least one service for trade matching.");
  const normalizedSnapshot = normalizePublicPlanSnapshot(input.planSnapshot);
  if (!normalizedSnapshot.ok) throw new Error(normalizedSnapshot.error);

  const postcode = singleLine(input.postcode, 4, "Postcode");
  const locality = resolveAddressLocalityTuple({
    postcode,
    suburb: singleLine(input.customerSuburb, 80, "Suburb"),
    state: singleLine(input.customerState, 3, "State").toUpperCase(),
  });
  if (!locality) throw new Error("Choose a suburb and state listed for this postcode.");
  if (
    normalizedSnapshot.value.addressState
    && normalizedSnapshot.value.addressState !== locality.state
  ) {
    throw new Error("The saved plan state does not match the enquiry address.");
  }

  const customerFirstName = singleLine(input.customerFirstName, 60, "First name");
  const customerLastName = singleLine(input.customerLastName, 60, "Last name");
  const email = singleLine(input.email, 254, "Email address").toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email address.");
  const phone = singleLine(input.phone, 40, "Phone number");
  const phoneDigits = phone.replace(/\D/g, "");
  if (!PHONE_PATTERN.test(phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
    throw new Error("Enter a valid phone number.");
  }
  const customerStreetAddress = singleLine(
    input.customerStreetAddress,
    140,
    "Street address",
  );
  const customerUnitNumber = optionalSingleLine(input.customerUnitNumber, 40, "Unit number");
  const customerMessage = optionalSingleLine(input.customerMessage, 500, "Customer message");
  if (PRIVATE_IDENTIFIER_PATTERN.test(customerMessage)) {
    throw new Error("Remove NMI, meter, account and customer identifiers from the trade message.");
  }
  if (typeof input.shareKnownPlanFacts !== "boolean") {
    throw new Error("Choose whether saved home-plan facts may be included in the quote answers.");
  }

  const suppliedAnswers = quoteAnswerInput(input.quoteAnswers);
  const planFactAnswers = input.shareKnownPlanFacts
    ? publicPlanQuotePlanFactsForSnapshot(services, normalizedSnapshot.value)
      .map(({ questionId, answer }) => ({ questionId, answer }))
    : [];
  const normalizedPreparation = normalizePublicPlanQuotePreparation({
    version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    answers: [...suppliedAnswers, ...planFactAnswers],
    photoPromptIds: [],
    expectedPhotoCount: 0,
    uploadKeyHash: "",
  }, services, normalizedSnapshot.value);
  if (!normalizedPreparation.ok) throw new Error(normalizedPreparation.error);

  return {
    submissionType: "upgrade",
    enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
    submissionId: input.submissionId,
    clientStartedAt: input.clientStartedAt,
    website: "",
    customerFirstName,
    customerLastName,
    email,
    phone,
    customerUnitNumber,
    customerStreetAddress,
    customerSuburb: locality.suburb,
    customerState: locality.state,
    postcode,
    projectCategories: services,
    projectNotes: customerMessage,
    tradeSharing: tradeContactSharing(input.shareContact),
    quotePreparation: {
      version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
      answers: normalizedPreparation.value.answers.map(({ questionId, answer }) => ({
        questionId,
        answer,
      })),
      photoPromptIds: [],
      expectedPhotoCount: 0,
      uploadKeyHash: "",
    },
    planSnapshot: normalizedSnapshot.value,
    consent: {
      accepted: true,
      purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      grantedAt: new Date(consentGrantedAt).toISOString(),
    },
  };
}

/**
 * Selects exactly one existing enquiry pipeline. This function performs no network request.
 * The caller submits the returned payload only to the returned endpoint.
 */
export function buildEnergyAssistantEnquirySubmission(raw) {
  const input = record(raw, "The enquiry route");
  exactKeys(input, ADAPTER_KEYS, "The enquiry route");
  if (input.destination === "aea-follow-up") {
    if (input.tradeEnquiry !== undefined) {
      throw new Error("Choose either Australian Energy Assessments follow-up or matched trades, not both.");
    }
    const assistantPayload = record(input.assistantPayload, "The Australian Energy Assessments follow-up");
    if (assistantPayload.tradeSharingConsent?.accepted !== false) {
      throw new Error("Matched-trade consent must use the private-plan trade enquiry path.");
    }
    return {
      endpoint: "/api/energy-assistant/leads",
      payload: assistantPayload,
    };
  }
  if (input.destination === "matched-trades") {
    if (input.assistantPayload !== undefined) {
      throw new Error("Choose either matched trades or Australian Energy Assessments follow-up, not both.");
    }
    return {
      endpoint: "/api/leads",
      payload: buildPublicPlanPayload(input.tradeEnquiry),
    };
  }
  throw new Error("Choose Australian Energy Assessments follow-up or matched trades.");
}
