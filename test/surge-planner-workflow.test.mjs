import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addressLocalitiesForPostcode } from "../src/lib/address-localities.mjs";
import {
  customerHomeFeatureSections,
  customerProjectOptions,
  updateHomeFeatureSelection,
} from "../src/lib/customer-projects.mjs";
import {
  buildEnergyAssistantEnquirySubmission,
} from "../src/lib/energy-assistant-enquiry-adapter.mjs";
import {
  HOME_ENERGY_PLANNER_DIRECT_QUESTIONS,
  HOME_ENERGY_PLANNER_QUESTIONS,
  HOME_ENERGY_PLANNER_SESSION_VERSION,
  createHomeEnergyPlannerPlan,
  createHomeEnergyPlannerPlanInput,
  createHomeEnergyPlannerSession,
  sanitizeHomeEnergyPlannerDraft,
} from "../src/lib/home-energy-planner-schema.ts";
import {
  normalizePublicPlanSnapshot,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
} from "../src/lib/public-plan-quote-preparation.mjs";
import {
  EMPTY_SURGE_STARTER_PROFILE,
  SURGE_PROFILE_FIELDS,
  surgeHomeEnergyPlannerSession,
  updateSurgeProfileField,
} from "../src/lib/surge-assessor-profile.ts";

const widgetSource = readFileSync(
  new URL("../src/components/EnergyAssistantWidget.tsx", import.meta.url),
  "utf8",
);
const plannerSource = readFileSync(
  new URL("../src/components/HomeEnergyPlanner.tsx", import.meta.url),
  "utf8",
);

const directQuestionOptions = new Map([
  ["postcode", []],
  ["situation", customerProjectOptions.situations],
  ["propertyType", customerProjectOptions.propertyTypes],
  ["approvalContext", customerProjectOptions.approvalContexts],
  ["occupants", customerProjectOptions.occupants],
  ["goals", customerProjectOptions.goals],
  ["pace", customerProjectOptions.paces],
  ["budgetRange", customerProjectOptions.budgets],
  ["storeys", customerProjectOptions.storeys],
  ["floorArea", customerProjectOptions.floorAreas],
  ["ageBand", customerProjectOptions.ageBands],
  ["sharedWalls", customerProjectOptions.sharedWalls],
  ["wallConstruction", customerProjectOptions.wallConstructions],
  ["floorConstruction", customerProjectOptions.floorConstructions],
  ["roofType", customerProjectOptions.roofTypes],
  ["roofColour", customerProjectOptions.roofColours],
  ["roofForm", customerProjectOptions.roofForms],
  ["roofCondition", customerProjectOptions.roofConditions],
  ["switchboard", customerProjectOptions.switchboards],
]);

function minimalPlanSnapshot(overrides = {}) {
  return {
    goals: ["lower-bills", "improve-comfort"],
    pace: "staged",
    situation: "owner",
    approvalContext: "none",
    budgetRange: "2_10k",
    addressState: "VIC",
    features: [
      "comfort-too-hot",
      "ceiling-insulation-limited",
      "single-glazing",
      "gas-heating",
      "gas-storage-hot-water",
      "gas-cooking",
      "solar-none",
      "battery-none",
      "ev-none",
    ],
    propertyContext: {
      propertyType: "house",
      storeys: "single",
      ageBand: "1960_1999",
      floorArea: "100_199",
      occupants: "three_four",
      sharedWalls: "none",
      roofType: "tile",
      roofColour: "medium",
      roofForm: "pitched",
      roofCondition: "serviceable",
      switchboard: "modern_breakers",
      wallConstruction: "brick_veneer",
      floorConstruction: "slab_on_ground",
    },
    ...overrides,
  };
}

function matchedTradeEnquiry(overrides = {}) {
  const locality = addressLocalitiesForPostcode("3006")?.localities[0];
  assert.ok(locality, "test postcode must have an authoritative locality");
  return {
    submissionId: "20260821.12345678-abcd-4abc-8def-123456789abc",
    clientStartedAt: 1_776_744_000_000,
    consentAccepted: true,
    consentGrantedAt: "2026-08-21T04:00:00.000Z",
    customerFirstName: "Jamie",
    customerLastName: "Customer",
    email: "jamie@example.com",
    phone: "0400 000 000",
    customerUnitNumber: "",
    customerStreetAddress: "15 Example Street",
    customerSuburb: locality.suburb,
    customerState: locality.state,
    postcode: "3006",
    services: ["heating-cooling"],
    customerMessage: "Please arrange an independent heating and cooling quote.",
    shareContact: { name: false, phone: false, address: false },
    quoteAnswers: [],
    shareKnownPlanFacts: false,
    planSnapshot: minimalPlanSnapshot(),
    ...overrides,
  };
}

