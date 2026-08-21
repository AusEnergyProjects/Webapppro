import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import {
  createCustomerProjectPlan,
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  customerProjectOptions as rawCustomerProjectOptions,
  normalizeHomeFeatureSelections,
  updateHomeFeatureSelection,
} from "./customer-projects.mjs";
import { normalizePublicPlanSnapshot } from "./public-plan-enquiry.mjs";

export const HOME_ENERGY_PLANNER_SESSION_VERSION = 1 as const;
export const HOME_ENERGY_PLANNER_STAGE_COUNT = 4;

export type HomeEnergyPlannerOption = [string, string];

export type HomeEnergyPlannerFeatureQuestion = {
  id: string;
  label: string;
  help: string;
  mode: "single" | "multiple";
  noneValue?: string;
  unknownValue?: string;
  options: HomeEnergyPlannerOption[];
};

export type HomeEnergyPlannerFeatureSection = {
  id: string;
  title: string;
  description: string;
  questions: HomeEnergyPlannerFeatureQuestion[];
};

export type HomeEnergyPlannerDraft = {
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  budgetRange: string;
  postcode: string;
  addressState: string;
  features: string[];
  propertyType: string;
  storeys: string;
  ageBand: string;
  floorArea: string;
  occupants: string;
  sharedWalls: string;
  roofType: string;
  roofColour: string;
  roofForm: string;
  roofCondition: string;
  switchboard: string;
  wallConstruction: string;
  floorConstruction: string;
};

export type HomeEnergyPlannerPropertyKey =
  | "storeys"
  | "ageBand"
  | "floorArea"
  | "sharedWalls"
  | "roofType"
  | "roofColour"
  | "roofForm"
  | "roofCondition"
  | "switchboard"
  | "wallConstruction"
  | "floorConstruction";

export type HomeEnergyPlannerPropertyQuestion = {
  key: HomeEnergyPlannerPropertyKey;
  label: string;
  options: HomeEnergyPlannerOption[];
};

export type HomeEnergyPlannerSession = {
  version: typeof HOME_ENERGY_PLANNER_SESSION_VERSION;
  draft: HomeEnergyPlannerDraft;
  stage: number;
};

export type HomeEnergyPlannerQuestionBinding = {
  id: string;
  draftKey: keyof HomeEnergyPlannerDraft;
  label: string;
  help: string;
  kind: "postcode" | "select" | "multiselect";
  options: HomeEnergyPlannerOption[];
  unknownValue?: string;
  noneValue?: string;
  featureQuestionId?: string;
};

export const HOME_ENERGY_PLANNER_OPTIONS = rawCustomerProjectOptions as unknown as {
  goals: HomeEnergyPlannerOption[];
  paces: HomeEnergyPlannerOption[];
  situations: HomeEnergyPlannerOption[];
  approvalContexts: HomeEnergyPlannerOption[];
  budgets: HomeEnergyPlannerOption[];
  propertyTypes: HomeEnergyPlannerOption[];
  storeys: HomeEnergyPlannerOption[];
  ageBands: HomeEnergyPlannerOption[];
  floorAreas: HomeEnergyPlannerOption[];
  occupants: HomeEnergyPlannerOption[];
  sharedWalls: HomeEnergyPlannerOption[];
  roofTypes: HomeEnergyPlannerOption[];
  roofColours: HomeEnergyPlannerOption[];
  roofForms: HomeEnergyPlannerOption[];
  roofConditions: HomeEnergyPlannerOption[];
  switchboards: HomeEnergyPlannerOption[];
  wallConstructions: HomeEnergyPlannerOption[];
  floorConstructions: HomeEnergyPlannerOption[];
  timings: HomeEnergyPlannerOption[];
  states: string[];
};

export const HOME_ENERGY_PLANNER_FEATURE_SECTIONS =
  rawCustomerHomeFeatureSections as unknown as HomeEnergyPlannerFeatureSection[];

export const HOME_ENERGY_PLANNER_STAGE_NAMES = [
  "Goal and household",
  "Comfort and building",
  "Current systems",
  "Timing and review",
] as const;

export const HOME_ENERGY_PLANNER_COMFORT_QUESTION_IDS = [
  "comfort-concerns",
  "ceiling-insulation",
  "glazing",
  "heating-cooling-systems",
] as const;

