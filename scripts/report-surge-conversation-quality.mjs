import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { SURGE_CONVERSATION_EVALUATION_CORPUS } from "../src/data/surge-conversation-evaluation-corpus.ts";
import { SURGE_CONVERSATION_REVIEWED_RESULTS } from "../src/data/surge-conversation-reviewed-results.ts";
import { evaluateSurgeConversationReleaseGate } from "../src/lib/surge-conversation-quality-gate.ts";

const repositoryDirectory = fileURLToPath(new URL("..", import.meta.url));
const corpusUrl = new URL("../src/data/surge-conversation-evaluation-corpus.ts", import.meta.url);
const mutableDeploymentLabels = new Set([
  "current", "default", "head", "latest", "live", "main", "master", "prod", "production", "staging",
]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function environmentValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function gitRevision() {
  const supplied = argumentValue("--git-sha") || environmentValue("SURGE_GIT_SHA", "GIT_COMMIT_SHA", "CF_PAGES_COMMIT_SHA");
  if (supplied) return supplied;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function latencySummary(results) {
  const values = results.map((result) => result.latencyMs).filter(Number.isFinite);
  return {
    samples: values.length,
    averageMs: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maximumMs: values.length ? Math.max(...values) : null,
  };
}

function countsBy(results, key) {
  return Object.fromEntries([...new Set(results.map((result) => result[key]))]
    .sort()
    .map((value) => [value, results.filter((result) => result[key] === value).length]));
}

function releaseSummary(gate) {
  return {
    ready: gate.ready,
    totalCases: gate.totalCases,
    totalResults: gate.totalResults,
    passRate: gate.totalResults
      ? Number((gate.results.filter((result) => result.passed).length / gate.totalResults).toFixed(4))
      : 0,
    dimensions: Object.fromEntries(Object.entries(gate.dimensions).map(([name, value]) => [name, {
      evaluated: value.evaluated,
      passed: value.passed,
      passRate: value.passRate,
      threshold: value.threshold,
      ready: value.ready,
    }])),
    latency: latencySummary(gate.results),
    answerSources: countsBy(gate.results, "answerSource"),
    answerStatuses: countsBy(gate.results, "answerStatus"),
  };
}

function baselineResultSet(report, identity) {
  if (!report) return null;
  if (!Array.isArray(report.resultSets)) return report;
  return report.resultSets.find((entry) => (
    entry.deploymentLabel === identity.deploymentLabel
    && entry.requestedModel === identity.requestedModel
    && (entry.providerModel ?? null) === (identity.providerModel ?? null)
  )) ?? null;
}

function trendAgainstBaseline(current, baseline) {
  if (!baseline) return null;
  const baselineSummary = baseline.summary ?? baseline;
  const baselineDimensions = baselineSummary.dimensions ?? {};
  return {
    passRateDelta: typeof baselineSummary.passRate === "number"
      ? Number((current.passRate - baselineSummary.passRate).toFixed(4))
      : null,
    averageLatencyDeltaMs: typeof baselineSummary.latency?.averageMs === "number" && typeof current.latency.averageMs === "number"
      ? Number((current.latency.averageMs - baselineSummary.latency.averageMs).toFixed(2))
      : null,
    p95LatencyDeltaMs: typeof baselineSummary.latency?.p95Ms === "number" && typeof current.latency.p95Ms === "number"
      ? current.latency.p95Ms - baselineSummary.latency.p95Ms
      : null,
    dimensionPassRateDeltas: Object.fromEntries(Object.entries(current.dimensions).map(([name, value]) => [
      name,
      typeof baselineDimensions[name]?.passRate === "number"
        ? Number((value.passRate - baselineDimensions[name].passRate).toFixed(4))
        : null,
    ])),
  };
}

function normaliseAnswerStatus(status) {
  if (status === "needs_context") return "clarification_required";
  if (["answered", "clarification_required", "source_review_required", "unavailable"].includes(status)) return status;
  throw new Error(`endpoint returned unsupported aggregate answer status: ${String(status)}`);
}

function assertImmutableDeploymentLabel(value) {
  if (!value?.trim()) throw new Error("each deployed target requires an immutable deploymentLabel");
  if (mutableDeploymentLabels.has(value.trim().toLocaleLowerCase("en-AU"))) {
    throw new Error(`deployment label must be immutable, received: ${value}`);
  }
  return value.trim();
}

function assertBaseUrl(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("deployed quality targets require HTTPS; HTTP is allowed only for localhost rehearsal");
  }
  return url.href.replace(/\/$/, "");
}

function targetIdentity(target) {
  return {
    baseUrl: assertBaseUrl(target.baseUrl),
    deploymentLabel: assertImmutableDeploymentLabel(target.deploymentLabel),
    deploymentId: target.deploymentId ?? null,
    appVersion: target.appVersion ?? null,
    gitSha: target.gitSha ?? null,
    promptSha256: target.promptSha256 ?? null,
    sourceSha256: target.sourceSha256 ?? null,
    requestedModel: target.requestedModel?.trim() || null,
    providerModel: target.providerModel?.trim() || null,
  };
}

async function loadJson(path) {
  return path ? JSON.parse(await readFile(path, "utf8")) : null;
}

async function configuredTargets() {
  const matrixPath = argumentValue("--deployment-matrix");
  if (matrixPath) {
    const parsed = await loadJson(matrixPath);
    const targets = Array.isArray(parsed) ? parsed : parsed?.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error("deployment matrix must contain a non-empty targets array");
    }
    return targets.map(targetIdentity);
  }

  const baseUrl = argumentValue("--base-url");
  if (!baseUrl) return [];
  const requestedModel = argumentValue("--requested-model") || environmentValue("SURGE_MODEL");
  if (!requestedModel) throw new Error("deployed quality runs require --requested-model");
  return [targetIdentity({
    baseUrl,
    deploymentLabel: argumentValue("--deployment-label"),
    deploymentId: argumentValue("--deployment-id") || environmentValue("SURGE_DEPLOYMENT_ID", "CF_PAGES_DEPLOYMENT_ID"),
    appVersion: argumentValue("--app-version") || environmentValue("SURGE_APP_VERSION", "APP_VERSION"),
    gitSha: argumentValue("--git-sha") || environmentValue("SURGE_GIT_SHA", "GIT_COMMIT_SHA", "CF_PAGES_COMMIT_SHA"),
    promptSha256: argumentValue("--prompt-sha256") || environmentValue("SURGE_QUALITY_PROMPT_SHA256", "SURGE_PROMPT_SHA256"),
    sourceSha256: argumentValue("--source-sha256") || environmentValue("SURGE_QUALITY_SOURCE_SHA256", "SURGE_SOURCE_SHA256"),
    requestedModel,
    providerModel: argumentValue("--provider-model") || environmentValue("SURGE_PROVIDER_MODEL"),
  })];
}

