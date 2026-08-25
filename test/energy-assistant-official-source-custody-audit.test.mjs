import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import {
  OFFICIAL_SOURCE_CUSTODY_AUDIT_CONTRACT_VERSION,
  OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION,
  auditOfficialSourceCustodyRelease,
} from "../scripts/audit-energy-assistant-official-source-custody.mjs";
import { canonicalOfficialSourceEvidence } from "../src/lib/energy-assistant-source-review.ts";

const AS_OF = "2026-08-25";
const CAPTURED_AT = "2026-08-24T00:00:00.000Z";
const source = ENERGY_ASSISTANT_KNOWLEDGE.find(
  (candidate) => candidate.id === "nathers-existing-homes",
);
assert.ok(source, "The reviewed registry fixture source must exist.");

function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function approvedFixtureInput(overrides = {}) {
  const body = "Deterministic test-only official source fixture bytes.\n";
  const artifactSha256 = sha256(body);
  const evidenceRecordSha256 = sha256(canonicalOfficialSourceEvidence(source));
  const finalUrl = new URL(source.url).href;
  return {
    registry: ENERGY_ASSISTANT_KNOWLEDGE,
    baselines: [{
      contractVersion: "official-source-capture-v1",
      status: "baseline",
      sourceId: source.id,
      declaredUrl: source.url,
      finalUrl,
      finalUrlPolicy: "declared-https-host-only-v1",
      artifactSha256,
      byteLength: Buffer.byteLength(body, "utf8"),
      contentType: "text/plain",
      capturedAt: CAPTURED_AT,
      preparedBy: "test fixture preparer",
    }],
    approvals: [{
      sourceId: source.id,
      upstreamArtifactSha256: artifactSha256,
      evidenceRecordSha256,
      preparedBy: "test fixture preparer",
      approvedBy: "test independent reviewer",
      approvedOn: "2026-08-24",
      reviewDue: source.reviewDue,
      status: "approved",
    }],
    fixtures: [{
      contractVersion: "official-source-custody-fixture-v1",
      status: "fixture",
      sourceId: source.id,
      declaredUrl: source.url,
      finalUrl,
      capturedAt: CAPTURED_AT,
      statusCode: 200,
      contentType: "text/plain",
      bodyUtf8: body,
    }],
    releaseScope: {
      contractVersion: OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION,
      status: "required",
      requiredSourceIds: [source.id],
      reason: "Test fixture exercises the required release path.",
    },
    asOf: AS_OF,
    ...overrides,
  };
}

test("an explicitly empty not-yet-required scope is honest and deterministic", async () => {
  const result = await auditOfficialSourceCustodyRelease({
    registry: ENERGY_ASSISTANT_KNOWLEDGE,
    baselines: [],
    approvals: [],
    fixtures: [],
    releaseScope: {
      contractVersion: OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION,
      status: "not_yet_required",
      requiredSourceIds: [],
      reason: "No source has completed independent custody approval.",
    },
    asOf: AS_OF,
  });

  assert.equal(result.contractVersion, OFFICIAL_SOURCE_CUSTODY_AUDIT_CONTRACT_VERSION);
  assert.equal(result.releaseGate.state, "not_required");
  assert.equal(result.selectedSources, 0);
  assert.equal(result.approvedUnchanged, 0);
});

test("empty scope fails closed without an explicit not-yet-required declaration", async () => {
  const result = await auditOfficialSourceCustodyRelease({
    registry: ENERGY_ASSISTANT_KNOWLEDGE,
    baselines: [],
    approvals: [],
    fixtures: [],
    releaseScope: {
      contractVersion: OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION,
      status: "required",
      requiredSourceIds: [],
      reason: "",
    },
    asOf: AS_OF,
  });

  assert.equal(result.releaseGate.state, "blocked");
  assert.match(result.releaseGate.reasons.join("\n"), /explicitly marked not_yet_required/);
  assert.match(result.releaseGate.reasons.join("\n"), /recorded reason/);
});

test("reviewed fixture bytes and an independent matching approval pass offline", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network access is forbidden during the custody audit test.");
  };
  try {
    const result = await auditOfficialSourceCustodyRelease(approvedFixtureInput());
    assert.deepEqual(result.releaseGate, { state: "ready", reasons: [] });
    assert.equal(result.approvedUnchanged, 1);
    assert.deepEqual(result.sources.map(({ state, mayRelease }) => ({ state, mayRelease })), [
      { state: "approved_unchanged", mayRelease: true },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("changed exact bytes and non-independent approval both fail closed", async () => {
  const changedInput = approvedFixtureInput();
  changedInput.fixtures[0].bodyUtf8 += "changed";
  const changed = await auditOfficialSourceCustodyRelease(changedInput);
  assert.equal(changed.releaseGate.state, "blocked");
  assert.equal(changed.sources[0].state, "changed_pending_review");

  const sameReviewerInput = approvedFixtureInput();
  sameReviewerInput.approvals[0].approvedBy = sameReviewerInput.approvals[0].preparedBy;
  const sameReviewer = await auditOfficialSourceCustodyRelease(sameReviewerInput);
  assert.equal(sameReviewer.releaseGate.state, "blocked");
  assert.equal(sameReviewer.sources[0].state, "awaiting_approval");
});

test("a required source cannot pass without an approval manifest entry", async () => {
  const input = approvedFixtureInput({ approvals: [] });
  const result = await auditOfficialSourceCustodyRelease(input);

  assert.equal(result.releaseGate.state, "blocked");
  assert.match(result.releaseGate.reasons.join("\n"), /independent custody approval is missing/);
  assert.equal(result.sources[0].state, "incomplete");
});
