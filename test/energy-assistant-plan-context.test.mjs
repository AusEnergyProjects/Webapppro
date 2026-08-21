import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSurgePlanContextFromStoredAssessment,
  parseSurgePlanContext,
  SURGE_PLAN_CONTEXT_MAX_FACTS,
  SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS,
  surgePlanContextSummary,
} from "../src/lib/energy-assistant-plan-context.ts";
import { customerHomeFeatureSections } from "../src/lib/customer-projects.mjs";

function storedAssessment(stage, overrides = {}) {
  return JSON.stringify({
    version: 1,
    stage,
    draft: {
      postcode: "3006",
      situation: "owner",
      approvalContext: "none",
      propertyType: "house",
      occupants: "three_four",
      goals: ["lower-bills", "improve-comfort"],
      pace: "staged",
      budgetRange: "2_10k",
      storeys: "single",
      ageBand: "1960_1999",
      floorArea: "100_199",
      sharedWalls: "none",
      wallConstruction: "brick_veneer",
      floorConstruction: "slab_on_ground",
      roofType: "tile",
      roofColour: "dark",
      roofForm: "pitched",
      roofCondition: "weathered",
      switchboard: "older_fuses",
      features: [
        "comfort-too-cold",
        "ceiling-insulation-limited",
        "single-glazing",
        "gas-heating",
        "gas-storage-hot-water",
        "gas-cooking",
        "solar-none",
        "battery-none",
        "ev-none",
      ],
      ...overrides,
    },
  });
}

function facts(context) {
  return new Map(context?.facts.map((fact) => [fact.key, fact.value]) || []);
}

test("saved home-plan context includes only steps the household has completed", () => {
  assert.equal(buildSurgePlanContextFromStoredAssessment(storedAssessment(0)), null);

  const household = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(1)));
  assert.equal(household.get("postcode"), "3006");
  assert.equal(household.get("state_or_territory"), "VIC");
  assert.equal(household.get("tenure"), "I own the home");
  assert.equal(household.get("property_type"), "Detached house");
  assert.equal(household.get("household_size"), "Three or four people");
  assert.equal(household.get("home_age"), "Built from 1960 to 1999");
  assert.equal(household.has("comfort_concerns"), false);
  assert.equal(household.has("hot_water"), false);
  assert.equal(household.has("upgrade_pace"), false);

  const comfort = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(2)));
  assert.equal(comfort.get("comfort_concerns"), "Too cold in cool weather");
  assert.equal(comfort.get("ceiling_insulation"), "A little, old, patchy or probably inadequate");
  assert.equal(comfort.get("glazing"), "Mostly single glazed");
  assert.equal(comfort.get("heating_cooling_systems"), "Gas space or ducted heating");
  assert.equal(comfort.has("hot_water"), false);

  const systems = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(3)));
  assert.equal(systems.get("hot_water"), "Gas storage hot water");
  assert.equal(systems.get("cooking"), "Gas cooktop or oven");
  assert.equal(systems.get("solar"), "No rooftop solar");
  assert.equal(systems.get("battery"), "No home battery");
  assert.equal(systems.get("switchboard"), "Older fuse board");
  assert.equal(systems.has("upgrade_pace"), false);

  const complete = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(4)));
  assert.equal(complete.get("upgrade_pace"), "Stage improvements over time");
  assert.equal(complete.get("first_stage_budget"), "$2,000 to $10,000");
});

test("saved plan parsing is allowlisted, bounded and does not copy unrelated fields", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    email: "private@example.test",
    phone: "0400000000",
    photoBytes: "sensitive-photo-content",
    features: ["single-glazing", "invented-feature", "gas-heating"],
  }));
  assert.ok(context);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /private@example|0400000000|sensitive-photo|invented-feature/);
  assert.ok(context.facts.length <= SURGE_PLAN_CONTEXT_MAX_FACTS);
  assert.ok(context.facts.reduce((total, fact) => total + fact.key.length + fact.value.length, 0)
    <= SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS);

  assert.equal(parseSurgePlanContext({
    version: 1,
    source: "home_energy_plan",
    facts: [{ key: "postcode", value: "3006" }],
  })?.facts[0].value, "3006");
  assert.equal(parseSurgePlanContext({
    version: 1,
    source: "home_energy_plan",
    facts: [{ key: "bad key", value: "3006" }],
  }), null);
  assert.equal(parseSurgePlanContext({
    version: 1,
    source: "home_energy_plan",
    facts: [{ key: "tenure", value: "Invented tenure" }],
  }), null);
  assert.equal(parseSurgePlanContext({
    version: 1,
    source: "home_energy_plan",
    facts: [
      { key: "postcode", value: "3006" },
      { key: "state_or_territory", value: "NSW" },
    ],
  }), null);
  assert.equal(parseSurgePlanContext({
    version: 1,
    source: "home_energy_plan",
    facts: Array.from({ length: SURGE_PLAN_CONTEXT_MAX_FACTS + 1 }, (_, index) => ({
      key: `fact_${index}`,
      value: "value",
    })),
  }), null);
});

test("a completed planner keeps every canonical feature in Surge context", () => {
  const allFeatureSelections = customerHomeFeatureSections.flatMap((section) => (
    section.questions.map((question) => question.options[0][0])
  ));
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    features: allFeatureSelections,
  }));
  assert.ok(context);
  const knownFacts = facts(context);
  for (const section of customerHomeFeatureSections) {
    for (const question of section.questions) {
      assert.equal(
        knownFacts.has(question.id.replaceAll("-", "_")),
        true,
        `missing completed planner question ${question.id}`,
      );
    }
  }
  assert.equal(context.facts.length, 39);
  assert.equal(knownFacts.has("cooking"), true);
  assert.equal(knownFacts.has("electrical_supply"), true);
  assert.equal(knownFacts.has("solar"), true);
  assert.equal(knownFacts.has("battery"), true);
  assert.equal(knownFacts.has("ev"), true);
  assert.equal(knownFacts.has("lighting"), true);
  assert.equal(knownFacts.has("pool_spa"), true);
});

test("the deterministic plan summary states that newer chat corrections win", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4));
  assert.ok(context);
  const summary = surgePlanContextSummary(context);
  assert.match(summary, /untrusted, may be incomplete or outdated/i);
  assert.match(summary, /newer chat corrections override it/i);
  assert.match(summary, /postcode: 3006/);
  assert.match(summary, /property type: Detached house/);
});
