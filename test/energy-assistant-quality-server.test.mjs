import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSurgeConversationQualityRecorder } from "../src/lib/energy-assistant-quality-server.ts";

test("quality recorder persists only categorical aggregate dimensions and counts", async () => {
  let sql = "";
  let bindings = [];
  let runs = 0;
  const database = {
    prepare(statement) {
      sql = statement;
      return {
        bind(...values) {
          bindings = values;
          return {
            async run() {
              runs += 1;
            },
          };
        },
      };
    },
  };

  await createSurgeConversationQualityRecorder(database)({
    day: "2026-08-22",
    audience: "household",
    turnIntent: "topic_change",
    answerSource: "model",
    answerStatus: "answered",
    correctionExpected: false,
    correctionPassed: true,
    topicSwitchExpected: true,
    topicSwitchPassed: true,
    privacyPassed: true,
    followUpPassed: true,
    latencyMs: 123,
    metadata: {
      corpusSha256: "corpus-abc",
      promptSha256: "prompt-def",
      sourceSha256: "source-ghi",
      appVersion: "app-42",
      gitSha: "git-123",
      deploymentId: "deploy-456",
      requestedModel: "gpt-requested",
      providerModel: "gpt-provider",
    },
  });

  assert.equal(runs, 1);
  assert.match(sql, /INSERT INTO surge_conversation_quality_daily/);
  assert.deepEqual(bindings.slice(0, 13), [
    "2026-08-22",
    "household",
    "topic_change",
    "model",
    "answered",
    "corpus-abc",
    "prompt-def",
    "source-ghi",
    "app-42",
    "git-123",
    "deploy-456",
    "gpt-requested",
    "gpt-provider",
  ]);
  assert.equal(bindings.length, 21);
  assert.equal(bindings[19], 123);
  assert.equal(typeof bindings[20], "number");
  assert.doesNotMatch(`${sql}\n${JSON.stringify(bindings)}`, /message|question_text|answer_text|request_id|client_id|email|phone|address|postcode|ip_address/i);
});

test("quality migrations add grounded model identity aggregates without raw conversation data", async () => {
  const originalSource = await readFile(
    new URL("../drizzle/0154_surge_conversation_quality_daily.sql", import.meta.url),
    "utf8",
  );
  const additiveSource = await readFile(
    new URL("../drizzle/0162_surge_conversation_quality_model_identity.sql", import.meta.url),
    "utf8",
  );
  assert.match(originalSource, /CREATE TABLE `surge_conversation_quality_daily`/);
  assert.match(additiveSource, /'deterministic', 'grounded', 'model'/);
  assert.match(additiveSource, /`corpus_sha256`/);
  assert.match(additiveSource, /`requested_model`/);
  assert.match(additiveSource, /`provider_model`/);
  assert.match(additiveSource, /`latency_total_ms`/);
  assert.match(additiveSource, /INSERT INTO `surge_conversation_quality_daily_next`/);
  assert.doesNotMatch(`${originalSource}\n${additiveSource}`, /message|question_text|answer_text|request_id|client_id|email|phone|address|postcode|ip_address/i);
});
