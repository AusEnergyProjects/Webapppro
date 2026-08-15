import trackedManifestJson from "../data/creditex-official-source-custody-candidates-2026-08-15.json" with { type: "json" };
import type { CreditexCustodyBucket } from "./creditex-custody-bucket.ts";
import {
  CREDITEX_OFFICIAL_SOURCE_LIMITS,
  CreditexOfficialSourceCustodyError,
  captureCreditexServerFetchedOfficialSourceArtifact,
  normaliseOfficialSourceUrl,
  sha256Hex,
} from "./creditex-official-source-custody-server.ts";

export const CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS = {
  maximumItems: 8,
  maximumExpectedBytes: 32 * 1024 * 1024,
  maximumRedirects: 5,
  fetchTimeoutMilliseconds: 30_000,
  maximumRequestBytes: 16 * 1024,
  maximumStatusPageSize: 100,
} as const;

export const CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST_CONTRACT =
  "creditex-official-source-custody-import/v1";

type OfficialSourceCustodyCandidate = {
  sourceId: string;
  programCodes: string[];
  authorityClass: "government_or_regulator";
  authorityHost: string;
  officialUrl: string;
  expectedFinalAuthorityHost: string;
  expectedFinalUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  statedEffectiveDate: string;
  originalFileName: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  observedOn: string;
  pendingIndependentCreditexReview: true;
  operationallyApproved: false;
};

export type CreditexOfficialSourceCustodyManifest = {
  contract: string;
  observedOn: string;
  sourceAuditManifestSha256: string;
  candidateCount: number;
  authorityBoundary: string;
  custodyBoundary: string;
  candidates: OfficialSourceCustodyCandidate[];
};

type CustodyImportActor = {
  uid: string;
  organisationId: string;
  role: string;
  actorKind: "admin" | "compliance";
};

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type BatchImportInput = {
  confirmExactOfficialSourceCustodyImport: unknown;
  manifestContract: unknown;
  sourceIds: unknown;
};

export async function readBoundedCreditexOfficialSourceBatchInput(
  request: Request,
): Promise<BatchImportInput> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw batchError(
      "SOURCE_BATCH_JSON_REQUIRED",
      415,
      "Send the official source import selection as JSON.",
    );
  }
  const declaredText = request.headers.get("content-length");
  if (declaredText) {
    const declared = Number(declaredText);
    if (
      !Number.isSafeInteger(declared)
      || declared < 1
      || declared > CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumRequestBytes
    ) {
      throw batchError(
        "SOURCE_BATCH_REQUEST_SIZE_INVALID",
        413,
        "The official source import selection is too large.",
      );
    }
  }
  if (!request.body) {
    throw batchError(
      "SOURCE_BATCH_JSON_INVALID",
      400,
      "Add the official source import selection.",
    );
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumRequestBytes) {
        await reader.cancel().catch(() => undefined);
        throw batchError(
          "SOURCE_BATCH_REQUEST_SIZE_INVALID",
          413,
          "The official source import selection is too large.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as BatchImportInput;
  } catch {
    throw batchError(
      "SOURCE_BATCH_JSON_INVALID",
      400,
      "Add a valid official source import selection.",
    );
  }
}

type StatusOptions = {
  afterSourceId?: unknown;
  pageSize?: unknown;
  manifest?: CreditexOfficialSourceCustodyManifest;
};

type ExistingCandidateArtifact = {
  id: string;
  client_request_id: string;
  source_url: string;
  source_final_url: string;
  source_host: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  retrieval_method: string;
  custody_state: string;
  rule_activation_enabled: number;
  captured_at: string;
  latest_review_decision: string | null;
  latest_reviewed_at: string | null;
};

function batchError(code: string, status: number, message: string) {
  return new CreditexOfficialSourceCustodyError(code, status, message);
}

function requiredText(value: unknown, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maximum ? text : "";
}

function normalContentType(value: unknown) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function candidateRequestId(candidate: OfficialSourceCustodyCandidate) {
  return `official-source-import:${candidate.observedOn}:${candidate.sourceId}`;
}

