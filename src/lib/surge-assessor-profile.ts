import {
  HOME_ENERGY_PLANNER_CONSTRUCTION_QUESTIONS,
  HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  HOME_ENERGY_PLANNER_ELECTRICAL_QUESTIONS,
  HOME_ENERGY_PLANNER_FEATURE_SECTIONS,
  HOME_ENERGY_PLANNER_HOME_BASIC_QUESTIONS,
  HOME_ENERGY_PLANNER_OPTIONS,
  createHomeEnergyPlannerSession,
  homeEnergyPlannerCompletion,
  parseHomeEnergyPlannerSession,
  sanitizeHomeEnergyPlannerDraft,
  type HomeEnergyPlannerDraft,
  type HomeEnergyPlannerOption,
  type HomeEnergyPlannerQuestionBinding,
  type HomeEnergyPlannerSession,
} from "./home-energy-planner-schema.ts";
import { updateHomeFeatureSelection } from "./customer-projects.mjs";

export const SURGE_PROFILE_VERSION = 3 as const;

export type SurgeStarterProfile = {
  version: typeof SURGE_PROFILE_VERSION;
  postcode: string;
  situation: string;
  propertyType: string;
  approvalContext: string;
  occupants: string;
  goals: string[];
  pace: string;
  budgetRange: string;
  storeys: string;
  ageBand: string;
  floorArea: string;
  sharedWalls: string;
  roofType: string;
  roofColour: string;
  roofForm: string;
  roofCondition: string;
  switchboard: string;
  wallConstruction: string;
  floorConstruction: string;
  features: string[];
  timing: string;
  occupancyPattern: "mostly-home" | "mostly-away" | "mixed" | "weekends" | "not-sure";
  energyUsePattern: "morning" | "evening" | "all-day" | "overnight" | "varies" | "not-sure";
  billPressure: "comfortable" | "higher-than-expected" | "hard-to-manage" | "not-sure";
  gasConnection: "connected" | "not-connected" | "disconnecting" | "not-sure";
  disruption: "minimal" | "some-work" | "major-work" | "staged" | "not-sure";
  plannedWorks: "none" | "maintenance" | "renovation" | "equipment-replacement" | "solar-battery" | "new-build" | "not-sure";
  reviewed: string[];
  completed: boolean;
};

export type SurgeProfileValueKey = Exclude<keyof SurgeStarterProfile, "version" | "reviewed" | "completed">;
export type SurgeProfileFieldKey = SurgeProfileValueKey;

export type SurgeProfileField = {
  id: string;
  key: SurgeProfileValueKey;
  label: string;
  shortLabel: string;
  kind: "postcode" | "select" | "multiselect";
  hint?: string;
  options?: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  unknownValue?: string;
  noneValue?: string;
  plannerQuestionId?: string;
};

export type SurgeProfileStep = {
  id: string;
  title: string;
  description: string;
  fields: ReadonlyArray<SurgeProfileField>;
};

const NOT_SURE = { value: "not-sure", label: "Not sure yet" } as const;

const optionRecords = (options: HomeEnergyPlannerOption[]) =>
  options.map(([value, label]) => ({ value, label }));

const directQuestion = (id: string) => {
  const question = HOME_ENERGY_PLANNER_DIRECT_QUESTIONS.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`Missing canonical home energy planner question: ${id}`);
  return question;
};

const plannerField = (
  question: HomeEnergyPlannerQuestionBinding,
  shortLabel = question.label,
): SurgeProfileField => ({
  id: question.id,
  key: question.draftKey as SurgeProfileValueKey,
  label: question.label,
  shortLabel,
  kind: question.kind,
  hint: question.help || undefined,
  options: optionRecords(question.options),
  unknownValue: question.unknownValue,
  noneValue: question.noneValue,
  plannerQuestionId: question.featureQuestionId,
});

const propertyField = (id: string, shortLabel?: string) => plannerField(directQuestion(id), shortLabel);

