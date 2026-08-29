import assert from "node:assert/strict";
import test from "node:test";
import {
  composeEnergyAssistantAnswer,
  isSurgeNamedReferenceQuestion,
  isSurgeServiceLocationFollowUp,
  isSurgeServiceOrCompetingQuoteRequest,
} from "../src/lib/energy-assistant.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";
let requestCounter = 0;

function request(message) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      action: "ask",
      requestId: `quote-route-${String(++requestCounter).padStart(4, "0")}`,
      message,
      recentTurns: [],
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

test("reviewing an existing quote never becomes a trade lead or a publisher question", async () => {
  const cases = [
    "I have two solar quotes. Which is better?",
    "I have quotes for comparison. Which is better?",
    "I want a solar quote reviewed",
    "I want a solar quote checked",
    "Can I have a solar quote reviewed?",
    "I need help comparing my solar quote. Is $4200 fair?",
    "Compare these two battery quotes: $4200 and $6800.",
    "Can you review the solar quotes I received?",
  ];

  for (const message of cases) {
    assert.equal(isSurgeServiceOrCompetingQuoteRequest(message), false, message);
    assert.equal(isSurgeNamedReferenceQuestion(message), false, message);
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, /quote|price/i, message);
    assert.doesNotMatch(payload.reply.directAnswer, /find solar installers|Get competing quotes|postcode 4200|publisher|internal reference/i, message);
  }
});

test("explicit requests to source another quote remain trade-service intent", () => {
  for (const message of [
    "Please get me another solar quote.",
    "Can you find installers covering regional Victoria so I can get three solar quotes?",
    "Find a heat-pump installer near Ballarat.",
    "Two solar quotes please",
    "Can I have two solar quotes?",
    "I want solar quotes",
    "Get me some solar quotes",
    "Another heat pump quote please",
    "Can Surge send my enquiry to installers?",
    "Can you send my solar enquiry to installers?",
  ]) {
    assert.equal(isSurgeServiceOrCompetingQuoteRequest(message), true, message);
    const answer = composeEnergyAssistantAnswer(message, { asOf: NOW });
    assert.match(answer.directAnswer, /help you find|Get competing quotes/i, message);
  }
});

test("natural requests for new quotes do not capture existing quote review", () => {
  for (const message of [
    "Can you compare these two solar quotes?",
    "I want you to review my solar quotes.",
    "I have another heat pump quote. Is it any good?",
    "Please check whether the solar quote I received is fair.",
  ]) {
    assert.equal(isSurgeServiceOrCompetingQuoteRequest(message), false, message);
  }
});

test("short locations continue a recognised installer enquiry while unrelated prose does not", () => {
  const prior = ["Can Surge send my enquiry to installers?"];
  for (const location of [
    "3000 Melbourne",
    "Ballarat",
    "Ballarat VIC",
    "in Ballarat",
    "regional Victoria",
    "Wendouree",
  ]) {
    assert.equal(isSurgeServiceLocationFollowUp(location, prior), true, location);
    const answer = composeEnergyAssistantAnswer(location, { asOf: NOW, priorUserMessages: prior });
    assert.equal(answer.status, "answered", location);
    assert.match(answer.directAnswer, /help you find|Get competing quotes/i, location);
  }

  for (const unrelated of [
    "Can you compare the quote first?",
    "I changed my mind about this",
    "Not sure yet",
    "Thanks",
    "Yes",
    "Sure",
    "in no rush",
    "Explain how solar works",
  ]) {
    assert.equal(isSurgeServiceLocationFollowUp(unrelated, prior), false, unrelated);
  }
});

test("a request for trades serving a postcode stays on the deterministic enquiry path", async () => {
  const message = "Can Surge help me find licensed heat-pump and solar trades that service postcode 3300?";
  assert.equal(isSurgeServiceOrCompetingQuoteRequest(message), true);
  const coreAnswer = composeEnergyAssistantAnswer(message, { asOf: NOW });
  assert.match(coreAnswer.directAnswer, /help you find solar installers who work in postcode 3300/i);
  assert.match(coreAnswer.directAnswer, /do not favour any company or product/i);
  assert.match(coreAnswer.directAnswer, /Get competing quotes below/i);

  let reservations = 0;
  let modelCalls = 0;
  const response = await handleEnergyAssistantRequest(request(message), {
    now: () => NOW,
    reserveModelCall: async () => {
      reservations += 1;
      return { allowed: true, release: async () => undefined };
    },
    generateAnswer: async () => {
      modelCalls += 1;
      return null;
    },
  });
  assert.equal(response.status, 200);
  assert.equal(reservations, 0);
  assert.equal(modelCalls, 0);
  const payload = await response.json();
  assert.match(payload.reply.directAnswer, /postcode 3300/i);
  assert.deepEqual(payload.reply.quickReplies, []);
});

test("a mixed product and installer question is answered as a whole before service routing", async () => {
  const message = "Is a 180 litre heat-pump hot-water unit enough for two people, how do I judge whether the brand is reliable, and how do I find an installer that services postcode 3000?";
  assert.equal(isSurgeServiceOrCompetingQuoteRequest(message), true);
  const coreAnswer = composeEnergyAssistantAnswer(message, { asOf: NOW });
  assert.doesNotMatch(coreAnswer.directAnswer, /^Yes, we can help you find approved trades/i);
  let modelCalls = 0;
  const response = await handleEnergyAssistantRequest(request(message), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
    generateAnswer: async () => {
      modelCalls += 1;
      return {
        answer: {
          ...composeEnergyAssistantAnswer(message, { asOf: NOW }),
          directAnswer: "A 180 litre heat-pump hot-water unit can suit two people if its recovery matches consecutive showers. Check the full warranty, labour cover, local parts and service network rather than trusting the brand name. Use licensed installers who service postcode 3000 and compare complete itemised quotes.",
          practicalSteps: [],
          suggestedQuestions: [],
        },
        continuation: {
          version: 1,
          activeTopic: "hot_water",
          goal: "Choose a suitable hot-water unit and installer",
          facts: [],
          pendingQuestion: "",
          lastAnswerSummary: "Covered tank size, reliability and finding installers.",
        },
      };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(modelCalls, 1);
  const payload = await response.json();
  assert.match(payload.reply.directAnswer, /180 litre.*two people/i);
  assert.match(payload.reply.directAnswer, /warranty.*local parts.*service network/i);
  assert.match(payload.reply.directAnswer, /installers.*postcode 3000/i);

  const fallbackResponse = await handleEnergyAssistantRequest(request(message), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  const fallbackPayload = await fallbackResponse.json();
  assert.match(fallbackPayload.reply.directAnswer, /180 litre.*two people/i);
  assert.match(fallbackPayload.reply.directAnswer, /warranty.*local parts/i);
  assert.match(fallbackPayload.reply.directAnswer, /installers.*postcode/i);
  assert.doesNotMatch(fallbackPayload.reply.directAnswer, /^Yes, we can help you find approved trades/i);
});

test("the Solar Quotes publisher remains protected without misclassifying ordinary solar quotes", () => {
  assert.equal(isSurgeNamedReferenceQuestion("What does Solar Quotes recommend for batteries?"), true);
  assert.equal(isSurgeNamedReferenceQuestion("What does SolarQuotes.com.au recommend for batteries?"), true);
  assert.equal(isSurgeNamedReferenceQuestion("Can you compare my two solar quotes?"), false);
});