function validateCandidate(
  candidate: unknown,
): OfficialSourceCustodyCandidate {
  if (!candidate || typeof candidate !== "object") {
    throw batchError(
      "SOURCE_BATCH_MANIFEST_INVALID",
      503,
      "The tracked official source custody manifest is invalid.",
    );
  }
  const value = candidate as Record<string, unknown>;
  const sourceId = requiredText(value.sourceId, 80);
  const officialUrl = normaliseOfficialSourceUrl(value.officialUrl);
  const finalUrl = normaliseOfficialSourceUrl(value.expectedFinalUrl);
  const authorityHost = requiredText(value.authorityHost, 253).toLowerCase();
  const expectedFinalAuthorityHost = requiredText(
    value.expectedFinalAuthorityHost,
    253,
  ).toLowerCase();
  const expectedContentType = normalContentType(value.expectedContentType);
  const expectedSizeBytes = Number(value.expectedSizeBytes);
  const expectedSha256 = requiredText(value.expectedSha256, 64).toLowerCase();
  const programCodes = Array.isArray(value.programCodes)
    ? value.programCodes.map((programCode) => requiredText(programCode, 80))
    : [];
  if (
    !/^source-[0-9a-f]{20}$/.test(sourceId)
    || value.authorityClass !== "government_or_regulator"
    || officialUrl.host !== authorityHost
    || finalUrl.host !== expectedFinalAuthorityHost
    || !requiredText(value.sourceTitle, 500)
    || !requiredText(value.originalFileName, 180)
    || !expectedContentType
    || !Number.isSafeInteger(expectedSizeBytes)
    || expectedSizeBytes < 1
    || expectedSizeBytes > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumBytes
    || !/^[0-9a-f]{64}$/.test(expectedSha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(requiredText(value.observedOn, 10))
    || !programCodes.length
    || programCodes.some((programCode) => !programCode)
    || value.pendingIndependentCreditexReview !== true
    || value.operationallyApproved !== false
  ) {
    throw batchError(
      "SOURCE_BATCH_MANIFEST_INVALID",
      503,
      "The tracked official source custody manifest is invalid.",
    );
  }
  return {
    sourceId,
    programCodes,
    authorityClass: "government_or_regulator",
    authorityHost,
    officialUrl: officialUrl.url,
    expectedFinalAuthorityHost,
    expectedFinalUrl: finalUrl.url,
    sourceTitle: requiredText(value.sourceTitle, 500),
    sourceVersion: requiredText(value.sourceVersion, 240),
    statedEffectiveDate: requiredText(value.statedEffectiveDate, 40),
    originalFileName: requiredText(value.originalFileName, 180),
    expectedContentType,
    expectedSizeBytes,
    expectedSha256,
    observedOn: requiredText(value.observedOn, 10),
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  };
}

export function validateCreditexOfficialSourceCustodyManifest(
  manifest: unknown,
) {
  if (!manifest || typeof manifest !== "object") {
    throw batchError(
      "SOURCE_BATCH_MANIFEST_INVALID",
      503,
      "The tracked official source custody manifest is invalid.",
    );
  }
  const value = manifest as Record<string, unknown>;
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map(validateCandidate)
    : [];
  const observedOn = requiredText(value.observedOn, 10);
  const authorityBoundary = requiredText(value.authorityBoundary, 200);
  const custodyBoundary = requiredText(value.custodyBoundary, 800);
  if (
    value.contract !== CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST_CONTRACT
    || value.candidateCount !== 167
    || candidates.length !== 167
    || !/^\d{4}-\d{2}-\d{2}$/.test(observedOn)
    || candidates.some((candidate) => candidate.observedOn !== observedOn)
    || !authorityBoundary
    || !custodyBoundary
    || !/^[0-9a-f]{64}$/.test(
      requiredText(value.sourceAuditManifestSha256, 64),
    )
    || new Set(candidates.map((candidate) => candidate.sourceId)).size
      !== candidates.length
  ) {
    throw batchError(
      "SOURCE_BATCH_MANIFEST_INVALID",
      503,
      "The tracked official source custody manifest is invalid.",
    );
  }
  return {
    contract: String(value.contract),
    observedOn,
    sourceAuditManifestSha256: requiredText(
      value.sourceAuditManifestSha256,
      64,
    ),
    candidateCount: candidates.length,
    authorityBoundary,
    custodyBoundary,
    candidates,
  } satisfies CreditexOfficialSourceCustodyManifest;
}

export const CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST =
  validateCreditexOfficialSourceCustodyManifest(trackedManifestJson);

function selectedCandidates(
  manifest: CreditexOfficialSourceCustodyManifest,
  input: BatchImportInput,
) {
  if (input.confirmExactOfficialSourceCustodyImport !== true) {
    throw batchError(
      "SOURCE_BATCH_CONFIRMATION_REQUIRED",
      400,
      "Confirm the exact official source custody import.",
    );
  }
  if (input.manifestContract !== manifest.contract) {
    throw batchError(
      "SOURCE_BATCH_CONTRACT_MISMATCH",
      409,
      "Reload the current official source custody manifest before importing.",
    );
  }
  if (
    !Array.isArray(input.sourceIds)
    || input.sourceIds.length < 1
    || input.sourceIds.length > CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumItems
  ) {
    throw batchError(
      "SOURCE_BATCH_SIZE_INVALID",
      400,
      `Choose 1 to ${CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumItems} official sources per import.`,
    );
  }
  const sourceIds = input.sourceIds.map((sourceId) =>
    requiredText(sourceId, 80)
  );
  if (
    sourceIds.some((sourceId) => !sourceId)
    || new Set(sourceIds).size !== sourceIds.length
  ) {
    throw batchError(
      "SOURCE_BATCH_SOURCE_IDS_INVALID",
      400,
      "Choose unique official source manifest entries.",
    );
  }
  const byId = new Map(
    manifest.candidates.map((candidate) => [candidate.sourceId, candidate]),
  );
  const selected = sourceIds.map((sourceId) => byId.get(sourceId));
  if (selected.some((candidate) => !candidate)) {
    throw batchError(
      "SOURCE_BATCH_SOURCE_NOT_FOUND",
      404,
      "One or more official source manifest entries were not found.",
    );
  }
  const exact = selected as OfficialSourceCustodyCandidate[];
  const expectedBytes = exact.reduce(
    (total, candidate) => total + candidate.expectedSizeBytes,
    0,
  );
  if (
    expectedBytes
      > CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumExpectedBytes
  ) {
    throw batchError(
      "SOURCE_BATCH_BYTES_INVALID",
      413,
      "Choose a smaller official source batch.",
    );
  }
  return exact;
}

async function readExactResponseBytes(
  response: Response,
  expectedBytes: number,
) {
  const declaredText = response.headers.get("content-length");
  if (declaredText) {
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared !== expectedBytes) {
      throw batchError(
        "SOURCE_FETCH_SIZE_MISMATCH",
        409,
        "The official source size changed from the tracked manifest.",
      );
    }
  }
  if (!response.body) {
    throw batchError(
      "SOURCE_FETCH_BODY_MISSING",
      502,
      "The official source response did not include a readable body.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (
        total > expectedBytes
        || total > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumBytes
      ) {
        await reader.cancel().catch(() => undefined);
        throw batchError(
          "SOURCE_FETCH_SIZE_MISMATCH",
          409,
          "The official source size changed from the tracked manifest.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    throw batchError(
      "SOURCE_FETCH_SIZE_MISMATCH",
      409,
      "The official source size changed from the tracked manifest.",
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchExactOfficialSource(
  candidate: OfficialSourceCustodyCandidate,
  fetchImpl: FetchLike,
  now: () => Date,
) {
  const approvedHosts = new Set([
    candidate.authorityHost,
    candidate.expectedFinalAuthorityHost,
  ]);
  let current = normaliseOfficialSourceUrl(candidate.officialUrl);
  if (!approvedHosts.has(current.host)) {
    throw batchError(
      "SOURCE_FETCH_AUTHORITY_REJECTED",
      409,
      "The tracked official source authority is not approved.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.fetchTimeoutMilliseconds,
  );
  try {
    for (
      let redirects = 0;
      redirects <= CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumRedirects;
      redirects += 1
    ) {
      let response: Response;
      try {
        response = await fetchImpl(current.url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: candidate.expectedContentType,
          },
        });
      } catch {
        throw batchError(
          "SOURCE_FETCH_UNAVAILABLE",
          502,
          "The official source could not be fetched.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (
          redirects
            === CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumRedirects
        ) {
          throw batchError(
            "SOURCE_FETCH_REDIRECT_LIMIT",
            409,
            "The official source exceeded the approved redirect limit.",
          );
        }
        const location = response.headers.get("location");
        if (!location) {
          throw batchError(
            "SOURCE_FETCH_REDIRECT_INVALID",
            409,
            "The official source returned an invalid redirect.",
          );
        }
        const next = normaliseOfficialSourceUrl(
          new URL(location, current.url).toString(),
        );
        if (!approvedHosts.has(next.host)) {
          throw batchError(
            "SOURCE_FETCH_REDIRECT_HOST_REJECTED",
            409,
            "The official source redirected outside its approved authority.",
          );
        }
        current = next;
        continue;
      }
      if (response.status !== 200) {
        throw batchError(
          "SOURCE_FETCH_HTTP_FAILED",
          502,
          "The official source did not return a successful response.",
        );
      }
      if (current.url !== candidate.expectedFinalUrl) {
        throw batchError(
          "SOURCE_FETCH_FINAL_URL_MISMATCH",
          409,
          "The official source final URL changed from the tracked manifest.",
        );
      }
      if (
        normalContentType(response.headers.get("content-type"))
          !== candidate.expectedContentType
      ) {
        throw batchError(
          "SOURCE_FETCH_MIME_MISMATCH",
          409,
          "The official source file type changed from the tracked manifest.",
        );
      }
      const bytes = await readExactResponseBytes(
        response,
        candidate.expectedSizeBytes,
      );
      if (await sha256Hex(bytes) !== candidate.expectedSha256) {
        throw batchError(
          "SOURCE_FETCH_HASH_MISMATCH",
          409,
          "The official source bytes changed from the tracked manifest.",
        );
      }
      return {
        bytes,
        finalSourceUrl: current.url,
        assertedRetrievedAt: now().toISOString(),
        sourceEtag: response.headers.get("etag") || "",
        sourceLastModified: response.headers.get("last-modified") || "",
      };
    }
  } finally {
    clearTimeout(timeout);
  }
  throw batchError(
    "SOURCE_FETCH_REDIRECT_LIMIT",
    409,
    "The official source exceeded the approved redirect limit.",
  );
}

export async function importCreditexOfficialSourceCustodyBatch(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  actor: CustodyImportActor,
  input: BatchImportInput,
  options: {
    fetchImpl?: FetchLike;
    now?: () => Date;
    manifest?: CreditexOfficialSourceCustodyManifest;
  } = {},
) {
  const manifest = options.manifest
    ? validateCreditexOfficialSourceCustodyManifest(options.manifest)
    : CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST;
  const selected = selectedCandidates(manifest, input);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const items = [];
  let verifiedBytes = 0;
  let newlyRetainedBytes = 0;
  for (const candidate of selected) {
    try {
      const fetched = await fetchExactOfficialSource(
        candidate,
        fetchImpl,
        now,
      );
      const captured = await captureCreditexServerFetchedOfficialSourceArtifact(
        database,
        bucket,
        actor,
        {
          clientRequestId: candidateRequestId(candidate),
          sourceUrl: candidate.officialUrl,
          finalSourceUrl: fetched.finalSourceUrl,
          sourceTitle: candidate.sourceTitle,
          sourceVersion: candidate.sourceVersion,
          originalFileName: candidate.originalFileName,
          contentType: candidate.expectedContentType,
          assertedRetrievedAt: fetched.assertedRetrievedAt,
          sourceEtag: fetched.sourceEtag,
          sourceLastModified: fetched.sourceLastModified,
          bytes: fetched.bytes,
        },
      );
      verifiedBytes += candidate.expectedSizeBytes;
      if (!captured.reused) newlyRetainedBytes += candidate.expectedSizeBytes;
      items.push({
        sourceId: candidate.sourceId,
        status: captured.reused
          ? "reused_pending_independent_review"
          : "captured_pending_independent_review",
        reused: captured.reused,
        artifact: captured.artifact,
        binding: null,
        operationallyReady: false,
        ruleActivationEnabled: false,
      });
    } catch (error) {
      items.push({
        sourceId: candidate.sourceId,
        status: "failed",
        reused: false,
        code: error instanceof CreditexOfficialSourceCustodyError
          ? error.code
          : "SOURCE_BATCH_ITEM_FAILED",
        error: error instanceof CreditexOfficialSourceCustodyError
          ? error.message
          : "The official source could not be placed in custody.",
        operationallyReady: false,
        ruleActivationEnabled: false,
      });
    }
  }
  const captured = items.filter((item) => item.status !== "failed");
  return {
    manifestContract: manifest.contract,
    sourceAuditManifestSha256: manifest.sourceAuditManifestSha256,
    requested: items.length,
    captured: captured.length,
    reused: captured.filter((item) => item.reused).length,
    failed: items.length - captured.length,
    retainedBytes: newlyRetainedBytes,
    verifiedBytes,
    pendingIndependentCreditexReview: true,
    operationalReadinessClaimed: false,
    automaticBindingPerformed: false,
    automaticApprovalPerformed: false,
    items,
  };
}

function statusPageSize(value: unknown) {
  if (value === undefined || value === null || value === "") return 50;
  const pageSize = Number(value);
  if (
    !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize
      > CREDITEX_OFFICIAL_SOURCE_BATCH_LIMITS.maximumStatusPageSize
  ) {
    throw batchError(
      "SOURCE_BATCH_STATUS_PAGE_INVALID",
      400,
      "Choose an official source status page size from 1 to 100.",
    );
  }
  return pageSize;
}

function artifactMatchesCandidate(
  artifact: ExistingCandidateArtifact,
  candidate: OfficialSourceCustodyCandidate,
) {
  return artifact.source_url === candidate.officialUrl
    && (artifact.source_final_url || artifact.source_url)
      === candidate.expectedFinalUrl
    && artifact.source_host === candidate.authorityHost
    && artifact.content_type === candidate.expectedContentType
    && Number(artifact.size_bytes) === candidate.expectedSizeBytes
    && artifact.sha256 === candidate.expectedSha256
    && artifact.retrieval_method === "server_fetch"
    && artifact.custody_state === "pending_review"
    && Number(artifact.rule_activation_enabled) === 0;
}

export async function listCreditexOfficialSourceCustodyCandidateStatus(
  database: D1Database,
  organisationId: string,
  options: StatusOptions = {},
) {
  const manifest = options.manifest
    ? validateCreditexOfficialSourceCustodyManifest(options.manifest)
    : CREDITEX_OFFICIAL_SOURCE_CUSTODY_MANIFEST;
  const rows = await database.prepare(`SELECT
      artifact.id,
      artifact.client_request_id,
      artifact.source_url,
      artifact.source_final_url,
      artifact.source_host,
      artifact.content_type,
      artifact.size_bytes,
      artifact.sha256,
      artifact.retrieval_method,
      artifact.custody_state,
      artifact.rule_activation_enabled,
      artifact.captured_at,
      (
        SELECT decision.decision
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1
      ) latest_review_decision,
      (
        SELECT decision.reviewed_at
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1
      ) latest_reviewed_at
    FROM compliance_official_source_artifacts artifact
    WHERE artifact.organisation_id = ?
      AND artifact.client_request_id LIKE 'official-source-import:%'`)
    .bind(organisationId)
    .all<ExistingCandidateArtifact>();
  const byRequestId = new Map(
    rows.results.map((row) => [row.client_request_id, row]),
  );
  const statuses = manifest.candidates.map((candidate) => {
    const artifact = byRequestId.get(candidateRequestId(candidate));
    const exact = artifact
      ? artifactMatchesCandidate(artifact, candidate)
      : false;
    let status = "missing_from_creditex_custody";
    if (artifact && !exact) status = "custody_receipt_mismatch";
    if (artifact && exact && !artifact.latest_review_decision) {
      status = "custody_pending_independent_review";
    }
    if (artifact && exact && artifact.latest_review_decision) {
      status = `custody_review_${artifact.latest_review_decision}_unbound`;
    }
    return {
      sourceId: candidate.sourceId,
      programCodes: candidate.programCodes,
      sourceTitle: candidate.sourceTitle,
      sourceVersion: candidate.sourceVersion,
      statedEffectiveDate: candidate.statedEffectiveDate,
      authorityHost: candidate.authorityHost,
      officialUrl: candidate.officialUrl,
      expectedFinalUrl: candidate.expectedFinalUrl,
      expectedContentType: candidate.expectedContentType,
      expectedSizeBytes: candidate.expectedSizeBytes,
      expectedSha256: candidate.expectedSha256,
      status,
      artifactId: artifact?.id || null,
      capturedAt: artifact?.captured_at || null,
      latestReviewDecision: artifact?.latest_review_decision || null,
      latestReviewedAt: artifact?.latest_reviewed_at || null,
      boundToActivity: false,
      operationallyReady: false,
      ruleActivationEnabled: false,
    };
  });
  const afterSourceId = requiredText(options.afterSourceId, 80);
  const startIndex = afterSourceId
    ? statuses.findIndex((entry) => entry.sourceId === afterSourceId) + 1
    : 0;
  if (afterSourceId && startIndex === 0) {
    throw batchError(
      "SOURCE_BATCH_STATUS_CURSOR_INVALID",
      400,
      "The official source status cursor is invalid.",
    );
  }
  const pageSize = statusPageSize(options.pageSize);
  const items = statuses.slice(startIndex, startIndex + pageSize);
  const imported = statuses.filter((entry) => entry.artifactId).length;
  const pending = statuses.filter((entry) =>
    entry.status === "custody_pending_independent_review"
  ).length;
  const mismatched = statuses.filter((entry) =>
    entry.status === "custody_receipt_mismatch"
  ).length;
  const last = items.at(-1);
  return {
    manifestContract: manifest.contract,
    sourceAuditManifestSha256: manifest.sourceAuditManifestSha256,
    total: statuses.length,
    imported,
    missing: statuses.length - imported,
    pendingIndependentReview: pending,
    custodyReceiptMismatches: mismatched,
    operationallyReady: 0,
    pageSize,
    hasNext: startIndex + items.length < statuses.length,
    nextCursor: startIndex + items.length < statuses.length
      ? last?.sourceId || null
      : null,
    items,
  };
}
