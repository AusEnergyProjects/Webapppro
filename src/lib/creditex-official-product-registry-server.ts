import {
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT,
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CreditexOfficialProductError,
  type CreditexOfficialProductKind,
  type CreditexOfficialProductRecord,
  type CreditexOfficialProductRegistryStatus,
  type CreditexOfficialProductSelection,
} from "./creditex-official-product-registry.ts";
import { australianRegulatorDate } from "./creditex-australian-regulator-date.ts";
import { ensureCreditexProductRegistrySchemaGuards } from "./creditex-product-registry-schema-guards.ts";

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const SYNC_LEASE_MS = 20 * 60 * 1000;
const PRODUCT_LOOKUP_CHUNK = 500;
const PRODUCT_INSERT_MAX_ROWS = 500;
const PRODUCT_INSERT_MAX_BIND_BYTES = 1_500_000;
const PRODUCT_INSERT_BATCH_MAX_STATEMENTS = 4;
const PRODUCT_INSERT_BATCH_MAX_BIND_BYTES = 6_000_000;
const PRODUCT_SELECTION_ID_PREFIX = "official-product-v1:";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9:_-]*$/;
const INELIGIBLE_STATUSES = new Set([
  "cancelled",
  "ineligible",
  "not_approved",
  "rejected",
  "superseded",
  "unknown",
  "withdrawn",
]);

const GEMS_CURRENT_STATUS = "approved";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type CreditexOfficialProductSourceDefinition = {
  registryCode: string;
  sourceKey: string;
  productKind: CreditexOfficialProductKind;
  url: string;
  minimumRecords: number;
  maximumBytes: number;
  expectedContentTypes: readonly string[];
  accept: string;
  licence: string;
  productionMode: "automatic" | "licence_required" | "controlled_manual";
  parse: (
    bytes: Uint8Array,
    contentType: string,
  ) => readonly CreditexOfficialProductRecord[];
};

export type CreditexOfficialProductRegistryDefinition = {
  registryCode: string;
  title: string;
  sources: readonly CreditexOfficialProductSourceDefinition[];
};

export type CreditexOfficialProductArtifactStore = {
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

type SnapshotRow = {
  id: string;
  source_manifest_json: string;
  source_sha256: string;
  record_count: number;
  activated_at: string | null;
};

type SyncRunRow = {
  status: "success" | "unchanged" | "failed";
  snapshot_id: string | null;
  checked_at: string;
  message: string;
};

type SourceCountRow = {
  source_key: string;
  record_count: number;
};

type EligibilityStartRow = {
  source_key: string;
  source_record_key: string;
  carried_start: string;
};

export type CreditexReviewedProductCountDecrease = Readonly<{
  reviewedByUid: string;
  governanceIdentityVerified: true;
  reviewNote: string;
  sources: readonly Readonly<{
    sourceKey: string;
    previousRecordCount: number;
    acceptedRecordCount: number;
  }>[];
}>;

type ProductRow = {
  id: string;
  snapshot_id: string;
  registry_code: string;
  snapshot_source_sha256: string;
  source_key: string;
  source_record_key: string;
  product_kind: CreditexOfficialProductKind;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registration_number: string;
  certificate_number: string;
  approval_status: string;
  eligible_from: string;
  eligible_to: string;
  attributes_json: string;
};

type StagedOfficialProductRecord = CreditexOfficialProductRecord & {
  registryEffectiveFrom: string;
};

type CurrentProductVersionRow = {
  source_key: string;
  source_record_key: string;
  product_kind: CreditexOfficialProductKind;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registration_number: string;
  certificate_number: string;
  approval_status: string;
  eligible_from: string;
  eligible_to: string;
  available_in_australia: number;
  attributes_json: string;
  registry_effective_from: string;
};

type FetchedSourceArtifact = {
  source: CreditexOfficialProductSourceDefinition;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
};

type RetainedSourceArtifact = {
  source: CreditexOfficialProductSourceDefinition;
  contentType: string;
  byteLength: number;
  sha256: string;
  recordCount: number;
  objectKey: string;
};

function fail(
  code: ConstructorParameters<typeof CreditexOfficialProductError>[0],
  status: number,
  message: string,
): never {
  throw new CreditexOfficialProductError(code, status, message);
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
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return fail(
    "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
    500,
    "The official product snapshot could not be sealed safely.",
  );
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const exact = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validDate(value: unknown, label: string) {
  const date = String(value || "").trim();
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(date)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      `Enter a valid ${label}.`,
    );
  }
  return date;
}

function parseAttributes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, string | number | boolean | null>;
  } catch {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      503,
      "A stored official product record has invalid attributes.",
    );
  }
}

function cleanText(
  value: unknown,
  label: string,
  maximum: number,
  required = false,
) {
  if (typeof value !== "string") {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `${label} must be text.`,
    );
  }
  const clean = value.trim().replace(/\s+/g, " ");
  if ((required && !clean) || clean.length > maximum) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `${label} is outside the accepted bounds.`,
    );
  }
  return clean;
}

function optionalDate(value: unknown, label: string) {
  const clean = cleanText(value, label, 10);
  if (!clean) return "";
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(clean)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== clean
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `${label} is not a valid ISO date.`,
    );
  }
  return clean;
}

function validateSourceDefinition(
  definition: CreditexOfficialProductRegistryDefinition,
  source: CreditexOfficialProductSourceDefinition,
) {
  if (
    source.registryCode !== definition.registryCode
    || !TOKEN_PATTERN.test(source.registryCode)
    || !TOKEN_PATTERN.test(source.sourceKey)
    || CREDITEX_PRODUCT_KIND_REGISTRY[source.productKind] !== source.registryCode
    || !source.url.startsWith("https://")
    || !Number.isInteger(source.minimumRecords)
    || source.minimumRecords < 1
    || !Number.isInteger(source.maximumBytes)
    || source.maximumBytes < 1
    || source.maximumBytes > 100_000_000
    || source.expectedContentTypes.length === 0
    || source.productionMode !== "automatic"
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      500,
      `Official source ${source.sourceKey} is not enabled for controlled production sync.`,
    );
  }
}

