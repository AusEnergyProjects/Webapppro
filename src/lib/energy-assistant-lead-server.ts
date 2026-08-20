import { addressLocalitiesForPostcode } from "./address-localities.mjs";
import {
  ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
  ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
  ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
} from "./energy-assistant-lead-client.mjs";
import {
  ENERGY_SERVICE_IDS,
  ENERGY_SERVICE_LABELS,
} from "./energy-service-catalogue.mjs";
import { energyAssistantQuoteQuestionsForServices } from "./public-plan-quote-preparation.mjs";

export {
  ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
  ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
  ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
};

export const ENERGY_ASSISTANT_LEAD_SERVICE_CATEGORIES = ENERGY_SERVICE_IDS;

type EnergyAssistantLeadDatabase = Pick<D1Database, "prepare" | "batch">;
type ServiceCategory = (typeof ENERGY_SERVICE_IDS)[number];
type CreateOpportunity = (payload: Record<string, unknown>) => Promise<{
  id: string;
  allocation: unknown;
} | null>;

type ConsentReceipt = {
  accepted?: unknown;
  noticeVersion?: unknown;
  purpose?: unknown;
  grantedAt?: unknown;
  sharePhone?: unknown;
};

type EnergyAssistantLeadInput = {
  requestId?: unknown;
  submissionKey?: unknown;
  sourceRequestId?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  postcode?: unknown;
  suburb?: unknown;
  state?: unknown;
  services?: unknown;
  interestConfirmed?: unknown;
  quoteBrief?: unknown;
  serviceConsent?: unknown;
  marketingConsent?: unknown;
  tradeSharingConsent?: unknown;
};

type QuoteFact = {
  kind: string;
  value: string;
  services: ServiceCategory[];
};

type QuoteConstraint = {
  kind: string;
  detail: string;
  services: ServiceCategory[];
};

export type EnergyAssistantQuoteBrief = {
  version: typeof ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION;
  propertyType: string;
  tenure: string;
  budgetRange: string;
  contactPreference: string;
  bestContactTime: string;
  answers: Array<{
    questionId: string;
    label: string;
    answer: string;
    services: ServiceCategory[];
  }>;
  knownFacts: QuoteFact[];
  siteConstraints: QuoteConstraint[];
  explicitUnknowns: string[];
  additionalContext: string;
  readiness: {
    state: "quote_ready" | "needs_information";
    requiredQuestionIds: string[];
    capturedQuestionIds: string[];
    capturedUnknownQuestionIds: string[];
    knownQuestionIds: string[];
    missingQuestionIds: string[];
    serviceReadiness: Array<{
      service: ServiceCategory;
      minimumKnownItems: number;
      knownItemCount: number;
      sufficient: boolean;
    }>;
    insufficientKnownServiceIds: ServiceCategory[];
  };
};

type EnergyAssistantLeadRow = {
  id: string;
  request_id: string;
  submission_key_sha256: string;
  source_request_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  postcode: string;
  suburb: string;
  residential_state: string;
  service_categories_json: string;
  quote_brief_version: string;
  quote_brief_json: string;
  interest_confirmed: number;
  source_journey: string;
  service_consent_version: string;
  service_consent_purpose: string;
  service_consent_granted_at: string;
  marketing_consent: number;
  marketing_consent_granted_at: string;
  trade_sharing_consent: number;
  trade_sharing_notice_version: string;
  trade_sharing_purpose: string;
  trade_sharing_granted_at: string;
  trade_disclosed_fields_json: string;
  trade_disclosed_snapshot_json: string;
  trade_disclosed_snapshot_sha256: string;
  opportunity_id: string;
  status: string;
};

type CreateLeadDependencies = {
  database: EnergyAssistantLeadDatabase;
  now?: () => Date;
  randomUUID?: () => string;
  createOpportunity?: CreateOpportunity;
};

type NormalizedLead = {
  requestId: string;
  submissionKey: string;
  submissionKeySha256: string;
  sourceRequestId: string;
  name: string;
  email: string | null;
  phone: string | null;
  postcode: string;
  suburb: string;
  state: string;
  services: ServiceCategory[];
  quoteBrief: EnergyAssistantQuoteBrief;
  serviceConsentGrantedAt: string;
  marketingConsent: boolean;
  marketingConsentGrantedAt: string;
  tradeSharingConsent: boolean;
  tradeSharingGrantedAt: string;
  tradeDisclosedFields: string[];
  tradeDisclosedSnapshot: Record<string, unknown>;
  tradeDisclosedSnapshotJson: string;
  tradeDisclosedSnapshotSha256: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{16,80}$/;
const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[+\d() .-]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PRIVATE_IDENTIFIER_PATTERN = /\b(?:nmi|account|customer|meter)\s*(?:number|no\.?|id|identifier)\b|\b\d{10,13}\b/i;
const serviceSet = new Set<string>(ENERGY_SERVICE_IDS);

const PROPERTY_TYPES = new Set(["house", "townhouse", "apartment-unit", "other", "not-sure"]);
const TENURES = new Set(["owner-occupier", "landlord", "renter", "strata", "trade-client", "not-sure"]);
const BUDGET_RANGES = new Set(["under-5000", "5000-15000", "15000-30000", "30000-plus", "not-set"]);
const CONTACT_PREFERENCES = new Set(["email", "phone", "either"]);
const CONTACT_TIMES = new Set(["business-hours", "after-hours", "any-time"]);
const FACT_KINDS = new Set([
  "existing-system", "property", "occupants", "switchboard", "roof",
  "electrical-supply", "installation-space", "access", "approvals",
  "energy-use", "priority", "other",
]);
const CONSTRAINT_KINDS = new Set([
  "access", "space", "roof", "switchboard", "electrical-supply",
  "strata-approval", "rental-permission", "safety", "other",
]);
const BASE_UNKNOWNS = new Set([
  "property-type", "tenure", "budget", "site-access", "existing-equipment",
  "measurements", "switchboard", "roof", "strata-or-owner-approval", "electricity-usage",
]);

const TOP_LEVEL_KEYS = new Set([
  "requestId", "submissionKey", "sourceRequestId", "name", "email", "phone",
  "postcode", "suburb", "state", "services", "interestConfirmed", "quoteBrief",
  "serviceConsent", "marketingConsent", "tradeSharingConsent",
]);

export class EnergyAssistantLeadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EnergyAssistantLeadError";
    this.status = status;
    this.code = code;
  }
}

