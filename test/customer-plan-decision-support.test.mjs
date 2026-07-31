import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlanDecisionSupport,
  createNextBestQuestions,
  normalizeCustomerReviewItems,
} from "../src/lib/customer-plan-decision-support.mjs";
import {
  buildAnonymizedOpportunity,
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  normalizeCustomerProject,
} from "../src/lib/customer-projects.mjs";

test("canonical plan items receive bounded controlled decision guidance", () => {
  const plan = createCustomerProjectPlan({
    goals: ["improve-comfort", "lower-bills"],
    pace: "staged",
    situation: "renter",
    approvalContext: "not_sure",
    features: ["draughty", "single-glazing"],
    budgetRange: "under_2k",
    advisorProfile: {
      factEvidence: [
        { factKey: "glazing", source: "customer-reported" },
        { factKey: "draughts", source: "unknown" },
      ],
    },
  });

  assert.ok(plan.items.length > 0);
  for (const item of plan.items) {
    assert.ok(item.guidance);
    assert.ok(item.guidance.basedOn.length > 0);
    assert.ok(item.guidance.basedOn.length <= 3);
    assert.ok(item.guidance.stillUncertain.length > 0);
    assert.ok(item.guidance.stillUncertain.length <= 3);
    assert.ok(item.guidance.reconsiderIf.length > 0);
    assert.ok(item.guidance.reconsiderIf.length <= 2);
    assert.doesNotMatch(JSON.stringify(item.guidance), /confidence score|verified by an assessor/i);
  }
});

test("next questions are deterministic, unique, safe and capped at three", () => {
  const input = {
    items: [
      { id: "authority" },
      { id: "windows-glazing" },
      { id: "insulation-review" },
      { id: "solar" },
    ],
    factEvidence: [
      { factKey: "glazing", source: "unknown" },
      { factKey: "ceiling-insulation", source: "unknown" },
      { factKey: "roof", source: "unknown" },
      { factKey: "switchboard", source: "unknown" },
    ],
    situation: "renter",
    approvalContext: "not_sure",
    budgetRange: "not_set",
    roomCount: 0,
    goals: ["improve-comfort"],
  };
  const first = createNextBestQuestions(input);
  const second = createNextBestQuestions(input);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
  assert.ok(first.every((item) => item.notSureAllowed === true));
  assert.ok(first.every((item) => /^[a-z0-9][a-z0-9-]*$/.test(item.id)));
  assert.ok(first.every((item) => /^[a-z0-9][a-z0-9-]*$/.test(item.targetAnchor)));
  assert.doesNotMatch(
    JSON.stringify(first),
    /enter (the )?roof|climb|remove (an )?electrical cover|block ventilation/i,
  );
});

test("room follow-up returns keyboard focus to the add-room control", () => {
  const questions = createNextBestQuestions({
    items: [],
    factEvidence: [],
    situation: "owner",
    approvalContext: "none",
    budgetRange: "under_2k",
    roomCount: 0,
    goals: ["improve-comfort"],
  });
  assert.deepEqual(
    questions.map(({ id, targetStep, targetAnchor }) => ({
      id,
      targetStep,
      targetAnchor,
    })),
    [{
      id: "room-observation",
      targetStep: 2,
      targetAnchor: "customer-add-room",
    }],
  );
});

test("roof and switchboard questions return to the roadmap intake before the plan", () => {
  const questions = createNextBestQuestions({
    items: [{ id: "solar" }],
    factEvidence: [
      { factKey: "roof", source: "unknown" },
      { factKey: "switchboard", source: "unknown" },
      { factKey: "solar", source: "unknown" },
    ],
    situation: "owner",
    approvalContext: "none",
    budgetRange: "under_2k",
    roomCount: 1,
    goals: ["add-solar-storage"],
  });
  assert.deepEqual(
    questions.slice(0, 2).map(({ id, targetStep, targetAnchor }) => ({
      id,
      targetStep,
      targetAnchor,
    })),
    [
      {
        id: "fact-roof",
        targetStep: 2,
        targetAnchor: "customer-property-roof",
      },
      {
        id: "fact-switchboard",
        targetStep: 2,
        targetAnchor: "customer-property-switchboard",
      },
    ],
  );
});