export const HOME_ENERGY_PLANNER_SYSTEM_QUESTION_IDS = [
  "hot-water",
  "cooking",
  "solar",
  "battery",
  "ev",
] as const;

const COMMON_PLANNER_FEATURE_DEFAULTS = [
  ["comfort-concerns", ["comfort-too-hot", "comfort-too-cold"]],
  ["ceiling-insulation", ["ceiling-insulation-limited"]],
  ["glazing", ["single-glazing"]],
  ["heating-cooling-systems", ["gas-heating", "evaporative-cooling"]],
  ["hot-water", ["gas-storage-hot-water"]],
  ["cooking", ["gas-cooking"]],
  ["solar", ["solar-none"]],
  ["battery", ["battery-none"]],
  ["ev", ["ev"]],
] as const;

export const HOME_ENERGY_PLANNER_HOME_BASIC_QUESTIONS: HomeEnergyPlannerPropertyQuestion[] = [
  { key: "storeys", label: "Storeys", options: HOME_ENERGY_PLANNER_OPTIONS.storeys },
  { key: "floorArea", label: "Approximate floor area", options: HOME_ENERGY_PLANNER_OPTIONS.floorAreas },
  { key: "ageBand", label: "Home age", options: HOME_ENERGY_PLANNER_OPTIONS.ageBands },
  { key: "sharedWalls", label: "Shared walls", options: HOME_ENERGY_PLANNER_OPTIONS.sharedWalls },
];

export const HOME_ENERGY_PLANNER_CONSTRUCTION_QUESTIONS: HomeEnergyPlannerPropertyQuestion[] = [
  { key: "wallConstruction", label: "External wall construction", options: HOME_ENERGY_PLANNER_OPTIONS.wallConstructions },
  { key: "floorConstruction", label: "Floor construction", options: HOME_ENERGY_PLANNER_OPTIONS.floorConstructions },
  { key: "roofType", label: "Roof covering", options: HOME_ENERGY_PLANNER_OPTIONS.roofTypes },
  { key: "roofColour", label: "Roof colour", options: HOME_ENERGY_PLANNER_OPTIONS.roofColours },
  { key: "roofForm", label: "Roof form", options: HOME_ENERGY_PLANNER_OPTIONS.roofForms },
  { key: "roofCondition", label: "Roof condition", options: HOME_ENERGY_PLANNER_OPTIONS.roofConditions },
];

export const HOME_ENERGY_PLANNER_ELECTRICAL_QUESTIONS: HomeEnergyPlannerPropertyQuestion[] = [
  { key: "switchboard", label: "Switchboard", options: HOME_ENERGY_PLANNER_OPTIONS.switchboards },
];

const plannerDirectQuestion = (
  id: string,
  draftKey: keyof HomeEnergyPlannerDraft,
  label: string,
  kind: HomeEnergyPlannerQuestionBinding["kind"],
  options: HomeEnergyPlannerOption[] = [],
  help = "",
): HomeEnergyPlannerQuestionBinding => ({ id, draftKey, label, help, kind, options });

export const HOME_ENERGY_PLANNER_DIRECT_QUESTIONS: HomeEnergyPlannerQuestionBinding[] = [
  plannerDirectQuestion("postcode", "postcode", "Property postcode", "postcode", [], "Four digits only."),
  plannerDirectQuestion("situation", "situation", "Your relationship to the home", "select", HOME_ENERGY_PLANNER_OPTIONS.situations),
  plannerDirectQuestion("propertyType", "propertyType", "Home type", "select", HOME_ENERGY_PLANNER_OPTIONS.propertyTypes),
  plannerDirectQuestion("approvalContext", "approvalContext", "Shared property or approval", "select", HOME_ENERGY_PLANNER_OPTIONS.approvalContexts),
  plannerDirectQuestion("occupants", "occupants", "People usually living here", "select", HOME_ENERGY_PLANNER_OPTIONS.occupants),
  plannerDirectQuestion("goals", "goals", "What matters most?", "multiselect", HOME_ENERGY_PLANNER_OPTIONS.goals, "Choose one or more."),
  plannerDirectQuestion("pace", "pace", "How should improvements be staged?", "select", HOME_ENERGY_PLANNER_OPTIONS.paces),
  plannerDirectQuestion("budgetRange", "budgetRange", "Comfortable first-stage budget", "select", HOME_ENERGY_PLANNER_OPTIONS.budgets),
  ...HOME_ENERGY_PLANNER_HOME_BASIC_QUESTIONS.map((question) =>
    plannerDirectQuestion(question.key, question.key, question.label, "select", question.options)),
  ...HOME_ENERGY_PLANNER_CONSTRUCTION_QUESTIONS.map((question) =>
    plannerDirectQuestion(question.key, question.key, question.label, "select", question.options)),
  ...HOME_ENERGY_PLANNER_ELECTRICAL_QUESTIONS.map((question) =>
    plannerDirectQuestion(question.key, question.key, question.label, "select", question.options)),
];

