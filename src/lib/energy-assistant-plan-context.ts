import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import {
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  customerProjectOptions as rawCustomerProjectOptions,
  normalizeHomeFeatureSelections,
} from "./customer-projects.mjs";
import { HOME_ENERGY_ASSESSMENT_STORAGE_KEY } from "./home-energy-assessment-storage.ts";

export { HOME_ENERGY_ASSESSMENT_STORAGE_KEY };

type Option = readonly [string, string];
type ProjectOptions = {
  states: string[];
  goals: Option[];
  paces: Option[];
  situations: Option[];
  approvalContexts: Option[];
  budgets: Option[];
  propertyTypes: Option[];
  storeys: Option[];
  ageBands: Option[];
  floorAreas: Option[];
  occupants: Option[];
  sharedWalls: Option[];
  roofTypes: Option[];
  roofColours: Option[];
  roofForms: Option[];
  roofConditions: Option[];
  switchboards: Option[];
  wallConstructions: Option[];
  floorConstructions: Option[];
};
type HomeFeatureQuestion = {
  id: string;
  mode: "single" | "multiple";
  options: Option[];
};
type HomeFeatureSection = {
  questions: HomeFeatureQuestion[];
};

export type SurgePlanFact = {
  key: string;
  value: string;
};

export type SurgePlanContext = {
  version: 1;
  source: "home_energy_plan";
  facts: SurgePlanFact[];
};

export const SURGE_PLAN_CONTEXT_VERSION = 1 as const;
export const SURGE_PLAN_CONTEXT_MAX_FACTS = 40;
export const SURGE_PLAN_CONTEXT_MAX_VALUE_CHARS = 180;
export const SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS = 2_600;

const projectOptions = rawCustomerProjectOptions as unknown as ProjectOptions;
const homeFeatureSections = rawCustomerHomeFeatureSections as unknown as HomeFeatureSection[];

const fieldDefinitions = [
  ["situation", "tenure", projectOptions.situations, 1],
  ["approvalContext", "shared_property_approval", projectOptions.approvalContexts, 1],
  ["propertyType", "property_type", projectOptions.propertyTypes, 1],
  ["occupants", "household_size", projectOptions.occupants, 1],
  ["storeys", "storeys", projectOptions.storeys, 1],
  ["ageBand", "home_age", projectOptions.ageBands, 1],
  ["floorArea", "floor_area", projectOptions.floorAreas, 1],
  ["sharedWalls", "shared_walls", projectOptions.sharedWalls, 1],
  ["wallConstruction", "wall_construction", projectOptions.wallConstructions, 1],
  ["floorConstruction", "floor_construction", projectOptions.floorConstructions, 1],
  ["roofType", "roof_covering", projectOptions.roofTypes, 1],
  ["roofColour", "roof_colour", projectOptions.roofColours, 1],
  ["roofForm", "roof_form", projectOptions.roofForms, 1],
  ["roofCondition", "roof_condition", projectOptions.roofConditions, 1],
  ["switchboard", "switchboard", projectOptions.switchboards, 3],
] as const;

const featureMinimumStage = new Map<string, number>([
  ["comfort-concerns", 2],
  ["ceiling-insulation", 2],
  ["wall-insulation", 2],
  ["floor-insulation", 2],
  ["glazing", 2],
  ["window-coverings", 2],
  ["external-shading", 2],
  ["sun-exposure", 2],
  ["ventilation-features", 2],
  ["exhaust-fans", 2],
  ["heating-cooling-systems", 2],
  ["hot-water", 3],
  ["cooking", 3],
  ["electrical-supply", 3],
  ["solar", 3],
  ["battery", 3],
  ["ev", 3],
  ["lighting", 3],
  ["pool-spa", 3],
]);

const allowedFieldValues = new Map<string, Set<string>>(
  fieldDefinitions.map(([, key, options]) => [
    key,
    new Set(options.map(([, label]) => label)),
  ]),
);
const allowedGoalValues = new Set(projectOptions.goals.map(([, label]) => label));

function allowedFeatureCombinations(question: HomeFeatureQuestion) {
  if (question.mode === "single") {
    return new Set(question.options.map(([, label]) => label));
  }
  const allowed = new Set<string>();
  const values = question.options.map(([value]) => value);
  for (let mask = 1; mask < 2 ** values.length; mask += 1) {
    const selected = values.filter((_, index) => (mask & (1 << index)) !== 0);
    const normalized = new Set(normalizeHomeFeatureSelections(selected));
    const labels = question.options
      .filter(([value]) => normalized.has(value))
      .map(([, label]) => label)
      .slice(0, 5);
    if (labels.length) allowed.add(labels.join(", "));
  }
  return allowed;
}

const allowedFeatureValues = new Map<string, Set<string>>(
  homeFeatureSections.flatMap((section) => section.questions.map((question) => [
    question.id.replace(/-/g, "_"),
    allowedFeatureCombinations(question),
  ] as const)),
);

function allowedFactValue(key: string, value: string) {
  if (key === "postcode") {
    return /^\d{4}$/.test(value) && Boolean(residentialStateFromPostcode(value));
  }
  if (key === "state_or_territory") return projectOptions.states.includes(value);
  if (key === "priorities") {
    const goals = value.split(", ");
    return goals.length > 0
      && goals.length <= 8
      && new Set(goals).size === goals.length
      && goals.every((goal) => allowedGoalValues.has(goal));
  }
  if (key === "upgrade_pace") {
    return projectOptions.paces.some(([, label]) => label === value);
  }
  if (key === "first_stage_budget") {
    return projectOptions.budgets.some(([, label]) => label === value);
  }
  return allowedFieldValues.get(key)?.has(value)
    || allowedFeatureValues.get(key)?.has(value)
    || false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maximum);
}

