import assert from "node:assert/strict";
import test from "node:test";
import {
  HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  HOME_ENERGY_PLANNER_FEATURE_SECTIONS,
  createHomeEnergyPlannerPlan,
  createHomeEnergyPlannerSession,
} from "../src/lib/home-energy-planner-schema.ts";
import {
  EMPTY_SURGE_STARTER_PROFILE,
  markSurgeProfileStepReviewed,
  mergeHomeEnergyPlannerSessionIntoSurgeProfile,
  nextUnknownSurgeProfileStepIndex,
  nextUnreviewedSurgeProfileStepIndex,
  parseSurgeStarterProfile,
  SURGE_PROFILE_FIELDS,
  SURGE_PROFILE_STEPS,
  surgeHomeEnergyPlannerSession,
  surgePlannerProfileAdapter,
  surgeProfileFieldIsUnknown,
  surgeProfileFieldWasReviewed,
  surgeProfileFieldValue,
  surgeProfileKnownAnswerCount,
  surgeProfileReviewedAnswerCount,
  updateSurgeProfileField,
} from "../src/lib/surge-assessor-profile.ts";

const field = (id) => {
  const match = SURGE_PROFILE_FIELDS.find((candidate) => candidate.id === id);
  assert.ok(match, `missing profile field ${id}`);
  return match;
};

const answer = (profile, id, value, checked = true) =>
  updateSurgeProfileField(profile, field(id), value, checked);

const fullyKnownProfile = () => {
  let profile = EMPTY_SURGE_STARTER_PROFILE;
  for (const profileField of SURGE_PROFILE_FIELDS) {
    if (profileField.kind === "postcode") {
      profile = answer(profile, profileField.id, "3006");
      continue;
    }
    const value = profileField.options?.find((option) =>
      option.value && option.value !== profileField.unknownValue && option.value !== "not-sure")?.value;
    assert.ok(value, `missing confirmed option for ${profileField.id}`);
    profile = answer(profile, profileField.id, value);
  }
  for (const step of SURGE_PROFILE_STEPS) profile = markSurgeProfileStepReviewed(profile, step);
  return parseSurgeStarterProfile(profile);
};

test("a fresh Surge profile asserts no material home facts", () => {
  assert.equal(EMPTY_SURGE_STARTER_PROFILE.completed, false);
  assert.equal(EMPTY_SURGE_STARTER_PROFILE.postcode, "");
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.goals, []);
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.features, []);
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.reviewed, []);
  assert.equal(EMPTY_SURGE_STARTER_PROFILE.timing, "not-sure");
  assert.equal(surgeProfileKnownAnswerCount(EMPTY_SURGE_STARTER_PROFILE), 0);
  assert.equal(surgeProfileReviewedAnswerCount(EMPTY_SURGE_STARTER_PROFILE), 0);
  const session = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE);
  assert.equal(session.stage, 0);
  assert.equal(session.draft.postcode, "");
  assert.deepEqual(session.draft.features, []);
  assert.equal(session.draft.timing, "");
  for (const profileField of SURGE_PROFILE_FIELDS) {
    assert.equal(surgeProfileFieldIsUnknown(EMPTY_SURGE_STARTER_PROFILE, profileField), true);
  }
});

test("reviewed unknown answers survive reload but do not count as confirmed context", () => {
  let profile = markSurgeProfileStepReviewed(EMPTY_SURGE_STARTER_PROFILE, SURGE_PROFILE_STEPS[0]);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 0), 1);

  profile = markSurgeProfileStepReviewed(profile, SURGE_PROFILE_STEPS[2]);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 2), 3);

  for (const step of SURGE_PROFILE_STEPS) profile = markSurgeProfileStepReviewed(profile, step);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 7), -1);

  const restored = parseSurgeStarterProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.completed, false);
  assert.equal(restored.reviewed.length, SURGE_PROFILE_FIELDS.length);
  assert.equal(surgeProfileKnownAnswerCount(restored), 0);
  assert.equal(nextUnknownSurgeProfileStepIndex(restored, -1), 0);
  assert.deepEqual(restored.reviewed, profile.reviewed, "reviewed unknown answers must survive a browser round trip");
});

