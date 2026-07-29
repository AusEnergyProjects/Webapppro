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
      "heating-cooling-none",
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
  assert.equal(sources.get("floor-insulation"), "unknown");
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
    ],
    propertyContext: {
      roofType: "not_sure",
      switchboard: "not_sure",
    },
    advisorProfile: {
      factEvidence: [
        { factKey: "glazing", source: "photo-supported" },
        { factKey: "ceiling-insulation", source: "document-supported" },
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
  assert.equal(sources.get("roof"), "unknown");
  assert.equal(sources.get("switchboard"), "unknown");
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
  assert.equal(CUSTOMER_PLAN_VERSION, "2026-07-29-adviser-print-comfort-v3");
  assert.equal(
    CUSTOMER_ADVISOR_PROFILE_VERSION,
    "2026-07-29-advisor-profile-v4",
  );
  assert.equal(
    CUSTOMER_LEGACY_PLAN_VERSIONS.includes(
      "2026-07-29-home-feature-taxonomy-v2",
    ),
    true,
  );
});