function validateRecords(
  source: CreditexOfficialProductSourceDefinition,
  rawRecords: readonly CreditexOfficialProductRecord[],
) {
  if (rawRecords.length < source.minimumRecords) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      503,
      `Official source ${source.sourceKey} returned ${rawRecords.length} records; at least ${source.minimumRecords} reviewed records are required.`,
    );
  }
  const seen = new Set<string>();
  return rawRecords.map((raw, index): CreditexOfficialProductRecord => {
    const sourceKey = cleanText(raw.sourceKey, `record ${index + 1} sourceKey`, 80, true).toLowerCase();
    const sourceRecordKey = cleanText(raw.sourceRecordKey, `record ${index + 1} sourceRecordKey`, 500, true);
    if (sourceKey !== source.sourceKey || seen.has(sourceRecordKey)) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains a mismatched or duplicate record key.`,
      );
    }
    seen.add(sourceRecordKey);
    if (
      raw.productKind !== source.productKind
      || !CREDITEX_OFFICIAL_PRODUCT_KINDS.includes(raw.productKind)
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains an unexpected product kind.`,
      );
    }
    const eligibleFrom = optionalDate(raw.eligibleFrom, `record ${index + 1} eligibleFrom`);
    const eligibleTo = optionalDate(raw.eligibleTo, `record ${index + 1} eligibleTo`);
    if (eligibleFrom && eligibleTo && eligibleTo < eligibleFrom) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains an inverted approval window.`,
      );
    }
    const approvalStatus = cleanText(
      raw.approvalStatus,
      `record ${index + 1} approvalStatus`,
      80,
      true,
    ).toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
    if (!TOKEN_PATTERN.test(approvalStatus)) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains an invalid approval status.`,
      );
    }
    const attributesJson = canonicalJson(raw.attributes);
    if (attributesJson.length > 65_536) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains oversized product attributes.`,
      );
    }
    return {
      sourceKey,
      sourceRecordKey,
      productKind: raw.productKind,
      manufacturer: cleanText(raw.manufacturer, `record ${index + 1} manufacturer`, 300),
      brand: cleanText(raw.brand, `record ${index + 1} brand`, 300),
      model: cleanText(raw.model, `record ${index + 1} model`, 500, true),
      series: cleanText(raw.series, `record ${index + 1} series`, 300),
      registrationNumber: cleanText(raw.registrationNumber, `record ${index + 1} registrationNumber`, 200),
      certificateNumber: cleanText(raw.certificateNumber, `record ${index + 1} certificateNumber`, 200),
      approvalStatus,
      eligibleFrom,
      eligibleTo,
      availableInAustralia: raw.availableInAustralia === true,
      attributes: raw.attributes,
    };
  });
}

function approvalStatusIsEligible(registryCode: string, status: string) {
  if (registryCode === "gems-products") return status === GEMS_CURRENT_STATUS;
  return !INELIGIBLE_STATUSES.has(status);
}

function eligibilityIdentity(sourceKey: string, sourceRecordKey: string) {
  return `${sourceKey.length}:${sourceKey}|${sourceRecordKey.length}:${sourceRecordKey}`;
}

async function resolveEligibilityStarts(
  db: D1Database,
  registryCode: string,
  records: readonly CreditexOfficialProductRecord[],
  activatedOn: string,
  hasAcceptedSnapshot: boolean,
) {
  const missing = records.filter((record) => !record.eligibleFrom);
  const carriedStarts = new Map<string, string>();
  for (
    let offset = 0;
    hasAcceptedSnapshot && offset < missing.length;
    offset += PRODUCT_LOOKUP_CHUNK
  ) {
    const requested = missing
      .slice(offset, offset + PRODUCT_LOOKUP_CHUNK)
      .map((record) => ({
        sourceKey: record.sourceKey,
        sourceRecordKey: record.sourceRecordKey,
      }));
    const rows = await db.prepare(`WITH requested AS (
        SELECT
          json_extract(value, '$.sourceKey') AS source_key,
          json_extract(value, '$.sourceRecordKey') AS source_record_key
        FROM json_each(?)
      )
      SELECT
        requested.source_key,
        requested.source_record_key,
        min(CASE
          WHEN product.eligible_from <> '' THEN product.eligible_from
          ELSE snapshot.activated_on
        END) AS carried_start
      FROM requested
      JOIN compliance_official_products product
        ON product.source_key = requested.source_key
        AND product.source_record_key = requested.source_record_key
      JOIN compliance_official_product_snapshots snapshot
        ON snapshot.id = product.snapshot_id
      WHERE snapshot.registry_code = ?
        AND snapshot.status IN ('current', 'superseded')
      GROUP BY requested.source_key, requested.source_record_key`)
      .bind(JSON.stringify(requested), registryCode)
      .all<EligibilityStartRow>();
    for (const row of rows.results || []) {
      if (DATE_PATTERN.test(row.carried_start)) {
        carriedStarts.set(
          eligibilityIdentity(row.source_key, row.source_record_key),
          row.carried_start,
        );
      }
    }
  }
  return records.map((record): CreditexOfficialProductRecord => {
    const officialStart = record.eligibleFrom;
    const eligibleFrom = officialStart || carriedStarts.get(
      eligibilityIdentity(record.sourceKey, record.sourceRecordKey),
    ) || activatedOn;
    return {
      ...record,
      eligibleFrom,
      attributes: officialStart ? record.attributes : {
        ...record.attributes,
        creditexEligibleFromBasis: "registry_first_seen",
      },
    };
  });
}

function currentProductVersionMatches(
  record: CreditexOfficialProductRecord,
  current: CurrentProductVersionRow,
) {
  return record.sourceKey === current.source_key
    && record.sourceRecordKey === current.source_record_key
    && record.productKind === current.product_kind
    && record.manufacturer === current.manufacturer
    && record.brand === current.brand
    && record.model === current.model
    && record.series === current.series
    && record.registrationNumber === current.registration_number
    && record.certificateNumber === current.certificate_number
    && record.approvalStatus === current.approval_status
    && record.eligibleFrom === current.eligible_from
    && record.eligibleTo === current.eligible_to
    && record.availableInAustralia === (current.available_in_australia === 1)
    && canonicalJson(record.attributes) === current.attributes_json;
}

async function resolveRegistryEffectiveStarts(
  db: D1Database,
  currentSnapshotId: string | null,
  records: readonly CreditexOfficialProductRecord[],
  activatedOn: string,
): Promise<readonly StagedOfficialProductRecord[]> {
  if (!currentSnapshotId) {
    return records.map((record) => ({
      ...record,
      registryEffectiveFrom:
        record.attributes.creditexEligibleFromBasis === "registry_first_seen"
          ? activatedOn
          : record.eligibleFrom || activatedOn,
    }));
  }
  const currentVersions = new Map<string, CurrentProductVersionRow>();
  for (let offset = 0; offset < records.length; offset += PRODUCT_LOOKUP_CHUNK) {
    const requested = records
      .slice(offset, offset + PRODUCT_LOOKUP_CHUNK)
      .map((record) => ({
        sourceKey: record.sourceKey,
        sourceRecordKey: record.sourceRecordKey,
      }));
    const rows = await db.prepare(`WITH requested AS (
        SELECT
          json_extract(value, '$.sourceKey') AS source_key,
          json_extract(value, '$.sourceRecordKey') AS source_record_key
        FROM json_each(?)
      )
      SELECT
        product.source_key, product.source_record_key, product.product_kind,
        product.manufacturer, product.brand, product.model, product.series,
        product.registration_number, product.certificate_number,
        product.approval_status, product.eligible_from, product.eligible_to,
        product.available_in_australia, product.attributes_json,
        product.registry_effective_from
      FROM compliance_official_products product
      JOIN requested
        ON requested.source_key = product.source_key
        AND requested.source_record_key = product.source_record_key
      WHERE product.snapshot_id = ?`)
      .bind(JSON.stringify(requested), currentSnapshotId)
      .all<CurrentProductVersionRow>();
    for (const row of rows.results || []) {
      currentVersions.set(
        eligibilityIdentity(row.source_key, row.source_record_key),
        row,
      );
    }
  }
  return records.map((record) => {
    const current = currentVersions.get(eligibilityIdentity(
      record.sourceKey,
      record.sourceRecordKey,
    ));
    return {
      ...record,
      registryEffectiveFrom: current && currentProductVersionMatches(record, current)
        ? current.registry_effective_from
        : activatedOn,
    };
  });
}

type SourceCountDecrease = Readonly<{
  sourceKey: string;
  previousRecordCount: number;
  acceptedRecordCount: number;
}>;

function validateReviewedCountDecrease(
  review: CreditexReviewedProductCountDecrease | undefined,
  decreases: readonly SourceCountDecrease[],
) {
  if (decreases.length === 0) {
    if (review) {
      return fail(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "A reviewed count decrease may only be supplied when a source count decreased.",
      );
    }
    return null;
  }
  if (!review) {
    const summary = decreases.map((decrease) => (
      `${decrease.sourceKey}:${decrease.previousRecordCount}->${decrease.acceptedRecordCount}`
    )).join(", ");
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION",
      503,
      `Official source counts decreased (${summary}). Exact reviewed approval is required.`,
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
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
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
  if (
    reviewedSources.length !== decreases.length
    || new Set(reviewedSources.map(({ sourceKey }) => sourceKey)).size
      !== reviewedSources.length
    || reviewedSources.some((source) => (
      !TOKEN_PATTERN.test(source.sourceKey)
      || !Number.isSafeInteger(source.previousRecordCount)
      || !Number.isSafeInteger(source.acceptedRecordCount)
      || source.previousRecordCount <= source.acceptedRecordCount
      || source.acceptedRecordCount < 1
    ))
    || canonicalJson(reviewedSources) !== canonicalJson(
      [...decreases].sort((left, right) => (
        left.sourceKey.localeCompare(right.sourceKey)
      )),
    )
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION",
      409,
      "The reviewed source counts do not exactly match the observed decrease.",
    );
  }
  return {
    reviewedByUid,
    reviewNote,
    sources: reviewedSources,
  };
}

async function boundedResponseBytes(
  response: Response,
  source: CreditexOfficialProductSourceDefinition,
) {
  if (!response.body) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${source.sourceKey} returned no body.`,
    );
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > source.maximumBytes) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE",
      502,
      `Official source ${source.sourceKey} exceeded its size limit.`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > source.maximumBytes) {
      await reader.cancel().catch(() => undefined);
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE",
        502,
        `Official source ${source.sourceKey} exceeded its size limit.`,
      );
    }
    chunks.push(value);
  }
  if (total === 0) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${source.sourceKey} returned an empty body.`,
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

async function fetchSourceBytes(
  definition: CreditexOfficialProductRegistryDefinition,
  source: CreditexOfficialProductSourceDefinition,
  fetchImpl: FetchLike,
): Promise<FetchedSourceArtifact> {
  validateSourceDefinition(definition, source);
  let response: Response;
  try {
    response = await fetchImpl(source.url, {
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: source.accept },
    });
  } catch (error) {
    console.error("Official product source fetch failed.", {
      registryCode: definition.registryCode,
      sourceKey: source.sourceKey,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `Official source ${source.sourceKey} could not be fetched.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `Official source ${source.sourceKey} returned an HTTP redirect.`,
    );
  }
  if (!response.ok) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `Official source ${source.sourceKey} returned HTTP ${response.status}.`,
    );
  }
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!source.expectedContentTypes.includes(contentType)) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${source.sourceKey} returned unexpected content type ${contentType || "none"}.`,
    );
  }
  const bytes = await boundedResponseBytes(response, source);
  return {
    source,
    contentType,
    bytes,
    sha256: await sha256Hex(bytes),
  };
}

function parseSourceRecords(
  source: CreditexOfficialProductSourceDefinition,
  bytes: Uint8Array,
  contentType: string,
) {
  let rawRecords: readonly CreditexOfficialProductRecord[];
  try {
    rawRecords = source.parse(bytes, contentType);
  } catch (error) {
    if (error instanceof CreditexOfficialProductError) throw error;
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${source.sourceKey} could not be parsed against its reviewed schema.`,
    );
  }
  return validateRecords(source, rawRecords);
}