test("Surge reaches every canonical planner question exactly once with exact options", () => {
  assert.equal(SURGE_PROFILE_STEPS.length, 13);
  const ids = SURGE_PROFILE_FIELDS.map((profileField) => profileField.id);
  assert.equal(new Set(ids).size, ids.length, "profile field IDs must be unique");

  const canonicalFeatureQuestions = HOME_ENERGY_PLANNER_FEATURE_SECTIONS
    .flatMap((section) => section.questions);
  for (const question of canonicalFeatureQuestions) {
    const matches = SURGE_PROFILE_FIELDS.filter((candidate) => candidate.id === `feature:${question.id}`);
    assert.equal(matches.length, 1, `${question.id} must appear exactly once`);
    assert.deepEqual(matches[0].options.map((option) => [option.value, option.label]), question.options);
    assert.equal(matches[0].plannerQuestionId, question.id);
  }
  for (const question of HOME_ENERGY_PLANNER_DIRECT_QUESTIONS) {
    const matches = SURGE_PROFILE_FIELDS.filter((candidate) => candidate.id === question.id);
    assert.equal(matches.length, 1, `${question.id} must appear exactly once`);
    assert.deepEqual(matches[0].options.map((option) => [option.value, option.label]), question.options);
  }

  const keys = new Set(SURGE_PROFILE_FIELDS.map((profileField) => profileField.key));
  for (const forbidden of ["name", "email", "phone", "contact", "health", "daytimeUse", "biggestLoad"]) {
    assert.equal(keys.has(forbidden), false, `intake must not collect ${forbidden}`);
  }
  assert.equal(field("feature:heating-cooling-systems").kind, "multiselect");
  assert.equal(field("feature:ev").options.some((option) => option.value === "ev"), true);
  assert.equal(field("feature:electrical-supply").options.some((option) => option.value === "electrical-supply-unknown"), true);
});

test("an older completed profile migrates onto canonical planner IDs without invented defaults", () => {
  const migrated = parseSurgeStarterProfile({
    postcode: "3006",
    relationship: "owner-occupier",
    homeType: "detached-house",
    householdSize: "three-four",
    priority: "lower-bills",
    heatingCooling: "evaporative-gas",
    switchboard: "older-fuses",
    completed: true,
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.completed, false);
  assert.equal(migrated.postcode, "3006");
  assert.equal(migrated.situation, "owner");
  assert.equal(migrated.propertyType, "house");
  assert.equal(migrated.occupants, "three_four");
  assert.deepEqual(migrated.goals, ["lower-bills"]);
  assert.equal(migrated.switchboard, "older_fuses");
  assert.deepEqual(surgeProfileFieldValue(migrated, field("feature:heating-cooling-systems")), ["gas-heating", "evaporative-cooling"]);
  assert.equal(migrated.budgetRange, "");
  assert.equal(migrated.roofType, "");

  const unconfirmedLegacyDefaults = parseSurgeStarterProfile({
    postcode: "3006",
    relationship: "owner-occupier",
    completed: false,
  });
  assert.equal(surgeProfileKnownAnswerCount(unconfirmedLegacyDefaults), 0);
  assert.equal(unconfirmedLegacyDefaults.postcode, "");
});

test("profile answers produce the identical versioned planner session and plan generator input", () => {
  let profile = EMPTY_SURGE_STARTER_PROFILE;
  for (const [id, value] of [
    ["postcode", "3006"],
    ["situation", "owner"],
    ["propertyType", "house"],
    ["approvalContext", "none"],
    ["occupants", "three_four"],
    ["goals", "lower-bills"],
    ["goals", "improve-comfort"],
    ["pace", "staged"],
    ["budgetRange", "2_10k"],
    ["switchboard", "older_fuses"],
    ["feature:comfort-concerns", "comfort-too-cold"],
    ["feature:ceiling-insulation", "ceiling-insulation-limited"],
    ["feature:glazing", "single-glazing"],
    ["feature:heating-cooling-systems", "gas-heating"],
    ["feature:hot-water", "gas-storage-hot-water"],
    ["feature:cooking", "gas-cooking"],
    ["feature:solar", "solar-none"],
    ["feature:battery", "battery-none"],
    ["feature:ev", "ev-none"],
  ]) profile = answer(profile, id, value);
  for (const step of SURGE_PROFILE_STEPS) profile = markSurgeProfileStepReviewed(profile, step);
  profile = { ...profile, completed: true };

  const adapter = surgePlannerProfileAdapter(profile);
  const rebuilt = createHomeEnergyPlannerSession(adapter.draft);
  assert.deepEqual(adapter.session, rebuilt);
  assert.equal(adapter.session.version, 1);
  assert.equal(adapter.session.stage, 4);
  assert.equal(adapter.session.draft.switchboard, "older_fuses");
  assert.deepEqual(createHomeEnergyPlannerPlan(adapter.session.draft), createHomeEnergyPlannerPlan(rebuilt.draft));
});

test("planner restoration only imports answers from reviewed stages including switchboard", () => {
  const draft = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE).draft;
  const stageZero = createHomeEnergyPlannerSession({
    ...draft,
    postcode: "3006",
    situation: "owner",
    propertyType: "house",
    occupants: "three_four",
    switchboard: "older_fuses",
  }, 0);
  const untouched = mergeHomeEnergyPlannerSessionIntoSurgeProfile(EMPTY_SURGE_STARTER_PROFILE, stageZero);
  assert.equal(untouched.postcode, "");
  assert.equal(untouched.switchboard, "");

  const stageOne = { ...stageZero, stage: 1 };
  const imported = mergeHomeEnergyPlannerSessionIntoSurgeProfile(EMPTY_SURGE_STARTER_PROFILE, stageOne);
  assert.equal(imported.postcode, "3006");
  assert.equal(imported.situation, "owner");
  assert.equal(imported.switchboard, "older_fuses");
  assert.equal(surgeProfileFieldIsUnknown(imported, field("switchboard")), false);
});

