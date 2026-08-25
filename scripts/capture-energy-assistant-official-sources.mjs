import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import { ENERGY_ASSISTANT_OFFICIAL_SOURCE_BASELINES } from "../src/data/energy-assistant-official-source-capture-baselines.ts";
import {
  OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION,
  captureOfficialSourceBytes,
  compareCapturedArtifactToBaseline,
  validateOfficialSourceFinalUrl,
} from "../src/lib/energy-assistant-official-source-custody.ts";

export const OFFICIAL_SOURCE_CAPTURE_REPORT_CONTRACT =
  "energy-assistant-official-source-capture-report-v1";
export const OFFICIAL_SOURCE_REVIEW_QUEUE_CONTRACT =
  "energy-assistant-official-source-pending-review-queue-v1";
export const OFFLINE_CAPTURE_FIXTURE_CONTRACT =
  "energy-assistant-official-source-capture-fixture-v1";

const DEFAULT_CONCURRENCY = 4;
const SUMMARY_FILE_NAME = "official-source-capture-report.json";
const QUEUE_FILE_NAME = "official-source-pending-review-queue.json";

function isOfficialHttpsSource(source) {
  if (!source || source.official !== true || typeof source.url !== "string") return false;
  try {
    return new URL(source.url).protocol === "https:";
  } catch {
    return false;
  }
}

function sortSources(sources) {
  return [...sources].sort((left, right) => left.id.localeCompare(right.id));
}

function assertUniqueSourceIds(sources) {
  const seen = new Set();
  for (const source of sources) {
    if (seen.has(source.id)) {
      throw new Error(`Official source registry contains duplicate source id: ${source.id}`);
    }
    seen.add(source.id);
  }
}

export function selectOfficialHttpsSources(registry, requestedSourceIds = []) {
  const eligibleSources = sortSources(registry.filter(isOfficialHttpsSource));
  assertUniqueSourceIds(eligibleSources);
  if (!requestedSourceIds.length) return eligibleSources;

  const eligibleById = new Map(eligibleSources.map((source) => [source.id, source]));
  const requestedIds = [...new Set(requestedSourceIds)].sort();
  const ineligibleIds = requestedIds.filter((sourceId) => !eligibleById.has(sourceId));
  if (ineligibleIds.length) {
    throw new Error(
      `Requested source ids are absent from the official HTTPS registry: ${ineligibleIds.join(", ")}`,
    );
  }
  return requestedIds.map((sourceId) => eligibleById.get(sourceId));
}