export const HOME_ENERGY_PLANNER_QUESTIONS: HomeEnergyPlannerQuestionBinding[] = [
  ...HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  ...HOME_ENERGY_PLANNER_FEATURE_SECTIONS.flatMap((section) =>
    section.questions.map((question): HomeEnergyPlannerQuestionBinding => ({
      id: `feature:${question.id}`,
      draftKey: "features",
      label: question.label,
      help: question.help,
      kind: question.mode === "multiple" ? "multiselect" : "select",
      options: question.options,
      unknownValue: question.unknownValue,
      noneValue: question.noneValue,
      featureQuestionId: question.id,
    }))),
];

export function homeEnergyPlannerFeatureQuestion(questionId: string) {
  return HOME_ENERGY_PLANNER_FEATURE_SECTIONS
    .flatMap((section) => section.questions)
    .find((question) => question.id === questionId) || null;
}

export function homeEnergyPlannerQuestionAnswered(features: readonly string[], questionId: string) {
  const question = homeEnergyPlannerFeatureQuestion(questionId);
  return question?.options.some(([value]) => features.includes(value)) ?? false;
}

export function withCommonHomeEnergyPlannerFeatureDefaults(features: readonly string[]) {
  let next = normalizeHomeFeatureSelections(features);
  for (const [questionId, values] of COMMON_PLANNER_FEATURE_DEFAULTS) {
    if (!homeEnergyPlannerQuestionAnswered(next, questionId)) {
      for (const value of values) {
        next = updateHomeFeatureSelection(next, questionId, value, true);
      }
    }
  }
  return next;
}

export function normalizeHomeEnergyPlannerFloorInsulation(draft: HomeEnergyPlannerDraft) {
  if (draft.floorConstruction !== "slab_on_ground") return draft;
  return {
    ...draft,
    features: updateHomeFeatureSelection(
      draft.features,
      "floor-insulation",
      "floor-insulation-not-applicable",
      true,
    ),
  };
}

export function defaultHomeEnergyPlannerDraft(initialSelection: HomeEnergyPlannerDraft) {
  const postcodeState = residentialStateFromPostcode(initialSelection.postcode);
  return normalizeHomeEnergyPlannerFloorInsulation({
    ...initialSelection,
    goals: initialSelection.goals.length ? initialSelection.goals : ["lower-bills", "improve-comfort"],
    pace: initialSelection.pace || "staged",
    situation: initialSelection.situation || "owner",
    approvalContext: initialSelection.approvalContext || "none",
    budgetRange: initialSelection.budgetRange || "not_set",
    features: withCommonHomeEnergyPlannerFeatureDefaults(initialSelection.features),
    propertyType: initialSelection.propertyType || "house",
    occupants: initialSelection.occupants || "three_four",
    addressState: postcodeState || "",
  });
}

export function explicitHomeEnergyPlannerDraft(initialSelection: HomeEnergyPlannerDraft) {
  return normalizeHomeEnergyPlannerFloorInsulation({
    ...initialSelection,
    addressState: residentialStateFromPostcode(initialSelection.postcode) || "",
    features: normalizeHomeFeatureSelections(initialSelection.features),
  });
}

export function hasExplicitHomeEnergyPlannerSelection(selection: HomeEnergyPlannerDraft) {
  return Boolean(
    selection.postcode
    || selection.situation
    || selection.features.length
    || selection.propertyType
    || selection.occupants
    || selection.addressState,
  );
}

