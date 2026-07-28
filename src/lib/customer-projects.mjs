import { createHomeEnergyPlan } from "./home-energy-plan.mjs";
import { AUSTRALIAN_STATE_CODES, canonicalAustralianState } from "./australian-postcodes.mjs";

export const CUSTOMER_NOTICE_VERSION = "2026-07-18-quoting-photos";
export const CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION = "2026-07-29";
export const CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION = "2026-07-18";
export const CUSTOMER_CONTACT_RELEASE_FIELDS = ["name", "email", "phone", "service_address"];
export const CUSTOMER_PLAN_VERSION = "2026-07-29-home-advisor";
export const CUSTOMER_LEGACY_PLAN_VERSIONS = ["2026-07-15"];
const LEGACY_CUSTOMER_PLAN_VERSIONS = new Set(CUSTOMER_LEGACY_PLAN_VERSIONS);
export const MAX_CUSTOMER_PROJECTS = 40;
export const MAX_OPEN_CUSTOMER_OPPORTUNITIES = 5;

export const customerProjectOptions = {
  states: AUSTRALIAN_STATE_CODES,
  goals: [
    ["lower-bills", "Lower energy bills"],
    ["improve-comfort", "Feel warmer in winter and cooler in summer"],
    ["healthier-home", "Improve indoor air quality and moisture control"],
    ["reduce-emissions", "Reduce household emissions"],
    ["replace-now", "Replace failed or ageing equipment"],
    ["move-from-gas", "Move away from gas"],
    ["add-solar-storage", "Add solar or storage"],
    ["improve-resilience", "Prepare for outages and extreme weather"],
    ["prepare-renovation", "Plan a renovation or new home"],
    ["renter-friendly", "Find renter-friendly improvements"],
  ],
  situations: [
    ["owner", "I own the home"],
    ["renter", "I rent the home"],
  ],
  approvalContexts: [
    ["none", "No strata or common-property approval known"],
    ["strata", "Strata, owners corporation or common property may apply"],
    ["not_sure", "Not sure"],
  ],
  paces: [
    ["one-step", "One practical next step"],
    ["staged", "Stage improvements over time"],
    ["whole-home", "Coordinate the whole home"],
  ],
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
    ["draught-proofing", "Draught-proofing"],
    ["insulation", "Insulation"],
    ["glazing", "Glazing"],
    ["window-coverings", "Blinds, shutters and external shading"],
    ["ev-charging", "EV charging"],
    ["other", "Other energy upgrade"],
  ],
  homeFeatures: [
    ["draughty", "Draughty, too hot or too cold"],
    ["condensation-moisture", "Condensation, damp or mould concerns"],
    ["single-glazing", "Some or all windows are single glazed"],
    ["double-glazing", "Some or all windows are double glazed"],
    ["glazing-unknown", "Window glazing is not known"],
    ["roof-insulation", "Roof or ceiling insulation"],
    ["wall-insulation", "Wall insulation"],
    ["floor-insulation", "Underfloor insulation"],
    ["insulation-unknown", "Insulation is not known"],
    ["external-shading", "External blinds, awnings, shutters or shade"],
    ["internal-window-coverings", "Curtains or internal blinds"],
    ["open-wall-vents", "Open wall vents or an unused chimney"],
    ["evaporative-ducts", "Evaporative cooling ducts or ceiling outlets"],
    ["reverse-cycle", "Reverse-cycle heating and cooling"],
    ["gas-heating", "Gas heating"],
    ["gas-hot-water", "Gas hot water"],
    ["heat-pump-hot-water", "Heat pump hot water"],
    ["gas-cooking", "Gas cooking"],
    ["solar", "Rooftop solar"],
    ["battery", "Home battery"],
    ["ev", "EV or planned EV"],
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
    ["under_2k", "Under $2,000"],
    ["2_10k", "$2,000 to $10,000"],
    ["10k_plus", "$10,000 or more"],
  ],
  storeys: [
    ["single", "Single storey"],
    ["two", "Two storeys"],
    ["three_plus", "Three or more storeys"],
    ["not_sure", "Not sure"],
  ],
  ageBands: [
    ["pre_1960", "Built before 1960"],
    ["1960_1999", "Built from 1960 to 1999"],
    ["2000_2014", "Built from 2000 to 2014"],
    ["2015_plus", "Built from 2015 onwards"],
    ["not_sure", "Not sure"],
  ],
  floorAreas: [
    ["under_100", "Under 100 m2"],
    ["100_199", "100 to 199 m2"],
    ["200_299", "200 to 299 m2"],
    ["300_plus", "300 m2 or more"],
    ["not_sure", "Not sure"],
  ],
  roofTypes: [
    ["metal", "Metal roof"],
    ["tile", "Tiled roof"],
    ["flat", "Flat or membrane roof"],
    ["mixed", "Mixed roof types"],
    ["not_sure", "Not sure"],
  ],
  switchboards: [
    ["modern_breakers", "Modern circuit breakers"],
    ["older_fuses", "Older fuse board"],
    ["recent_upgrade", "Recently upgraded"],
    ["not_sure", "Not sure"],
  ],
  accessConstraints: [
    ["limited_parking", "Limited parking or loading access"],
    ["stairs", "Stairs or difficult equipment access"],
    ["strata_common_property", "Strata or common property approvals"],
    ["restricted_roof", "Restricted roof access"],
    ["pets", "Pets need to be secured for a visit"],
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
const goals = new Set(customerProjectOptions.goals.map(([value]) => value));
const situations = new Set(customerProjectOptions.situations.map(([value]) => value));
const approvalContexts = new Set(customerProjectOptions.approvalContexts.map(([value]) => value));
const paces = new Set(customerProjectOptions.paces.map(([value]) => value));
const propertyTypes = new Set(customerProjectOptions.propertyTypes.map(([value]) => value));
const serviceCategories = new Set([
  ...customerProjectOptions.serviceCategories.map(([value]) => value),
  "insulation-draughts",
]);
const homeFeatures = new Set(customerProjectOptions.homeFeatures.map(([value]) => value));
const priorities = new Set(customerProjectOptions.priorities.map(([value]) => value));
const stages = new Set(customerProjectOptions.stages.map(([value]) => value));
const timings = new Set(customerProjectOptions.timings.map(([value]) => value));
const budgets = new Set(customerProjectOptions.budgets.map(([value]) => value));
const storeys = new Set(customerProjectOptions.storeys.map(([value]) => value));
const ageBands = new Set(customerProjectOptions.ageBands.map(([value]) => value));
const floorAreas = new Set(customerProjectOptions.floorAreas.map(([value]) => value));
const roofTypes = new Set(customerProjectOptions.roofTypes.map(([value]) => value));
const switchboards = new Set(customerProjectOptions.switchboards.map(([value]) => value));
const accessConstraints = new Set(customerProjectOptions.accessConstraints.map(([value]) => value));
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

function normaliseServiceCategories(value) {
  const selected = list(value, serviceCategories, 12);
  if (!selected.includes("insulation-draughts")) return selected;
  return [...new Set(selected.flatMap((item) => (
    item === "insulation-draughts" ? ["insulation", "draught-proofing"] : [item]
  )))].slice(0, 12);
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
  const phone = text(raw.phone, 32);
  const addressLine1 = text(raw.addressLine1, 120);
  const addressLine2 = text(raw.addressLine2, 120);
  const suburb = text(raw.suburb, 80);
  const postcode = text(raw.postcode, 4);
  const addressState = canonicalAustralianState(raw.addressState) || "";
  const propertyType = propertyTypes.has(raw.propertyType) ? raw.propertyType : "house";
  const householdSituation = situations.has(raw.householdSituation)
    ? raw.householdSituation
    : "";
  if (!displayName) return { ok: false, error: "Enter the name you want shown in your private account." };
  if (!/^\d{4}$/.test(postcode)) return { ok: false, error: "Enter a four digit Australian postcode." };
  if (!states.has(addressState)) return { ok: false, error: "Choose your state or territory." };
  if (!householdSituation) return { ok: false, error: "Choose whether you own or rent the home." };
  const hasContactDetail = Boolean(phone || addressLine1 || addressLine2 || suburb);
  if (phone && !/^\+?[0-9][0-9 ()-]{6,30}[0-9]$/.test(phone)) {
    return { ok: false, error: "Enter a contact phone number using digits, spaces or an Australian country code." };
  }
  if (hasContactDetail && !phone) return { ok: false, error: "Add a contact phone number or clear the service address fields." };
  if (hasContactDetail && !addressLine1) return { ok: false, error: "Add the service street address or clear the contact phone number." };
  if (hasContactDetail && !suburb) return { ok: false, error: "Add the service suburb or clear the contact phone number." };
  if (raw.consent !== true) return { ok: false, error: "Confirm the private account notice to continue." };
  return {
    ok: true,
    profile: {
      displayName,
      phone,
      addressLine1,
      addressLine2,
      suburb,
      postcode,
      addressState,
      propertyType,
      householdSituation,
      accountUpdates: raw.accountUpdates === true,
    },
  };
}

export function customerContactReadiness(profile = {}, project = {}) {
  if (!text(profile.phone, 32) || !text(profile.addressLine1, 120) || !text(profile.suburb, 80)) {
    return { ok: false, error: "Add your phone number and full service address in Privacy and profile before requesting trades." };
  }
  const projectPostcode = text(project.postcode, 4);
  const projectState = canonicalAustralianState(project.addressState || project.address_state) || "";
  const profilePostcode = text(profile.postcode, 4);
  const profileState = canonicalAustralianState(profile.addressState || profile.address_state) || "";
  if (projectPostcode !== profilePostcode || projectState !== profileState) {
    return { ok: false, error: "Update Privacy and profile so the service address matches this project's postcode and state before requesting trades." };
  }
  return { ok: true };
}

const legacyPlannerGoals = new Set([
  "lower-bills",
  "improve-comfort",
  "replace-now",
  "move-from-gas",
  "add-solar-storage",
  "prepare-renovation",
]);
const legacyPlannerFeatures = new Set([
  "draughty",
  "gas-heating",
  "gas-hot-water",
  "gas-cooking",
  "solar",
  "battery",
  "ev",
]);
const advisorRecommendations = {
  authority: {
    id: "authority",
    stage: "Before quotes",
    title: "Confirm who can approve changes to the property",
    text: "Renters and strata residents may need written permission before equipment, wiring, external units, solar or EV charging can change.",
    href: "/guides/project-preparation#permissions",
    action: "See which permissions to confirm",
  },
  renter: {
    id: "renter-friendly-actions",
    stage: "Low-cost and reversible",
    title: "Start with changes that can move with you",
    text: "Consider layers, electric throws, portable induction cooking, removable window film, internal shading and removable draught seals. Check ventilation and obtain permission before covering any fixed vent.",
    href: "/guides/insulation-draught-proofing",
    action: "Review renter-friendly comfort guidance",
  },
  moisture: {
    id: "moisture-ventilation",
    stage: "Check before sealing",
    title: "Identify moisture and ventilation needs first",
    text: "Condensation, damp or mould can have several causes. Record when and where it occurs, keep required ventilation open and seek building or health advice before making the home more airtight.",
    href: "/guides/insulation-draught-proofing",
    action: "Review moisture and ventilation guidance",
  },
  draughts: {
    id: "draught-proofing",
    stage: "Reduce unwanted air leakage",
    title: "Map draughts without blocking required ventilation",
    text: "Check external doors, operable windows, exhaust fans, unused chimneys, wall vents and evaporative cooling outlets. Separate removable measures from work needing owner, strata or trade approval.",
    href: "/guides/insulation-draught-proofing",
    action: "Review draught-proofing guidance",
  },
  insulation: {
    id: "insulation-review",
    stage: "Improve the building shell",
    title: "Verify insulation before adding or replacing it",
    text: "Record the roof, ceiling, wall and floor construction, existing coverage and safe access. An assessor or qualified installer can identify gaps, electrical clearances, moisture risks and suitable R-values.",
    href: "/guides/insulation-draught-proofing",
    action: "Review insulation guidance",
  },
  windows: {
    id: "windows-glazing",
    stage: "Manage window heat flow",
    title: "Match glazing and coverings to each window",
    text: "Record glazing type, frame, orientation, size, shade and air leakage. Compare draught repair, well-fitted coverings, external shade, secondary glazing and replacement glazing before committing to major work.",
    href: "/guides/insulation-draught-proofing",
    action: "Review window improvement guidance",
  },
  shading: {
    id: "window-shading",
    stage: "Control unwanted sun",
    title: "Use orientation-specific shade and window coverings",
    text: "Record when direct sun reaches each room. External shading can stop summer heat before it reaches the glass, while close-fitting internal coverings can reduce heat loss when outdoor shade is not possible.",
    href: "/guides/insulation-draught-proofing",
    action: "Review shading guidance",
  },
  reverseCycle: {
    id: "existing-reverse-cycle",
    stage: "Use what is already installed",
    title: "Check the reverse-cycle system before replacing or adding equipment",
    text: "Record which rooms it serves, comfort gaps, controls, filters, outdoor-unit condition and recent servicing. Improve operation and the building shell first, then size any extra capacity only for the remaining need.",
    href: "/guides/heating",
    action: "Review heating and cooling guidance",
  },
  heatPumpHotWater: {
    id: "existing-heat-pump-hot-water",
    stage: "Use what is already installed",
    title: "Review the existing heat-pump hot-water setup",
    text: "Record tank size, household demand, timer or tariff settings, noise, condensate, backup operation and maintenance history before considering replacement or other changes.",
    href: "/guides/hot-water",
    action: "Review hot-water guidance",
  },
  lowBudget: {
    id: "budget-under-2k",
    stage: "Keep the first stage bounded",
    title: "Prioritise evidence and low-cost improvements",
    text: "Use this budget as a scope boundary, not a price promise. Start with safety, controls, draught mapping, removable comfort measures and the evidence needed to compare larger future work.",
    href: "/guides/project-preparation#budget-under-2k",
    action: "See what this budget stage needs",
  },
  mediumBudget: {
    id: "budget-2-10k",
    stage: "Stage the work",
    title: "Spend on the highest-value constraint first",
    text: "Use assessment evidence to choose a small number of compatible measures. Obtain itemised current quotes and retain contingency for enabling work rather than relying on generic market prices.",
    href: "/guides/project-preparation#budget-2-10k",
    action: "See what this budget stage needs",
  },
  largerBudget: {
    id: "budget-10k-plus",
    stage: "Coordinate before quoting",
    title: "Build a whole-home sequence before committing",
    text: "Coordinate the building shell, electrical capacity, equipment sizing and future work so one upgrade does not make another harder. Treat the budget as a ceiling until current site-specific quotes are reviewed.",
    href: "/guides/project-preparation#budget-10k-plus",
    action: "See what this budget stage needs",
  },
};

function normaliseGoals(raw) {
  if (Array.isArray(raw.goals)) return list(raw.goals, goals, 10);
  return goals.has(raw.goal) ? [raw.goal] : [];
}

function createAdvisorPlan({
  selectedGoals,
  pace,
  situation,
  approvalContext,
  features,
  budgetRange,
}) {
  const plannerFeatures = features.filter((item) => legacyPlannerFeatures.has(item));
  const plannerSituation = approvalContext === "strata" ? "strata" : situation;
  const generated = [];
  const add = (item) => {
    if (item && !generated.some((existing) => existing.id === item.id)) generated.push(item);
  };
  for (const selectedGoal of selectedGoals) {
    const plannerGoal = legacyPlannerGoals.has(selectedGoal)
      ? selectedGoal
      : selectedGoal === "reduce-emissions"
        ? "move-from-gas"
        : selectedGoal === "improve-resilience"
          ? "add-solar-storage"
          : "improve-comfort";
    const partial = createHomeEnergyPlan({
      goal: plannerGoal,
      pace,
      situation: plannerSituation,
      features: plannerFeatures,
    });
    for (const item of partial.items) add(item);
  }
  const pull = (id) => {
    const index = generated.findIndex((item) => item.id === id);
    return index >= 0 ? generated.splice(index, 1)[0] : null;
  };
  const urgent = pull("urgent");
  const authority = pull("authority")
    || (
      situation === "renter" || approvalContext === "strata"
        ? advisorRecommendations.authority
        : null
    );
  pull("fabric");
  const support = pull("support");
  pull("brief");
  const contextual = [];
  const addContext = (item) => {
    if (item && !contextual.some((existing) => existing.id === item.id)) contextual.push(item);
  };
  if (situation === "renter" || selectedGoals.includes("renter-friendly")) addContext(advisorRecommendations.renter);
  if (features.includes("condensation-moisture") || selectedGoals.includes("healthier-home")) addContext(advisorRecommendations.moisture);
  if (
    selectedGoals.includes("improve-comfort")
    || features.some((item) => ["draughty", "open-wall-vents", "evaporative-ducts"].includes(item))
  ) addContext(advisorRecommendations.draughts);
  if (
    pace === "whole-home"
    || selectedGoals.includes("improve-comfort")
    || features.some((item) => ["roof-insulation", "wall-insulation", "floor-insulation", "insulation-unknown"].includes(item))
  ) {
    addContext(advisorRecommendations.insulation);
  }
  if (features.some((item) => ["single-glazing", "double-glazing", "glazing-unknown"].includes(item))) addContext(advisorRecommendations.windows);
  if (features.some((item) => ["external-shading", "internal-window-coverings"].includes(item))) addContext(advisorRecommendations.shading);
  if (features.includes("reverse-cycle")) {
    pull("heating");
    addContext(advisorRecommendations.reverseCycle);
  }
  if (features.includes("heat-pump-hot-water")) {
    pull("hot-water");
    addContext(advisorRecommendations.heatPumpHotWater);
  }
  if (budgetRange === "under_2k") addContext(advisorRecommendations.lowBudget);
  if (budgetRange === "2_10k") addContext(advisorRecommendations.mediumBudget);
  if (budgetRange === "10k_plus") addContext(advisorRecommendations.largerBudget);
  const items = [urgent, authority, ...contextual, ...generated, support].filter(Boolean);
  const title = selectedGoals.length > 1
    ? "Your priorities, ordered into one home energy plan"
    : selectedGoals[0] === "replace-now"
      ? "Move quickly without locking in the wrong replacement"
      : selectedGoals[0] === "renter-friendly"
        ? "Improve comfort with renter-friendly choices first"
        : "Build an evidence-led home energy plan";
  const paceLabel = pace === "one-step"
    ? "one practical next step"
    : pace === "whole-home"
      ? "a coordinated whole-home scope"
      : "a staged roadmap";
  return {
    version: CUSTOMER_PLAN_VERSION,
    goal: selectedGoals[0] || "",
    goals: selectedGoals,
    pace,
    situation,
    approvalContext,
    features,
    title,
    summary: `This is ${paceLabel}. It is independent guidance, not a product endorsement, quote or savings promise.`,
    items,
  };
}

function normalisePlanSnapshot(rawSnapshot, generatedPlan) {
  const invalid = () => ({
    ok: false,
    error: "The saved plan no longer matches this project. Reset the advisor suggestions and try again.",
  });
  if (rawSnapshot === undefined || rawSnapshot === null) {
    return { ok: true, plan: generatedPlan };
  }
  if (
    typeof rawSnapshot !== "object"
    || Array.isArray(rawSnapshot)
  ) {
    return invalid();
  }
  const version = text(rawSnapshot.version, 80);
  if (!version && Object.keys(rawSnapshot).length === 0) {
    return { ok: true, plan: generatedPlan };
  }
  if (LEGACY_CUSTOMER_PLAN_VERSIONS.has(version)) {
    return { ok: true, plan: generatedPlan };
  }
  if (version !== CUSTOMER_PLAN_VERSION || !Array.isArray(rawSnapshot.items)) {
    return invalid();
  }
  if (rawSnapshot.items.length > 40) return invalid();
  const canonical = new Map(generatedPlan.items.map((item) => [item.id, item]));
  const seen = new Set();
  const items = [];
  for (const supplied of rawSnapshot.items) {
    if (!supplied || typeof supplied !== "object") return invalid();
    const id = text(supplied.id, 80);
    if (!/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(id) || seen.has(id)) return invalid();
    const known = canonical.get(id);
    if (known) {
      items.push(known);
    } else {
      if (!/^custom[:-][a-z0-9][a-z0-9_-]{0,62}$/.test(id)) return invalid();
      const title = text(supplied.title, 160);
      const note = text(supplied.text, 600);
      if (!title || !note) return invalid();
      items.push({
        id,
        stage: text(supplied.stage, 80) || "Your note",
        title,
        text: note,
        href: "",
        action: "",
      });
    }
    seen.add(id);
  }
  return { ok: true, plan: { ...generatedPlan, items } };
}

function prepareCustomerProjectPlan(input = {}) {
  const selectedGoals = normaliseGoals(input);
  const pace = paces.has(input.pace) ? input.pace : "staged";
  const situationInput = input.situation || input.householdSituation;
  const situation = situations.has(situationInput)
    ? situationInput
    : "";
  const suppliedApprovalContext =
    input.approvalContext || input.propertyContext?.approvalContext;
  const approvalContext = approvalContexts.has(suppliedApprovalContext)
    ? suppliedApprovalContext
    : situationInput === "strata"
      ? "strata"
      : "none";
  const features = list(input.features || input.existingFeatures, homeFeatures, 24);
  const budgetRange = budgets.has(input.budgetRange) ? input.budgetRange : "not_set";
  const generatedPlan = createAdvisorPlan({
    selectedGoals,
    pace,
    situation,
    approvalContext,
    features,
    budgetRange,
  });
  const snapshot = normalisePlanSnapshot(input.planSnapshot, generatedPlan);
  return { ...snapshot, generatedPlan };
}

export function createCustomerProjectPlan(input = {}) {
  const prepared = prepareCustomerProjectPlan(input);
  return prepared.ok ? prepared.plan : prepared.generatedPlan;
}

export function preserveEditedPlanItems(editedItems = [], currentItems = []) {
  const current = new Map(
    (Array.isArray(currentItems) ? currentItems : [])
      .map((item) => [item?.id, item]),
  );
  const seen = new Set();
  return (Array.isArray(editedItems) ? editedItems : [])
    .slice(0, 40)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const currentItem = current.get(item.id);
      if (currentItem && !seen.has(currentItem.id)) {
        seen.add(currentItem.id);
        return [currentItem];
      }
      const suppliedId = text(item.id, 80);
      const title = text(item.title, 160);
      const note = text(item.text, 600);
      if (!title || !note) return [];
      const customId = /^custom[:-][a-z0-9][a-z0-9_-]{0,62}$/.test(suppliedId)
        ? suppliedId
        : `custom-retained-${index}-${suppliedId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 70);
      if (seen.has(customId)) return [];
      seen.add(customId);
      return [{
        id: customId,
        stage: suppliedId.startsWith("custom")
          ? text(item.stage, 80) || "Your note"
          : "Kept from earlier advice",
        title,
        text: note,
        href: "",
        action: "",
      }];
    });
}

export function normalizeCustomerProject(raw = {}) {
  const selectedGoals = normaliseGoals(raw);
  const pace = typeof raw.pace === "string" ? raw.pace : "staged";
  const householdSituation = situations.has(raw.householdSituation)
    ? raw.householdSituation
    : "";
  const existingFeatures = list(raw.existingFeatures, homeFeatures, 24);
  const suppliedContext = raw.propertyContext && typeof raw.propertyContext === "object" ? raw.propertyContext : {};
  const propertyContext = buildInstallerPropertyContext({
    ...suppliedContext,
    approvalContext:
      suppliedContext.approvalContext
      || (raw.householdSituation === "strata" ? "strata" : "none"),
  });
  const safePace = paces.has(pace) ? pace : "staged";
  const budgetRange = budgets.has(raw.budgetRange) ? raw.budgetRange : "not_set";
  const preparedPlan = prepareCustomerProjectPlan({
    goals: selectedGoals,
    pace: safePace,
    situation: householdSituation,
    approvalContext: propertyContext.approvalContext,
    features: existingFeatures,
    budgetRange,
    planSnapshot: raw.planSnapshot,
  });
  if (!preparedPlan.ok) return { ok: false, error: preparedPlan.error };
  const planSnapshot = preparedPlan.plan;
  const normalized = {
    title: text(raw.title, 120),
    homeNickname: text(raw.homeNickname, 80) || "My home",
    postcode: text(raw.postcode, 4),
    addressState: canonicalAustralianState(raw.addressState) || "",
    propertyType: propertyTypes.has(raw.propertyType) ? raw.propertyType : "house",
    householdSituation,
    goal: selectedGoals[0] || "",
    goals: selectedGoals,
    pace: safePace,
    existingFeatures,
    serviceCategories: normaliseServiceCategories(raw.serviceCategories),
    priorities: list(raw.priorities, priorities, 6),
    projectStage: stages.has(raw.projectStage) ? raw.projectStage : "exploring",
    timing: timings.has(raw.timing) ? raw.timing : "planning",
    budgetRange,
    propertyContext,
    privateNotes: typeof raw.privateNotes === "string" ? raw.privateNotes.trim().slice(0, 2000) : "",
    planSnapshot,
  };
  if (!normalized.title) return { ok: false, error: "Give this project a private name." };
  if (!/^\d{4}$/.test(normalized.postcode)) return { ok: false, error: "Enter a four digit project postcode." };
  if (!states.has(normalized.addressState)) return { ok: false, error: "Choose the project state or territory." };
  if (!normalized.householdSituation) return { ok: false, error: "Choose whether you own or rent the home." };
  return { ok: true, project: normalized };
}

export function submissionReadiness(project) {
  if (!project.goals?.length) return { ok: false, error: "Choose at least one goal before requesting installer responses." };
  if (!project.serviceCategories?.length) return { ok: false, error: "Choose at least one type of work before requesting installer responses." };
  if (!project.priorities?.length) return { ok: false, error: "Choose at least one project priority." };
  const context = project.propertyContext || {};
  if (![context.storeys, context.ageBand, context.floorArea, context.roofType, context.switchboard].every(Boolean)) {
    return { ok: false, error: "Complete the property details before requesting installer responses. Choose Not sure where needed." };
  }
  return { ok: true };
}

export function buildAnonymizedOpportunity(project, projectId) {
  const categories = project.serviceCategories;
  const categoryLabels = categories.map((item) => label(customerProjectOptions.serviceCategories, item));
  const categorySummary = categoryLabels.length
    ? categoryLabels.join(", ").toLowerCase()
    : "home energy planning support";
  const installerCategories = [...new Set(categories)];
  const priorityLabels = project.priorities.map((item) => label(customerProjectOptions.priorities, item));
  const selectedGoals = Array.isArray(project.goals)
    ? project.goals.filter(Boolean)
    : project.goal
      ? [project.goal]
      : [];
  const goalLabels = selectedGoals.map((item) => label(customerProjectOptions.goals, item));
  const goalSummary = goalLabels.length ? goalLabels.join(", ").toLowerCase() : "not selected";
  const prioritySummary = priorityLabels.length ? priorityLabels.join(", ").toLowerCase() : "not selected";
  const propertyLabel = label(customerProjectOptions.propertyTypes, project.propertyType, "Home");
  const stageLabel = label(customerProjectOptions.stages, project.projectStage, "Planning");
  const paceLabel = project.pace === "whole-home" ? "coordinated whole-home" : project.pace === "one-step" ? "single next-step" : "staged";
  const context = project.propertyContext || {};
  const propertyFacts = [
    label(customerProjectOptions.storeys, context.storeys, "Storeys not confirmed"),
    label(customerProjectOptions.ageBands, context.ageBand, "Age not confirmed"),
    label(customerProjectOptions.floorAreas, context.floorArea, "Floor area not confirmed"),
    label(customerProjectOptions.roofTypes, context.roofType, "Roof not confirmed"),
    label(customerProjectOptions.switchboards, context.switchboard, "Switchboard not confirmed"),
  ];
  const constraints = Array.isArray(context.accessConstraints)
    ? context.accessConstraints.map((item) => label(customerProjectOptions.accessConstraints, item)).join(", ")
    : "";
  const approvalConstraint = context.approvalContext === "strata"
    ? "strata, owners corporation or common property approval may apply"
    : context.approvalContext === "not_sure"
      ? "approval requirements are not confirmed"
      : "";
  const siteConsiderations = [approvalConstraint, constraints].filter(Boolean).join(", ");
  const title = categoryLabels.length === 1 ? `${categoryLabels[0]} project` : "Multi-upgrade home project";
  return {
    title,
    projectType: `${propertyLabel} | ${stageLabel}`,
    postcode: project.postcode,
    state: project.addressState,
    serviceCategories: installerCategories,
    priority: project.timing === "urgent" ? "urgent" : "standard",
    timing: project.timing,
    summary: `${propertyLabel} household seeking ${categorySummary}. Property context: ${propertyFacts.join(", ").toLowerCase()}${siteConsiderations ? `. Site considerations: ${siteConsiderations.toLowerCase()}` : ""}. Goals: ${goalSummary}. Priorities: ${prioritySummary}. The household is following a ${paceLabel} plan. Identity, exact location, contact details, private notes and usage records are withheld. Any customer-approved photos and documents are provided separately to allocated verified installers for quoting guidance. Respond only through the structured platform workflow.`,
    sourceReference: `customer-project:${projectId}`,
  };
}

export function buildInstallerPropertyContext(value = {}) {
  const supplied = value && typeof value === "object" ? value : {};
  return {
    storeys: storeys.has(supplied.storeys) ? supplied.storeys : "",
    ageBand: ageBands.has(supplied.ageBand) ? supplied.ageBand : "",
    floorArea: floorAreas.has(supplied.floorArea) ? supplied.floorArea : "",
    roofType: roofTypes.has(supplied.roofType) ? supplied.roofType : "",
    switchboard: switchboards.has(supplied.switchboard) ? supplied.switchboard : "",
    approvalContext: approvalContexts.has(supplied.approvalContext)
      ? supplied.approvalContext
      : "none",
    accessConstraints: list(supplied.accessConstraints, accessConstraints, 5),
  };
}

export function reconcileCompletedPlanItems(value, planSnapshot) {
  const allowed = new Set(
    Array.isArray(planSnapshot?.items)
      ? planSnapshot.items.map((item) => String(item?.id || "")).filter(Boolean)
      : [],
  );
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && allowed.has(item)))].slice(0, 40)
    : [];
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
