import { createHomeEnergyPlan } from "./home-energy-plan.mjs";
import {
  AUSTRALIAN_STATE_CODES,
  canonicalAustralianState,
  postcodeMatchesState,
  residentialStateFromPostcode,
} from "./australian-postcodes.mjs";
import {
  addPlanDecisionSupport,
  createNextBestQuestions,
  normalizeCustomerReviewItems,
  privateCustomPlanGuidance,
} from "./customer-plan-decision-support.mjs";

export const CUSTOMER_NOTICE_VERSION = "2026-07-18-quoting-photos";
export const CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION = "2026-07-29";
export const CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION = "2026-07-18";
export const CUSTOMER_CONTACT_RELEASE_FIELDS = ["name", "email", "phone", "service_address"];
export const CUSTOMER_PLAN_VERSION = "2026-07-29-home-feature-taxonomy-v2";
export const CUSTOMER_LEGACY_PLAN_VERSIONS = [
  "2026-07-15",
  "2026-07-29-home-advisor",
  "2026-07-29-evidence-climate-advisor",
  "2026-07-29-decision-support-advisor",
];
export const CUSTOMER_ADVISOR_PROFILE_VERSION = "2026-07-29-advisor-profile-v3";
const LEGACY_CUSTOMER_PLAN_VERSIONS = new Set(CUSTOMER_LEGACY_PLAN_VERSIONS);
export const MAX_CUSTOMER_PROJECTS = 40;
export const MAX_OPEN_CUSTOMER_OPPORTUNITIES = 5;
export const MAX_HOME_FEATURE_SELECTIONS = 32;