function extension(contentType: string) {
  if (contentType.includes("csv")) return "csv";
  if (contentType.includes("json")) return "json";
  return "bin";
}

function artifactObjectKey(artifact: FetchedSourceArtifact) {
  return `creditex/official-products/${artifact.source.registryCode}/${artifact.source.sourceKey}/${artifact.sha256}.${extension(artifact.contentType)}`;
}

function assertRetainedArtifactHead(
  artifact: Pick<
    RetainedSourceArtifact,
    "source" | "byteLength" | "sha256"
  >,
  retained: Awaited<ReturnType<CreditexOfficialProductArtifactStore["head"]>>,
) {
  if (
    !retained
    || Number(retained.size) !== artifact.byteLength
    || retained.customMetadata?.sha256 !== artifact.sha256
    || retained.customMetadata?.sourceKey !== artifact.source.sourceKey
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED",
      503,
      `Official source ${artifact.source.sourceKey} could not be retained with verified custody.`,
    );
  }
}

async function readRetainedArtifactBytes(
  store: CreditexOfficialProductArtifactStore,
  artifact: Pick<
    RetainedSourceArtifact,
    "source" | "byteLength" | "sha256" | "objectKey"
  >,
) {
  const retained = await store.head(artifact.objectKey).catch(() => null);
  assertRetainedArtifactHead(artifact, retained);
  const body = await store.get(artifact.objectKey).catch(() => null);
  const bytes = body ? new Uint8Array(await body.arrayBuffer()) : null;
  if (
    !bytes
    || bytes.byteLength !== artifact.byteLength
    || await sha256Hex(bytes) !== artifact.sha256
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED",
      503,
      `Retained bytes for ${artifact.source.sourceKey} do not match the official source.`,
    );
  }
  return bytes;
}

