import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CUSTOMER_ADVISOR_PROFILE_VERSION,
  CUSTOMER_LEGACY_PLAN_VERSIONS,
  CUSTOMER_PLAN_VERSION,
  MAX_HOME_FEATURE_SELECTIONS,
  createCustomerProjectPlan,
  customerHomeFeatureSections,
  customerProjectOptions,
  normalizeCustomerProject,
  normalizeHomeFeatureSelections,
  updateHomeFeatureSelection,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const publicPlanner = read("../src/components/HomeEnergyPlanner.tsx");
const sharedIntake = read("../src/components/HomeFeatureIntake.tsx");
const publicPlanPage = read("../src/app/plan/page.tsx");
const newProjectPage = read("../src/app/account/projects/new/page.tsx");

const question = (id) => customerHomeFeatureSections
  .flatMap((section) => section.questions)
  .find((item) => item.id === id);

test("the universal taxonomy is grouped, bounded and contains the required home states", () => {
  assert.equal(MAX_HOME_FEATURE_SELECTIONS, 32);
  assert.deepEqual(
    customerHomeFeatureSections.map((section) => section.id),
    [
      "comfort",
      "insulation",
      "windows",
      "ventilation",
      "heating-cooling",
      "hot-water-cooking",
      "solar-storage-transport",
    ],
  );
  assert.deepEqual(
    question("ceiling-insulation").options.map(([value]) => value),
    [
      "ceiling-insulation-none",
      "ceiling-insulation-limited",
      "ceiling-insulation-well",
      "ceiling-insulation-not-applicable",
      "ceiling-insulation-unknown",
    ],
  );
  assert.deepEqual(
    question("window-coverings").options.map(([value]) => value),
    [
      "window-coverings-none",
      "window-coverings-basic",
      "window-coverings-thermal",
      "window-coverings-mixed",
      "window-coverings-unknown",
    ],
  );
  assert.deepEqual(
    question("hot-water").options
      .map(([value]) => value)
      .filter((value) => value.startsWith("gas-")),
    [
      "gas-storage-hot-water",
      "gas-continuous-flow-hot-water",
      "gas-hot-water-type-unknown",
    ],
  );
  assert.deepEqual(
    question("electrical-supply").options.map(([value]) => value),
    [
      "electrical-supply-single-phase",
      "electrical-supply-three-phase",
      "electrical-supply-unknown",
    ],
  );
  assert.deepEqual(
    question("exhaust-fans").options.map(([value]) => value),
    [
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "exhaust-fans-none",
      "exhaust-fans-unknown",
    ],
  );
  assert.match(question("exhaust-fans").label, /which kitchen or bathroom exhaust fans/i);
  assert.match(question("exhaust-fans").help, /do not need to know where they vent/i);
  assert.equal(question("exhaust-discharge"), undefined);
  assert.equal(question("exhaust-damper"), undefined);
  assert.equal(question("comfort-concerns").unknownValue, "comfort-unknown");
  assert.ok(
    question("comfort-concerns").options.some(
      ([value, label]) => value === "comfort-unknown" && label === "Not sure",
    ),
  );
  assert.ok(
    customerProjectOptions.homeFeatures.some(
      ([value, label]) =>
        value === "window-coverings-thermal"
        && /honeycomb.+heavy curtains with pelmets/i.test(label),
    ),
  );
});

test("single-answer questions and multiple-answer sentinels cannot contradict", () => {
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "ceiling-insulation-none",
      "ceiling-insulation-well",
    ]),
    ["ceiling-insulation-unknown"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "single-glazing",
      "double-glazing",
    ]),
    ["mixed-glazing"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "single-glazing",
      "glazing-unknown",
    ]),
    ["glazing-unknown"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "reverse-cycle",
      "gas-heating",
    ]),
    ["reverse-cycle", "gas-heating"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "reverse-cycle",
      "heating-cooling-unknown",
    ]),
    ["heating-cooling-unknown"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "open-wall-vents",
      "ventilation-none-known",
    ]),
    ["ventilation-none-known"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
    ]),
    [
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
    ],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "kitchen-exhaust-fan",
      "exhaust-fans-unknown",
    ]),
    ["exhaust-fans-unknown"],
  );
});