function objectFrom(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `${label} could not be read.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `${label} contained an unsupported field.`);
  }
}

function cleanLine(value: unknown, minimum: number, maximum: number, label: string) {
  if (typeof value !== "string") {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `${label} is required.`);
  }
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < minimum || clean.length > maximum || CONTROL_CHARACTERS.test(clean)) {
    throw new EnergyAssistantLeadError(
      400,
      "INVALID_LEAD",
      `${label} must contain between ${minimum} and ${maximum} safe characters.`,
    );
  }
  return clean;
}

function optionalLine(value: unknown, maximum: number, label = "Contact detail") {
  if (value === undefined || value === null || value === "") return "";
  return cleanLine(value, 1, maximum, label);
}

function safeQuoteText(value: unknown, minimum: number, maximum: number, label: string) {
  const clean = cleanLine(value, minimum, maximum, label);
  if (PRIVATE_IDENTIFIER_PATTERN.test(clean)) {
    throw new EnergyAssistantLeadError(
      400,
      "PRIVATE_IDENTIFIER_NOT_ACCEPTED",
      "Remove NMI, meter, account and customer identifiers from the quote brief.",
    );
  }
  return clean;
}

function requiredEnum(value: unknown, allowed: ReadonlySet<string>, label: string) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!allowed.has(clean)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `Choose a valid ${label}.`);
  }
  return clean;
}

function servicesFrom(value: unknown) {
  if (!Array.isArray(value)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Choose at least one service.");
  }
  const supplied = new Set(value.filter((item): item is string => typeof item === "string"));
  if (supplied.size < 1 || supplied.size > ENERGY_SERVICE_IDS.length || [...supplied].some((item) => !serviceSet.has(item))) {
    throw new EnergyAssistantLeadError(400, "INVALID_SERVICE", "Choose one or more supported Australian Energy Assessments services.");
  }
  return ENERGY_SERVICE_IDS.filter((service) => supplied.has(service)) as ServiceCategory[];
}

function scopedServices(value: unknown, selected: readonly ServiceCategory[], label: string) {
  if (!Array.isArray(value)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `${label} must identify its services.`);
  }
  const supplied = new Set(value.filter((item): item is string => typeof item === "string"));
  const selectedSet = new Set<string>(selected);
  if (supplied.size < 1 || supplied.size > selected.length || [...supplied].some((item) => !selectedSet.has(item))) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", `${label} did not match the requested services.`);
  }
  return selected.filter((service) => supplied.has(service));
}

function quoteAnswersFrom(value: unknown, services: ServiceCategory[]) {
  if (!Array.isArray(value)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Quote answers could not be read.");
  }
  const questions = energyAssistantQuoteQuestionsForServices(services) as Array<{
    id: string;
    label: string;
    options: string[];
    services: ServiceCategory[];
  }>;
  const supplied = new Map<string, string>();
  for (const entry of value) {
    const item = objectFrom(entry, "A quote answer");
    exactKeys(item, new Set(["questionId", "answer"]), "A quote answer");
    const questionId = typeof item.questionId === "string" ? item.questionId.trim() : "";
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question || !question.options.includes(answer) || supplied.has(questionId)) {
      throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "A quote answer did not match the requested services.");
    }
    supplied.set(questionId, answer);
  }
  return questions.flatMap((question) => {
    const answer = supplied.get(question.id);
    return answer
      ? [{ questionId: question.id, label: question.label, answer, services: question.services }]
      : [];
  });
}

function knownFactsFrom(value: unknown, services: ServiceCategory[]) {
  if (!Array.isArray(value) || value.length > 24) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Known quote facts could not be read.");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = objectFrom(entry, "A known quote fact");
    exactKeys(item, new Set(["kind", "value", "services"]), "A known quote fact");
    const kind = requiredEnum(item.kind, FACT_KINDS, "known fact type");
    const cleanValue = safeQuoteText(item.value, 1, 160, "Known fact");
    const scoped = scopedServices(item.services, services, "A known quote fact");
    const identity = `${kind}:${cleanValue}:${scoped.join(",")}`;
    if (seen.has(identity)) throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Remove the duplicated quote fact.");
    seen.add(identity);
    return { kind, value: cleanValue, services: scoped };
  });
}

function constraintsFrom(value: unknown, services: ServiceCategory[]) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Site constraints could not be read.");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = objectFrom(entry, "A site constraint");
    exactKeys(item, new Set(["kind", "detail", "services"]), "A site constraint");
    const kind = requiredEnum(item.kind, CONSTRAINT_KINDS, "site constraint type");
    const detail = safeQuoteText(item.detail, 1, 200, "Site constraint");
    const scoped = scopedServices(item.services, services, "A site constraint");
    const identity = `${kind}:${detail}:${scoped.join(",")}`;
    if (seen.has(identity)) throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Remove the duplicated site constraint.");
    seen.add(identity);
    return { kind, detail, services: scoped };
  });
}

function quoteBriefFrom(value: unknown, services: ServiceCategory[]): EnergyAssistantQuoteBrief {
  const raw = objectFrom(value, "The quote brief");
  exactKeys(raw, new Set([
    "version", "propertyType", "tenure", "budgetRange", "contactPreference",
    "bestContactTime", "answers", "knownFacts", "siteConstraints",
    "explicitUnknowns", "additionalContext",
  ]), "The quote brief");
  if (raw.version !== ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION) {
    throw new EnergyAssistantLeadError(409, "QUOTE_BRIEF_VERSION_EXPIRED", "Refresh the page before requesting follow-up.");
  }
  const answers = quoteAnswersFrom(raw.answers, services);
  const questions = energyAssistantQuoteQuestionsForServices(services) as Array<{
    id: string;
    services: ServiceCategory[];
  }>;
  const allowedUnknowns = new Set([...BASE_UNKNOWNS, ...questions.map((question) => `question:${question.id}`)]);
  if (!Array.isArray(raw.explicitUnknowns) || raw.explicitUnknowns.length > allowedUnknowns.size) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Explicit quote unknowns could not be read.");
  }
  const suppliedUnknowns = new Set(raw.explicitUnknowns.filter((item): item is string => typeof item === "string"));
  if ([...suppliedUnknowns].some((item) => !allowedUnknowns.has(item))) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "An explicit quote unknown was not supported.");
  }
  const answered = new Set(answers.map((answer) => answer.questionId));
  const explicitlyUnknownQuestions = new Set(
    questions
      .filter((question) => suppliedUnknowns.has(`question:${question.id}`))
      .map((question) => question.id),
  );
  if ([...explicitlyUnknownQuestions].some((questionId) => answered.has(questionId))) {
    throw new EnergyAssistantLeadError(
      400,
      "INVALID_LEAD",
      "A quote question cannot be both answered and marked explicitly unknown.",
    );
  }
  const capturedQuestionIds = questions
    .map((question) => question.id)
    .filter((questionId) => answered.has(questionId) || explicitlyUnknownQuestions.has(questionId));
  const capturedQuestionSet = new Set(capturedQuestionIds);
  const missingQuestionIds = questions
    .map((question) => question.id)
    .filter((questionId) => !capturedQuestionSet.has(questionId));
  const capturedUnknownQuestionIds = questions
    .filter((question) => {
      const answer = answers.find((candidate) => candidate.questionId === question.id)?.answer.toLowerCase() || "";
      return explicitlyUnknownQuestions.has(question.id)
        || answer === "not sure"
        || answer === "need advice";
    })
    .map((question) => question.id);
  const capturedUnknownQuestionSet = new Set(capturedUnknownQuestionIds);
  const knownQuestionIds = questions
    .map((question) => question.id)
    .filter((questionId) => answered.has(questionId) && !capturedUnknownQuestionSet.has(questionId));
  const knownQuestionSet = new Set(knownQuestionIds);
  questions.forEach((question) => {
    if (capturedUnknownQuestionSet.has(question.id)) {
      suppliedUnknowns.add(`question:${question.id}`);
    } else {
      suppliedUnknowns.delete(`question:${question.id}`);
    }
  });
  const propertyType = requiredEnum(raw.propertyType, PROPERTY_TYPES, "property type");
  const tenure = requiredEnum(raw.tenure, TENURES, "property relationship");
  const budgetRange = requiredEnum(raw.budgetRange, BUDGET_RANGES, "budget range");
  if (propertyType === "not-sure") suppliedUnknowns.add("property-type");
  if (tenure === "not-sure") suppliedUnknowns.add("tenure");
  if (budgetRange === "not-set") suppliedUnknowns.add("budget");
  const additionalContext = raw.additionalContext === "" || raw.additionalContext === undefined
    ? ""
    : safeQuoteText(raw.additionalContext, 1, 800, "Additional quote context");
  const knownFacts = knownFactsFrom(raw.knownFacts, services);
  const siteConstraints = constraintsFrom(raw.siteConstraints, services);
  const serviceReadiness = services.map((service) => {
    const serviceQuestionIds = questions
      .filter((question) => question.id !== "timing" && question.services.includes(service))
      .map((question) => question.id);
    const knownAnswerCount = serviceQuestionIds.filter((questionId) => knownQuestionSet.has(questionId)).length;
    const knownFactCount = knownFacts.filter((fact) => fact.services.includes(service)).length;
    const knownConstraintCount = siteConstraints.filter((constraint) => constraint.services.includes(service)).length;
    const minimumKnownItems = Math.min(2, serviceQuestionIds.length);
    const knownItemCount = knownAnswerCount + knownFactCount + knownConstraintCount;
    return {
      service,
      minimumKnownItems,
      knownItemCount,
      sufficient: minimumKnownItems > 0 && knownItemCount >= minimumKnownItems,
    };
  });
  const insufficientKnownServiceIds = serviceReadiness
    .filter((service) => !service.sufficient)
    .map((service) => service.service);
  return {
    version: ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
    propertyType,
    tenure,
    budgetRange,
    contactPreference: requiredEnum(raw.contactPreference, CONTACT_PREFERENCES, "contact preference"),
    bestContactTime: requiredEnum(raw.bestContactTime, CONTACT_TIMES, "contact time"),
    answers,
    knownFacts,
    siteConstraints,
    explicitUnknowns: [...allowedUnknowns].filter((item) => suppliedUnknowns.has(item)),
    additionalContext,
    readiness: {
      state: missingQuestionIds.length || insufficientKnownServiceIds.length
        ? "needs_information"
        : "quote_ready",
      requiredQuestionIds: questions.map((question) => question.id),
      capturedQuestionIds,
      capturedUnknownQuestionIds,
      knownQuestionIds,
      missingQuestionIds,
      serviceReadiness,
      insufficientKnownServiceIds,
    },
  };
}

function receiptFrom(value: unknown, expectedVersion: string, expectedPurpose: string, now: Date, label: string) {
  const receipt = objectFrom(value, label) as ConsentReceipt;
  exactKeys(receipt as Record<string, unknown>, new Set(["accepted", "noticeVersion", "purpose", "grantedAt"]), label);
  const grantedAt = typeof receipt.grantedAt === "string" ? receipt.grantedAt : "";
  const parsed = Date.parse(grantedAt);
  if (
    receipt.accepted !== true
    || receipt.noticeVersion !== expectedVersion
    || receipt.purpose !== expectedPurpose
    || !Number.isFinite(parsed)
    || parsed > now.getTime() + 5 * 60 * 1000
  ) {
    throw new EnergyAssistantLeadError(400, "CONSENT_REQUIRED", `Confirm the current ${label.toLowerCase()}.`);
  }
  return new Date(parsed).toISOString();
}

function tradeReceiptFrom(value: unknown, now: Date, phone: string | null) {
  const receipt = objectFrom(value, "Trade-sharing choice") as ConsentReceipt;
  if (receipt.accepted === false) {
    exactKeys(receipt as Record<string, unknown>, new Set(["accepted"]), "Trade-sharing choice");
    return { accepted: false, grantedAt: "", sharePhone: false };
  }
  exactKeys(
    receipt as Record<string, unknown>,
    new Set(["accepted", "noticeVersion", "purpose", "grantedAt", "sharePhone"]),
    "Trade-sharing consent",
  );
  const grantedAt = typeof receipt.grantedAt === "string" ? receipt.grantedAt : "";
  const parsed = Date.parse(grantedAt);
  if (
    receipt.accepted !== true
    || receipt.noticeVersion !== ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION
    || receipt.purpose !== ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE
    || typeof receipt.sharePhone !== "boolean"
    || (receipt.sharePhone && !phone)
    || !Number.isFinite(parsed)
    || parsed > now.getTime() + 5 * 60 * 1000
  ) {
    throw new EnergyAssistantLeadError(400, "TRADE_CONSENT_INVALID", "Confirm the current trade-sharing choice.");
  }
  return { accepted: true, grantedAt: new Date(parsed).toISOString(), sharePhone: receipt.sharePhone };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeLead(input: EnergyAssistantLeadInput, now: Date): Promise<NormalizedLead> {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  const submissionKey = typeof input.submissionKey === "string" ? input.submissionKey : "";
  const sourceRequestId = input.sourceRequestId === undefined || input.sourceRequestId === null
    ? ""
    : optionalLine(input.sourceRequestId, 80, "Source request ID");
  if (!REQUEST_ID_PATTERN.test(requestId) || (sourceRequestId && !REQUEST_ID_PATTERN.test(sourceRequestId))) {
    throw new EnergyAssistantLeadError(400, "INVALID_REQUEST_ID", "Start a new follow-up request and try again.");
  }
  if (!SUBMISSION_KEY_PATTERN.test(submissionKey)) {
    throw new EnergyAssistantLeadError(400, "INVALID_SUBMISSION_KEY", "Start a new follow-up request and try again.");
  }
  if (input.interestConfirmed !== true) {
    throw new EnergyAssistantLeadError(
      400,
      "INTEREST_CONFIRMATION_REQUIRED",
      "Confirm that you asked Australian Energy Assessments to follow up. Advice remains available without this request.",
    );
  }
  if (typeof input.marketingConsent !== "boolean") {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Choose whether you want optional Australian Energy Assessments updates.");
  }

  const name = cleanLine(input.name, 2, 120, "Name");
  const emailValue = optionalLine(input.email, 254).toLowerCase();
  const phoneValue = optionalLine(input.phone, 32);
  if (emailValue && !EMAIL_PATTERN.test(emailValue)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Enter a valid email address.");
  }
  const phoneDigits = phoneValue.replace(/\D/g, "");
  if (phoneValue && (!PHONE_PATTERN.test(phoneValue) || phoneDigits.length < 8 || phoneDigits.length > 15)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Enter a valid phone number.");
  }
  if (!emailValue && !phoneValue) {
    throw new EnergyAssistantLeadError(400, "INVALID_LEAD", "Add an email address or phone number so Australian Energy Assessments can respond.");
  }

  const postcode = typeof input.postcode === "string" ? input.postcode.trim() : "";
  const suburbInput = typeof input.suburb === "string" ? input.suburb.replace(/\s+/g, " ").trim() : "";
  const localities = addressLocalitiesForPostcode(postcode);
  const locality = localities?.localities.find((candidate) =>
    candidate.suburb.toLocaleUpperCase("en-AU") === suburbInput.toLocaleUpperCase("en-AU"));
  const suppliedState = typeof input.state === "string" ? input.state.trim().toUpperCase() : "";
  if (!locality || (suppliedState && suppliedState !== locality.state)) {
    throw new EnergyAssistantLeadError(400, "INVALID_LOCALITY", "Choose a suburb and state listed for this residential postcode.");
  }

  const services = servicesFrom(input.services);
  const quoteBrief = quoteBriefFrom(input.quoteBrief, services);
  if (quoteBrief.contactPreference === "email" && !emailValue) {
    throw new EnergyAssistantLeadError(
      400,
      "INVALID_LEAD",
      "Add an email address or choose a different contact preference.",
    );
  }
  if (quoteBrief.contactPreference === "phone" && !phoneValue) {
    throw new EnergyAssistantLeadError(
      400,
      "INVALID_LEAD",
      "Add a phone number or choose a different contact preference.",
    );
  }
  const serviceConsentGrantedAt = receiptFrom(
    input.serviceConsent,
    ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
    ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
    now,
    "Australian Energy Assessments follow-up consent",
  );
  const tradeReceipt = tradeReceiptFrom(input.tradeSharingConsent, now, phoneValue || null);
  if (tradeReceipt.accepted && !emailValue) {
    throw new EnergyAssistantLeadError(400, "TRADE_EMAIL_REQUIRED", "Add an email address before choosing to share this brief with matched trades.");
  }
  if (tradeReceipt.accepted && name.split(/\s+/).length < 2) {
    throw new EnergyAssistantLeadError(400, "TRADE_NAME_REQUIRED", "Add your first and last name before sharing the brief with matched trades.");
  }

  const tradeDisclosedFields = tradeReceipt.accepted
    ? [
      "customer_email", "postcode", "state", "service_categories", "quote_brief", "customer_name",
      ...(tradeReceipt.sharePhone ? ["customer_phone"] : []),
    ]
    : [];
  const tradeDisclosedSnapshot: Record<string, unknown> = tradeReceipt.accepted
    ? {
      version: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
      grantedAt: tradeReceipt.grantedAt,
      disclosedFields: tradeDisclosedFields,
      contact: {
        name,
        email: emailValue,
        ...(tradeReceipt.sharePhone ? { phone: phoneValue } : {}),
        postcode,
        state: locality.state,
      },
      services,
      quoteBrief,
    }
    : {};
  const tradeDisclosedSnapshotJson = tradeReceipt.accepted ? JSON.stringify(tradeDisclosedSnapshot) : "{}";
  return {
    requestId,
    submissionKey,
    submissionKeySha256: await sha256Hex(submissionKey),
    sourceRequestId,
    name,
    email: emailValue || null,
    phone: phoneValue || null,
    postcode,
    suburb: locality.suburb,
    state: locality.state,
    services,
    quoteBrief,
    serviceConsentGrantedAt,
    marketingConsent: input.marketingConsent,
    marketingConsentGrantedAt: input.marketingConsent ? serviceConsentGrantedAt : "",
    tradeSharingConsent: tradeReceipt.accepted,
    tradeSharingGrantedAt: tradeReceipt.grantedAt,
    tradeDisclosedFields,
    tradeDisclosedSnapshot,
    tradeDisclosedSnapshotJson,
    tradeDisclosedSnapshotSha256: tradeReceipt.accepted ? await sha256Hex(tradeDisclosedSnapshotJson) : "",
  };
}

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function sameLead(row: EnergyAssistantLeadRow, input: NormalizedLead) {
  return row.request_id === input.requestId
    && row.submission_key_sha256 === input.submissionKeySha256
    && row.source_request_id === input.sourceRequestId
    && row.name === input.name
    && row.email === input.email
    && row.phone === input.phone
    && row.postcode === input.postcode
    && row.suburb === input.suburb
    && row.residential_state === input.state
    && JSON.stringify(parseJson(row.service_categories_json, null)) === JSON.stringify(input.services)
    && row.quote_brief_version === ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION
    && JSON.stringify(parseJson(row.quote_brief_json, null)) === JSON.stringify(input.quoteBrief)
    && Boolean(row.interest_confirmed)
    && row.source_journey === "energy-assistant-explicit-follow-up"
    && row.service_consent_version === ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION
    && row.service_consent_purpose === ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE
    && row.service_consent_granted_at === input.serviceConsentGrantedAt
    && Boolean(row.marketing_consent) === input.marketingConsent
    && row.marketing_consent_granted_at === input.marketingConsentGrantedAt
    && Boolean(row.trade_sharing_consent) === input.tradeSharingConsent
    && row.trade_sharing_notice_version === (input.tradeSharingConsent ? ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION : "")
    && row.trade_sharing_purpose === (input.tradeSharingConsent ? ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE : "")
    && row.trade_sharing_granted_at === input.tradeSharingGrantedAt
    && JSON.stringify(parseJson(row.trade_disclosed_fields_json, null)) === JSON.stringify(input.tradeDisclosedFields)
    && row.trade_disclosed_snapshot_json === input.tradeDisclosedSnapshotJson
    && row.trade_disclosed_snapshot_sha256 === input.tradeDisclosedSnapshotSha256;
}

async function loadLead(database: EnergyAssistantLeadDatabase, requestId: string) {
  return database.prepare(`SELECT id, request_id, submission_key_sha256, source_request_id,
      name, email, phone, postcode, suburb, residential_state, service_categories_json,
      quote_brief_version, quote_brief_json, interest_confirmed, source_journey,
      service_consent_version, service_consent_purpose, service_consent_granted_at,
      marketing_consent, marketing_consent_granted_at, trade_sharing_consent,
      trade_sharing_notice_version, trade_sharing_purpose, trade_sharing_granted_at,
      trade_disclosed_fields_json, trade_disclosed_snapshot_json,
      trade_disclosed_snapshot_sha256, opportunity_id, status
    FROM energy_assistant_leads
    WHERE request_id = ? LIMIT 1`)
    .bind(requestId)
    .first<EnergyAssistantLeadRow>();
}

function readable(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function energyAssistantQuoteBriefSummary(input: Pick<NormalizedLead, "services" | "quoteBrief">) {
  const brief = input.quoteBrief;
  const facts = brief.knownFacts.map((fact) => `${readable(fact.kind)}: ${fact.value}`);
  const constraints = brief.siteConstraints.map((constraint) => `${readable(constraint.kind)}: ${constraint.detail}`);
  const answers = brief.answers.map((answer) => `${answer.label}: ${answer.answer}`);
  return [
    `Services: ${input.services.map((service) => ENERGY_SERVICE_LABELS[service] || readable(service)).join(", ")}.`,
    `Property: ${readable(brief.propertyType)}. Relationship: ${readable(brief.tenure)}. Budget: ${readable(brief.budgetRange)}.`,
    answers.length ? `Quote answers: ${answers.join("; ")}.` : "",
    facts.length ? `Known facts: ${facts.join("; ")}.` : "",
    constraints.length ? `Site constraints: ${constraints.join("; ")}.` : "",
    brief.explicitUnknowns.length ? `Explicit unknowns: ${brief.explicitUnknowns.map(readable).join(", ")}.` : "",
    brief.additionalContext ? `Additional quote context: ${brief.additionalContext}` : "",
  ].filter(Boolean).join(" ").slice(0, 1_500);
}

function opportunityPayload(leadId: string, input: NormalizedLead, createdAt: string) {
  const nameParts = input.name.split(/\s+/);
  const timingAnswer = input.quoteBrief.answers.find((answer) => answer.questionId === "timing")?.answer || "";
  const timeframe = timingAnswer === "As soon as practical"
    ? "urgent"
    : timingAnswer === "Within 3 months"
      ? "one-three-months"
      : "planning";
  return {
    eventType: "direct_trade.project",
    sourceJourney: "energy-assistant",
    reference: `energy-assistant:${leadId}`,
    submittedAt: createdAt,
    customerFirstName: nameParts[0] || "",
    customerLastName: nameParts.slice(1).join(" "),
    email: input.email || "",
    phone: input.phone || "",
    customerSuburb: input.suburb,
    customerState: input.state,
    postcode: input.postcode,
    state: input.state,
    projectCategories: input.services,
    propertyType: input.quoteBrief.propertyType,
    projectStage: "planning",
    projectPriorities: ["quote-ready-brief"],
    projectNotes: energyAssistantQuoteBriefSummary(input),
    tradeSharing: {
      email: true,
      postcode: true,
      name: true,
      phone: input.tradeDisclosedFields.includes("customer_phone"),
      address: false,
    },
    timeframe,
    directTradeTriage: {
      status: "ready",
      autoSend: true,
      contactConsentReceipt: {
        accepted: true,
        purpose: ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
        noticeVersion: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
        grantedAt: input.tradeSharingGrantedAt,
      },
    },
  };
}

function assistantDispatchIds(leadId: string) {
  return {
    eventKey: `energy-assistant-lead:${leadId}`,
    notificationId: `energy-assistant-notification:${leadId}`,
    dispatchJobId: `energy-assistant-dispatch:${leadId}`,
    sourceReference: `energy-assistant:${leadId}`,
  };
}

async function reconcileAssistantTradeDispatch(
  row: EnergyAssistantLeadRow,
  input: NormalizedLead,
  opportunityId: string,
  dependencies: CreateLeadDependencies,
) {
  const now = (dependencies.now ? dependencies.now() : new Date()).toISOString();
  const dueAt = new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString();
  const ids = assistantDispatchIds(row.id);
  const eventId = (dependencies.randomUUID
    ? dependencies.randomUUID()
    : crypto.randomUUID()).toLowerCase();
  const releaseExistsSql = `EXISTS (
    SELECT 1
    FROM trade_opportunities opportunity
    JOIN public_trade_lead_contact_releases release
      ON release.opportunity_id = opportunity.id
    WHERE opportunity.id = ? AND opportunity.source_reference = ?
      AND release.source_reference = opportunity.source_reference
      AND release.status = 'active' AND release.withdrawn_at = ''
      AND release.notice_version = ? AND release.consent_purpose = ?
  )`;
  const linkedLeadExistsSql = `EXISTS (
    SELECT 1 FROM energy_assistant_leads linked
    WHERE linked.id = ? AND linked.opportunity_id = ?
      AND linked.trade_sharing_consent = 1
  )`;
  const notificationMetadata = JSON.stringify({
    status: "shared_with_trades",
    opportunityId,
    tradeSharing: "shared",
  });
  await dependencies.database.batch([
    dependencies.database.prepare(`UPDATE energy_assistant_leads
      SET opportunity_id = ?,
        status = CASE
          WHEN opportunity_id = '' OR status = 'quote_ready'
            THEN 'shared_with_trades'
          ELSE status
        END,
        updated_at = ?
      WHERE id = ? AND (opportunity_id = '' OR opportunity_id = ?)
        AND trade_sharing_consent = 1
        AND ${releaseExistsSql}`)
      .bind(
        opportunityId,
        now,
        row.id,
        opportunityId,
        opportunityId,
        ids.sourceReference,
        ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
        ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
      ),
    dependencies.database.prepare(`INSERT INTO energy_assistant_lead_events
      (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
      SELECT ?, ?, 'system', '', 'trade_opportunity_created',
        'The consented quote brief was released to the protected matched-trade workflow.', ?, ?
      WHERE ${linkedLeadExistsSql}
        AND NOT EXISTS (
          SELECT 1 FROM energy_assistant_lead_events
          WHERE lead_id = ? AND action = 'trade_opportunity_created'
        )`)
      .bind(
        eventId,
        row.id,
        JSON.stringify({ opportunityId }),
        now,
        row.id,
        opportunityId,
        row.id,
      ),
    dependencies.database.prepare(`UPDATE trade_opportunities
      SET status = 'open', updated_at = ?
      WHERE id = ? AND status IN ('draft', 'open')
        AND ${linkedLeadExistsSql}
        AND ${releaseExistsSql}`)
      .bind(
        now,
        opportunityId,
        row.id,
        opportunityId,
        opportunityId,
        ids.sourceReference,
        ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
        ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
      ),
    dependencies.database.prepare(`INSERT INTO admin_notifications
      (id, event_key, event_type, category, priority, title, summary,
       entity_type, entity_id, actor_type, actor_uid, requires_action, status,
       read_at, read_by_uid, resolved_at, resolved_by_uid, resolution_note,
       assigned_to_uid, assigned_at, due_at, metadata, created_at, updated_at)
      SELECT ?, ?, 'customer.energy_assistant_service_requested', 'customer', 'high',
        'Energy Guide follow-up requested',
        'A visitor explicitly requested Australian Energy Assessments follow-up and separately consented to share the immutable quote brief with approved matched trades.',
        'energy_assistant_lead', ?, 'system', '', 1, 'open', '', '', '', '', '',
        '', '', ?, ?, ?, ?
      WHERE ${linkedLeadExistsSql}
        AND EXISTS (
          SELECT 1 FROM trade_opportunities opportunity
          WHERE opportunity.id = ? AND opportunity.status = 'open'
        )
      ON CONFLICT(event_key) DO NOTHING`)
      .bind(
        ids.notificationId,
        ids.eventKey,
        row.id,
        dueAt,
        notificationMetadata,
        now,
        now,
        row.id,
        opportunityId,
        opportunityId,
      ),
    dependencies.database.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
      (id, opportunity_id, admin_notification_id, status, attempts,
       next_attempt_at, claimed_at, completed_at, failed_at, last_error,
       created_at, updated_at)
      SELECT ?, ?, notification.id, 'pending', 0, '', '', '', '', '', ?, ?
      FROM admin_notifications notification
      WHERE notification.event_key = ?
        AND ${linkedLeadExistsSql}
        AND EXISTS (
          SELECT 1 FROM trade_opportunities opportunity
          WHERE opportunity.id = ? AND opportunity.status = 'open'
        )
      ON CONFLICT(opportunity_id) DO UPDATE SET
        admin_notification_id = excluded.admin_notification_id,
        updated_at = excluded.updated_at`)
      .bind(
        ids.dispatchJobId,
        opportunityId,
        now,
        now,
        ids.eventKey,
        row.id,
        opportunityId,
        opportunityId,
      ),
  ]);

  const [stored, durableDispatch] = await Promise.all([
    loadLead(dependencies.database, input.requestId),
    dependencies.database.prepare(`SELECT opportunity.status opportunity_status,
        job.id dispatch_job_id, job.status dispatch_status
      FROM trade_opportunities opportunity
      JOIN customer_opportunity_dispatch_jobs job
        ON job.opportunity_id = opportunity.id
      WHERE opportunity.id = ? AND opportunity.source_reference = ? LIMIT 1`)
      .bind(opportunityId, ids.sourceReference)
      .first<{
        opportunity_status: string;
        dispatch_job_id: string;
        dispatch_status: string;
      }>(),
  ]);
  if (
    !stored
    || stored.opportunity_id !== opportunityId
    || (!row.opportunity_id && stored.status !== "shared_with_trades")
    || durableDispatch?.opportunity_status !== "open"
    || !durableDispatch.dispatch_job_id
  ) {
    throw new Error("ENERGY_ASSISTANT_OPPORTUNITY_LINK_FAILED");
  }
  return {
    dispatchJobId: durableDispatch.dispatch_job_id,
    opportunityId,
  };
}