const supplementalField = (
  key: SurgeProfileValueKey,
  label: string,
  shortLabel: string,
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>,
  hint?: string,
): SurgeProfileField => ({ id: `supplemental:${key}`, key, label, shortLabel, kind: "select", options, hint, unknownValue: "not-sure" });

const canonicalFeatureSteps: SurgeProfileStep[] = HOME_ENERGY_PLANNER_FEATURE_SECTIONS.map((section) => ({
  id: `planner:${section.id}`,
  title: section.title,
  description: section.description,
  fields: section.questions.map((question) => plannerField({
    id: `feature:${question.id}`,
    draftKey: "features",
    label: question.label,
    help: question.help,
    kind: question.mode === "multiple" ? "multiselect" : "select",
    options: question.options,
    unknownValue: question.unknownValue,
    noneValue: question.noneValue,
    featureQuestionId: question.id,
  })),
}));

export const SURGE_PROFILE_STEPS: ReadonlyArray<SurgeProfileStep> = [
  {
    id: "place-household",
    title: "Location and household",
    description: "Start with the people and place. These details shape climate, assistance and everyday energy use.",
    fields: [
      plannerField(directQuestion("postcode"), "Postcode"),
      plannerField(directQuestion("situation"), "Relationship"),
      plannerField(directQuestion("occupants"), "Household"),
      supplementalField("occupancyPattern", "When is the home usually occupied?", "Occupancy", [
        { value: "mostly-home", label: "Someone is home most days" },
        { value: "mostly-away", label: "Mostly empty on weekdays" },
        { value: "mixed", label: "It changes through the week" },
        { value: "weekends", label: "Mostly used on weekends" },
        NOT_SURE,
      ]),
    ],
  },
  {
    id: "home-basics",
    title: "The home",
    description: "Basic size and ownership details help Surge AI avoid advice that does not suit the property.",
    fields: [
      plannerField(directQuestion("propertyType"), "Home"),
      plannerField(directQuestion("approvalContext"), "Approvals"),
      ...HOME_ENERGY_PLANNER_HOME_BASIC_QUESTIONS.map((question) => propertyField(question.key)),
    ],
  },
  {
    id: "construction-electrical",
    title: "Construction and electrical clues",
    description: "Add only what you safely know. Do not open electrical covers or enter a roof space.",
    fields: [
      ...HOME_ENERGY_PLANNER_CONSTRUCTION_QUESTIONS.map((question) => propertyField(question.key)),
      ...HOME_ENERGY_PLANNER_ELECTRICAL_QUESTIONS.map((question) => propertyField(question.key)),
    ],
  },
  {
    id: "goals-plan",
    title: "Goals and starting plan",
    description: "Tell Surge AI what matters and how you would prefer to approach improvements.",
    fields: [
      plannerField(directQuestion("goals"), "Priorities"),
      plannerField(directQuestion("pace"), "Approach"),
      plannerField(directQuestion("budgetRange"), "Budget"),
      {
        id: "supplemental:timing",
        key: "timing",
        label: "When would you like to act?",
        shortLabel: "Timing",
        kind: "select",
        options: optionRecords(HOME_ENERGY_PLANNER_OPTIONS.timings),
      },
    ],
  },
  ...canonicalFeatureSteps,
  {
    id: "routine-constraints",
    title: "Routines and practical limits",
    description: "Finish with everyday use and the amount of disruption that feels realistic.",
    fields: [
      supplementalField("energyUsePattern", "When is most energy used?", "Use pattern", [
        { value: "morning", label: "Mostly mornings" },
        { value: "evening", label: "Mostly late afternoon and evening" },
        { value: "all-day", label: "Steady use through the day" },
        { value: "overnight", label: "A lot of overnight use" },
        { value: "varies", label: "It changes a lot" },
        NOT_SURE,
      ]),
      supplementalField("billPressure", "How do energy bills feel?", "Bills", [
        { value: "comfortable", label: "Generally manageable" },
        { value: "higher-than-expected", label: "Higher than expected" },
        { value: "hard-to-manage", label: "Hard to manage" },
        NOT_SURE,
      ]),
      supplementalField("gasConnection", "Gas connection", "Gas", [
        { value: "connected", label: "Connected to gas" },
        { value: "not-connected", label: "No gas connection" },
        { value: "disconnecting", label: "Planning to disconnect gas" },
        NOT_SURE,
      ]),
      supplementalField("disruption", "How much installation disruption is acceptable?", "Disruption", [
        { value: "minimal", label: "Keep disruption minimal" },
        { value: "some-work", label: "Some building work is acceptable" },
        { value: "major-work", label: "Major work is acceptable for the right result" },
        { value: "staged", label: "Prefer work in stages" },
        NOT_SURE,
      ]),
      supplementalField("plannedWorks", "Other work already planned", "Planned work", [
        { value: "none", label: "No other work planned" },
        { value: "maintenance", label: "General repairs or maintenance" },
        { value: "renovation", label: "Renovation or extension" },
        { value: "equipment-replacement", label: "Replacing major equipment" },
        { value: "solar-battery", label: "Solar or battery work" },
        { value: "new-build", label: "New build or major rebuild" },
        NOT_SURE,
      ]),
    ],
  },
] as const;

