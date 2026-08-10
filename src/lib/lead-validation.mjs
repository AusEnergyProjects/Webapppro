import { australianStateLabel, canonicalAustralianState, postcodeMatchesState, residentialStateFromPostcode } from "./australian-postcodes.mjs";
import { resolveAddressLocalityTuple } from "./address-localities.mjs";
import {
  isPublicPlanEnquiry,
  isPublicPlanSubmissionId,
  normalizePublicPlanSnapshot,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "./public-plan-enquiry.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PUBLIC_PLAN_PHONE_RE = /^[+\d()\s.-]+$/;
const DIRECT_TRADE_CATEGORIES = new Set([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "other",
]);
const LEGACY_DIRECT_TRADE_CATEGORY_ALIASES = {
  "insulation-draughts": ["insulation", "draught-proofing"],
};
const PROPERTY_TYPES = new Set(["house", "townhouse-unit", "apartment", "small-business", "other"]);
const PROJECT_STAGES = new Set(["researching", "assessment-ready", "seeking-quotes", "replacement-urgent"]);
const PROJECT_TIMEFRAMES = new Set(["urgent", "one-three-months", "three-six-months", "later"]);
const PROPERTY_RELATIONSHIPS = new Set(["owner-occupier", "landlord-manager", "authorised-tenant", "organisation-representative", "planning-only"]);
const PROJECT_PRIORITIES = new Set(["lower-running-costs", "improve-comfort", "replace-equipment", "move-from-gas", "solar-storage", "assessment-compliance", "need-advice"]);
const PROJECT_SOURCES = new Set(["electricity-solar", "electricity-battery", "gas-heating", "gas-hot-water"]);
const CONTACT_METHODS = new Set(["email", "phone", "either"]);
const PARTNER_TYPES = new Set(["installer", "supplier"]);
const ELECTRICITY_ENQUIRIES = new Set(["electricity-solar", "electricity-solar-battery", "electricity-battery", "solar", "solar-battery", "battery"]);
const GAS_ENQUIRIES = new Set(["gas-heating", "gas-hot-water"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanSingleLine(value, maxLength) {
  return typeof value === "string"
    ? value
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength)
    : "";
}

function cleanNumber(value, minimum = 0, maximum = 100000000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function cleanEnum(value, allowed) {
  const text = typeof value === "string" ? value.trim() : "";
  return allowed.has(text) ? text : "";
}

function cleanStringArray(value, allowed, maximum = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanEnum(item, allowed)).filter(Boolean))].slice(0, maximum);
}

function cleanDirectTradeCategories(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    const text = typeof item === "string" ? item.trim() : "";
    return LEGACY_DIRECT_TRADE_CATEGORY_ALIASES[text] || [text];
  });
  return [...new Set(normalized.filter((item) => DIRECT_TRADE_CATEGORIES.has(item)))].slice(
    0,
    DIRECT_TRADE_CATEGORIES.size,
  );
}

function cleanTopPlans(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((plan) => ({
    rank: cleanNumber(plan?.rank, 1, 3),
    brand: cleanText(plan?.brand, 100),
    plan: cleanText(plan?.plan, 180),
    offerId: cleanText(plan?.offerId, 160),
    annual: cleanNumber(plan?.annual, -1000000, 10000000),
    monthly: cleanNumber(plan?.monthly, -100000, 1000000),
    tariffHash: cleanText(plan?.tariffHash, 80),
    link: cleanText(plan?.link, 1000),
  })).filter((plan) => plan.rank && plan.brand && plan.plan && plan.annual !== null);
}

function cleanProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    engineVersion: cleanText(value.engineVersion, 80),
    tariffSchemaVersion: cleanText(value.tariffSchemaVersion, 80),
    sourceHash: cleanText(value.sourceHash, 80),
    sourceFetchedAt: cleanText(value.sourceFetchedAt, 40),
    annualSource: cleanText(value.annualSource, 40),
    meterConfidence: cleanText(value.meterConfidence, 24),
    conditionalDiscountsAssumed: Boolean(value.conditionalDiscountsAssumed),
  };
}

