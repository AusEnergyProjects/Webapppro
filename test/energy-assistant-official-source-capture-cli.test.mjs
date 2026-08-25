import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import {
  OFFICIAL_SOURCE_CAPTURE_REPORT_CONTRACT,
  OFFICIAL_SOURCE_REVIEW_QUEUE_CONTRACT,
  OFFLINE_CAPTURE_FIXTURE_CONTRACT,
  captureOfficialSourceRegistry,
  createOfflineFixtureFetch,
  selectOfficialHttpsSources,
} from "../scripts/capture-energy-assistant-official-sources.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPTURE_SCRIPT = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "capture-energy-assistant-official-sources.mjs",
);
const FIXED_CAPTURED_AT = "2026-08-25T00:00:00.000Z";
const RESPONSE_BODY_MARKER = "OFFICIAL_RESPONSE_BODY_MUST_NOT_BE_PERSISTED_7f64";

function officialSource(id, url = `https://official.example/${id}`) {
  return { id, url, official: true };
}

function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function responseFor(body, url, options = {}) {
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? { "content-type": "text/plain" },
  });
  Object.defineProperty(response, "url", { value: options.finalUrl ?? url });
  return response;
}

function reviewedBaseline(source, body, overrides = {}) {
  return {
    contractVersion: "official-source-capture-v1",
    status: "baseline",
    sourceId: source.id,
    declaredUrl: source.url,
    finalUrl: source.url,
    finalUrlPolicy: "declared-https-host-only-v1",
    artifactSha256: sha256(body),
    byteLength: Buffer.byteLength(body, "utf8"),
    contentType: "text/plain",
    capturedAt: "2026-08-24T00:00:00.000Z",
    preparedBy: "capture-cli-test-preparer",
    ...overrides,
  };
}

function assertNoResponseBodyFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(key, "bytes");
    assert.notEqual(key, "bodyUtf8");
    assert.notEqual(key, "bodyBase64");
    assertNoResponseBodyFields(child);
  }
}

test("selection is limited to official HTTPS registry entries", () => {
  const eligible = officialSource("official-https");
  const registry = [
    { id: "not-official", url: "https://official.example/not-official", official: false },
    { id: "official-http", url: "http://official.example/http", official: true },
    { id: "invalid-url", url: "not-a-url", official: true },
    eligible,
  ];

  assert.deepEqual(selectOfficialHttpsSources(registry), [eligible]);
  assert.throws(
    () => selectOfficialHttpsSources(registry, ["official-http"]),
    /absent from the official HTTPS registry/,
  );
  assert.throws(
    () => selectOfficialHttpsSources(registry, ["not-official"]),
    /absent from the official HTTPS registry/,
  );
});

test("unchanged reviewed bytes produce deterministic metadata and an empty queue", async () => {
  const source = officialSource("reviewed-source");
  const body = `${RESPONSE_BODY_MARKER}:unchanged`;
  const fetchImpl = async (url) => responseFor(body, String(url), {
    headers: {
      "content-type": "text/plain",
      etag: '"reviewed-etag"',
      "last-modified": "Mon, 24 Aug 2026 00:00:00 GMT",
    },
  });
  const input = {
    registry: [source],
    baselines: [reviewedBaseline(source, body)],
    capturedAt: FIXED_CAPTURED_AT,
    fetchImpl,
    concurrency: 1,
  };

  const first = await captureOfficialSourceRegistry(input);
  const second = await captureOfficialSourceRegistry(input);

  assert.deepEqual(first, second);
  assert.equal(first.report.contractVersion, OFFICIAL_SOURCE_CAPTURE_REPORT_CONTRACT);
  assert.equal(first.pendingReviewQueue.contractVersion, OFFICIAL_SOURCE_REVIEW_QUEUE_CONTRACT);
  assert.deepEqual(first.report.releaseGate, { state: "ready", reasons: [] });
  assert.deepEqual(first.report.aggregate, {
    eligibleRegistrySources: 1,
    selectedSources: 1,
    captured: 1,
    fetchFailed: 0,
    nonSuccessHttpStatus: 0,
    unchanged: 1,
    changed: 0,
    baselineMissing: 0,
    pendingReview: 0,
  });
  assert.equal(first.report.sources[0].metadata.sha256, sha256(body));
  assert.equal(first.report.sources[0].metadata.byteLength, Buffer.byteLength(body));
  assert.equal(first.pendingReviewQueue.entryCount, 0);
  assertNoResponseBodyFields(first);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(RESPONSE_BODY_MARKER));
});

