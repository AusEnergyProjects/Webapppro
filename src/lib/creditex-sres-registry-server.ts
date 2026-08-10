import { strFromU8, unzipSync } from "fflate";
import {
  CER_SRES_PRODUCT_SOURCES,
  CER_SRES_PRODUCT_REGISTER_URL,
  CER_SRES_REFERENCE_SOURCES,
  CREDITEX_SRES_REGISTRY_CONTRACT,
  CreditexSresRegistryError,
  parseCerSresProductCsv,
  registeredStcsForZone,
  resolveCerSresPostcode,
  type CerSresProductRecord,
  type CerSresProductSource,
  type CerSresReferenceSource,
  type CerSresRegisteredTechnology,
} from "./creditex-sres-registry.ts";
import {
  estimateCreditexStcs,
  type CreditexStcEstimate,
} from "./creditex-stc-estimator.ts";
import {
  ensureCreditexProductRegistrySchemaGuards,
} from "./creditex-product-registry-schema-guards.ts";
import { australianRegulatorDate } from "./creditex-australian-regulator-date.ts";

const REGISTRY_CODE = "cer_sres_swh" as const;
const SOURCE_MAXIMUM_BYTES = 1_900_000;
const SOURCE_MAXIMUM_TOTAL_BYTES = 5 * 1024 * 1024;
const REGISTER_METADATA_MAXIMUM_EXPANDED_BYTES = 1_000_000;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PRODUCT_INSERT_CHUNK = 1_000;
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const SYNC_LEASE_MS = 15 * 60 * 1000;
const PRODUCT_FACET_MAXIMUM_VALUES = 20_000;
const EXACT_PRODUCT_MAXIMUM_RECORDS = 500;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9:_-]*$/;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SnapshotRow = {
  id: string;
  source_manifest_json: string;
  source_sha256: string;
  record_count: number;
  created_at: string;
  activated_at: string | null;
  activated_on: string | null;
};

type SyncRunRow = {
  status: "success" | "unchanged" | "failed";
  snapshot_id: string | null;
  checked_at: string;
  message: string;
};

type ProductRow = {
  snapshot_id: string;
  snapshot_source_manifest_json: string;
  snapshot_source_sha256: string;
  snapshot_activated_at: string;
  snapshot_activated_on: string;
  source_record_key: string;
  source_item: string;
  technology: CerSresRegisteredTechnology;
  category: string;
  brand: string;
  model: string;
  eligible_from: string;
  eligible_to: string;
  zone_1_stcs: number | null;
  zone_2_stcs: number | null;
  zone_3_stcs: number | null;
  zone_4_stcs: number | null;
  zone_5_stcs: number | null;
};

type ProductFacetRow = {
  value: string;
  record_count: number;
};

type ProductMatchCountRow = {
  match_count: number;
};

type SourceArtifact = {
  source: CerSresProductSource;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
  records: CerSresProductRecord[];
  registerMetadata: RegisterMetadataArtifact;
};

type SourceCountRow = {
  source_key: string;
  record_count: number;
};

type ReferenceArtifact = {
  source: CerSresReferenceSource;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
  records: readonly [];
};

type RegisterMetadataArtifact = {
  source: {
    sourceKey: string;
    url: string;
  };
  contentType: typeof XLSX_CONTENT_TYPE;
  bytes: Uint8Array;
  sha256: string;
  records: readonly [];
  registerVersion: number;
  publishedOn: string;
};

type RegistryArtifact =
  | SourceArtifact
  | ReferenceArtifact
  | RegisterMetadataArtifact;

export type CreditexSresArtifactStore = {
  head(key: string): Promise<{
    size: number;
    customMetadata?: Record<string, string>;
  } | null>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
};

export type CreditexSresReviewedProductCountDecrease = Readonly<{
  reviewedByUid: string;
  governanceIdentityVerified: true;
  reviewNote: string;
  sources: readonly Readonly<{
    sourceKey: string;
    previousRecordCount: number;
    acceptedRecordCount: number;
  }>[];
}>;

export type CreditexSresRegistryStatus = {
  registryCode: typeof REGISTRY_CODE;
  status: "current" | "stale" | "unavailable";
  freshnessWindowHours: 48;
  lastCheckedAt: string | null;
  lastAttempt: {
    status: SyncRunRow["status"];
    checkedAt: string;
    message: string;
  } | null;
  snapshot: {
    id: string;
    sourceSha256: string;
    recordCount: number;
    activatedAt: string | null;
    activatedOn: string | null;
    sourceManifest: unknown;
  } | null;
};

function fail(code: string, status: number, message: string): never {
  throw new CreditexSresRegistryError(code, status, message);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return fail(
    "SRES_REGISTRY_CANONICALISATION_FAILED",
    500,
    "The official registry snapshot could not be sealed safely.",
  );
}

type SourceCountDecrease = Readonly<{
  sourceKey: string;
  previousRecordCount: number;
  acceptedRecordCount: number;
}>;

function validateReviewedCountDecrease(
  review: CreditexSresReviewedProductCountDecrease | undefined,
  decreases: readonly SourceCountDecrease[],
) {
  if (decreases.length === 0) {
    if (review) {
      return fail(
        "SRES_REFRESH_REQUEST_INVALID",
        400,
        "A reviewed count decrease may only be supplied when an official source count decreased.",
      );
    }
    return null;
  }
  if (!review) {
    return fail(
      "SRES_PRODUCT_SOURCE_COUNT_REGRESSION",
      503,
      `The official ${decreases[0].sourceKey} source returned fewer records than the accepted snapshot and requires review.`,
    );
  }
  const reviewedByUid = typeof review.reviewedByUid === "string"
    ? review.reviewedByUid.trim()
    : "";
  const reviewNote = typeof review.reviewNote === "string"
    ? review.reviewNote.trim().replace(/\s+/g, " ")
    : "";
  if (
    review.governanceIdentityVerified !== true
    || !reviewedByUid
    || reviewedByUid.length > 200
    || reviewNote.length < 20
    || reviewNote.length > 1_000
    || !Array.isArray(review.sources)
  ) {
    return fail(
      "SRES_REFRESH_REQUEST_INVALID",
      400,
      "Reviewed source decreases require a verified reviewer identity and a bounded review note.",
    );
  }
  const reviewedSources = review.sources.map((source) => ({
    sourceKey: typeof source?.sourceKey === "string"
      ? source.sourceKey.trim().toLowerCase()
      : "",
    previousRecordCount: Number(source?.previousRecordCount),
    acceptedRecordCount: Number(source?.acceptedRecordCount),
  })).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  const observed = [...decreases].sort((left, right) => (
    left.sourceKey.localeCompare(right.sourceKey)
  ));
  if (
    reviewedSources.length !== observed.length
    || new Set(reviewedSources.map(({ sourceKey }) => sourceKey)).size
      !== reviewedSources.length
    || reviewedSources.some((source) => (
      !TOKEN_PATTERN.test(source.sourceKey)
      || !Number.isSafeInteger(source.previousRecordCount)
      || !Number.isSafeInteger(source.acceptedRecordCount)
      || source.previousRecordCount <= source.acceptedRecordCount
      || source.acceptedRecordCount < 1
    ))
    || canonicalJson(reviewedSources) !== canonicalJson(observed)
  ) {
    return fail(
      "SRES_PRODUCT_SOURCE_COUNT_REGRESSION",
      409,
      "The reviewed source counts do not exactly match the observed decrease.",
    );
  }
  return {
    reviewedByUid,
    governanceIdentityVerified: true as const,
    reviewNote,
    sources: reviewedSources,
  };
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const exactBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exactBytes.buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validIsoDate(value: unknown, label: string) {
  const date = String(value || "").trim();
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(date)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    return fail(
      "SRES_DATE_INVALID",
      400,
      `Enter a valid ${label}.`,
    );
  }
  return date;
}

