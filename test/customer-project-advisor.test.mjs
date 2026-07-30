import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildAnonymizedOpportunity,
  buildInstallerPropertyContext,
  CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY,
  CUSTOMER_PLAN_VERSION,
  createCustomerProjectPlan,
  customerProjectOptions,
  normalizeCustomerProject,
  preserveEditedPlanItems,
  reconcileCompletedPlanItems,
  submissionReadiness,
  validateCustomerProfile,
} from "../src/lib/customer-projects.mjs";
import {
  matchedServiceCategories,
  selectInstallerCandidatesForCoverage,
} from "../src/lib/trade-service-matching.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0081_customer_project_advisor.sql");
const route = read("../src/app/api/customer-projects/route.ts");
const tradeOpportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");
const tradeProfileRoute = read("../src/app/api/trade-profile/route.ts");
const tradePartnerForm = read("../src/components/DirectTradePartnerForm.tsx");
const tradeWorkOrdersRoute = read("../src/app/api/trade-work-orders/route.ts");
const adminOpportunitiesRoute = read("../src/app/api/admin/opportunities/route.ts");
const adminOpportunitiesUi = read("../src/components/AdminOpportunityWorkspace.tsx");
const tradeBusinessHub = read("../src/components/TradeBusinessHub.tsx");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const schema = read("../db/schema.ts");

const baseProject = {
  title: "Whole home priorities",
  postcode: "3000",
  addressState: "VIC",
  propertyType: "house",
  householdSituation: "renter",
  pace: "staged",
  serviceCategories: ["draught-proofing"],
  priorities: ["comfort"],
};