function normaliseCapturedAt(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid capture timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function fixtureBodyBytes(entry) {
  const hasUtf8 = typeof entry.bodyUtf8 === "string";
  const hasBase64 = typeof entry.bodyBase64 === "string";
  if (hasUtf8 === hasBase64) {
    throw new Error(
      `Fixture response ${entry.sourceId} must provide exactly one of bodyUtf8 or bodyBase64.`,
    );
  }
  return hasUtf8
    ? new TextEncoder().encode(entry.bodyUtf8)
    : new Uint8Array(Buffer.from(entry.bodyBase64, "base64"));
}

export function createOfflineFixtureFetch(fixture, eligibleSources) {
  if (fixture?.contractVersion !== OFFLINE_CAPTURE_FIXTURE_CONTRACT) {
    throw new Error(
      `Offline fixture contract must be ${OFFLINE_CAPTURE_FIXTURE_CONTRACT}.`,
    );
  }
  if (!Array.isArray(fixture.responses)) {
    throw new Error("Offline fixture responses must be an array.");
  }

  const eligibleById = new Map(eligibleSources.map((source) => [source.id, source]));
  const responseByUrl = new Map();
  for (const entry of fixture.responses) {
    const source = eligibleById.get(entry?.sourceId);
    if (!source || entry.declaredUrl !== source.url) {
      throw new Error(
        `Fixture response ${entry?.sourceId || "unknown"} does not match an eligible registry entry.`,
      );
    }
    if (!Number.isInteger(entry.statusCode) || entry.statusCode < 100 || entry.statusCode > 599) {
      throw new Error(`Fixture response ${entry.sourceId} has an invalid HTTP status code.`);
    }
    const finalUrl = entry.finalUrl || entry.declaredUrl;
    const finalUrlValidation = validateOfficialSourceFinalUrl(source, finalUrl);
    if (!finalUrlValidation.allowed) {
      throw new Error(
        `Fixture response ${entry.sourceId} has a disallowed final URL. ${finalUrlValidation.reason}`,
      );
    }
    if (responseByUrl.has(entry.declaredUrl)) {
      throw new Error(`Offline fixture contains duplicate URL: ${entry.declaredUrl}`);
    }
    responseByUrl.set(entry.declaredUrl, {
      bytes: fixtureBodyBytes(entry),
      finalUrl: finalUrlValidation.finalUrl,
      headers: entry.headers || {},
      statusCode: entry.statusCode,
    });
  }

  return async function offlineFixtureFetch(url) {
    const entry = responseByUrl.get(String(url));
    if (!entry) {
      throw new Error("The offline fixture has no response for the requested official source.");
    }
    const response = new Response(entry.bytes, {
      status: entry.statusCode,
      headers: entry.headers,
    });
    Object.defineProperty(response, "url", { value: entry.finalUrl });
    return response;
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function reportRowForFailure(source, outcome) {
  return {
    sourceId: source.id,
    declaredUrl: source.url,
    captureStatus: "fetch_failed",
    capturedAt: outcome.capturedAt,
    metadata: null,
    changeState: "not_compared",
    changeReasons: [],
    baselineSha256: null,
    errorCode: outcome.errorCode,
    gateState: "blocked",
  };
}

function reportRowForCaptured(source, artifact, baseline) {
  if (!artifact.metadata.ok) {
    return {
      sourceId: source.id,
      declaredUrl: source.url,
      captureStatus: "captured",
      capturedAt: artifact.metadata.capturedAt,
      metadata: artifact.metadata,
      changeState: "not_compared",
      changeReasons: [],
      baselineSha256: baseline?.artifactSha256 || null,
      errorCode: "non_success_http_status",
      gateState: "blocked",
    };
  }

  const comparison = compareCapturedArtifactToBaseline(artifact, baseline);
  return {
    sourceId: source.id,
    declaredUrl: source.url,
    captureStatus: "captured",
    capturedAt: artifact.metadata.capturedAt,
    metadata: artifact.metadata,
    changeState: comparison.state,
    changeReasons: comparison.state === "changed" ? [...comparison.reasons] : [],
    baselineSha256:
      comparison.state === "baseline_missing" ? null : comparison.baselineSha256,
    errorCode: null,
    gateState: comparison.state === "unchanged" ? "ready" : "blocked",
  };
}

function reviewKindForRow(row) {
  if (row.captureStatus === "fetch_failed") return "capture_failure";
  if (row.errorCode === "non_success_http_status") return "http_failure";
  if (row.changeState === "baseline_missing") return "new_baseline_required";
  if (row.changeState === "changed") return "upstream_change";
  return null;
}

function queueEntryForRow(row) {
  const reviewKind = reviewKindForRow(row);
  if (!reviewKind) return null;
  return {
    sourceId: row.sourceId,
    declaredUrl: row.declaredUrl,
    reviewKind,
    approvalState: "pending_independent_review",
    captureStatus: row.captureStatus,
    capturedAt: row.capturedAt,
    statusCode: row.metadata?.statusCode ?? null,
    ok: row.metadata?.ok ?? false,
    finalUrl: row.metadata?.finalUrl ?? null,
    contentType: row.metadata?.contentType ?? null,
    byteLength: row.metadata?.byteLength ?? null,
    sha256: row.metadata?.sha256 ?? null,
    baselineSha256: row.baselineSha256,
    changeState: row.changeState,
    changeReasons: row.changeReasons,
    errorCode: row.errorCode,
  };
}

function gateReasonsForRows(rows) {
  const reasons = new Set();
  if (!rows.length) reasons.add("no_eligible_sources_selected");
  for (const row of rows) {
    if (row.captureStatus === "fetch_failed") reasons.add("capture_failure");
    if (row.errorCode === "non_success_http_status") reasons.add("non_success_http_status");
    if (row.changeState === "baseline_missing") reasons.add("unbaselined_evidence");
    if (row.changeState === "changed") reasons.add("changed_evidence");
  }
  return [...reasons].sort();
}

export async function captureOfficialSourceRegistry({
  registry,
  baselines = [],
  requestedSourceIds = [],
  fetchImpl,
  capturedAt = new Date().toISOString(),
  timeoutMs,
  maxBytes,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const generatedAt = normaliseCapturedAt(capturedAt);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("Capture concurrency must be an integer from 1 to 16.");
  }
  const eligibleSources = selectOfficialHttpsSources(registry);
  const selectedSources = selectOfficialHttpsSources(registry, requestedSourceIds);
  const baselineBySourceId = new Map(baselines.map((baseline) => [baseline.sourceId, baseline]));

  const rows = await mapWithConcurrency(selectedSources, concurrency, async (source) => {
    const outcome = await captureOfficialSourceBytes(source, {
      fetchImpl,
      now: new Date(generatedAt),
      timeoutMs,
      maxBytes,
    });
    if (outcome.status === "fetch_failed") return reportRowForFailure(source, outcome);
    return reportRowForCaptured(source, outcome, baselineBySourceId.get(source.id));
  });
  rows.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const queueEntries = rows.map(queueEntryForRow).filter(Boolean);
  const releaseGateReasons = gateReasonsForRows(rows);
  const aggregate = {
    eligibleRegistrySources: eligibleSources.length,
    selectedSources: rows.length,
    captured: rows.filter((row) => row.captureStatus === "captured").length,
    fetchFailed: rows.filter((row) => row.captureStatus === "fetch_failed").length,
    nonSuccessHttpStatus: rows.filter(
      (row) => row.errorCode === "non_success_http_status",
    ).length,
    unchanged: rows.filter((row) => row.changeState === "unchanged").length,
    changed: rows.filter((row) => row.changeState === "changed").length,
    baselineMissing: rows.filter((row) => row.changeState === "baseline_missing").length,
    pendingReview: queueEntries.length,
  };
  const releaseGate = {
    state: releaseGateReasons.length ? "blocked" : "ready",
    reasons: releaseGateReasons,
  };

  return {
    report: {
      contractVersion: OFFICIAL_SOURCE_CAPTURE_REPORT_CONTRACT,
      custodyContractVersion: OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION,
      generatedAt,
      aggregate,
      releaseGate,
      sources: rows,
    },
    pendingReviewQueue: {
      contractVersion: OFFICIAL_SOURCE_REVIEW_QUEUE_CONTRACT,
      custodyContractVersion: OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION,
      generatedAt,
      entryCount: queueEntries.length,
      entries: queueEntries,
    },
  };
}

function parsePositiveInteger(value, optionName) {
  if (!/^\d+$/.test(value || "")) throw new Error(`${optionName} requires a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} requires a positive integer.`);
  }
  return parsed;
}

export function parseArguments(argumentsList) {
  const options = {
    requestedSourceIds: [],
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    index += 1;
    if (argument === "--output-dir") options.outputDirectory = value;
    else if (argument === "--fixture") options.fixturePath = value;
    else if (argument === "--captured-at") options.capturedAt = normaliseCapturedAt(value);
    else if (argument === "--source-id") options.requestedSourceIds.push(value);
    else if (argument === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(value, argument);
    } else if (argument === "--max-bytes") {
      options.maxBytes = parsePositiveInteger(value, argument);
    } else if (argument === "--concurrency") {
      options.concurrency = parsePositiveInteger(value, argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function helpText() {
  return [
    "Capture exact bytes for official HTTPS energy assistant registry sources.",
    "",
    "Usage:",
    "  node --experimental-strip-types scripts/capture-energy-assistant-official-sources.mjs --output-dir <path> [options]",
    "",
    "Options:",
    "  --source-id <id>       Capture one registry source. May be repeated.",
    "  --fixture <path>        Use reviewed offline response bytes instead of network access.",
    "  --captured-at <ISO>     Fix the custody timestamp for a reproducible run.",
    "  --timeout-ms <number>   Set the per-source fetch timeout.",
    "  --max-bytes <number>    Set the maximum response body size.",
    "  --concurrency <number>  Set concurrent captures from 1 to 16. Default is 4.",
    "  --help                  Show this help.",
    "",
    "The command exits with code 2 when evidence is changed, unbaselined, unavailable, or returned with a non-success HTTP status.",
  ].join("\n");
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function runCli(argumentsList) {
  const options = parseArguments(argumentsList);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (!options.outputDirectory) throw new Error("--output-dir is required.");

  const selectedSources = selectOfficialHttpsSources(
    ENERGY_ASSISTANT_KNOWLEDGE,
    options.requestedSourceIds,
  );
  let fetchImpl;
  let fixture;
  if (options.fixturePath) {
    fixture = JSON.parse(await readFile(path.resolve(options.fixturePath), "utf8"));
    fetchImpl = createOfflineFixtureFetch(fixture, selectedSources);
  }
  const capturedAt = options.capturedAt || fixture?.capturedAt || new Date().toISOString();
  const result = await captureOfficialSourceRegistry({
    registry: ENERGY_ASSISTANT_KNOWLEDGE,
    baselines: ENERGY_ASSISTANT_OFFICIAL_SOURCE_BASELINES,
    requestedSourceIds: options.requestedSourceIds,
    fetchImpl,
    capturedAt,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    concurrency: options.concurrency,
  });

  const outputDirectory = path.resolve(options.outputDirectory);
  const reportPath = path.join(outputDirectory, SUMMARY_FILE_NAME);
  const queuePath = path.join(outputDirectory, QUEUE_FILE_NAME);
  await writeJsonAtomically(reportPath, result.report);
  await writeJsonAtomically(queuePath, result.pendingReviewQueue);
  process.stdout.write(
    `${JSON.stringify({
      reportPath,
      queuePath,
      releaseGate: result.report.releaseGate,
      aggregate: result.report.aggregate,
    })}\n`,
  );
  return result.report.releaseGate.state === "ready" ? 0 : 2;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
