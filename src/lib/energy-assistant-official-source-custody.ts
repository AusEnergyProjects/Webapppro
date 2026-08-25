import type { EnergyAssistantKnowledgeSource } from "../data/energy-assistant-knowledge.ts";

export const OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION = "official-source-capture-v1" as const;
export const OFFICIAL_SOURCE_FINAL_URL_POLICY = "declared-https-host-only-v1" as const;
export const OFFICIAL_SOURCE_CUSTODY_FIXTURE_CONTRACT_VERSION =
  "official-source-custody-fixture-v1" as const;

export type OfficialSourceCaptureMetadata = {
  contractVersion: typeof OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION;
  sourceId: string;
  declaredUrl: string;
  finalUrl: string;
  finalUrlPolicy: typeof OFFICIAL_SOURCE_FINAL_URL_POLICY;
  capturedAt: string;
  statusCode: number;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
  byteLength: number;
  sha256: string;
};

export type OfficialSourceCapturedArtifact = {
  status: "captured";
  metadata: OfficialSourceCaptureMetadata;
  bytes: Uint8Array;
};

export type OfficialSourceCaptureFailure = {
  status: "fetch_failed";
  sourceId: string;
  declaredUrl: string;
  capturedAt: string;
  errorCode:
    | "invalid_source"
    | "disallowed_final_url"
    | "timeout"
    | "network_error"
    | "response_too_large";
  message: string;
};

export type OfficialSourceCaptureOutcome =
  | OfficialSourceCapturedArtifact
  | OfficialSourceCaptureFailure;

export type OfficialSourceBaseline = {
  contractVersion: typeof OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION;
  status: "baseline";
  sourceId: string;
  declaredUrl: string;
  finalUrl: string;
  finalUrlPolicy: typeof OFFICIAL_SOURCE_FINAL_URL_POLICY;
  artifactSha256: string;
  byteLength: number;
  contentType: string | null;
  capturedAt: string;
  preparedBy: string;
};

export type OfficialSourceCustodyFixture = {
  contractVersion: typeof OFFICIAL_SOURCE_CUSTODY_FIXTURE_CONTRACT_VERSION;
  status: "fixture";
  sourceId: string;
  declaredUrl: string;
  finalUrl: string;
  capturedAt: string;
  statusCode: number;
  contentType: string | null;
  bodyUtf8?: string;
  bodyBase64?: string;
};

export type OfficialSourceBaselineComparison =
  | { state: "baseline_missing"; sourceId: string }
  | {
      state: "unchanged";
      sourceId: string;
      artifactSha256: string;
      baselineSha256: string;
    }
  | {
      state: "changed";
      sourceId: string;
      artifactSha256: string;
      baselineSha256: string;
      reasons: readonly (
        | "source_id"
        | "declared_url"
        | "final_url"
        | "final_url_policy"
        | "bytes"
        | "sha256"
      )[];
    };

type CaptureOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  maxBytes?: number;
};

