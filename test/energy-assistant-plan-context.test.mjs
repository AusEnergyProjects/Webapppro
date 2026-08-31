import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSurgePlanContextFromStoredAssessment,
  parseSurgePlanContext,
  SURGE_PLAN_CONTEXT_MAX_FACTS,
  SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS,
  surgePlanContextSummary,
} from "../src/lib/energy-assistant-plan-context.ts";
import {
  applySurgePlanContextCorrections,
  applySurgePlanContextCorrectionsToConversationState,
  composeSurgePlanPriorityAnswer,
  surgePlanContextCorrectionsAfterRecentHomeFactChanges,
} from "../src/lib/energy-assistant-plan-priority.ts";
import {
  customerHomeFeatureSections,
  customerProjectOptions,
} from "../src/lib/customer-projects.mjs";
import {
  HOME_ENERGY_PLANNER_QUESTIONS,
  HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS,
} from "../src/lib/home-energy-planner-schema.ts";

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

function longestOptionValue(options, excluded = new Set()) {
  return [...options]
    .filter(([value]) => !excluded.has(value))
    .sort((left, right) => right[1].length - left[1].length)[0]?.[0] || "";
}

test("the longest valid completed profile keeps all 46 bounded facts", () => {
  const draft = JSON.parse(storedAssessment(4)).draft;
  const directOptions = {
    situation: customerProjectOptions.situations,
    approvalContext: customerProjectOptions.approvalContexts,
    propertyType: customerProjectOptions.propertyTypes,
    occupants: customerProjectOptions.occupants,
    storeys: customerProjectOptions.storeys,
    ageBand: customerProjectOptions.ageBands,
    floorArea: customerProjectOptions.floorAreas,
    sharedWalls: customerProjectOptions.sharedWalls,
    wallConstruction: customerProjectOptions.wallConstructions,
    floorConstruction: customerProjectOptions.floorConstructions,
    roofType: customerProjectOptions.roofTypes,
    roofColour: customerProjectOptions.roofColours,
    roofForm: customerProjectOptions.roofForms,
    roofCondition: customerProjectOptions.roofConditions,
    switchboard: customerProjectOptions.switchboards,
  };
  for (const [key, options] of Object.entries(directOptions)) {
    draft[key] = longestOptionValue(options);
  }
  draft.goals = [...customerProjectOptions.goals]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 8)
    .map(([value]) => value);
  draft.pace = longestOptionValue(customerProjectOptions.paces);
  draft.budgetRange = longestOptionValue(customerProjectOptions.budgets);
  for (const question of HOME_ENERGY_PLANNER_SUPPLEMENTAL_QUESTIONS) {
    draft[question.draftKey] = longestOptionValue(question.options, new Set(["not-sure"]));
  }
  draft.features = customerHomeFeatureSections.flatMap((section) => section.questions.flatMap((question) => {
    const excluded = new Set([question.unknownValue, question.noneValue].filter(Boolean));
    const substantive = [...question.options]
      .filter(([value]) => !excluded.has(value))
      .sort((left, right) => right[1].length - left[1].length);
    return question.mode === "multiple"
      ? substantive.slice(0, 5).map(([value]) => value)
      : substantive.slice(0, 1).map(([value]) => value);
  }));

  const context = buildSurgePlanContextFromStoredAssessment(JSON.stringify({
    version: 1,
    stage: 4,
    draft,
  }));
  assert.ok(context);
  assert.equal(context.facts.length, 46);
  assert.equal(HOME_ENERGY_PLANNER_QUESTIONS.length, 45);
  assert.equal(draft.features.length, 30);
  assert.equal(
    context.facts.reduce((total, fact) => total + fact.key.length + fact.value.length, 0),
    2_673,
  );
  assert.equal(JSON.stringify(context).length, 3_736);
  assert.equal(new TextEncoder().encode(JSON.stringify(context)).byteLength, 3_736);
  assert.equal(surgePlanContextSummary(context).length, 2_976);
  assert.equal(context.facts.find((fact) => fact.key === "priorities").value.length, 284);
  assert.ok(2_673 <= SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS);
  assert.ok(context.facts.some((fact) => fact.key === "planned_work"));
  assert.ok(context.facts.some((fact) => fact.key === "pool_spa"));
});

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

