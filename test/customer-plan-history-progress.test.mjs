import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildCustomerPlanHistoryExport,
  compareCustomerOutcomeCheckins,
  customerPlanRevisionLabel,
  normalizeCustomerOutcomeInput,
  serialiseCustomerPlanHistoryExport,
} from "../src/lib/customer-plan-history.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/customer-project-history/route.ts");
const component = read("../src/components/CustomerPlanHistoryProgress.tsx");

const labels = {
  goals: [
    ["lower-bills", "Lower energy bills"],
    ["improve-comfort", "Feel warmer in winter and cooler in summer"],
  ],
  homeFeatures: [
    ["single-glazing", "Single glazing"],
    ["ceiling-insulation-good", "Ceiling insulation looks adequate"],
  ],
  paces: [
    ["one-step", "One practical next step"],
    ["staged", "Stage improvements over time"],
  ],
  budgets: [
    ["under_2k", "Under $2,000"],
    ["2_10k", "$2,000 to $10,000"],
  ],
  serviceCategories: [
    ["assessment", "Energy assessment"],
    ["insulation", "Insulation"],
  ],
};

function revision(overrides = {}) {
  return {
    id: "revision-1",
    revisionNumber: 1,
    eventType: "baseline",
    planVersion: "advisor-v1",
    goals: ["lower-bills"],
    homeFeatures: ["single-glazing"],
    pace: "one-step",
    budgetRange: "under_2k",
    planSnapshot: {
      version: "advisor-v1",
      propertyContext: {
        storeys: "single",
        ageBand: "1960_1999",
        floorArea: "100_199",
        roofType: "metal",
        switchboard: "breakers",
        exactAddress: "14 Secret Street",
      },
      serviceCategories: ["assessment"],
      items: [{
        id: "step-1",
        stage: "START HERE",
        title: "Secret custom roadmap title",
        text: "Call about the private room called Blue Room",
      }],
    },
    restoredFromRevision: 0,
    createdAt: "2026-07-29T01:00:00.000Z",
    ...overrides,
  };
}

function outcome(overrides = {}) {
  return {
    id: "outcome-1",
    comfortOutcome: "not-sure",
    energyOutcome: "not-checked",
    completedItemIds: [],
    note: "Private note about the Blue Room",
    recordedAt: "2026-07-29T02:00:00.000Z",
    ...overrides,
  };
}

test("revision labels explain saved events in plain language", () => {
  assert.equal(customerPlanRevisionLabel(revision()), "Starting roadmap");
  assert.equal(
    customerPlanRevisionLabel(revision({ eventType: "saved" })),
    "Roadmap updated",
  );
  assert.equal(
    customerPlanRevisionLabel(revision({ eventType: "restored" })),
    "Earlier roadmap restored",
  );
  assert.equal(
    customerPlanRevisionLabel(revision({ eventType: "duplicated" })),
    "Roadmap copied",
  );
  assert.equal(
    customerPlanRevisionLabel(revision({ eventType: "untrusted-label" })),
    "Roadmap updated",
  );
});