export const SURGE_PROFILE_FIELDS = SURGE_PROFILE_STEPS.flatMap((step) => step.fields);

export const EMPTY_SURGE_STARTER_PROFILE: SurgeStarterProfile = {
  version: SURGE_PROFILE_VERSION,
  postcode: "",
  situation: "",
  propertyType: "",
  approvalContext: "",
  occupants: "",
  goals: [],
  pace: "",
  budgetRange: "",
  storeys: "",
  ageBand: "",
  floorArea: "",
  sharedWalls: "",
  roofType: "",
  roofColour: "",
  roofForm: "",
  roofCondition: "",
  switchboard: "",
  wallConstruction: "",
  floorConstruction: "",
  features: [],
  timing: "",
  occupancyPattern: "not-sure",
  energyUsePattern: "not-sure",
  billPressure: "not-sure",
  gasConnection: "not-sure",
  disruption: "not-sure",
  plannedWorks: "not-sure",
  reviewed: [],
  completed: false,
};

const fieldById = new Map(SURGE_PROFILE_FIELDS.map((field) => [field.id, field]));
const allowedFieldIds = new Set(fieldById.keys());

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionValue(field: SurgeProfileField, value: unknown) {
  return typeof value === "string" && field.options?.some((option) => option.value === value)
    ? value
    : "";
}

function directPlannerValue(key: SurgeProfileValueKey, value: unknown) {
  const field = SURGE_PROFILE_FIELDS.find((candidate) => candidate.key === key && !candidate.plannerQuestionId);
  return field ? optionValue(field, value) : "";
}

const uniqueStrings = (value: unknown, allowed?: Set<string>) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string =>
      typeof item === "string" && (!allowed || allowed.has(item))))]
  : [];