test("electrical supply and exhaust fan details return to their shared home questions", () => {
  const questions = createNextBestQuestions({
    items: [
      { id: "electrical-supply-check" },
      { id: "moisture-ventilation" },
    ],
    factEvidence: [
      { factKey: "electrical-supply", source: "unknown" },
      { factKey: "switchboard", source: "customer-reported" },
      { factKey: "ventilation", source: "unknown" },
    ],
    homeFeatures: [
      "ventilation-none-known",
      "exhaust-fans-unknown",
    ],
    situation: "owner",
    approvalContext: "none",
    budgetRange: "under_2k",
    roomCount: 1,
    goals: ["move-from-gas"],
  });
  assert.deepEqual(
    questions.map(({ id, targetStep, targetAnchor }) => ({
      id,
      targetStep,
      targetAnchor,
    })),
    [
      {
        id: "fact-electrical-supply",
        targetStep: 2,
        targetAnchor: "customer-home-feature-electrical-supply",
      },
      {
        id: "fact-ventilation",
        targetStep: 2,
        targetAnchor: "customer-home-feature-exhaust-fans",
      },
    ],
  );
  assert.match(questions[0].whyItMatters, /licensed electrician/i);
  assert.match(questions[1].prompt, /kitchen exhaust fan/i);
  assert.match(questions[1].prompt, /bathroom exhaust fan/i);
  assert.doesNotMatch(questions[1].prompt, /discharge|damper/i);
});

test("ventilation follow-ups target the first unresolved related question", () => {
  const targetFor = (homeFeatures) => createNextBestQuestions({
    items: [{ id: "moisture-ventilation" }],
    factEvidence: [{ factKey: "ventilation", source: "unknown" }],
    homeFeatures,
    situation: "owner",
    approvalContext: "none",
    budgetRange: "under_2k",
    roomCount: 1,
    goals: ["healthier-home"],
  })[0].targetAnchor;

  assert.equal(
    targetFor([
      "kitchen-exhaust-fan",
    ]),
    "customer-home-feature-ventilation-features",
  );
  assert.equal(
    targetFor([
      "ventilation-none-known",
      "exhaust-fans-unknown",
    ]),
    "customer-home-feature-exhaust-fans",
  );
  assert.equal(
    targetFor([
      "ventilation-none-known",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
    ]),
    "customer-home-feature-section-ventilation",
  );
});

test("review items keep only bounded customer-owned allowlisted records", () => {
  const normalized = normalizeCustomerReviewItems([
    {
      id: "heard-one",
      kind: "customer-recorded-feedback",
      targetType: "plan-item",
      targetId: "windows-glazing",
      text: "  A person suggested reviewing the frames first.  ",
      status: "answered",
      assessorIdentity: "must not persist",
      verified: true,
    },
    {
      id: "invalid-target",
      kind: "proposed-change",
      targetType: "plan-item",
      targetId: "not-visible",
      text: "Unsafe target",
      status: "accepted",
    },
    {
      id: "fact-question",
      kind: "question",
      targetType: "fact",
      targetId: "glazing",
      text: "Is the spacer visible?",
      status: "not-a-status",
    },
  ], {
    allowedFactKeys: ["glazing"],
    allowedPlanItemIds: ["windows-glazing"],
  });

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    id: "heard-one",
    kind: "customer-recorded-feedback",
    targetType: "plan-item",
    targetId: "windows-glazing",
    text: "A person suggested reviewing the frames first.",
    status: "answered",
  });
  assert.equal(normalized[1].status, "open");
  assert.equal("assessorIdentity" in normalized[0], false);
  assert.equal("verified" in normalized[0], false);
});

test("private review text cannot enter opportunity, permission pack or generated guidance", () => {
  const canary = "PRIVATE REVIEW CANARY 714";
  const result = normalizeCustomerProject({
    title: "Private title",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    goals: ["improve-comfort"],
    pace: "staged",
    serviceCategories: ["glazing"],
    priorities: ["comfort"],
    advisorProfile: {
      reviewItems: [{
        id: "review-one",
        kind: "proposed-change",
        targetType: "plan-item",
        targetId: "windows-glazing",
        text: canary,
        status: "accepted",
      }],
    },
    existingFeatures: ["single-glazing"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.project.advisorProfile.reviewItems[0].text, canary);

  const opportunity = buildAnonymizedOpportunity(result.project, "project-one");
  const permissionPack = createCustomerPermissionPack(
    result.project.advisorProfile,
    {
      householdSituation: result.project.householdSituation,
      approvalContext: result.project.propertyContext.approvalContext,
      planItems: result.project.planSnapshot.items,
    },
  );
  assert.doesNotMatch(JSON.stringify(opportunity), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(permissionPack), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(result.project.planSnapshot.items), new RegExp(canary));
});

test("custom plan guidance is controlled and does not repeat private wording", () => {
  const customTitle = "Private budget-specific canary";
  const items = addPlanDecisionSupport([
    { id: "custom-one", title: customTitle },
  ]);
  assert.doesNotMatch(JSON.stringify(items[0].guidance), new RegExp(customTitle));
});
