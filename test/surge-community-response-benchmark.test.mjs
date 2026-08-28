import assert from "node:assert/strict";
import test from "node:test";
import { SURGE_COMMUNITY_RESPONSE_BENCHMARK } from "../src/data/surge-community-response-benchmark.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import { buildSurgePlanContextFromStoredAssessment } from "../src/lib/energy-assistant-plan-context.ts";
import { surgeAnswerMatchesQuestionIntent } from "../src/lib/surge-simple-answer.ts";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";
const SAVED_PLAN = buildSurgePlanContextFromStoredAssessment(JSON.stringify({
  version: 1,
  stage: 4,
  draft: {
    postcode: "3000",
    situation: "owner",
    approvalContext: "strata",
    propertyType: "apartment",
    occupants: "two",
    goals: ["improve-comfort", "lower-bills"],
    pace: "whole-home",
    budgetRange: "under_2k",
    storeys: "single",
    ageBand: "1960_1999",
    floorArea: "under_100",
    sharedWalls: "two_plus_sides",
    wallConstruction: "masonry_concrete",
    floorConstruction: "suspended_concrete",
    roofType: "tile",
    roofColour: "light",
    roofForm: "flat_low_pitch",
    roofCondition: "good",
    switchboard: "modern_breakers",
    features: [
      "comfort-too-cold",
      "condensation-moisture",
      "ceiling-insulation-not-applicable",
      "floor-insulation-not-applicable",
      "single-glazing",
      "window-coverings-basic",
      "external-shading-none",
      "kitchen-exhaust-fan",
      "bathroom-exhaust-fan",
      "reverse-cycle",
    ],
  },
}));

function requestFor(entry) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      action: "ask",
      requestId: `benchmark-${entry.id}`,
      message: entry.question,
      recentTurns: entry.recentTurns || [],
      planContext: entry.useSavedHomeContext ? SAVED_PLAN : undefined,
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

function includesAny(text, terms) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

test("community-derived questions stay direct, relevant and useful without a model call", async () => {
  assert.ok(SAVED_PLAN);
  assert.equal(SURGE_COMMUNITY_RESPONSE_BENCHMARK.length >= 12, true);
  const failures = [];

  for (const entry of SURGE_COMMUNITY_RESPONSE_BENCHMARK) {
    const response = await handleEnergyAssistantRequest(requestFor(entry), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, entry.id);
    const payload = await response.json();
    const content = payload.reply.content;

    if (!surgeAnswerMatchesQuestionIntent(entry.question, content)) {
      failures.push(`${entry.id}: answer drifted from the question`);
    }
    for (const group of entry.requiredAnswerGroups) {
      if (!includesAny(content, group)) {
        failures.push(`${entry.id}: missing ${group.join(" or ")}`);
      }
    }
    for (const rejected of entry.rejectedPhrases || []) {
      if (content.toLowerCase().includes(rejected.toLowerCase())) {
        failures.push(`${entry.id}: included rejected phrase ${rejected}`);
      }
    }
    if (payload.reply.quickReplies.length) failures.push(`${entry.id}: returned quick replies`);
    if (content.split(/\s+/u).filter(Boolean).length > 150) failures.push(`${entry.id}: exceeded 150 words`);
  }

  assert.equal(failures.length, 0, failures.join("\n"));
});

test("off-topic grounded and model answers cannot replace the direct draught answer", async () => {
  const entry = SURGE_COMMUNITY_RESPONSE_BENCHMARK.find((candidate) => candidate.id === "community-bedroom-draught");
  assert.ok(entry);
  const offTopic = {
    directAnswer: "A suitable fixed reverse-cycle air conditioner is normally the most efficient electric choice for heating a room.",
    practicalSteps: ["Estimate each room load and floor area."],
    nextAction: "Measure the room.",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: ["What rooms and floor area need heating or cooling?"],
    toolActions: [],
    sourceBoundary: "",
  };
  const response = await handleEnergyAssistantRequest(requestFor(entry), {
    now: () => NOW,
    resolveGroundedAnswer: async () => offTopic,
    reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
    generateAnswer: async () => ({
      answer: offTopic,
      continuation: {
        version: 1,
        activeTopic: "heating",
        goal: "size a heater",
        facts: [],
        comparedOptions: [],
        pendingQuestion: offTopic.suggestedQuestions[0],
        lastAnswerSummary: offTopic.directAnswer,
      },
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.reply.content, /sealing the gaps|weather seals|door snake/i);
  assert.doesNotMatch(payload.reply.content, /room load|floor area need heating/i);
});

test("a topic-matched model answer cannot dilute a direct community answer", async () => {
  const entry = SURGE_COMMUNITY_RESPONSE_BENCHMARK.find((candidate) => candidate.id === "community-hpwh-finance-claim");
  assert.ok(entry);
  let modelReservationAttempted = false;
  const response = await handleEnergyAssistantRequest(requestFor(entry), {
    now: () => NOW,
    reserveModelCall: async () => {
      modelReservationAttempted = true;
      return { allowed: true, release: async () => undefined };
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.reply.content, /\$38[^.]*6 years[^.]*\$2,736/i);
  assert.match(payload.reply.content, /does not equal[^.]*\$4,664/i);
  assert.equal(modelReservationAttempted, false);
});