test("multiple goals and detailed neutral home features are allowlisted", () => {
  const result = normalizeCustomerProject({
    ...baseProject,
    goals: ["improve-comfort", "lower-bills", "improve-comfort", "unsafe-goal"],
    existingFeatures: [
      "single-glazing",
      "ceiling-insulation-limited",
      "unsafe-feature",
    ],
    budgetRange: "under_2k",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.project.goals, ["improve-comfort", "lower-bills"]);
  assert.equal(result.project.goal, "improve-comfort");
  assert.deepEqual(result.project.existingFeatures, [
    "ceiling-insulation-limited",
    "single-glazing",
  ]);
  assert.equal(result.project.planSnapshot.goal, "improve-comfort");
  assert.deepEqual(result.project.planSnapshot.goals, result.project.goals);
  assert.ok(customerProjectOptions.goals.length >= 10);
  assert.ok(customerProjectOptions.homeFeatures.some(([value]) => value === "wall-insulation-well"));
  assert.ok(customerProjectOptions.homeFeatures.some(([value]) => value === "double-glazing"));

  const everyGoal = normalizeCustomerProject({
    ...baseProject,
    goals: customerProjectOptions.goals.map(([value]) => value),
  });
  assert.equal(everyGoal.ok, true);
  assert.equal(everyGoal.project.goals.length, customerProjectOptions.goals.length);
});

test("an explicit empty goal choice remains unanswered and blocks submission", () => {
  const result = normalizeCustomerProject({
    ...baseProject,
    goal: "lower-bills",
    goals: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.project.goal, "");
  assert.deepEqual(result.project.goals, []);
  assert.equal(submissionReadiness(result.project).ok, false);
  assert.match(submissionReadiness(result.project).error, /at least one goal/i);
});

test("advisor plans combine goals, property evidence, renting and a bounded budget", () => {
  const plan = createCustomerProjectPlan({
    goals: ["improve-comfort", "healthier-home", "renter-friendly"],
    pace: "staged",
    situation: "renter",
    features: ["single-glazing", "draughty", "condensation-moisture"],
    budgetRange: "under_2k",
  });
  const ids = plan.items.map((item) => item.id);
  assert.ok(ids.includes("authority"));
  assert.ok(ids.includes("renter-friendly-actions"));
  assert.ok(ids.includes("moisture-ventilation"));
  assert.ok(ids.includes("draught-proofing"));
  assert.ok(ids.includes("insulation-review"));
  assert.ok(ids.includes("windows-glazing"));
  assert.ok(ids.includes("budget-under-2k"));
  assert.equal(ids.at(-1), "support");
  assert.equal(ids.includes("fabric"), false);
  assert.equal(ids.includes("brief"), false);
  assert.match(plan.summary, /not a product endorsement, quote or savings promise/);
  assert.doesNotMatch(JSON.stringify(plan), /Renshade|Duck film/i);
});

test("home basics and considered work are bounded inputs to the neutral roadmap", () => {
  const plan = createCustomerProjectPlan({
    goals: ["improve-comfort"],
    pace: "staged",
    situation: "owner",
    features: ["single-glazing"],
    budgetRange: "2_10k",
    propertyContext: {
      storeys: "two",
      ageBand: "pre_1960",
      floorArea: "100_199",
      roofType: "metal",
      switchboard: "older_fuses",
      approvalContext: "none",
      accessConstraints: ["stairs"],
      unsafeContext: "must not persist",
    },
    serviceCategories: ["solar", "glazing", "not-a-service"],
  });

  assert.deepEqual(plan.propertyContext, {
    storeys: "two",
    ageBand: "pre_1960",
    floorArea: "100_199",
    roofType: "metal",
    switchboard: "older_fuses",
  });
  assert.deepEqual(plan.serviceCategories, ["solar", "glazing"]);

  const homeContext = plan.items.find(
    (item) => item.id === "home-planning-context",
  );
  assert.ok(homeContext);
  assert.match(
    `${homeContext.title} ${homeContext.text}`,
    /two storeys/i,
  );
  assert.match(
    `${homeContext.title} ${homeContext.text}`,
    /built before 1960/i,
  );
  assert.match(
    `${homeContext.title} ${homeContext.text}`,
    /100 to 199 m2/i,
  );
  assert.match(`${homeContext.title} ${homeContext.text}`, /metal roof/i);
  assert.match(
    `${homeContext.title} ${homeContext.text}`,
    /older fuse board/i,
  );

  const consideredWork = plan.items.filter((item) =>
    item.guidance?.basedOn?.some((basis) => /consider/i.test(basis))
  );
  assert.equal(consideredWork.length, 2);
  assert.deepEqual(
    consideredWork.map((item) => item.id).sort(),
    ["solar", "windows-glazing"],
  );
  const consideredCopy = JSON.stringify(consideredWork);
  assert.match(consideredCopy, /Rooftop solar/i);
  assert.match(consideredCopy, /Glazing/i);
  assert.doesNotMatch(consideredCopy, /quote selected|recommended installer/i);
});

test("legacy installer priorities are derived from goals and conflicting client choices are ignored", () => {
  const normalized = normalizeCustomerProject({
    ...baseProject,
    goals: [
      "replace-now",
      "prepare-renovation",
      "improve-resilience",
      "move-from-gas",
      "improve-comfort",
      "lower-bills",
    ],
    priorities: ["not-a-priority", "replace-failed"],
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.project.priorities, [
    "lower-bills",
    "comfort",
    "move-from-gas",
    "resilience",
    "future-ready",
    "replace-failed",
  ]);

  const oneGoal = normalizeCustomerProject({
    ...baseProject,
    goals: ["lower-bills"],
    priorities: ["replace-failed", "comfort"],
  });
  assert.equal(oneGoal.ok, true);
  assert.deepEqual(oneGoal.project.priorities, ["lower-bills"]);
});

test("installer readiness does not ask the household to repeat its goals as priorities", () => {
  const normalized = normalizeCustomerProject({
    ...baseProject,
    goals: ["improve-comfort"],
    priorities: [],
    propertyContext: {
      storeys: "single",
      ageBand: "1960_1999",
      floorArea: "100_199",
      roofType: "tile",
      switchboard: "not_sure",
    },
  });
  assert.equal(normalized.ok, true);
  assert.equal(
    submissionReadiness({
      ...normalized.project,
      priorities: [],
    }).ok,
    true,
  );
});

test("everyday actions are deterministic, bounded and separate from the ordered upgrade plan", () => {
  const input = {
    goals: [
      "healthier-home",
      "improve-comfort",
      "lower-bills",
      "renter-friendly",
    ],
    pace: "staged",
    situation: "renter",
    features: [
      "condensation-moisture",
      "comfort-too-cold",
      "comfort-too-hot",
      "reverse-cycle",
      "single-glazing",
      "window-coverings-basic",
    ],
    budgetRange: "under_2k",
    postcode: "3000",
    addressState: "VIC",
  };
  const first = createCustomerProjectPlan(input);
  const second = createCustomerProjectPlan(input);
  assert.deepEqual(second.everydayActions, first.everydayActions);
  assert.equal(first.everydayActions.length <= 6, true);
  assert.deepEqual(
    first.everydayActions.map((action) => action.id),
    [
      "moisture-safe-routine",
      "personal-warmth-first",
      "use-existing-controls",
      "safe-seasonal-airflow",
      "seasonal-window-and-landscape",
      "renter-friendly-diy-boundary",
    ],
  );
  assert.equal(
    new Set(first.everydayActions.map((action) => action.id)).size,
    first.everydayActions.length,
  );
  const orderedIds = new Set(first.items.map((item) => item.id));
  assert.ok(first.everydayActions.every((action) => !orderedIds.has(action.id)));
  assert.equal(first.everydayActionsBoundary, CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY);
  assert.match(first.everydayActionsBoundary, /not upgrade steps/i);
  assert.match(first.everydayActionsBoundary, /not .*product endorsements/i);
  assert.match(first.everydayActionsBoundary, /unsafe|unsuitable/i);
});

test("everyday actions have controlled triggers, safety boundaries and no product brands or prices", () => {
  const scenarios = [
    {
      input: {
        goals: ["healthier-home"],
        features: ["condensation-moisture"],
      },
      expectedId: "moisture-safe-routine",
    },
    {
      input: {
        goals: ["improve-comfort"],
        features: ["comfort-too-cold"],
      },
      expectedId: "personal-warmth-first",
    },
    {
      input: {
        goals: ["lower-bills"],
        features: ["reverse-cycle"],
      },
      expectedId: "use-existing-controls",
    },
    {
      input: {
        goals: ["improve-comfort"],
        features: ["comfort-too-hot"],
      },
      expectedId: "safe-seasonal-airflow",
    },
    {
      input: {
        goals: ["improve-comfort"],
        features: ["window-coverings-basic"],
      },
      expectedId: "seasonal-window-and-landscape",
    },
    {
      input: {
        goals: ["renter-friendly"],
        situation: "renter",
        budgetRange: "under_2k",
      },
      expectedId: "renter-friendly-diy-boundary",
    },
  ];
  for (const { input, expectedId } of scenarios) {
    const plan = createCustomerProjectPlan(input);
    assert.ok(
      plan.everydayActions.some((action) => action.id === expectedId),
      `expected ${expectedId}`,
    );
  }

  const actions = createCustomerProjectPlan({
    goals: ["healthier-home", "improve-comfort", "lower-bills", "renter-friendly"],
    situation: "renter",
    features: [
      "condensation-moisture",
      "comfort-too-cold",
      "comfort-too-hot",
      "reverse-cycle",
      "single-glazing",
      "window-coverings-basic",
    ],
    budgetRange: "under_2k",
  }).everydayActions;
  const serialized = JSON.stringify(actions);
  assert.doesNotMatch(
    serialized,
    /Renshade|Duck ?film|BrandCo|Bunnings|IKEA|\$\d|guaranteed savings/i,
  );
  assert.match(
    actions.find((action) => action.id === "moisture-safe-routine").text,
    /Do not block fixed vents|combustion-safety/i,
  );
  assert.match(
    actions.find((action) => action.id === "personal-warmth-first").text,
    /manufacturer directs|not a substitute for safe adequate heating/i,
  );
  assert.match(
    actions.find((action) => action.id === "use-existing-controls").text,
    /Do not disable hot-water safety cycles|bypass safety controls/i,
  );
  assert.match(
    actions.find((action) => action.id === "safe-seasonal-airflow").text,
    /humidity, smoke, weather, noise and security/i,
  );
  assert.match(
    actions.find((action) => action.id === "seasonal-window-and-landscape").text,
    /approval|underground and overhead services|bushfire risk/i,
  );
  assert.match(
    actions.find((action) => action.id === "renter-friendly-diy-boundary").text,
    /Never cover a fixed vent|permission-free/i,
  );
});

test("everyday actions do not contradict explicit comfort or tenure answers", () => {
  const hotOwnerIds = createCustomerProjectPlan({
    goals: ["improve-comfort"],
    situation: "owner",
    features: ["comfort-too-hot"],
  }).everydayActions.map((action) => action.id);
  assert.equal(hotOwnerIds.includes("personal-warmth-first"), false);
  assert.equal(hotOwnerIds.includes("safe-seasonal-airflow"), true);

  const coldHomeIds = createCustomerProjectPlan({
    goals: ["improve-comfort"],
    situation: "owner",
    features: ["comfort-too-cold", "reverse-cycle"],
  }).everydayActions.map((action) => action.id);
  assert.equal(coldHomeIds.includes("personal-warmth-first"), true);
  assert.equal(coldHomeIds.includes("safe-seasonal-airflow"), false);

  const lowBudgetOwnerIds = createCustomerProjectPlan({
    goals: ["lower-bills"],
    situation: "owner",
    features: [],
    budgetRange: "under_2k",
  }).everydayActions.map((action) => action.id);
  assert.equal(lowBudgetOwnerIds.includes("renter-friendly-diy-boundary"), false);
});

test("existing efficient equipment changes the advice instead of being collected without effect", () => {
  const baseline = createCustomerProjectPlan({
    goals: ["improve-comfort", "lower-bills"],
    features: [],
  });
  const informed = createCustomerProjectPlan({
    goals: ["improve-comfort", "lower-bills"],
    features: ["reverse-cycle", "heat-pump-hot-water"],
  });
  const baselineIds = baseline.items.map((item) => item.id);
  const informedIds = informed.items.map((item) => item.id);
  assert.notDeepEqual(informedIds, baselineIds);
  assert.ok(informedIds.includes("existing-reverse-cycle"));
  assert.ok(informedIds.includes("existing-heat-pump-hot-water"));
  assert.equal(informedIds.includes("heating"), false);
});

test("a valid plan snapshot persists removals, order and bounded custom notes", () => {
  const generated = createCustomerProjectPlan({
    goals: ["lower-bills"],
    situation: "owner",
    features: ["single-glazing"],
    budgetRange: "2_10k",
  });
  const known = generated.items.find((item) => item.id === "windows-glazing");
  assert.ok(known);
  const persisted = createCustomerProjectPlan({
    goals: ["lower-bills"],
    situation: "owner",
    features: ["single-glazing"],
    budgetRange: "2_10k",
    planSnapshot: {
      version: CUSTOMER_PLAN_VERSION,
      items: [
        {
          id: "custom-budget-note",
          stage: "Home-specific",
          title: "Protect the kitchen allowance",
          text: "Keep this item ahead of glazing until the renovation quote is known.",
          href: "https://untrusted.example",
          action: "Unsafe action",
        },
        { ...known, title: "Attempted replacement copy" },
      ],
    },
  });
  assert.deepEqual(persisted.items.map((item) => item.id), ["custom-budget-note", "windows-glazing"]);
  assert.equal(persisted.items[0].href, "");
  assert.equal(persisted.items[0].action, "");
  assert.equal(persisted.items[1].title, known.title);

  const empty = createCustomerProjectPlan({
    goals: ["lower-bills"],
    planSnapshot: {
      version: CUSTOMER_PLAN_VERSION,
      items: [],
    },
  });
  assert.deepEqual(empty.items, []);

  const invalid = normalizeCustomerProject({
    ...baseProject,
    goals: ["lower-bills"],
    existingFeatures: ["single-glazing"],
    planSnapshot: {
      version: CUSTOMER_PLAN_VERSION,
      items: [{ id: "unknown", title: "Unknown", text: "Unknown" }],
    },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Reset the advisor suggestions/);

  for (const planSnapshot of [
    { version: CUSTOMER_PLAN_VERSION },
    { version: "2099-01-01-future-advisor", items: [] },
    "not-a-plan",
  ]) {
    const malformed = normalizeCustomerProject({
      ...baseProject,
      goals: ["lower-bills"],
      planSnapshot,
    });
    assert.equal(malformed.ok, false);
    assert.match(malformed.error, /Reset the advisor suggestions/);
  }

  const legacy = createCustomerProjectPlan({
    goals: ["lower-bills"],
    features: ["single-glazing"],
    planSnapshot: {
      version: "2026-07-15",
      items: [{ id: "brief", title: "Legacy brief", text: "Legacy" }],
    },
  });
  assert.equal(legacy.items.length, 1);
  assert.equal(legacy.items.some((item) => item.id === "brief"), false);
  assert.match(legacy.items[0].id, /^custom-retained-/);
  assert.equal(legacy.items[0].title, "Legacy brief");
});

test("keeping edited steps converts superseded advice into valid private items", () => {
  const previous = createCustomerProjectPlan({
    goals: ["lower-bills"],
    situation: "owner",
  });
  const current = createCustomerProjectPlan({
    goals: ["improve-comfort"],
    situation: "owner",
  });
  const preserved = preserveEditedPlanItems(previous.items, current.items);
  assert.deepEqual(
    preserved.map((item) => item.title),
    previous.items.map((item) => item.title),
  );
  assert.ok(preserved.some((item) => item.id.startsWith("custom-retained-")));
  assert.ok(
    preserved
      .filter((item) => item.id.startsWith("custom-retained-"))
      .every((item) => !item.href && !item.action),
  );

  const result = normalizeCustomerProject({
    ...baseProject,
    goals: ["improve-comfort"],
    planSnapshot: {
      version: CUSTOMER_PLAN_VERSION,
      items: preserved,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.project.planSnapshot.items.map((item) => item.title),
    previous.items.map((item) => item.title),
  );
});

test("legacy combined work is split and retired demo budget values reset safely", () => {
  const legacy = normalizeCustomerProject({
    ...baseProject,
    goal: "lower-bills",
    serviceCategories: ["insulation-draughts"],
    budgetRange: "5_15k",
  });
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.project.goals, ["lower-bills"]);
  assert.deepEqual(legacy.project.serviceCategories, ["insulation", "draught-proofing"]);
  assert.equal(legacy.project.budgetRange, "not_set");
  for (const value of ["draught-proofing", "insulation", "glazing", "window-coverings"]) {
    assert.ok(customerProjectOptions.serviceCategories.some(([item]) => item === value));
  }
});

test("split fabric work remains precise through opportunity matching and trade workflows", () => {
  const result = normalizeCustomerProject({
    ...baseProject,
    goals: ["improve-comfort"],
    serviceCategories: [
      "draught-proofing",
      "insulation",
      "glazing",
      "window-coverings",
      "solar",
    ],
  });
  assert.equal(result.ok, true);
  const opportunity = buildAnonymizedOpportunity(result.project, "project-split-fabric");
  assert.deepEqual(opportunity.serviceCategories, [
    "draught-proofing",
    "insulation",
    "glazing",
    "window-coverings",
    "solar",
  ]);
  assert.match(opportunity.summary, /draught-proofing, insulation, glazing, blinds, shutters and external shading/);
  for (const category of ["draught-proofing", "insulation", "glazing", "window-coverings"]) {
    assert.deepEqual(
      matchedServiceCategories([category], [category]),
      [category],
    );
    assert.deepEqual(
      matchedServiceCategories([category], ["solar"]),
      [],
    );
    for (const source of [
      tradeProfileRoute,
      tradePartnerForm,
      tradeWorkOrdersRoute,
      adminOpportunitiesRoute,
      adminOpportunitiesUi,
      tradeBusinessHub,
    ]) {
      assert.match(source, new RegExp(category));
    }
  }
  assert.match(opportunityServer, /matchedServiceCategories\(categories, capabilities\)/);
  assert.match(opportunityServer, /json_extract\(m\.matched_categories, '\$\[0\]'\)/);
  assert.match(tradeWorkOrdersRoute, /m\.matched_categories/);
  assert.match(tradeWorkOrdersRoute, /JSON\.stringify\(serviceCategories\)/);
});

test("automatic allocation reserves capacity for every eligible requested trade", () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, index) => ({
      firebaseUid: `solar-${index}`,
      matchedCategories: ["solar"],
    })),
    {
      firebaseUid: "glazing-specialist",
      matchedCategories: ["glazing"],
    },
  ];
  const selected = selectInstallerCandidatesForCoverage(
    candidates,
    ["solar", "glazing"],
    6,
  );
  assert.equal(selected.length, 6);
  assert.ok(selected.some((candidate) => candidate.firebaseUid === "glazing-specialist"));
  assert.deepEqual(
    new Set(selected.flatMap((candidate) => candidate.matchedCategories)),
    new Set(["solar", "glazing"]),
  );
  assert.match(opportunityServer, /selectInstallerCandidatesForCoverage/);
});

test("tenure and strata approval remain independent advisor inputs", () => {
  const result = normalizeCustomerProject({
    ...baseProject,
    householdSituation: "renter",
    propertyContext: {
      approvalContext: "strata",
      accessConstraints: ["strata_common_property"],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.project.householdSituation, "renter");
  assert.equal(result.project.propertyContext.approvalContext, "strata");
  const ids = result.project.planSnapshot.items.map((item) => item.id);
  assert.ok(ids.includes("authority"));
  assert.ok(ids.includes("renter-friendly-actions"));
});

test("owner or renter must be answered instead of inferred", () => {
  const project = normalizeCustomerProject({
    ...baseProject,
    householdSituation: "",
  });
  assert.equal(project.ok, false);
  assert.match(project.error, /own or rent/);

  const profile = validateCustomerProfile({
    displayName: "Demo household",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "",
    consent: true,
  });
  assert.equal(profile.ok, false);
  assert.match(profile.error, /own or rent/);
});

test("installer property context removes household routines and unknown fields", () => {
  const context = buildInstallerPropertyContext({
    storeys: "single",
    approvalContext: "strata",
    accessConstraints: ["stairs", "unsafe"],
    occupancy: "away_weekdays",
    privateNote: "not shared",
  });
  assert.deepEqual(context, {
    storeys: "single",
    ageBand: "",
    floorArea: "",
    roofType: "",
    switchboard: "",
    approvalContext: "strata",
    accessConstraints: ["stairs"],
  });
  assert.equal("occupancy" in context, false);
  assert.match(tradeOpportunitiesRoute, /propertyContext: buildInstallerPropertyContext/);
});

test("completed plan steps are intersected with the edited plan", () => {
  const completed = reconcileCompletedPlanItems(
    ["keep", "removed", "keep", 17],
    { items: [{ id: "keep" }, { id: "new" }] },
  );
  assert.deepEqual(completed, ["keep"]);
  assert.match(route, /completed_plan_items = \?/);
  assert.match(route, /reconcileCompletedPlanItems/);
});

test("installer submission no longer requires a household access routine", () => {
  const ready = normalizeCustomerProject({
    ...baseProject,
    goals: ["improve-comfort"],
    propertyContext: {
      storeys: "single",
      ageBand: "1960_1999",
      floorArea: "100_199",
      roofType: "tile",
      switchboard: "not_sure",
    },
  });
  assert.equal(ready.ok, true);
  assert.equal(submissionReadiness(ready.project).ok, true);
});

test("the forward migration backfills goals and the API writes both contracts", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    goal text NOT NULL,
    budget_range text NOT NULL,
    household_situation text NOT NULL,
    property_context text NOT NULL,
    service_categories text NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_accounts (
    id text PRIMARY KEY NOT NULL,
    household_situation text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_accounts (
    id text PRIMARY KEY NOT NULL,
    capabilities text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL,
    service_categories text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY NOT NULL,
    matched_categories text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_work_orders (
    id text PRIMARY KEY NOT NULL,
    service_category text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_crm_enquiries (
    id text PRIMARY KEY NOT NULL,
    service_category text NOT NULL
  )`);
  for (const table of [
    "trade_handover_packs",
    "trade_job_packets",
    "trade_crm_job_templates",
    "trade_crm_photo_templates",
    "trade_crm_photo_template_versions",
  ]) {
    db.exec(`CREATE TABLE ${table} (
      id text PRIMARY KEY NOT NULL,
      service_category text NOT NULL
    )`);
  }
  db.exec(`CREATE TABLE trade_form_templates (
    id text PRIMARY KEY NOT NULL,
    categories text NOT NULL
  )`);
  db.exec(`CREATE TABLE trade_installed_assets (
    id text PRIMARY KEY NOT NULL,
    asset_category text NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_project_evidence (
    id text PRIMARY KEY NOT NULL,
    category text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL
  )`);
  db.exec(`INSERT INTO customer_projects
    (id, goal, budget_range, household_situation, property_context, service_categories)
    VALUES ('legacy', 'lower-bills', '5_15k', 'strata', '{"occupancy":"away_weekdays"}', '["insulation-draughts","solar"]')`);
  db.exec("INSERT INTO customer_accounts (id, household_situation) VALUES ('account', 'planning-building')");
  db.exec(`INSERT INTO trade_accounts (id, capabilities)
    VALUES ('trade', '["insulation-draughts","solar"]')`);
  db.exec(`INSERT INTO trade_opportunities (id, service_categories)
    VALUES ('opportunity', '["insulation-draughts"]')`);
  db.exec(`INSERT INTO trade_opportunity_matches (id, matched_categories)
    VALUES ('match', '["insulation-draughts","solar"]')`);
  db.exec(`INSERT INTO trade_work_orders (id, service_category)
    VALUES ('work', 'insulation-draughts')`);
  db.exec(`INSERT INTO trade_crm_enquiries (id, service_category)
    VALUES ('enquiry', 'insulation-draughts')`);
  for (const table of [
    "trade_handover_packs",
    "trade_job_packets",
    "trade_crm_job_templates",
    "trade_crm_photo_templates",
    "trade_crm_photo_template_versions",
  ]) {
    db.exec(`INSERT INTO ${table} (id, service_category)
      VALUES ('${table}', 'insulation-draughts')`);
  }
  db.exec(`INSERT INTO trade_form_templates (id, categories)
    VALUES ('form', '["insulation-draughts","solar"]')`);
  db.exec(`INSERT INTO trade_installed_assets (id, asset_category)
    VALUES ('asset', 'insulation-draughts')`);
  db.exec(`INSERT INTO customer_project_evidence (id, category, file_name, content_type)
    VALUES ('evidence12345678', 'supporting-document', 'Jane-Smith-12-Smith-St.pdf', 'application/pdf')`);
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  const migrated = db.prepare(`SELECT goals, budget_range, household_situation, property_context, service_categories
    FROM customer_projects WHERE id = 'legacy'`).get();
  assert.equal(migrated.goals, '["lower-bills"]');
  assert.equal(migrated.budget_range, "not_set");
  assert.equal(migrated.household_situation, "");
  assert.deepEqual(JSON.parse(migrated.property_context), {
    approvalContext: "strata",
  });
  assert.deepEqual(
    new Set(JSON.parse(migrated.service_categories)),
    new Set(["draught-proofing", "insulation", "solar"]),
  );
  assert.deepEqual(
    new Set(JSON.parse(db.prepare("SELECT capabilities FROM trade_accounts WHERE id = 'trade'").get().capabilities)),
    new Set(["draught-proofing", "insulation", "solar"]),
  );
  assert.deepEqual(
    new Set(JSON.parse(db.prepare("SELECT service_categories FROM trade_opportunities WHERE id = 'opportunity'").get().service_categories)),
    new Set(["draught-proofing", "insulation"]),
  );
  assert.deepEqual(
    new Set(JSON.parse(db.prepare("SELECT matched_categories FROM trade_opportunity_matches WHERE id = 'match'").get().matched_categories)),
    new Set(["draught-proofing", "insulation", "solar"]),
  );
  for (const table of ["trade_work_orders", "trade_crm_enquiries"]) {
    const record = db.prepare(`SELECT service_category, service_categories FROM ${table}`).get();
    assert.equal(record.service_category, "insulation");
    assert.deepEqual(
      new Set(JSON.parse(record.service_categories)),
      new Set(["draught-proofing", "insulation"]),
    );
  }
  for (const table of [
    "trade_handover_packs",
    "trade_job_packets",
    "trade_crm_job_templates",
    "trade_crm_photo_templates",
    "trade_crm_photo_template_versions",
  ]) {
    assert.equal(db.prepare(`SELECT service_category FROM ${table}`).get().service_category, "insulation");
  }
  assert.deepEqual(
    new Set(JSON.parse(db.prepare("SELECT categories FROM trade_form_templates").get().categories)),
    new Set(["draught-proofing", "insulation", "solar"]),
  );
  assert.equal(db.prepare("SELECT asset_category FROM trade_installed_assets").get().asset_category, "insulation");
  assert.equal(
    db.prepare("SELECT file_name FROM customer_project_evidence WHERE id = 'evidence12345678'").get().file_name,
    "supporting-document-evidence.pdf",
  );
  assert.equal(
    db.prepare("SELECT household_situation FROM customer_accounts WHERE id = 'account'").get().household_situation,
    "",
  );
  db.close();

  assert.match(schema, /goals: text\("goals"\)\.notNull\(\)\.default\("\[\]"\)/);
  assert.equal((schema.match(/serviceCategories: text\("service_categories"\)\.notNull\(\)\.default\("\[\]"\)/g) || []).length >= 2, true);
  assert.match(route, /goals: JSON\.stringify\(project\.goals\)|JSON\.stringify\(project\.goals\)/);
  assert.match(route, /goal, goals, pace/);
  assert.match(route, /goals,\s*pace/);
});