function parseManifest(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(
      "SRES_REGISTRY_INTEGRITY_FAILED",
      503,
      "The current product registry manifest is invalid.",
    );
  }
}

async function boundedResponseBytes(response: Response, sourceKey: string) {
  if (!response.body) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official ${sourceKey} source returned no body.`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SOURCE_MAXIMUM_BYTES) {
      await reader.cancel().catch(() => undefined);
      return fail(
        "SRES_PRODUCT_SOURCE_TOO_LARGE",
        502,
        `The official ${sourceKey} source exceeded the size limit.`,
      );
    }
    chunks.push(value);
  }
  if (total === 0) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official ${sourceKey} source returned an empty body.`,
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

const FULL_MONTHS = new Map([
  ["January", "01"],
  ["February", "02"],
  ["March", "03"],
  ["April", "04"],
  ["May", "05"],
  ["June", "06"],
  ["July", "07"],
  ["August", "08"],
  ["September", "09"],
  ["October", "10"],
  ["November", "11"],
  ["December", "12"],
]);

function spreadsheetXmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => (
      String.fromCodePoint(Number.parseInt(code, 16))
    ))
    .replace(/&#(\d+);/g, (_, code) => (
      String.fromCodePoint(Number.parseInt(code, 10))
    ))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function registerPublishedDate(day: string, monthName: string, year: string) {
  const month = FULL_MONTHS.get(monthName);
  const date = month
    ? `${year}-${month}-${day.padStart(2, "0")}`
    : "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !date
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    return fail(
      "SRES_REGISTER_METADATA_INVALID",
      502,
      "The official CER register workbook contains an invalid published date.",
    );
  }
  return date;
}

export function parseCerSresRegisterMetadataXlsx(value: Uint8Array) {
  let sharedStrings: Uint8Array | undefined;
  let oversized = false;
  try {
    sharedStrings = unzipSync(Uint8Array.from(value), {
      filter(file) {
        if (file.name !== "xl/sharedStrings.xml") return false;
        if (file.originalSize > REGISTER_METADATA_MAXIMUM_EXPANDED_BYTES) {
          oversized = true;
          return false;
        }
        return true;
      },
    })["xl/sharedStrings.xml"];
  } catch {
    return fail(
      "SRES_REGISTER_METADATA_INVALID",
      502,
      "The official CER register workbook could not be read safely.",
    );
  }
  if (!sharedStrings || oversized) {
    return fail(
      "SRES_REGISTER_METADATA_INVALID",
      502,
      "The official CER register workbook is missing bounded release metadata.",
    );
  }
  const sharedXml = strFromU8(sharedStrings);
  const releases = new Map<string, { registerVersion: number; publishedOn: string }>();
  for (const match of sharedXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    const text = spreadsheetXmlText(match[1]).replace(/\s+/g, " ").trim();
    const release = /^Version (\d{1,4}) - Published (\d{1,2}) ([A-Z][a-z]+) (\d{4})$/
      .exec(text);
    if (!release) continue;
    const registerVersion = Number(release[1]);
    if (!Number.isSafeInteger(registerVersion) || registerVersion < 1) {
      return fail(
        "SRES_REGISTER_METADATA_INVALID",
        502,
        "The official CER register workbook contains an invalid version.",
      );
    }
    const publishedOn = registerPublishedDate(release[2], release[3], release[4]);
    releases.set(`${registerVersion}:${publishedOn}`, {
      registerVersion,
      publishedOn,
    });
  }
  if (releases.size !== 1) {
    return fail(
      "SRES_REGISTER_METADATA_INVALID",
      502,
      "The official CER register workbook does not identify one exact release.",
    );
  }
  return [...releases.values()][0];
}

