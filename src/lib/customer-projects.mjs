import { createHomeEnergyPlan } from "./home-energy-plan.mjs";
import { AUSTRALIAN_STATE_CODES, canonicalAustralianState } from "./australian-postcodes.mjs";

export const CUSTOMER_NOTICE_VERSION = "2026-07-15";
export const CUSTOMER_PLAN_VERSION = "2026-07-15";
export const MAX_CUSTOMER_PROJECTS = 40;
export const MAX_OPEN_CUSTOMER_OPPORTUNITIES = 5;

export const customerProjectOptions = {
  states: AUSTRALIAN_STATE_CODES,
  propertyTypes: [
    ["house", "Detached house"],
    ["townhouse", "Townhouse or terrace"],
    ["apartment", "Apartment or unit"],
    ["rural", "Rural home"],
    ["new-build", "New build or major renovation"],
  ],
  serviceCategories: [
    ["assessment", "Energy assessment"],
    ["solar", "Rooftop solar"],
    ["battery", "Home battery"],
    ["heating-cooling", "Heating and cooling"],
    ["hot-water", "Hot water"],
    ["insulation-draughts", "Insulation and draught control"],
    ["ev-charging", "EV charging"],
    ["other", "Other energy upgrade"],
  ],
  priorities: [
    ["lower-bills", "Lower ongoing bills"],
    ["comfort", "Improve comfort"],
    ["move-from-gas", "Move away from gas"],
    ["resilience", "Improve outage resilience"],
    ["future-ready", "Prepare for future needs"],
    ["replace-failed", "Replace failed equipment"],
  ],
  stages: [
    ["exploring", "Exploring options"],
    ["planning", "Building a plan"],
    ["ready-for-pricing", "Ready for indicative pricing"],
    ["urgent-replacement", "Urgent replacement"],
  ],
  timings: [
    ["planning", "No fixed timing"],
    ["within_3_months", "Within three months"],
    ["within_30_days", "Within 30 days"],
    ["urgent", "Urgent"],
  ],
  budgets: [
    ["not_set", "Prefer not to set a budget"],
    ["under_5k", "Under $5,000"],
    ["5_15k", "$5,000 to $15,000"],
    ["15_30k", "$15,000 to $30,000"],
    ["30_60k", "$30,000 to $60,000"],
    ["60k_plus", "$60,000 or more"],
  ],
};

export const platformQuoteOptions = {
  quoteTypes: [
    ["indicative", "Indicative platform estimate"],
    ["fixed-subject-to-site", "Fixed scope, subject to site confirmation"],
    ["assessment-first", "Assessment required before final pricing"],
  ],
  inclusions: [
    ["site-assessment", "Site assessment"],
    ["design-sizing", "Design and equipment sizing"],
    ["permits-approvals", "Permits and approvals"],
    ["electrical-enabling", "Electrical enabling work"],
    ["removal-disposal", "Removal and disposal"],
    ["installation-commissioning", "Installation and commissioning"],
    ["monitoring-setup", "Monitoring setup"],
    ["warranty-handover", "Warranty documentation"],
  ],
  startWindows: [
    ["within_30_days", "Within 30 days"],
    ["1_3_months", "One to three months"],
    ["3_6_months", "Three to six months"],
    ["later", "Later than six months"],
    ["to_confirm", "To be confirmed"],
  ],
};

const states = new Set(customerProjectOptions.states);
const propertyTypes = new Set(customerProjectOptions.propertyTypes.map(([value]) => value));
const serviceCategories = new Set(customerProjectOptions.serviceCategories.map(([value]) => value));
const priorities = new Set(customerProjectOptions.priorities.map(([value]) => value));
const stages = new Set(customerProjectOptions.stages.map(([value]) => value));
const timings = new Set(customerProjectOptions.timings.map(([value]) => value));
const budgets = new Set(customerProjectOptions.budgets.map(([value]) => value));
const quoteTypes = new Set(platformQuoteOptions.quoteTypes.map(([value]) => value));
const quoteInclusions = new Set(platformQuoteOptions.inclusions.map(([value]) => value));
const quoteStartWindows = new Set(platformQuoteOptions.startWindows.map(([value]) => value));

const label = (options, value, fallback = value) => options.find(([key]) => key === value)?.[1] || fallback;

function text(value, maximum) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function list(value, allowed, maximum = 20) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && allowed.has(item)))].slice(0, maximum)
    : [];
}