function syntheticMessages(turns) {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return turns.map((turn, index) => ({
    id: `synthetic-${index + 1}`,
    role: turn.role,
    content: turn.content,
    createdAt,
  }));
}

async function executeCase(target, evaluationCase) {
  const turns = syntheticMessages(evaluationCase.syntheticTurns);
  const lastUserIndex = turns.findLastIndex((turn) => turn.role === "user");
  if (lastUserIndex < 0) throw new Error(`${evaluationCase.id}: synthetic case has no user turn`);
  const startedAt = performance.now();
  const response = await fetch(`${target.baseUrl}/api/energy-assistant`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-surge-quality-rehearsal": "aggregate-v1",
    },
    body: JSON.stringify({
      action: "ask",
      requestId: `quality-${evaluationCase.id}`,
      message: turns[lastUserIndex].content,
      recentTurns: turns.slice(0, lastUserIndex),
      audience: "customer",
      pageContext: { pathname: "/surge", title: "Synthetic quality evaluation" },
    }),
  });
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`${evaluationCase.id}: endpoint returned HTTP ${response.status}`);
  }
  if (!payload.reply?.content || !payload.quality?.answerSource || !payload.quality?.answerStatus) {
    throw new Error(`${evaluationCase.id}: endpoint omitted aggregate quality metadata`);
  }
  if (!["deterministic", "grounded", "model"].includes(payload.quality.answerSource)) {
    throw new Error(`${evaluationCase.id}: endpoint returned unsupported aggregate answer source`);
  }
  return {
    caseId: evaluationCase.id,
    response: payload.reply.content,
    answerSource: payload.quality.answerSource,
    answerStatus: normaliseAnswerStatus(payload.quality.answerStatus),
    latencyMs,
    requestedModel: target.requestedModel ?? undefined,
    providerModel: target.providerModel ?? undefined,
  };
}