async function fetchRegisterMetadata(
  source: CerSresProductSource,
  fetchImpl: FetchLike,
): Promise<RegisterMetadataArtifact> {
  const sourceKey = `${source.sourceKey}-register-metadata`;
  let response: Response;
  try {
    response = await fetchImpl(source.registerMetadataUrl, {
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: XLSX_CONTENT_TYPE },
    });
  } catch (error) {
    console.error("CER SRES register metadata fetch failed.", {
      sourceKey,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return fail(
      "SRES_REGISTER_METADATA_UNAVAILABLE",
      502,
      `The official ${sourceKey} source could not be fetched.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return fail(
      "SRES_REGISTER_METADATA_UNAVAILABLE",
      502,
      `The official ${sourceKey} source returned an HTTP redirect.`,
    );
  }
  if (!response.ok) {
    return fail(
      "SRES_REGISTER_METADATA_UNAVAILABLE",
      502,
      `The official ${sourceKey} source returned HTTP ${response.status}.`,
    );
  }
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== XLSX_CONTENT_TYPE) {
    return fail(
      "SRES_REGISTER_METADATA_INVALID",
      502,
      `The official ${sourceKey} source did not return XLSX data.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > SOURCE_MAXIMUM_BYTES
  ) {
    return fail(
      "SRES_PRODUCT_SOURCE_TOO_LARGE",
      502,
      `The official ${sourceKey} source exceeded the size limit.`,
    );
  }
  const bytes = await boundedResponseBytes(response, sourceKey);
  const release = parseCerSresRegisterMetadataXlsx(bytes);
  return {
    source: {
      sourceKey,
      url: source.registerMetadataUrl,
    },
    contentType: XLSX_CONTENT_TYPE,
    bytes,
    sha256: await sha256Hex(bytes),
    records: [],
    ...release,
  };
}

function validateReviewedRegisterRelease(
  source: CerSresProductSource,
  csvSha256: string,
  records: readonly CerSresProductRecord[],
  metadata: RegisterMetadataArtifact,
) {
  const reviewed = source.reviewedRelease;
  if (!reviewed) return;
  if (
    metadata.registerVersion < reviewed.version
    || metadata.publishedOn < reviewed.publishedOn
    || (
      metadata.registerVersion > reviewed.version
      && metadata.publishedOn <= reviewed.publishedOn
    )
  ) {
    return fail(
      "SRES_REGISTER_RELEASE_REGRESSION",
      503,
      "The official CER register release regressed behind the independently reviewed release.",
    );
  }
  if (
    metadata.registerVersion === reviewed.version
    && (
      metadata.publishedOn !== reviewed.publishedOn
      || records.length !== reviewed.recordCount
      || csvSha256 !== reviewed.csvSha256
      || metadata.sha256 !== reviewed.workbookSha256
    )
  ) {
    return fail(
      "SRES_REGISTER_RELEASE_CHANGED",
      503,
      "The reviewed CER register version changed without a new official release and was quarantined.",
    );
  }
}

async function fetchSource(
  source: CerSresProductSource,
  fetchImpl: FetchLike,
): Promise<SourceArtifact> {
  let response: Response;
  try {
    response = await fetchImpl(source.url, {
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: "text/csv" },
    });
  } catch (error) {
    console.error("CER SRES product source fetch failed.", {
      sourceKey: source.sourceKey,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return fail(
      "SRES_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source could not be fetched.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return fail(
      "SRES_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source returned an HTTP redirect.`,
    );
  }
  if (!response.ok) {
    return fail(
      "SRES_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source returned HTTP ${response.status}.`,
    );
  }
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "text/csv") {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official ${source.sourceKey} source did not return CSV data.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > SOURCE_MAXIMUM_BYTES
  ) {
    return fail(
      "SRES_PRODUCT_SOURCE_TOO_LARGE",
      502,
      `The official ${source.sourceKey} source exceeded the size limit.`,
    );
  }
  const bytes = await boundedResponseBytes(response, source.sourceKey);
  let body = "";
  try {
    body = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official ${source.sourceKey} source was not valid UTF-8.`,
    );
  }
  const records = parseCerSresProductCsv(body, source);
  const sha256 = await sha256Hex(bytes);
  const registerMetadata = await fetchRegisterMetadata(source, fetchImpl);
  validateReviewedRegisterRelease(source, sha256, records, registerMetadata);
  return {
    source,
    contentType,
    bytes,
    sha256,
    records,
    registerMetadata,
  };
}

async function fetchReference(
  source: CerSresReferenceSource,
  fetchImpl: FetchLike,
): Promise<ReferenceArtifact> {
  let response: Response;
  try {
    response = await fetchImpl(source.url, {
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: source.expectedContentType },
    });
  } catch (error) {
    console.error("CER SRES reference source fetch failed.", {
      sourceKey: source.sourceKey,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return fail(
      "SRES_POSTCODE_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source could not be fetched.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return fail(
      "SRES_POSTCODE_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source returned an HTTP redirect.`,
    );
  }
  if (!response.ok) {
    return fail(
      "SRES_POSTCODE_SOURCE_UNAVAILABLE",
      502,
      `The official ${source.sourceKey} source returned HTTP ${response.status}.`,
    );
  }
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== source.expectedContentType) {
    return fail(
      "SRES_POSTCODE_SOURCE_INVALID",
      502,
      `The official ${source.sourceKey} source returned an unexpected content type.`,
    );
  }
  const bytes = await boundedResponseBytes(response, source.sourceKey);
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== source.expectedSha256) {
    return fail(
      "SRES_POSTCODE_SOURCE_CHANGED",
      503,
      "An official CER postcode source changed. Calculations are quarantined until its transcription is independently updated and approved.",
    );
  }
  return {
    source,
    contentType,
    bytes,
    sha256,
    records: [],
  };
}

function artifactObjectKey(artifact: RegistryArtifact) {
  const extension = artifact.contentType === "application/pdf"
    ? "pdf"
    : artifact.contentType === XLSX_CONTENT_TYPE
      ? "xlsx"
      : "csv";
  return `creditex/official-sources/${REGISTRY_CODE}/${artifact.source.sourceKey}/${artifact.sha256}.${extension}`;
}

async function retainArtifact(
  store: CreditexSresArtifactStore,
  artifact: RegistryArtifact,
) {
  const objectKey = artifactObjectKey(artifact);
  const validate = async (
    retained: Awaited<ReturnType<typeof store.head>>,
  ) => {
    if (
      !retained
      || Number(retained.size) !== artifact.bytes.byteLength
      || retained.customMetadata?.sha256 !== artifact.sha256
      || retained.customMetadata?.sourceKey !== artifact.source.sourceKey
    ) {
      return fail(
        "SRES_SOURCE_CUSTODY_FAILED",
        503,
        `The official ${artifact.source.sourceKey} source could not be retained with verified custody.`,
      );
    }
    try {
      const retainedBody = await store.get(objectKey);
      const retainedBytes = retainedBody
        ? new Uint8Array(await retainedBody.arrayBuffer())
        : null;
      if (
        !retainedBytes
        || retainedBytes.byteLength !== artifact.bytes.byteLength
        || await sha256Hex(retainedBytes) !== artifact.sha256
      ) {
        return fail(
          "SRES_SOURCE_CUSTODY_FAILED",
          503,
          `The retained ${artifact.source.sourceKey} source bytes did not match the official download.`,
        );
      }
    } catch (error) {
      if (error instanceof CreditexSresRegistryError) throw error;
      return fail(
        "SRES_SOURCE_CUSTODY_FAILED",
        503,
        `The retained ${artifact.source.sourceKey} source bytes could not be verified.`,
      );
    }
  };
  const existing = await store.head(objectKey);
  if (existing) {
    await validate(existing);
    return objectKey;
  }
  await store.put(objectKey, artifact.bytes, {
    httpMetadata: { contentType: artifact.contentType },
    customMetadata: {
      sha256: artifact.sha256,
      sourceKey: artifact.source.sourceKey,
      sourceUrl: artifact.source.url,
    },
  });
  await validate(await store.head(objectKey));
  return objectKey;
}

async function acquireSyncLease(
  db: D1Database,
  leaseId: string,
  startedAt: string,
) {
  const expiresAt = new Date(
    new Date(startedAt).getTime() + SYNC_LEASE_MS,
  ).toISOString();
  const result = await db.prepare(`INSERT INTO compliance_product_registry_sync_leases (
      registry_code, lease_id, started_at, expires_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(registry_code) DO UPDATE SET
      lease_id = excluded.lease_id,
      started_at = excluded.started_at,
      expires_at = excluded.expires_at
    WHERE compliance_product_registry_sync_leases.expires_at <= excluded.started_at`)
    .bind(REGISTRY_CODE, leaseId, startedAt, expiresAt)
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail(
      "SRES_REFRESH_IN_PROGRESS",
      409,
      "An official registry refresh is already in progress.",
    );
  }
}

async function releaseSyncLease(db: D1Database, leaseId: string) {
  await db.prepare(`DELETE FROM compliance_product_registry_sync_leases
    WHERE registry_code = ? AND lease_id = ?`)
    .bind(REGISTRY_CODE, leaseId)
    .run();
}

async function cleanAbandonedRegistryRows(db: D1Database) {
  await db.prepare(`DELETE FROM compliance_product_registry_snapshots
    WHERE registry_code = ? AND status = 'staging'`)
    .bind(REGISTRY_CODE)
    .run();
}

