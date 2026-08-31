import assert from "node:assert/strict";
import test from "node:test";

import { composeEnergyAssistantAnswer } from "../src/lib/energy-assistant.ts";

const AS_OF = "2026-08-27T00:00:00.000Z";

function answer(query) {
  return composeEnergyAssistantAnswer(query, { asOf: AS_OF });
}

function citationIds(result) {
  return new Set(result.citations.map((citation) => citation.id));
}

function assertPlainPunctuation(result) {
  assert.doesNotMatch(result.directAnswer, /[\u2013\u2014]/);
}

test("routes current PRC value questions to the governed NSW PDRS path", () => {
  const result = answer("What are PRCs worth at the latest trade? My property is in NSW.");

  assert.equal(result.status, "source_review_required");
  assert.match(result.directAnswer, /PRC/i);
  assert.ok(citationIds(result).has("nsw-pdrs-rule-current-2026"));
  assert.doesNotMatch(result.directAnswer, /\b(?:VEEC|STC)\b/i);
  assertPlainPunctuation(result);
});

test("fails closed when a VEEC question is asked for a South Australian property", () => {
  const result = answer(
    "How many VEECs and what discount would a heat pump create? The installation is in South Australia 5000.",
  );

  assert.equal(result.status, "answered");
  assert.match(result.directAnswer, /Victoria/i);
  assert.match(result.directAnswer, /South Australia/i);
  assert.equal(citationIds(result).has("veu-water-space-activity-guide-v3-19"), false);
  assertPlainPunctuation(result);
});

test("requests missing governed inputs for a Victorian VEEC count or discount", () => {
  const result = answer(
    "How many VEECs and what discount would a heat pump hot water system create at postcode 3000 when replacing gas?",
  );

  assert.equal(result.status, "needs_context");
  assert.match(result.directAnswer, /exact approved model/i);
  assert.ok(citationIds(result).has("veu-water-space-activity-guide-v3-19"));
  assertPlainPunctuation(result);
});

test("does not invent a tradable ACT EEIS household certificate value", () => {
  const result = answer(
    "What is the current ACT EEIS certificate value for a heat pump at postcode 2600?",
  );

  assert.equal(result.status, "needs_context");
  assert.match(result.directAnswer, /retailer obligation/i);
  assert.ok(citationIds(result).has("government-program:act-eeis"));
  assertPlainPunctuation(result);
});

test("routes current STC price questions to the governed national SRES sources", () => {
  const result = answer("What is the latest STC spot price for solar at postcode 3000?");

  assert.equal(result.status, "source_review_required");
  const ids = citationIds(result);
  assert.ok(ids.has("cer-stc-entitlement-calculation"));
  assert.ok(ids.has("cer-small-scale-system-requirements"));
  assertPlainPunctuation(result);
});

test("plain STC and VEEC definitions carry both maintained official references", () => {
  const result = answer("What are STCs and VEECs in normal words?");

  assert.equal(result.status, "answered");
  assert.match(result.directAnswer, /STCs?.*national Small-scale Renewable Energy Scheme/is);
  assert.match(result.directAnswer, /VEECs?.*Victorian Energy Upgrades/is);
  assert.equal(result.suggestedQuestions.length, 0);
  const ids = citationIds(result);
  assert.ok(ids.has("cer-stc-entitlement-calculation"));
  assert.ok(ids.has("veu-water-space-activity-guide-v3-19"));
  assertPlainPunctuation(result);
});

test("current STC and VEEC values cannot be answered by the static definition", () => {
  for (const query of [
    "What are the current STC and VEEC values today?",
    "What are STCs and VEECs trading for?",
  ]) {
    const result = answer(query);
    assert.notEqual(result.status, "answered", query);
    assert.doesNotMatch(result.directAnswer, /^STCs and VEECs are certificates that can reduce/i, query);
    assert.match(result.directAnswer, /separate governed programmes|current|official|which programme|cannot safely|missing inputs|postcode/i, query);
    assertPlainPunctuation(result);
  }
});

test("fails closed when one question mixes certificate programmes", () => {
  const result = answer("Compare the current VEEC and ESC prices for my property.");

  assert.equal(result.status, "needs_context");
  assert.match(result.directAnswer, /separate governed programmes/i);
  const ids = citationIds(result);
  assert.equal(ids.has("veu-water-space-activity-guide-v3-19"), false);
  assert.equal(ids.has("nsw-ess-rule-current-2026"), false);
  assertPlainPunctuation(result);
});