function publicPlanTradeSharing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Choose which contact details matching trades may receive." };
  }
  const allowedKeys = new Set(["email", "postcode", "name", "phone", "address"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "The trade sharing selection contained an unsupported field." };
  }
  if (value.email !== true || value.postcode !== true) {
    return { ok: false, error: "Email and postcode must be shared so matching trades can respond." };
  }
  for (const key of ["name", "phone", "address"]) {
    if (typeof value[key] !== "boolean") {
      return { ok: false, error: "Choose each optional trade sharing preference." };
    }
  }
  return {
    ok: true,
    value: {
      email: true,
      postcode: true,
      name: value.name,
      phone: value.phone,
      address: value.address,
    },
  };
}

export function validateLeadPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request." };
  }

  const submissionType = cleanText(raw.submissionType, 32);
  if (!['comparison', 'upgrade'].includes(submissionType)) {
    return { ok: false, error: "Unknown enquiry type." };
  }

  const suppliedName = cleanText(raw.name, 120);
  const email = cleanText(raw.email, 254).toLowerCase();
  const phone = cleanText(raw.phone, 40);
  const customerFirstName = cleanSingleLine(raw.customerFirstName, 60);
  const customerLastName = cleanSingleLine(raw.customerLastName, 60);
  const customerUnitNumber = cleanSingleLine(raw.customerUnitNumber, 40);
  const customerStreetAddress = cleanSingleLine(raw.customerStreetAddress, 140);
  const customerSuburb = cleanSingleLine(raw.customerSuburb, 80);
  const customerState = cleanSingleLine(raw.customerState, 3).toUpperCase();
  const enquiry = cleanText(raw.enquiry, 80);
  const publicPlanEnquiry = isPublicPlanEnquiry(enquiry);
  const name = publicPlanEnquiry
    ? [customerFirstName, customerLastName].filter(Boolean).join(" ")
    : suppliedName;
  if (!publicPlanEnquiry && !name) return { ok: false, error: "Please enter your name." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (submissionType === 'comparison' && !email) return { ok: false, error: "An email address is required for comparison results." };
  if (submissionType === 'upgrade' && !email && !phone) return { ok: false, error: "Please enter an email address or phone number." };

  const consent = raw.consent;
  const consentPurpose = cleanText(consent?.purpose, 160);
  const consentVersion = cleanText(consent?.noticeVersion, 64);
  const consentGrantedAt = cleanText(consent?.grantedAt, 40);
  if (!consent || consent.accepted !== true || !consentPurpose || !consentVersion || !Number.isFinite(Date.parse(consentGrantedAt))) {
    return { ok: false, error: "Please confirm that we may use your details for this request." };
  }
  if (publicPlanEnquiry && (
    consentPurpose !== PUBLIC_PLAN_CONSENT_PURPOSE
    || consentVersion !== PUBLIC_PLAN_CONSENT_NOTICE_VERSION
  )) {
    return { ok: false, error: "Please confirm the current contact notice for this upgrade enquiry." };
  }

  const annualKwh = cleanNumber(raw.annualKwh, 0, 100000000);
  const annualMj = cleanNumber(raw.annualMj, 0, 100000000);
  const postcode = cleanText(raw.postcode, 4);
  if (postcode && !/^\d{4}$/.test(postcode)) return { ok: false, error: "Invalid postcode." };
  const projectCategories = cleanDirectTradeCategories(raw.projectCategories);
  const state = canonicalAustralianState(raw.state) || "";
  const propertyType = cleanEnum(raw.propertyType, PROPERTY_TYPES);
  const projectStage = cleanEnum(raw.projectStage, PROJECT_STAGES);
  const timeframe = cleanEnum(raw.timeframe, PROJECT_TIMEFRAMES);
  const propertyRelationship = cleanEnum(raw.propertyRelationship, PROPERTY_RELATIONSHIPS);
  const projectPriorities = cleanStringArray(raw.projectPriorities, PROJECT_PRIORITIES, 7);
  const projectSource = cleanEnum(raw.projectSource, PROJECT_SOURCES);
  const preferredContact = cleanEnum(raw.preferredContact, CONTACT_METHODS);
  const partnerType = cleanEnum(raw.partnerType, PARTNER_TYPES);
  const serviceStates = [...new Set(Array.isArray(raw.serviceStates)
    ? raw.serviceStates.map(canonicalAustralianState).filter(Boolean)
    : [])].slice(0, 8);
  if (publicPlanEnquiry) {
    if (submissionType !== "upgrade") return { ok: false, error: "Unknown enquiry type." };
    if (!customerFirstName) return { ok: false, error: "Please enter your first name." };
    if (!customerLastName) return { ok: false, error: "Please enter your last name." };
    if (!email) return { ok: false, error: "Please enter an email address." };
    if (!phone) return { ok: false, error: "Please enter a phone number for Australian Energy Assessments records." };
    if (!customerStreetAddress) return { ok: false, error: "Please enter the property's street address for Australian Energy Assessments records." };
    if (!customerSuburb) return { ok: false, error: "Please choose the property's suburb." };
    if (!customerState) return { ok: false, error: "Please choose the property's suburb and state." };
    if (!postcode) return { ok: false, error: "Please enter the property's postcode." };
    const addressLocality = resolveAddressLocalityTuple({
      postcode,
      suburb: customerSuburb,
      state: customerState,
    });
    if (!addressLocality) {
      return { ok: false, error: "Choose a suburb and state listed for this postcode." };
    }
    if (!projectCategories.length) return { ok: false, error: "Please choose at least one service." };
    const submissionId = cleanText(raw.submissionId, 64);
    if (!isPublicPlanSubmissionId(submissionId)) {
      return { ok: false, error: "Start a new home plan enquiry and try again." };
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phone && (
      !PUBLIC_PLAN_PHONE_RE.test(phone)
      || phoneDigits.length < 8
      || phoneDigits.length > 15
    )) return { ok: false, error: "Please enter a valid phone number." };
    const planSnapshot = normalizePublicPlanSnapshot(raw.planSnapshot);
    if (!planSnapshot.ok) return planSnapshot;
    const projectNotes = cleanText(raw.projectNotes, 500);
    const tradeSharing = publicPlanTradeSharing(raw.tradeSharing);
    if (!tradeSharing.ok) return tradeSharing;
    raw = {
      ...raw,
      customerSuburb: addressLocality.suburb,
      customerState: addressLocality.state,
      planSnapshot: planSnapshot.value,
      projectNotes,
      tradeSharing: tradeSharing.value,
    };
  }
  if (enquiry === "direct-trade-project") {
    if (submissionType !== "upgrade") return { ok: false, error: "Unknown enquiry type." };
    if (!postcode || !state) return { ok: false, error: "Please enter a postcode and choose a state or territory." };
    if (!postcodeMatchesState(postcode, state)) {
      return { ok: false, error: `Postcode ${postcode} is usually in ${australianStateLabel(residentialStateFromPostcode(postcode))}. Please check the postcode or state.` };
    }
    if (!projectCategories.length) return { ok: false, error: "Please choose at least one service." };
    if (!propertyType || !projectStage || !timeframe || !propertyRelationship || !preferredContact) return { ok: false, error: "Please complete the project details." };
    if (!projectPriorities.length) return { ok: false, error: "Please choose at least one project priority." };
  }
  if (enquiry === "direct-trade-partner") {
    if (submissionType !== "upgrade" || !partnerType) return { ok: false, error: "Please choose a participation type." };
    if (!cleanText(raw.businessName, 160)) return { ok: false, error: "Please enter the business name." };
    if (!serviceStates.length) return { ok: false, error: "Please choose at least one service area." };
    if (!projectCategories.length) return { ok: false, error: "Please choose at least one capability or product category." };
  }
  if (submissionType === "comparison") {
    if (!postcode || !annualKwh || annualKwh <= 0) return { ok: false, error: "Complete the comparison before emailing results." };
    if (!cleanTopPlans(raw.top3).length) return { ok: false, error: "No complete plan results were available to email." };
  }
  if (submissionType === "upgrade" && !publicPlanEnquiry && !["direct-trade-project", "direct-trade-partner"].includes(enquiry)) {
    if (!ELECTRICITY_ENQUIRIES.has(enquiry) && !GAS_ENQUIRIES.has(enquiry)) return { ok: false, error: "Unknown upgrade enquiry." };
    if (ELECTRICITY_ENQUIRIES.has(enquiry) && (!postcode || !annualKwh || annualKwh <= 0)) return { ok: false, error: "Complete the electricity scenario before sending an enquiry." };
    if (GAS_ENQUIRIES.has(enquiry) && (!annualMj || annualMj <= 0)) return { ok: false, error: "Enter annual gas usage before sending an enquiry." };
  }

  if (publicPlanEnquiry) {
    return {
      ok: true,
      value: {
        submissionType,
        submissionId: cleanText(raw.submissionId, 64),
        submittedAt: new Date().toISOString(),
        name,
        customerFirstName,
        customerLastName,
        email,
        phone,
        customerUnitNumber,
        customerStreetAddress,
        customerSuburb: raw.customerSuburb,
        customerState: raw.customerState,
        website: cleanText(raw.website, 200),
        clientStartedAt: cleanNumber(raw.clientStartedAt, 0, Number.MAX_SAFE_INTEGER),
        consent: {
          accepted: true,
          purpose: consentPurpose,
          noticeVersion: consentVersion,
          grantedAt: consentGrantedAt,
        },
        upgrades: true,
        enquiry,
        postcode,
        projectCategories,
        preferredContact: email && phone ? "either" : email ? "email" : "phone",
        projectNotes: cleanText(raw.projectNotes, 500),
        tradeSharing: raw.tradeSharing,
        planSnapshot: raw.planSnapshot,
      },
    };
  }

  return {
    ok: true,
    value: {
      submissionType,
      submittedAt: new Date().toISOString(),
      name,
      email,
      phone,
      website: cleanText(raw.website, 200),
      clientStartedAt: cleanNumber(raw.clientStartedAt, 0, Number.MAX_SAFE_INTEGER),
      consent: {
        accepted: true,
        purpose: consentPurpose,
        noticeVersion: consentVersion,
        grantedAt: consentGrantedAt,
      },
      upgrades: Boolean(raw.upgrades),
      enquiry,
      type: cleanText(raw.type, 160),
      postcode,
      state,
      annualKwh,
      annualMj,
      projectCategories,
      propertyType,
      propertyRelationship,
      projectPriorities,
      projectSource,
      projectStage,
      timeframe,
      preferredContact,
      projectNotes: cleanText(raw.projectNotes, 800),
      partnerType,
      businessName: cleanText(raw.businessName, 160),
      businessWebsite: cleanText(raw.businessWebsite, 300),
      serviceStates,
      partnerNotes: cleanText(raw.partnerNotes, 800),
      solar: cleanText(raw.solar, 32),
      hasEv: Boolean(raw.hasEv),
      hasControlledLoad: Boolean(raw.hasControlledLoad),
      solarKw: cleanNumber(raw.solarKw, 0, 1000),
      batteryKwh: cleanNumber(raw.batteryKwh, 0, 1000),
      solarCost: cleanNumber(raw.solarCost, 0, 100000000),
      comboCost: cleanNumber(raw.comboCost, 0, 100000000),
      installedCost: cleanNumber(raw.installedCost, 0, 100000000),
      annualSaving: cleanNumber(raw.annualSaving, -100000000, 100000000),
      top3: cleanTopPlans(raw.top3),
      provenance: cleanProvenance(raw.provenance),
      magicLink: cleanText(raw.magicLink, 2000),
      recheckMonths: cleanNumber(raw.recheckMonths, 0, 120),
    },
  };
}