test("final response URLs fail closed outside the reviewed declared HTTPS host", async () => {
  const source = officialSource("redirect-policy");
  for (const finalUrl of [
    "http://official.example/redirect-policy",
    "https://unreviewed.example/redirect-policy",
  ]) {
    const result = await captureOfficialSourceRegistry({
      registry: [source],
      baselines: [],
      capturedAt: FIXED_CAPTURED_AT,
      fetchImpl: async (url) => responseFor("redirected", String(url), { finalUrl }),
      concurrency: 1,
    });

    assert.deepEqual(result.report.releaseGate.reasons, ["capture_failure"]);
    assert.equal(result.report.sources[0].errorCode, "disallowed_final_url");
    assert.equal(result.pendingReviewQueue.entries[0].reviewKind, "capture_failure");
  }
});

test("changed and unbaselined evidence fail closed into a pending review queue", async () => {
  const changedSource = officialSource("changed-source");
  const missingSource = officialSource("missing-source");
  const changedBody = `${RESPONSE_BODY_MARKER}:changed`;
  const missingBody = `${RESPONSE_BODY_MARKER}:missing`;
  const fetchImpl = async (url) => {
    const body = String(url) === changedSource.url ? changedBody : missingBody;
    return responseFor(body, String(url));
  };

  const result = await captureOfficialSourceRegistry({
    registry: [missingSource, changedSource],
    baselines: [
      reviewedBaseline(changedSource, changedBody, { artifactSha256: "0".repeat(64) }),
    ],
    capturedAt: FIXED_CAPTURED_AT,
    fetchImpl,
    concurrency: 2,
  });

  assert.equal(result.report.releaseGate.state, "blocked");
  assert.deepEqual(result.report.releaseGate.reasons, ["changed_evidence", "unbaselined_evidence"]);
  assert.equal(result.report.aggregate.changed, 1);
  assert.equal(result.report.aggregate.baselineMissing, 1);
  assert.equal(result.report.aggregate.pendingReview, 2);
  assert.deepEqual(
    result.pendingReviewQueue.entries.map((entry) => ({
      sourceId: entry.sourceId,
      reviewKind: entry.reviewKind,
      approvalState: entry.approvalState,
    })),
    [
      {
        sourceId: "changed-source",
        reviewKind: "upstream_change",
        approvalState: "pending_independent_review",
      },
      {
        sourceId: "missing-source",
        reviewKind: "new_baseline_required",
        approvalState: "pending_independent_review",
      },
    ],
  );
  assertNoResponseBodyFields(result);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(RESPONSE_BODY_MARKER));
});

test("fetch failures and non-success HTTP responses fail closed", async () => {
  const failedSource = officialSource("network-failure");
  const httpSource = officialSource("http-failure");
  const fetchImpl = async (url) => {
    if (String(url) === failedSource.url) throw new Error("fixture network unavailable");
    return responseFor(`${RESPONSE_BODY_MARKER}:http-failure`, String(url), { status: 503 });
  };

  const result = await captureOfficialSourceRegistry({
    registry: [httpSource, failedSource],
    baselines: [],
    capturedAt: FIXED_CAPTURED_AT,
    fetchImpl,
    concurrency: 2,
  });

  assert.deepEqual(result.report.releaseGate.reasons, [
    "capture_failure",
    "non_success_http_status",
  ]);
  assert.equal(result.report.aggregate.fetchFailed, 1);
  assert.equal(result.report.aggregate.nonSuccessHttpStatus, 1);
  assert.equal(result.report.aggregate.pendingReview, 2);
  assert.deepEqual(
    result.pendingReviewQueue.entries.map((entry) => entry.reviewKind),
    ["http_failure", "capture_failure"],
  );
  assert.equal(
    result.pendingReviewQueue.entries.find((entry) => entry.sourceId === failedSource.id).errorCode,
    "network_error",
  );
  assertNoResponseBodyFields(result);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(RESPONSE_BODY_MARKER));
});