async function retainArtifact(
  store: CreditexOfficialProductArtifactStore,
  artifact: FetchedSourceArtifact,
) {
  const objectKey = artifactObjectKey(artifact);
  const existing = await store.head(objectKey);
  if (!existing) {
    await store.put(objectKey, artifact.bytes, {
      httpMetadata: { contentType: artifact.contentType },
      customMetadata: {
        sha256: artifact.sha256,
        sourceKey: artifact.source.sourceKey,
        sourceUrl: artifact.source.url,
        licence: artifact.source.licence,
      },
    });
  }
  const descriptor = {
    source: artifact.source,
    byteLength: artifact.bytes.byteLength,
    sha256: artifact.sha256,
    objectKey,
  };
  await readRetainedArtifactBytes(store, descriptor);
  return objectKey;
}

async function fetchInspectAndRetainSource(
  definition: CreditexOfficialProductRegistryDefinition,
  source: CreditexOfficialProductSourceDefinition,
  fetchImpl: FetchLike,
  store: CreditexOfficialProductArtifactStore,
): Promise<RetainedSourceArtifact> {
  const artifact = await fetchSourceBytes(definition, source, fetchImpl);
  let inspectedRecords: readonly CreditexOfficialProductRecord[] | null = parseSourceRecords(
    artifact.source,
    artifact.bytes,
    artifact.contentType,
  );
  const recordCount = inspectedRecords.length;
  inspectedRecords = null;
  const objectKey = await retainArtifact(store, artifact);
  return {
    source: artifact.source,
    contentType: artifact.contentType,
    byteLength: artifact.bytes.byteLength,
    sha256: artifact.sha256,
    recordCount,
    objectKey,
  };
}

async function loadRetainedSourceRecords(
  store: CreditexOfficialProductArtifactStore,
  artifact: RetainedSourceArtifact,
) {
  const bytes = await readRetainedArtifactBytes(store, artifact);
  return parseSourceRecords(artifact.source, bytes, artifact.contentType);
}

async function acquireLease(
  db: D1Database,
  registryCode: string,
  leaseId: string,
  startedAt: string,
) {
  const expiresAt = new Date(
    new Date(startedAt).getTime() + SYNC_LEASE_MS,
  ).toISOString();
  const result = await db.prepare(`INSERT INTO compliance_official_product_sync_leases (
      registry_code, lease_id, started_at, expires_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(registry_code) DO UPDATE SET
      lease_id = excluded.lease_id,
      started_at = excluded.started_at,
      expires_at = excluded.expires_at
    WHERE compliance_official_product_sync_leases.expires_at <= excluded.started_at`)
    .bind(registryCode, leaseId, startedAt, expiresAt)
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
      409,
      `Official registry ${registryCode} is already refreshing.`,
    );
  }
}

async function releaseLease(
  db: D1Database,
  registryCode: string,
  leaseId: string,
) {
  await db.prepare(`DELETE FROM compliance_official_product_sync_leases
    WHERE registry_code = ? AND lease_id = ?`)
    .bind(registryCode, leaseId)
    .run();
}

async function cleanStagingRows(db: D1Database, registryCode: string) {
  await db.prepare(`DELETE FROM compliance_official_product_snapshots
    WHERE registry_code = ? AND status = 'staging'`)
    .bind(registryCode)
    .run();
}

function pruneUnchangedHistoricalProducts(
  db: D1Database,
  supersededSnapshotId: string,
  currentSnapshotId: string,
) {
  return db.prepare(`DELETE FROM compliance_official_products
    WHERE snapshot_id = ?
      AND EXISTS (
        SELECT 1 FROM compliance_official_products current_product
        WHERE current_product.snapshot_id = ?
          AND current_product.source_key = compliance_official_products.source_key
          AND current_product.source_record_key = compliance_official_products.source_record_key
          AND current_product.product_kind = compliance_official_products.product_kind
          AND current_product.manufacturer = compliance_official_products.manufacturer
          AND current_product.brand = compliance_official_products.brand
          AND current_product.model = compliance_official_products.model
          AND current_product.series = compliance_official_products.series
          AND current_product.registration_number = compliance_official_products.registration_number
          AND current_product.certificate_number = compliance_official_products.certificate_number
          AND current_product.approval_status = compliance_official_products.approval_status
          AND current_product.eligible_from = compliance_official_products.eligible_from
          AND current_product.eligible_to = compliance_official_products.eligible_to
          AND current_product.available_in_australia = compliance_official_products.available_in_australia
          AND current_product.registry_effective_from = compliance_official_products.registry_effective_from
          AND current_product.search_text = compliance_official_products.search_text
          AND current_product.attributes_json = compliance_official_products.attributes_json
      )`)
    .bind(supersededSnapshotId, currentSnapshotId);
}