function legacyFeatureSelections(source: Record<string, unknown>) {
  let features: string[] = [];
  const set = (questionId: string, values: string[]) => {
    for (const value of values) features = updateHomeFeatureSelection(features, questionId, value, true);
  };
  const comfort: Record<string, string[]> = {
    comfortable: ["comfort-none"],
    "winter-cold": ["comfort-too-cold"],
    "summer-hot": ["comfort-too-hot"],
    "hot-and-cold": ["comfort-too-hot", "comfort-too-cold"],
    "room-specific": ["comfort-unknown"],
  };
  const insulation: Record<string, string> = {
    "none-known": "ceiling-insulation-none",
    "old-patchy": "ceiling-insulation-limited",
    "well-insulated": "ceiling-insulation-well",
    "another-dwelling": "ceiling-insulation-not-applicable",
  };
  const glazing: Record<string, string> = {
    "mostly-single": "single-glazing",
    mixed: "mixed-glazing",
    "mostly-double": "double-glazing",
  };
  const hotWater: Record<string, string> = {
    "gas-storage": "gas-storage-hot-water",
    "gas-instant": "gas-continuous-flow-hot-water",
    "electric-storage": "electric-storage-hot-water",
    "heat-pump": "heat-pump-hot-water",
    solar: "solar-hot-water",
    other: "hot-water-other",
  };
  const cooking: Record<string, string> = {
    gas: "gas-cooking",
    "standard-electric": "electric-resistance-cooking",
    induction: "induction-cooking",
    mixed: "mixed-cooking",
  };
  if (typeof source.comfortIssue === "string" && comfort[source.comfortIssue]) set("comfort-concerns", comfort[source.comfortIssue]);
  if (source.draughts === "noticeable") set("comfort-concerns", ["draughty"]);
  if (source.moisture === "condensation" || source.moisture === "damp-mould") set("comfort-concerns", ["condensation-moisture"]);
  if (typeof source.insulation === "string" && insulation[source.insulation]) set("ceiling-insulation", [insulation[source.insulation]]);
  if (typeof source.glazing === "string" && glazing[source.glazing]) set("glazing", [glazing[source.glazing]]);
  const heatingLegacy: Record<string, string[]> = {
    gas: ["gas-heating"],
    "evaporative-gas": ["gas-heating", "evaporative-cooling"],
    resistance: ["electric-resistance-heating"],
    none: ["heating-cooling-none"],
    "not-sure": ["heating-cooling-unknown"],
  };
  const heating = Array.isArray(source.heatingCooling)
    ? source.heatingCooling.filter((item): item is string => typeof item === "string")
    : typeof source.heatingCooling === "string"
      ? heatingLegacy[source.heatingCooling] || []
      : [];
  set("heating-cooling-systems", heating);
  if (typeof source.hotWater === "string" && hotWater[source.hotWater]) set("hot-water", [hotWater[source.hotWater]]);
  if (typeof source.cooking === "string" && cooking[source.cooking]) set("cooking", [cooking[source.cooking]]);
  if (source.solar === "installed") set("solar", ["solar"]);
  if (source.solar === "none") set("solar", ["solar-none"]);
  if (source.battery === "installed") set("battery", ["battery"]);
  if (source.battery === "none") set("battery", ["battery-none"]);
  if (["owned-charging", "owned-no-charger", "planned"].includes(String(source.electricVehicle))) set("ev", ["ev"]);
  if (source.electricVehicle === "none") set("ev", ["ev-none"]);
  const supply: Record<string, string> = {
    "single-phase": "electrical-supply-single-phase",
    "two-phase": "electrical-supply-two-phase",
    "three-phase": "electrical-supply-three-phase",
  };
  if (typeof source.electricalSupply === "string" && supply[source.electricalSupply]) set("electrical-supply", [supply[source.electricalSupply]]);
  return features;
}

