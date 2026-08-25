import path from "node:path";
import { pathToFileURL } from "node:url";

import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import {
  ENERGY_ASSISTANT_OFFICIAL_SOURCE_BASELINES,
  ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_FIXTURES,
  ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE,
} from "../src/data/energy-assistant-official-source-capture-baselines.ts";
import { ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_APPROVALS } from "../src/data/energy-assistant-official-source-custody-approvals.ts";
import {
  OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION,
  OFFICIAL_SOURCE_CUSTODY_FIXTURE_CONTRACT_VERSION,
  captureOfficialSourceBytes,
  sha256Hex,
} from "../src/lib/energy-assistant-official-source-custody.ts";
import {
  assessOfficialSourceCustody,
  canonicalOfficialSourceEvidence,
} from "../src/lib/energy-assistant-source-review.ts";

export const OFFICIAL_SOURCE_CUSTODY_AUDIT_CONTRACT_VERSION =
  "official-source-custody-release-audit-v1";
export const OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION =
  "official-source-custody-release-scope-v1";

function normaliseAsOf(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw new Error("The custody audit date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("The custody audit date must be a valid calendar day.");
  }
  return value;
}

function indexUnique(entries, label, failures, sourceIdForEntry = (entry) => entry?.sourceId) {
  const indexed = new Map();
  for (const entry of entries) {
    const candidateSourceId = sourceIdForEntry(entry);
    const sourceId = typeof candidateSourceId === "string" ? candidateSourceId : "";
    if (!sourceId) {
      failures.push(`${label} contains an entry without a source id.`);
      continue;
    }
    if (indexed.has(sourceId)) {
      failures.push(`${sourceId}: duplicate ${label} entry.`);
      continue;
    }
    indexed.set(sourceId, entry);
  }
  return indexed;
}

function fixtureBytes(fixture) {
  const hasUtf8 = typeof fixture.bodyUtf8 === "string";
  const hasBase64 = typeof fixture.bodyBase64 === "string";
  if (hasUtf8 === hasBase64) {
    throw new Error("A custody fixture must contain exactly one byte representation.");
  }
  if (hasUtf8) return new TextEncoder().encode(fixture.bodyUtf8);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fixture.bodyBase64)) {
    throw new Error("A custody fixture contains invalid base64 bytes.");
  }
  return new Uint8Array(Buffer.from(fixture.bodyBase64, "base64"));
}

function fixtureFetch(source, fixture) {
  return async (requestedUrl) => {
    if (String(requestedUrl) !== source.url) {
      throw new Error("The custody fixture does not match the requested registry source.");
    }
    const headers = new Headers();
    if (fixture.contentType !== null) headers.set("content-type", fixture.contentType);
    const response = new Response(fixtureBytes(fixture), {
      status: fixture.statusCode,
      headers,
    });
    Object.defineProperty(response, "url", { value: fixture.finalUrl });
    return response;
  };
}

function validateReleaseScope(scope, requiredSourceIds, failures) {
  if (scope?.contractVersion !== OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE_CONTRACT_VERSION) {
    failures.push("The custody release scope contract is missing or unsupported.");
  }
  if (requiredSourceIds.length === 0) {
    if (scope?.status !== "not_yet_required") {
      failures.push("An empty custody release scope must be explicitly marked not_yet_required.");
    }
    if (typeof scope?.reason !== "string" || !scope.reason.trim()) {
      failures.push("An empty custody release scope requires a recorded reason.");
    }
  } else if (scope?.status !== "required") {
    failures.push("A non-empty custody release scope must be marked required.");
  }
}

