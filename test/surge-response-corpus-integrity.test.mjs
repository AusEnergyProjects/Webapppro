import assert from "node:assert/strict";
import test from "node:test";
import {
  SURGE_RESPONSE_REGRESSION_CORPUS,
  SURGE_RESPONSE_REGRESSION_FAMILIES,
} from "../src/data/surge-response-regression-corpus.ts";
import { parseSurgePlanContext } from "../src/lib/energy-assistant-plan-context.ts";
import { SURGE_RESPONSE_GENERIC_FALLBACK_PATTERNS } from "../src/lib/surge-response-regression-gate.ts";

const TAGS = new Set([
  "context",
  "multi_part",
  "numeric",
  "safety",
  "urgent_safety",
  "saved_context",
  "volatile_fact",
]);

function normalise(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function assertPatternsCompile(patterns, label) {
  for (const pattern of patterns) {
    assert.doesNotThrow(() => new RegExp(pattern, "iu"), `${label}: ${pattern}`);
  }
}

test("the Surge regression corpus is exactly 40 families by 10 unique cases", () => {
  assert.equal(SURGE_RESPONSE_REGRESSION_FAMILIES.length, 40);
  assert.equal(new Set(SURGE_RESPONSE_REGRESSION_FAMILIES).size, 40);
  assert.equal(SURGE_RESPONSE_REGRESSION_CORPUS.length, 400);

  const ids = new Set();
  const questions = new Set();
  const familyNames = new Set(SURGE_RESPONSE_REGRESSION_FAMILIES);
  for (const family of SURGE_RESPONSE_REGRESSION_FAMILIES) {
    const cases = SURGE_RESPONSE_REGRESSION_CORPUS.filter((entry) => entry.family === family);
    assert.equal(cases.length, 10, family);
    assert.deepEqual(cases.map((entry) => entry.variant), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], family);
  }

  for (const entry of SURGE_RESPONSE_REGRESSION_CORPUS) {
    assert.ok(familyNames.has(entry.family), entry.id);
    assert.match(entry.id, new RegExp(`^${entry.family}-\\d{2}$`), entry.id);
    assert.equal(ids.has(entry.id), false, entry.id);
    ids.add(entry.id);

    const question = normalise(entry.question);
    assert.ok(question.length >= 8, entry.id);
    assert.equal(questions.has(question), false, entry.id);
    questions.add(question);
    assert.ok(entry.question.length <= 1_200, entry.id);
    assert.doesNotMatch(entry.question, /(?:variant|test case|fixture)\s*\d+/i, entry.id);

    assert.ok(entry.clauses.length >= 1, `${entry.id}: no concept clauses`);
    assert.equal(new Set(entry.clauses.map((clause) => clause.id)).size, entry.clauses.length, entry.id);
    for (const clause of entry.clauses) {
      assert.ok(clause.id.length > 0, entry.id);
      assert.ok(clause.anyOf.length >= 1, `${entry.id}:${clause.id}`);
      assertPatternsCompile(clause.anyOf, `${entry.id}:${clause.id}`);
    }
    assert.equal(
      new Set(entry.requiredNumbers.map((assertion) => assertion.id)).size,
      entry.requiredNumbers.length,
      entry.id,
    );
    for (const assertion of entry.requiredNumbers) {
      assert.ok(assertion.anyOf.length >= 1, `${entry.id}:${assertion.id}`);
      assertPatternsCompile(assertion.anyOf, `${entry.id}:${assertion.id}`);
    }
    assertPatternsCompile(entry.forbiddenPatterns, `${entry.id}:forbidden`);
    assertPatternsCompile(entry.safetyLeadAnyOf, `${entry.id}:safety-lead`);
    assert.ok(entry.tags.every((tag) => TAGS.has(tag)), entry.id);
    assert.ok(entry.recentTurns.length <= 8, entry.id);
    assert.ok(entry.maxWords >= 40 && entry.maxWords <= 200, entry.id);
    assert.ok(entry.maxParagraphs >= 1 && entry.maxParagraphs <= 6, entry.id);
    assert.ok(entry.maxQuestions === 0 || entry.maxQuestions === 1, entry.id);
    if (entry.planContext) {
      assert.deepEqual(parseSurgePlanContext(entry.planContext), entry.planContext, entry.id);
      assert.ok(entry.tags.includes("saved_context"), entry.id);
    }
    if (entry.tags.includes("urgent_safety")) {
      assert.equal(entry.modelPolicy, "forbidden", entry.id);
      assert.equal(entry.maxQuestions, 0, entry.id);
      assert.ok(entry.safetyLeadAnyOf.length >= 1, entry.id);
    }
  }

  assert.equal(ids.size, 400);
  assert.equal(questions.size, 400);
});