async function executeTarget(target, baselineReport) {
  const observations = [];
  for (const evaluationCase of SURGE_CONVERSATION_EVALUATION_CORPUS) {
    observations.push(await executeCase(target, evaluationCase));
  }
  const gate = evaluateSurgeConversationReleaseGate(observations);
  const summary = releaseSummary(gate);
  return {
    ...target,
    summary,
    trend: trendAgainstBaseline(summary, baselineResultSet(baselineReport, target)),
    coverageErrors: gate.coverageErrors,
    failedDimensions: gate.failedDimensions,
    failedCaseIds: gate.results.filter((result) => !result.passed).map((result) => result.caseId),
  };
}

function localResultSet(baselineReport) {
  const identity = {
    baseUrl: null,
    deploymentLabel: "reviewed-synthetic-fixture-2026-08-24",
    deploymentId: null,
    appVersion: environmentValue("SURGE_APP_VERSION", "APP_VERSION"),
    gitSha: gitRevision(),
    promptSha256: environmentValue("SURGE_QUALITY_PROMPT_SHA256", "SURGE_PROMPT_SHA256"),
    sourceSha256: environmentValue("SURGE_QUALITY_SOURCE_SHA256", "SURGE_SOURCE_SHA256"),
    requestedModel: environmentValue("SURGE_MODEL"),
    providerModel: environmentValue("SURGE_PROVIDER_MODEL"),
  };
  const gate = evaluateSurgeConversationReleaseGate(SURGE_CONVERSATION_REVIEWED_RESULTS);
  const summary = releaseSummary(gate);
  return {
    ...identity,
    summary,
    trend: trendAgainstBaseline(summary, baselineResultSet(baselineReport, identity)),
    coverageErrors: gate.coverageErrors,
    failedDimensions: gate.failedDimensions,
    failedCaseIds: gate.results.filter((result) => !result.passed).map((result) => result.caseId),
  };
}

function help() {
  console.log(`Usage:
  node --experimental-strip-types scripts/report-surge-conversation-quality.mjs
  node --experimental-strip-types scripts/report-surge-conversation-quality.mjs --base-url <url> --deployment-label <immutable-label> --requested-model <model>
  node --experimental-strip-types scripts/report-surge-conversation-quality.mjs --deployment-matrix <targets.json>

Options: --provider-model, --deployment-id, --app-version, --git-sha, --prompt-sha256,
         --source-sha256, --baseline. Deployed mode stores aggregate results only.`);
}

if (process.argv.includes("--help")) {
  help();
  process.exit(0);
}

const corpusBytes = await readFile(corpusUrl);
const baselinePath = argumentValue("--baseline") || environmentValue("SURGE_QUALITY_BASELINE");
const baselineReport = await loadJson(baselinePath);
const targets = await configuredTargets();
const resultSets = [];
const missingResultSets = [];

if (targets.length === 0) {
  resultSets.push(localResultSet(baselineReport));
} else {
  for (const target of targets) {
    if (!target.requestedModel) {
      missingResultSets.push({
        deploymentLabel: target.deploymentLabel,
        requestedModel: null,
        providerModel: target.providerModel,
        reason: "requested model identity missing",
      });
      continue;
    }
    try {
      resultSets.push(await executeTarget(target, baselineReport));
    } catch (error) {
      missingResultSets.push({
        deploymentLabel: target.deploymentLabel,
        requestedModel: target.requestedModel,
        providerModel: target.providerModel,
        reason: error instanceof Error ? error.message : "quality execution failed",
      });
    }
  }
}

const report = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  aggregateOnly: true,
  provenance: {
    corpusSha256: sha256(corpusBytes),
    corpusCases: SURGE_CONVERSATION_EVALUATION_CORPUS.length,
    baselinePath: baselinePath ?? null,
    baselineCompared: Boolean(baselineReport),
  },
  expectedResultSets: targets.length || 1,
  completedResultSets: resultSets.length,
  missingResultSets,
  resultSets,
};

console.log(JSON.stringify(report, null, 2));
const failed = missingResultSets.length > 0
  || resultSets.length !== report.expectedResultSets
  || resultSets.some((result) => !result.summary.ready);
if (failed) process.exitCode = 1;