test("all seven shared planner answers join the bounded typed plan context", () => {
  const allFeatureSelections = customerHomeFeatureSections.flatMap((section) => (
    section.questions.map((question) => question.options[0][0])
  ));
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    features: allFeatureSelections,
    timing: "within_3_months",
    occupancyPattern: "mostly-home",
    energyUsePattern: "all-day",
    billPressure: "comfortable",
    gasConnection: "connected",
    disruption: "some-work",
    plannedWorks: "maintenance",
    email: "private@example.test",
    phone: "0400000000",
  }));
  assert.ok(context);
  const knownFacts = facts(context);
  assert.equal(context.facts.length, 46);
  assert.equal(knownFacts.get("upgrade_timing"), "Within three months");
  assert.equal(knownFacts.get("occupancy_pattern"), "Someone is home most days");
  assert.equal(knownFacts.get("energy_use_pattern"), "Steady use through the day");
  assert.equal(knownFacts.get("bill_pressure"), "Generally manageable");
  assert.equal(knownFacts.get("gas_connection"), "Mains gas connection");
  assert.equal(knownFacts.get("acceptable_disruption"), "Some building work is acceptable");
  assert.equal(knownFacts.get("planned_work"), "General repairs or maintenance");
  assert.ok(context.facts.length <= SURGE_PLAN_CONTEXT_MAX_FACTS);
  assert.ok(context.facts.reduce((total, fact) => total + fact.key.length + fact.value.length, 0)
    <= SURGE_PLAN_CONTEXT_MAX_TOTAL_CHARS);
  assert.doesNotMatch(JSON.stringify(context), /private@example|0400000000/);
  assert.deepEqual(parseSurgePlanContext(context), context);
});

test("an unanswered timing question never becomes a saved-plan fact", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    timing: "not-sure",
  }));
  assert.ok(context);
  assert.equal(context.facts.some((fact) => fact.key === "upgrade_timing"), false);
  assert.doesNotMatch(surgePlanContextSummary(context), /No fixed timing|Don't know yet/i);
});

test("shared planner context releases routine answers only after their planner stage", () => {
  const answers = {
    timing: "within_3_months",
    occupancyPattern: "mostly-home",
    energyUsePattern: "all-day",
    billPressure: "comfortable",
    gasConnection: "connected",
    disruption: "some-work",
    plannedWorks: "maintenance",
  };
  const household = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(1, answers)));
  assert.equal(household.get("occupancy_pattern"), "Someone is home most days");
  assert.equal(household.has("energy_use_pattern"), false);
  assert.equal(household.has("upgrade_timing"), false);

  const systems = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(3, answers)));
  assert.equal(systems.get("energy_use_pattern"), "Steady use through the day");
  assert.equal(systems.get("gas_connection"), "Mains gas connection");
  assert.equal(systems.has("bill_pressure"), false);

  const complete = facts(buildSurgePlanContextFromStoredAssessment(storedAssessment(4, answers)));
  assert.equal(complete.get("upgrade_timing"), "Within three months");
  assert.equal(complete.get("bill_pressure"), "Generally manageable");
  assert.equal(complete.get("acceptable_disruption"), "Some building work is acceptable");
  assert.equal(complete.get("planned_work"), "General repairs or maintenance");
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