test("the corpus carries the release-critical cross-cutting slices", () => {
  const tagged = (tag) => SURGE_RESPONSE_REGRESSION_CORPUS.filter((entry) => entry.tags.includes(tag));
  assert.equal(tagged("context").length, 10);
  assert.equal(tagged("multi_part").length, 10);
  assert.equal(tagged("urgent_safety").length, 10);
  assert.equal(tagged("saved_context").length, 10);
  assert.equal(tagged("volatile_fact").length, 10);
  assert.ok(tagged("numeric").length >= 150);
  assert.ok(tagged("safety").length >= 20);
  assert.ok(SURGE_RESPONSE_REGRESSION_CORPUS.every((entry) => entry.quickReplies === undefined));
  assertPatternsCompile(SURGE_RESPONSE_GENERIC_FALLBACK_PATTERNS, "generic-fallback");
});

test("follow-up and paragraph allowances are explicit family decisions", () => {
  const oneFollowUpFamilies = [
    "aluminium_frame",
    "battery_import_export",
    "battery_low_bill",
    "battery_quote",
    "condensation_constraint",
    "draught_vs_glass",
    "ev_charger",
    "fit_plan",
    "free_hours",
    "gas_vs_rcac",
    "honeycomb_coverings",
    "hpwh_finance",
    "hpwh_noise",
    "hpwh_size",
    "hpwh_timing",
    "messy_compound",
    "quote_scope",
    "rcac_bill_jump",
    "rcac_cold_rooms",
    "rcac_noise",
    "rebate_eligibility",
    "short_followup",
    "solar_shade",
    "solar_size_usage",
    "strata_approval",
    "three_phase_claim",
    "underfloor",
  ];
  const actualOneFollowUpFamilies = [...new Set(
    SURGE_RESPONSE_REGRESSION_CORPUS
      .filter((entry) => entry.maxQuestions === 1)
      .map((entry) => entry.family),
  )].sort();
  assert.deepEqual(actualOneFollowUpFamilies, oneFollowUpFamilies);

  for (const family of [
    "certificate_value",
    "solar_oversize",
    "upgrade_priority",
    "urgent_safety",
  ]) {
    assert.ok(
      SURGE_RESPONSE_REGRESSION_CORPUS
        .filter((entry) => entry.family === family)
        .every((entry) => entry.maxQuestions === 0),
      family,
    );
  }

  const partialAllowances = new Map([
    ["aluminium_frame", [1, 5, 9, 10]],
    ["condensation_constraint", [5, 9]],
    ["ev_charger", [8, 9]],
    ["honeycomb_coverings", [7]],
    ["hpwh_finance", [1, 2, 3, 4, 6, 7, 10]],
    ["hpwh_timing", [1, 5, 6, 7, 8, 9, 10]],
    ["messy_compound", [1, 3, 4, 8, 9, 10]],
    ["rcac_cold_rooms", [1, 2, 3, 4, 6, 7, 8, 10]],
    ["short_followup", [3, 5, 6, 8, 10]],
    ["solar_size_usage", [1, 2, 3, 7, 8, 9, 10]],
    ["underfloor", [5, 7, 8, 9]],
  ]);
  for (const [family, variants] of partialAllowances) {
    assert.deepEqual(
      SURGE_RESPONSE_REGRESSION_CORPUS
        .filter((entry) => entry.family === family && entry.maxQuestions === 1)
        .map((entry) => entry.variant),
      variants,
      family,
    );
  }

  const paragraphLimits = new Map([
    ["rcac_bill_jump", 5],
    ["renter_actions", 6],
    ["trade_referral", 5],
  ]);
  for (const [family, expected] of paragraphLimits) {
    assert.ok(
      SURGE_RESPONSE_REGRESSION_CORPUS
        .filter((entry) => entry.family === family)
        .every((entry) => entry.maxParagraphs === expected),
      family,
    );
  }
  assert.ok(
    SURGE_RESPONSE_REGRESSION_CORPUS
      .filter((entry) => entry.family === "surge_vs_saul")
      .every((entry) => entry.modelPolicy === "forbidden"),
  );
  assert.ok(
    SURGE_RESPONSE_REGRESSION_CORPUS
      .filter((entry) => entry.family === "trade_referral")
      .every((entry) => entry.modelPolicy === "forbidden"),
  );
  assert.ok(
    SURGE_RESPONSE_REGRESSION_CORPUS
      .filter((entry) => entry.family === "certificate_value")
      .every((entry) => entry.modelPolicy === "official_lookup"),
  );
});

test("generated times and decimal solar sizes remain natural customer inputs", () => {
  const timing = SURGE_RESPONSE_REGRESSION_CORPUS.find((entry) => entry.id === "hpwh_timing-02");
  const solar = SURGE_RESPONSE_REGRESSION_CORPUS.find((entry) => entry.id === "solar_size_usage-06");
  assert.ok(timing);
  assert.ok(solar);
  assert.match(timing.question, /1:30 pm/i);
  assert.doesNotMatch(timing.question, /13:30 pm|14:30 pm/i);
  assert.match(solar.question, /12\.1 kW/i);
  assert.doesNotMatch(solar.question, /000000000000|999999999999/i);
});
