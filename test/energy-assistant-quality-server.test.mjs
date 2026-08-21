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
  });

  assert.equal(runs, 1);
  assert.match(sql, /INSERT INTO surge_conversation_quality_daily/);
  assert.deepEqual(bindings.slice(0, 5), ["2026-08-22", "household", "topic_change", "model", "answered"]);
  assert.equal(bindings.length, 12);
  assert.doesNotMatch(`${sql}\n${JSON.stringify(bindings)}`, /message|question_text|answer_text|request_id|client|email|phone|address|postcode/i);
});

test("quality migration contains no raw conversation or customer identity columns", async () => {
  const source = await readFile(
    new URL("../drizzle/0154_surge_conversation_quality_daily.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /CREATE TABLE `surge_conversation_quality_daily`/);
  assert.doesNotMatch(source, /message|question_text|answer_text|request_id|client|email|phone|address|postcode|ip_address/i);
});
