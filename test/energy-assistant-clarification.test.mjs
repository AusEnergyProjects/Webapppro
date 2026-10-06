import assert from "node:assert/strict";
import test from "node:test";
import { composeSurgeReferenceClarification } from "../src/lib/energy-assistant-clarification.ts";
import { composeEnergyAssistantAnswer } from "../src/lib/energy-assistant.ts";
import {
  classifySurgeConversationTurn,
  resolveSurgeConversationReference,
} from "../src/lib/energy-assistant-conversation.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";

const NOW = new Date("2026-08-20T02:00:00.000Z");
const ORIGIN = "https://compare.example.test";

function request(message, extra = {}) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ action: "ask", message, audience: "public", pageContext: "/surge", ...extra }),
  });
}

test("unresolved references ask a relevant question without invented quantities or advice", () => {
  for (const [message, expectedQuestion] of [
    ["Is that one better?", /which options or quotes/i],
    ["Is that battery worth it?", /which battery/i],
    ["What should I do next?", /what question or decision/i],
  ]) {
    const answer = composeSurgeReferenceClarification(message, [], null);
    assert.ok(answer, message);
    assert.equal(answer.status, "needs_context");
    assert.equal(answer.suggestedQuestions.length, 1);
    assert.match(answer.suggestedQuestions[0], expectedQuestion);
    assert.deepEqual(answer.practicalSteps, []);
    assert.deepEqual(answer.citations, []);
    assert.doesNotMatch(JSON.stringify(answer), /\$|\d|\b(?:VIC|NSW|Queensland|approved|installed|booked)\b/);
  }
});

test("greetings and acknowledgements alone cannot resolve an unspecified item", () => {
  const turns = [
    { role: "user", content: "Hi Wattzun!" },
    { role: "assistant", content: "I can help with solar panels." },
    { role: "user", content: "Thanks" },
  ];
  assert.equal(resolveSurgeConversationReference("Is that one better?", turns, null).status, "needs_clarification");
  assert.ok(composeSurgeReferenceClarification("Is that one better?", turns, null));
});

test("a real user-supplied referent or pending input continues without a subject question", () => {
  const turns = [{ role: "user", content: "My battery quote is $12,000 for 10 kWh." }];
  assert.equal(composeSurgeReferenceClarification("Is that battery worth it?", turns, null), null);
  assert.equal(composeSurgeReferenceClarification("3000", [], {
    version: 1,
    activeTopic: "solar",
    goal: "Calculate STCs for my solar installation",
    facts: [],
    pendingQuestion: "What is the property postcode?",
    lastAnswerSummary: "The postcode is needed for the calculation.",
  }), null);
});

test("a greeting retained as a goal does not become a usable item reference", () => {
  const current = {
    version: 1, activeTopic: "general", goal: "Hi Wattzun!", facts: [], pendingQuestion: "",
    lastAnswerSummary: "Wattzun can help with Australian home energy.",
  };
  assert.equal(resolveSurgeConversationReference("Is that one better?", [], current).status, "needs_clarification");
});

test("generic clarification waits through acknowledgements and then uses a concrete intent", async () => {
  const first = await handleEnergyAssistantRequest(request("Can you do it?"), { now: () => NOW });
  const initial = await first.json();
  assert.match(initial.reply.followUpQuestion, /^What question or decision/);
  for (const message of ["Hi", "Okay"]) {
    const clarification = composeSurgeReferenceClarification(message, [], initial.continuation);
    assert.ok(clarification, message);
    assert.equal(clarification.suggestedQuestions[0], initial.reply.followUpQuestion);
  }
  const message = "My bedroom is freezing and I want to reduce heat loss.";
  assert.equal(composeSurgeReferenceClarification(message, [], initial.continuation), null);
  assert.equal(classifySurgeConversationTurn(message, initial.continuation), "answer_to_follow_up");
  const response = await handleEnergyAssistantRequest(request(message, { continuation: initial.continuation }), { now: () => NOW });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.doesNotMatch(payload.reply.followUpQuestion, /^What question or decision/);
  assert.match(payload.reply.content, /heat|warm|draught|insulation/i);
});

test("a short clear topic question and supplied factual statement receive ordinary advice", () => {
  for (const message of [
    "How should I reduce the draught under my front door?",
    "A Victorian quote values STCs at $36 and VEECs at $70. Do those certificate rates make sense?",
    "For my saved 3072 apartment, remember that the front door is draughty and the windows are single glazed.",
  ]) {
    assert.equal(composeSurgeReferenceClarification(message, [], null), null, message);
  }
});

