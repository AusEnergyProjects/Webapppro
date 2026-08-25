import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryDirectory = fileURLToPath(new URL("..", import.meta.url));
const reportScript = fileURLToPath(new URL("../scripts/report-surge-conversation-quality.mjs", import.meta.url));

function runReport(argumentsList = []) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types",
    reportScript,
    ...argumentsList,
  ], {
    cwd: repositoryDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      SURGE_MODEL: "",
      SURGE_PROVIDER_MODEL: "",
      SURGE_QUALITY_BASELINE: "",
    },
  });
}

function containsPrivateEvaluationMaterial(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPrivateEvaluationMaterial);
  const forbiddenKeys = new Set([
    "cases",
    "content",
    "messages",
    "response",
    "responses",
    "syntheticTurns",
    "transcript",
    "transcripts",
  ]);
  return Object.entries(value).some(([key, child]) => (
    forbiddenKeys.has(key) || containsPrivateEvaluationMaterial(child)
  ));
}

test("quality report emits one aggregate-only reviewed fixture result set", () => {
  const result = runReport();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.aggregateOnly, true);
  assert.equal(report.expectedResultSets, 1);
  assert.equal(report.completedResultSets, 1);
  assert.deepEqual(report.missingResultSets, []);
  assert.equal(report.resultSets[0].summary.ready, true);
  assert.equal(report.resultSets[0].summary.totalCases, report.provenance.corpusCases);
  assert.equal(containsPrivateEvaluationMaterial(report), false);
});

test("deployed quality mode rejects mutable deployment labels before network access", () => {
  const result = runReport([
    "--base-url", "https://example.invalid",
    "--deployment-label", "latest",
    "--requested-model", "synthetic-model-1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /deployment label must be immutable/i);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /fetch failed|ENOTFOUND|HTTP 5/i);
});

test("quality report help documents deployed and matrix execution modes", () => {
  const result = runReport(["--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /--base-url/);
  assert.match(result.stdout, /--deployment-matrix/);
  assert.match(result.stdout, /aggregate results only/i);
});