test("offline fixture fetch rejects responses outside the selected official registry", async () => {
  const selected = officialSource("selected");
  const fixture = {
    contractVersion: OFFLINE_CAPTURE_FIXTURE_CONTRACT,
    responses: [
      {
        sourceId: "other",
        declaredUrl: "https://official.example/other",
        statusCode: 200,
        bodyUtf8: RESPONSE_BODY_MARKER,
      },
    ],
  };

  assert.throws(
    () => createOfflineFixtureFetch(fixture, [selected]),
    /does not match an eligible registry entry/,
  );
});

test("offline fixture fetch rejects an unreviewed final host", () => {
  const selected = officialSource("selected");
  const fixture = {
    contractVersion: OFFLINE_CAPTURE_FIXTURE_CONTRACT,
    responses: [
      {
        sourceId: selected.id,
        declaredUrl: selected.url,
        finalUrl: "https://unreviewed.example/selected",
        statusCode: 200,
        bodyUtf8: RESPONSE_BODY_MARKER,
      },
    ],
  };

  assert.throws(
    () => createOfflineFixtureFetch(fixture, [selected]),
    /disallowed final URL/,
  );
});

test("CLI offline capture writes only deterministic metadata and a separate review queue", async (t) => {
  const source = selectOfficialHttpsSources(ENERGY_ASSISTANT_KNOWLEDGE)[0];
  assert.ok(source, "The energy assistant registry must contain an official HTTPS source.");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "surge-official-capture-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixturePath = path.join(temporaryRoot, "fixture.json");
  const outputDirectory = path.join(temporaryRoot, "output");
  const body = `${RESPONSE_BODY_MARKER}:cli`;
  const fixture = {
    contractVersion: OFFLINE_CAPTURE_FIXTURE_CONTRACT,
    capturedAt: FIXED_CAPTURED_AT,
    responses: [
      {
        sourceId: source.id,
        declaredUrl: source.url,
        finalUrl: source.url,
        statusCode: 200,
        headers: { "content-type": "text/html" },
        bodyUtf8: body,
      },
    ],
  };
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  const completed = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      CAPTURE_SCRIPT,
      "--output-dir",
      outputDirectory,
      "--source-id",
      source.id,
      "--fixture",
      fixturePath,
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const reportText = await readFile(
    path.join(outputDirectory, "official-source-capture-report.json"),
    "utf8",
  );
  const queueText = await readFile(
    path.join(outputDirectory, "official-source-pending-review-queue.json"),
    "utf8",
  );
  const report = JSON.parse(reportText);
  const queue = JSON.parse(queueText);

  assert.equal(report.generatedAt, FIXED_CAPTURED_AT);
  assert.deepEqual(report.releaseGate, {
    state: "blocked",
    reasons: ["unbaselined_evidence"],
  });
  assert.equal(report.aggregate.baselineMissing, 1);
  assert.equal(report.sources[0].metadata.sha256, sha256(body));
  assert.equal(queue.entryCount, 1);
  assert.equal(queue.entries[0].approvalState, "pending_independent_review");
  assert.equal(queue.entries[0].reviewKind, "new_baseline_required");
  assert.equal(queue.entries[0].sha256, sha256(body));
  assertNoResponseBodyFields(report);
  assertNoResponseBodyFields(queue);
  assert.doesNotMatch(`${reportText}\n${queueText}`, new RegExp(RESPONSE_BODY_MARKER));
});