test("the pure selection reducer clears only the relevant question", () => {
  const initial = [
    "ceiling-insulation-none",
    "single-glazing",
    "external-shading",
    "reverse-cycle",
  ];
  const insulationChanged = updateHomeFeatureSelection(
    initial,
    "ceiling-insulation",
    "ceiling-insulation-well",
  );
  assert.deepEqual(insulationChanged, [
    "ceiling-insulation-well",
    "single-glazing",
    "external-shading",
    "reverse-cycle",
  ]);
  const heatingAdded = updateHomeFeatureSelection(
    insulationChanged,
    "heating-cooling-systems",
    "gas-heating",
  );
  assert.deepEqual(heatingAdded, [
    "ceiling-insulation-well",
    "single-glazing",
    "external-shading",
    "reverse-cycle",
    "gas-heating",
  ]);
  const heatingUnknown = updateHomeFeatureSelection(
    heatingAdded,
    "heating-cooling-systems",
    "heating-cooling-unknown",
  );
  assert.equal(heatingUnknown.includes("reverse-cycle"), false);
  assert.equal(heatingUnknown.includes("gas-heating"), false);
  assert.equal(heatingUnknown.includes("heating-cooling-unknown"), true);
  assert.equal(heatingUnknown.includes("single-glazing"), true);
});

test("internal coverings and external shade remain separate compatible answers", () => {
  const selected = normalizeHomeFeatureSelections([
    "window-coverings-thermal",
    "external-shading-most",
  ]);
  assert.deepEqual(selected, [
    "window-coverings-thermal",
    "external-shading-most",
  ]);
});

test("legacy home features map deterministically without inventing insulation quality", () => {
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "roof-insulation",
      "wall-insulation",
      "floor-insulation",
      "internal-window-coverings",
    ]),
    [
      "ceiling-insulation-unknown",
      "wall-insulation-unknown",
      "floor-insulation-unknown",
      "window-coverings-unknown",
    ],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "insulation-unknown",
      "unsafe-feature",
    ]),
    [
      "ceiling-insulation-unknown",
      "wall-insulation-unknown",
      "floor-insulation-unknown",
    ],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "gas-hot-water",
      "exhaust-ducted-outside",
    ]),
    [
      "exhaust-fans-unknown",
      "gas-hot-water-type-unknown",
    ],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "exhaust-discharge-cavity",
      "exhaust-damper-known",
    ]),
    ["exhaust-fans-unknown"],
  );
  assert.deepEqual(
    normalizeHomeFeatureSelections([
      "exhaust-discharge-outside",
      "bathroom-exhaust-fan",
    ]),
    ["bathroom-exhaust-fan"],
  );
  assert.deepEqual(
    updateHomeFeatureSelection(
      ["gas-hot-water"],
      "hot-water",
      "gas-storage-hot-water",
    ),
    ["gas-storage-hot-water"],
  );
});

test("gas hot-water variants retain gas advice without guessing the legacy type", () => {
  const plans = new Map();
  for (const feature of [
    "gas-storage-hot-water",
    "gas-continuous-flow-hot-water",
    "gas-hot-water-type-unknown",
  ]) {
    const plan = createCustomerProjectPlan({
      goals: ["lower-bills"],
      situation: "owner",
      features: [feature],
    });
    assert.equal(plan.items.some((item) => item.id === "compare-gas"), true);
    assert.equal(plan.items.some((item) => item.id === "hot-water"), true);
    plans.set(feature, plan);
  }
  const storage = plans.get("gas-storage-hot-water").items.find(
    (item) => item.id === "hot-water",
  );
  const continuous = plans.get("gas-continuous-flow-hot-water").items.find(
    (item) => item.id === "hot-water",
  );
  const unknown = plans.get("gas-hot-water-type-unknown").items.find(
    (item) => item.id === "hot-water",
  );
  assert.match(storage.title, /storage tank/i);
  assert.match(storage.text, /tank capacity/i);
  assert.match(continuous.title, /continuous-flow/i);
  assert.match(continuous.text, /rated flow/i);
  assert.match(unknown.title, /confirm which type/i);
  assert.match(unknown.text, /do not infer the type/i);
  assert.notEqual(storage.text, continuous.text);
  assert.notEqual(continuous.text, unknown.text);
  assert.deepEqual(
    normalizeHomeFeatureSelections(["gas-hot-water"]),
    ["gas-hot-water-type-unknown"],
  );
  const normalized = normalizeCustomerProject({
    title: "Unknown gas hot water",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    goals: ["move-from-gas"],
    existingFeatures: ["gas-hot-water-type-unknown"],
  });
  assert.equal(normalized.ok, true);
  assert.equal(
    normalized.project.advisorProfile.factEvidence.find(
      (item) => item.factKey === "hot-water",
    ).source,
    "unknown",
  );
});

test("electrical supply is a household planning clue and never capacity proof", () => {
  for (const feature of [
    "electrical-supply-single-phase",
    "electrical-supply-three-phase",
  ]) {
    const plan = createCustomerProjectPlan({
      goals: ["move-from-gas"],
      situation: "owner",
      features: [feature],
    });
    const capacityStep = plan.items.find(
      (item) => item.id === "electrical-supply-check",
    );
    assert.ok(capacityStep);
    assert.match(capacityStep.title, /reported (single|three)-phase supply/i);
    assert.match(capacityStep.text, /has not been verified/i);
    assert.match(capacityStep.text, /does not prove available capacity/i);
    assert.match(capacityStep.text, /licensed electrician should confirm/i);
  }
  const unknown = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    features: ["electrical-supply-unknown"],
  });
  assert.match(
    unknown.items.find((item) => item.id === "electrical-supply-check").text,
    /planning clue only/i,
  );
});