test("planner restoration fills gaps without replacing reviewed Surge answers", () => {
  let surgeProfile = answer(EMPTY_SURGE_STARTER_PROFILE, "postcode", "3000");
  surgeProfile = answer(surgeProfile, "situation", "owner");
  const reviewedBefore = surgeProfileReviewedAnswerCount(surgeProfile);
  const plannerDraft = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE).draft;
  const plannerSession = createHomeEnergyPlannerSession({
    ...plannerDraft,
    postcode: "3006",
    situation: "renter",
    propertyType: "house",
    switchboard: "older_fuses",
  }, 1);

  const restored = mergeHomeEnergyPlannerSessionIntoSurgeProfile(surgeProfile, plannerSession);
  assert.equal(restored.postcode, "3000", "a reviewed Surge postcode remains authoritative");
  assert.equal(restored.situation, "owner", "a reviewed Surge tenure remains authoritative");
  assert.equal(restored.switchboard, "older_fuses", "an unanswered field can still be imported");
  assert.ok(surgeProfileReviewedAnswerCount(restored) > reviewedBefore);
});

test("planner restoration stage-gates the seven shared answers and keeps reviewed Surge values", () => {
  const draft = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE).draft;
  const answers = {
    ...draft,
    postcode: "3006",
    situation: "owner",
    propertyType: "house",
    occupants: "two",
    occupancyPattern: "mostly-home",
    energyUsePattern: "all-day",
    gasConnection: "connected",
    timing: "within_3_months",
    billPressure: "higher-than-expected",
    disruption: "some-work",
    plannedWorks: "maintenance",
  };

  const stageOne = mergeHomeEnergyPlannerSessionIntoSurgeProfile(
    EMPTY_SURGE_STARTER_PROFILE,
    createHomeEnergyPlannerSession(answers, 1),
  );
  assert.equal(stageOne.occupancyPattern, "mostly-home");
  assert.equal(stageOne.energyUsePattern, "not-sure");

  const stageThree = mergeHomeEnergyPlannerSessionIntoSurgeProfile(
    EMPTY_SURGE_STARTER_PROFILE,
    createHomeEnergyPlannerSession(answers, 3),
  );
  assert.equal(stageThree.energyUsePattern, "all-day");
  assert.equal(stageThree.gasConnection, "connected");
  assert.equal(stageThree.timing, "not-sure");

  let reviewed = answer(EMPTY_SURGE_STARTER_PROFILE, "supplemental:gasConnection", "bottled-lpg");
  reviewed = mergeHomeEnergyPlannerSessionIntoSurgeProfile(
    reviewed,
    createHomeEnergyPlannerSession(answers, 4),
  );
  assert.equal(reviewed.gasConnection, "bottled-lpg");
  assert.equal(reviewed.timing, "within_3_months");
  assert.equal(reviewed.billPressure, "higher-than-expected");
  assert.equal(reviewed.disruption, "some-work");
  assert.equal(reviewed.plannedWorks, "maintenance");
});

test("an old completed v1 planner imports core facts without inventing supplemental answers", () => {
  const restored = mergeHomeEnergyPlannerSessionIntoSurgeProfile(
    EMPTY_SURGE_STARTER_PROFILE,
    {
      version: 1,
      stage: 4,
      draft: {
        postcode: "3006",
        situation: "owner",
        approvalContext: "not_sure",
        propertyType: "house",
        occupants: "two",
        goals: ["lower-bills"],
        features: ["comfort-too-cold", "single-glazing"],
      },
    },
  );
  assert.equal(restored.postcode, "3006");
  assert.equal(restored.situation, "owner");
  assert.equal(restored.propertyType, "house");
  assert.deepEqual(restored.goals, ["lower-bills"]);
  for (const key of [
    "timing",
    "occupancyPattern",
    "energyUsePattern",
    "billPressure",
    "gasConnection",
    "disruption",
    "plannedWorks",
  ]) assert.ok(restored[key] === "" || restored[key] === "not-sure", key);
});