test("private outcome input is controlled and bounded", () => {
  const valid = normalizeCustomerOutcomeInput({
    comfortOutcome: "better",
    energyOutcome: "lower",
    note: `  ${"a".repeat(520)}  `,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.outcome.comfortOutcome, "better");
  assert.equal(valid.outcome.energyOutcome, "lower");
  assert.equal([...valid.outcome.note].length, 500);

  const invalid = normalizeCustomerOutcomeInput({
    comfortOutcome: "guaranteed-saving",
    energyOutcome: "lower",
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /valid comfort and energy-use observations/i);
});

test("before and after progress compares observations without inferring cause", () => {
  const comparison = compareCustomerOutcomeCheckins(
    outcome({
      id: "before",
      comfortOutcome: "not-sure",
      completedItemIds: ["step-1"],
    }),
    outcome({
      id: "after",
      comfortOutcome: "better",
      energyOutcome: "lower",
      completedItemIds: ["step-1", "step-2"],
      recordedAt: "2026-07-30T02:00:00.000Z",
    }),
  );
  assert.deepEqual(comparison.comfort, {
    changed: true,
    from: "not-sure",
    to: "better",
  });
  assert.deepEqual(comparison.completedSteps, {
    fromCount: 1,
    toCount: 2,
    addedCount: 1,
    removedCount: 0,
    addedItemIds: ["step-2"],
    removedItemIds: [],
  });
});

test("selected history export excludes private and custom text", () => {
  const revisions = [
    revision(),
    revision({
      id: "revision-2",
      revisionNumber: 2,
      eventType: "saved",
      goals: ["lower-bills", "improve-comfort"],
      homeFeatures: ["ceiling-insulation-good"],
      pace: "staged",
      budgetRange: "2_10k",
      planVersion: "advisor-v2",
      createdAt: "2026-07-30T01:00:00.000Z",
      planSnapshot: {
        version: "advisor-v2",
        propertyContext: {
          storeys: "single",
          ageBand: "1960_1999",
          floorArea: "100_199",
          roofType: "metal",
          switchboard: "breakers",
          exactAddress: "14 Secret Street",
        },
        serviceCategories: ["assessment", "insulation"],
        items: [
          {
            id: "step-1",
            stage: "START HERE",
            title: "Changed secret roadmap title",
            text: "Evidence file switchboard-private.jpg",
          },
          {
            id: "custom-private-step",
            stage: "HOME NOTE",
            title: "Discuss Blue Room with Pat",
            text: "Private household wording",
          },
        ],
      },
    }),
  ];
  const outcomes = [
    outcome(),
    outcome({
      id: "outcome-2",
      comfortOutcome: "better",
      energyOutcome: "lower",
      completedItemIds: ["step-1", "custom-private-step"],
      note: "Call Pat on 0400 000 000 about Blue Room",
      recordedAt: "2026-07-30T02:00:00.000Z",
    }),
  ];
  const exported = buildCustomerPlanHistoryExport({
    revisions,
    selectedRevisionNumbers: [1, 2],
    outcomes,
    selectedOutcomeIds: ["outcome-1", "outcome-2"],
    labels,
    generatedAt: "2026-07-31T00:00:00.000Z",
  });
  const serialised = JSON.stringify(exported);

  assert.equal(exported.revisions.length, 2);
  assert.equal(exported.revisionComparison.orderedSteps.addedCount, 1);
  assert.equal(exported.progressComparison.completedSteps.addedCount, 2);
  assert.match(serialised, /Lower energy bills/);
  assert.match(serialised, /household observations/i);
  for (const secret of [
    "14 Secret Street",
    "Blue Room",
    "Pat",
    "0400 000 000",
    "switchboard-private.jpg",
    "Secret custom roadmap title",
    "Changed secret roadmap title",
    "Private household wording",
  ]) {
    assert.doesNotMatch(serialised, new RegExp(secret.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(serialised, /custom-private-step/);
  assert.equal("note" in exported.progressCheckins[0], false);

  const text = serialiseCustomerPlanHistoryExport({
    revisions,
    selectedRevisionNumbers: [1, 2],
    outcomes,
    selectedOutcomeIds: ["outcome-1", "outcome-2"],
    labels,
    generatedAt: "2026-07-31T00:00:00.000Z",
  });
  assert.equal(text.endsWith("\n"), true);
  assert.doesNotMatch(text, /Blue Room/);
});

test("history endpoint is owner scoped, bounded and concurrency safe", () => {
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(
    route,
    /FROM customer_project_plan_revisions[\s\S]*WHERE project_id = \? AND customer_uid = \?/,
  );
  assert.match(
    route,
    /FROM customer_project_outcome_checkins[\s\S]*WHERE project_id = \? AND customer_uid = \?/,
  );
  assert.match(route, /LIMIT \$\{PLAN_REVISION_READ_LIMIT\}/);
  assert.match(route, /LIMIT \$\{OUTCOME_CHECKIN_READ_LIMIT\}/);
  assert.match(route, /INSERT INTO customer_project_outcome_checkins[\s\S]*SELECT \?, id, firebase_uid/);
  assert.match(
    route,
    /AND plan_revision = \? AND updated_at = \?/,
  );
  assert.match(route, /expectedPlanRevision/);
  assert.match(route, /expectedUpdatedAt/);
  assert.match(route, /results\[0\]\?\.meta\.changes/);
  assert.match(route, /results\[1\]\?\.meta\.changes/);
  assert.match(route, /OUTCOME_CHECKIN_RETENTION_LIMIT/);
  assert.match(route, /status != 'archived'/);
});

test("isolated component exposes the dashboard integration contract", () => {
  assert.match(component, /export type CustomerPlanHistoryProject/);
  assert.match(component, /export type CustomerPlanProgressInput/);
  assert.match(component, /onRecordOutcome/);
  assert.match(component, /expectedPlanRevision: project\.planRevision/);
  assert.match(component, /expectedUpdatedAt: project\.updatedAt/);
  assert.match(component, /onRestore\?/);
  assert.match(component, /project\.status === "draft"/);
  assert.match(component, /Download selected summary/);
  assert.match(component, /not prove that a roadmap[\s\S]*caused a change/i);
  assert.doesNotMatch(component, /CustomerDashboard/);
});
