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
  nextUnreviewedSurgeProfileStepIndex,
  parseSurgeStarterProfile,
  SURGE_PROFILE_FIELDS,
  SURGE_PROFILE_STEPS,
  surgeHomeEnergyPlannerSession,
  surgePlannerProfileAdapter,
  surgeProfileFieldIsUnknown,
  surgeProfileFieldValue,
  surgeProfileKnownAnswerCount,
  surgeProfileReviewedAnswerCount,
  surgeStarterProfileContext,
  updateSurgeProfileField,
} from "../src/lib/surge-assessor-profile.ts";

const field = (id) => {
  const match = SURGE_PROFILE_FIELDS.find((candidate) => candidate.id === id);
  assert.ok(match, `missing profile field ${id}`);
  return match;
};

const answer = (profile, id, value, checked = true) =>
  updateSurgeProfileField(profile, field(id), value, checked);

test("a fresh Surge profile asserts no material home facts", () => {
  assert.equal(EMPTY_SURGE_STARTER_PROFILE.completed, false);
  assert.equal(EMPTY_SURGE_STARTER_PROFILE.postcode, "");
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.goals, []);
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.features, []);
  assert.deepEqual(EMPTY_SURGE_STARTER_PROFILE.reviewed, []);
  assert.equal(surgeProfileKnownAnswerCount(EMPTY_SURGE_STARTER_PROFILE), 0);
  assert.equal(surgeProfileReviewedAnswerCount(EMPTY_SURGE_STARTER_PROFILE), 0);
  assert.equal(surgeStarterProfileContext(EMPTY_SURGE_STARTER_PROFILE), "");
  const session = surgeHomeEnergyPlannerSession(EMPTY_SURGE_STARTER_PROFILE);
  assert.equal(session.stage, 0);
  assert.equal(session.draft.postcode, "");
  assert.deepEqual(session.draft.features, []);
  for (const profileField of SURGE_PROFILE_FIELDS) {
    assert.equal(surgeProfileFieldIsUnknown(EMPTY_SURGE_STARTER_PROFILE, profileField), true);
  }
});

test("saving an edited section continues to the next unreviewed section until the context is complete", () => {
  let profile = markSurgeProfileStepReviewed(EMPTY_SURGE_STARTER_PROFILE, SURGE_PROFILE_STEPS[0]);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 0), 1);

  profile = markSurgeProfileStepReviewed(profile, SURGE_PROFILE_STEPS[2]);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 2), 3);

  for (const step of SURGE_PROFILE_STEPS) profile = markSurgeProfileStepReviewed(profile, step);
  assert.equal(nextUnreviewedSurgeProfileStepIndex(profile, 7), -1);

  const restored = parseSurgeStarterProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.completed, true);
  assert.equal(restored.reviewed.length, SURGE_PROFILE_FIELDS.length);
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
  assert.equal(migrated.completed, true);
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
  assert.equal(restored.completed, true);
});

test("completed Surge context stays complete and a finished planner import is not reopened", () => {
  let completed = EMPTY_SURGE_STARTER_PROFILE;
  for (const step of SURGE_PROFILE_STEPS) completed = markSurgeProfileStepReviewed(completed, step);
  const parsed = parseSurgeStarterProfile({ ...completed, completed: false });
  assert.equal(parsed.completed, true, "all reviewed Surge fields are canonical completed context");
  assert.equal(surgeProfileReviewedAnswerCount(parsed), SURGE_PROFILE_FIELDS.length);

  let plannerProfile = EMPTY_SURGE_STARTER_PROFILE;
  for (const profileField of SURGE_PROFILE_FIELDS) {
    if (profileField.kind === "postcode") plannerProfile = answer(plannerProfile, profileField.id, "3006");
    else {
      const value = profileField.options?.find((option) =>
        option.value && option.value !== profileField.unknownValue && option.value !== "not-sure")?.value;
      if (value) plannerProfile = answer(plannerProfile, profileField.id, value);
    }
  }
  for (const step of SURGE_PROFILE_STEPS) plannerProfile = markSurgeProfileStepReviewed(plannerProfile, step);
  const plannerDraft = surgeHomeEnergyPlannerSession(plannerProfile).draft;
  const plannerSession = createHomeEnergyPlannerSession(plannerDraft, 4);
  const restored = mergeHomeEnergyPlannerSessionIntoSurgeProfile(EMPTY_SURGE_STARTER_PROFILE, plannerSession);
  assert.equal(restored.completed, true, "a fully reviewed planner session is sufficient saved home context");
  assert.equal(restored.postcode, plannerDraft.postcode);
});

test("the transmitted profile summary keeps whole critical facts inside its hard bound", () => {
  let profile = EMPTY_SURGE_STARTER_PROFILE;
  const critical = [
    ["postcode", "3006"], ["situation", "owner"], ["goals", "improve-comfort"],
    ["budgetRange", "2_10k"], ["supplemental:timing", "within_3_months"],
    ["approvalContext", "strata"], ["supplemental:disruption", "minimal"],
    ["supplemental:plannedWorks", "renovation"],
  ];
  for (const [id, value] of critical) profile = answer(profile, id, value);
  for (const profileField of SURGE_PROFILE_FIELDS) {
    if (profile.reviewed.includes(profileField.id)) continue;
    if (profileField.kind === "postcode" || !profileField.options?.length) continue;
    const value = profileField.options.find((option) =>
      option.value !== profileField.unknownValue && option.value !== "not-sure")?.value;
    if (value) profile = answer(profile, profileField.id, value);
  }
  profile = { ...profile, completed: true };
  const context = surgeStarterProfileContext(profile);
  assert.ok(context.length <= 1_050, `context is ${context.length} characters`);
  for (const fact of [
    "postcode=3006", "situation=owner", "goals=improve-comfort", "budgetRange=2_10k",
    "timing=within_3_months", "approvalContext=strata", "disruption=minimal", "plannedWorks=renovation",
  ]) assert.ok(context.includes(fact), `missing critical fact ${fact}`);
  const factText = context.replace(/^Customer supplied home context: /, "")
    .replace(/\. Treat newer chat details as corrections\.$/, "");
  assert.ok(factText.split("; ").every((fact) => /^[A-Za-z0-9:-]+=[^;]+$/.test(fact)), "all facts remain whole");
});