function pruneUnchangedHistoricalProducts(
  db: D1Database,
  supersededSnapshotId: string,
  currentSnapshotId: string,
) {
  return db.prepare(`DELETE FROM compliance_product_registry_products
    WHERE snapshot_id = ?
      AND EXISTS (
        SELECT 1
        FROM compliance_product_registry_products current_product
        WHERE current_product.snapshot_id = ?
          AND current_product.source_record_key = compliance_product_registry_products.source_record_key
          AND current_product.source_item = compliance_product_registry_products.source_item
          AND current_product.technology = compliance_product_registry_products.technology
          AND current_product.category = compliance_product_registry_products.category
          AND current_product.brand = compliance_product_registry_products.brand
          AND current_product.model = compliance_product_registry_products.model
          AND current_product.search_text = compliance_product_registry_products.search_text
          AND current_product.eligible_from = compliance_product_registry_products.eligible_from
          AND current_product.eligible_to = compliance_product_registry_products.eligible_to
          AND current_product.zone_1_stcs IS compliance_product_registry_products.zone_1_stcs
          AND current_product.zone_2_stcs IS compliance_product_registry_products.zone_2_stcs
          AND current_product.zone_3_stcs IS compliance_product_registry_products.zone_3_stcs
          AND current_product.zone_4_stcs IS compliance_product_registry_products.zone_4_stcs
          AND current_product.zone_5_stcs IS compliance_product_registry_products.zone_5_stcs
      )`)
    .bind(supersededSnapshotId, currentSnapshotId);
}

async function insertProductChunks(
  db: D1Database,
  snapshotId: string,
  records: readonly CerSresProductRecord[],
) {
  for (let offset = 0; offset < records.length; offset += PRODUCT_INSERT_CHUNK) {
    const rows = records.slice(offset, offset + PRODUCT_INSERT_CHUNK).map(
      (record) => ({
        id: `${snapshotId}:${record.sourceRecordKey}`,
        snapshotId,
        sourceRecordKey: record.sourceRecordKey,
        sourceItem: record.sourceItem,
        technology: record.technology,
        category: record.category,
        brand: record.brand,
        model: record.model,
        searchText: `${record.brand} ${record.model}`.toLowerCase(),
        eligibleFrom: record.eligibleFrom,
        eligibleTo: record.eligibleTo,
        zone1Stcs: record.zone1Stcs,
        zone2Stcs: record.zone2Stcs,
        zone3Stcs: record.zone3Stcs,
        zone4Stcs: record.zone4Stcs,
        zone5Stcs: record.zone5Stcs,
      }),
    );
    await db.prepare(`INSERT INTO compliance_product_registry_products (
      id, snapshot_id, source_record_key, source_item, technology, category,
      brand, model, search_text, eligible_from, eligible_to, zone_1_stcs,
      zone_2_stcs, zone_3_stcs, zone_4_stcs, zone_5_stcs
    ) SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.snapshotId'),
      json_extract(value, '$.sourceRecordKey'),
      json_extract(value, '$.sourceItem'),
      json_extract(value, '$.technology'),
      json_extract(value, '$.category'),
      json_extract(value, '$.brand'),
      json_extract(value, '$.model'),
      json_extract(value, '$.searchText'),
      json_extract(value, '$.eligibleFrom'),
      json_extract(value, '$.eligibleTo'),
      json_extract(value, '$.zone1Stcs'),
      json_extract(value, '$.zone2Stcs'),
      json_extract(value, '$.zone3Stcs'),
      json_extract(value, '$.zone4Stcs'),
      json_extract(value, '$.zone5Stcs')
    FROM json_each(?)`)
      .bind(JSON.stringify(rows))
      .run();
  }
}

