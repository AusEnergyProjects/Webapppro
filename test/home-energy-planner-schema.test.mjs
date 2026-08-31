import assert from "node:assert/strict";
import test from "node:test";
import {
  HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  HOME_ENERGY_PLANNER_FEATURE_SECTIONS,
  HOME_ENERGY_PLANNER_APPROVAL_CHOICES,
  HOME_ENERGY_PLANNER_QUESTIONS,
  HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS,
  createHomeEnergyPlannerPlan,
  createHomeEnergyPlannerPlanInput,
  createHomeEnergyPlannerPublicPlanSnapshot,
  createHomeEnergyPlannerSession,
  defaultHomeEnergyPlannerDraft,
  parseHomeEnergyPlannerSession,
  sanitizeHomeEnergyPlannerDraft,
} from "../src/lib/home-energy-planner-schema.ts";

test("the planner registry contains every direct and feature question exactly once", () => {
  const ids = HOME_ENERGY_PLANNER_QUESTIONS.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const direct of HOME_ENERGY_PLANNER_DIRECT_QUESTIONS) {
    assert.equal(HOME_ENERGY_PLANNER_QUESTIONS.filter((question) => question.id === direct.id).length, 1);
  }
  for (const feature of HOME_ENERGY_PLANNER_FEATURE_SECTIONS.flatMap((section) => section.questions)) {
    const binding = HOME_ENERGY_PLANNER_QUESTIONS.find((question) => question.id === `feature:${feature.id}`);
    assert.ok(binding, `missing ${feature.id}`);
    assert.deepEqual(binding.options, feature.options);
    assert.equal(binding.featureQuestionId, feature.id);
  }
});

test("the seven supplemental questions have one authoritative stage and context key", () => {
  assert.equal(HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS.length, 7);
  assert.equal(new Set(HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS.map((question) => question.draftKey)).size, 7);
  assert.equal(new Set(HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS.map((question) => question.contextKey)).size, 7);
  for (const question of HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS) {
    assert.ok(
      question.options.some(([value]) => value === "not-sure"),
      `${question.draftKey} must offer an explicit unknown answer`,
    );
  }
  assert.deepEqual(Object.fromEntries(HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS.map((question) => [
    question.draftKey,
    [question.plannerStage, question.contextKey],
  ])), {
    timing: [3, "upgrade_timing"],
    occupancyPattern: [0, "occupancy_pattern"],
    energyUsePattern: [2, "energy_use_pattern"],
    billPressure: [3, "bill_pressure"],
    gasConnection: [2, "gas_connection"],
    disruption: [3, "acceptable_disruption"],
    plannedWorks: [3, "planned_work"],
  });
});

test("fresh plans do not silently assert that strata or body corporate is absent", () => {
  const draft = defaultHomeEnergyPlannerDraft(sanitizeHomeEnergyPlannerDraft({ goals: [], features: [] }));
  assert.equal(draft.approvalContext, "not_sure");
  assert.equal(draft.timing, "not-sure");
  assert.equal(
    createHomeEnergyPlannerPlan(draft).items.some((item) => item.id === "household-routines-and-constraints"),
    false,
  );
  assert.deepEqual(HOME_ENERGY_PLANNER_APPROVAL_CHOICES, [
    ["strata", "Yes"],
    ["none", "No"],
    ["not_sure", "Don't know"],
  ]);
});

test("every private supplemental answer materially changes the local roadmap but not its public snapshot", () => {
  const base = sanitizeHomeEnergyPlannerDraft({
    postcode: "3006",
    situation: "owner",
    approvalContext: "not_sure",
    propertyType: "house",
    occupants: "two",
    goals: ["lower-bills"],
    pace: "staged",
    budgetRange: "not_set",
    features: [],
  });
  const baselineSnapshot = createHomeEnergyPlannerPublicPlanSnapshot(base);
  assert.equal(createHomeEnergyPlannerPlan(base).items.some((item) => item.id === "household-routines-and-constraints"), false);

  for (const question of HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS) {
    const [value, label] = question.options.find(([option]) => option !== "not-sure");
    const draft = sanitizeHomeEnergyPlannerDraft({ ...base, [question.draftKey]: value });
    const item = createHomeEnergyPlannerPlan(draft).items.find(
      (candidate) => candidate.id === "household-routines-and-constraints",
    );
    assert.ok(item, question.draftKey);
    assert.match(item.text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), question.draftKey);
    assert.deepEqual(createHomeEnergyPlannerPublicPlanSnapshot(draft), baselineSnapshot, question.draftKey);
    assert.doesNotMatch(JSON.stringify(baselineSnapshot), new RegExp(value, "i"), question.draftKey);
  }
});