export const customerHomeFeatureSections = [
  {
    id: "comfort",
    title: "How the home feels",
    description: "Choose each issue you notice. These are household observations, not a diagnosis.",
    questions: [
      {
        id: "comfort-concerns",
        label: "Which comfort or moisture issues do you notice?",
        help: "Choose all that apply.",
        mode: "multiple",
        noneValue: "comfort-none",
        unknownValue: "comfort-unknown",
        options: [
          ["comfort-too-hot", "Too hot in warm weather"],
          ["comfort-too-cold", "Too cold in cool weather"],
          ["draughty", "Noticeable unwanted draughts"],
          ["condensation-moisture", "Condensation, damp or mould"],
          ["comfort-none", "None of these"],
          ["comfort-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "insulation",
    title: "Insulation",
    description: "Choose what you safely know. Do not enter a roof space or disturb insulation to answer.",
    questions: [
      {
        id: "ceiling-insulation",
        label: "Roof or ceiling insulation above this home",
        help: "Condition and coverage matter as much as whether insulation is present.",
        mode: "single",
        unknownValue: "ceiling-insulation-unknown",
        options: [
          ["ceiling-insulation-none", "No insulation that I know of"],
          ["ceiling-insulation-limited", "A little, old, patchy or probably inadequate"],
          ["ceiling-insulation-well", "Well insulated or recently upgraded"],
          ["ceiling-insulation-not-applicable", "Another dwelling is directly above"],
          ["ceiling-insulation-unknown", "Not sure"],
        ],
      },
      {
        id: "wall-insulation",
        label: "Wall insulation",
        help: "Plans, invoices or an earlier assessment may be more reliable than guessing from the wall surface.",
        mode: "single",
        unknownValue: "wall-insulation-unknown",
        options: [
          ["wall-insulation-none", "No wall insulation that I know of"],
          ["wall-insulation-limited", "Some, old, patchy or probably inadequate"],
          ["wall-insulation-well", "Well insulated or recently upgraded"],
          ["wall-insulation-unknown", "Not sure"],
        ],
      },
      {
        id: "floor-insulation",
        label: "Underfloor insulation",
        help: "Choose Not applicable for a slab floor or when another dwelling is directly below.",
        mode: "single",
        unknownValue: "floor-insulation-unknown",
        options: [
          ["floor-insulation-none", "No underfloor insulation that I know of"],
          ["floor-insulation-limited", "Some, old, patchy or probably inadequate"],
          ["floor-insulation-well", "Well insulated or recently upgraded"],
          ["floor-insulation-not-applicable", "Slab floor or another dwelling is directly below"],
          ["floor-insulation-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "windows",
    title: "Windows and shading",
    description: "Glazing, internal coverings and external shade can all affect comfort in different ways.",
    questions: [
      {
        id: "glazing",
        label: "Window glazing",
        help: "A home can contain a mix. A visible spacer at the glass edge often indicates double glazing.",
        mode: "single",
        unknownValue: "glazing-unknown",
        options: [
          ["single-glazing", "Mostly single glazed"],
          ["mixed-glazing", "A mix of single and double or secondary glazing"],
          ["double-glazing", "Mostly double or secondary glazed"],
          ["glazing-unknown", "Not sure"],
        ],
      },
      {
        id: "window-coverings",
        label: "Internal window coverings",
        help: "Basic rollers and Venetians usually provide less thermal benefit than close-fitting coverings. Fit and edge gaps still matter.",
        mode: "single",
        unknownValue: "window-coverings-unknown",
        options: [
          ["window-coverings-none", "No internal blinds or curtains"],
          ["window-coverings-basic", "Basic roller, vertical or Venetian blinds"],
          ["window-coverings-thermal", "Close-fitting honeycomb or thermal blinds, or heavy curtains with pelmets"],
          ["window-coverings-mixed", "A mix of basic and better-performing coverings"],
          ["window-coverings-unknown", "Not sure"],
        ],
      },
      {
        id: "external-shading",
        label: "External shade on sun-exposed windows",
        help: "Include awnings, shutters, external blinds and useful shade from the building or vegetation.",
        mode: "single",
        unknownValue: "external-shading-unknown",
        options: [
          ["external-shading-none", "No effective external shade"],
          ["external-shading", "Some sun-exposed windows have useful external shade"],
          ["external-shading-most", "Most sun-exposed windows have effective external shade"],
          ["external-shading-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "ventilation",
    title: "Draughts and ventilation",
    description: "Record fixed openings so the plan does not mistake required ventilation for an unwanted draught.",
    questions: [
      {
        id: "ventilation-features",
        label: "Which fixed openings or ventilation systems are present?",
        help: "Choose all that apply. Never block a fixed vent without confirming why it is there.",
        mode: "multiple",
        noneValue: "ventilation-none-known",
        unknownValue: "ventilation-unknown",
        options: [
          ["open-wall-vents", "Open wall vents or an unused chimney"],
          ["evaporative-ducts", "Evaporative-cooling ceiling outlets"],
          ["exhaust-ducted-outside", "Kitchen or bathroom exhaust ducted outside"],
          ["mechanical-ventilation", "Purpose-designed mechanical ventilation"],
          ["ventilation-none-known", "None of these that I know of"],
          ["ventilation-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "heating-cooling",
    title: "Heating and cooling",
    description: "Choose every system used in the home. More than one system can be present.",
    questions: [
      {
        id: "heating-cooling-systems",
        label: "What heating and cooling is installed or regularly used?",
        help: "Choose all that apply.",
        mode: "multiple",
        noneValue: "heating-cooling-none",
        unknownValue: "heating-cooling-unknown",
        options: [
          ["reverse-cycle", "Reverse-cycle air conditioner or heat pump"],
          ["gas-heating", "Gas space or ducted heating"],
          ["electric-resistance-heating", "Electric panel, portable or resistance heating"],
          ["evaporative-cooling", "Evaporative cooling"],
          ["fans-only", "Ceiling or portable fans"],
          ["heating-cooling-none", "No fixed heating or cooling"],
          ["heating-cooling-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "hot-water-cooking",
    title: "Hot water and cooking",
    description: "Choose the main hot-water and cooking systems.",
    questions: [
      {
        id: "hot-water",
        label: "Main hot-water system",
        help: "Choose the system that supplies most household hot water.",
        mode: "single",
        unknownValue: "hot-water-unknown",
        options: [
          ["gas-hot-water", "Gas hot water"],
          ["heat-pump-hot-water", "Heat-pump hot water"],
          ["electric-storage-hot-water", "Electric storage hot water"],
          ["electric-instant-hot-water", "Instantaneous electric hot water"],
          ["solar-hot-water", "Solar hot water, including boosted systems"],
          ["hot-water-other", "Another type"],
          ["hot-water-unknown", "Not sure"],
        ],
      },
      {
        id: "cooking",
        label: "Main cooking setup",
        help: "Choose Mixed when the cooktop and oven use different fuels.",
        mode: "single",
        unknownValue: "cooking-unknown",
        options: [
          ["gas-cooking", "Gas cooktop or oven"],
          ["electric-resistance-cooking", "Standard electric cooktop or oven"],
          ["induction-cooking", "Induction cooking"],
          ["mixed-cooking", "Mixed gas and electric cooking"],
          ["cooking-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "solar-storage-transport",
    title: "Solar, battery and electric vehicle",
    description: "Record what is already installed or planned so the roadmap does not recommend the wrong next step.",
    questions: [
      {
        id: "solar",
        label: "Rooftop solar",
        help: "",
        mode: "single",
        unknownValue: "solar-unknown",
        options: [
          ["solar", "Rooftop solar is installed"],
          ["solar-none", "No rooftop solar"],
          ["solar-unknown", "Not sure"],
        ],
      },
      {
        id: "battery",
        label: "Home battery",
        help: "",
        mode: "single",
        unknownValue: "battery-unknown",
        options: [
          ["battery", "A home battery is installed"],
          ["battery-none", "No home battery"],
          ["battery-unknown", "Not sure"],
        ],
      },
      {
        id: "ev",
        label: "Electric vehicle",
        help: "",
        mode: "single",
        unknownValue: "ev-unknown",
        options: [
          ["ev", "An electric vehicle is owned or planned"],
          ["ev-none", "No electric vehicle is owned or planned"],
          ["ev-unknown", "Not sure"],
        ],
      },
    ],
  },
];

const canonicalHomeFeatureOptions = customerHomeFeatureSections.flatMap((section) =>
  section.questions.flatMap((question) => question.options));
const canonicalHomeFeatureValues = new Set(
  canonicalHomeFeatureOptions.map(([value]) => value),
);
const legacyHomeFeatureValues = new Set([
  "roof-insulation",
  "wall-insulation",
  "floor-insulation",
  "insulation-unknown",
  "internal-window-coverings",
]);

function questionHasSelection(question, selected) {
  return question.options.some(([value]) => selected.has(value));
}

function migrateLegacyHomeFeatures(value) {
  const supplied = Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, 64)
    : [];
  const selected = new Set(
    supplied.filter((item) =>
      canonicalHomeFeatureValues.has(item) || legacyHomeFeatureValues.has(item)),
  );
  const findQuestion = (questionId) => customerHomeFeatureSections
    .flatMap((section) => section.questions)
    .find((question) => question.id === questionId);
  const addWhenUnanswered = (questionId, feature) => {
    const question = findQuestion(questionId);
    if (question && !questionHasSelection(question, selected)) selected.add(feature);
  };
  if (selected.has("roof-insulation")) {
    addWhenUnanswered("ceiling-insulation", "ceiling-insulation-unknown");
  }
  if (selected.has("wall-insulation")) {
    addWhenUnanswered("wall-insulation", "wall-insulation-unknown");
  }
  if (selected.has("floor-insulation")) {
    addWhenUnanswered("floor-insulation", "floor-insulation-unknown");
  }
  if (selected.has("insulation-unknown")) {
    addWhenUnanswered("ceiling-insulation", "ceiling-insulation-unknown");
    addWhenUnanswered("wall-insulation", "wall-insulation-unknown");
    addWhenUnanswered("floor-insulation", "floor-insulation-unknown");
  }
  if (selected.has("internal-window-coverings")) {
    addWhenUnanswered("window-coverings", "window-coverings-unknown");
  }
  for (const legacy of legacyHomeFeatureValues) selected.delete(legacy);
  return selected;
}

export function normalizeHomeFeatureSelections(value) {
  const supplied = migrateLegacyHomeFeatures(value);
  const normalized = [];
  for (const section of customerHomeFeatureSections) {
    for (const question of section.questions) {
      let selected = question.options
        .map(([optionValue]) => optionValue)
        .filter((optionValue) => supplied.has(optionValue));
      if (question.id === "glazing" && selected.length > 1) {
        const known = selected.filter((item) => item !== "glazing-unknown");
        selected = known.includes("single-glazing") && known.includes("double-glazing")
          && !selected.includes("glazing-unknown")
          ? ["mixed-glazing"]
          : [question.unknownValue];
      } else if (question.mode === "single" && selected.length > 1) {
        selected = question.unknownValue ? [question.unknownValue] : [];
      } else if (question.mode === "multiple") {
        if (question.unknownValue && selected.includes(question.unknownValue)) {
          selected = [question.unknownValue];
        } else if (question.noneValue && selected.includes(question.noneValue)) {
          selected = [question.noneValue];
        }
      }
      normalized.push(...selected);
    }
  }
  return normalized.slice(0, MAX_HOME_FEATURE_SELECTIONS);
}

export function updateHomeFeatureSelection(
  current,
  questionId,
  value,
  checked = true,
) {
  const question = customerHomeFeatureSections
    .flatMap((section) => section.questions)
    .find((item) => item.id === questionId);
  if (!question || !question.options.some(([optionValue]) => optionValue === value)) {
    return normalizeHomeFeatureSelections(current);
  }
  const questionValues = new Set(question.options.map(([optionValue]) => optionValue));
  const selected = new Set(normalizeHomeFeatureSelections(current));
  if (question.mode === "single") {
    for (const optionValue of questionValues) selected.delete(optionValue);
    if (checked) selected.add(value);
  } else if (!checked) {
    selected.delete(value);
  } else if (value === question.noneValue || value === question.unknownValue) {
    for (const optionValue of questionValues) selected.delete(optionValue);
    selected.add(value);
  } else {
    if (question.noneValue) selected.delete(question.noneValue);
    if (question.unknownValue) selected.delete(question.unknownValue);
    selected.add(value);
  }
  return normalizeHomeFeatureSelections([...selected]);
}

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
  homeFeatures: canonicalHomeFeatureOptions,
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

export const customerAdvisorOptions = {
  factKeys: [
    ["glazing", "Window glazing"],
    ["window-coverings", "Internal window coverings"],
    ["external-shading", "External window shading"],
    ["ceiling-insulation", "Ceiling or roof insulation"],
    ["wall-insulation", "Wall insulation"],
    ["floor-insulation", "Underfloor insulation"],
    ["draughts", "Draught locations"],
    ["ventilation", "Fixed openings and ventilation"],
    ["heating-cooling", "Heating and cooling equipment"],
    ["hot-water", "Hot water system"],
    ["cooking", "Cooking equipment"],
    ["roof", "Roof type and condition"],
    ["switchboard", "Switchboard"],
    ["solar", "Rooftop solar"],
    ["battery", "Home battery"],
    ["ev", "Electric vehicle"],
  ],
  evidenceSources: [
    ["unknown", "Not known or not checked"],
    ["customer-reported", "Customer reported"],
    ["photo-supported", "Photo available for review"],
    ["document-supported", "Document available for review"],
  ],
  roomTypes: [
    ["living", "Living area"],
    ["bedroom", "Bedroom"],
    ["kitchen", "Kitchen"],
    ["bathroom", "Bathroom"],
    ["study", "Study or home office"],
    ["laundry", "Laundry or utility room"],
    ["other", "Other room"],
  ],
  comfortConcerns: [
    ["too-hot", "Too hot"],
    ["too-cold", "Too cold"],
    ["draughty", "Draughty"],
    ["condensation", "Condensation"],
    ["damp-or-mould", "Damp or mould concern"],
    ["stuffy", "Stuffy or poorly ventilated"],
    ["glare", "Unwanted sun or glare"],
  ],
  usePeriods: [
    ["morning", "Morning"],
    ["daytime", "Daytime"],
    ["evening", "Evening"],
    ["overnight", "Overnight"],
    ["varies", "Varies"],
  ],
  permissionClasses: [
    ["portable", "Portable or removable"],
    ["permission-needed", "Ask for written permission"],
    ["fixed-or-shared", "Fixed or shared property"],
    ["not-sure", "Not sure"],
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
const advisorFactKeys = new Set(customerAdvisorOptions.factKeys.map(([value]) => value));
const evidenceSources = new Set(customerAdvisorOptions.evidenceSources.map(([value]) => value));
const roomTypes = new Set(customerAdvisorOptions.roomTypes.map(([value]) => value));
const comfortConcerns = new Set(customerAdvisorOptions.comfortConcerns.map(([value]) => value));
const roomUsePeriods = new Set(customerAdvisorOptions.usePeriods.map(([value]) => value));
const permissionClasses = new Set(customerAdvisorOptions.permissionClasses.map(([value]) => value));
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

const homeFeatureFactRules = new Map([
  ["glazing", {
    answered: new Set(["single-glazing", "mixed-glazing", "double-glazing"]),
    unknown: new Set(["glazing-unknown"]),
  }],
  ["window-coverings", {
    answered: new Set([
      "window-coverings-none",
      "window-coverings-basic",
      "window-coverings-thermal",
      "window-coverings-mixed",
    ]),
    unknown: new Set(["window-coverings-unknown"]),
  }],
  ["external-shading", {
    answered: new Set([
      "external-shading-none",
      "external-shading",
      "external-shading-most",
    ]),
    unknown: new Set(["external-shading-unknown"]),
  }],
  ["ceiling-insulation", {
    answered: new Set([
      "ceiling-insulation-none",
      "ceiling-insulation-limited",
      "ceiling-insulation-well",
      "ceiling-insulation-not-applicable",
    ]),
    unknown: new Set(["ceiling-insulation-unknown"]),
  }],
  ["wall-insulation", {
    answered: new Set([
      "wall-insulation-none",
      "wall-insulation-limited",
      "wall-insulation-well",
    ]),
    unknown: new Set(["wall-insulation-unknown"]),
  }],
  ["floor-insulation", {
    answered: new Set([
      "floor-insulation-none",
      "floor-insulation-limited",
      "floor-insulation-well",
      "floor-insulation-not-applicable",
    ]),
    unknown: new Set(["floor-insulation-unknown"]),
  }],
  ["draughts", {
    answered: new Set(["draughty", "comfort-none"]),
    unknown: new Set(["comfort-unknown"]),
  }],
  ["ventilation", {
    answered: new Set([
      "open-wall-vents",
      "evaporative-ducts",
      "exhaust-ducted-outside",
      "mechanical-ventilation",
      "ventilation-none-known",
    ]),
    unknown: new Set(["ventilation-unknown"]),
  }],
  ["heating-cooling", {
    answered: new Set([
      "reverse-cycle",
      "gas-heating",
      "electric-resistance-heating",
      "evaporative-cooling",
      "fans-only",
      "heating-cooling-none",
    ]),
    unknown: new Set(["heating-cooling-unknown"]),
  }],
  ["hot-water", {
    answered: new Set([
      "gas-hot-water",
      "heat-pump-hot-water",
      "electric-storage-hot-water",
      "electric-instant-hot-water",
      "solar-hot-water",
      "hot-water-other",
    ]),
    unknown: new Set(["hot-water-unknown"]),
  }],
  ["cooking", {
    answered: new Set([
      "gas-cooking",
      "electric-resistance-cooking",
      "induction-cooking",
      "mixed-cooking",
    ]),
    unknown: new Set(["cooking-unknown"]),
  }],
  ["solar", {
    answered: new Set(["solar", "solar-none"]),
    unknown: new Set(["solar-unknown"]),
  }],
  ["battery", {
    answered: new Set(["battery", "battery-none"]),
    unknown: new Set(["battery-unknown"]),
  }],
  ["ev", {
    answered: new Set(["ev", "ev-none"]),
    unknown: new Set(["ev-unknown"]),
  }],
]);

function factSourceForHomeSelections(factKey, suppliedSource, selectedFeatures) {
  const rule = homeFeatureFactRules.get(factKey);
  if (!rule || !(selectedFeatures instanceof Set)) return suppliedSource;
  if ([...rule.unknown].some((value) => selectedFeatures.has(value))) return "unknown";
  if ([...rule.answered].some((value) => selectedFeatures.has(value))) {
    if (suppliedSource === "photo-supported" || suppliedSource === "document-supported") {
      return suppliedSource;
    }
    return "customer-reported";
  }
  return "unknown";
}

function factSourceForPropertyContext(factKey, suppliedSource, propertyContext) {
  if (!["roof", "switchboard"].includes(factKey)) return suppliedSource;
  if (!propertyContext || typeof propertyContext !== "object") return suppliedSource;
  const value = factKey === "roof"
    ? propertyContext.roofType
    : propertyContext.switchboard;
  if (typeof value !== "string" || !value || value === "not_sure") return "unknown";
  if (suppliedSource === "photo-supported" || suppliedSource === "document-supported") {
    return suppliedSource;
  }
  return "customer-reported";
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

const planningClimateProfiles = {
  "hot-humid": {
    label: "Hot and humid planning profile",
    summary: "Prioritise unwanted sun, air movement, moisture control and efficient cooling before adding capacity.",
    priorities: [
      "Control direct sun with suitable external shade",
      "Use safe air movement and ventilation",
      "Check moisture sources before sealing gaps",
      "Size efficient cooling only after reducing heat gain",
    ],
  },
  "hot-dry": {
    label: "Hot and dry planning profile",
    summary: "Prioritise solar heat control, insulation and controlled air leakage, then plan efficient heating and cooling for the remaining load.",
    priorities: [
      "Control direct sun and exposed glazing",
      "Check ceiling, wall and floor insulation",
      "Seal unwanted air leakage without blocking required ventilation",
      "Use cooler outdoor conditions when they are suitable",
    ],
  },
  "warm-humid": {
    label: "Warm and humid planning profile",
    summary: "Prioritise shade, air movement and moisture-safe ventilation before relying on additional mechanical cooling.",
    priorities: [
      "Map sun exposure and add suitable shade",
      "Improve safe air movement in occupied rooms",
      "Record condensation and damp before sealing gaps",
      "Review efficient cooling after passive measures",
    ],
  },
  "temperate-dry": {
    label: "Temperate and dry planning profile",
    summary: "Plan for hot days and cool periods by coordinating shade, insulation, draught control and efficient reverse-cycle equipment.",
    priorities: [
      "Map summer sun and winter heat loss",
      "Check insulation coverage and condition",
      "Seal unwanted draughts without blocking required ventilation",
      "Match efficient heating and cooling to the remaining need",
    ],
  },
  "temperate-mixed": {
    label: "Mixed temperate planning profile",
    summary: "Balance winter heat retention with summer heat control, using room observations to decide which constraint comes first.",
    priorities: [
      "Record which rooms are uncomfortable by season",
      "Check draughts and insulation before equipment sizing",
      "Match window coverings and shade to orientation",
      "Review efficient heating and cooling for remaining gaps",
    ],
  },
  "cool-temperate": {
    label: "Cool temperate planning profile",
    summary: "Prioritise safe draught control, insulation, window heat loss and efficient heating while continuing to manage moisture and summer sun.",
    priorities: [
      "Map draughts without blocking required ventilation",
      "Check insulation coverage and electrical clearances",
      "Reduce window heat loss with suitable coverings or glazing",
      "Size efficient heating after improving the building shell",
    ],
  },
};

export function derivePlanningClimateProfile(postcodeValue, stateValue) {
  const postcode = text(postcodeValue, 4);
  const state = canonicalAustralianState(stateValue) || "";
  const residentialState = residentialStateFromPostcode(postcode);
  if (!state || !residentialState || !postcodeMatchesState(postcode, state)) return null;
  const postcodeNumber = Number(postcode);
  let code = "temperate-mixed";
  if (state === "NT") {
    code = postcodeNumber >= 800 && postcodeNumber <= 859 ? "hot-humid" : "hot-dry";
  } else if (state === "QLD") {
    code = postcodeNumber >= 4800 ? "hot-humid" : "warm-humid";
  } else if (state === "WA") {
    code = postcodeNumber >= 6700 ? "hot-dry" : "temperate-dry";
  } else if (state === "SA") {
    code = "temperate-dry";
  } else if (state === "TAS" || state === "ACT") {
    code = "cool-temperate";
  } else if (state === "VIC") {
    code = postcodeNumber >= 3500 && postcodeNumber <= 3599
      ? "temperate-dry"
      : "cool-temperate";
  } else if (state === "NSW") {
    if (postcodeNumber >= 2620 && postcodeNumber <= 2639) code = "cool-temperate";
    else if (
      (postcodeNumber >= 2640 && postcodeNumber <= 2739)
      || (postcodeNumber >= 2800 && postcodeNumber <= 2899)
    ) code = "temperate-dry";
    else if (postcodeNumber >= 2300 && postcodeNumber <= 2499) code = "warm-humid";
  }
  const profile = planningClimateProfiles[code];
  return {
    basis: "postcode-state-planning",
    code,
    label: profile.label,
    summary: profile.summary,
    priorities: [...profile.priorities],
    notNatHERSAssessment: true,
    disclaimer: "This broad postcode and state result is an approximate planning profile, not a NatHERS climate zone, home energy rating or site assessment. It does not size equipment or predict savings.",
  };
}

function boundedIdentifier(value, prefix, index) {
  const supplied = text(value, 80).toLowerCase();
  if (/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(supplied)) return supplied;
  return `${prefix}-${index + 1}`;
}

export function normalizeCustomerAdvisorProfile(raw = {}, context = {}) {
  const supplied = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const selectedHomeFeatures = Array.isArray(context.homeFeatures)
    ? new Set(normalizeHomeFeatureSelections(context.homeFeatures))
    : null;
  const suppliedFacts = Array.isArray(supplied.factEvidence)
    ? supplied.factEvidence.slice(0, customerAdvisorOptions.factKeys.length)
    : [];
  const factSources = new Map();
  for (const item of suppliedFacts) {
    if (!item || typeof item !== "object" || !advisorFactKeys.has(item.factKey)) continue;
    factSources.set(item.factKey, evidenceSources.has(item.source) ? item.source : "unknown");
  }
  const factEvidence = customerAdvisorOptions.factKeys.map(([factKey]) => ({
    factKey,
    source: factSourceForPropertyContext(
      factKey,
      factSourceForHomeSelections(
        factKey,
        factSources.get(factKey) || "unknown",
        selectedHomeFeatures,
      ),
      context.propertyContext,
    ),
  }));

  const seenRoomIds = new Set();
  const rooms = (Array.isArray(supplied.rooms) ? supplied.rooms : [])
    .slice(0, 12)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const name = text(item.name, 60);
      if (!name) return [];
      let id = boundedIdentifier(item.id, "room", index);
      if (seenRoomIds.has(id)) id = `room-${index + 1}`;
      if (seenRoomIds.has(id)) return [];
      seenRoomIds.add(id);
      return [{
        id,
        name,
        roomType: roomTypes.has(item.roomType) ? item.roomType : "other",
        concerns: list(item.concerns, comfortConcerns, 7),
        usePeriods: list(item.usePeriods, roomUsePeriods, 5),
      }];
    });

  const seenPermissionIds = new Set();
  const permissionItems = (Array.isArray(supplied.permissionItems) ? supplied.permissionItems : [])
    .slice(0, 30)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const title = text(item.title, 160);
      if (!title) return [];
      let id = boundedIdentifier(item.id, "permission-item", index);
      if (seenPermissionIds.has(id)) id = `permission-item-${index + 1}`;
      if (seenPermissionIds.has(id)) return [];
      seenPermissionIds.add(id);
      return [{
        id,
        title,
        classification: permissionClasses.has(item.classification)
          ? item.classification
          : "not-sure",
        note: text(item.note, 300),
      }];
    });

  const climate = derivePlanningClimateProfile(context.postcode, context.addressState);
  const reviewItems = normalizeCustomerReviewItems(supplied.reviewItems, {
    allowedFactKeys: [...advisorFactKeys],
    allowedPlanItemIds: context.allowedPlanItemIds,
  });
  return {
    version: CUSTOMER_ADVISOR_PROFILE_VERSION,
    factEvidence,
    rooms,
    permissionItems,
    reviewItems,
    ...(climate ? { climate } : {}),
  };
}

const permissionPackSectionOptions = [
  ["portable", "Portable or reversible options"],
  ["owner-agent", "Ask the owner or agent before proceeding"],
  ["strata-shared", "Ask strata or owners corporation about shared property"],
  ["licensed-site-checks", "Licensed trade or site checks"],
  ["evidence-questions", "Evidence and questions to include"],
];

const permissionPlanRules = new Map([
  ["renter-friendly-actions", {
    section: "portable",
    title: "Start with portable comfort measures",
    note: "Check the lease and product instructions before using removable seals, coverings or portable appliances.",
  }],
  ["draught-proofing", {
    section: "licensed-site-checks",
    title: "Separate removable draught seals from fixed ventilation work",
    note: "Confirm required ventilation, combustion safety and any fixed vent, chimney or duct work before proceeding.",
  }],
  ["insulation-review", {
    section: "licensed-site-checks",
    title: "Arrange an insulation and access check",
    note: "Confirm coverage, moisture, electrical clearances and safe access before insulation work.",
  }],
  ["windows-glazing", {
    section: "licensed-site-checks",
    title: "Confirm the glazing scope and supporting structure",
    note: "Check frames, openings, shade and site conditions before fixed glazing work is priced.",
  }],
  ["window-shading", {
    section: "licensed-site-checks",
    title: "Confirm the fixing and shared-property boundary for external shade",
    note: "External blinds, awnings and shutters may affect the building exterior or common property.",
  }],
  ["heating", {
    section: "licensed-site-checks",
    title: "Arrange heating and cooling site checks",
    note: "Confirm equipment sizing, electrical capacity, condensate, noise and outdoor unit location.",
  }],
  ["existing-reverse-cycle", {
    section: "licensed-site-checks",
    title: "Review the existing heating and cooling system",
    note: "Confirm condition, controls, maintenance and any fixed changes before adding capacity.",
  }],
  ["hot-water", {
    section: "licensed-site-checks",
    title: "Arrange hot water site checks",
    note: "Confirm electrical, plumbing, drainage, noise and location constraints before replacement.",
  }],
  ["existing-heat-pump-hot-water", {
    section: "licensed-site-checks",
    title: "Review the existing heat pump hot water system",
    note: "Confirm condition, controls, drainage, noise and any fixed changes before proceeding.",
  }],
  ["cooking", {
    section: "licensed-site-checks",
    title: "Arrange cooking and electrical site checks",
    note: "Confirm cookware, circuit capacity, ventilation and the safe isolation of existing equipment.",
  }],
  ["solar", {
    section: "licensed-site-checks",
    title: "Arrange roof, electrical and connection checks for solar",
    note: "Confirm roof condition, shade, switchboard, network limits and safe access.",
  }],
  ["battery", {
    section: "licensed-site-checks",
    title: "Arrange electrical and location checks for a battery",
    note: "Confirm clearances, access, protection, ventilation and connection requirements.",
  }],
  ["ev", {
    section: "licensed-site-checks",
    title: "Arrange electrical and parking-location checks for EV charging",
    note: "Confirm supply capacity, cable route, parking rights and any shared-property impact.",
  }],
  ["assessment", {
    section: "evidence-questions",
    title: "Ask the assessor to separate observed facts from assumptions",
    note: "Record which findings were observed, customer reported, photo supported, document supported or still unknown.",
  }],
  ["room-comfort-profile", {
    section: "evidence-questions",
    title: "Include the controlled room comfort concerns",
    note: "Describe room types and concerns without including private room names or household routines.",
  }],
]);

export function createCustomerPermissionPack(profile = {}, context = {}) {
  const normalized = normalizeCustomerAdvisorProfile(profile, context);
  const householdSituation = situations.has(context.householdSituation)
    ? context.householdSituation
    : "";
  const approvalContext = approvalContexts.has(context.approvalContext)
    ? context.approvalContext
    : "none";
  const sections = new Map(permissionPackSectionOptions.map(([key, sectionLabel]) => [
    key,
    { classification: key, label: sectionLabel, items: [] },
  ]));
  const seen = new Set();
  const add = (sectionKey, item) => {
    const section = sections.get(sectionKey);
    if (!section || !item?.id || seen.has(`${sectionKey}:${item.id}`)) return;
    section.items.push(item);
    seen.add(`${sectionKey}:${item.id}`);
  };

  if (householdSituation === "renter") {
    add("portable", {
      id: "tenure-portable-first",
      title: "Start with options that are portable or reversible",
      note: "Confirm lease conditions and avoid fixed changes until written permission requirements are clear.",
    });
    add("owner-agent", {
      id: "tenure-owner-agent",
      title: "Ask the owner or agent about fixed changes",
      note: "Request written permission for the described scope before booking fixed building, electrical, plumbing or external work.",
    });
  }
  if (approvalContext === "strata") {
    add("strata-shared", {
      id: "approval-strata",
      title: "Confirm the lot and common-property boundary",
      note: "Ask strata or the owners corporation which written approvals, drawings or contractor details may be required.",
    });
  } else if (approvalContext === "not_sure") {
    add("evidence-questions", {
      id: "approval-not-sure",
      title: "Confirm whether strata or common property applies",
      note: "Check the title, lease or building manager information before treating external or shared areas as available for work.",
    });
  }

  const planItems = Array.isArray(context.planItems)
    ? context.planItems
    : Array.isArray(context.planSnapshot?.items)
      ? context.planSnapshot.items
      : [];
  const permissionOverrides = new Map(
    normalized.permissionItems.map((item) => [item.id, item]),
  );
  const usedPermissionItems = new Set();
  const permissionSectionFor = (classification) => (
    classification === "permission-needed"
      ? "owner-agent"
      : classification === "fixed-or-shared"
        ? approvalContext === "strata"
          ? "strata-shared"
          : "licensed-site-checks"
        : classification === "not-sure"
          ? "evidence-questions"
          : "portable"
  );
  let customPlanItemCount = 0;
  for (const planItem of planItems.slice(0, 40)) {
    const planItemId = text(planItem?.id, 80);
    if (planItemId.startsWith("custom")) {
      customPlanItemCount += 1;
      continue;
    }
    const rule = permissionPlanRules.get(planItemId);
    if (!rule) continue;
    const override = permissionOverrides.get(planItemId)
      || permissionOverrides.get(`plan-${planItemId}`);
    if (override && override.classification !== "not-sure") {
      add(permissionSectionFor(override.classification), {
        id: `customer-${override.id}`,
        title: rule.title,
        note: override.note
          ? "Customer selected this classification and recorded a private project note. Review that note in the signed-in project before sharing this checklist; its wording is not copied here."
          : "Customer selected this classification for review.",
      });
      usedPermissionItems.add(override.id);
    }
    if (
      override?.classification === "not-sure"
      && rule.section !== "evidence-questions"
    ) {
      add("evidence-questions", {
        id: `confirm-${planItemId}`,
        title: `Confirm how to classify ${rule.title.toLowerCase()}`,
        note: override.note
          ? "A private project note is recorded for this item. Review it in the signed-in project before sharing this checklist; its wording is not copied here."
          : "Review the proposed scope with the relevant owner, strata contact or licensed trade before proceeding.",
      });
    }
    if (override) usedPermissionItems.add(override.id);
    add(rule.section, {
      id: `plan-${planItemId}`,
      title: rule.title,
      note: rule.note,
    });
    if (
      householdSituation === "renter"
      && rule.section === "licensed-site-checks"
    ) {
      add("owner-agent", {
        id: `owner-agent-${planItemId}`,
        title: `Ask about ${rule.title.toLowerCase()}`,
        note: "Confirm the proposed fixed scope in writing before proceeding.",
      });
    }
    if (approvalContext === "strata" && rule.section === "licensed-site-checks") {
      add("strata-shared", {
        id: `strata-${planItemId}`,
        title: `Confirm shared-property impacts for ${rule.title.toLowerCase()}`,
        note: "Ask whether the work affects the exterior, services, structure or common property before proceeding.",
      });
    }
  }
  if (customPlanItemCount) {
    add("evidence-questions", {
      id: "custom-plan-items",
      title: "Review the home-specific plan items",
      note: `${customPlanItemCount} custom item${customPlanItemCount === 1 ? "" : "s"} need a separate permission and site-check decision. Their private wording is not copied into this checklist.`,
    });
  }

  const unknownFactCount = normalized.factEvidence
    .filter((item) => item.source === "unknown").length;
  if (unknownFactCount) {
    add("evidence-questions", {
      id: "unknown-home-facts",
      title: "List the important home facts that are still unknown",
      note: `${unknownFactCount} tracked fact${unknownFactCount === 1 ? "" : "s"} remain unknown. Confirm the ones that could change safety, scope or approval needs.`,
    });
  }

  let privatePermissionItemCount = 0;
  for (const item of normalized.permissionItems) {
    if (usedPermissionItems.has(item.id)) continue;
    if (item.id.startsWith("plan-custom")) {
      add("evidence-questions", {
        id: "custom-permission-items",
        title: "Review the home-specific permission questions",
        note: "Private custom-plan wording is not copied into this checklist. Confirm its permission and site-check boundaries separately.",
      });
      continue;
    }
    privatePermissionItemCount += 1;
    add(permissionSectionFor(item.classification), {
      id: `customer-private-item-${privatePermissionItemCount}`,
      title: "Review a home-specific permission item",
      note: item.note
        ? "Customer classification and a private project note are recorded for this item. Review them in the signed-in project before sharing this checklist; their wording is not copied here."
        : "Customer classification is recorded for this item. Its private title is not copied into this checklist.",
    });
  }

  return {
    version: CUSTOMER_ADVISOR_PROFILE_VERSION,
    title: "Property permission checklist",
    context: { householdSituation, approvalContext },
    sections: [...sections.values()],
    disclaimer: "This planning checklist records questions and possible approval boundaries. It is not legal advice, does not grant or confirm permission, and does not replace owner, strata, licensed trade or site-specific advice.",
  };
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
  electricResistance: {
    id: "electric-resistance-heating-review",
    stage: "Use the existing system carefully",
    title: "Review electric resistance heating before adding capacity",
    text: "Record which rooms use portable, panel or resistance heating and when. Reduce avoidable heat loss first, then compare efficient reverse-cycle options for the remaining occupied-room need.",
    href: "/guides/heating",
    action: "Review heating and cooling guidance",
  },
  electricHotWater: {
    id: "electric-hot-water-review",
    stage: "Review the existing system",
    title: "Check electric hot-water timing and replacement options",
    text: "Record the system type, tank or unit size, location, tariff and household demand. Compare controls and an efficient replacement only after capacity, electrical work and current incentives are confirmed.",
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

const insulationNeedsAttention = new Set([
  "ceiling-insulation-none",
  "ceiling-insulation-limited",
  "wall-insulation-none",
  "wall-insulation-limited",
  "floor-insulation-none",
  "floor-insulation-limited",
]);
const insulationUnknown = new Set([
  "ceiling-insulation-unknown",
  "wall-insulation-unknown",
  "floor-insulation-unknown",
]);
const insulationWell = new Set([
  "ceiling-insulation-well",
  "wall-insulation-well",
  "floor-insulation-well",
]);
const glazingKnownNeedsReview = new Set(["single-glazing", "mixed-glazing"]);
const windowCoveringsNeedReview = new Set([
  "window-coverings-none",
  "window-coverings-basic",
  "window-coverings-mixed",
]);

function includesAny(features, values) {
  return features.some((feature) => values.has(feature));
}

function insulationRecommendationFor(features, selectedGoals, pace) {
  if (includesAny(features, insulationNeedsAttention)) {
    return {
      ...advisorRecommendations.insulation,
      title: "Assess missing, old or patchy insulation before sizing equipment",
      text: "Confirm safe access, coverage, condition, moisture and electrical clearances. Improve the highest-impact incomplete area first, using a suitable total R-value and current site-specific scope.",
    };
  }
  if (includesAny(features, insulationUnknown)) {
    return advisorRecommendations.insulation;
  }
  if (includesAny(features, insulationWell)) {
    if (pace !== "whole-home" && !selectedGoals.includes("improve-comfort")) {
      return null;
    }
    return {
      ...advisorRecommendations.insulation,
      title: "Protect existing insulation and investigate only specific gaps",
      text: "The household reports good insulation in at least one area. Check condition, continuity, moisture and electrical clearances only where comfort evidence or planned work suggests a gap. Do not assume more insulation is automatically required.",
    };
  }
  return pace === "whole-home" || selectedGoals.includes("improve-comfort")
    ? advisorRecommendations.insulation
    : null;
}

function windowRecommendationFor(features) {
  if (includesAny(features, windowCoveringsNeedReview)) {
    return {
      ...advisorRecommendations.windows,
      title: "Improve close-fitting window coverings before major glazing work",
      text: "Basic or missing internal coverings can leave avoidable heat flow at the glass. Compare fit, edge gaps, honeycomb or thermal blinds, and heavy curtains with pelmets before assuming replacement glazing is the first step.",
    };
  }
  if (includesAny(features, glazingKnownNeedsReview)) {
    return {
      ...advisorRecommendations.windows,
      title: "Reduce heat flow through single or mixed glazing",
      text: "Record which windows are single, double or secondary glazed, then compare frame and seal repair, close-fitting coverings, suitable external shade, secondary glazing and replacement glazing.",
    };
  }
  if (
    features.includes("glazing-unknown")
    || features.includes("window-coverings-unknown")
  ) {
    return advisorRecommendations.windows;
  }
  if (
    features.includes("double-glazing")
    || features.includes("window-coverings-thermal")
  ) {
    return {
      ...advisorRecommendations.windows,
      title: "Check frames, seals and remaining window-specific comfort gaps",
      text: "The household reports double or secondary glazing or stronger thermal coverings. Check fit, seals, frames, orientation and the rooms still affected before considering more window work.",
    };
  }
  return null;
}

function shadingRecommendationFor(features, selectedGoals, advisorProfile) {
  const heatConcern = features.includes("comfort-too-hot");
  const hotClimate = ["hot-humid", "hot-dry", "warm-humid"].includes(
    advisorProfile.climate?.code,
  );
  if (
    features.includes("external-shading-none")
    && (heatConcern || hotClimate || selectedGoals.includes("improve-comfort"))
  ) {
    return {
      ...advisorRecommendations.shading,
      title: "Add suitable external shade where summer sun is a problem",
      text: "Map when direct sun reaches each affected window. Compare orientation-specific awnings, shutters, external blinds or other suitable shade before adding cooling capacity.",
    };
  }
  if (features.includes("external-shading-unknown") && (heatConcern || hotClimate)) {
    return {
      ...advisorRecommendations.shading,
      title: "Map direct sun before choosing more shade",
      text: "Record which windows receive direct sun and when. This separates an external-shade opportunity from glazing, ventilation or equipment needs.",
    };
  }
  if (
    (features.includes("external-shading")
      || features.includes("external-shading-most"))
    && (heatConcern || selectedGoals.includes("improve-comfort"))
  ) {
    return {
      ...advisorRecommendations.shading,
      title: "Check whether existing shade protects the problem windows",
      text: "The household reports some external shade. Confirm its orientation, seasonal coverage and the rooms still overheating before adding more shade or cooling capacity.",
    };
  }
  return null;
}

function normaliseGoals(raw) {
  if (Array.isArray(raw.goals)) return list(raw.goals, goals, 10);
  return goals.has(raw.goal) ? [raw.goal] : [];
}

function roomComfortPlanning(rooms = []) {
  const concernValues = [...new Set(rooms.flatMap((room) => room.concerns))];
  const useValues = [...new Set(rooms.flatMap((room) => room.usePeriods))];
  const concernLabels = concernValues.map((value) =>
    label(customerAdvisorOptions.comfortConcerns, value));
  const useLabels = useValues.map((value) =>
    label(customerAdvisorOptions.usePeriods, value));
  const daytimeHeat = rooms.some((room) =>
    room.concerns.includes("too-hot")
    && room.usePeriods.some((value) => ["morning", "daytime"].includes(value)));
  const overnightCold = rooms.some((room) =>
    room.concerns.includes("too-cold")
    && room.usePeriods.includes("overnight"));
  const moistureFirst = concernValues.some((value) =>
    ["condensation", "damp-or-mould", "stuffy"].includes(value));
  const observed = `Controlled observations: ${concernLabels.join(", ").toLowerCase() || "no concern selected"}. Use periods: ${useLabels.join(", ").toLowerCase() || "not selected"}.`;
  if (daytimeHeat && !overnightCold) {
    return {
      daytimeHeat,
      overnightCold,
      moistureFirst,
      title: "Prioritise daytime heat and sun in occupied rooms",
      text: `${observed} Check direct sun, external shade, glazing exposure and safe air movement before adding cooling capacity.`,
    };
  }
  if (overnightCold && !daytimeHeat) {
    return {
      daytimeHeat,
      overnightCold,
      moistureFirst,
      title: "Prioritise overnight heat retention in occupied rooms",
      text: `${observed} Check safe draught control, insulation and close-fitting window coverings before adding heating capacity.`,
    };
  }
  if (moistureFirst) {
    return {
      daytimeHeat,
      overnightCold,
      moistureFirst,
      title: "Resolve moisture and ventilation questions before sealing",
      text: `${observed} Identify moisture sources and required ventilation before making the building shell more airtight.`,
    };
  }
  return {
    daytimeHeat,
    overnightCold,
    moistureFirst,
    title: "Use controlled room comfort evidence",
    text: `${observed} Address the most frequent occupied-room concern before sizing whole-home equipment.`,
  };
}

function createAdvisorPlan({
  selectedGoals,
  pace,
  situation,
  approvalContext,
  features,
  budgetRange,
  advisorProfile,
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
  if (advisorProfile.climate) {
    addContext({
      id: "climate-sequence",
      stage: "Plan for local conditions",
      title: advisorProfile.climate.label,
      text: `${advisorProfile.climate.summary} ${advisorProfile.climate.disclaimer}`,
      href: "/guides/project-preparation#climate-planning",
      action: "Review the climate planning boundary",
    });
  }
  const roomComfort = roomComfortPlanning(advisorProfile.rooms);
  if (advisorProfile.rooms.length) {
    addContext({
      id: "room-comfort-profile",
      stage: "Prioritise occupied rooms",
      title: roomComfort.title,
      text: roomComfort.text,
      href: "/guides/project-preparation#room-comfort",
      action: "Review room-by-room planning guidance",
    });
  }
  if (situation === "renter" || selectedGoals.includes("renter-friendly")) addContext(advisorRecommendations.renter);
  if (features.includes("condensation-moisture") || selectedGoals.includes("healthier-home")) addContext(advisorRecommendations.moisture);
  if (
    selectedGoals.includes("improve-comfort")
    || features.some((item) => [
      "draughty",
      "open-wall-vents",
      "evaporative-ducts",
      "ventilation-unknown",
    ].includes(item))
  ) addContext(advisorRecommendations.draughts);
  addContext(insulationRecommendationFor(features, selectedGoals, pace));
  addContext(windowRecommendationFor(features));
  addContext(shadingRecommendationFor(features, selectedGoals, advisorProfile));
  if (features.includes("reverse-cycle")) {
    pull("heating");
    addContext(advisorRecommendations.reverseCycle);
  }
  if (
    features.includes("electric-resistance-heating")
    && selectedGoals.some((goal) =>
      ["lower-bills", "improve-comfort", "replace-now"].includes(goal))
  ) {
    pull("heating");
    addContext(advisorRecommendations.electricResistance);
  }
  if (features.includes("heat-pump-hot-water")) {
    pull("hot-water");
    addContext(advisorRecommendations.heatPumpHotWater);
  }
  if (
    features.some((item) =>
      ["electric-storage-hot-water", "electric-instant-hot-water"].includes(item))
    && selectedGoals.some((goal) =>
      ["lower-bills", "replace-now"].includes(goal))
  ) {
    pull("hot-water");
    addContext(advisorRecommendations.electricHotWater);
  }
  if (budgetRange === "under_2k") addContext(advisorRecommendations.lowBudget);
  if (budgetRange === "2_10k") addContext(advisorRecommendations.mediumBudget);
  if (budgetRange === "10k_plus") addContext(advisorRecommendations.largerBudget);
  const climateOrder = roomComfort.daytimeHeat
    ? [
        "room-comfort-profile",
        "climate-sequence",
        "moisture-ventilation",
        "window-shading",
        "windows-glazing",
        "draught-proofing",
        "insulation-review",
      ]
    : roomComfort.overnightCold
      ? [
          "room-comfort-profile",
          "moisture-ventilation",
          "draught-proofing",
          "insulation-review",
          "windows-glazing",
          "climate-sequence",
          "window-shading",
        ]
      : ["hot-humid", "hot-dry", "warm-humid"].includes(
        advisorProfile.climate?.code,
      )
    ? [
        "climate-sequence",
        "room-comfort-profile",
        "moisture-ventilation",
        "window-shading",
        "windows-glazing",
        "draught-proofing",
        "insulation-review",
      ]
    : [
        "climate-sequence",
        "room-comfort-profile",
        "moisture-ventilation",
        "draught-proofing",
        "insulation-review",
        "windows-glazing",
        "window-shading",
      ];
  const climateRank = new Map(climateOrder.map((id, index) => [id, index]));
  const orderedContextual = contextual
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      (climateRank.get(left.item.id) ?? climateOrder.length + left.index)
      - (climateRank.get(right.item.id) ?? climateOrder.length + right.index)
    ))
    .map(({ item }) => item);
  const portableRenter = orderedContextual.find((item) =>
    item.id === "renter-friendly-actions");
  const remainingContextual = orderedContextual.filter((item) =>
    item.id !== "renter-friendly-actions");
  const baseItems = [
    urgent,
    portableRenter,
    authority,
    ...remainingContextual,
    ...generated,
    support,
  ].filter(Boolean);
  const items = addPlanDecisionSupport(baseItems, {
    goalLabels: selectedGoals.map((goal) =>
      label(customerProjectOptions.goals, goal)),
    situation,
    approvalContext,
    budgetLabel: label(customerProjectOptions.budgets, budgetRange),
    factEvidence: advisorProfile.factEvidence,
    factLabels: customerAdvisorOptions.factKeys,
    climateLabel: advisorProfile.climate?.label || "",
    roomCount: advisorProfile.rooms.length,
  });
  const nextQuestions = createNextBestQuestions({
    items,
    factEvidence: advisorProfile.factEvidence,
    situation,
    approvalContext,
    budgetRange,
    roomCount: advisorProfile.rooms.length,
    goals: selectedGoals,
  });
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
    nextQuestions,
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
    if (!Array.isArray(rawSnapshot.items)) {
      return { ok: true, plan: generatedPlan };
    }
    return {
      ok: true,
      plan: {
        ...generatedPlan,
        items: preserveEditedPlanItems(rawSnapshot.items, generatedPlan.items),
      },
    };
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
        guidance: privateCustomPlanGuidance(),
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
  const features = normalizeHomeFeatureSelections(
    input.features || input.existingFeatures,
  );
  const budgetRange = budgets.has(input.budgetRange) ? input.budgetRange : "not_set";
  const baseAdvisorProfile = normalizeCustomerAdvisorProfile(input.advisorProfile, {
    postcode: input.postcode,
    addressState: input.addressState,
    householdSituation: situation,
    approvalContext,
    homeFeatures: features,
    propertyContext: input.propertyContext,
  });
  const generatedPlan = createAdvisorPlan({
    selectedGoals,
    pace,
    situation,
    approvalContext,
    features,
    budgetRange,
    advisorProfile: baseAdvisorProfile,
  });
  const snapshot = normalisePlanSnapshot(input.planSnapshot, generatedPlan);
  const advisorProfile = normalizeCustomerAdvisorProfile(baseAdvisorProfile, {
    postcode: input.postcode,
    addressState: input.addressState,
    householdSituation: situation,
    approvalContext,
    homeFeatures: features,
    propertyContext: input.propertyContext,
    allowedPlanItemIds: snapshot.ok
      ? snapshot.plan.items.map((item) => item.id)
      : generatedPlan.items.map((item) => item.id),
  });
  return { ...snapshot, generatedPlan, advisorProfile };
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
      if (item.id === "evidence-confidence") return [];
      const currentItem = current.get(item.id);
      const derivedAdvisorItem = [
        "climate-sequence",
        "room-comfort-profile",
      ].includes(item.id);
      if (currentItem && !derivedAdvisorItem && !seen.has(currentItem.id)) {
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
        guidance: privateCustomPlanGuidance(),
      }];
    });
}

export function normalizeCustomerProject(raw = {}) {
  const selectedGoals = normaliseGoals(raw);
  const pace = typeof raw.pace === "string" ? raw.pace : "staged";
  const postcode = text(raw.postcode, 4);
  const addressState = canonicalAustralianState(raw.addressState) || "";
  const householdSituation = situations.has(raw.householdSituation)
    ? raw.householdSituation
    : "";
  const existingFeatures = normalizeHomeFeatureSelections(raw.existingFeatures);
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
    postcode,
    addressState,
    propertyContext,
    advisorProfile: raw.advisorProfile,
    planSnapshot: raw.planSnapshot,
  });
  if (!preparedPlan.ok) return { ok: false, error: preparedPlan.error };
  const planSnapshot = preparedPlan.plan;
  const normalized = {
    title: text(raw.title, 120),
    homeNickname: text(raw.homeNickname, 80) || "My home",
    postcode,
    addressState,
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
    advisorProfile: preparedPlan.advisorProfile,
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
  const advisorProfile = normalizeCustomerAdvisorProfile(project.advisorProfile, {
    postcode: project.postcode,
    addressState: project.addressState,
    householdSituation: project.householdSituation,
    approvalContext: context.approvalContext,
    homeFeatures: project.existingFeatures,
    propertyContext: context,
  });
  const roomTypeLabels = [...new Set(advisorProfile.rooms.map((room) =>
    label(customerAdvisorOptions.roomTypes, room.roomType),
  ))];
  const concernLabels = [...new Set(advisorProfile.rooms.flatMap((room) =>
    room.concerns.map((concern) => label(customerAdvisorOptions.comfortConcerns, concern)),
  ))];
  const knownFactCount = advisorProfile.factEvidence
    .filter((item) => item.source !== "unknown").length;
  const unknownFactCount = advisorProfile.factEvidence.length - knownFactCount;
  const advisorContext = [
    advisorProfile.climate
      ? `${advisorProfile.climate.label}, broad planning guide only and not a NatHERS assessment`
      : "",
    roomTypeLabels.length
      ? `room types: ${roomTypeLabels.join(", ").toLowerCase()}${concernLabels.length ? `; reported concerns: ${concernLabels.join(", ").toLowerCase()}` : ""}`
      : "",
    `${knownFactCount} tracked home facts have a household answer or linked evidence and ${unknownFactCount} remain not known or not checked; this status does not mean professional review`,
  ].filter(Boolean).join(". ");
  const title = categoryLabels.length === 1 ? `${categoryLabels[0]} project` : "Multi-upgrade home project";
  return {
    title,
    projectType: `${propertyLabel} | ${stageLabel}`,
    postcode: project.postcode,
    state: project.addressState,
    serviceCategories: installerCategories,
    priority: project.timing === "urgent" ? "urgent" : "standard",
    timing: project.timing,
    summary: `${propertyLabel} household seeking ${categorySummary}. Property context: ${propertyFacts.join(", ").toLowerCase()}${siteConsiderations ? `. Site considerations: ${siteConsiderations.toLowerCase()}` : ""}. Goals: ${goalSummary}. Priorities: ${prioritySummary}. Advisor planning context: ${advisorContext}. The household is following a ${paceLabel} plan. Identity, exact location, contact details, private notes and usage records are withheld. Any customer-approved photos and documents are provided separately to allocated verified installers for quoting guidance. Respond only through the structured platform workflow.`,
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