function safeContentLength(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function captureFailure(
  source: Pick<EnergyAssistantKnowledgeSource, "id" | "url">,
  capturedAt: string,
  errorCode: OfficialSourceCaptureFailure["errorCode"],
  message: string,
): OfficialSourceCaptureFailure {
  return {
    status: "fetch_failed",
    sourceId: source.id,
    declaredUrl: source.url,
    capturedAt,
    errorCode,
    message,
  };
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function validateOfficialSourceFinalUrl(
  source: Pick<EnergyAssistantKnowledgeSource, "id" | "url">,
  finalUrlValue: string,
) {
  let declaredUrl: URL;
  let finalUrl: URL;
  try {
    declaredUrl = new URL(source.url);
    finalUrl = new URL(finalUrlValue);
  } catch {
    return {
      allowed: false as const,
      reason: "The final response URL is invalid.",
    };
  }
  if (
    declaredUrl.protocol !== "https:"
    || declaredUrl.username
    || declaredUrl.password
    || finalUrl.protocol !== "https:"
    || finalUrl.username
    || finalUrl.password
  ) {
    return {
      allowed: false as const,
      reason: "The declared and final response URLs must use HTTPS without credentials.",
    };
  }
  if (finalUrl.host.toLowerCase() !== declaredUrl.host.toLowerCase()) {
    return {
      allowed: false as const,
      reason: `The final response host ${finalUrl.host} is outside the reviewed declared host ${declaredUrl.host}.`,
    };
  }
  return {
    allowed: true as const,
    finalUrl: finalUrl.href,
    policy: OFFICIAL_SOURCE_FINAL_URL_POLICY,
  };
}

async function readResponseBytes(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    byteLength += next.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel("Official source response exceeded the custody byte limit.");
      return null;
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Captures the exact upstream response body. Redirects are followed by the
 * fetch implementation, while both the declared and final URLs remain in the
 * custody record. A capture is evidence only. It never updates a baseline or
 * creates an approval.
 */
export async function captureOfficialSourceBytes(
  source: Pick<EnergyAssistantKnowledgeSource, "id" | "url" | "official">,
  options: CaptureOptions = {},
): Promise<OfficialSourceCaptureOutcome> {
  const capturedAt = (options.now || new Date()).toISOString();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(source.url);
  } catch {
    return captureFailure(source, capturedAt, "invalid_source", "The declared source URL is invalid.");
  }
  if (
    !source.official
    || parsedUrl.protocol !== "https:"
    || Boolean(parsedUrl.username)
    || Boolean(parsedUrl.password)
  ) {
    return captureFailure(
      source,
      capturedAt,
      "invalid_source",
      "Only declared official HTTPS sources may be captured.",
    );
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(source.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/json,application/pdf;q=0.9,*/*;q=0.8",
      },
    });
    const finalUrl = response.url;
    const finalUrlValidation = validateOfficialSourceFinalUrl(source, finalUrl);
    if (!finalUrlValidation.allowed) {
      return captureFailure(
        source,
        capturedAt,
        "disallowed_final_url",
        finalUrlValidation.reason,
      );
    }
    const declaredLength = safeContentLength(response.headers.get("content-length"));
    if (declaredLength !== null && declaredLength > maxBytes) {
      return captureFailure(
        source,
        capturedAt,
        "response_too_large",
        `The upstream response declared ${declaredLength} bytes, above the ${maxBytes} byte limit.`,
      );
    }
    const bytes = await readResponseBytes(response, maxBytes);
    if (!bytes) {
      return captureFailure(
        source,
        capturedAt,
        "response_too_large",
        `The upstream response exceeded the ${maxBytes} byte limit while streaming.`,
      );
    }
    return {
      status: "captured",
      metadata: {
        contractVersion: OFFICIAL_SOURCE_CAPTURE_CONTRACT_VERSION,
        sourceId: source.id,
        declaredUrl: source.url,
        finalUrl: finalUrlValidation.finalUrl,
        finalUrlPolicy: finalUrlValidation.policy,
        capturedAt,
        statusCode: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
        contentLength: declaredLength,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      },
      bytes,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return captureFailure(
      source,
      capturedAt,
      timedOut ? "timeout" : "network_error",
      timedOut
        ? `The upstream source did not respond within ${timeoutMs} ms.`
        : error instanceof Error
          ? error.message
          : "The upstream source could not be fetched.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function compareCapturedArtifactToBaseline(
  artifact: OfficialSourceCapturedArtifact,
  baseline?: OfficialSourceBaseline,
): OfficialSourceBaselineComparison {
  if (!baseline) return { state: "baseline_missing", sourceId: artifact.metadata.sourceId };
  const reasons: Array<
    | "source_id"
    | "declared_url"
    | "final_url"
    | "final_url_policy"
    | "bytes"
    | "sha256"
  > = [];
  if (baseline.sourceId !== artifact.metadata.sourceId) reasons.push("source_id");
  if (baseline.declaredUrl !== artifact.metadata.declaredUrl) reasons.push("declared_url");
  if (baseline.finalUrl !== artifact.metadata.finalUrl) reasons.push("final_url");
  if (baseline.finalUrlPolicy !== artifact.metadata.finalUrlPolicy) reasons.push("final_url_policy");
  if (baseline.byteLength !== artifact.metadata.byteLength) reasons.push("bytes");
  if (baseline.artifactSha256 !== artifact.metadata.sha256) reasons.push("sha256");
  if (!reasons.length) {
    return {
      state: "unchanged",
      sourceId: artifact.metadata.sourceId,
      artifactSha256: artifact.metadata.sha256,
      baselineSha256: baseline.artifactSha256,
    };
  }
  return {
    state: "changed",
    sourceId: artifact.metadata.sourceId,
    artifactSha256: artifact.metadata.sha256,
    baselineSha256: baseline.artifactSha256,
    reasons: [...new Set(reasons)],
  };
}