test("the longest private planner context remains a complete bounded recommendation", () => {
  const longestAnswers = Object.fromEntries(HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS.map((question) => {
    const [value] = [...question.options]
      .filter(([option]) => option !== "not-sure")
      .sort((left, right) => right[1].length - left[1].length)[0];
    return [question.draftKey, value];
  }));
  const draft = sanitizeHomeEnergyPlannerDraft({
    postcode: "3006",
    situation: "owner",
    approvalContext: "not_sure",
    propertyType: "house",
    occupants: "five_plus",
    goals: ["lower-bills", "improve-comfort"],
    pace: "staged",
    budgetRange: "not_set",
    features: [],
    ...longestAnswers,
  });
  const item = createHomeEnergyPlannerPlan(draft).items.find(
    (candidate) => candidate.id === "household-routines-and-constraints",
  );
  assert.ok(item);
  assert.ok(item.text.length <= 600);
  assert.match(item.text, /[.!?]$/);
  for (const question of HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS) {
    const label = question.options.find(([value]) => value === draft[question.draftKey])?.[1];
    assert.ok(label);
    assert.match(item.text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("the canonical v1 session round trips without changing the generated plan", () => {
  const session = createHomeEnergyPlannerSession({
    postcode: "3006",
    situation: "owner",
    propertyType: "house",
    approvalContext: "none",
    occupants: "three_four",
    goals: ["lower-bills", "improve-comfort"],
    pace: "staged",
    budgetRange: "2_10k",
    timing: "within_3_months",
    occupancyPattern: "mostly-home",
    energyUsePattern: "all-day",
    billPressure: "higher-than-expected",
    gasConnection: "connected",
    disruption: "some-work",
    plannedWorks: "maintenance",
    switchboard: "older_fuses",
    features: [
      "comfort-too-cold", "ceiling-insulation-limited", "single-glazing", "gas-heating",
      "gas-storage-hot-water", "gas-cooking", "solar-none", "battery-none", "ev-none",
    ],
  });
  const restored = parseHomeEnergyPlannerSession(JSON.stringify(session));
  assert.deepEqual(restored, session);
  assert.deepEqual(createHomeEnergyPlannerPlanInput(restored.draft), createHomeEnergyPlannerPlanInput(session.draft));
  assert.deepEqual(createHomeEnergyPlannerPlan(restored.draft), createHomeEnergyPlannerPlan(session.draft));
  assert.equal(restored.draft.occupancyPattern, "mostly-home");
  assert.equal(restored.draft.plannedWorks, "maintenance");
});

test("old v1 sessions restore without inventing new planner answers and invalid new values fail closed", () => {
  const oldSession = {
    version: 1,
    stage: 4,
    draft: {
      postcode: "3006",
      goals: ["lower-bills"],
      features: [],
    },
  };
  const restored = parseHomeEnergyPlannerSession(JSON.stringify(oldSession));
  assert.ok(restored);
  assert.equal(restored.stage, 4);
  for (const key of [
    "timing",
    "occupancyPattern",
    "energyUsePattern",
    "billPressure",
    "gasConnection",
    "disruption",
    "plannedWorks",
  ]) assert.equal(restored.draft[key], "", key);

  const sanitized = sanitizeHomeEnergyPlannerDraft({
    goals: [],
    features: [],
    timing: "private-value",
    occupancyPattern: "private-value",
    energyUsePattern: "private-value",
    billPressure: "private-value",
    gasConnection: "private-value",
    disruption: "private-value",
    plannedWorks: "private-value",
  });
  for (const key of [
    "timing",
    "occupancyPattern",
    "energyUsePattern",
    "billPressure",
    "gasConnection",
    "disruption",
    "plannedWorks",
  ]) assert.equal(sanitized[key], "", key);
});