test("plain exhaust fan answers provide useful advice without asking technical fan details", () => {
  const plan = createCustomerProjectPlan({
    goals: ["healthier-home"],
    situation: "owner",
    features: ["kitchen-exhaust-fan", "bathroom-exhaust-fan"],
  });
  assert.equal(
    plan.items.some((item) => item.id === "exhaust-discharge-review"),
    false,
  );
  assert.match(
    plan.everydayActions.find((item) => item.id === "moisture-safe-routine").text,
    /while cooking or showering/i,
  );
  assert.match(
    plan.everydayActions.find((item) => item.id === "moisture-safe-routine").text,
    /do not enter a roof or ceiling cavity/i,
  );
});

test("answered canonical facts become customer reported without weakening stronger sources", () => {
  const normalized = normalizeCustomerProject({
    title: "Home facts",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    goals: ["improve-comfort"],
    existingFeatures: [
      "single-glazing",
      "window-coverings-thermal",
      "external-shading-none",
      "ceiling-insulation-limited",
      "wall-insulation-unknown",
      "ventilation-none-known",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "heating-cooling-none",
      "electrical-supply-single-phase",
      "solar-none",
      "ev-none",
    ],
    propertyContext: {
      roofType: "metal",
      switchboard: "modern_breakers",
    },
    advisorProfile: {
      factEvidence: [
        { factKey: "glazing", source: "photo-supported" },
        { factKey: "ceiling-insulation", source: "unknown" },
        { factKey: "wall-insulation", source: "customer-reported" },
      ],
    },
  });
  assert.equal(normalized.ok, true);
  const sources = new Map(
    normalized.project.advisorProfile.factEvidence.map((item) => [
      item.factKey,
      item.source,
    ]),
  );
  assert.equal(sources.get("glazing"), "photo-supported");
  assert.equal(sources.get("window-coverings"), "customer-reported");
  assert.equal(sources.get("external-shading"), "customer-reported");
  assert.equal(sources.get("ceiling-insulation"), "customer-reported");
  assert.equal(sources.get("wall-insulation"), "unknown");
  assert.equal(sources.get("ventilation"), "customer-reported");
  assert.equal(sources.get("heating-cooling"), "customer-reported");
  assert.equal(sources.get("solar"), "customer-reported");
  assert.equal(sources.get("ev"), "customer-reported");
  assert.equal(sources.get("roof"), "customer-reported");
  assert.equal(sources.get("switchboard"), "customer-reported");
  assert.equal(sources.get("electrical-supply"), "customer-reported");
  assert.equal(sources.get("floor-insulation"), "unknown");
});

test("ventilation evidence stays unknown until every related question is addressed", () => {
  const sourceFor = (existingFeatures) => {
    const normalized = normalizeCustomerProject({
      title: "Ventilation evidence",
      postcode: "3000",
      addressState: "VIC",
      propertyType: "house",
      householdSituation: "owner",
      goals: ["healthier-home"],
      existingFeatures,
    });
    assert.equal(normalized.ok, true);
    return normalized.project.advisorProfile.factEvidence.find(
      (item) => item.factKey === "ventilation",
    ).source;
  };
  assert.equal(sourceFor(["kitchen-exhaust-fan"]), "unknown");
  assert.equal(
    sourceFor([
      "ventilation-none-known",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
    ]),
    "customer-reported",
  );
  assert.equal(
    sourceFor([
      "ventilation-unknown",
      "bathroom-exhaust-fan",
    ]),
    "unknown",
  );
  assert.equal(
    sourceFor([
      "ventilation-none-known",
      "exhaust-fans-unknown",
    ]),
    "unknown",
  );
  assert.equal(
    sourceFor([
      "ventilation-none-known",
      "exhaust-fans-none",
    ]),
    "customer-reported",
  );
});

test("explicitly unknown property facts remain unknown", () => {
  const normalized = normalizeCustomerProject({
    title: "Unknown property facts",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    goals: ["lower-bills"],
    propertyContext: {
      roofType: "not_sure",
      switchboard: "not_sure",
    },
  });
  assert.equal(normalized.ok, true);
  const sources = new Map(
    normalized.project.advisorProfile.factEvidence.map((item) => [
      item.factKey,
      item.source,
    ]),
  );
  assert.equal(sources.get("roof"), "unknown");
  assert.equal(sources.get("switchboard"), "unknown");
  assert.equal(sources.get("electrical-supply"), "unknown");
});