test("a completed apartment survey produces a specific ranked starting plan", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    postcode: "3000",
    approvalContext: "strata",
    propertyType: "apartment",
    occupants: "two",
    goals: ["improve-comfort", "lower-bills"],
    pace: "whole-home",
    budgetRange: "under_2k",
    sharedWalls: "two_plus_sides",
    floorConstruction: "suspended_concrete",
    features: [
      "comfort-too-hot",
      "comfort-too-cold",
      "condensation-moisture",
      "ceiling-insulation-not-applicable",
      "wall-insulation-none",
      "floor-insulation-not-applicable",
      "single-glazing",
      "window-coverings-basic",
      "external-shading-none",
      "sun-exposure-morning",
      "ventilation-none-known",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "reverse-cycle",
      "gas-heating",
      "gas-storage-hot-water",
      "gas-cooking",
      "electrical-supply-single-phase",
      "solar-none",
      "battery-none",
      "ev",
      "lighting-mostly-led",
      "pool-spa-none",
    ],
  }));
  assert.ok(context);
  const answer = composeSurgePlanPriorityAnswer(
    "where is the best place to star",
    context,
  );
  assert.ok(answer);
  assert.match(answer.directAnswer, /saved answers/i);
  assert.match(answer.directAnswer, /apartment or unit/i);
  assert.match(answer.directAnswer, /under \$2,000/i);
  assert.match(answer.directAnswer, /condensation/i);
  assert.match(answer.directAnswer, /honeycomb blinds|thermal curtains/i);
  assert.match(answer.directAnswer, /reverse-cycle air conditioner/i);
  assert.match(answer.directAnswer, /ceiling and underfloor insulation advice does not fit/i);
  assert.match(answer.directAnswer, /solar and a battery as later/i);
  assert.equal(answer.suggestedQuestions.length, 0);
  const moistureIndex = answer.directAnswer.search(/moisture|condensation/i);
  const windowsIndex = answer.directAnswer.search(/windows?|honeycomb|thermal curtains/i);
  const heatingIndex = answer.directAnswer.search(/reverse-cycle/i);
  assert.ok(moistureIndex >= 0 && moistureIndex < windowsIndex);
  assert.ok(windowsIndex >= 0 && windowsIndex < heatingIndex);
});

test("saved-plan priority recognises a first-budget question", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    propertyType: "apartment",
    approvalContext: "strata",
    features: [
      "comfort-too-cold",
      "condensation-moisture",
      "single-glazing",
      "window-coverings-basic",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "reverse-cycle",
      "solar-none",
      "battery-none",
    ],
  }));
  assert.ok(context);
  const answer = composeSurgePlanPriorityAnswer(
    "Based on my saved survey, what should I spend the first $1000 on for comfort and lower bills?",
    context,
  );
  assert.ok(answer);
  assert.match(answer.directAnswer, /based on your saved answers/i);
  assert.match(answer.directAnswer, /\$1,000 to spend first/i);
  assert.match(answer.directAnswer, /condensation|honeycomb|reverse-cycle/i);
  assert.match(answer.directAnswer, /strata approval/i);
  assert.deepEqual(answer.suggestedQuestions, []);
});

test("unknown body-corporate status is checked before external window changes", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    propertyType: "house",
    approvalContext: "not_sure",
    features: [
      "comfort-too-cold",
      "single-glazing",
      "window-coverings-basic",
      "external-shading-none",
      "reverse-cycle",
    ],
  }));
  assert.ok(context);
  const answer = composeSurgePlanPriorityAnswer("Where should I start?", context);
  assert.ok(answer);
  assert.match(answer.directAnswer, /check whether strata, body-corporate or other approval applies/i);
  assert.doesNotMatch(answer.directAnswer, /add external shade where strong summer sun/i);
});

test("an explicit No answer overrides property type when ranking window work", () => {
  for (const propertyType of ["house", "apartment"]) {
    const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
      propertyType,
      approvalContext: "none",
      features: [
        "comfort-too-cold",
        "single-glazing",
        "window-coverings-basic",
        "external-shading-none",
      ],
    }));
    assert.ok(context);
    const answer = composeSurgePlanPriorityAnswer("Where should I start?", context);
    assert.ok(answer);
    assert.doesNotMatch(answer.directAnswer, /get strata approval|check whether strata|body-corporate/i, propertyType);
    assert.match(answer.directAnswer, /external shade/i, propertyType);
  }
});

