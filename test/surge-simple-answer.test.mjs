import assert from "node:assert/strict";
import test from "node:test";
import { composeEnergyAssistantAnswer } from "../src/lib/energy-assistant.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import {
  deriveSurgeAnswerPresentation,
  surgePresentationPassesEverydayLanguage,
  surgePresentationText,
} from "../src/lib/surge-everyday-answer.ts";
import { composeSurgeSimpleAnswer } from "../src/lib/surge-simple-answer.ts";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";

function base(message) {
  return composeEnergyAssistantAnswer(message, { asOf: NOW });
}

function simple(message, recentTurns = [], planContext = null) {
  return composeSurgeSimpleAnswer(message, base(message), planContext, recentTurns);
}

function request(message, recentTurns = []) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "ask", message, recentTurns, audience: "public", pageContext: "/surge" }),
  });
}

test("common household fallback questions receive relevant plain answers", () => {
  const cases = [
    ["where should i start", /problem.*costing|hardest to live/i, /internal platform|calendar date/i],
    ["my power bill is way too high", /finding what is using the most electricity/i, /battery fire/i],
    ["is a battery worth it for me", /export spare solar.*after sunset/i, /STC eligibility/i],
    ["why is my bedroom freezing", /draughts.*coldest windows/i, /room-by-room heat load/i],
    ["my windows are covered in condensation", /start with moisture/i, /replacement windows first/i],
    ["should i replace my gas heater", /plan to replace.*reverse-cycle/i, /carbon monoxide is a colourless/i],
    ["can you tell me if this quote is good", /need the quote or its main details/i, /battery.*fire/i],
    ["what size solar system should i get", /electricity use.*roof space.*export limit/i, /self-clean/i],
    ["i rent, what can i actually do", /changes you can take with you/i, /South Australian rental premises/i],
    ["should I replace my windows with double glazing", /do not jump straight/i, /conductive heat flow/i],
    ["do i need more ceiling insulation", /ceiling insulation is often the first/i, /thermal envelope/i],
    ["is heat pump hot water worth considering", /strong replacement for gas or standard electric/i, /STC eligibility/i],
    ["how do I charge my EV at home", /how far you drive.*parked at home/i, /vehicle driven/i],
    ["my lounge is boiling in summer", /stop summer sun reaching the glass/i, /local design temperatures/i],
  ];

  for (const [message, expected, rejected] of cases) {
    const answer = simple(message);
    assert.ok(answer, message);
    const presentation = deriveSurgeAnswerPresentation(answer, message);
    const rendered = surgePresentationText(presentation, true);
    assert.match(rendered, expected, message);
    assert.doesNotMatch(rendered, rejected, message);
    assert.equal(surgePresentationPassesEverydayLanguage(presentation), true, message);
  }
});

test("casual quote follow-ups reuse the previous user topic", () => {
  const recentTurns = [
    { role: "user", content: "I have two heat-pump quotes, one is $6,000 and one is $8,000." },
    { role: "assistant", content: "I can compare the full installation scope." },
  ];
  for (const message of ["what about the cheaper one", "yeah but is it worth it", "and that one?"]) {
    const answer = simple(message, recentTurns);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /price alone|quote/i, message);
    assert.doesNotMatch(answer.directAnswer, /brand|calendar date|battery STC/i, message);
  }
});

test("saved no-solar context changes the battery verdict", () => {
  const answer = simple("is a home battery worth it", [], {
    version: 1,
    source: "home_energy_plan",
    facts: [{ key: "solar", value: "No rooftop solar" }],
  });
  assert.ok(answer);
  assert.match(answer.directAnswer, /^No,.*no rooftop solar/i);
});

test("ordinary gas-heater and quote questions no longer trigger emergency answers", async () => {
  for (const [message, expected] of [
    ["should i replace my gas heater", /reverse-cycle air conditioning/i],
    ["is this quote any good", /need the quote or its main details/i],
  ]) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, expected, message);
    assert.doesNotMatch(payload.reply.content, /Triple Zero|battery fire|colourless, odourless/i, message);
  }
});

test("a follow-up already asked and answered is not repeated", async () => {
  const repeated = "Do the windows feel cold even when there is no wind?";
  const response = await handleEnergyAssistantRequest(request("yeah freezing", [
    { role: "assistant", content: `Try the curtains first. ${repeated}` },
    { role: "user", content: "yeah freezing" },
  ]), {
    now: () => NOW,
    composeAnswer: () => ({
      ...base("cold windows"),
      directAnswer: "That confirms the glass itself is a major source of discomfort.",
      suggestedQuestions: [repeated],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply.followUpQuestion, "");
  assert.equal(payload.reply.quickReplies.length, 0);
  assert.doesNotMatch(payload.reply.content, /no wind/i);
});