test("current Not sure answers override stale photo or document source labels", () => {
  const normalized = normalizeCustomerProject({
    title: "Unknown overrides stale evidence",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    goals: ["improve-comfort"],
    existingFeatures: [
      "glazing-unknown",
      "ceiling-insulation-unknown",
      "exhaust-fans-unknown",
      "electrical-supply-unknown",
    ],
    propertyContext: {
      roofType: "not_sure",
      switchboard: "not_sure",
    },
    advisorProfile: {
      factEvidence: [
        { factKey: "glazing", source: "photo-supported" },
        { factKey: "ceiling-insulation", source: "document-supported" },
        { factKey: "ventilation", source: "photo-supported" },
        { factKey: "roof", source: "photo-supported" },
        { factKey: "switchboard", source: "document-supported" },
      ],
    },
  });
  assert.equal(normalized.ok, true);
  const sources = new Map(
    normalized.project.advisorProfile.factEvidence.map((item) => [
      item.factKey,
      item.source,
    ]),
  );
  assert.equal(sources.get("glazing"), "unknown");
  assert.equal(sources.get("ceiling-insulation"), "unknown");
  assert.equal(sources.get("ventilation"), "unknown");
  assert.equal(sources.get("roof"), "unknown");
  assert.equal(sources.get("switchboard"), "unknown");
  assert.equal(sources.get("electrical-supply"), "unknown");
});

test("insulation and covering states produce different neutral recommendations", () => {
  const planFor = (features) => createCustomerProjectPlan({
    goals: ["improve-comfort"],
    situation: "owner",
    pace: "staged",
    features,
  });
  const limited = planFor(["ceiling-insulation-limited"]);
  const unknown = planFor(["ceiling-insulation-unknown"]);
  const well = planFor(["ceiling-insulation-well"]);
  assert.match(
    limited.items.find((item) => item.id === "insulation-review").title,
    /missing, old or patchy/i,
  );
  assert.match(
    unknown.items.find((item) => item.id === "insulation-review").title,
    /verify insulation/i,
  );
  assert.match(
    well.items.find((item) => item.id === "insulation-review").text,
    /do not assume more insulation is automatically required/i,
  );

  const basic = planFor(["window-coverings-basic"]);
  const thermal = planFor(["window-coverings-thermal"]);
  assert.match(
    basic.items.find((item) => item.id === "windows-glazing").title,
    /close-fitting window coverings/i,
  );
  assert.match(
    thermal.items.find((item) => item.id === "windows-glazing").title,
    /frames, seals and remaining/i,
  );
});

test("solar unknown never enables a battery recommendation", () => {
  const unknown = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    features: ["solar-unknown", "battery-none"],
  });
  const installed = createCustomerProjectPlan({
    goals: ["add-solar-storage"],
    situation: "owner",
    features: ["solar", "battery-none"],
  });
  assert.equal(unknown.items.some((item) => item.id === "battery"), false);
  assert.equal(installed.items.some((item) => item.id === "battery"), true);
});

test("evidence readiness is not an ordered roadmap action", () => {
  const plan = createCustomerProjectPlan({
    goals: ["improve-comfort"],
    situation: "owner",
    features: ["ceiling-insulation-unknown", "glazing-unknown"],
  });
  assert.equal(
    plan.items.some((item) => item.id === "evidence-confidence"),
    false,
  );
  assert.ok(plan.nextQuestions.length > 0);
});

test("the public planner uses the accessible shared intake and bounded query handoff", () => {
  assert.match(publicPlanner, /HomeFeatureIntake/);
  assert.match(publicPlanner, /idPrefix="public-home-feature"/);
  assert.match(sharedIntake, /<fieldset/);
  assert.match(sharedIntake, /id=\{`\$\{idPrefix\}-\$\{question\.id\}`\}/);
  assert.match(sharedIntake, /<legend>\{question\.label\}<\/legend>/);
  assert.match(sharedIntake, /question\.mode === "single" \? "radio" : "checkbox"/);
  assert.match(sharedIntake, /updateHomeFeatureSelection\(/);
  assert.match(publicPlanPage, /MAX_HOME_FEATURE_SELECTIONS/);
  assert.match(newProjectPage, /MAX_HOME_FEATURE_SELECTIONS/);
  assert.match(newProjectPage, /normalizeHomeFeatureSelections/);
});

test("the taxonomy release is versioned and the previous plan remains migratable", () => {
  assert.equal(CUSTOMER_PLAN_VERSION, "2026-07-31-trade-enquiry-home-systems-v5");
  assert.equal(
    CUSTOMER_ADVISOR_PROFILE_VERSION,
    "2026-07-31-advisor-profile-v5",
  );
  assert.equal(
    CUSTOMER_LEGACY_PLAN_VERSIONS.includes(
      "2026-07-30-roadmap-context-v4",
    ),
    true,
  );
});