function migrateLegacyProfile(source: Record<string, unknown>): SurgeStarterProfile {
  const next = { ...EMPTY_SURGE_STARTER_PROFILE };
  const relationship: Record<string, string> = { "owner-occupier": "owner", renter: "renter" };
  const household: Record<string, string> = { one: "one", two: "two", "three-four": "three_four", "five-plus": "five_plus" };
  const home: Record<string, string> = { "detached-house": "house", townhouse: "townhouse", "apartment-unit": "apartment", "rural-home": "rural" };
  const age: Record<string, string> = { "pre-1960": "pre_1960", "1960-1999": "1960_1999", "2000-2014": "2000_2014", "2015-plus": "2015_plus" };
  const storeys: Record<string, string> = { one: "single", two: "two", "three-plus": "three_plus" };
  const floorArea: Record<string, string> = { "under-100": "under_100", "100-199": "100_199", "200-299": "200_299", "300-plus": "300_plus" };
  const approval: Record<string, string> = { "none-known": "none", strata: "strata" };
  const priority: Record<string, string> = {
    "lower-bills": "lower-bills", comfort: "improve-comfort", "healthy-home": "healthier-home",
    electrify: "move-from-gas", "solar-storage": "add-solar-storage", resilience: "improve-resilience",
    "replace-equipment": "replace-now",
  };
  const postcode = typeof source.postcode === "string" ? source.postcode.replace(/\D/g, "").slice(0, 4) : "";
  if (/^\d{4}$/.test(postcode)) next.postcode = postcode;
  next.situation = relationship[String(source.relationship)] || "";
  next.occupants = household[String(source.householdSize)] || "";
  next.propertyType = home[String(source.homeType)] || "";
  next.ageBand = age[String(source.homeAge)] || "";
  next.storeys = storeys[String(source.storeys)] || "";
  next.floorArea = floorArea[String(source.floorArea)] || "";
  next.approvalContext = approval[String(source.approvalConstraint)] || "";
  next.goals = priority[String(source.priority)] ? [priority[String(source.priority)]] : [];
  next.pace = source.budget === "staged" || source.disruption === "staged" ? "staged" : "";
  next.switchboard = ({
    "modern-breakers": "modern_breakers", "older-fuses": "older_fuses", "recent-upgrade": "recent_upgrade",
  } as Record<string, string>)[String(source.switchboard)] || "";
  next.features = legacyFeatureSelections(source);
  for (const key of ["occupancyPattern", "energyUsePattern", "billPressure", "gasConnection", "disruption", "plannedWorks"] as const) {
    const field = SURGE_PROFILE_FIELDS.find((candidate) => candidate.key === key);
    const selected = field ? optionValue(field, source[key]) : "";
    if (selected) (next as Record<string, unknown>)[key] = selected;
  }
  const timing: Record<string, string> = { researching: "planning", "three-months": "within_3_months", now: "within_30_days" };
  next.timing = timing[String(source.timing)] || "";
  const reviewed = new Set<string>();
  for (const field of SURGE_PROFILE_FIELDS) {
    const value = surgeProfileFieldValue(next, field);
    if ((Array.isArray(value) && value.length) || (typeof value === "string" && value && value !== "not-sure")) reviewed.add(field.id);
  }
  next.reviewed = [...reviewed];
  next.completed = true;
  return next;
}

export function parseSurgeStarterProfile(value: unknown): SurgeStarterProfile {
  const source = record(value);
  if (!source) return { ...EMPTY_SURGE_STARTER_PROFILE };
  if (source.version !== SURGE_PROFILE_VERSION) {
    return source.completed === true ? migrateLegacyProfile(source) : { ...EMPTY_SURGE_STARTER_PROFILE };
  }
  const next = { ...EMPTY_SURGE_STARTER_PROFILE };
  const postcode = typeof source.postcode === "string" ? source.postcode.replace(/\D/g, "").slice(0, 4) : "";
  next.postcode = /^\d{4}$/.test(postcode) ? postcode : "";
  for (const key of [
    "situation", "propertyType", "approvalContext", "occupants", "pace", "budgetRange",
    "storeys", "ageBand", "floorArea", "sharedWalls", "roofType", "roofColour", "roofForm",
    "roofCondition", "switchboard", "wallConstruction", "floorConstruction", "timing",
  ] as const) next[key] = directPlannerValue(key, source[key]);
  const goalValues = new Set(HOME_ENERGY_PLANNER_OPTIONS.goals.map(([value]) => value));
  next.goals = uniqueStrings(source.goals, goalValues).slice(0, HOME_ENERGY_PLANNER_OPTIONS.goals.length);
  const featureValues = new Set(HOME_ENERGY_PLANNER_FEATURE_SECTIONS.flatMap((section) =>
    section.questions.flatMap((question) => question.options.map(([option]) => option))));
  next.features = sanitizeHomeEnergyPlannerDraft({ features: uniqueStrings(source.features, featureValues) }).features;
  for (const key of ["occupancyPattern", "energyUsePattern", "billPressure", "gasConnection", "disruption", "plannedWorks"] as const) {
    const field = SURGE_PROFILE_FIELDS.find((candidate) => candidate.key === key);
    const selected = field ? optionValue(field, source[key]) : "";
    if (selected) (next as Record<string, unknown>)[key] = selected;
  }
  next.reviewed = uniqueStrings(source.reviewed, allowedFieldIds).slice(0, SURGE_PROFILE_FIELDS.length);
  next.completed = source.completed === true || next.reviewed.length === SURGE_PROFILE_FIELDS.length;
  return next;
}