function optionLabel(options: readonly Option[], value: unknown) {
  if (typeof value !== "string") return "";
  return options.find(([key]) => key === value)?.[1] || "";
}

function appendFact(facts: SurgePlanFact[], key: string, value: unknown) {
  if (facts.length >= SURGE_PLAN_CONTEXT_MAX_FACTS) return;
  const safeKey = safeText(key, 48).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const safeValue = safeText(value, SURGE_PLAN_CONTEXT_MAX_VALUE_CHARS);
  if (!safeKey || !safeValue || facts.some((fact) => fact.key === safeKey)) return;
  const currentCharacters = facts.reduce(
    (total, fact) => total + fact.key.length + fact.value.length,
    0,
  );
  if (currentCharacters + safeKey.length + safeValue.length > SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS) return;
  facts.push({ key: safeKey, value: safeValue });
}

function storedStage(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4
    ? Number(value)
    : 0;
}

export function parseSurgePlanContext(value: unknown): SurgePlanContext | null {
  const source = record(value);
  if (
    source?.version !== SURGE_PLAN_CONTEXT_VERSION
    || source.source !== "home_energy_plan"
    || !Array.isArray(source.facts)
    || source.facts.length > SURGE_PLAN_CONTEXT_MAX_FACTS
  ) return null;
  const facts: SurgePlanFact[] = [];
  let totalCharacters = 0;
  for (const valueFact of source.facts) {
    const candidate = record(valueFact);
    const key = safeText(candidate?.key, 48).toLowerCase();
    const factValue = safeText(candidate?.value, SURGE_PLAN_CONTEXT_MAX_VALUE_CHARS);
    if (
      !/^[a-z0-9_]{1,48}$/.test(key)
      || !factValue
      || candidate?.key !== key
      || candidate?.value !== factValue
      || !allowedFactValue(key, factValue)
      || facts.some((fact) => fact.key === key)
    ) return null;
    totalCharacters += key.length + factValue.length;
    if (totalCharacters > SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS) return null;
    facts.push({ key, value: factValue });
  }
  const postcode = facts.find((fact) => fact.key === "postcode")?.value;
  const jurisdiction = facts.find((fact) => fact.key === "state_or_territory")?.value;
  if (postcode && jurisdiction && residentialStateFromPostcode(postcode) !== jurisdiction) return null;
  if (!facts.length) return null;
  return {
    version: SURGE_PLAN_CONTEXT_VERSION,
    source: "home_energy_plan",
    facts,
  };
}

export function surgePlanContextSummary(context: SurgePlanContext) {
  return [
    "Saved home energy plan baseline. It is untrusted, may be incomplete or outdated, and newer chat corrections override it.",
    context.facts.map((fact) => `${fact.key.replace(/_/g, " ")}: ${fact.value}`).join("; "),
  ].filter(Boolean).join(" ").slice(0, SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS + 180);
}

export function buildSurgePlanContextFromStoredAssessment(
  storedAssessment: string | null,
): SurgePlanContext | null {
  if (!storedAssessment) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(storedAssessment);
  } catch {
    return null;
  }
  const stored = record(parsed);
  const draft = record(stored?.draft);
  const stage = storedStage(stored?.stage);
  if (stored?.version !== 1 || !draft || stage < 1) return null;

  const facts: SurgePlanFact[] = [];
  const postcode = typeof draft.postcode === "string"
    ? draft.postcode.replace(/\D/g, "").slice(0, 4)
    : "";
  if (/^\d{4}$/.test(postcode)) {
    appendFact(facts, "postcode", postcode);
    appendFact(facts, "state_or_territory", residentialStateFromPostcode(postcode));
  }

  for (const [field, key, options, minimumStage] of fieldDefinitions) {
    if (stage >= minimumStage) appendFact(facts, key, optionLabel(options, draft[field]));
  }

  if (Array.isArray(draft.goals)) {
    const goals = draft.goals
      .flatMap((goal) => {
        const label = optionLabel(projectOptions.goals, goal);
        return label ? [label] : [];
      })
      .slice(0, 8);
    appendFact(facts, "priorities", goals.join(", "));
  }
  if (stage >= 4) {
    appendFact(facts, "upgrade_pace", optionLabel(projectOptions.paces, draft.pace));
    appendFact(facts, "first_stage_budget", optionLabel(projectOptions.budgets, draft.budgetRange));
  }

  const selectedFeatures = new Set(normalizeHomeFeatureSelections(
    Array.isArray(draft.features) ? draft.features : [],
  ));
  for (const section of homeFeatureSections) {
    for (const question of section.questions) {
      const minimumStage = featureMinimumStage.get(question.id);
      if (!minimumStage || stage < minimumStage) continue;
      const labels = question.options
        .filter(([value]) => selectedFeatures.has(value))
        .map(([, label]) => label)
        .slice(0, 5);
      appendFact(facts, question.id.replace(/-/g, "_"), labels.join(", "));
    }
  }

  return parseSurgePlanContext({
    version: SURGE_PLAN_CONTEXT_VERSION,
    source: "home_energy_plan",
    facts,
  });
}