function integer(value, minimum, maximum, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function parseStoredJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function validateCustomerProfile(raw = {}) {
  const displayName = text(raw.displayName, 80);
  const postcode = text(raw.postcode, 4);
  const addressState = canonicalAustralianState(raw.addressState) || "";
  const propertyType = propertyTypes.has(raw.propertyType) ? raw.propertyType : "house";
  const householdSituation = ["owner", "renter", "strata", "planning-building"].includes(raw.householdSituation)
    ? raw.householdSituation
    : "owner";
  if (!displayName) return { ok: false, error: "Enter the name you want shown in your private account." };
  if (!/^\d{4}$/.test(postcode)) return { ok: false, error: "Enter a four digit Australian postcode." };
  if (!states.has(addressState)) return { ok: false, error: "Choose your state or territory." };
  if (raw.consent !== true) return { ok: false, error: "Confirm the private account notice to continue." };
  return {
    ok: true,
    profile: {
      displayName,
      postcode,
      addressState,
      propertyType,
      householdSituation,
      accountUpdates: raw.accountUpdates === true,
    },
  };
}

export function normalizeCustomerProject(raw = {}) {
  const goal = typeof raw.goal === "string" ? raw.goal : "lower-bills";
  const pace = typeof raw.pace === "string" ? raw.pace : "staged";
  const householdSituation = ["owner", "renter", "strata", "planning-building"].includes(raw.householdSituation)
    ? raw.householdSituation
    : "owner";
  const existingFeatures = Array.isArray(raw.existingFeatures) ? raw.existingFeatures : [];
  const plan = createHomeEnergyPlan({ goal, pace, situation: householdSituation, features: existingFeatures });
  const normalized = {
    title: text(raw.title, 120),
    homeNickname: text(raw.homeNickname, 80) || "My home",
    postcode: text(raw.postcode, 4),
    addressState: canonicalAustralianState(raw.addressState) || "",
    propertyType: propertyTypes.has(raw.propertyType) ? raw.propertyType : "house",
    householdSituation: plan.situation,
    goal: plan.goal,
    pace: plan.pace,
    existingFeatures: plan.features,
    serviceCategories: list(raw.serviceCategories, serviceCategories, 8),
    priorities: list(raw.priorities, priorities, 6),
    projectStage: stages.has(raw.projectStage) ? raw.projectStage : "exploring",
    timing: timings.has(raw.timing) ? raw.timing : "planning",
    budgetRange: budgets.has(raw.budgetRange) ? raw.budgetRange : "not_set",
    privateNotes: typeof raw.privateNotes === "string" ? raw.privateNotes.trim().slice(0, 2000) : "",
    planSnapshot: { version: CUSTOMER_PLAN_VERSION, ...plan },
  };
  if (!normalized.title) return { ok: false, error: "Give this project a private name." };
  if (!/^\d{4}$/.test(normalized.postcode)) return { ok: false, error: "Enter a four digit project postcode." };
  if (!states.has(normalized.addressState)) return { ok: false, error: "Choose the project state or territory." };
  return { ok: true, project: normalized };
}

export function submissionReadiness(project) {
  if (!project.serviceCategories?.length) return { ok: false, error: "Choose at least one type of work before requesting installer responses." };
  if (!project.priorities?.length) return { ok: false, error: "Choose at least one project priority." };
  return { ok: true };
}

export function buildAnonymizedOpportunity(project, projectId) {
  const categories = project.serviceCategories;
  const categoryLabels = categories.map((item) => label(customerProjectOptions.serviceCategories, item));
  const priorityLabels = project.priorities.map((item) => label(customerProjectOptions.priorities, item));
  const propertyLabel = label(customerProjectOptions.propertyTypes, project.propertyType, "Home");
  const stageLabel = label(customerProjectOptions.stages, project.projectStage, "Planning");
  const paceLabel = project.pace === "whole-home" ? "coordinated whole-home" : project.pace === "one-step" ? "single next-step" : "staged";
  const title = categoryLabels.length === 1 ? `${categoryLabels[0]} project` : "Multi-upgrade home project";
  return {
    title,
    projectType: `${propertyLabel} | ${stageLabel}`,
    postcode: project.postcode,
    state: project.addressState,
    serviceCategories: categories,
    priority: project.timing === "urgent" ? "urgent" : "standard",
    timing: project.timing,
    summary: `${propertyLabel} household seeking ${categoryLabels.join(", ").toLowerCase()}. Priorities: ${priorityLabels.join(", ").toLowerCase()}. The household is following a ${paceLabel} plan. Identity, exact location, contact details, private notes and usage records are withheld. Respond only through the structured platform workflow.`,
    sourceReference: `customer-project:${projectId}`,
  };
}

export function normalizePlatformQuote(raw = {}) {
  const quoteType = quoteTypes.has(raw.quoteType) ? raw.quoteType : "indicative";
  const inclusions = list(raw.inclusions, quoteInclusions, 8);
  const startWindow = quoteStartWindows.has(raw.startWindow) ? raw.startWindow : "to_confirm";
  const labourCentsExGst = integer(raw.labourCentsExGst, 0, 50_000_000);
  const otherCentsExGst = integer(raw.otherCentsExGst, 0, 50_000_000);
  const durationWeeks = integer(raw.durationWeeks, 0, 104);
  const workmanshipWarrantyYears = integer(raw.workmanshipWarrantyYears, 0, 30);
  const productListId = text(raw.productListId, 180);
  if (!inclusions.length) return { ok: false, error: "Choose at least one included service." };
  if (!productListId && labourCentsExGst + otherCentsExGst <= 0) {
    return { ok: false, error: "Add a saved product list or a labour and services amount." };
  }
  return {
    ok: true,
    quote: { quoteType, inclusions, startWindow, labourCentsExGst, otherCentsExGst, durationWeeks, workmanshipWarrantyYears, productListId },
  };
}

export function quoteLabel(value, options) {
  return label(options, value, String(value || "").replaceAll("_", " "));
}