export function surgeProfileFieldValue(profile: SurgeStarterProfile, field: SurgeProfileField) {
  if (!field.plannerQuestionId) return profile[field.key] as string | string[];
  const allowed = new Set(field.options?.map((option) => option.value) || []);
  const selected = profile.features.filter((value) => allowed.has(value));
  return field.kind === "multiselect" ? selected : selected[0] || "";
}

export function surgeProfileFieldWasReviewed(profile: SurgeStarterProfile, field: SurgeProfileField | string) {
  const id = typeof field === "string" ? field : field.id;
  return profile.reviewed.includes(id);
}

export function updateSurgeProfileField(
  profile: SurgeStarterProfile,
  fieldOrId: SurgeProfileField | string,
  value: string,
  checked = true,
) {
  const field = typeof fieldOrId === "string" ? fieldById.get(fieldOrId) : fieldOrId;
  if (!field) return profile;
  const reviewed = profile.reviewed.includes(field.id) ? profile.reviewed : [...profile.reviewed, field.id];
  if (field.kind === "postcode") return { ...profile, postcode: value.replace(/\D/g, "").slice(0, 4), reviewed };
  if (field.plannerQuestionId) {
    return { ...profile, features: updateHomeFeatureSelection(profile.features, field.plannerQuestionId, value, checked), reviewed };
  }
  if (field.kind === "multiselect") {
    const current = Array.isArray(profile[field.key]) ? profile[field.key] as string[] : [];
    const next = checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
    return { ...profile, [field.key]: next, reviewed };
  }
  return { ...profile, [field.key]: optionValue(field, value), reviewed };
}

export function markSurgeProfileStepReviewed(profile: SurgeStarterProfile, step: SurgeProfileStep) {
  let next = profile;
  for (const field of step.fields) {
    if (surgeProfileFieldWasReviewed(next, field)) continue;
    const selected = surgeProfileFieldValue(next, field);
    if (field.plannerQuestionId && (!selected || (Array.isArray(selected) && !selected.length)) && field.unknownValue) {
      next = updateSurgeProfileField(next, field, field.unknownValue, true);
    } else {
      next = { ...next, reviewed: [...next.reviewed, field.id] };
    }
  }
  return next;
}

export function nextUnreviewedSurgeProfileStepIndex(
  profile: SurgeStarterProfile,
  currentStepIndex: number,
) {
  const orderedIndexes = [
    ...SURGE_PROFILE_STEPS.map((_, index) => index).filter((index) => index > currentStepIndex),
    ...SURGE_PROFILE_STEPS.map((_, index) => index).filter((index) => index <= currentStepIndex),
  ];
  return orderedIndexes.find((index) =>
    SURGE_PROFILE_STEPS[index].fields.some((field) => !surgeProfileFieldWasReviewed(profile, field))) ?? -1;
}

export function surgeProfileAnswerLabel(profile: SurgeStarterProfile, fieldOrId: SurgeProfileField | string) {
  const field = typeof fieldOrId === "string" ? fieldById.get(fieldOrId) : fieldOrId;
  if (!field) return "Not answered";
  if (!surgeProfileFieldWasReviewed(profile, field)) return "Not answered";
  const value = surgeProfileFieldValue(profile, field);
  if (field.kind === "postcode") return /^\d{4}$/.test(String(value)) ? String(value) : "Not sure or skipped";
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => field.options?.find((option) => option.value === item)?.label)
    .filter(Boolean).join(", ") || "Not sure or skipped";
}