test("active moisture and roof damage are treated as one source-control priority", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4, {
    roofCondition: "known_issue",
    features: [
      "comfort-too-cold",
      "condensation-moisture",
      "single-glazing",
      "bathroom-exhaust-none",
    ],
  }));
  assert.ok(context);
  const answer = composeSurgePlanPriorityAnswer("Where should I start?", context);
  assert.ok(answer);
  assert.match(answer.directAnswer, /start with the source of the moisture/i);
  assert.match(answer.directAnswer, /roof issue as a possible moisture source/i);
  assert.ok(
    answer.directAnswer.indexOf("made watertight first")
      < answer.directAnswer.indexOf("control indoor condensation"),
  );
  assert.doesNotMatch(answer.directAnswer, /adding insulation or sealing gaps[^.]*before/i);
});

test("a yearly electricity bill is not mistaken for the upgrade budget", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4));
  assert.ok(context);
  const answer = composeSurgePlanPriorityAnswer(
    "Based on my answers, where should I start? My electricity bill is $600 a year.",
    context,
  );
  assert.ok(answer);
  assert.match(answer.directAnswer, /\$2,000 to \$10,000 to spend first/i);
  assert.doesNotMatch(answer.directAnswer, /\$600 to spend first/i);
});

test("newer saved-home corrections retire only the affected plan facts", () => {
  const context = buildSurgePlanContextFromStoredAssessment(storedAssessment(4));
  assert.ok(context);
  assert.equal(composeSurgePlanPriorityAnswer(
    "What should I do first?",
    context,
    [{ role: "user", content: "Correction: I now rent in postcode 5067." }],
  ), null);

  const moistureAnswer = composeSurgePlanPriorityAnswer(
    "What should I do first?",
    context,
    [{ role: "user", content: "We fixed the condensation last month." }],
  );
  assert.ok(moistureAnswer);
  assert.doesNotMatch(moistureAnswer.directAnswer, /start with moisture|control condensation first/i);
  assert.match(moistureAnswer.directAnswer, /single glazed|window/i);

  const glazingAnswer = composeSurgePlanPriorityAnswer(
    "What should I do first?",
    context,
    [{ role: "user", content: "The windows have been replaced with double glazing." }],
  );
  assert.ok(glazingAnswer);
  assert.doesNotMatch(glazingAnswer.directAnswer, /mostly single glazed/i);
});

