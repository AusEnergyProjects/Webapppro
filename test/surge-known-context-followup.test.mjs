import assert from "node:assert/strict";
import test from "node:test";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";
let requestCounter = 0;

function fixedAnswer(question) {
  return {
    directAnswer: "That detail is enough to continue the decision.",
    practicalSteps: [],
    nextAction: "",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: [question],
    toolActions: [],
    sourceBoundary: "",
  };
}

function request(message, recentTurns = []) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      action: "ask",
      requestId: `known-context-${String(++requestCounter).padStart(4, "0")}`,
      message,
      recentTurns,
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

test("Surge never asks again for a fact supplied in the current answer", async () => {
  for (const [message, repeatedQuestion] of [
    ["We already have rooftop solar.", "Do you already have rooftop solar?"],
    ["There are two people in the home.", "How many people live in the home?"],
    ["The windows are single glazed.", "Are the windows single or double glazed?"],
    ["The house has three-phase power.", "Is the home single-phase or three-phase?"],
  ]) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      composeAnswer: () => fixedAnswer(repeatedQuestion),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.equal(payload.continuation.pendingQuestion, "", message);
  }
});

test("Surge does not repeat a fact already supplied in recent user turns", async () => {
  const response = await handleEnergyAssistantRequest(request("What should I do next?", [
    { role: "user", content: "We are a household of four people." },
    { role: "assistant", content: "That changes hot-water sizing." },
  ]), {
    now: () => NOW,
    composeAnswer: () => fixedAnswer("How many people live in the home?"),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply.followUpQuestion, "");
});