export function surgeProfileFieldIsUnknown(profile: SurgeStarterProfile, fieldOrId: SurgeProfileField | string) {
  const field = typeof fieldOrId === "string" ? fieldById.get(fieldOrId) : fieldOrId;
  if (!field || !surgeProfileFieldWasReviewed(profile, field)) return true;
  const value = surgeProfileFieldValue(profile, field);
  if (field.kind === "postcode") return !/^\d{4}$/.test(String(value));
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return !values.length || values.includes("not-sure") || Boolean(field.unknownValue && values.includes(field.unknownValue));
}

export function surgeProfileKnownAnswerCount(profile: SurgeStarterProfile) {
  return SURGE_PROFILE_FIELDS.reduce((total, field) => total + Number(!surgeProfileFieldIsUnknown(profile, field)), 0);
}

export function surgeProfileReviewedAnswerCount(profile: SurgeStarterProfile) {
  return SURGE_PROFILE_FIELDS.reduce((total, field) => total + Number(surgeProfileFieldWasReviewed(profile, field)), 0);
}

export function surgeProfileToHomeEnergyPlannerDraft(profile: SurgeStarterProfile): HomeEnergyPlannerDraft {
  const direct: Partial<HomeEnergyPlannerDraft> = {};
  for (const field of SURGE_PROFILE_FIELDS) {
    if (!surgeProfileFieldWasReviewed(profile, field) || field.plannerQuestionId) continue;
    if (field.key === "features" || field.key === "timing") continue;
    if (["occupancyPattern", "energyUsePattern", "billPressure", "gasConnection", "disruption", "plannedWorks"].includes(field.key)) continue;
    (direct as Record<string, unknown>)[field.key] = surgeProfileFieldValue(profile, field);
  }
  let selectedFeatures: string[] = [];
  for (const field of SURGE_PROFILE_FIELDS.filter((candidate) => candidate.plannerQuestionId)) {
    if (!surgeProfileFieldWasReviewed(profile, field)) continue;
    const value = surgeProfileFieldValue(profile, field);
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const confirmed = values.length ? values : field.unknownValue ? [field.unknownValue] : [];
    for (const feature of confirmed) selectedFeatures = updateHomeFeatureSelection(selectedFeatures, field.plannerQuestionId!, feature, true);
  }
  return sanitizeHomeEnergyPlannerDraft({ ...direct, features: selectedFeatures });
}

export function surgeHomeEnergyPlannerSession(profile: SurgeStarterProfile) {
  return createHomeEnergyPlannerSession(surgeProfileToHomeEnergyPlannerDraft(profile));
}

export function surgeHomeEnergyPlannerCompletion(profile: SurgeStarterProfile) {
  return homeEnergyPlannerCompletion(surgeProfileToHomeEnergyPlannerDraft(profile));
}