test("plan corrections are subject-aware, negation-aware and facet-specific", () => {
  const context = {
    version: 1,
    source: "home_energy_plan",
    facts: [
      { key: "comfort_concerns", value: "Too cold in cool weather, Condensation, damp or mould" },
      { key: "glazing", value: "Mostly single glazed" },
      { key: "ceiling_insulation", value: "No ceiling insulation" },
    ],
  };
  const factsAfter = (message, existing = [], recentTurns = []) => {
    const corrections = surgePlanContextCorrectionsAfterRecentHomeFactChanges(
      existing,
      message,
      recentTurns,
    );
    return {
      corrections,
      facts: new Map(applySurgePlanContextCorrections(context, corrections).facts
        .map((fact) => [fact.key, fact.value])),
    };
  };

  const clauseExpectedCorrections = new Map([
    ["We fixed the condensation and asked about solar.", ["comfort_moisture_resolved"]],
    ["We installed solar and the battery quote is expensive.", ["solar_changed"]],
    ["We repaired the roof leak and still have an old switchboard.", ["roof_condition_changed"]],
  ]);
  for (const message of [
    "Mum fixed the condensation in her house.",
    "The condensation in my investment property is fixed.",
    "The condensation was not fixed.",
    "I thought the condensation was fixed, but it is back.",
    "We might have fixed the condensation.",
    "Maybe we fixed the condensation.",
    "I think we fixed the condensation.",
    "The condensation may be fixed.",
    "We probably fixed the condensation.",
    "Is the condensation fixed?",
    "Could the condensation be fixed?",
    "I want the condensation fixed.",
    "If the condensation is fixed, what should I do next?",
    "The quote says the condensation will be fixed.",
    "Are the windows replaced?",
    "I want solar installed.",
    "Once the insulation is upgraded, what comes next?",
  ]) {
    const result = factsAfter(message);
    assert.deepEqual(result.corrections, [], message);
    assert.match(result.facts.get("comfort_concerns"), /Condensation, damp or mould/i, message);
  }

  const moistureOnly = factsAfter("We fixed the condensation, but the windows were not replaced.");
  assert.deepEqual(moistureOnly.corrections, ["comfort_moisture_resolved"]);
  assert.equal(moistureOnly.facts.get("comfort_concerns"), "Too cold in cool weather");
  assert.equal(moistureOnly.facts.get("glazing"), "Mostly single glazed");

  const glazingOnly = factsAfter("The windows were replaced, but the insulation was not upgraded.");
  assert.deepEqual(glazingOnly.corrections, ["glazing_changed"]);
  assert.equal(glazingOnly.facts.has("glazing"), false);
  assert.equal(glazingOnly.facts.get("ceiling_insulation"), "No ceiling insulation");

  const baseVerbNegation = factsAfter(
    "We did not fix the condensation and we did not replace the windows.",
    ["comfort_moisture_resolved", "glazing_changed"],
  );
  assert.deepEqual(baseVerbNegation.corrections, []);

  const andScoped = factsAfter("We fixed the condensation and the windows were not replaced.");
  assert.deepEqual(andScoped.corrections, ["comfort_moisture_resolved"]);

  const crossSubject = factsAfter(
    "Mum's condensation is back, but in our home the windows were replaced.",
    ["comfort_moisture_resolved"],
  );
  assert.deepEqual(
    crossSubject.corrections,
    ["comfort_moisture_resolved", "glazing_changed"],
  );

  const fixedAgain = factsAfter("The condensation is fixed again.");
  assert.deepEqual(fixedAgain.corrections, ["comfort_moisture_resolved"]);

  for (const [message, expected] of [
    [
      "We fixed the condensation and draughts.",
      ["comfort_moisture_resolved", "comfort_draught_resolved"],
    ],
    ["We replaced the windows and insulation.", ["glazing_changed", "insulation_changed"]],
    ["We installed solar and a battery.", ["solar_changed", "battery_changed"]],
    ["We replaced the heater and hot water.", ["heating_cooling_changed", "hot_water_changed"]],
  ]) {
    assert.deepEqual(factsAfter(message).corrections, expected, message);
  }

  for (const message of [
    "We fixed the condensation and asked about solar.",
    "We installed solar and the battery quote is expensive.",
    "We repaired the roof leak and still have an old switchboard.",
    "The windows have new curtains.",
    "Solar has a new tariff.",
    "The battery has a new warranty.",
    "The heater has a new timer.",
    "The insulation has a new inspection report.",
    "The switchboard has a new label.",
    "The hot-water system has a new tariff.",
    "The exhaust fan has a new noise.",
    "The battery installer replaced the switchboard.",
    "The heater technician repaired the switchboard.",
    "The insulation installer fixed the roof leak.",
    "The exhaust fan installer replaced the bathroom light.",
    "We can proceed once the windows are replaced.",
    "The next step depends on whether solar is installed.",
    "I have a battery quote.",
    "We have solar quotes.",
    "I have solar panels quoted.",
    "We now have a bathroom exhaust fan quote.",
    "We have a new switchboard quote.",
    "I now have a reverse-cycle air conditioner quote.",
    "Our office installed a battery.",
    "We replaced the windows at the shop.",
    "The builder replaced the windows in his home.",
    "We installed solar at our warehouse.",
    "We replaced the window coverings.",
    "We installed a battery monitor.",
    "We installed solar monitoring.",
    "We replaced the heating thermostat.",
    "We installed a hot water timer.",
    "We replaced the switchboard label.",
    "We installed insulation monitoring sensors.",
    "Our quote is for replaced windows.",
    "The option is replaced windows.",
    "The proposed work is installed solar.",
    "The invoice says installed solar.",
    "The ad says this house has installed solar.",
    "I read that they installed solar.",
    "My friend says we installed solar at our home.",
    "The owner said solar was installed in our house.",
    "The report said solar was installed in our home.",
    "Apparently our home windows were replaced.",
    "Supposedly solar was installed in our home.",
    "They claim the windows were replaced in our home.",
    "According to the installer, the windows were replaced.",
    "John installed solar last month.",
    "They installed solar last month.",
    "The electrician installed solar.",
    "Sarah replaced the windows.",
    "He replaced the windows.",
    "She fixed the condensation.",
    "The roofer fixed the roof leak.",
    "We installed solar at our rental.",
    "We installed solar on the rental.",
    "We installed solar at our old house.",
    "We installed solar at our previous home.",
    "We installed solar at our former property.",
    "We installed solar at our prior apartment.",
    "We installed solar at our new house.",
    "We installed solar at a different property.",
    "We installed solar at our vacation home.",
    "We installed solar at our weekend house.",
    "We installed solar at our secondary residence.",
    "We installed solar at our beach house.",
    "We installed solar at our weekender.",
    "We installed solar at our Airbnb.",
    "I thought our solar panels went in.",
    "We had planned to have solar put in last month.",
    "We had a plan to get solar put in.",
    "The solar panels never went in.",
    "I was wrong; the solar panels never went in.",
    "We did not have solar put in.",
    "We never got a battery.",
    "Did you say the windows were replaced and solar installed?",
    "Were the windows replaced and solar installed?",
    "Have the windows been replaced and solar installed?",
    "Are the windows replaced and the battery installed?",
    "Is it true the windows were replaced, but solar was installed?",
    "If the windows are replaced and solar installed, what comes next?",
    "Once the windows are replaced and solar installed, what comes next?",
    "When the windows are replaced and the battery installed, what comes next?",
    "We want replaced windows and installed solar.",
    "Maybe the windows were replaced and solar installed.",
    "I think the windows were replaced and solar installed.",
    "No windows were replaced.",
    "Nobody installed solar.",
    "Neither the windows nor the insulation were replaced.",
    "I have solar questions.",
    "We now have solar questions.",
    "I have solar information.",
    "I have a battery question.",
    "I have double glazing questions.",
    "What if the windows were replaced and solar installed?",
    "What about the windows being replaced and solar installed?",
    "Which windows were replaced and solar installed?",
    "Why were the windows replaced and solar installed?",
    "Who replaced the windows and installed solar?",
    "How were the windows replaced and solar installed?",
  ]) {
    const expected = clauseExpectedCorrections.get(message) || [];
    assert.deepEqual(factsAfter(message).corrections, expected, message);
  }

  for (const [message, expected] of [
    ["We have double glazing now.", ["glazing_changed"]],
    ["We now have solar.", ["solar_changed"]],
    ["We now have a home battery.", ["battery_changed"]],
    ["There is good ceiling insulation now.", ["ceiling_insulation_changed"]],
    ["The switchboard has circuit breakers now.", ["switchboard_changed"]],
    ["We use reverse-cycle heating now.", ["heating_cooling_changed"]],
    ["We now have a bathroom exhaust fan.", ["exhaust_changed"]],
    ["Our hot-water system is a heat pump now.", ["hot_water_changed"]],
    ["The roof is sound and has no leaks now.", ["roof_condition_changed"]],
    ["There are no draughts now.", ["comfort_draught_resolved"]],
    ["We replaced the old gas heater with reverse-cycle air conditioning.", ["heating_cooling_changed"]],
    ["We installed a 6.6 kW solar system.", ["solar_changed"]],
    ["We installed 10 kW of solar panels.", ["solar_changed"]],
    ["We installed a 13 kWh home battery.", ["battery_changed"]],
    ["We installed an R6 ceiling insulation upgrade.", ["ceiling_insulation_changed"]],
    ["We installed a 250 litre heat-pump hot-water system.", ["hot_water_changed"]],
    ["We added two bathroom exhaust fans.", ["exhaust_changed"]],
    ["We installed 6.6 kW solar.", ["solar_changed"]],
    ["We installed 6.6 kW of solar panels.", ["solar_changed"]],
    ["We replaced the 6.6 kW system with 13 kW solar.", ["solar_changed"]],
    ["We had solar put in last month.", ["solar_changed"]],
    ["The solar panels went in last month.", ["solar_changed"]],
    ["We had double glazing put in last month.", ["glazing_changed"]],
    ["We got a battery last month.", ["battery_changed"]],
    ["We installed a new home battery.", ["battery_changed"]],
    ["We installed a brand-new home battery.", ["battery_changed"]],
    ["We added a new home battery.", ["battery_changed"]],
    ["We replaced our old home battery.", ["battery_changed"]],
    ["We upgraded our old home battery.", ["battery_changed"]],
    ["We installed a 6.6kW solar system.", ["solar_changed"]],
    ["John installed solar in our home.", ["solar_changed"]],
    ["The electrician replaced our switchboard.", ["switchboard_changed"]],
  ]) {
    assert.deepEqual(factsAfter(message).corrections, expected, message);
  }

  const returned = factsAfter("The condensation is back.", ["comfort_moisture_resolved"]);
  assert.deepEqual(returned.corrections, []);
  assert.match(returned.facts.get("comfort_concerns"), /Condensation, damp or mould/i);

  const contextualReturn = factsAfter(
    "Actually it is back.",
    ["comfort_moisture_resolved", "glazing_changed"],
    [{ role: "user", content: "We fixed the condensation last month." }],
  );
  assert.deepEqual(contextualReturn.corrections, ["glazing_changed"]);

  const glazingUnchanged = factsAfter(
    "Actually, the windows are still single glazed.",
    ["glazing_changed"],
  );
  assert.deepEqual(glazingUnchanged.corrections, []);

  assert.deepEqual(
    factsAfter("Is the condensation fixed?", ["comfort_moisture_resolved"]).corrections,
    ["comfort_moisture_resolved"],
  );
  assert.deepEqual(
    factsAfter("Maybe the condensation is fixed.", ["comfort_moisture_resolved"]).corrections,
    [],
  );
  for (const message of [
    "Maybe the condensation is not fixed.",
    "I think the condensation might still be there.",
    "I am not sure the condensation was fixed.",
  ]) {
    assert.deepEqual(
      factsAfter(message, ["comfort_moisture_resolved"]).corrections,
      [],
      message,
    );
    assert.deepEqual(factsAfter(message).corrections, [], message);
  }

  for (const [correction, message] of [
    ["comfort_draught_resolved", "The draught is back."],
    ["roof_condition_changed", "The roof leak is back."],
    ["glazing_changed", "The windows are still single glazed."],
    ["insulation_changed", "The insulation is still old and patchy."],
    ["switchboard_changed", "The switchboard still has ceramic fuses."],
    ["heating_cooling_changed", "We still use the old gas heater."],
    ["exhaust_changed", "There is still no bathroom exhaust fan."],
    ["solar_changed", "Actually I was wrong; we still do not have solar."],
    ["battery_changed", "We still have no battery."],
    ["hot_water_changed", "The hot-water is still electric resistive."],
  ]) {
    assert.deepEqual(factsAfter(message, [correction]).corrections, [], message);
  }
});

