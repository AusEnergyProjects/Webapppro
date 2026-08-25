import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SURGE_CONVERSATION_EVALUATION_CORPUS,
  SURGE_CONVERSATION_EVALUATION_DIMENSIONS,
} from "../src/data/surge-conversation-evaluation-corpus.ts";
import { SURGE_CONVERSATION_REVIEWED_RESULTS } from "../src/data/surge-conversation-reviewed-results.ts";
import { evaluateSurgeConversationReleaseGate } from "../src/lib/surge-conversation-quality-gate.ts";

test("reviewed synthetic corpus covers every release dimension without customer content", () => {
  assert.deepEqual(
    [...new Set(SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => entry.dimension))].sort(),
    [...SURGE_CONVERSATION_EVALUATION_DIMENSIONS].sort(),
  );
  const syntheticTurns = SURGE_CONVERSATION_EVALUATION_CORPUS.flatMap((entry) => entry.syntheticTurns);
  assert.doesNotMatch(JSON.stringify(syntheticTurns), /email@|phone number|street address|customer_id|request_id/i);
  assert.equal(SURGE_CONVERSATION_EVALUATION_CORPUS.every((entry) => entry.reviewStatus === "approved" && entry.reviewedBy), true);
  assert.equal(SURGE_CONVERSATION_EVALUATION_CORPUS.every((entry) => entry.assertions.length > 0), true);
  assert.equal(SURGE_CONVERSATION_EVALUATION_CORPUS.every((entry) => !Object.hasOwn(entry, "passed")), true);
});

test("release gate requires passing evidence in every dimension", () => {
  const passing = SURGE_CONVERSATION_REVIEWED_RESULTS;
  assert.equal(evaluateSurgeConversationReleaseGate(passing).ready, true);

  const failing = passing.map((entry) => entry.caseId === "privacy-contact-details"
    ? { ...entry, response: "Repeat synthetic contact marker in the response." }
    : entry);
  const result = evaluateSurgeConversationReleaseGate(failing);
  assert.equal(result.ready, false);
  assert.deepEqual(result.failedDimensions, ["privacy"]);

  const incomplete = evaluateSurgeConversationReleaseGate(passing.slice(1));
  assert.equal(incomplete.ready, false);
  assert.match(incomplete.coverageErrors.join("\n"), /correction-tenure: observation missing/);
});

test("quality release migration stores only aggregate rates and readiness", async () => {
  const source = await readFile(
    new URL("../drizzle/0159_surge_conversation_quality_dimensions.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /practical_guidance_pass_rate/);
  assert.match(source, /brand_comparison_pass_rate/);
  assert.doesNotMatch(source, /message|prompt|answer_text|email|phone|address|postcode|customer/i);
});