export function mergeHomeEnergyPlannerSessionIntoSurgeProfile(profile: SurgeStarterProfile, sessionValue: unknown) {
  const session = parseHomeEnergyPlannerSession(sessionValue);
  if (!session || session.stage === 0) return profile;
  let next = profile;
  const reviewedFieldIds = new Set(profile.reviewed);
  const directStageOne = new Set([
    "postcode", "situation", "propertyType", "approvalContext", "occupants", "goals",
    ...HOME_ENERGY_PLANNER_HOME_BASIC_QUESTIONS.map((question) => question.key),
    ...HOME_ENERGY_PLANNER_CONSTRUCTION_QUESTIONS.map((question) => question.key),
    ...HOME_ENERGY_PLANNER_ELECTRICAL_QUESTIONS.map((question) => question.key),
  ]);
  for (const field of SURGE_PROFILE_FIELDS) {
    if (field.plannerQuestionId || !directStageOne.has(field.id) || reviewedFieldIds.has(field.id)) continue;
    const value = session.draft[field.key as keyof HomeEnergyPlannerDraft];
    if ((Array.isArray(value) && value.length) || (typeof value === "string" && value)) {
      next = Array.isArray(value)
        ? value.reduce((current, item) => updateSurgeProfileField(current, field, item, true), next)
        : updateSurgeProfileField(next, field, value, true);
    }
  }
  if (session.stage >= 4) {
    for (const id of ["pace", "budgetRange"]) {
      const field = fieldById.get(id);
      const value = session.draft[id as "pace" | "budgetRange"];
      if (field && value && !reviewedFieldIds.has(field.id)) {
        next = updateSurgeProfileField(next, field, value, true);
      }
    }
  }
  const allowedFeatureSections = session.stage >= 3
    ? HOME_ENERGY_PLANNER_FEATURE_SECTIONS
    : session.stage >= 2
      ? HOME_ENERGY_PLANNER_FEATURE_SECTIONS.filter((section) =>
          ["comfort", "insulation", "windows", "ventilation", "heating-cooling"].includes(section.id))
      : [];
  for (const question of allowedFeatureSections.flatMap((section) => section.questions)) {
    const field = fieldById.get(`feature:${question.id}`);
    if (!field || reviewedFieldIds.has(field.id)) continue;
    for (const [value] of question.options) {
      if (session.draft.features.includes(value)) next = updateSurgeProfileField(next, field, value, true);
    }
  }
  const plannerCompletion = homeEnergyPlannerCompletion(session.draft);
  if (session.stage >= 4 && plannerCompletion.completed === plannerCompletion.total && !next.completed) {
    next = { ...next, completed: true };
  }
  return next;
}

const PROFILE_CONTEXT_FIELD_ORDER = [
  "postcode", "situation", "goals", "budgetRange", "supplemental:timing", "approvalContext",
  "supplemental:disruption", "supplemental:plannedWorks", "occupants", "supplemental:occupancyPattern",
  "propertyType", "storeys", "ageBand", "floorArea", "sharedWalls", "switchboard",
  ...HOME_ENERGY_PLANNER_FEATURE_SECTIONS.flatMap((section) => section.questions.map((question) => `feature:${question.id}`)),
  "supplemental:gasConnection", "supplemental:energyUsePattern", "supplemental:billPressure",
] as const;

export function surgeStarterProfileContext(profile: SurgeStarterProfile) {
  const prefix = "Customer supplied home context: ";
  const suffix = ". Treat newer chat details as corrections.";
  const maximum = 1_050;
  const facts: string[] = [];
  let length = prefix.length + suffix.length;
  for (const id of PROFILE_CONTEXT_FIELD_ORDER) {
    const field = fieldById.get(id);
    if (!field || surgeProfileFieldIsUnknown(profile, field)) continue;
    const value = surgeProfileFieldValue(profile, field);
    const compact = Array.isArray(value) ? value.join(",") : value;
    const segment = `${id.replace(/^supplemental:/, "")}=${compact}`;
    const separatorLength = facts.length ? 2 : 0;
    if (length + separatorLength + segment.length > maximum) continue;
    facts.push(segment);
    length += separatorLength + segment.length;
  }
  return facts.length ? `${prefix}${facts.join("; ")}${suffix}` : "";
}

export type SurgePlannerProfileAdapter = {
  draft: HomeEnergyPlannerDraft;
  session: HomeEnergyPlannerSession;
  completion: ReturnType<typeof homeEnergyPlannerCompletion>;
};

export function surgePlannerProfileAdapter(profile: SurgeStarterProfile): SurgePlannerProfileAdapter {
  const draft = surgeProfileToHomeEnergyPlannerDraft(profile);
  return { draft, session: createHomeEnergyPlannerSession(draft), completion: homeEnergyPlannerCompletion(draft) };
}