export function firstIncompleteHomeEnergyPlannerStage(draft: HomeEnergyPlannerDraft) {
  const postcodeState = residentialStateFromPostcode(draft.postcode);
  const householdComplete = Boolean(
    /^\d{4}$/.test(draft.postcode)
    && postcodeState
    && draft.addressState === postcodeState
    && draft.situation
    && draft.propertyType
    && draft.occupants,
  );
  if (!householdComplete) return 0;
  if (!HOME_ENERGY_PLANNER_COMFORT_QUESTION_IDS.every((id) =>
    homeEnergyPlannerQuestionAnswered(draft.features, id))) return 1;
  if (!HOME_ENERGY_PLANNER_SYSTEM_QUESTION_IDS.every((id) =>
    homeEnergyPlannerQuestionAnswered(draft.features, id))) return 2;
  return 4;
}

function storedOption(options: HomeEnergyPlannerOption[], value: unknown, fallback = "") {
  return typeof value === "string" && options.some(([option]) => option === value)
    ? value
    : fallback;
}

export function sanitizeHomeEnergyPlannerDraft(candidate: Partial<HomeEnergyPlannerDraft>) {
  const postcode = typeof candidate.postcode === "string"
    ? candidate.postcode.replace(/\D/g, "").slice(0, 4)
    : "";
  const goals = Array.isArray(candidate.goals)
    ? candidate.goals
        .filter((item): item is string => typeof item === "string")
        .filter((item) => HOME_ENERGY_PLANNER_OPTIONS.goals.some(([option]) => option === item))
        .slice(0, 10)
    : [];
  const rawFeatures = Array.isArray(candidate.features)
    ? candidate.features.filter((item): item is string => typeof item === "string").slice(0, 36)
    : [];
  return normalizeHomeEnergyPlannerFloorInsulation({
    goals,
    pace: storedOption(HOME_ENERGY_PLANNER_OPTIONS.paces, candidate.pace),
    situation: storedOption(HOME_ENERGY_PLANNER_OPTIONS.situations, candidate.situation),
    approvalContext: storedOption(HOME_ENERGY_PLANNER_OPTIONS.approvalContexts, candidate.approvalContext),
    budgetRange: storedOption(HOME_ENERGY_PLANNER_OPTIONS.budgets, candidate.budgetRange),
    postcode,
    addressState: residentialStateFromPostcode(postcode) || "",
    features: normalizeHomeFeatureSelections(rawFeatures),
    propertyType: storedOption(HOME_ENERGY_PLANNER_OPTIONS.propertyTypes, candidate.propertyType),
    storeys: storedOption(HOME_ENERGY_PLANNER_OPTIONS.storeys, candidate.storeys),
    ageBand: storedOption(HOME_ENERGY_PLANNER_OPTIONS.ageBands, candidate.ageBand),
    floorArea: storedOption(HOME_ENERGY_PLANNER_OPTIONS.floorAreas, candidate.floorArea),
    occupants: storedOption(HOME_ENERGY_PLANNER_OPTIONS.occupants, candidate.occupants),
    sharedWalls: storedOption(HOME_ENERGY_PLANNER_OPTIONS.sharedWalls, candidate.sharedWalls),
    roofType: storedOption(HOME_ENERGY_PLANNER_OPTIONS.roofTypes, candidate.roofType),
    roofColour: storedOption(HOME_ENERGY_PLANNER_OPTIONS.roofColours, candidate.roofColour),
    roofForm: storedOption(HOME_ENERGY_PLANNER_OPTIONS.roofForms, candidate.roofForm),
    roofCondition: storedOption(HOME_ENERGY_PLANNER_OPTIONS.roofConditions, candidate.roofCondition),
    switchboard: storedOption(HOME_ENERGY_PLANNER_OPTIONS.switchboards, candidate.switchboard),
    wallConstruction: storedOption(HOME_ENERGY_PLANNER_OPTIONS.wallConstructions, candidate.wallConstruction),
    floorConstruction: storedOption(HOME_ENERGY_PLANNER_OPTIONS.floorConstructions, candidate.floorConstruction),
  });
}

export function parseHomeEnergyPlannerSession(value: unknown): HomeEnergyPlannerSession | null {
  const parsed = typeof value === "string"
    ? (() => {
        try { return JSON.parse(value) as unknown; } catch { return null; }
      })()
    : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { version?: unknown; draft?: unknown; stage?: unknown };
  if (
    record.version !== HOME_ENERGY_PLANNER_SESSION_VERSION
    || !record.draft
    || typeof record.draft !== "object"
    || Array.isArray(record.draft)
  ) return null;
  const candidate = record.draft as Partial<HomeEnergyPlannerDraft>;
  if (!Array.isArray(candidate.goals) || !Array.isArray(candidate.features)) return null;
  return {
    version: HOME_ENERGY_PLANNER_SESSION_VERSION,
    draft: sanitizeHomeEnergyPlannerDraft(candidate),
    stage: Number.isInteger(record.stage) && Number(record.stage) >= 0 && Number(record.stage) <= 4
      ? Number(record.stage)
      : 0,
  };
}