async function ensureTradeOpportunity(
  row: EnergyAssistantLeadRow,
  input: NormalizedLead,
  createdAt: string,
  dependencies: CreateLeadDependencies,
) {
  if (!input.tradeSharingConsent) {
    return { opportunityId: "", allocation: null, dispatchJobId: "" };
  }
  if (input.quoteBrief.readiness.state !== "quote_ready") {
    return { opportunityId: "", allocation: null, dispatchJobId: "" };
  }
  let opportunityId = row.opportunity_id;
  let allocation: unknown = null;
  if (!opportunityId) {
    const createOpportunity = dependencies.createOpportunity
      || (await import("./opportunity-server.ts")).createOpportunityFromLead as CreateOpportunity;
    const result = await createOpportunity(opportunityPayload(row.id, input, createdAt));
    if (!result?.id) throw new Error("ENERGY_ASSISTANT_OPPORTUNITY_NOT_CREATED");
    opportunityId = result.id;
    allocation = result.allocation;
  }
  const durable = await reconcileAssistantTradeDispatch(
    row,
    input,
    opportunityId,
    dependencies,
  );
  return {
    opportunityId: durable.opportunityId,
    allocation,
    dispatchJobId: durable.dispatchJobId,
  };
}

export async function createEnergyAssistantLead(raw: unknown, dependencies: CreateLeadDependencies) {
  const source = objectFrom(raw, "The follow-up request");
  exactKeys(source, TOP_LEVEL_KEYS, "The follow-up request");
  const now = dependencies.now ? dependencies.now() : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid server clock.");
  const input = await normalizeLead(source as EnergyAssistantLeadInput, now);

  const existing = await loadLead(dependencies.database, input.requestId);
  if (existing) {
    if (existing.submission_key_sha256 !== input.submissionKeySha256 || !sameLead(existing, input)) {
      throw new EnergyAssistantLeadError(409, "REQUEST_ID_CONFLICT", "Start a new follow-up request before changing these details.");
    }
    const opportunity = await ensureTradeOpportunity(existing, input, existing.service_consent_granted_at, dependencies);
    const canonical = await loadLead(dependencies.database, input.requestId);
    return {
      leadId: existing.id,
      created: false,
      status: canonical?.status || existing.status,
      opportunityId: canonical?.opportunity_id || opportunity.opportunityId,
      dispatchJobId: opportunity.dispatchJobId,
      tradeSharing: input.tradeSharingConsent
        ? (canonical?.opportunity_id ? "shared" : "pending_information")
        : "not_requested",
    };
  }

  const leadId = (dependencies.randomUUID ? dependencies.randomUUID() : crypto.randomUUID()).toLowerCase();
  const eventId = (dependencies.randomUUID ? dependencies.randomUUID() : crypto.randomUUID()).toLowerCase();
  if (!UUID_PATTERN.test(leadId) || !UUID_PATTERN.test(eventId)) {
    throw new Error("The lead ID generator returned an invalid ID.");
  }
  const nowIso = now.toISOString();
  const initialStatus = input.quoteBrief.readiness.state;
  const statements = [
    dependencies.database.prepare(`INSERT OR IGNORE INTO energy_assistant_leads (
      id, request_id, submission_key_sha256, source_request_id, name, email, phone,
      postcode, suburb, residential_state, service_categories_json, quote_brief_version,
      quote_brief_json, interest_confirmed, source_journey, service_consent_version,
      service_consent_purpose, service_consent_granted_at, marketing_consent,
      marketing_consent_granted_at, trade_sharing_consent, trade_sharing_notice_version,
      trade_sharing_purpose, trade_sharing_granted_at, trade_disclosed_fields_json,
      trade_disclosed_snapshot_json, trade_disclosed_snapshot_sha256, opportunity_id,
      status, assigned_to_uid, due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
      'energy-assistant-explicit-follow-up', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '', '', ?, ?)`)
      .bind(
        leadId, input.requestId, input.submissionKeySha256, input.sourceRequestId,
        input.name, input.email, input.phone, input.postcode, input.suburb, input.state,
        JSON.stringify(input.services), ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
        JSON.stringify(input.quoteBrief), ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
        ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE, input.serviceConsentGrantedAt,
        input.marketingConsent ? 1 : 0, input.marketingConsentGrantedAt,
        input.tradeSharingConsent ? 1 : 0,
        input.tradeSharingConsent ? ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION : "",
        input.tradeSharingConsent ? ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE : "",
        input.tradeSharingGrantedAt, JSON.stringify(input.tradeDisclosedFields),
        input.tradeDisclosedSnapshotJson, input.tradeDisclosedSnapshotSha256,
        initialStatus, nowIso, nowIso,
      ),
    dependencies.database.prepare(`INSERT INTO energy_assistant_lead_events
      (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
      SELECT ?, id, 'visitor', '', 'created',
        'The visitor explicitly requested Australian Energy Assessments follow-up after receiving information.', ?, ?
      FROM energy_assistant_leads
      WHERE request_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM energy_assistant_lead_events
          WHERE lead_id = energy_assistant_leads.id AND action = 'created'
        )`)
      .bind(
        eventId,
        JSON.stringify({ services: input.services, tradeSharing: input.tradeSharingConsent, sourceRequestId: input.sourceRequestId }),
        nowIso,
        input.requestId,
      ),
  ];
  const [insertResult] = await dependencies.database.batch(statements);
  const canonical = await loadLead(dependencies.database, input.requestId);
  if (!canonical || !sameLead(canonical, input)) {
    throw new EnergyAssistantLeadError(409, "REQUEST_ID_CONFLICT", "Start a new follow-up request before changing these details.");
  }
  const created = Number(insertResult.meta?.changes || 0) === 1;
  const opportunity = await ensureTradeOpportunity(canonical, input, nowIso, dependencies);
  const stored = await loadLead(dependencies.database, input.requestId);
  return {
    leadId: canonical.id,
    created,
    status: stored?.status || canonical.status,
    opportunityId: stored?.opportunity_id || opportunity.opportunityId,
    dispatchJobId: opportunity.dispatchJobId,
    tradeSharing: input.tradeSharingConsent
      ? (stored?.opportunity_id ? "shared" : "pending_information")
      : "not_requested",
  };
}