test("planner restoration replaces reviewed placeholders when a real planner answer survives", () => {
  let reviewedEmpty = EMPTY_SURGE_STARTER_PROFILE;
  for (const step of SURGE_PROFILE_STEPS) reviewedEmpty = markSurgeProfileStepReviewed(reviewedEmpty, step);
  reviewedEmpty = { ...reviewedEmpty, completed: true };
  const plannerDraft = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE).draft;
  const plannerSession = createHomeEnergyPlannerSession({
    ...plannerDraft,
    postcode: "3000",
    situation: "owner",
    propertyType: "house",
    occupants: "three_four",
    switchboard: "older_fuses",
  }, 1);

  const restored = mergeHomeEnergyPlannerSessionIntoSurgeProfile(reviewedEmpty, plannerSession);
  assert.equal(restored.postcode, "3000");
  assert.equal(restored.situation, "owner");
  assert.equal(restored.propertyType, "house");
  assert.equal(restored.occupants, "three_four");
  assert.equal(restored.switchboard, "older_fuses");
  assert.equal(restored.completed, false);
});

test("only 45 confirmed answers complete Surge context, including after a planner import", () => {
  let reviewedUnknown = EMPTY_SURGE_STARTER_PROFILE;
  for (const step of SURGE_PROFILE_STEPS) reviewedUnknown = markSurgeProfileStepReviewed(reviewedUnknown, step);
  const parsedUnknown = parseSurgeStarterProfile({ ...reviewedUnknown, completed: true });
  assert.equal(parsedUnknown.completed, false);
  assert.equal(surgeProfileReviewedAnswerCount(parsedUnknown), SURGE_PROFILE_FIELDS.length);
  assert.equal(surgeProfileKnownAnswerCount(parsedUnknown), 0);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(parsedUnknown, -1), -1);
  assert.equal(nextUnknownSurgeProfileStepIndex(parsedUnknown, -1), 0);

  const plannerProfile = fullyKnownProfile();
  assert.equal(plannerProfile.completed, true);
  assert.equal(surgeProfileKnownAnswerCount(plannerProfile), SURGE_PROFILE_FIELDS.length);
  assert.equal(nextUnknownSurgeProfileStepIndex(plannerProfile, -1), -1);
  const plannerDraft = surgeHomeEnergyPlannerSession(plannerProfile).draft;
  const plannerSession = createHomeEnergyPlannerSession(plannerDraft, 4);
  const restored = mergeHomeEnergyPlannerSessionIntoSurgeProfile(EMPTY_SURGE_STARTER_PROFILE, plannerSession);
  assert.equal(restored.completed, true, "the shared planner preserves every confirmed Surge context answer");
  assert.equal(restored.postcode, plannerDraft.postcode);
});

test("44 of 45 identifies and routes directly to the single missing answer", () => {
  const complete = fullyKnownProfile();
  const missing = answer(complete, "supplemental:gasConnection", "not-sure");
  const restored = parseSurgeStarterProfile({ ...missing, completed: true });

  assert.equal(restored.completed, false);
  assert.equal(surgeProfileKnownAnswerCount(restored), 44);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(restored, -1), -1);
  assert.equal(SURGE_PROFILE_STEPS[nextUnknownSurgeProfileStepIndex(restored, -1)].id, "routine-constraints");
  assert.deepEqual(
    SURGE_PROFILE_FIELDS.filter((profileField) => surgeProfileFieldIsUnknown(restored, profileField)).map(({ id }) => id),
    ["supplemental:gasConnection"],
  );
});

test("a gas appliance infers mains gas until the customer explicitly selects bottled LPG", () => {
  let profile = answer(EMPTY_SURGE_STARTER_PROFILE, "feature:cooking", "gas-cooking");
  assert.equal(profile.gasConnection, "connected");
  assert.equal(surgeProfileFieldWasReviewed(profile, field("supplemental:gasConnection")), false);

  profile = answer(profile, "supplemental:gasConnection", "bottled-lpg");
  profile = answer(profile, "feature:heating-cooling-systems", "gas-heating");
  assert.equal(profile.gasConnection, "bottled-lpg");
  assert.equal(surgeProfileFieldWasReviewed(profile, field("supplemental:gasConnection")), true);
});