test("an unresolved request bypasses provider generation even when ordinary advice requires a model", async () => {
  let providerCalls = 0;
  let reservations = 0;
  const response = await handleEnergyAssistantRequest(request("Is that one better?"), {
    now: () => NOW,
    requireValidatedModelForOrdinaryAdvice: true,
    reserveModelCall: async () => { reservations += 1; return { allowed: true, release: async () => undefined }; },
    generateAnswer: async () => { providerCalls += 1; throw new Error("should clarify first"); },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply.status, "needs_context");
  assert.match(payload.reply.followUpQuestion, /which options or quotes/i);
  assert.equal(payload.continuation.pendingQuestion, payload.reply.followUpQuestion);
  assert.equal(providerCalls, 0);
  assert.equal(reservations, 0);
  assert.doesNotMatch(payload.reply.content, /postcode|owner|renter|\$|\b\d+\s*kW/);
});

test("supplying the requested options continues the original comparison and removes the question", async () => {
  const first = await handleEnergyAssistantRequest(request("Is that one better?"), { now: () => NOW });
  const initial = await first.json();
  const details = "Quote A is $7,000 for 6.6 kW solar. Quote B is $10,000 for 10 kW solar. Both include the same installation scope.";
  assert.equal(classifySurgeConversationTurn(details, initial.continuation), "answer_to_follow_up");
  let observed;
  const response = await handleEnergyAssistantRequest(request(details, {
    continuation: initial.continuation,
    recentTurns: [
      { role: "user", content: "Is that one better?" },
      { role: "assistant", content: initial.reply.content },
    ],
  }), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
    generateAnswer: async (context) => {
      observed = context;
      return {
        answer: {
          directAnswer: "Quote A is $7,000 for 6.6 kW; Quote B is $10,000 for 10 kW. With the same installation scope, the larger system only adds useful value if your use and permitted exports justify it.",
          practicalSteps: [], nextAction: "", status: "answered", citations: [], assumptions: [],
          confidence: "medium", suggestedQuestions: [], toolActions: [], sourceBoundary: "",
        },
        continuation: { ...context.continuation, pendingQuestion: "", lastAnswerSummary: "Compared the supplied solar quotes." },
      };
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(observed);
  assert.match(observed.continuation.goal, /Is that one better/);
  assert.equal(payload.reply.followUpQuestion, "");
  assert.equal(payload.continuation.pendingQuestion, "");
  assert.match(payload.reply.content, /Quote A.*\$7,000.*6\.6 kW/);
  assert.match(payload.reply.content, /Quote B.*\$10,000.*10 kW/);
});

test("a yes reply cannot fill in missing options or turn the comparison into a fabricated answer", async () => {
  const first = await handleEnergyAssistantRequest(request("Is that one better?"), { now: () => NOW });
  const initial = await first.json();
  let providerCalls = 0;
  const response = await handleEnergyAssistantRequest(request("Yes please", {
    continuation: initial.continuation,
    recentTurns: [{ role: "user", content: "Is that one better?" }],
  }), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
    generateAnswer: async () => { providerCalls += 1; return null; },
  });
  const payload = await response.json();
  assert.equal(payload.reply.status, "needs_context");
  assert.equal(payload.reply.followUpQuestion, initial.reply.followUpQuestion);
  assert.equal(providerCalls, 0);
});

test("a reported battery fire risk retains the safety response before clarifying a comparison", async () => {
  const response = await handleEnergyAssistantRequest(request("My battery is smoking. Is that one better?"), { now: () => NOW });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.reply.content, /000|firefighters/i);
  assert.doesNotMatch(payload.reply.followUpQuestion, /which options/i);
});

test("an unspecified task asks for the objective before unrelated property inputs", () => {
  const answer = composeEnergyAssistantAnswer("Help please", { asOf: NOW, sources: [] });
  assert.equal(answer.status, "needs_context");
  assert.match(answer.suggestedQuestions[0], /question or trade task/i);
  assert.deepEqual(answer.practicalSteps, []);
  assert.doesNotMatch(answer.directAnswer, /postcode|owner|renter|equipment/i);
});

test("existing progressive eligibility asks only missing inputs and retains supplied ones", () => {
  const answer = composeEnergyAssistantAnswer("What rebates apply to replacing my gas hot water with a heat pump?", {
    asOf: NOW,
    priorUserMessages: ["I am an owner-occupier at postcode 3000."],
  });
  assert.equal(answer.status, "needs_context");
  assert.equal(answer.suggestedQuestions.length, 1);
  assert.doesNotMatch(answer.suggestedQuestions[0], /postcode|owner|renter/);
  assert.doesNotMatch(answer.directAnswer, /\$\d|\b\d+\s*(?:STCs?|VEECs?)\b/);
});
