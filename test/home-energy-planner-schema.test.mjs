import assert from "node:assert/strict";
import test from "node:test";
import {
  HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  HOME_ENERGY_PLANNER_FEATURE_SECTIONS,
  HOME_ENERGY_PLANNER_QUESTIONS,
  createHomeEnergyPlannerPlan,
  createHomeEnergyPlannerPlanInput,
  createHomeEnergyPlannerSession,
  parseHomeEnergyPlannerSession,
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
});