async function recordSyncFailure(
  db: D1Database,
  checkedAt: string,
  message: string,
) {
  await db.prepare(`INSERT INTO compliance_product_registry_sync_runs (
    id, registry_code, status, snapshot_id, source_manifest_json,
    source_sha256, record_count, checked_at, message
  ) VALUES (?, ?, 'failed', NULL, NULL, NULL, 0, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      REGISTRY_CODE,
      checkedAt,
      message.slice(0, 500),
    )
    .run();
}

export async function syncCerSresProductRegistry(
  db: D1Database,
  options: {
    artifactStore?: CreditexSresArtifactStore;
    fetchImpl?: FetchLike;
    now?: Date;
    references?: readonly CerSresReferenceSource[];
    sources?: readonly CerSresProductSource[];
    reviewedCountDecrease?: CreditexSresReviewedProductCountDecrease;
  } = {},
) {
  await ensureCreditexProductRegistrySchemaGuards(db);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const checkedAt = now.toISOString();
  const checkedOn = australianRegulatorDate(now);
  const sources = options.sources || CER_SRES_PRODUCT_SOURCES;
  const references = options.references || CER_SRES_REFERENCE_SOURCES;
  const artifactStore = options.artifactStore;
  const leaseId = crypto.randomUUID();
  let stagingSnapshotId = "";
  let leaseAcquired = false;
  try {
    await acquireSyncLease(db, leaseId, checkedAt);
    leaseAcquired = true;
    await cleanAbandonedRegistryRows(db);
    if (!artifactStore) {
      return fail(
        "SRES_SOURCE_CUSTODY_UNAVAILABLE",
        503,
        "Immutable official source storage is unavailable.",
      );
    }
    const productArtifacts: SourceArtifact[] = [];
    for (const source of sources) {
      productArtifacts.push(await fetchSource(source, fetchImpl));
    }
    const referenceArtifacts: ReferenceArtifact[] = [];
    for (const source of references) {
      referenceArtifacts.push(await fetchReference(source, fetchImpl));
    }
    const registerMetadataArtifacts = productArtifacts.map(
      (artifact) => artifact.registerMetadata,
    );
    const registerRelease = registerMetadataArtifacts[0];
    if (
      !registerRelease
      || registerMetadataArtifacts.some((artifact) => (
        artifact.registerVersion !== registerRelease.registerVersion
        || artifact.publishedOn !== registerRelease.publishedOn
      ))
    ) {
      return fail(
        "SRES_REGISTER_RELEASE_INCONSISTENT",
        503,
        "The official CER product workbooks do not identify one consistent register release.",
      );
    }
    const artifacts: (SourceArtifact | ReferenceArtifact)[] = [
      ...productArtifacts,
      ...referenceArtifacts,
    ];
    const custodyArtifacts: RegistryArtifact[] = [
      ...artifacts,
      ...registerMetadataArtifacts,
    ];
    const totalBytes = custodyArtifacts.reduce(
      (total, artifact) => total + artifact.bytes.byteLength,
      0,
    );
    if (totalBytes > SOURCE_MAXIMUM_TOTAL_BYTES) {
      return fail(
        "SRES_PRODUCT_SOURCE_TOO_LARGE",
        502,
        "The official product registry exceeded the combined size limit.",
      );
    }
    const recordCount = artifacts.reduce(
      (total, artifact) => total + artifact.records.length,
      0,
    );
    const current = await db.prepare(`SELECT
      id, source_manifest_json, source_sha256, record_count,
      created_at, activated_at, activated_on
    FROM compliance_product_registry_snapshots
    WHERE registry_code = ? AND status = 'current'
    LIMIT 1`).bind(REGISTRY_CODE).first<SnapshotRow>();
    const decreases: SourceCountDecrease[] = [];
    if (current) {
      const previousSourceCounts = await db.prepare(`SELECT
          artifact.source_key, artifact.record_count
        FROM compliance_product_registry_source_artifacts artifact
        WHERE artifact.snapshot_id = ?`)
        .bind(current.id)
        .all<SourceCountRow>();
      const countsBySource = new Map(
        (previousSourceCounts.results || []).map((row) => [
          row.source_key,
          Number(row.record_count),
        ]),
      );
      for (const artifact of productArtifacts) {
        const previousCount = countsBySource.get(artifact.source.sourceKey);
        if (
          previousCount !== undefined
          && artifact.records.length < previousCount
        ) {
          decreases.push({
            sourceKey: artifact.source.sourceKey,
            previousRecordCount: previousCount,
            acceptedRecordCount: artifact.records.length,
          });
        }
      }
    }
    const acceptedDecreaseReview = validateReviewedCountDecrease(
      options.reviewedCountDecrease,
      decreases,
    );
    const reviewAuditMessage = acceptedDecreaseReview
      ? canonicalJson({
          contract: "creditex-sres-reviewed-product-count-decrease/v1",
          reviewedAt: checkedAt,
          ...acceptedDecreaseReview,
        })
      : "";
    if (reviewAuditMessage.length > 2_000) {
      return fail(
        "SRES_REFRESH_REQUEST_INVALID",
        400,
        "The reviewed source decrease audit exceeds its bounded storage limit.",
      );
    }
    const objectKeys = new Map<string, string>();
    for (const artifact of custodyArtifacts) {
      objectKeys.set(
        artifact.source.sourceKey,
        await retainArtifact(artifactStore, artifact),
      );
    }
    const manifest = {
      contract: CREDITEX_SRES_REGISTRY_CONTRACT,
      registryCode: REGISTRY_CODE,
      registerRelease: {
        registerUrl: CER_SRES_PRODUCT_REGISTER_URL,
        version: registerRelease.registerVersion,
        publishedOn: registerRelease.publishedOn,
      },
      sources: artifacts.map((artifact) => ({
        sourceKey: artifact.source.sourceKey,
        ...("registerMetadata" in artifact
          ? {
              technology: artifact.source.technology,
              category: artifact.source.category,
              registerMetadata: {
                url: artifact.registerMetadata.source.url,
                contentType: artifact.registerMetadata.contentType,
                byteLength: artifact.registerMetadata.bytes.byteLength,
                sha256: artifact.registerMetadata.sha256,
                objectKey: objectKeys.get(
                  artifact.registerMetadata.source.sourceKey,
                ),
              },
            }
          : { referenceType: "postcode_zone_map" }),
        url: artifact.source.url,
        contentType: artifact.contentType,
        byteLength: artifact.bytes.byteLength,
        recordCount: artifact.records.length,
        sha256: artifact.sha256,
        objectKey: objectKeys.get(artifact.source.sourceKey),
      })),
    };
    const sourceManifestJson = canonicalJson(manifest);
    const sourceSha256 = await sha256Hex(sourceManifestJson);
    if (current?.source_sha256 === sourceSha256) {
      await db.prepare(`INSERT INTO compliance_product_registry_sync_runs (
        id, registry_code, status, snapshot_id, source_manifest_json,
        source_sha256, record_count, checked_at, message
      ) VALUES (?, ?, 'unchanged', ?, ?, ?, ?, ?, '')`)
        .bind(
          crypto.randomUUID(),
          REGISTRY_CODE,
          current.id,
          sourceManifestJson,
          sourceSha256,
          recordCount,
          checkedAt,
        )
        .run();
      return {
        changed: false,
        snapshotId: current.id,
        sourceSha256,
        recordCount,
        checkedAt,
      };
    }

    stagingSnapshotId = crypto.randomUUID();
    await db.prepare(`INSERT INTO compliance_product_registry_snapshots (
      id, registry_code, contract, source_manifest_json, source_sha256,
      record_count, status, created_at, activated_at, activated_on,
      superseded_at, superseded_on
    ) VALUES (?, ?, ?, ?, ?, ?, 'staging', ?, NULL, NULL, NULL, NULL)`)
      .bind(
        stagingSnapshotId,
        REGISTRY_CODE,
        CREDITEX_SRES_REGISTRY_CONTRACT,
        sourceManifestJson,
        sourceSha256,
        recordCount,
        checkedAt,
      )
      .run();

    for (const artifact of artifacts) {
      await db.prepare(`INSERT INTO compliance_product_registry_source_artifacts (
        id, snapshot_id, source_key, source_url, source_sha256, content_type,
        byte_length, record_count, object_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          `${stagingSnapshotId}:${artifact.source.sourceKey}`,
          stagingSnapshotId,
          artifact.source.sourceKey,
          artifact.source.url,
          artifact.sha256,
          artifact.contentType,
          artifact.bytes.byteLength,
          artifact.records.length,
          objectKeys.get(artifact.source.sourceKey),
          checkedAt,
        )
        .run();
      if (artifact.records.length) {
        await insertProductChunks(db, stagingSnapshotId, artifact.records);
      }
    }
    const inserted = await db.prepare(`SELECT COUNT(*) AS count
      FROM compliance_product_registry_products WHERE snapshot_id = ?`)
      .bind(stagingSnapshotId)
      .first<{ count: number }>();
    if (Number(inserted?.count || 0) !== recordCount) {
      return fail(
        "SRES_REGISTRY_INTEGRITY_FAILED",
        500,
        "The staged registry record count did not reconcile.",
      );
    }
    const activationStatements = [
      db.prepare(`UPDATE compliance_product_registry_snapshots
        SET status = 'superseded', superseded_at = ?, superseded_on = ?
        WHERE registry_code = ? AND status = 'current'`)
        .bind(checkedAt, checkedOn, REGISTRY_CODE),
      db.prepare(`UPDATE compliance_product_registry_snapshots
        SET status = 'current', activated_at = ?, activated_on = ?,
          superseded_at = NULL, superseded_on = NULL
        WHERE id = ? AND registry_code = ? AND status = 'staging'`)
        .bind(checkedAt, checkedOn, stagingSnapshotId, REGISTRY_CODE),
    ];
    if (current) {
      activationStatements.push(pruneUnchangedHistoricalProducts(
        db,
        current.id,
        stagingSnapshotId,
      ));
    }
    activationStatements.push(
      db.prepare(`INSERT INTO compliance_product_registry_sync_runs (
        id, registry_code, status, snapshot_id, source_manifest_json,
        source_sha256, record_count, checked_at, message
      ) VALUES (?, ?, 'success', ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          REGISTRY_CODE,
          stagingSnapshotId,
          sourceManifestJson,
          sourceSha256,
          recordCount,
          checkedAt,
          reviewAuditMessage,
        ),
    );
    await db.batch(activationStatements);
    await cleanAbandonedRegistryRows(db);
    return {
      changed: true,
      snapshotId: stagingSnapshotId,
      sourceSha256,
      recordCount,
      checkedAt,
      reviewedCountDecrease: acceptedDecreaseReview !== null,
    };
  } catch (error) {
    if (stagingSnapshotId) {
      await db.prepare(`DELETE FROM compliance_product_registry_snapshots
        WHERE id = ? AND status = 'staging'`)
        .bind(stagingSnapshotId)
        .run()
        .catch(() => undefined);
    }
    const rawMessage = error instanceof Error ? error.message : "";
    const message = rawMessage.trim()
      || "Unknown official registry refresh error.";
    if (leaseAcquired) {
      await recordSyncFailure(db, checkedAt, message).catch(() => undefined);
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease(db, leaseId).catch(() => undefined);
    }
  }
}

export async function loadCerSresRegistryStatus(
  db: D1Database,
  options: { now?: Date } = {},
): Promise<CreditexSresRegistryStatus> {
  await ensureCreditexProductRegistrySchemaGuards(db);
  const now = options.now || new Date();
  const [snapshot, lastSuccessfulCheck, lastAttempt] = await Promise.all([
    db.prepare(`SELECT id, source_manifest_json, source_sha256, record_count,
      created_at, activated_at, activated_on
      FROM compliance_product_registry_snapshots
      WHERE registry_code = ? AND status = 'current' LIMIT 1`)
      .bind(REGISTRY_CODE).first<SnapshotRow>(),
    db.prepare(`SELECT status, snapshot_id, checked_at, message
      FROM compliance_product_registry_sync_runs
      WHERE registry_code = ? AND status IN ('success', 'unchanged')
      ORDER BY checked_at DESC, rowid DESC LIMIT 1`)
      .bind(REGISTRY_CODE).first<SyncRunRow>(),
    db.prepare(`SELECT status, snapshot_id, checked_at, message
      FROM compliance_product_registry_sync_runs
      WHERE registry_code = ? ORDER BY checked_at DESC, rowid DESC LIMIT 1`)
      .bind(REGISTRY_CODE).first<SyncRunRow>(),
  ]);
  const lastCheckedAt = lastSuccessfulCheck?.checked_at || null;
  const current = Boolean(
    snapshot
    && lastCheckedAt
    && lastAttempt?.status !== "failed"
    && lastAttempt?.snapshot_id === snapshot.id
    && lastSuccessfulCheck?.snapshot_id === snapshot.id
    && now.getTime() - new Date(lastCheckedAt).getTime()
      <= FRESHNESS_WINDOW_MS,
  );
  return {
    registryCode: REGISTRY_CODE,
    status: !snapshot ? "unavailable" : current ? "current" : "stale",
    freshnessWindowHours: 48,
    lastCheckedAt,
    lastAttempt: lastAttempt
      ? {
          status: lastAttempt.status,
          checkedAt: lastAttempt.checked_at,
          message: lastAttempt.message,
        }
      : null,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          sourceSha256: snapshot.source_sha256,
          recordCount: Number(snapshot.record_count),
          activatedAt: snapshot.activated_at,
          activatedOn: snapshot.activated_on,
          sourceManifest: parseManifest(snapshot.source_manifest_json),
        }
      : null,
  };
}

type CurrentRegistryStatus = CreditexSresRegistryStatus & {
  status: "current";
  snapshot: NonNullable<CreditexSresRegistryStatus["snapshot"]>;
};

async function requireCurrentRegistry(
  db: D1Database,
  now?: Date,
): Promise<CurrentRegistryStatus> {
  const status = await loadCerSresRegistryStatus(db, { now });
  if (status.status !== "current" || !status.snapshot) {
    return fail(
      status.status === "stale"
        ? "SRES_PRODUCT_REGISTRY_STALE"
        : "SRES_PRODUCT_REGISTRY_UNAVAILABLE",
      503,
      status.status === "stale"
        ? "The official product registry is stale. Refresh it before calculating."
        : "No current official product registry is available yet.",
    );
  }
  return status as CurrentRegistryStatus;
}

const SRES_PRODUCT_CATEGORIES = {
  air_source_heat_pump: ["capacity_at_most_425l"],
  solar_water_heater: [
    "capacity_less_than_700l",
    "capacity_at_least_700l",
  ],
} as const satisfies Record<
  CerSresRegisteredTechnology,
  readonly string[]
>;

const EFFECTIVE_SRES_PRODUCT_CANDIDATES = `WITH candidates AS (
    SELECT
      product.source_record_key, product.source_item, product.technology,
      product.category, product.brand, product.model, product.search_text,
      product.eligible_from, product.eligible_to, product.zone_1_stcs,
      product.zone_2_stcs, product.zone_3_stcs, product.zone_4_stcs,
      product.zone_5_stcs,
      row_number() OVER (
        PARTITION BY product.source_record_key
        ORDER BY
          CASE snapshot.status WHEN 'superseded' THEN 0 ELSE 1 END,
          snapshot.activated_at DESC,
          snapshot.id DESC
      ) AS effective_rank
    FROM compliance_product_registry_products product
    JOIN compliance_product_registry_snapshots snapshot
      ON snapshot.id = product.snapshot_id
    WHERE snapshot.registry_code = ?
      AND snapshot.status IN ('current', 'superseded')
      AND product.technology = ?
      AND product.eligible_from <= ? AND product.eligible_to >= ?
      AND (
        snapshot.status = 'current'
        OR (
          (
            snapshot.activated_on <= ?
            OR NOT EXISTS (
              SELECT 1
              FROM compliance_product_registry_products earlier_product
              JOIN compliance_product_registry_snapshots earlier_snapshot
                ON earlier_snapshot.id = earlier_product.snapshot_id
              WHERE earlier_snapshot.registry_code = snapshot.registry_code
                AND earlier_snapshot.status = 'superseded'
                AND earlier_product.source_record_key = product.source_record_key
                AND earlier_snapshot.activated_at < snapshot.activated_at
            )
          )
          AND snapshot.superseded_on > ?
        )
      )
  ), effective_products AS (
    SELECT source_record_key, source_item, technology, category, brand, model,
      search_text, eligible_from, eligible_to, zone_1_stcs, zone_2_stcs,
      zone_3_stcs, zone_4_stcs, zone_5_stcs
    FROM candidates
    WHERE effective_rank = 1
  )`;

function effectiveProductBindings(
  technology: CerSresRegisteredTechnology,
  installationDate: string,
) {
  return [
    REGISTRY_CODE,
    technology,
    installationDate,
    installationDate,
    installationDate,
    installationDate,
  ] as const;
}

function exactFacetText(value: unknown, label: string, maximumLength: number) {
  const text = String(value || "");
  if (
    text !== text.trim()
    || text.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(text)
  ) {
    return fail(
      "SRES_PRODUCT_FILTER_INVALID",
      400,
      `Choose an exact ${label} from the current official registry.`,
    );
  }
  return text;
}

function productFacet(row: ProductFacetRow) {
  return {
    value: row.value,
    recordCount: Number(row.record_count),
  };
}

export async function searchCerSresProducts(
  db: D1Database,
  input: {
    technology: CerSresRegisteredTechnology;
    installationDate: string;
    category?: unknown;
    brand?: unknown;
    model?: unknown;
    query?: string;
    limit?: number;
    now?: Date;
    cascade?: boolean;
  },
) {
  await ensureCreditexProductRegistrySchemaGuards(db);
  if (
    input.technology !== "air_source_heat_pump"
    && input.technology !== "solar_water_heater"
  ) {
    return fail(
      "SRES_TECHNOLOGY_INVALID",
      400,
      "Choose a registered solar water heater or air-source heat pump.",
    );
  }
  const installationDate = validIsoDate(
    input.installationDate,
    "installation date",
  );
  const category = exactFacetText(input.category, "product category", 80);
  if (
    category
    && !(SRES_PRODUCT_CATEGORIES[input.technology] as readonly string[])
      .includes(category)
  ) {
    return fail(
      "SRES_PRODUCT_CATEGORY_INVALID",
      400,
      "Choose a product category that applies to the selected technology.",
    );
  }
  const brand = exactFacetText(input.brand, "product brand", 200);
  const model = exactFacetText(input.model, "product model", 200);
  if ((brand && !category) || (model && (!category || !brand))) {
    return fail(
      "SRES_PRODUCT_FILTER_INVALID",
      400,
      "Choose product category, then brand, then model in order.",
    );
  }
  const query = String(input.query || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .toLowerCase();
  if (query.length > 100) {
    return fail(
      "SRES_PRODUCT_QUERY_INVALID",
      400,
      "Product search is limited to 100 characters.",
    );
  }
  const limit = Math.min(
    EXACT_PRODUCT_MAXIMUM_RECORDS,
    Math.max(1, Math.floor(input.limit || 30)),
  );
  const registry = await requireCurrentRegistry(db, input.now);
  const bindings = effectiveProductBindings(
    input.technology,
    installationDate,
  );
  const categoriesRequest = db.prepare(`${EFFECTIVE_SRES_PRODUCT_CANDIDATES}
    SELECT category AS value, COUNT(*) AS record_count
    FROM effective_products
    GROUP BY category
    ORDER BY category
    LIMIT ${PRODUCT_FACET_MAXIMUM_VALUES + 1}`).bind(...bindings).all<ProductFacetRow>();
  const brandsRequest = category
    ? db.prepare(`${EFFECTIVE_SRES_PRODUCT_CANDIDATES}
        SELECT brand AS value, COUNT(*) AS record_count
        FROM effective_products
        WHERE category = ?
        GROUP BY brand
        ORDER BY brand COLLATE NOCASE, brand
        LIMIT ${PRODUCT_FACET_MAXIMUM_VALUES + 1}`)
      .bind(...bindings, category)
      .all<ProductFacetRow>()
    : Promise.resolve({ results: [] as ProductFacetRow[] });
  const modelsRequest = category && brand
    ? db.prepare(`${EFFECTIVE_SRES_PRODUCT_CANDIDATES}
        SELECT model AS value, COUNT(*) AS record_count
        FROM effective_products
        WHERE category = ? AND brand = ?
        GROUP BY model
        ORDER BY model COLLATE NOCASE, model
        LIMIT ${PRODUCT_FACET_MAXIMUM_VALUES + 1}`)
      .bind(...bindings, category, brand)
      .all<ProductFacetRow>()
    : Promise.resolve({ results: [] as ProductFacetRow[] });
  const loadProducts = input.cascade !== true || Boolean(model);
  const productsRequest = loadProducts
    ? db.prepare(`${EFFECTIVE_SRES_PRODUCT_CANDIDATES}
        SELECT source_record_key, source_item, technology, category, brand,
          model, eligible_from, eligible_to, zone_1_stcs, zone_2_stcs,
          zone_3_stcs, zone_4_stcs, zone_5_stcs
        FROM effective_products
        WHERE (? = '' OR category = ?)
          AND (? = '' OR brand = ?)
          AND (? = '' OR model = ?)
          AND (? = '' OR instr(search_text, ?) > 0)
        ORDER BY brand COLLATE NOCASE, model COLLATE NOCASE, source_record_key
        LIMIT ?`)
      .bind(
        ...bindings,
        category,
        category,
        brand,
        brand,
        model,
        model,
        query,
        query,
        input.cascade === true ? limit + 1 : limit,
      )
      .all<Omit<ProductRow,
        | "snapshot_id"
        | "snapshot_source_manifest_json"
        | "snapshot_source_sha256"
        | "snapshot_activated_at"
        | "snapshot_activated_on"
      >>()
    : Promise.resolve({
        results: [] as Array<Omit<ProductRow,
          | "snapshot_id"
          | "snapshot_source_manifest_json"
          | "snapshot_source_sha256"
          | "snapshot_activated_at"
          | "snapshot_activated_on"
        >>,
      });
  const matchCountRequest = loadProducts
    ? db.prepare(`${EFFECTIVE_SRES_PRODUCT_CANDIDATES}
        SELECT COUNT(*) AS match_count
        FROM effective_products
        WHERE (? = '' OR category = ?)
          AND (? = '' OR brand = ?)
          AND (? = '' OR model = ?)
          AND (? = '' OR instr(search_text, ?) > 0)`)
      .bind(
        ...bindings,
        category,
        category,
        brand,
        brand,
        model,
        model,
        query,
        query,
      )
      .first<ProductMatchCountRow>()
    : Promise.resolve({ match_count: 0 });
  const [categoryRows, brandRows, modelRows, rows, matchCountRow] = await Promise.all([
    categoriesRequest,
    brandsRequest,
    modelsRequest,
    productsRequest,
    matchCountRequest,
  ]);
  for (const [label, facetRows] of [
    ["product categories", categoryRows.results],
    ["brands", brandRows.results],
    ["models", modelRows.results],
  ] as const) {
    if (facetRows.length > PRODUCT_FACET_MAXIMUM_VALUES) {
      return fail(
        "SRES_PRODUCT_FACET_OVERFLOW",
        409,
        `The official registry contains more than ${PRODUCT_FACET_MAXIMUM_VALUES.toLocaleString("en-AU")} ${label}; the product navigation contract requires review before results can be shown safely.`,
      );
    }
  }
  if (input.cascade === true && rows.results.length > limit) {
    return fail(
      "SRES_PRODUCT_MATCH_OVERFLOW",
      409,
      `More than ${limit.toLocaleString("en-AU")} exact CER registrations share this product identity; the registry data requires review before one can be selected safely.`,
    );
  }
  return {
    registry,
    installationDate,
    technology: input.technology,
    category,
    brand,
    model,
    query,
    matchCount: Number(matchCountRow?.match_count || 0),
    facets: {
      categories: categoryRows.results.map(productFacet),
      brands: brandRows.results.map(productFacet),
      models: modelRows.results.map(productFacet),
    },
    products: rows.results.slice(0, limit).map((row) => ({
      sourceRecordKey: row.source_record_key,
      sourceItem: row.source_item,
      technology: row.technology,
      category: row.category,
      brand: row.brand,
      model: row.model,
      eligibleFrom: row.eligible_from,
      eligibleTo: row.eligible_to,
    })),
  };
}

async function resolveRegisteredProduct(
  db: D1Database,
  input: {
    technology: CerSresRegisteredTechnology;
    productKey: string;
    installationDate: string;
    now?: Date;
  },
) {
  const registry = await requireCurrentRegistry(db, input.now);
  const productKey = String(input.productKey || "").trim();
  if (!/^cer-[a-z0-9-]+:\d+$/.test(productKey) || productKey.length > 100) {
    return fail(
      "SRES_PRODUCT_INVALID",
      400,
      "Choose a product from the current official registry.",
    );
  }
  const installationDate = validIsoDate(
    input.installationDate,
    "installation date",
  );
  const product = await db.prepare(`SELECT
      p.snapshot_id,
      s.source_manifest_json AS snapshot_source_manifest_json,
      s.source_sha256 AS snapshot_source_sha256,
      s.activated_at AS snapshot_activated_at,
      s.activated_on AS snapshot_activated_on,
      p.source_record_key, p.source_item, p.technology, p.category,
      p.brand, p.model, p.eligible_from, p.eligible_to,
      p.zone_1_stcs, p.zone_2_stcs, p.zone_3_stcs,
      p.zone_4_stcs, p.zone_5_stcs
    FROM compliance_product_registry_products p
    JOIN compliance_product_registry_snapshots s ON s.id = p.snapshot_id
    WHERE s.registry_code = ?
      AND s.status IN ('current', 'superseded')
      AND p.source_record_key = ?
      AND p.technology = ? AND p.eligible_from <= ? AND p.eligible_to >= ?
      AND (
        s.status = 'current'
        OR (
          (
            s.activated_on <= ?
            OR NOT EXISTS (
              SELECT 1
              FROM compliance_product_registry_products earlier_product
              JOIN compliance_product_registry_snapshots earlier_snapshot
                ON earlier_snapshot.id = earlier_product.snapshot_id
              WHERE earlier_snapshot.registry_code = s.registry_code
                AND earlier_snapshot.status = 'superseded'
                AND earlier_product.source_record_key = p.source_record_key
                AND earlier_snapshot.activated_at < s.activated_at
            )
          )
          AND s.superseded_on > ?
        )
      )
    ORDER BY
      CASE s.status WHEN 'superseded' THEN 0 ELSE 1 END,
      s.activated_at DESC,
      s.id DESC
    LIMIT 1`)
    .bind(
      REGISTRY_CODE,
      productKey,
      input.technology,
      installationDate,
      installationDate,
      installationDate,
      installationDate,
    )
    .first<ProductRow>();
  if (!product) {
    return fail(
      "SRES_PRODUCT_INELIGIBLE",
      422,
      "The selected product is not eligible in the current registry on the installation date.",
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(product.snapshot_source_sha256)
    || !product.snapshot_activated_at
    || !DATE_PATTERN.test(product.snapshot_activated_on)
  ) {
    return fail(
      "SRES_REGISTRY_INTEGRITY_FAILED",
      503,
      "The selected product could not be reconciled to an effective official snapshot.",
    );
  }
  parseManifest(product.snapshot_source_manifest_json);
  return { registry, product, installationDate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const controlled = [...expected].sort();
  if (
    actual.length !== controlled.length
    || actual.some((key, index) => key !== controlled[index])
  ) {
    return fail(
      "SRES_REQUEST_INVALID",
      400,
      "The estimate request contains missing or unsupported fields.",
    );
  }
}

export async function estimateCreditexStcsFromRegistry(
  db: D1Database,
  requestValue: unknown,
  options: { now?: Date } = {},
): Promise<CreditexStcEstimate & {
  resolution?: Record<string, unknown>;
  resolvedReceiptHash?: string;
}> {
  await ensureCreditexProductRegistrySchemaGuards(db);
  if (!isRecord(requestValue)) {
    return fail(
      "SRES_REQUEST_INVALID",
      400,
      "Enter a valid STC estimate request.",
    );
  }
  const technology = String(requestValue.technology || "").trim();
  if (technology === "solar_pv") {
    exactKeys(requestValue, [
      "technology",
      "installationDate",
      "ratedCapacityKw",
      "postcode",
    ]);
    const registry = await requireCurrentRegistry(db, options.now);
    const postcode = resolveCerSresPostcode("solar_pv", requestValue.postcode);
    const estimate = estimateCreditexStcs({
      technology,
      installationDate: requestValue.installationDate,
      ratedCapacityKw: requestValue.ratedCapacityKw,
      zoneRating: postcode.rating,
    });
    const resolution = {
      postcode: postcode.postcode,
      zone: postcode.zone,
      zoneRating: postcode.rating,
      registryCode: REGISTRY_CODE,
      snapshotId: registry.snapshot.id,
      registrySourceSha256: registry.snapshot.sourceSha256,
      registryLastCheckedAt: registry.lastCheckedAt,
      sourceUrl: postcode.sourceUrl,
      sourceVersion: postcode.sourceVersion,
      sourceSha256: postcode.sourceSha256,
    };
    return {
      ...estimate,
      resolution,
      resolvedReceiptHash: `sha256:${await sha256Hex(canonicalJson({
        estimateReceiptHash: estimate.receiptHash,
        resolution,
      }))}`,
    };
  }
  if (
    technology === "solar_water_heater"
    || technology === "air_source_heat_pump"
  ) {
    exactKeys(requestValue, [
      "technology",
      "installationDate",
      "postcode",
      "productKey",
    ]);
    const typedTechnology = technology as CerSresRegisteredTechnology;
    const resolved = await resolveRegisteredProduct(db, {
      technology: typedTechnology,
      productKey: String(requestValue.productKey || ""),
      installationDate: String(requestValue.installationDate || ""),
      now: options.now,
    });
    const postcode = resolveCerSresPostcode(
      typedTechnology,
      requestValue.postcode,
    );
    const registeredTenYearStcs = registeredStcsForZone({
      zone1Stcs: resolved.product.zone_1_stcs,
      zone2Stcs: resolved.product.zone_2_stcs,
      zone3Stcs: resolved.product.zone_3_stcs,
      zone4Stcs: resolved.product.zone_4_stcs,
      zone5Stcs: resolved.product.zone_5_stcs,
    }, postcode.zone);
    const estimate = estimateCreditexStcs({
      technology: typedTechnology,
      installationDate: resolved.installationDate,
      registeredTenYearStcs,
    });
    const resolution = {
      registryCode: REGISTRY_CODE,
      snapshotId: resolved.product.snapshot_id,
      registrySourceSha256: resolved.product.snapshot_source_sha256,
      snapshotActivatedAt: resolved.product.snapshot_activated_at,
      snapshotActivatedOn: resolved.product.snapshot_activated_on,
      registryLastCheckedAt: resolved.registry.lastCheckedAt,
      sourceRecordKey: resolved.product.source_record_key,
      sourceItem: resolved.product.source_item,
      category: resolved.product.category,
      brand: resolved.product.brand,
      model: resolved.product.model,
      eligibleFrom: resolved.product.eligible_from,
      eligibleTo: resolved.product.eligible_to,
      postcode: postcode.postcode,
      zone: postcode.zone,
      registeredTenYearStcs,
      postcodeSourceUrl: postcode.sourceUrl,
      postcodeSourceVersion: postcode.sourceVersion,
      postcodeSourceSha256: postcode.sourceSha256,
    };
    return {
      ...estimate,
      resolution,
      resolvedReceiptHash: `sha256:${await sha256Hex(canonicalJson({
        estimateReceiptHash: estimate.receiptHash,
        resolution,
      }))}`,
      operatorMessage:
        "Estimate resolved from the effective-dated immutable official product snapshot and postcode zone. Certificate creation remains disabled pending complete installation evidence and REC Registry reconciliation.",
    };
  }
  return estimateCreditexStcs(requestValue);
}