export async function auditOfficialSourceCustodyRelease({
  registry,
  baselines,
  approvals,
  fixtures,
  releaseScope,
  asOf,
}) {
  const auditDay = normaliseAsOf(asOf);
  const failures = [];
  const requestedIds = Array.isArray(releaseScope?.requiredSourceIds)
    ? releaseScope.requiredSourceIds
    : [];
  const requiredSourceIds = [...new Set(requestedIds)].sort();
  if (requiredSourceIds.length !== requestedIds.length) {
    failures.push("The custody release scope contains duplicate source ids.");
  }
  validateReleaseScope(releaseScope, requiredSourceIds, failures);

  const registryById = indexUnique(registry, "registry", failures, (source) => source?.id);
  const baselineById = indexUnique(baselines, "baseline", failures);
  const approvalById = indexUnique(approvals, "approval", failures);
  const fixtureById = indexUnique(fixtures, "fixture", failures);
  const requiredIdSet = new Set(requiredSourceIds);

  for (const [label, entries] of [
    ["baseline", baselineById],
    ["approval", approvalById],
    ["fixture", fixtureById],
  ]) {
    for (const sourceId of entries.keys()) {
      if (!requiredIdSet.has(sourceId)) {
        failures.push(`${sourceId}: orphan ${label} is outside the required custody release scope.`);
      }
    }
  }

  const sources = [];
  for (const sourceId of requiredSourceIds) {
    const source = registryById.get(sourceId);
    const baseline = baselineById.get(sourceId);
    const approval = approvalById.get(sourceId);
    const fixture = fixtureById.get(sourceId);
    if (!source) failures.push(`${sourceId}: required source is absent from the registry.`);
    if (!baseline) failures.push(`${sourceId}: exact-byte baseline is missing.`);
    if (!approval) failures.push(`${sourceId}: independent custody approval is missing.`);
    if (!fixture) failures.push(`${sourceId}: offline exact-byte fixture is missing.`);
    if (!source || !baseline || !approval || !fixture) {
      sources.push({ sourceId, state: "incomplete", mayRelease: false });
      continue;
    }

    if (source.official !== true) failures.push(`${sourceId}: registry source is not official.`);
    let declaredUrl;
    try {
      declaredUrl = new URL(source.url);
    } catch {
      declaredUrl = null;
    }
    if (
      !declaredUrl
      || declaredUrl.protocol !== "https:"
      || declaredUrl.username
      || declaredUrl.password
    ) {
      failures.push(`${sourceId}: registry source is not a credential-free HTTPS URL.`);
    }
    if (
      baseline.contractVersion !== OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION
      || baseline.status !== "baseline"
    ) {
      failures.push(`${sourceId}: baseline contract or status is invalid.`);
    }
    if (
      fixture.contractVersion !== OFFICIAL_SOURCE_CUSTODY_FIXTURE_CONTRACT_VERSION
      || fixture.status !== "fixture"
      || fixture.sourceId !== source.id
      || fixture.declaredUrl !== source.url
      || fixture.capturedAt !== baseline.capturedAt
      || fixture.contentType !== baseline.contentType
    ) {
      failures.push(`${sourceId}: fixture metadata does not match the reviewed baseline.`);
    }

    let capture;
    try {
      capture = await captureOfficialSourceBytes(source, {
        fetchImpl: fixtureFetch(source, fixture),
        now: new Date(fixture.capturedAt),
      });
    } catch (error) {
      failures.push(`${sourceId}: fixture could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
      sources.push({ sourceId, state: "fixture_invalid", mayRelease: false });
      continue;
    }
    if (capture.status === "fetch_failed") {
      failures.push(`${sourceId}: ${capture.errorCode}: ${capture.message}`);
      sources.push({ sourceId, state: capture.errorCode, mayRelease: false });
      continue;
    }
    const evidenceRecordSha256 = await sha256Hex(
      new TextEncoder().encode(canonicalOfficialSourceEvidence(source)),
    );
    const assessment = assessOfficialSourceCustody(
      source,
      capture,
      baseline,
      approval,
      evidenceRecordSha256,
      auditDay,
    );
    if (!assessment.mayAnswerCurrentFact) {
      failures.push(`${sourceId}: ${assessment.state}: ${assessment.reason}`);
    }
    sources.push({
      sourceId,
      state: assessment.state,
      mayRelease: assessment.mayAnswerCurrentFact,
      observedSha256: assessment.observedSha256,
      baselineSha256: assessment.baselineSha256,
    });
  }

  const releaseGate = failures.length
    ? { state: "blocked", reasons: failures }
    : requiredSourceIds.length
      ? { state: "ready", reasons: [] }
      : { state: "not_required", reasons: [releaseScope.reason.trim()] };
  return {
    contractVersion: OFFICIAL_SOURCE_CUSTODY_AUDIT_CONTRACT_VERSION,
    auditedAsOf: auditDay,
    selectedSources: requiredSourceIds.length,
    approvedUnchanged: sources.filter((source) => source.mayRelease).length,
    releaseGate,
    sources,
  };
}

export async function runAudit() {
  const asOf = process.env.SURGE_SOURCE_CUSTODY_AS_OF
    || new Date().toISOString().slice(0, 10);
  const report = await auditOfficialSourceCustodyRelease({
    registry: ENERGY_ASSISTANT_KNOWLEDGE,
    baselines: ENERGY_ASSISTANT_OFFICIAL_SOURCE_BASELINES,
    approvals: ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_APPROVALS,
    fixtures: ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_FIXTURES,
    releaseScope: ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE,
    asOf,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.releaseGate.state === "blocked" ? 2 : 0;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runAudit()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