function normalizedSnapshotFromDraft(draft) {
  const input = createHomeEnergyPlannerPlanInput(draft);
  const normalized = normalizePublicPlanSnapshot({
    goals: input.goals,
    pace: input.pace,
    situation: input.situation,
    approvalContext: input.approvalContext,
    budgetRange: input.budgetRange,
    addressState: input.addressState,
    features: input.features,
    propertyContext: input.propertyContext,
  });
  assert.equal(normalized.ok, true, normalized.error);
  return normalized.value;
}

test("the canonical planner registry represents every planner question and exact option set once", () => {
  assert.equal(HOME_ENERGY_PLANNER_DIRECT_QUESTIONS.length, directQuestionOptions.size);
  assert.deepEqual(
    HOME_ENERGY_PLANNER_DIRECT_QUESTIONS.map((question) => question.id),
    [...directQuestionOptions.keys()],
  );
  for (const question of HOME_ENERGY_PLANNER_DIRECT_QUESTIONS) {
    assert.deepEqual(
      question.options,
      directQuestionOptions.get(question.id),
      `${question.id} must use the canonical customerProjectOptions values and labels`,
    );
  }

  const canonicalFeatureQuestions = customerHomeFeatureSections
    .flatMap((section) => section.questions);
  const registeredFeatureQuestions = HOME_ENERGY_PLANNER_QUESTIONS
    .filter((question) => question.featureQuestionId);
  assert.equal(registeredFeatureQuestions.length, canonicalFeatureQuestions.length);
  for (const featureQuestion of canonicalFeatureQuestions) {
    const matches = registeredFeatureQuestions.filter(
      (question) => question.featureQuestionId === featureQuestion.id,
    );
    assert.equal(matches.length, 1, `${featureQuestion.id} must be represented exactly once`);
    const [registered] = matches;
    assert.equal(registered.id, `feature:${featureQuestion.id}`);
    assert.equal(registered.draftKey, "features");
    assert.equal(registered.kind, featureQuestion.mode === "multiple" ? "multiselect" : "select");
    assert.deepEqual(registered.options, featureQuestion.options);
    assert.equal(registered.unknownValue, featureQuestion.unknownValue);
    assert.equal(registered.noneValue, featureQuestion.noneValue);
  }

  const ids = HOME_ENERGY_PLANNER_QUESTIONS.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length, "no planner question may be duplicated");
  assert.equal(
    HOME_ENERGY_PLANNER_QUESTIONS.length,
    directQuestionOptions.size + canonicalFeatureQuestions.length,
  );

  const canonicalSurgeFields = SURGE_PROFILE_FIELDS.filter((field) => ids.includes(field.id));
  assert.equal(canonicalSurgeFields.length, HOME_ENERGY_PLANNER_QUESTIONS.length);
  for (const question of HOME_ENERGY_PLANNER_QUESTIONS) {
    const matches = canonicalSurgeFields.filter((field) => field.id === question.id);
    assert.equal(matches.length, 1, `Surge must ask ${question.id} exactly once`);
    assert.deepEqual(
      matches[0].options || [],
      question.options.map(([value, label]) => ({ value, label })),
      `Surge must use the exact planner options for ${question.id}`,
    );
  }
});

test("equivalent complete answers create the same versioned planner session and generated plan", () => {
  assert.match(
    plannerSource,
    /createHomeEnergyPlannerPlan\(draft\)/,
    "HomeEnergyPlanner must consume the shared canonical generator",
  );
  let profile = {
    ...EMPTY_SURGE_STARTER_PROFILE,
    goals: [],
    features: [],
    reviewed: [],
    completed: true,
  };
  const expectedCandidate = { goals: [], features: [] };
  for (const question of HOME_ENERGY_PLANNER_QUESTIONS) {
    const value = question.kind === "postcode" ? "3006" : question.options[0]?.[0];
    assert.ok(value, `${question.id} needs a complete-answer fixture value`);
    profile = updateSurgeProfileField(profile, question.id, value, true);
    if (question.featureQuestionId) {
      expectedCandidate.features = updateHomeFeatureSelection(
        expectedCandidate.features,
        question.featureQuestionId,
        value,
        true,
      );
    } else if (question.draftKey === "goals") {
      expectedCandidate.goals.push(value);
    } else {
      expectedCandidate[question.draftKey] = value;
    }
  }

  const expectedDraft = sanitizeHomeEnergyPlannerDraft(expectedCandidate);
  const plannerSession = createHomeEnergyPlannerSession(expectedDraft);
  const surgeSession = surgeHomeEnergyPlannerSession(profile);
  assert.deepEqual(surgeSession, plannerSession);
  assert.deepEqual(surgeSession, {
    version: HOME_ENERGY_PLANNER_SESSION_VERSION,
    draft: expectedDraft,
    stage: 4,
  });
  assert.deepEqual(
    createHomeEnergyPlannerPlan(surgeSession.draft),
    createHomeEnergyPlannerPlan(plannerSession.draft),
    "Surge and HomeEnergyPlanner must generate the identical plan from identical answers",
  );
  assert.deepEqual(
    normalizedSnapshotFromDraft(surgeSession.draft),
    normalizedSnapshotFromDraft(plannerSession.draft),
    "Surge and HomeEnergyPlanner must generate the identical canonical public-plan snapshot",
  );
});

