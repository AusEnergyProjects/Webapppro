import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SURGE_CONVERSATION_EVALUATION_CORPUS,
  SURGE_CONVERSATION_EVALUATION_DIMENSIONS,
} from "../src/data/surge-conversation-evaluation-corpus.ts";
import { evaluateSurgeConversationReleaseGate } from "../src/lib/surge-conversation-quality-gate.ts";

test("reviewed synthetic corpus covers every release dimension without customer content", () => {
  assert.deepEqual(
    [...new Set(SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => entry.dimension))].sort(),
    [...SURGE_CONVERSATION_EVALUATION_DIMENSIONS].sort(),
  );
  assert.doesNotMatch(JSON.stringify(SURGE_CONVERSATION_EVALUATION_CORPUS), /email@|phone number|street address|customer_id|request_id/i);
});

test("release gate requires passing evidence in every dimension", () => {
  const passing = SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => ({
    caseId: entry.id,
    dimension: entry.dimension,
    passed: true,
  }));
  assert.equal(evaluateSurgeConversationReleaseGate(passing).ready, true);

  const failing = passing.map((entry) => entry.dimension === "privacy" ? { ...entry, passed: false } : entry);
  const result = evaluateSurgeConversationReleaseGate(failing);
  assert.equal(result.ready, false);
  assert.deepEqual(result.failedDimensions, ["privacy"]);
});

test("quality release migration stores only aggregate rates and readiness", async () => {
  const source = await readFile(
    new URL("../drizzle/0155_surge_conversation_quality_release_daily.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /source_status_pass_rate/);
  assert.match(source, /release_ready/);
  assert.doesNotMatch(source, /message|prompt|answer_text|email|phone|address|postcode|customer/i);
});