test("facet-specific corrections preserve unrelated saved-home facts", () => {
  const context = {
    version: 1,
    source: "home_energy_plan",
    facts: [
      { key: "ceiling_insulation", value: "No ceiling insulation" },
      { key: "wall_insulation", value: "Wall insulation unknown" },
      { key: "floor_insulation", value: "No floor insulation" },
      { key: "switchboard", value: "Ceramic fuses" },
      { key: "electrical_supply", value: "Single phase" },
      { key: "exhaust_fans", value: "No bathroom exhaust fan" },
      { key: "ventilation_features", value: "Openable windows" },
    ],
  };
  const correctionsFor = (message) => (
    surgePlanContextCorrectionsAfterRecentHomeFactChanges([], message, [])
  );

  const ceiling = applySurgePlanContextCorrections(
    context,
    correctionsFor("We installed ceiling insulation."),
  );
  assert.ok(ceiling);
  assert.equal(ceiling.facts.some((fact) => fact.key === "ceiling_insulation"), false);
  assert.equal(ceiling.facts.some((fact) => fact.key === "wall_insulation"), true);
  assert.equal(ceiling.facts.some((fact) => fact.key === "floor_insulation"), true);

  const switchboard = applySurgePlanContextCorrections(
    context,
    correctionsFor("We upgraded the switchboard."),
  );
  assert.ok(switchboard);
  assert.equal(switchboard.facts.some((fact) => fact.key === "switchboard"), false);
  assert.equal(switchboard.facts.some((fact) => fact.key === "electrical_supply"), true);

  const exhaust = applySurgePlanContextCorrections(
    context,
    correctionsFor("We installed a bathroom exhaust fan."),
  );
  assert.ok(exhaust);
  assert.equal(exhaust.facts.some((fact) => fact.key === "exhaust_fans"), false);
  assert.equal(exhaust.facts.some((fact) => fact.key === "ventilation_features"), true);

  const conversationState = {
    version: 1,
    activeTopic: "electrical_supply",
    goal: "Check the switchboard without changing the electrical supply",
    facts: [
      { key: "switchboard", value: "Ceramic fuses" },
      { key: "electrical_supply", value: "Single phase electrical supply" },
    ],
    pendingQuestion: "",
    lastAnswerSummary: "",
    ledger: {
      turn: 1,
      activeDecisionId: "decision_1_electrical_supply",
      subjects: [{
        id: "saved_home",
        kind: "saved_home",
        label: "Saved home",
        facts: [
          { key: "switchboard", value: "Ceramic fuses", source: "plan", updatedTurn: 1 },
          { key: "electrical_supply", value: "Single phase electrical supply", source: "plan", updatedTurn: 1 },
        ],
        lastTouchedTurn: 1,
      }],
      decisions: [{
        id: "decision_1_electrical_supply",
        subjectIds: ["saved_home"],
        topic: "electrical_supply",
        goal: "Check the switchboard without changing the electrical supply",
        facts: [
          { key: "switchboard", value: "Ceramic fuses", source: "plan", updatedTurn: 1 },
          { key: "electrical_supply", value: "Single phase electrical supply", source: "plan", updatedTurn: 1 },
        ],
        outcomeSummary: "",
        openItems: [],
        pendingQuestion: "",
        status: "resolved",
        lastTouchedTurn: 1,
      }],
    },
  };
  const correctedState = applySurgePlanContextCorrectionsToConversationState(
    conversationState,
    ["switchboard_changed"],
  );
  assert.match(JSON.stringify(correctedState), /Single phase electrical supply/i);
  assert.doesNotMatch(JSON.stringify(correctedState), /Ceramic fuses/i);
});
