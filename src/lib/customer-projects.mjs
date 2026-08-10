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
export const CUSTOMER_PLAN_VERSION = "2026-08-10-complete-home-intake-v10";
export const CUSTOMER_LEGACY_PLAN_VERSIONS = [
  "2026-07-15",
  "2026-07-29-home-advisor",
  "2026-07-29-evidence-climate-advisor",
  "2026-07-29-decision-support-advisor",
  "2026-07-29-home-feature-taxonomy-v2",
  "2026-07-29-adviser-print-comfort-v3",
  "2026-07-30-roadmap-context-v4",
  "2026-07-31-trade-enquiry-home-systems-v5",
  "2026-08-09-guided-home-systems-v6",
  "2026-08-10-quick-wins-home-systems-v7",
  "2026-08-10-home-context-v8",
  "2026-08-10-external-wall-taxonomy-v9",
];
export const CUSTOMER_ADVISOR_PROFILE_VERSION = "2026-07-31-advisor-profile-v5";
export const CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION =
  "2026-07-29-self-declared-adviser-v1";
const LEGACY_CUSTOMER_PLAN_VERSIONS = new Set(CUSTOMER_LEGACY_PLAN_VERSIONS);
export const MAX_CUSTOMER_PROJECTS = 40;
export const MAX_OPEN_CUSTOMER_OPPORTUNITIES = 5;
export const MAX_HOME_FEATURE_SELECTIONS = 36;

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
        label: "Insulation in walls that face outdoors",
        help: "Count external walls only. Party walls shared with another home are recorded separately in Home basics. Plans, invoices or an earlier assessment are more reliable than guessing from the wall surface.",
        mode: "single",
        unknownValue: "wall-insulation-unknown",
        options: [
          ["wall-insulation-none", "No external wall insulation that I know of"],
          ["wall-insulation-limited", "Some external walls are insulated, or coverage may be old or patchy"],
          ["wall-insulation-well", "External walls are well insulated or recently upgraded"],
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
      {
        id: "sun-exposure",
        label: "Direct sun on the main living areas",
        help: "Choose the closest safe observation. This helps separate morning glare from afternoon overheating without asking you to measure orientation.",
        mode: "single",
        unknownValue: "sun-exposure-unknown",
        options: [
          ["sun-exposure-morning", "Mostly morning sun"],
          ["sun-exposure-afternoon", "Mostly afternoon sun"],
          ["sun-exposure-both", "Strong sun at different times of day"],
          ["sun-exposure-little", "Little direct sun"],
          ["sun-exposure-unknown", "Not sure"],
        ],
      },
    ],
  },
  {
    id: "ventilation",
    title: "Draughts and ventilation",
    description: "Record fixed openings and the exhaust fans you can see so the plan does not mistake required ventilation for an unwanted draught.",
    questions: [
      {
        id: "ventilation-features",
        label: "Which other fixed openings or ventilation systems are present?",
        help: "Choose all that apply. Never block or seal a vent, chimney or flue until its purpose and any combustion-safety need are confirmed.",
        mode: "multiple",
        noneValue: "ventilation-none-known",
        unknownValue: "ventilation-unknown",
        options: [
          ["open-fixed-wall-vents", "Open wall vents"],
          ["open-unused-chimney", "Open or unused chimney or flue"],
          ["evaporative-ducts", "Evaporative-cooling ceiling outlets"],
          ["mechanical-ventilation", "Purpose-designed mechanical ventilation"],
          ["ventilation-none-known", "None of these other systems that I know of"],
          ["ventilation-unknown", "Not sure"],
        ],
      },
      {
        id: "exhaust-fans",
        label: "Which kitchen or bathroom exhaust fans are fitted?",
        help: "Choose the fans you can see. You do not need to know where they vent or whether they have a shutter or damper.",
        mode: "multiple",
        noneValue: "exhaust-fans-none",
        unknownValue: "exhaust-fans-unknown",
        options: [
          ["kitchen-exhaust-fan", "Kitchen exhaust fan or rangehood"],
          ["bathroom-exhaust-fan", "Bathroom exhaust fan"],
          ["exhaust-fans-none", "No kitchen or bathroom exhaust fans"],
          ["exhaust-fans-unknown", "Not sure"],
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
          ["reverse-cycle", "Air-con, including reverse-cycle air-con"],
          ["gas-heating", "Gas space or ducted heating"],
          ["hydronic-heating", "Hydronic heating"],
          ["wood-heating", "Wood fire or wood heater"],
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
          ["gas-storage-hot-water", "Gas storage hot water"],
          ["gas-continuous-flow-hot-water", "Instantaneous or continuous-flow gas hot water"],
          ["gas-hot-water-type-unknown", "Gas hot water, type not sure"],
          ["heat-pump-hot-water", "Heat-pump hot water"],
          ["electric-storage-hot-water", "Electric storage hot water"],
          ["electric-instant-hot-water", "Instantaneous electric hot water"],
          ["solar-hot-water", "Solar hot water, including boosted systems"],
          ["electric-gas-boosted-hot-water", "Electric hot water with a gas booster"],
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
    title: "Electricity supply, solar, battery and electric vehicle",
    description: "Record what you safely know and what is already installed or planned. These household answers are planning clues, not verification of electrical capacity.",
    questions: [
      {
        id: "electrical-supply",
        label: "Household electrical supply",
        help: "Choose Not sure unless this is shown on an existing record or has been confirmed by an electrician. The number of phases does not prove available capacity.",
        mode: "single",
        unknownValue: "electrical-supply-unknown",
        options: [
          ["electrical-supply-single-phase", "Single-phase supply"],
          ["electrical-supply-two-phase", "Two-phase supply"],
          ["electrical-supply-three-phase", "Three-phase supply"],
          ["electrical-supply-unknown", "Not sure"],
        ],
      },
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
  {
    id: "lighting-pool",
    title: "Lighting, pool and spa",
    description: "These can be useful everyday energy-saving opportunities when they are present.",
    questions: [
      {
        id: "lighting",
        label: "Lighting used most often",
        help: "Choose the closest answer. You do not need to count every light.",
        mode: "single",
        unknownValue: "lighting-unknown",
        options: [
          ["lighting-mostly-led", "Mostly LED lights"],
          ["lighting-mixed", "A mix of LED and older lights"],
          ["lighting-mostly-old", "Mostly halogen, incandescent or older lights"],
          ["lighting-unknown", "Not sure"],
        ],
      },
      {
        id: "pool-spa",
        label: "Pool or spa at the property",
        help: "Include equipment you are responsible for operating.",
        mode: "single",
        noneValue: "pool-spa-none",
        unknownValue: "pool-spa-unknown",
        options: [
          ["pool-installed", "A pool is present"],
          ["spa-installed", "A spa is present"],
          ["pool-and-spa-installed", "Both a pool and spa are present"],
          ["pool-spa-none", "No pool or spa"],
          ["pool-spa-unknown", "Not sure"],
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
  "wall-insulation-not-applicable",
  "floor-insulation",
  "insulation-unknown",
  "internal-window-coverings",
  "gas-hot-water",
  "exhaust-ducted-outside",
  "exhaust-discharge-outside",
  "exhaust-discharge-cavity",
  "exhaust-discharge-unknown",
  "exhaust-damper-known",
  "exhaust-damper-none-known",
  "exhaust-damper-unknown",
  "heat-pump-space-heating",
  "open-wall-vents",
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
  if (selected.has("wall-insulation-not-applicable")) {
    selected.add("wall-insulation-unknown");
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
  if (selected.has("gas-hot-water")) {
    addWhenUnanswered("hot-water", "gas-hot-water-type-unknown");
  }
  if (
    selected.has("heat-pump-space-heating")
    && !selected.has("heating-cooling-none")
    && !selected.has("heating-cooling-unknown")
  ) {
    selected.add("reverse-cycle");
  }
  if (selected.has("open-wall-vents")) {
    addWhenUnanswered("ventilation-features", "ventilation-unknown");
  }
  if (
    [
      "exhaust-ducted-outside",
      "exhaust-discharge-outside",
      "exhaust-discharge-cavity",
      "exhaust-discharge-unknown",
      "exhaust-damper-known",
      "exhaust-damper-none-known",
      "exhaust-damper-unknown",
    ].some((feature) => selected.has(feature))
  ) {
    addWhenUnanswered("exhaust-fans", "exhaust-fans-unknown");
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
    ["townhouse", "Townhouse, terrace, villa or duplex"],
    ["apartment", "Apartment or unit"],
    ["rural", "Rural home"],
    ["new-build", "New build or major renovation"],
    ["not_sure", "Not sure"],
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
    ["not_set", "Skip this for now"],
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
  occupants: [
    ["one", "One person"],
    ["two", "Two people"],
    ["three_four", "Three or four people"],
    ["five_plus", "Five or more people"],
    ["not_sure", "Not sure"],
  ],
  sharedWalls: [
    ["none", "No walls shared with another dwelling"],
    ["one_side", "One side shared with another dwelling"],
    ["two_plus_sides", "Two or more sides shared with other dwellings"],
    ["not_sure", "Not sure"],
  ],
  roofTypes: [
    ["metal", "Metal roof covering"],
    ["tile", "Concrete or terracotta roof tiles"],
    ["flat", "Membrane or another flat-roof covering"],
    ["mixed", "Mixed roof coverings"],
    ["not_sure", "Not sure"],
  ],
  roofColours: [
    ["light", "Light coloured"],
    ["medium", "Mid coloured"],
    ["dark", "Dark coloured"],
    ["mixed", "Mixed colours"],
    ["not_sure", "Not sure"],
  ],
  roofForms: [
    ["pitched", "Pitched or sloping roof"],
    ["flat_low_pitch", "Flat or low-pitch roof"],
    ["mixed", "A mix of roof forms"],
    ["not_sure", "Not sure"],
  ],
  roofConditions: [
    ["good", "No known leaks, damage or major deterioration"],
    ["weathered", "Older or weathered, but no known active problem"],
    ["known_issue", "A known leak, damage or condition issue"],
    ["not_sure", "Not sure"],
  ],
  switchboards: [
    ["modern_breakers", "Modern circuit breakers"],
    ["older_fuses", "Older fuse board"],
    ["recent_upgrade", "Recently upgraded"],
    ["not_sure", "Not sure"],
  ],
  wallConstructions: [
    ["brick_veneer", "Brick veneer"],
    ["double_brick", "Double brick or solid brick"],
    ["lightweight", "Weatherboard or another lightweight cladding"],
    ["masonry_concrete", "Concrete block, concrete or other masonry"],
    ["mixed", "A mix of wall constructions"],
    ["not_sure", "Not sure"],
  ],
  floorConstructions: [
    ["slab_on_ground", "Concrete slab on the ground"],
    ["suspended_timber", "Suspended timber floor"],
    ["suspended_concrete", "Suspended concrete floor"],
    ["mixed", "A mix of floor constructions"],
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
    ["electrical-supply", "Household electrical supply"],
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
  professionalRoles: [
    ["accredited-energy-adviser", "Accredited energy adviser"],
    ["accredited-home-comfort-adviser", "Accredited home-comfort adviser"],
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
const occupants = new Set(customerProjectOptions.occupants.map(([value]) => value));
const sharedWalls = new Set(customerProjectOptions.sharedWalls.map(([value]) => value));
const roofTypes = new Set(customerProjectOptions.roofTypes.map(([value]) => value));
const roofColours = new Set(customerProjectOptions.roofColours.map(([value]) => value));
const roofForms = new Set(customerProjectOptions.roofForms.map(([value]) => value));
const roofConditions = new Set(customerProjectOptions.roofConditions.map(([value]) => value));
const switchboards = new Set(customerProjectOptions.switchboards.map(([value]) => value));
const wallConstructions = new Set(customerProjectOptions.wallConstructions.map(([value]) => value));
const floorConstructions = new Set(customerProjectOptions.floorConstructions.map(([value]) => value));
const accessConstraints = new Set(customerProjectOptions.accessConstraints.map(([value]) => value));
const advisorFactKeys = new Set(customerAdvisorOptions.factKeys.map(([value]) => value));
const evidenceSources = new Set(customerAdvisorOptions.evidenceSources.map(([value]) => value));
const roomTypes = new Set(customerAdvisorOptions.roomTypes.map(([value]) => value));
const comfortConcerns = new Set(customerAdvisorOptions.comfortConcerns.map(([value]) => value));
const roomUsePeriods = new Set(customerAdvisorOptions.usePeriods.map(([value]) => value));
const permissionClasses = new Set(customerAdvisorOptions.permissionClasses.map(([value]) => value));
const professionalReviewRoles = new Set(
  customerAdvisorOptions.professionalRoles.map(([value]) => value),
);
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
      "open-fixed-wall-vents",
      "open-unused-chimney",
      "evaporative-ducts",
      "mechanical-ventilation",
      "ventilation-none-known",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "exhaust-fans-none",
    ]),
    unknown: new Set([
      "ventilation-unknown",
      "exhaust-fans-unknown",
    ]),
    requiredGroups: [
      {
        answered: new Set([
          "open-fixed-wall-vents",
          "open-unused-chimney",
          "evaporative-ducts",
          "mechanical-ventilation",
          "ventilation-none-known",
        ]),
        unknown: new Set(["ventilation-unknown"]),
      },
      {
        answered: new Set([
          "kitchen-exhaust-fan",
          "bathroom-exhaust-fan",
          "exhaust-fans-none",
        ]),
        unknown: new Set(["exhaust-fans-unknown"]),
      },
    ],
  }],
  ["heating-cooling", {
    answered: new Set([
      "reverse-cycle",
      "gas-heating",
      "hydronic-heating",
      "wood-heating",
      "electric-resistance-heating",
      "evaporative-cooling",
      "fans-only",
      "heating-cooling-none",
    ]),
    unknown: new Set(["heating-cooling-unknown"]),
  }],
  ["hot-water", {
    answered: new Set([
      "gas-storage-hot-water",
      "gas-continuous-flow-hot-water",
      "heat-pump-hot-water",
      "electric-storage-hot-water",
      "electric-instant-hot-water",
      "solar-hot-water",
      "electric-gas-boosted-hot-water",
      "hot-water-other",
    ]),
    unknown: new Set([
      "gas-hot-water-type-unknown",
      "hot-water-unknown",
    ]),
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
  ["electrical-supply", {
    answered: new Set([
      "electrical-supply-single-phase",
      "electrical-supply-two-phase",
      "electrical-supply-three-phase",
    ]),
    unknown: new Set(["electrical-supply-unknown"]),
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
  if (
    Array.isArray(rule.requiredGroups)
    && rule.requiredGroups.some((group) => (
      [...group.unknown].some((value) => selectedFeatures.has(value))
      || ![...group.answered].some((value) => selectedFeatures.has(value))
    ))
  ) {
    return "unknown";
  }
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

export function validateCustomerProfessionalReview(raw) {
  const supplied = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {};
  if (supplied.enabled !== true) return { ok: true, review: null };
  const role = professionalReviewRoles.has(supplied.role) ? supplied.role : "";
  const adviserName = text(supplied.adviserName, 80);
  const accreditationScheme = text(supplied.accreditationScheme, 120);
  const accreditationReference = text(supplied.accreditationReference, 80);
  const notes = text(supplied.notes, 1200);
  if (!role) {
    return {
      ok: false,
      error: "Choose the accredited adviser role used for this review.",
    };
  }
  if (adviserName.length < 2) {
    return {
      ok: false,
      error: "Enter the adviser name before using the professional review statement.",
    };
  }
  if (accreditationScheme.length < 2) {
    return {
      ok: false,
      error: "Enter the accreditation scheme or professional body.",
    };
  }
  if (
    accreditationReference.length < 2
    || !/^[a-zA-Z0-9][a-zA-Z0-9 ./_-]{1,79}$/.test(accreditationReference)
  ) {
    return {
      ok: false,
      error: "Enter a valid accreditation or membership reference.",
    };
  }
  if (supplied.declarationAccepted !== true) {
    return {
      ok: false,
      error: "Confirm the professional review declaration before continuing.",
    };
  }
  if (
    supplied.declarationVersion
    !== CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION
  ) {
    return {
      ok: false,
      error: "Review and confirm the current professional review declaration before continuing.",
    };
  }
  return {
    ok: true,
    review: {
      enabled: true,
      role,
      adviserName,
      accreditationScheme,
      accreditationReference,
      notes,
      declarationAccepted: true,
      declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    },
  };
}

export function normalizeCustomerProfessionalReview(raw) {
  const result = validateCustomerProfessionalReview(raw);
  return result.ok ? result.review : null;
}

export function resetCustomerProfessionalReviewDeclaration(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return profile;
  }
  const professionalReview = profile.professionalReview;
  if (
    !professionalReview
    || typeof professionalReview !== "object"
    || Array.isArray(professionalReview)
    || professionalReview.enabled !== true
  ) {
    return profile;
  }
  const reviewWithoutVersion = { ...professionalReview };
  delete reviewWithoutVersion.declarationVersion;
  return {
    ...profile,
    professionalReview: {
      ...reviewWithoutVersion,
      declarationAccepted: false,
    },
  };
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
  const professionalReview = normalizeCustomerProfessionalReview(
    supplied.professionalReview,
  );
  return {
    version: CUSTOMER_ADVISOR_PROFILE_VERSION,
    factEvidence,
    rooms,
    permissionItems,
    reviewItems,
    ...(professionalReview ? { professionalReview } : {}),
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
  const phone = text(profile.phone, 32);
  const addressLine1 = text(
    profile.addressLine1 || profile.address_line_1,
    120,
  );
  const suburb = text(profile.suburb, 80);
  if (!phone || !addressLine1 || !suburb) {
    return { ok: false, error: "Add a phone number, street address and suburb to continue." };
  }
  const projectPostcode = text(project.postcode, 4);
  const projectState = canonicalAustralianState(project.addressState || project.address_state) || "";
  const profilePostcode = text(profile.postcode, 4);
  const profileState = canonicalAustralianState(profile.addressState || profile.address_state) || "";
  if (projectPostcode !== profilePostcode || projectState !== profileState) {
    return { ok: false, error: "The service address postcode and state must match this project." };
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
const gasHotWaterFeatures = new Set([
  "gas-storage-hot-water",
  "gas-continuous-flow-hot-water",
  "gas-hot-water-type-unknown",
  "electric-gas-boosted-hot-water",
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
    stage: "Separate portable from fixed work",
    title: "Confirm which actions are reversible and which need permission",
    text: "Keep portable or reversible comfort actions separate from fixed sealing, electrical, plumbing, external, shared-property or installed-equipment work. Confirm the lease, ventilation and written approval boundary before committing to a fixed change.",
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
  electricalSupply: {
    id: "electrical-supply-check",
    stage: "Confirm electrical capacity",
    title: "Confirm the household electrical supply before sizing new loads",
    text: "The household supply answer is a planning clue only. It does not confirm available capacity. A licensed electrician should confirm the phases, service capacity, main switch, switchboard and existing loads before material hot-water, cooking, heating and cooling, solar, battery or EV-charging work is specified.",
    href: "/guides/project-preparation",
    action: "Review electrical planning questions",
  },
  draughts: {
    id: "draught-proofing",
    stage: "Reduce unwanted air leakage",
    title: "Map draughts without blocking required ventilation",
    text: "Check external doors, operable windows and uncontrolled gaps separately from exhaust fans, chimneys, flues, wall vents and evaporative-cooling outlets. Never seal an active chimney or flue, or block required ventilation. Confirm uncertain openings with an assessor or suitably qualified trade before changing them.",
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
  hydronicHeating: {
    id: "existing-hydronic-heating",
    stage: "Understand the existing system",
    title: "Map the hydronic heating before changing it",
    text: "Record the heat source, radiators or floor loops, zones, controls, flow temperatures and rooms that remain uncomfortable. A qualified provider should assess the whole system before its heat source or emitters are changed.",
    href: "/guides/heating",
    action: "Review heating and cooling guidance",
  },
  woodHeating: {
    id: "existing-wood-heating",
    stage: "Plan for comfort, safety and air quality",
    title: "Include the wood heater in the whole-home plan",
    text: "Record which rooms it serves, how often it is used, the flue condition and any smoke or air-quality concerns. Keep inspection, maintenance, ventilation and any replacement work within the relevant safety and approval requirements.",
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
  gasStorageHotWater: {
    id: "hot-water",
    stage: "Plan the replacement",
    title: "Plan around the existing gas hot-water storage tank",
    text: "Record the tank capacity, age, indoor or outdoor location, available space, drainage and household hot-water demand. Before choosing a replacement, have a licensed plumber and electrician confirm the plumbing, electrical supply and capacity, clearances, condensate and noise needs, and safe gas disconnection.",
    href: "/guides/hot-water",
    action: "Review hot-water guidance",
  },
  gasContinuousFlowHotWater: {
    id: "hot-water",
    stage: "Plan the replacement",
    title: "Plan around the existing continuous-flow gas hot-water unit",
    text: "Record the model and rated flow, wall location, flue and clearances, temperature controls and household hot-water demand. Before choosing a replacement, have a licensed plumber and electrician confirm a suitable tank or unit location, plumbing, electrical supply and capacity, condensate and noise needs, and safe gas disconnection.",
    href: "/guides/hot-water",
    action: "Review hot-water guidance",
  },
  gasHotWaterTypeUnknown: {
    id: "hot-water",
    stage: "Confirm the existing system",
    title: "Confirm which type of gas hot-water system is installed",
    text: "Use a safely visible label, an existing manual or invoice, or a suitably qualified provider to identify whether the system stores hot water or heats it continuously. Do not remove covers or enter an unsafe area to check. The two types can need different space, plumbing and replacement preparation, so do not infer the type from the fuel alone.",
    href: "/guides/hot-water",
    action: "Review hot-water guidance",
  },
  electricGasBoostedHotWater: {
    id: "hot-water",
    stage: "Confirm how the two energy sources work together",
    title: "Map the electric hot-water system and gas booster",
    text: "Record the tank or unit, electric heating method, gas booster, controls, fuel use and household demand. A licensed plumber and electrician should confirm how the components interact before controls, fuel supply or the system are changed.",
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

export const CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY =
  "Practical actions selected from current Australian Government household energy guidance and your answers. They are not upgrade steps, a site assessment, product endorsements or savings promises. Skip anything unsafe, unsuitable or inconsistent with product instructions.";

const heatingCoolingQuickWinFeatures = new Set([
  "reverse-cycle",
  "gas-heating",
  "hydronic-heating",
  "wood-heating",
  "electric-resistance-heating",
  "evaporative-cooling",
  "fans-only",
]);

const filterAndAirflowQuickWinFeatures = new Set([
  "reverse-cycle",
  "gas-heating",
  "evaporative-cooling",
  "fans-only",
]);

const hotWaterQuickWinFeatures = new Set([
  "gas-storage-hot-water",
  "gas-continuous-flow-hot-water",
  "gas-hot-water-type-unknown",
  "heat-pump-hot-water",
  "electric-storage-hot-water",
  "electric-instant-hot-water",
  "solar-hot-water",
  "electric-gas-boosted-hot-water",
]);

const cookingQuickWinFeatures = new Set([
  "gas-cooking",
  "electric-resistance-cooking",
  "induction-cooking",
  "mixed-cooking",
]);

function existingEquipmentQuickWinText({ features }) {
  const sentences = [];
  if (features.some((item) => heatingCoolingQuickWinFeatures.has(item))) {
    sentences.push("Follow the manufacturer instructions to clean or replace accessible user-serviceable filters safely, and use supported schedules, timers, fan speeds, zones, economy modes and app or remote controls. Condition occupied rooms rather than the whole home where practical. As a general starting point, Australian Government guidance suggests 18°C to 20°C for heating and 25°C to 27°C for cooling, adjusted for health, age and comfort needs.");
  }
  if (features.includes("solar")) {
    sentences.push("Move flexible loads into solar hours when the equipment, tariff and household routine make that practical.");
  }
  if (features.includes("ev")) {
    sentences.push("Schedule electric vehicle charging around the applicable tariff, network limits and the vehicle and charger instructions.");
  }
  return sentences.join(" ");
}

function existingEquipmentQuickWinTitle({ features }) {
  if (features.some((item) => filterAndAirflowQuickWinFeatures.has(item))) {
    return "Clean filters and tune the controls you already have";
  }
  if (features.some((item) => heatingCoolingQuickWinFeatures.has(item))) {
    return "Tune the heating and cooling controls you already have";
  }
  return "Use the controls and timing you already have";
}

const everydayActionCatalogue = [
  {
    id: "moisture-safe-routine",
    category: "Moisture and ventilation",
    title: "Control moisture at the source and keep required ventilation working",
    text: "Use kitchen and bathroom exhaust fans while cooking or showering when they operate safely. If steam, smells or moisture do not clear, ask the property manager or a suitably qualified trade to check the fan. Air the home only when outdoor humidity, smoke, weather and security make it suitable. Do not enter a roof or ceiling cavity, block fixed vents or seal unexplained gaps before their purpose and any combustion-safety need are understood.",
    matches: ({ features, selectedGoals }) => (
      features.some((item) => [
        "condensation-moisture",
        "open-fixed-wall-vents",
        "open-unused-chimney",
        "evaporative-ducts",
        "kitchen-exhaust-fan",
        "bathroom-exhaust-fan",
        "exhaust-fans-unknown",
        "mechanical-ventilation",
        "ventilation-unknown",
      ].includes(item))
      || selectedGoals.includes("healthier-home")
    ),
  },
  {
    id: "personal-warmth-first",
    category: "Personal comfort",
    title: "Warm the person before heating every room",
    text: "Layers, warm socks or slippers, suitable bedding and an electric throw used exactly as its manufacturer directs can improve personal comfort with less whole-room heating. Keep controls and cords undamaged and accessible. This is optional comfort advice, not a substitute for safe adequate heating where age, health or vulnerability makes that necessary.",
    matches: ({ features }) => (
      features.some((item) => ["comfort-too-cold", "draughty"].includes(item))
    ),
  },
  {
    id: "safe-draught-stopper",
    category: "Draughts",
    title: "Stop confirmed unwanted gaps without blocking ventilation",
    text: "Use a removable draught stopper under a door or a suitable weather seal only where the gap is confirmed as unwanted. Ask the owner or property manager before attaching seals in a rental or shared-property setting. Never block a fixed wall vent, chimney, flue, exhaust outlet or other opening until its purpose and any combustion-safety need are confirmed.",
    matches: ({ features }) => features.includes("draughty"),
  },
  {
    id: "use-existing-controls",
    category: "Equipment settings",
    title: existingEquipmentQuickWinTitle,
    text: existingEquipmentQuickWinText,
    matches: ({ features }) => (
      features.some((item) => [
        "reverse-cycle",
        "gas-heating",
        "hydronic-heating",
        "wood-heating",
        "electric-resistance-heating",
        "evaporative-cooling",
        "fans-only",
        "solar",
        "ev",
      ].includes(item))
    ),
  },
  {
    id: "hot-water-routine",
    category: "Hot water",
    title: "Use less hot water without changing safety settings",
    text: "Take shorter showers where suitable, use a water-efficient showerhead when compatible, wash clothes in cold water and run full laundry and dishwasher loads. Use only supported timer or tariff settings. Do not lower storage temperatures, disable safety cycles or bypass controls without qualified advice.",
    matches: ({ features }) => (
      features.some((item) => hotWaterQuickWinFeatures.has(item))
    ),
  },
  {
    id: "efficient-cooking",
    category: "Cooking",
    title: "Match the cooking task to the smallest practical energy use",
    text: "Use lids when suitable, match cookware to the burner or cooking zone, heat only the water needed in a kettle or pot, and avoid using a large oven for a small task when a suitable smaller appliance is available. Keep required kitchen ventilation operating and follow the appliance instructions.",
    matches: ({ features }) => (
      features.some((item) => cookingQuickWinFeatures.has(item))
    ),
  },
  {
    id: "appliance-routines",
    category: "Appliances and standby",
    title: "Cut avoidable appliance energy without disrupting essentials",
    text: "Run full loads, use cold washes and energy-saving cycles where suitable, and line-dry clothes when practical. Check fridge and freezer door seals, settings and ventilation clearances, and switch off genuinely unused standby loads at the wall. Keep fridges, freezers, medical equipment, security systems and anything else that must stay powered on.",
    matches: ({ selectedGoals }) => selectedGoals.includes("lower-bills"),
  },
  {
    id: "lighting-routine",
    category: "Lighting",
    title: ({ features }) => (
      features.includes("lighting-mostly-old")
      || features.includes("lighting-mixed")
        ? "Replace the most-used old lights with suitable LEDs first"
        : "Use daylight, task lighting and LEDs efficiently"
    ),
    text: "Use daylight where it is comfortable, switch off lights in empty rooms and use a task lamp instead of lighting a whole room when suitable. Replace frequently used halogen or incandescent lamps with compatible quality LEDs before little-used lights. Check dimmer, transformer, fitting and enclosed-luminaire compatibility before replacement.",
    matches: ({ features, selectedGoals }) => (
      selectedGoals.includes("lower-bills")
      || features.some((item) => [
        "lighting-mostly-led",
        "lighting-mixed",
        "lighting-mostly-old",
      ].includes(item))
    ),
  },
  {
    id: "pool-spa-routine",
    category: "Pool and spa",
    title: "Review pool or spa heating, cover and pump schedules",
    text: "Use a suitable cover to reduce heat and water loss, and review pump, filter and heating schedules against the equipment instructions, water-quality needs and applicable tariff. Run only for the safe time required. If rooftop solar is installed, consider suitable daytime operation without compromising sanitation or required filtration.",
    matches: ({ features }) => (
      features.some((item) => [
        "pool-installed",
        "spa-installed",
        "pool-and-spa-installed",
      ].includes(item))
    ),
  },
  {
    id: "safe-seasonal-airflow",
    category: "Cooling habits",
    title: "Try fans before or alongside air-con when conditions suit",
    text: "Fans can improve comfort in occupied rooms before or alongside air-con, but they do not cool an empty room. Cross-flow ventilation can help when outdoor temperature, humidity, smoke, weather, noise and security are suitable. Close openings and manage coverings when outdoor conditions become less helpful. Avoid a rule that windows should always stay open or always stay closed.",
    matches: ({ features, advisorProfile }) => (
      features.some((item) => [
        "comfort-too-hot",
        "evaporative-cooling",
        "fans-only",
      ].includes(item))
      || ["hot-humid", "hot-dry", "warm-humid"].includes(
        advisorProfile.climate?.code,
      )
    ),
  },
  {
    id: "seasonal-window-and-landscape",
    category: "Windows, shade and garden",
    title: "Time window coverings and observe shade before changing the landscape",
    text: "Use close-fitting coverings to manage unwanted heat or heat loss while preserving useful winter sun where it helps. Basic roller, vertical and Venetian blinds usually insulate less than honeycomb or thermal blinds or heavy curtains with pelmets. Before planting or changing external shade, observe seasonal sun and consider owner or strata approval, mature size, roots, drainage, underground and overhead services, fire or bushfire risk, security, airflow and winter solar access.",
    matches: ({ features, selectedGoals }) => (
      selectedGoals.includes("improve-comfort")
      || features.some((item) => [
        "comfort-too-hot",
        "comfort-too-cold",
        "single-glazing",
        "mixed-glazing",
        "window-coverings-none",
        "window-coverings-basic",
        "window-coverings-mixed",
        "external-shading-none",
        "external-shading",
      ].includes(item))
    ),
  },
  {
    id: "renter-friendly-diy-boundary",
    category: "Renter-friendly and DIY",
    title: "Keep low-cost measures removable, safe and permission-aware",
    text: "Draught snakes, suitable removable seals or films, reversible covers for unused evaporative-cooling outlets, and portable induction cooking may help where the product, surface, outlet capacity, ventilation and lease conditions are suitable. Removable does not guarantee damage-free or permission-free. Never cover a fixed vent, flue or active outlet without confirming its purpose.",
    matches: ({ selectedGoals, situation }) => (
      situation === "renter"
      || selectedGoals.includes("renter-friendly")
    ),
  },
];

function createEverydayActions({
  selectedGoals,
  situation,
  features,
  budgetRange,
  advisorProfile,
}) {
  const context = {
    selectedGoals,
    situation,
    features,
    budgetRange,
    advisorProfile,
  };
  return everydayActionCatalogue
    .filter((item) => item.matches(context))
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      category: item.category,
      title: typeof item.title === "function" ? item.title(context) : item.title,
      text: typeof item.text === "function" ? item.text(context) : item.text,
    }));
}

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
  const afternoonSun = features.includes("sun-exposure-afternoon")
    || features.includes("sun-exposure-both");
  const hotClimate = ["hot-humid", "hot-dry", "warm-humid"].includes(
    advisorProfile.climate?.code,
  );
  if (
    features.includes("external-shading-none")
    && (
      heatConcern
      || afternoonSun
      || hotClimate
      || selectedGoals.includes("improve-comfort")
    )
  ) {
    return {
      ...advisorRecommendations.shading,
      title: "Add suitable external shade where summer sun is a problem",
      text: `${afternoonSun ? "The household reports strong afternoon sun. " : ""}Map when direct sun reaches each affected window. Compare orientation-specific awnings, shutters, external blinds or other suitable shade before adding cooling capacity.`,
    };
  }
  if (
    features.includes("external-shading-unknown")
    && (heatConcern || afternoonSun || hotClimate)
  ) {
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

function electricalSupplyRecommendationFor(
  features,
  selectedGoals,
  selectedServices,
) {
  const supply = features.find((item) => [
    "electrical-supply-single-phase",
    "electrical-supply-two-phase",
    "electrical-supply-three-phase",
    "electrical-supply-unknown",
  ].includes(item));
  if (!supply) return null;
  const materialElectricalPlanning = selectedGoals.some((goal) => [
    "lower-bills",
    "improve-comfort",
    "healthier-home",
    "reduce-emissions",
    "replace-now",
    "move-from-gas",
    "add-solar-storage",
    "improve-resilience",
    "prepare-renovation",
  ].includes(goal)) || selectedServices.some((service) => [
    "solar",
    "battery",
    "heating-cooling",
    "hot-water",
    "ev-charging",
    "other",
  ].includes(service));
  if (!materialElectricalPlanning) return null;
  if (supply === "electrical-supply-unknown") {
    return advisorRecommendations.electricalSupply;
  }
  const reportedSupply = supply === "electrical-supply-three-phase"
    ? "three-phase"
    : supply === "electrical-supply-two-phase"
      ? "two-phase"
      : "single-phase";
  return {
    ...advisorRecommendations.electricalSupply,
    title: `Treat the reported ${reportedSupply} supply as a planning clue`,
    text: `The household reports a ${reportedSupply} supply, but this has not been verified and does not prove available capacity. A licensed electrician should confirm the phases, service capacity, main switch, switchboard and existing loads before material hot-water, cooking, heating and cooling, solar, battery or EV-charging work is specified.`,
  };
}

function gasHotWaterRecommendationFor(features) {
  if (features.includes("gas-storage-hot-water")) {
    return advisorRecommendations.gasStorageHotWater;
  }
  if (features.includes("gas-continuous-flow-hot-water")) {
    return advisorRecommendations.gasContinuousFlowHotWater;
  }
  if (features.includes("gas-hot-water-type-unknown")) {
    return advisorRecommendations.gasHotWaterTypeUnknown;
  }
  if (features.includes("electric-gas-boosted-hot-water")) {
    return advisorRecommendations.electricGasBoostedHotWater;
  }
  return null;
}

function normaliseGoals(raw) {
  if (Array.isArray(raw.goals)) return list(raw.goals, goals, 10);
  return goals.has(raw.goal) ? [raw.goal] : [];
}

const customerGoalPriorityRules = new Map([
  ["lower-bills", ["lower-bills"]],
  ["improve-comfort", ["comfort"]],
  ["healthier-home", ["comfort"]],
  ["renter-friendly", ["comfort"]],
  ["reduce-emissions", ["move-from-gas"]],
  ["move-from-gas", ["move-from-gas"]],
  ["improve-resilience", ["resilience"]],
  ["add-solar-storage", ["future-ready"]],
  ["prepare-renovation", ["future-ready"]],
  ["replace-now", ["replace-failed"]],
]);

export function deriveCustomerProjectPriorities(goalValues = []) {
  const selectedGoals = list(goalValues, goals, 10);
  const selectedPriorities = new Set(
    selectedGoals.flatMap((goal) => customerGoalPriorityRules.get(goal) || []),
  );
  return customerProjectOptions.priorities
    .map(([value]) => value)
    .filter((value) => selectedPriorities.has(value));
}

function plannerRecommendation({ goal, features = [], id }) {
  return createHomeEnergyPlan({
    goal,
    pace: "staged",
    situation: "owner",
    features,
  }).items.find((item) => item.id === id) || null;
}

function serviceCategoryRecommendation(category) {
  if (category === "assessment") {
    return plannerRecommendation({
      goal: "prepare-renovation",
      id: "assessment",
    });
  }
  if (category === "solar") {
    return plannerRecommendation({
      goal: "add-solar-storage",
      id: "solar",
    });
  }
  if (category === "battery") {
    return plannerRecommendation({
      goal: "add-solar-storage",
      features: ["solar"],
      id: "battery",
    });
  }
  if (category === "heating-cooling") {
    return plannerRecommendation({
      goal: "improve-comfort",
      id: "heating",
    });
  }
  if (category === "hot-water") {
    return plannerRecommendation({
      goal: "move-from-gas",
      id: "hot-water",
    });
  }
  if (category === "draught-proofing") return advisorRecommendations.draughts;
  if (category === "insulation") return advisorRecommendations.insulation;
  if (category === "glazing") return advisorRecommendations.windows;
  if (category === "window-coverings") {
    return {
      ...advisorRecommendations.shading,
      title: "Compare close-fitting window coverings and suitable external shade",
      text: "Record which windows cause summer heat or winter heat loss, their orientation and the coverings already fitted. Compare fit, edge gaps, honeycomb or thermal blinds, heavy curtains with pelmets and suitable external shade before assuming glazing replacement is needed.",
    };
  }
  if (category === "ev-charging") {
    return plannerRecommendation({
      goal: "lower-bills",
      features: ["ev"],
      id: "ev",
    });
  }
  if (category === "other") {
    return {
      id: "considered-other-work",
      stage: "Clarify before quoting",
      title: "Define the other home energy work you are considering",
      text: "Record the problem to solve, the rooms or services affected and what a useful outcome would look like. Keep the scope product and brand neutral until site conditions, safety, permissions and suitable trade capability are confirmed.",
      href: "/guides/project-preparation",
      action: "Review project preparation guidance",
    };
  }
  return null;
}

function propertyContextRecommendation(
  propertyContext,
  selectedGoals,
  selectedServices,
) {
  const context = propertyContext && typeof propertyContext === "object"
    ? propertyContext
    : {};
  const fields = [
    ["propertyType", customerProjectOptions.propertyTypes],
    ["storeys", customerProjectOptions.storeys],
    ["floorArea", customerProjectOptions.floorAreas],
    ["occupants", customerProjectOptions.occupants],
    ["sharedWalls", customerProjectOptions.sharedWalls],
    ["ageBand", customerProjectOptions.ageBands],
    ["roofType", customerProjectOptions.roofTypes],
    ["roofColour", customerProjectOptions.roofColours],
    ["roofForm", customerProjectOptions.roofForms],
    ["roofCondition", customerProjectOptions.roofConditions],
    ["switchboard", customerProjectOptions.switchboards],
    ["wallConstruction", customerProjectOptions.wallConstructions],
    ["floorConstruction", customerProjectOptions.floorConstructions],
  ];
  if (!fields.some(([key]) => typeof context[key] === "string" && context[key])) {
    return null;
  }
  const recorded = fields
    .filter(([key]) => typeof context[key] === "string" && context[key])
    .map(([key, options]) => label(options, context[key]));
  const electricalWork = selectedGoals.some((goal) =>
    ["move-from-gas", "add-solar-storage", "replace-now"].includes(goal))
    || selectedServices.some((category) =>
      ["solar", "battery", "heating-cooling", "hot-water", "ev-charging"]
        .includes(category));
  const roofWork = selectedGoals.includes("add-solar-storage")
    || selectedServices.some((category) =>
      ["solar", "insulation"].includes(category));
  const establishedContextKeys = new Set([
    "propertyType",
    "storeys",
    "ageBand",
    "floorArea",
    "roofType",
    "roofColour",
    "roofForm",
    "roofCondition",
    "switchboard",
    "wallConstruction",
    "floorConstruction",
  ]);
  const unknownFields = fields
    .filter(([key]) => (
      context[key] === "not_sure"
      || (establishedContextKeys.has(key) && !context[key])
    ))
    .map(([key]) => ({
      propertyType: "home type",
      storeys: "home height",
      floorArea: "floor area",
      occupants: "household size",
      sharedWalls: "shared walls",
      ageBand: "home age",
      roofType: "roof covering",
      roofColour: "roof colour",
      roofForm: "roof form",
      roofCondition: "roof condition",
      switchboard: "switchboard type",
      wallConstruction: "external wall construction",
      floorConstruction: "floor construction",
    })[key]);
  let title = "Use the home basics to confirm access, scale and enabling work";
  let stage = "Check the scope before quoting";
  const notes = [];
  if (context.switchboard === "older_fuses" && electricalWork) {
    title = "Check electrical enabling work before equipment quotes";
    stage = "Confirm electrical capacity early";
    notes.push(
      "Because an older fuse board was recorded, ask a licensed electrician to confirm capacity and protective devices before electrical equipment, solar, storage or charging work is priced.",
    );
  } else if (
    (context.switchboard === "not_sure" || !context.switchboard)
    && electricalWork
  ) {
    title = "Confirm the switchboard before electrical upgrades are priced";
    notes.push(
      "Use a safe front-on photo or an existing record so a licensed electrician can confirm the electrical checks and possible enabling work.",
    );
  }
  if ((context.roofType === "not_sure" || !context.roofType) && roofWork) {
    if (title === "Use the home basics to confirm access, scale and enabling work") {
      title = "Confirm the roof before solar or roof-insulation quotes";
    }
    notes.push(
      "Confirm the main roof covering, condition and safe access before roof-mounted solar or roof-insulation work is scoped.",
    );
  } else if (roofWork && context.roofType && context.roofType !== "not_sure") {
    notes.push(
      "The recorded roof covering changes mounting, access and condition questions for solar or roof-insulation work.",
    );
  }
  if (context.roofCondition === "known_issue" && roofWork) {
    title = "Resolve the known roof issue before roof-mounted work";
    stage = "Check the building condition first";
    notes.push(
      "A suitably qualified roof professional should assess the reported leak, damage or condition issue before solar, insulation or other roof-mounted work is designed or priced.",
    );
  } else if (context.roofCondition === "weathered" && roofWork) {
    notes.push(
      "Ask the relevant roof or solar professional to confirm remaining roof condition and any maintenance that should happen before roof-mounted work.",
    );
  }
  if (context.roofColour && context.roofColour !== "not_sure") {
    notes.push(
      "Roof colour can influence summer heat gain, but it should be considered with insulation, roof form, shade, ventilation and local climate rather than used alone.",
    );
  }
  if (context.roofForm && context.roofForm !== "not_sure" && roofWork) {
    notes.push(
      "The recorded roof form helps the relevant professional plan access, mounting, drainage, usable area and any roof-space limitations.",
    );
  }
  if (["pre_1960", "1960_1999"].includes(context.ageBand)) {
    notes.push(
      "Use the recorded age only to prompt checks of the actual construction and services. It does not prove what insulation, wiring or other materials are present.",
    );
  }
  if (
    ["two", "three_plus"].includes(context.storeys)
    || ["200_299", "300_plus"].includes(context.floorArea)
  ) {
    notes.push(
      "Height and floor area can change safe access, zoning and site-specific sizing questions.",
    );
  }
  if (["townhouse", "apartment"].includes(context.propertyType)) {
    notes.push(
      "Treat walls facing outdoors separately from party walls shared with neighbouring dwellings when checking insulation and permissions.",
    );
  }
  if (["one_side", "two_plus_sides"].includes(context.sharedWalls)) {
    notes.push(
      "The recorded shared walls are not external heat-loss surfaces. Confirm the remaining external wall construction before insulation work is scoped.",
    );
  }
  if (context.wallConstruction && context.wallConstruction !== "not_sure") {
    notes.push(
      "Use the reported external wall construction to guide a site check. It does not by itself prove whether insulation is present or continuous.",
    );
  }
  if (context.floorConstruction === "slab_on_ground") {
    notes.push(
      "A slab-on-ground floor changes the available underfloor improvement path, so underfloor insulation should not be assumed to be accessible or applicable.",
    );
  } else if (
    context.floorConstruction
    && context.floorConstruction !== "not_sure"
  ) {
    notes.push(
      "The reported floor construction helps an assessor decide whether safe underfloor inspection or a different insulation approach is relevant.",
    );
  }
  if (context.occupants && context.occupants !== "not_sure") {
    notes.push(
      "Household size helps frame hot-water demand and occupied-zone needs, but actual routines and usage still need confirmation before sizing equipment.",
    );
  }
  if (!notes.length) {
    notes.push(
      "Home height and floor area provide broad scale. Home age, construction, roof details and switchboard type guide the checks needed before fixed work.",
    );
  }
  if (unknownFields.length) {
    notes.push(
      `Where they affect the selected work, the relevant assessor or licensed trade should verify ${unknownFields.join(", ")} during the site check. The household does not need to enter a roof space, crawl under the home, remove an electrical cover or guess.`,
    );
  }
  return {
    id: "home-planning-context",
    stage,
    title,
    text: `Recorded planning context: ${recorded.join(", ")}. ${notes.join(" ")}`,
    href: "/guides/project-preparation",
    action: "Review how home details affect the scope",
  };
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
  serviceCategories: selectedServices,
  budgetRange,
  propertyContext,
  advisorProfile,
}) {
  const plannerFeatures = features.filter((item) => legacyPlannerFeatures.has(item));
  if (
    includesAny(features, gasHotWaterFeatures)
    && !plannerFeatures.includes("gas-hot-water")
  ) {
    plannerFeatures.push("gas-hot-water");
  }
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
  const workLabelsByItem = {};
  const addContext = (item) => {
    if (item && !contextual.some((existing) => existing.id === item.id)) contextual.push(item);
  };
  addContext(
    propertyContextRecommendation(
      propertyContext,
      selectedGoals,
      selectedServices,
    ),
  );
  addContext(
    electricalSupplyRecommendationFor(
      features,
      selectedGoals,
      selectedServices,
    ),
  );
  const gasHotWaterRecommendation = gasHotWaterRecommendationFor(features);
  if (gasHotWaterRecommendation) {
    pull("hot-water");
    addContext(gasHotWaterRecommendation);
  }
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
      "open-fixed-wall-vents",
      "open-unused-chimney",
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
  if (features.includes("hydronic-heating")) {
    pull("heating");
    addContext(advisorRecommendations.hydronicHeating);
  }
  if (features.includes("wood-heating")) {
    pull("heating");
    addContext(advisorRecommendations.woodHeating);
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
  for (const category of selectedServices) {
    const recommendation = serviceCategoryRecommendation(category);
    if (!recommendation) continue;
    pull(recommendation.id);
    addContext(recommendation);
    const workLabel = label(customerProjectOptions.serviceCategories, category);
    workLabelsByItem[recommendation.id] = [
      ...new Set([
        ...(workLabelsByItem[recommendation.id] || []),
        workLabel,
      ]),
    ];
  }
  if (budgetRange === "under_2k") addContext(advisorRecommendations.lowBudget);
  if (budgetRange === "2_10k") addContext(advisorRecommendations.mediumBudget);
  if (budgetRange === "10k_plus") addContext(advisorRecommendations.largerBudget);
  const climateOrder = roomComfort.daytimeHeat
    ? [
        "home-planning-context",
        "electrical-supply-check",
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
          "home-planning-context",
          "electrical-supply-check",
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
        "home-planning-context",
        "electrical-supply-check",
        "climate-sequence",
        "room-comfort-profile",
        "moisture-ventilation",
        "window-shading",
        "windows-glazing",
        "draught-proofing",
        "insulation-review",
      ]
    : [
        "home-planning-context",
        "electrical-supply-check",
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
    workLabelsByItem,
  });
  const nextQuestions = createNextBestQuestions({
    items,
    factEvidence: advisorProfile.factEvidence,
    homeFeatures: features,
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
  const everydayActions = createEverydayActions({
    selectedGoals,
    situation,
    features,
    budgetRange,
    advisorProfile,
  });
  return {
    version: CUSTOMER_PLAN_VERSION,
    goal: selectedGoals[0] || "",
    goals: selectedGoals,
    pace,
    situation,
    approvalContext,
    features,
    serviceCategories: selectedServices,
    propertyContext: {
      ...(propertyContext.propertyType
        ? { propertyType: propertyContext.propertyType }
        : {}),
      storeys: propertyContext.storeys,
      floorArea: propertyContext.floorArea,
      ...(propertyContext.occupants
        ? { occupants: propertyContext.occupants }
        : {}),
      ...(propertyContext.sharedWalls
        ? { sharedWalls: propertyContext.sharedWalls }
        : {}),
      ageBand: propertyContext.ageBand,
      roofType: propertyContext.roofType,
      ...(propertyContext.roofColour
        ? { roofColour: propertyContext.roofColour }
        : {}),
      ...(propertyContext.roofForm
        ? { roofForm: propertyContext.roofForm }
        : {}),
      ...(propertyContext.roofCondition
        ? { roofCondition: propertyContext.roofCondition }
        : {}),
      switchboard: propertyContext.switchboard,
      ...(propertyContext.wallConstruction
        ? { wallConstruction: propertyContext.wallConstruction }
        : {}),
      ...(propertyContext.floorConstruction
        ? { floorConstruction: propertyContext.floorConstruction }
        : {}),
    },
    title,
    summary: `This is ${paceLabel}. It is independent guidance, not a product endorsement, quote or savings promise.`,
    everydayActions,
    everydayActionsBoundary: CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY,
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
  const selectedServices = normaliseServiceCategories(input.serviceCategories);
  const propertyContext = buildInstallerPropertyContext({
    ...(input.propertyContext && typeof input.propertyContext === "object"
      ? input.propertyContext
      : {}),
    propertyType: input.propertyContext?.propertyType ?? input.propertyType,
    storeys: input.propertyContext?.storeys ?? input.storeys,
    floorArea: input.propertyContext?.floorArea ?? input.floorArea,
    occupants:
      input.propertyContext?.occupants
      ?? input.occupants
      ?? input.householdSize,
    sharedWalls:
      input.propertyContext?.sharedWalls
      ?? input.sharedWalls
      ?? input.dwellingConnection,
    approvalContext,
  });
  const budgetRange = budgets.has(input.budgetRange) ? input.budgetRange : "not_set";
  const baseAdvisorProfile = normalizeCustomerAdvisorProfile(input.advisorProfile, {
    postcode: input.postcode,
    addressState: input.addressState,
    householdSituation: situation,
    approvalContext,
    homeFeatures: features,
    propertyContext,
  });
  const generatedPlan = createAdvisorPlan({
    selectedGoals,
    pace,
    situation,
    approvalContext,
    features,
    serviceCategories: selectedServices,
    budgetRange,
    propertyContext,
    advisorProfile: baseAdvisorProfile,
  });
  const snapshot = normalisePlanSnapshot(input.planSnapshot, generatedPlan);
  const advisorProfile = normalizeCustomerAdvisorProfile(baseAdvisorProfile, {
    postcode: input.postcode,
    addressState: input.addressState,
    householdSituation: situation,
    approvalContext,
    homeFeatures: features,
    propertyContext,
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
        "home-planning-context",
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
  const professionalReviewValidation = validateCustomerProfessionalReview(
    raw.advisorProfile?.professionalReview,
  );
  if (!professionalReviewValidation.ok) {
    return { ok: false, error: professionalReviewValidation.error };
  }
  const preparedPlan = prepareCustomerProjectPlan({
    goals: selectedGoals,
    pace: safePace,
    situation: householdSituation,
    approvalContext: propertyContext.approvalContext,
    features: existingFeatures,
    serviceCategories: raw.serviceCategories,
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
    priorities: selectedGoals.length
      ? deriveCustomerProjectPriorities(selectedGoals)
      : list(raw.priorities, priorities, 6),
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
  const selectedGoals = Array.isArray(project.goals)
    ? project.goals.filter(Boolean)
    : project.goal
      ? [project.goal]
      : [];
  const goalLabels = selectedGoals.map((item) => label(customerProjectOptions.goals, item));
  const goalSummary = goalLabels.length ? goalLabels.join(", ").toLowerCase() : "not selected";
  const propertyLabel = label(customerProjectOptions.propertyTypes, project.propertyType, "Home");
  const stageLabel = label(customerProjectOptions.stages, project.projectStage, "Planning");
  const paceLabel = project.pace === "whole-home" ? "coordinated whole-home" : project.pace === "one-step" ? "single next-step" : "staged";
  const context = project.propertyContext || {};
  const propertyFacts = [
    label(customerProjectOptions.storeys, context.storeys, "Storeys not confirmed"),
    label(customerProjectOptions.ageBands, context.ageBand, "Age not confirmed"),
    label(customerProjectOptions.floorAreas, context.floorArea, "Floor area not confirmed"),
    label(customerProjectOptions.roofTypes, context.roofType, "Roof not confirmed"),
    ...(context.roofColour
      ? [label(customerProjectOptions.roofColours, context.roofColour)]
      : []),
    ...(context.roofForm
      ? [label(customerProjectOptions.roofForms, context.roofForm)]
      : []),
    ...(context.roofCondition
      ? [label(customerProjectOptions.roofConditions, context.roofCondition)]
      : []),
    label(customerProjectOptions.switchboards, context.switchboard, "Switchboard not confirmed"),
    ...(context.wallConstruction
      ? [label(customerProjectOptions.wallConstructions, context.wallConstruction)]
      : []),
    ...(context.floorConstruction
      ? [label(customerProjectOptions.floorConstructions, context.floorConstruction)]
      : []),
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
    summary: `${propertyLabel} household seeking ${categorySummary}. Property context: ${propertyFacts.join(", ").toLowerCase()}${siteConsiderations ? `. Site considerations: ${siteConsiderations.toLowerCase()}` : ""}. Goals: ${goalSummary}. Advisor planning context: ${advisorContext}. The household is following a ${paceLabel} plan. Identity, contact details, street and unit address, private notes and usage records are withheld. Any customer-approved photos and documents are provided separately to allocated verified installers for quoting guidance. Respond only through the structured platform workflow.`,
    sourceReference: `customer-project:${projectId}`,
  };
}

function normalizePropertyType(value) {
  if (propertyTypes.has(value)) return value;
  return new Map([
    ["detached", "house"],
    ["detached_house", "house"],
    ["attached", "townhouse"],
    ["semi_detached", "townhouse"],
    ["duplex", "townhouse"],
    ["villa", "townhouse"],
    ["terrace", "townhouse"],
    ["unit", "apartment"],
  ]).get(value) || "";
}

function normalizeStoreys(value) {
  if (storeys.has(value)) return value;
  return new Map([
    ["1", "single"],
    ["one", "single"],
    ["one_storey", "single"],
    ["2", "two"],
    ["two_storey", "two"],
    ["3", "three_plus"],
    ["three", "three_plus"],
    ["3_plus", "three_plus"],
  ]).get(String(value || "").toLowerCase()) || "";
}

function normalizeFloorArea(value) {
  if (floorAreas.has(value)) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  if (numeric < 100) return "under_100";
  if (numeric < 200) return "100_199";
  if (numeric < 300) return "200_299";
  return "300_plus";
}

function normalizeOccupants(value) {
  if (occupants.has(value)) return value;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return "";
  if (numeric === 1) return "one";
  if (numeric === 2) return "two";
  if (numeric <= 4) return "three_four";
  return "five_plus";
}

function normalizeSharedWalls(value) {
  if (sharedWalls.has(value)) return value;
  return new Map([
    ["detached", "none"],
    ["one", "one_side"],
    ["one_shared_side", "one_side"],
    ["multiple", "two_plus_sides"],
    ["two_plus", "two_plus_sides"],
    ["multiple_shared_sides", "two_plus_sides"],
    ["apartment_unit", "two_plus_sides"],
  ]).get(value) || "";
}

export function buildInstallerPropertyContext(value = {}) {
  const supplied = value && typeof value === "object" ? value : {};
  const propertyType = normalizePropertyType(supplied.propertyType);
  const occupantCount = normalizeOccupants(
    supplied.occupants ?? supplied.householdSize,
  );
  const sharedWallCount = normalizeSharedWalls(
    supplied.sharedWalls ?? supplied.dwellingConnection,
  );
  return {
    ...(propertyType ? { propertyType } : {}),
    storeys: normalizeStoreys(supplied.storeys),
    ageBand: ageBands.has(supplied.ageBand) ? supplied.ageBand : "",
    floorArea: normalizeFloorArea(supplied.floorArea),
    ...(occupantCount ? { occupants: occupantCount } : {}),
    ...(sharedWallCount ? { sharedWalls: sharedWallCount } : {}),
    roofType: roofTypes.has(supplied.roofType) ? supplied.roofType : "",
    ...(roofColours.has(supplied.roofColour)
      ? { roofColour: supplied.roofColour }
      : {}),
    ...(roofForms.has(supplied.roofForm)
      ? { roofForm: supplied.roofForm }
      : {}),
    ...(roofConditions.has(supplied.roofCondition)
      ? { roofCondition: supplied.roofCondition }
      : {}),
    switchboard: switchboards.has(supplied.switchboard) ? supplied.switchboard : "",
    ...(wallConstructions.has(supplied.wallConstruction)
      ? { wallConstruction: supplied.wallConstruction }
      : {}),
    ...(floorConstructions.has(supplied.floorConstruction)
      ? { floorConstruction: supplied.floorConstruction }
      : {}),
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
