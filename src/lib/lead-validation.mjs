import { australianStateLabel, canonicalAustralianState, postcodeMatchesState, residentialStateFromPostcode } from "./australian-postcodes.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DIRECT_TRADE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);
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

export function validateLeadPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request." };
  }

  const submissionType = cleanText(raw.submissionType, 32);
  if (!['comparison', 'upgrade'].includes(submissionType)) {
    return { ok: false, error: "Unknown enquiry type." };
  }

  const name = cleanText(raw.name, 120);
  const email = cleanText(raw.email, 254).toLowerCase();
  const phone = cleanText(raw.phone, 40);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (submissionType === 'comparison' && !email) return { ok: false, error: "An email address is required for comparison results." };
  if (submissionType === 'upgrade' && !email && !phone) return { ok: false, error: "Please enter an email address or phone number." };

  const consent = raw.consent;
  const consentPurpose = cleanText(consent?.purpose, 160);
  const consentVersion = cleanText(consent?.noticeVersion, 40);
  const consentGrantedAt = cleanText(consent?.grantedAt, 40);
  if (!consent || consent.accepted !== true || !consentPurpose || !consentVersion || !Number.isFinite(Date.parse(consentGrantedAt))) {
    return { ok: false, error: "Please confirm that we may use your details for this request." };
  }

  const annualKwh = cleanNumber(raw.annualKwh, 0, 100000000);
  const annualMj = cleanNumber(raw.annualMj, 0, 100000000);
  const postcode = cleanText(raw.postcode, 4);
  if (postcode && !/^\d{4}$/.test(postcode)) return { ok: false, error: "Invalid postcode." };
  const enquiry = cleanText(raw.enquiry, 80);
  const projectCategories = cleanStringArray(raw.projectCategories, DIRECT_TRADE_CATEGORIES);
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
  if (submissionType === "upgrade" && !["direct-trade-project", "direct-trade-partner"].includes(enquiry)) {
    if (!ELECTRICITY_ENQUIRIES.has(enquiry) && !GAS_ENQUIRIES.has(enquiry)) return { ok: false, error: "Unknown upgrade enquiry." };
    if (ELECTRICITY_ENQUIRIES.has(enquiry) && (!postcode || !annualKwh || annualKwh <= 0)) return { ok: false, error: "Complete the electricity scenario before sending an enquiry." };
    if (GAS_ENQUIRIES.has(enquiry) && (!annualMj || annualMj <= 0)) return { ok: false, error: "Enter annual gas usage before sending an enquiry." };
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