async function insertProductChunks(
  db: D1Database,
  snapshotId: string,
  records: readonly StagedOfficialProductRecord[],
) {
  let pendingStatements: D1PreparedStatement[] = [];
  let pendingBindBytes = 0;
  const flushPendingStatements = async () => {
    if (pendingStatements.length === 0) {
      return;
    }
    const statements = pendingStatements;
    pendingStatements = [];
    pendingBindBytes = 0;
    await db.batch(statements);
  };
  const queueRows = async (
    serializedRows: readonly string[],
    payloadBytes: number,
  ) => {
    const payload = `[${serializedRows.join(",")}]`;
    if (
      pendingStatements.length > 0
      && (
        pendingStatements.length >= PRODUCT_INSERT_BATCH_MAX_STATEMENTS
        || pendingBindBytes + payloadBytes
          > PRODUCT_INSERT_BATCH_MAX_BIND_BYTES
      )
    ) {
      await flushPendingStatements();
    }
    pendingStatements.push(db.prepare(`INSERT INTO compliance_official_products (
      id, snapshot_id, source_key, source_record_key, product_kind,
      manufacturer, brand, model, series, registration_number,
      certificate_number, approval_status, eligible_from, eligible_to,
      available_in_australia, registry_effective_from, search_text,
      attributes_json
    ) SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.snapshotId'),
      json_extract(value, '$.sourceKey'),
      json_extract(value, '$.sourceRecordKey'),
      json_extract(value, '$.productKind'),
      json_extract(value, '$.manufacturer'),
      json_extract(value, '$.brand'),
      json_extract(value, '$.model'),
      json_extract(value, '$.series'),
      json_extract(value, '$.registrationNumber'),
      json_extract(value, '$.certificateNumber'),
      json_extract(value, '$.approvalStatus'),
      json_extract(value, '$.eligibleFrom'),
      json_extract(value, '$.eligibleTo'),
      json_extract(value, '$.availableInAustralia'),
      json_extract(value, '$.registryEffectiveFrom'),
      json_extract(value, '$.searchText'),
      json_extract(value, '$.attributesJson')
    FROM json_each(?)`)
      .bind(payload));
    pendingBindBytes += payloadBytes;
  };
  const encoder = new TextEncoder();
  let serializedRows: string[] = [];
  let payloadBytes = 2;
  for (const record of records) {
    const attributesJson = canonicalJson(record.attributes);
    const searchText = [
      record.manufacturer,
      record.brand,
      record.model,
      record.series,
      record.registrationNumber,
      record.certificateNumber,
    ].filter(Boolean).join(" ").toLowerCase();
    const serializedRow = JSON.stringify({
      id: `${snapshotId}:${record.sourceKey}:${record.sourceRecordKey}`,
      snapshotId,
      sourceKey: record.sourceKey,
      sourceRecordKey: record.sourceRecordKey,
      productKind: record.productKind,
      manufacturer: record.manufacturer,
      brand: record.brand,
      model: record.model,
      series: record.series,
      registrationNumber: record.registrationNumber,
      certificateNumber: record.certificateNumber,
      approvalStatus: record.approvalStatus,
      eligibleFrom: record.eligibleFrom,
      eligibleTo: record.eligibleTo,
      availableInAustralia: record.availableInAustralia ? 1 : 0,
      registryEffectiveFrom: record.registryEffectiveFrom,
      searchText,
      attributesJson,
    });
    const serializedRowBytes = encoder.encode(serializedRow).byteLength;
    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (
      serializedRows.length > 0
      && (
        serializedRows.length >= PRODUCT_INSERT_MAX_ROWS
        || payloadBytes + separatorBytes + serializedRowBytes
          > PRODUCT_INSERT_MAX_BIND_BYTES
      )
    ) {
      await queueRows(serializedRows, payloadBytes);
      serializedRows = [];
      payloadBytes = 2;
    }
    if (serializedRowBytes + 2 > PRODUCT_INSERT_MAX_BIND_BYTES) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${record.sourceKey} contains an oversized staged product record.`,
      );
    }
    serializedRows.push(serializedRow);
    payloadBytes += (serializedRows.length === 1 ? 0 : 1) + serializedRowBytes;
  }
  if (serializedRows.length > 0) {
    await queueRows(serializedRows, payloadBytes);
  }
  await flushPendingStatements();
}

async function recordFailure(
  db: D1Database,
  registryCode: string,
  checkedAt: string,
  message: string,
) {
  await db.prepare(`INSERT INTO compliance_official_product_sync_runs (
    id, registry_code, status, snapshot_id, source_manifest_json,
    source_sha256, record_count, checked_at, message
  ) VALUES (?, ?, 'failed', NULL, NULL, NULL, 0, ?, ?)`)
    .bind(crypto.randomUUID(), registryCode, checkedAt, message.slice(0, 500))
    .run();
}

export async function syncOfficialProductRegistry(
  db: D1Database,
  definition: CreditexOfficialProductRegistryDefinition,
  options: {
    artifactStore?: CreditexOfficialProductArtifactStore;
    fetchImpl?: FetchLike;
    now?: Date;
    reviewedCountDecrease?: CreditexReviewedProductCountDecrease;
  } = {},
) {
  await ensureCreditexProductRegistrySchemaGuards(db);
  if (
    !TOKEN_PATTERN.test(definition.registryCode)
    || definition.sources.length < 1
    || definition.sources.length > 100
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      500,
      "The official registry definition is invalid.",
    );
  }
  const checkedAt = (options.now || new Date()).toISOString();
  const checkedOn = australianRegulatorDate(checkedAt);
  const fetchImpl = options.fetchImpl || fetch;
  const leaseId = crypto.randomUUID();
  let leaseAcquired = false;
  let stagingSnapshotId = "";
  try {
    await acquireLease(db, definition.registryCode, leaseId, checkedAt);
    leaseAcquired = true;
    await cleanStagingRows(db, definition.registryCode);
    if (!options.artifactStore) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_CUSTODY_UNAVAILABLE",
        503,
        "Immutable official source storage is unavailable.",
      );
    }
    // Phase one keeps only compact, custody-verified receipts. Parsed records and
    // source bytes leave scope before the next official source is requested.
    const artifacts: RetainedSourceArtifact[] = [];
    for (const source of definition.sources) {
      artifacts.push(await fetchInspectAndRetainSource(
        definition,
        source,
        fetchImpl,
        options.artifactStore,
      ));
    }
    const recordCount = artifacts.reduce(
      (total, artifact) => total + artifact.recordCount,
      0,
    );
    const current = await db.prepare(`SELECT
      id, source_manifest_json, source_sha256, record_count, activated_at
      FROM compliance_official_product_snapshots
      WHERE registry_code = ? AND status = 'current' LIMIT 1`)
      .bind(definition.registryCode)
      .first<SnapshotRow>();
    const decreases: SourceCountDecrease[] = [];
    if (current) {
      const previousCounts = await db.prepare(`SELECT source_key, record_count
        FROM compliance_official_product_artifacts WHERE snapshot_id = ?`)
        .bind(current.id)
        .all<SourceCountRow>();
      const counts = new Map(
        (previousCounts.results || []).map((row) => [
          row.source_key,
          Number(row.record_count),
        ]),
      );
      for (const artifact of artifacts) {
        const previous = counts.get(artifact.source.sourceKey);
        if (previous !== undefined && artifact.recordCount < previous) {
          decreases.push({
            sourceKey: artifact.source.sourceKey,
            previousRecordCount: previous,
            acceptedRecordCount: artifact.recordCount,
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
          contract: "creditex-reviewed-product-count-decrease/v1",
          reviewedAt: checkedAt,
          ...acceptedDecreaseReview,
        })
      : "";
    if (reviewAuditMessage.length > 2_000) {
      return fail(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "The reviewed source decrease audit exceeds its bounded storage limit.",
      );
    }
    const manifest = {
      contract: CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT,
      registryCode: definition.registryCode,
      title: definition.title,
      sources: artifacts.map((artifact) => ({
        sourceKey: artifact.source.sourceKey,
        productKind: artifact.source.productKind,
        url: artifact.source.url,
        contentType: artifact.contentType,
        byteLength: artifact.byteLength,
        recordCount: artifact.recordCount,
        sha256: artifact.sha256,
        objectKey: artifact.objectKey,
        licence: artifact.source.licence,
      })),
    };
    const sourceManifestJson = canonicalJson(manifest);
    const sourceSha256 = await sha256Hex(sourceManifestJson);
    if (current?.source_sha256 === sourceSha256) {
      await db.prepare(`INSERT INTO compliance_official_product_sync_runs (
        id, registry_code, status, snapshot_id, source_manifest_json,
        source_sha256, record_count, checked_at, message
      ) VALUES (?, ?, 'unchanged', ?, ?, ?, ?, ?, '')`)
        .bind(
          crypto.randomUUID(),
          definition.registryCode,
          current.id,
          sourceManifestJson,
          sourceSha256,
          recordCount,
          checkedAt,
        )
        .run();
      return {
        changed: false,
        registryCode: definition.registryCode,
        snapshotId: current.id,
        sourceSha256,
        recordCount,
        checkedAt,
      };
    }
    stagingSnapshotId = crypto.randomUUID();
    await db.prepare(`INSERT INTO compliance_official_product_snapshots (
      id, registry_code, contract, source_manifest_json, source_sha256,
      source_count, record_count, status, created_at, activated_at, activated_on,
      superseded_at, superseded_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'staging', ?, NULL, NULL, NULL, NULL)`)
      .bind(
        stagingSnapshotId,
        definition.registryCode,
        CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT,
        sourceManifestJson,
        sourceSha256,
        artifacts.length,
        recordCount,
        checkedAt,
      )
      .run();
    // Phase two replays each exact R2 artifact independently into the staging
    // snapshot. The current snapshot is not changed until every replay reconciles.
    for (const artifact of artifacts) {
      let records: readonly CreditexOfficialProductRecord[] | null = await loadRetainedSourceRecords(
        options.artifactStore,
        artifact,
      );
      if (records.length !== artifact.recordCount) {
        return fail(
          "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
          500,
          `Retained source ${artifact.source.sourceKey} no longer matches its inspected record count.`,
        );
      }
      records = await resolveEligibilityStarts(
        db,
        definition.registryCode,
        records,
        checkedOn,
        current !== null,
      );
      let stagedRecords: readonly StagedOfficialProductRecord[] | null =
        await resolveRegistryEffectiveStarts(
          db,
          current?.id || null,
          records,
          checkedOn,
        );
      records = null;
      await db.prepare(`INSERT INTO compliance_official_product_artifacts (
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
          artifact.byteLength,
          artifact.recordCount,
          artifact.objectKey,
          checkedAt,
        )
        .run();
      await insertProductChunks(db, stagingSnapshotId, stagedRecords);
      stagedRecords = null;
    }
    const inserted = await db.prepare(`SELECT count(*) AS count
      FROM compliance_official_products WHERE snapshot_id = ?`)
      .bind(stagingSnapshotId)
      .first<{ count: number }>();
    if (Number(inserted?.count || 0) !== recordCount) {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        "The staged official product count did not reconcile.",
      );
    }
    const activationStatements = [
      db.prepare(`UPDATE compliance_official_product_snapshots
        SET status = 'superseded', superseded_at = ?, superseded_on = ?
        WHERE registry_code = ? AND status = 'current'`)
        .bind(checkedAt, checkedOn, definition.registryCode),
      db.prepare(`UPDATE compliance_official_product_snapshots
        SET status = 'current', activated_at = ?, activated_on = ?,
          superseded_at = NULL, superseded_on = NULL
        WHERE id = ? AND registry_code = ? AND status = 'staging'`)
        .bind(
          checkedAt,
          checkedOn,
          stagingSnapshotId,
          definition.registryCode,
        ),
    ];
    if (current) {
      activationStatements.push(pruneUnchangedHistoricalProducts(
        db,
        current.id,
        stagingSnapshotId,
      ));
    }
    activationStatements.push(
      db.prepare(`INSERT INTO compliance_official_product_sync_runs (
        id, registry_code, status, snapshot_id, source_manifest_json,
        source_sha256, record_count, checked_at, message
      ) VALUES (?, ?, 'success', ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          definition.registryCode,
          stagingSnapshotId,
          sourceManifestJson,
          sourceSha256,
          recordCount,
          checkedAt,
          reviewAuditMessage,
        ),
    );
    await db.batch(activationStatements);
    await cleanStagingRows(db, definition.registryCode);
    return {
      changed: true,
      registryCode: definition.registryCode,
      snapshotId: stagingSnapshotId,
      sourceSha256,
      recordCount,
      checkedAt,
      reviewedCountDecrease: acceptedDecreaseReview !== null,
    };
  } catch (error) {
    if (stagingSnapshotId) {
      await db.prepare(`DELETE FROM compliance_official_product_snapshots
        WHERE id = ? AND status = 'staging'`)
        .bind(stagingSnapshotId)
        .run()
        .catch(() => undefined);
    }
    if (leaseAcquired) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "Unknown official product registry refresh error.";
      await recordFailure(
        db,
        definition.registryCode,
        checkedAt,
        message,
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseLease(db, definition.registryCode, leaseId)
        .catch(() => undefined);
    }
  }
}

export async function loadOfficialProductRegistryStatus(
  db: D1Database,
  registryCode: string,
  options: { now?: Date } = {},
): Promise<CreditexOfficialProductRegistryStatus> {
  await ensureCreditexProductRegistrySchemaGuards(db);
  const now = options.now || new Date();
  const [snapshot, lastSuccessfulCheck, lastAttempt] = await Promise.all([
    db.prepare(`SELECT id, source_manifest_json, source_sha256, record_count,
      activated_at FROM compliance_official_product_snapshots
      WHERE registry_code = ? AND status = 'current' LIMIT 1`)
      .bind(registryCode).first<SnapshotRow>(),
    db.prepare(`SELECT status, snapshot_id, checked_at, message
      FROM compliance_official_product_sync_runs
      WHERE registry_code = ? AND status IN ('success', 'unchanged')
      ORDER BY checked_at DESC, rowid DESC LIMIT 1`)
      .bind(registryCode).first<SyncRunRow>(),
    db.prepare(`SELECT status, snapshot_id, checked_at, message
      FROM compliance_official_product_sync_runs
      WHERE registry_code = ? ORDER BY checked_at DESC, rowid DESC LIMIT 1`)
      .bind(registryCode).first<SyncRunRow>(),
  ]);
  const lastCheckedAt = lastSuccessfulCheck?.checked_at || null;
  const current = Boolean(
    snapshot
    && lastCheckedAt
    && lastAttempt?.status !== "failed"
    && lastAttempt?.snapshot_id === snapshot.id
    && lastSuccessfulCheck?.snapshot_id === snapshot.id
    && now.getTime() - new Date(lastCheckedAt).getTime() <= FRESHNESS_WINDOW_MS,
  );
  return {
    registryCode,
    status: !snapshot ? "unavailable" : current ? "current" : "stale",
    freshnessWindowHours: 48,
    snapshotId: snapshot?.id || null,
    sourceSha256: snapshot?.source_sha256 || null,
    recordCount: Number(snapshot?.record_count || 0),
    lastCheckedAt,
    lastAttempt: lastAttempt ? {
      status: lastAttempt.status,
      checkedAt: lastAttempt.checked_at,
      message: lastAttempt.message,
    } : null,
  };
}

function productKind(value: unknown): CreditexOfficialProductKind {
  const kind = String(value || "") as CreditexOfficialProductKind;
  if (!CREDITEX_OFFICIAL_PRODUCT_KINDS.includes(kind)) {
    return fail(
      "OFFICIAL_PRODUCT_KIND_UNSUPPORTED",
      400,
      "Choose a supported official product type.",
    );
  }
  return kind;
}

function registryFailure(
  status: CreditexOfficialProductRegistryStatus,
): never {
  if (status.status === "unavailable") {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
      503,
      `Official registry ${status.registryCode} has no accepted snapshot.`,
    );
  }
  return fail(
    "OFFICIAL_PRODUCT_REGISTRY_STALE",
    503,
    `Official registry ${status.registryCode} is stale or its latest refresh failed.`,
  );
}

function productSelectionId(sourceKey: string, sourceRecordKey: string) {
  return `${PRODUCT_SELECTION_ID_PREFIX}${sourceKey.length}:${sourceKey}${sourceRecordKey}`;
}

function parseProductSelectionId(value: string) {
  if (!value.startsWith(PRODUCT_SELECTION_ID_PREFIX)) return null;
  const payload = value.slice(PRODUCT_SELECTION_ID_PREFIX.length);
  const separator = payload.indexOf(":");
  if (separator < 1 || separator > 3) return null;
  const sourceKeyLength = Number(payload.slice(0, separator));
  if (!Number.isSafeInteger(sourceKeyLength) || sourceKeyLength < 3) return null;
  const sourceKeyStart = separator + 1;
  const sourceKey = payload.slice(
    sourceKeyStart,
    sourceKeyStart + sourceKeyLength,
  );
  const sourceRecordKey = payload.slice(sourceKeyStart + sourceKeyLength);
  if (
    !TOKEN_PATTERN.test(sourceKey)
    || sourceKey.length > 80
    || !sourceRecordKey
    || sourceRecordKey.length > 500
    || productSelectionId(sourceKey, sourceRecordKey) !== value
  ) return null;
  return { sourceKey, sourceRecordKey };
}

function publicProduct(row: ProductRow) {
  return {
    id: productSelectionId(row.source_key, row.source_record_key),
    registryCode: row.registry_code,
    snapshotId: row.snapshot_id,
    sourceKey: row.source_key,
    sourceRecordKey: row.source_record_key,
    productKind: row.product_kind,
    manufacturer: row.manufacturer,
    brand: row.brand,
    model: row.model,
    series: row.series,
    registrationNumber: row.registration_number,
    certificateNumber: row.certificate_number,
    approvalStatus: row.approval_status,
    eligibleFrom: row.eligible_from,
    eligibleTo: row.eligible_to,
    attributes: parseAttributes(row.attributes_json),
    sourceSha256: row.snapshot_source_sha256,
  };
}

export async function searchOfficialProducts(
  db: D1Database,
  input: {
    productKind: unknown;
    installationDate: unknown;
    query?: unknown;
    limit?: unknown;
  },
  options: { now?: Date } = {},
) {
  await ensureCreditexProductRegistrySchemaGuards(db);
  const kind = productKind(input.productKind);
  const installationDate = validDate(input.installationDate, "installation date");
  const registryCode = CREDITEX_PRODUCT_KIND_REGISTRY[kind];
  const status = await loadOfficialProductRegistryStatus(
    db,
    registryCode,
    options,
  );
  if (status.status !== "current") registryFailure(status);
  const query = String(input.query || "").trim().toLowerCase();
  if (query.length > 120) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "Product search text must not exceed 120 characters.",
    );
  }
  const requestedLimit = input.limit === undefined ? 30 : Number(input.limit);
  if (
    !Number.isInteger(requestedLimit)
    || requestedLimit < 1
    || requestedLimit > 100
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "Product search limit must be a whole number from 1 to 100.",
    );
  }
  const limit = requestedLimit;
  const rows = await db.prepare(`SELECT
      product.id, product.snapshot_id, snapshot.registry_code,
      snapshot.source_sha256 AS snapshot_source_sha256,
      product.source_key, product.source_record_key, product.product_kind,
      product.manufacturer, product.brand, product.model, product.series,
      product.registration_number, product.certificate_number,
      product.approval_status, product.eligible_from, product.eligible_to,
      product.attributes_json
    FROM compliance_official_products product
    JOIN compliance_official_product_snapshots snapshot
      ON snapshot.id = product.snapshot_id
    WHERE snapshot.registry_code = ?
      AND snapshot.status IN ('current', 'superseded')
      AND product.product_kind = ?
      AND product.available_in_australia = 1
      AND product.approval_status NOT IN (
        'cancelled', 'ineligible', 'not_approved', 'rejected', 'superseded',
        'unknown', 'withdrawn'
      )
      AND (snapshot.registry_code <> 'gems-products'
        OR product.approval_status = 'approved')
      AND (
        (product.eligible_from <> '' AND product.eligible_from <= ?)
        OR (
          product.eligible_from = ''
          AND snapshot.activated_on <= ?
        )
      )
      AND (product.eligible_to = '' OR product.eligible_to >= ?)
      AND product.registry_effective_from <= ?
      AND (
        snapshot.status = 'current'
        OR snapshot.superseded_on > ?
      )
      AND (? = '' OR instr(product.search_text, ?) > 0)
    ORDER BY product.brand, product.manufacturer, product.model, product.id
    LIMIT ?`)
    .bind(
      registryCode,
      kind,
      installationDate,
      installationDate,
      installationDate,
      installationDate,
      installationDate,
      query,
      query,
      limit,
    )
    .all<ProductRow>();
  return {
    registry: status,
    productKind: kind,
    installationDate,
    products: (rows.results || []).map(publicProduct),
  };
}

export async function validateOfficialProductSelections(
  db: D1Database,
  input: {
    installationDate: unknown;
    requiredKinds: readonly CreditexOfficialProductKind[];
    selectedProductIds: unknown;
  },
  options: { now?: Date } = {},
): Promise<{
  selections: CreditexOfficialProductSelection[];
  registryReceipt: {
    installationDate: string;
    snapshots: Array<{
      registryCode: string;
      snapshotId: string;
      sourceSha256: string;
    }>;
  };
}> {
  await ensureCreditexProductRegistrySchemaGuards(db);
  const installationDate = validDate(input.installationDate, "installation date");
  if (
    !input.selectedProductIds
    || typeof input.selectedProductIds !== "object"
    || Array.isArray(input.selectedProductIds)
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SELECTION_REQUIRED",
      409,
      "Select every required official product before calculating.",
    );
  }
  const selected = input.selectedProductIds as Record<string, unknown>;
  const requiredKinds = [...new Set(input.requiredKinds)];
  const exactKeys = Object.keys(selected).sort();
  const expectedKeys = [...requiredKinds].sort();
  if (
    exactKeys.length !== expectedKeys.length
    || exactKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SELECTION_REQUIRED",
      409,
      "Select exactly one official product for every required product type.",
    );
  }
  const statuses = new Map<string, CreditexOfficialProductRegistryStatus>();
  for (const kind of requiredKinds) {
    const registryCode = CREDITEX_PRODUCT_KIND_REGISTRY[kind];
    if (!statuses.has(registryCode)) {
      const status = await loadOfficialProductRegistryStatus(
        db,
        registryCode,
        options,
      );
      if (status.status !== "current") registryFailure(status);
      statuses.set(registryCode, status);
    }
  }
  const selections: CreditexOfficialProductSelection[] = [];
  for (const kind of requiredKinds) {
    const id = String(selected[kind] || "").trim();
    const selectedIdentity = id.length <= 640
      ? parseProductSelectionId(id)
      : null;
    if (!selectedIdentity) {
      return fail(
        "OFFICIAL_PRODUCT_SELECTION_REQUIRED",
        409,
        `Select an official ${kind.replaceAll("_", " ")}.`,
      );
    }
    const status = statuses.get(CREDITEX_PRODUCT_KIND_REGISTRY[kind]);
    const row = await db.prepare(`SELECT
        product.id, product.snapshot_id, snapshot.registry_code,
        snapshot.source_sha256 AS snapshot_source_sha256,
        product.source_key, product.source_record_key, product.product_kind,
        product.manufacturer, product.brand, product.model, product.series,
        product.registration_number, product.certificate_number,
        product.approval_status, product.eligible_from, product.eligible_to,
        product.attributes_json
      FROM compliance_official_products product
      JOIN compliance_official_product_snapshots snapshot
        ON snapshot.id = product.snapshot_id
      WHERE product.source_key = ?
        AND product.source_record_key = ?
        AND snapshot.registry_code = ?
        AND snapshot.status IN ('current', 'superseded')
        AND product.product_kind = ? AND product.available_in_australia = 1
        AND (
          (product.eligible_from <> '' AND product.eligible_from <= ?)
          OR (
            product.eligible_from = ''
            AND snapshot.activated_on <= ?
          )
        )
        AND (product.eligible_to = '' OR product.eligible_to >= ?)
        AND product.registry_effective_from <= ?
        AND (
          snapshot.status = 'current'
          OR snapshot.superseded_on > ?
        )
      LIMIT 1`)
      .bind(
        selectedIdentity.sourceKey,
        selectedIdentity.sourceRecordKey,
        status?.registryCode,
        kind,
        installationDate,
        installationDate,
        installationDate,
        installationDate,
        installationDate,
      )
      .first<ProductRow>();
    if (!row || !approvalStatusIsEligible(
      row.registry_code,
      row.approval_status,
    )) {
      return fail(
        "OFFICIAL_PRODUCT_NOT_ELIGIBLE",
        409,
        `The selected ${kind.replaceAll("_", " ")} is not eligible in the official registry history for ${installationDate}.`,
      );
    }
    const item = publicProduct(row);
    selections.push({
      id: item.id,
      registryCode: item.registryCode,
      snapshotId: item.snapshotId,
      sourceKey: item.sourceKey,
      sourceRecordKey: item.sourceRecordKey,
      productKind: item.productKind,
      manufacturer: item.manufacturer,
      brand: item.brand,
      model: item.model,
      series: item.series,
      registrationNumber: item.registrationNumber,
      certificateNumber: item.certificateNumber,
      approvalStatus: item.approvalStatus,
      eligibleFrom: item.eligibleFrom,
      eligibleTo: item.eligibleTo,
      attributes: item.attributes,
      sourceSha256: item.sourceSha256,
    });
  }
  return {
    selections,
    registryReceipt: {
      installationDate,
      snapshots: [...new Map(selections.map((selection) => [
        `${selection.registryCode}:${selection.snapshotId}`,
        {
          registryCode: selection.registryCode,
          snapshotId: selection.snapshotId,
          sourceSha256: selection.sourceSha256,
        },
      ])).values()].sort((left, right) => (
        left.registryCode.localeCompare(right.registryCode)
        || left.snapshotId.localeCompare(right.snapshotId)
      )),
    },
  };
}