test("the final enquiry choice selects exactly one existing endpoint and rejects mixed routing", () => {
  const assistantPayload = {
    requestId: "lead-request-00000001",
    tradeSharingConsent: { accepted: false },
  };
  assert.deepEqual(
    buildEnergyAssistantEnquirySubmission({
      destination: "aea-follow-up",
      assistantPayload,
    }),
    {
      endpoint: "/api/energy-assistant/leads",
      payload: assistantPayload,
    },
  );

  const matched = buildEnergyAssistantEnquirySubmission({
    destination: "matched-trades",
    tradeEnquiry: matchedTradeEnquiry(),
  });
  assert.deepEqual(Object.keys(matched).sort(), ["endpoint", "payload"]);
  assert.equal(matched.endpoint, "/api/leads");
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "matched-trades",
      assistantPayload,
      tradeEnquiry: matchedTradeEnquiry(),
    }),
    /not both/i,
  );
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "aea-follow-up",
      assistantPayload,
      tradeEnquiry: matchedTradeEnquiry(),
    }),
    /not both/i,
  );
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "aea-follow-up",
      assistantPayload: {
        ...assistantPayload,
        tradeSharingConsent: { accepted: true },
      },
    }),
    /must use the private-plan trade enquiry path/i,
  );
});

test("the Surge matched-trade handoff uses the public-plan consent contract without chat, photos or private plan items", () => {
  const submission = buildEnergyAssistantEnquirySubmission({
    destination: "matched-trades",
    tradeEnquiry: matchedTradeEnquiry(),
  });
  assert.equal(submission.endpoint, "/api/leads");
  assert.deepEqual(submission.payload.consent, {
    accepted: true,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    grantedAt: "2026-08-21T04:00:00.000Z",
  });
  assert.deepEqual(submission.payload.quotePreparation, {
    version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    answers: [],
    photoPromptIds: [],
    expectedPhotoCount: 0,
    uploadKeyHash: "",
  });
  assert.deepEqual(Object.keys(submission.payload.planSnapshot).sort(), [
    "addressState",
    "approvalContext",
    "budgetRange",
    "features",
    "goals",
    "pace",
    "propertyContext",
    "situation",
    "version",
  ]);
  assert.doesNotMatch(
    JSON.stringify(submission.payload),
    /"(?:chatHistory|conversation|messages|transcript|documents|bills|photos|plan|items)"\s*:/i,
  );
});

test("the widget routes one finalized enquiry through the adapter and one endpoint-driven fetch", () => {
  assert.match(widgetSource, /surgePlannerProfileAdapter\(profile\)/);
  assert.match(
    widgetSource,
    /storePlannerAssessment\(JSON\.stringify\(plannerProfile\.session\)\)/,
    "the planner handoff must persist the shared versioned session envelope",
  );
  assert.match(widgetSource, /availableSessionStorages\(\)/);
  assert.match(widgetSource, /router\.push\("\/plan"\)/);
  assert.equal(
    widgetSource.match(/buildEnergyAssistantEnquirySubmission\(/g)?.length,
    1,
    "one final adapter call must choose the endpoint",
  );
  assert.equal(
    widgetSource.match(/fetch\(submission\.endpoint,/g)?.length,
    1,
    "one finalized submission must issue one endpoint-driven request",
  );
  assert.match(
    widgetSource,
    /if \([^)]*leadBusy[^)]*leadStatus[^)]*\) return;/,
    "a completed or in-flight lead must not be submitted twice",
  );
  assert.doesNotMatch(widgetSource, /fetch\("\/api\/(?:leads|energy-assistant\/leads)"/);
});