export function createHomeEnergyPlannerSession(
  candidate: Partial<HomeEnergyPlannerDraft>,
  requestedStage?: number,
): HomeEnergyPlannerSession {
  const draft = sanitizeHomeEnergyPlannerDraft(candidate);
  const inferredStage = firstIncompleteHomeEnergyPlannerStage(draft);
  const stage = Number.isInteger(requestedStage) && Number(requestedStage) >= 0 && Number(requestedStage) <= 4
    ? Number(requestedStage)
    : inferredStage;
  return { version: HOME_ENERGY_PLANNER_SESSION_VERSION, draft, stage };
}

export function homeEnergyPlannerCompletion(draft: HomeEnergyPlannerDraft) {
  const postcodeState = residentialStateFromPostcode(draft.postcode);
  const stages = [
    {
      id: "household",
      label: HOME_ENERGY_PLANNER_STAGE_NAMES[0],
      complete: Boolean(
        /^\d{4}$/.test(draft.postcode)
        && postcodeState
        && draft.addressState === postcodeState
        && draft.situation
        && draft.propertyType
        && draft.occupants
      ),
    },
    {
      id: "comfort",
      label: HOME_ENERGY_PLANNER_STAGE_NAMES[1],
      complete: HOME_ENERGY_PLANNER_COMFORT_QUESTION_IDS.every((id) =>
        homeEnergyPlannerQuestionAnswered(draft.features, id)),
    },
    {
      id: "systems",
      label: HOME_ENERGY_PLANNER_STAGE_NAMES[2],
      complete: HOME_ENERGY_PLANNER_SYSTEM_QUESTION_IDS.every((id) =>
        homeEnergyPlannerQuestionAnswered(draft.features, id)),
    },
    {
      id: "timing",
      label: HOME_ENERGY_PLANNER_STAGE_NAMES[3],
      complete: Boolean(draft.pace && draft.budgetRange),
    },
  ] as const;
  const completed = stages.filter((stage) => stage.complete).length;
  return {
    stages,
    completed,
    total: stages.length,
    percentage: Math.round((completed / stages.length) * 100),
    ready: stages.every((stage) => stage.complete),
  };
}

export function createHomeEnergyPlannerPlanInput(draft: HomeEnergyPlannerDraft) {
  return {
    goals: draft.goals,
    pace: draft.pace,
    situation: draft.situation,
    approvalContext: draft.approvalContext,
    budgetRange: draft.budgetRange,
    postcode: draft.postcode,
    addressState: draft.addressState,
    features: draft.features,
    propertyContext: {
      propertyType: draft.propertyType,
      storeys: draft.storeys,
      ageBand: draft.ageBand,
      floorArea: draft.floorArea,
      occupants: draft.occupants,
      sharedWalls: draft.sharedWalls,
      roofType: draft.roofType,
      roofColour: draft.roofColour,
      roofForm: draft.roofForm,
      roofCondition: draft.roofCondition,
      switchboard: draft.switchboard,
      wallConstruction: draft.wallConstruction,
      floorConstruction: draft.floorConstruction,
    },
  };
}

export function createHomeEnergyPlannerPlan(draft: HomeEnergyPlannerDraft) {
  return createCustomerProjectPlan(createHomeEnergyPlannerPlanInput(draft));
}

export function createHomeEnergyPlannerPublicPlanSnapshot(draft: HomeEnergyPlannerDraft) {
  const input = createHomeEnergyPlannerPlanInput(draft);
  const normalized = normalizePublicPlanSnapshot({
    goals: input.goals,
    pace: input.pace,
    situation: input.situation,
    approvalContext: input.approvalContext,
    budgetRange: input.budgetRange,
    addressState: input.addressState,
    features: input.features,
    propertyContext: input.propertyContext,
  });
  if (!normalized.ok) throw new Error(normalized.error);
  return normalized.value;
}
