import {
  CREDITEX_OFFICIAL_PRODUCT_BACKGROUND_TIMEOUT_REASON,
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT,
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
  CREDITEX_VEU_ELIGIBLE_HEAT_PUMP_REFRIGERANTS,
  CreditexOfficialProductError,
  officialProductKindsForVeuActivity,
  officialVeuProductCategoryNumbersForActivity,
  type CreditexOfficialProductKind,
  type CreditexOfficialProductRecord,
  type CreditexOfficialProductRegistryStatus,
  type CreditexOfficialProductSelection,
} from "./creditex-official-product-registry.ts";
import { australianRegulatorDate } from "./creditex-australian-regulator-date.ts";
import { ensureCreditexProductRegistrySchemaGuards } from "./creditex-product-registry-schema-guards.ts";

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
const SYNC_LEASE_MS = 3 * 60 * 1000;
const AUTOMATIC_REFRESH_WAIT_MS = 55_000;
const AUTOMATIC_REFRESH_POLL_MS = 2_000;
const AUTOMATIC_REFRESH_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
const OFFICIAL_SOURCE_FETCH_TIMEOUT_MS = 45_000;
const PRODUCT_LOOKUP_CHUNK = 500;
const PRODUCT_INSERT_MAX_ROWS = 500;
const PRODUCT_INSERT_MAX_BIND_BYTES = 1_500_000;
const PRODUCT_INSERT_BATCH_MAX_STATEMENTS = 4;
const PRODUCT_INSERT_BATCH_MAX_BIND_BYTES = 6_000_000;
export const CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET = 25_000;
const OFFICIAL_PRODUCT_REFRESH_REPLAY_CONTRACT =
  "creditex-official-product-refresh-replay/v1";
const STREAMING_QUANTUM_MAX_BATCHES = 4;
const HISTORICAL_CLEANUP_RECORD_BUDGET = 2_000;
const SOURCE_ACQUISITION_FRAGMENT_CLEANUP_BUDGET = 32;
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
const VEU_CURRENT_STATUS = "approved";

export type CreditexOfficialProductFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type CreditexFetchedOfficialProductSource = Readonly<{
  sourceKey: string;
  contentType: string;
  bytes: Uint8Array;
}>;

export type CreditexOfficialProductStreamValue = Readonly<{
  sourceRecordKey: string;
  value: Readonly<Record<string, unknown>>;
}>;

export type CreditexOfficialProductStreamingParser = Readonly<{
  inspect(bytes: Uint8Array, contentType: string): number;
  supplementalBatches(
    bytes: Uint8Array,
    contentType: string,
  ): Iterable<readonly CreditexOfficialProductStreamValue[]>;
  recordBatches(
    bytes: Uint8Array,
    contentType: string,
    loadValues: (
      sourceRecordKeys: readonly string[],
    ) => Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>,
    resume?: Readonly<{
      afterRecordCount: number;
      afterSourceRecordKey: string;
      maximumBatches: number;
    }>,
  ): AsyncIterable<readonly CreditexOfficialProductRecord[]>;
}>;

export type CreditexOfficialProductSourceDefinition = {
  registryCode: string;
  sourceKey: string;
  productKind?: CreditexOfficialProductKind;
  productKinds?: readonly CreditexOfficialProductKind[];
  url: string;
  minimumRecords: number;
  maximumBytes: number;
  expectedContentTypes: readonly string[];
  accept: string;
  licence: string;
  productionMode: "automatic" | "licence_required" | "controlled_manual";
  requiresOfficialEligibleFrom?: boolean;
  parse: (
    bytes: Uint8Array,
    contentType: string,
  ) => readonly CreditexOfficialProductRecord[];
  streamingParser?: CreditexOfficialProductStreamingParser;
};

export type CreditexOfficialProductRegistryDefinition = {
  registryCode: string;
  title: string;
  sources: readonly CreditexOfficialProductSourceDefinition[];
  fetchSources?: (
    fetchImpl: CreditexOfficialProductFetch,
    context?: CreditexOfficialProductSourceAcquisitionContext,
  ) => Promise<
    | readonly CreditexFetchedOfficialProductSource[]
    | CreditexOfficialProductSourceAcquisitionResult
  >;
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
  delete?(key: string): Promise<unknown>;
};

export type CreditexOfficialProductSourceAcquisitionContext = Readonly<{
  database: D1Database;
  artifactStore: CreditexOfficialProductArtifactStore;
  registryCode: string;
  checkedAt: string;
  leaseId: string;
  fleetLeaseId?: string;
  leaseFenceAt: string;
  yieldAt: number;
  signal?: AbortSignal;
}>;

export type CreditexOfficialProductSourceAcquisitionResult =
  | Readonly<{
      complete: false;
      acquisitionId: string;
      recordCount: number;
      stagedRecordCount: number;
    }>
  | Readonly<{
      complete: true;
      acquisitionId?: string;
      cleanupRetainedFragments?: boolean;
      sources: readonly CreditexFetchedOfficialProductSource[];
    }>;

function isOfficialProductSourceAcquisitionResult(
  value:
    | readonly CreditexFetchedOfficialProductSource[]
    | CreditexOfficialProductSourceAcquisitionResult,
): value is CreditexOfficialProductSourceAcquisitionResult {
  return !Array.isArray(value)
    && typeof value === "object"
    && value !== null
    && "complete" in value;
}

export type CreditexControlledProductPermissionArtifact = Readonly<{
  organisationId: string;
  artifactId: string;
  sha256: string;
  objectKey: string;
  sizeBytes: number;
}>;

export async function verifyCreditexControlledProductPermissionArtifact(
  store: CreditexOfficialProductArtifactStore | undefined,
  permission: CreditexControlledProductPermissionArtifact,
) {
  if (!store) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_UNAVAILABLE",
      503,
      "Immutable permission evidence storage is unavailable.",
    );
  }
  const head = await store.head(permission.objectKey).catch(() => null);
  const metadata = head?.customMetadata;
  if (
    !head
    || !Number.isSafeInteger(permission.sizeBytes)
    || permission.sizeBytes < 1
    || Number(head.size) !== permission.sizeBytes
    || metadata?.organisationId !== permission.organisationId
    || metadata?.artifactId !== permission.artifactId
    || metadata?.sha256 !== permission.sha256
    || metadata?.custodyState !== "pending_review"
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED",
      503,
      "The retained controlled-import permission evidence could not be verified.",
    );
  }
  const object = await store.get(permission.objectKey).catch(() => null);
  const bytes = object ? new Uint8Array(await object.arrayBuffer()) : null;
  if (
    !bytes
    || bytes.byteLength !== permission.sizeBytes
    || await sha256Hex(bytes) !== permission.sha256
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED",
      503,
      "The retained controlled-import permission evidence could not be verified.",
    );
  }
}

function withOfficialSourceFetchDeadline(
  fetchImpl: CreditexOfficialProductFetch,
  timeoutMs = OFFICIAL_SOURCE_FETCH_TIMEOUT_MS,
  operationSignal?: AbortSignal,
): CreditexOfficialProductFetch {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const externalSignals = [init.signal, operationSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
    const abortFromExternal = (event: Event) => {
      const signal = event.currentTarget as AbortSignal;
      controller.abort(signal.reason);
    };
    for (const signal of externalSignals) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", abortFromExternal, { once: true });
    }
    const timeout = setTimeout(
      () => controller.abort("official-product-source-timeout"),
      timeoutMs,
    );
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      for (const signal of externalSignals) {
        signal.removeEventListener("abort", abortFromExternal);
      }
    }
  };
}

type SnapshotRow = {
  id: string;
  source_manifest_json: string;
  source_sha256: string;
  record_count: number;
  activated_at: string | null;
};

type StagingSnapshotRow = SnapshotRow & {
  contract: string;
  source_count: number;
  created_at: string;
};

type ArtifactRow = {
  source_key: string;
  source_url: string;
  source_sha256: string;
  content_type: string;
  byte_length: number;
  record_count: number;
  object_key: string;
};

type RefreshProgressPhase =
  | "supplements"
  | "products"
  | "activate"
  | "cleanup";

type RefreshProgressRow = {
  registry_code: string;
  snapshot_id: string;
  replay_contract: string;
  source_index: number;
  source_key: string;
  phase: RefreshProgressPhase;
  supplement_batch_count: number;
  supplement_value_count: number;
  product_batch_count: number;
  product_record_count: number;
  last_product_record_key: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

type SourceAcquisitionProgressRow = {
  acquisition_id: string;
  phase: "pages" | "assemble" | "ready" | "cleanup";
  cleanup_disposition: "restart" | "finish";
  total_record_count: number;
  created_at: string;
};

type PendingOfficialProductRefresh = Readonly<{
  phase: "acquisition" | RefreshProgressPhase;
  snapshotId: string | null;
  sourceSha256: string | null;
  recordCount: number;
  stagedRecordCount: number;
  checkedAt: string;
  postActivationCleanup: boolean;
}>;

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

export type CreditexControlledProductImportReview = Readonly<{
  importedByUid: string;
  governanceIdentityVerified: true;
  permissionArtifactId: string;
  permissionArtifactSha256: string;
  permissionArtifactObjectKey: string;
  permissionReviewDecisionId: string;
  permissionReviewedByUid: string;
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

type ProductFacetRow = {
  value: string;
  match_count: number;
};

type ProductCountRow = {
  match_count: number;
};

type StagedOfficialProductRecord = CreditexOfficialProductRecord & {
  registryEffectiveFrom: string;
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

function assertOfficialProductRefreshActive(
  signal: AbortSignal | undefined,
  registryCode: string,
) {
  if (signal?.aborted) {
    if (signal.reason !== CREDITEX_OFFICIAL_PRODUCT_BACKGROUND_TIMEOUT_REASON) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
        503,
        `Official registry ${registryCode} refresh was cancelled.`,
      );
    }
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_DEADLINE",
      503,
      `Official registry ${registryCode} reached its bounded background deadline.`,
    );
  }
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

function sourceProductKinds(source: CreditexOfficialProductSourceDefinition) {
  const kinds = source.productKinds
    ? [...source.productKinds]
    : source.productKind
      ? [source.productKind]
      : [];
  return kinds;
}

function validateSourceDefinition(
  definition: CreditexOfficialProductRegistryDefinition,
  source: CreditexOfficialProductSourceDefinition,
  controlledImportReview?: CreditexControlledProductImportReview,
  supplied?: CreditexFetchedOfficialProductSource,
) {
  const kinds = sourceProductKinds(source);
  const productionModeAccepted = source.productionMode === "automatic"
    || (
      source.productionMode === "controlled_manual"
      && controlledImportReview?.governanceIdentityVerified === true
      && supplied !== undefined
    );
  if (
    source.registryCode !== definition.registryCode
    || !TOKEN_PATTERN.test(source.registryCode)
    || !TOKEN_PATTERN.test(source.sourceKey)
    || kinds.length < 1
    || kinds.length > CREDITEX_OFFICIAL_PRODUCT_KINDS.length
    || new Set(kinds).size !== kinds.length
    || kinds.some((kind) => (
      !CREDITEX_OFFICIAL_PRODUCT_KINDS.includes(kind)
      || CREDITEX_PRODUCT_KIND_REGISTRY[kind] !== source.registryCode
    ))
    || (source.productKind !== undefined) === (source.productKinds !== undefined)
    || !source.url.startsWith("https://")
    || !Number.isInteger(source.minimumRecords)
    || source.minimumRecords < 1
    || !Number.isInteger(source.maximumBytes)
    || source.maximumBytes < 1
    || source.maximumBytes > 100_000_000
    || source.expectedContentTypes.length === 0
    || !productionModeAccepted
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
  const acceptedKinds = new Set(sourceProductKinds(source));
  const seen = new Set<string>();
  const validateRecord = (
    raw: CreditexOfficialProductRecord,
    index: number,
  ): CreditexOfficialProductRecord => {
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
      !acceptedKinds.has(raw.productKind)
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
    if (
      source.registryCode === "veu-approved-products"
      && (
        ![VEU_CURRENT_STATUS, "legacy"].includes(approvalStatus)
        || (approvalStatus === "legacy" && !eligibleTo)
      )
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} record ${index + 1} has invalid VEU approval status dates.`,
      );
    }
    const invertedOfficialWindow = Boolean(
      eligibleFrom && eligibleTo && eligibleTo < eligibleFrom,
    );
    if (
      invertedOfficialWindow
      && !(
        source.registryCode === "veu-approved-products"
        && approvalStatus === "legacy"
      )
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} contains an inverted approval window.`,
      );
    }
    if (source.requiresOfficialEligibleFrom && !eligibleFrom) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} record ${index + 1} has no official approval start date.`,
      );
    }
    const attributes = invertedOfficialWindow
      ? {
          ...raw.attributes,
          veuOfficialEligibilityWindow: "empty_inverted",
          veuOfficialEffectiveFrom: eligibleFrom,
          veuOfficialEffectiveTo: eligibleTo,
        }
      : raw.attributes;
    const attributesJson = canonicalJson(attributes);
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
      eligibleTo: invertedOfficialWindow ? eligibleFrom : eligibleTo,
      availableInAustralia: invertedOfficialWindow
        ? false
        : raw.availableInAustralia === true,
      attributes,
    };
  };
  if (source.registryCode === "veu-approved-products") {
    // The VEU parser returns a fresh, isolated graph replayed from the retained
    // R2 artifact. Normalise that graph in place after applying every generic
    // trust-boundary check above; copying 75k records would exceed the Worker
    // memory envelope. Other registries retain the established copy path.
    rawRecords.forEach((raw, index) => {
      Object.assign(raw, validateRecord(raw, index));
    });
    seen.clear();
    acceptedKinds.clear();
    return rawRecords;
  }
  return rawRecords.map(validateRecord);
}

function approvalStatusIsEligible(registryCode: string, status: string) {
  if (registryCode === "gems-products") return status === GEMS_CURRENT_STATUS;
  if (registryCode === "veu-approved-products") {
    return status === VEU_CURRENT_STATUS || status === "legacy";
  }
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
  const missing = records.filter((record) => (
    !record.eligibleFrom
    && approvalStatusIsEligible(registryCode, record.approvalStatus)
  ));
  if (missing.length === 0) {
    return records;
  }
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
  // These records are an isolated graph freshly parsed from the retained R2
  // artifact for this staging pass. Enrich that graph in place instead of
  // retaining another full registry copy in the Worker isolate.
  return records.map((record): CreditexOfficialProductRecord => {
    const officialStart = record.eligibleFrom;
    if (
      officialStart
      || !approvalStatusIsEligible(registryCode, record.approvalStatus)
    ) {
      return record;
    }
    const eligibleFrom = officialStart || carriedStarts.get(
      eligibilityIdentity(record.sourceKey, record.sourceRecordKey),
    ) || activatedOn;
    return Object.assign(record, {
      eligibleFrom,
      attributes: {
        ...record.attributes,
        creditexEligibleFromBasis: "registry_first_seen",
      },
    });
  });
}

function resolveRegistryEffectiveStarts(
  records: readonly CreditexOfficialProductRecord[],
  activatedOn: string,
  hasCurrentSnapshot: boolean,
): readonly StagedOfficialProductRecord[] {
  return records.map((record) => Object.assign(record, {
    // For a changed snapshot, the insert statement carries the prior date
    // forward only when the indexed current row is byte-for-byte equivalent.
    // Keeping that comparison in D1 avoids materialising the entire 75k-row
    // VEU snapshot (including attributes JSON) in Worker memory a second time.
    registryEffectiveFrom: hasCurrentSnapshot
      ? activatedOn
      : record.attributes.creditexEligibleFromBasis === "registry_first_seen"
        ? activatedOn
        : record.eligibleFrom || activatedOn,
  }));
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
  fetchImpl: CreditexOfficialProductFetch,
  supplied?: CreditexFetchedOfficialProductSource,
  controlledImportReview?: CreditexControlledProductImportReview,
): Promise<FetchedSourceArtifact> {
  validateSourceDefinition(
    definition,
    source,
    controlledImportReview,
    supplied,
  );
  if (supplied) {
    const contentType = supplied.contentType.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (
      supplied.sourceKey !== source.sourceKey
      || !(supplied.bytes instanceof Uint8Array)
      || supplied.bytes.byteLength < 1
      || supplied.bytes.byteLength > source.maximumBytes
      || !source.expectedContentTypes.includes(contentType)
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${source.sourceKey} returned an invalid acquired artifact.`,
      );
    }
    return {
      source,
      contentType,
      bytes: supplied.bytes,
      sha256: await sha256Hex(supplied.bytes),
    };
  }
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
    || retained.customMetadata?.sourceUrl !== artifact.source.url
    || retained.customMetadata?.licence !== artifact.source.licence
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
  const retainedMetadata = {
    sha256: artifact.sha256,
    sourceKey: artifact.source.sourceKey,
    sourceUrl: artifact.source.url,
    licence: artifact.source.licence,
  };
  const existing = await store.head(objectKey);
  const metadataMatches = existing
    && Number(existing.size) === artifact.bytes.byteLength
    && existing.customMetadata?.sha256 === retainedMetadata.sha256
    && existing.customMetadata?.sourceKey === retainedMetadata.sourceKey
    && existing.customMetadata?.sourceUrl === retainedMetadata.sourceUrl
    && existing.customMetadata?.licence === retainedMetadata.licence;
  if (!metadataMatches) {
    await store.put(objectKey, artifact.bytes, {
      httpMetadata: { contentType: artifact.contentType },
      customMetadata: retainedMetadata,
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
  fetchImpl: CreditexOfficialProductFetch,
  store: CreditexOfficialProductArtifactStore,
  supplied?: CreditexFetchedOfficialProductSource,
  controlledImportReview?: CreditexControlledProductImportReview,
): Promise<RetainedSourceArtifact> {
  const artifact = await fetchSourceBytes(
    definition,
    source,
    fetchImpl,
    supplied,
    controlledImportReview,
  );
  const recordCount = artifact.source.streamingParser
    ? artifact.source.streamingParser.inspect(
        artifact.bytes,
        artifact.contentType,
      )
    : parseSourceRecords(
        artifact.source,
        artifact.bytes,
        artifact.contentType,
      ).length;
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

type AcquiredRegistrySourceArtifacts =
  | Extract<CreditexOfficialProductSourceAcquisitionResult, { complete: false }>
  | Readonly<{
      complete: true;
      acquisitionId?: string;
      cleanupRetainedFragments?: boolean;
      sources: Map<string, CreditexFetchedOfficialProductSource>;
    }>;

async function acquireRegistrySourceArtifacts(
  definition: CreditexOfficialProductRegistryDefinition,
  fetchImpl: CreditexOfficialProductFetch,
  context: CreditexOfficialProductSourceAcquisitionContext,
): Promise<AcquiredRegistrySourceArtifacts | null> {
  if (!definition.fetchSources) return null;
  let result:
    | readonly CreditexFetchedOfficialProductSource[]
    | CreditexOfficialProductSourceAcquisitionResult;
  try {
    result = await definition.fetchSources(fetchImpl, context);
  } catch (error) {
    if (error instanceof CreditexOfficialProductError) throw error;
    if (
      context.signal?.aborted
      && context.signal.reason
        === CREDITEX_OFFICIAL_PRODUCT_BACKGROUND_TIMEOUT_REASON
    ) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_DEADLINE",
        503,
        `Official registry ${definition.registryCode} reached its bounded background deadline.`,
      );
    }
    console.error("Official product registry acquisition failed.", {
      registryCode: definition.registryCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
      502,
      `Official registry ${definition.registryCode} could not be acquired.`,
    );
  }
  if (
    isOfficialProductSourceAcquisitionResult(result)
    && result.complete === false
  ) return result;
  const acquired = isOfficialProductSourceAcquisitionResult(result)
    ? result.sources
    : result;
  const acquisitionId = isOfficialProductSourceAcquisitionResult(result)
    ? result.acquisitionId
    : undefined;
  const cleanupRetainedFragments = isOfficialProductSourceAcquisitionResult(result)
    ? result.cleanupRetainedFragments
    : undefined;
  if (
    acquired.length !== definition.sources.length
    || new Set(acquired.map(({ sourceKey }) => sourceKey)).size
      !== acquired.length
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official registry ${definition.registryCode} returned an incomplete artifact set.`,
    );
  }
  const bySource = new Map(acquired.map((artifact) => [
    artifact.sourceKey,
    artifact,
  ]));
  if (definition.sources.some((source) => !bySource.has(source.sourceKey))) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official registry ${definition.registryCode} returned an unexpected artifact set.`,
    );
  }
  return {
    complete: true as const,
    acquisitionId,
    cleanupRetainedFragments,
    sources: bySource,
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
  fleetLeaseId?: string,
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
    WHERE compliance_official_product_sync_leases.expires_at <= excluded.started_at
      OR (
        compliance_official_product_sync_leases.lease_id <> excluded.lease_id
        AND ? <> '' AND EXISTS (
        SELECT 1 FROM compliance_official_product_sync_leases AS fleet
        WHERE fleet.registry_code = ?
          AND fleet.lease_id = ?
          AND fleet.expires_at > excluded.started_at
        )
      )`)
    .bind(
      registryCode,
      leaseId,
      startedAt,
      expiresAt,
      fleetLeaseId || "",
      CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
      fleetLeaseId || "",
    )
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

async function renewLease(
  db: D1Database,
  registryCode: string,
  leaseId: string,
  leaseStartedAt: string,
) {
  const now = new Date(Math.max(Date.now(), Date.parse(leaseStartedAt)));
  const expiresAt = new Date(now.getTime() + SYNC_LEASE_MS).toISOString();
  const result = await db.prepare(`UPDATE compliance_official_product_sync_leases
    SET expires_at = ?
    WHERE registry_code = ? AND lease_id = ?`)
    .bind(expiresAt, registryCode, leaseId)
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
      409,
      `Official registry ${registryCode} refresh ownership was lost.`,
    );
  }
}

async function cleanStagingRows(db: D1Database, registryCode: string) {
  await db.prepare(`DELETE FROM compliance_official_product_snapshots
    WHERE registry_code = ? AND status = 'staging'`)
    .bind(registryCode)
    .run();
}

type ResumableStagingSnapshot = Readonly<{
  snapshot: StagingSnapshotRow;
  artifacts: readonly RetainedSourceArtifact[];
}>;

async function loadResumableStagingSnapshot(
  db: D1Database,
  definition: CreditexOfficialProductRegistryDefinition,
  current: SnapshotRow | null,
): Promise<ResumableStagingSnapshot | null> {
  const staging = await db.prepare(`SELECT id, contract, source_manifest_json,
      source_sha256, source_count, record_count, created_at, activated_at
    FROM compliance_official_product_snapshots
    WHERE registry_code = ? AND status = 'staging'
    ORDER BY created_at DESC, id DESC LIMIT 2`)
    .bind(definition.registryCode)
    .all<StagingSnapshotRow>();
  const rows = staging.results || [];
  if (rows.length === 0) return null;
  const snapshot = rows[0];
  const createdAt = Date.parse(snapshot.created_at);
  let manifest: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(snapshot.source_manifest_json) as unknown;
    manifest = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    manifest = null;
  }
  const sourceManifestSha = manifest
    ? await sha256Hex(canonicalJson(manifest))
    : "";
  const manifestSources = Array.isArray(manifest?.sources)
    ? manifest.sources as readonly unknown[]
    : [];
  const artifacts = await db.prepare(`SELECT source_key, source_url,
      source_sha256, content_type, byte_length, record_count, object_key
    FROM compliance_official_product_artifacts
    WHERE snapshot_id = ? ORDER BY source_key`)
    .bind(snapshot.id)
    .all<ArtifactRow>();
  const artifactRows = artifacts.results || [];
  const artifactBySource = new Map(
    artifactRows.map((artifact) => [artifact.source_key, artifact]),
  );
  const manifestBySource = new Map<string, Record<string, unknown>>();
  for (const value of manifestSources) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const source = value as Record<string, unknown>;
    if (typeof source.sourceKey === "string") {
      manifestBySource.set(source.sourceKey, source);
    }
  }
  const retained: RetainedSourceArtifact[] = [];
  let valid = rows.length === 1
    && Number.isFinite(createdAt)
    && snapshot.contract === CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT
    && snapshot.activated_at === null
    && snapshot.source_count === definition.sources.length
    && snapshot.record_count > 0
    && sourceManifestSha === snapshot.source_sha256
    && manifest?.contract === CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT
    && manifest?.registryCode === definition.registryCode
    && manifest?.title === definition.title
    && manifestSources.length === definition.sources.length
    && artifactRows.length === definition.sources.length;
  for (const source of definition.sources) {
    const artifact = artifactBySource.get(source.sourceKey);
    const manifestSource = manifestBySource.get(source.sourceKey);
    const expectedProductIdentity = source.productKind
      ? { productKind: source.productKind }
      : { productKinds: source.productKinds };
    if (
      !artifact
      || !manifestSource
      || manifestSource.url !== source.url
      || manifestSource.licence !== source.licence
      || canonicalJson(
          source.productKind
            ? { productKind: manifestSource.productKind }
            : { productKinds: manifestSource.productKinds },
        ) !== canonicalJson(expectedProductIdentity)
      || manifestSource.contentType !== artifact.content_type
      || manifestSource.byteLength !== artifact.byte_length
      || manifestSource.recordCount !== artifact.record_count
      || manifestSource.sha256 !== artifact.source_sha256
      || manifestSource.objectKey !== artifact.object_key
      || artifact.source_url !== source.url
      || !source.expectedContentTypes.includes(artifact.content_type)
      || artifact.byte_length < 1
      || artifact.byte_length > source.maximumBytes
      || artifact.record_count < source.minimumRecords
    ) {
      valid = false;
      continue;
    }
    retained.push({
      source,
      contentType: artifact.content_type,
      byteLength: artifact.byte_length,
      sha256: artifact.source_sha256,
      recordCount: artifact.record_count,
      objectKey: artifact.object_key,
    });
  }
  if (valid && current) {
    const previous = await db.prepare(`SELECT source_key, record_count
      FROM compliance_official_product_artifacts WHERE snapshot_id = ?`)
      .bind(current.id)
      .all<SourceCountRow>();
    const previousCounts = new Map(
      (previous.results || []).map((row) => [
        row.source_key,
        Number(row.record_count),
      ]),
    );
    valid = retained.every((artifact) => {
      const previousCount = previousCounts.get(artifact.source.sourceKey);
      return previousCount === undefined
        || artifact.recordCount >= previousCount;
    });
  }
  if (!valid || retained.length !== definition.sources.length) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official registry ${definition.registryCode} retained refresh progress could not be verified.`,
    );
  }
  return { snapshot, artifacts: retained };
}

type ProductInsertFence = Readonly<{
  registryCode: string;
  sourceKey: string;
  revision: number;
  leaseId: string;
  fleetLeaseId?: string;
  leaseFenceAt: string;
}>;

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

function buildProductInsertStatements(
  db: D1Database,
  snapshotId: string,
  currentSnapshotId: string | null,
  records: readonly StagedOfficialProductRecord[],
  fence?: ProductInsertFence,
) {
  const pending: Array<Readonly<{
    statement: D1PreparedStatement;
    rowCount: number;
    bindBytes: number;
  }>> = [];
  const queueRows = (
    serializedRows: readonly string[],
    payloadBytes: number,
  ) => {
    const payload = `[${serializedRows.join(",")}]`;
    const statement = db.prepare(`INSERT INTO compliance_official_products (
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
      CASE
        WHEN previous_product.snapshot_id IS NOT NULL
          AND previous_product.product_kind = json_extract(value, '$.productKind')
          AND previous_product.manufacturer = json_extract(value, '$.manufacturer')
          AND previous_product.brand = json_extract(value, '$.brand')
          AND previous_product.model = json_extract(value, '$.model')
          AND previous_product.series = json_extract(value, '$.series')
          AND previous_product.registration_number = json_extract(value, '$.registrationNumber')
          AND previous_product.certificate_number = json_extract(value, '$.certificateNumber')
          AND previous_product.approval_status = json_extract(value, '$.approvalStatus')
          AND previous_product.eligible_from = json_extract(value, '$.eligibleFrom')
          AND previous_product.eligible_to = json_extract(value, '$.eligibleTo')
          AND previous_product.available_in_australia = json_extract(value, '$.availableInAustralia')
          AND previous_product.attributes_json = json_extract(value, '$.attributesJson')
        THEN previous_product.registry_effective_from
        ELSE json_extract(value, '$.registryEffectiveFrom')
      END,
      json_extract(value, '$.searchText'),
      json_extract(value, '$.attributesJson')
    FROM json_each(?) staged
    LEFT JOIN compliance_official_products previous_product
      ON previous_product.snapshot_id = ?
      AND previous_product.source_key = json_extract(value, '$.sourceKey')
      AND previous_product.source_record_key = json_extract(value, '$.sourceRecordKey')
    WHERE (? = '' OR (
      EXISTS (
        SELECT 1 FROM compliance_official_product_refresh_progress progress
        WHERE progress.registry_code = ?
          AND progress.snapshot_id = ?
          AND progress.source_key = ?
          AND progress.phase = 'products'
          AND progress.revision = ?
      )
      AND EXISTS (
        SELECT 1 FROM compliance_official_product_sync_leases inner_lease
        WHERE inner_lease.registry_code = ?
          AND inner_lease.lease_id = ?
          AND inner_lease.expires_at > ?
      )
      AND (? = '' OR EXISTS (
        SELECT 1 FROM compliance_official_product_sync_leases fleet
        WHERE fleet.registry_code = ?
          AND fleet.lease_id = ?
          AND fleet.expires_at > ?
      ))
    ))`)
      .bind(
        payload,
        currentSnapshotId || "",
        fence?.registryCode || "",
        fence?.registryCode || "",
        snapshotId,
        fence?.sourceKey || "",
        fence?.revision || 0,
        fence?.registryCode || "",
        fence?.leaseId || "",
        fence?.leaseFenceAt || "",
        fence?.fleetLeaseId || "",
        CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
        fence?.fleetLeaseId || "",
        fence?.leaseFenceAt || "",
      );
    pending.push({
      statement,
      rowCount: serializedRows.length,
      bindBytes: payloadBytes,
    });
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
      queueRows(serializedRows, payloadBytes);
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
    queueRows(serializedRows, payloadBytes);
  }
  return pending;
}

async function insertProductChunks(
  db: D1Database,
  snapshotId: string,
  currentSnapshotId: string | null,
  records: readonly StagedOfficialProductRecord[],
) {
  const pending = buildProductInsertStatements(
    db,
    snapshotId,
    currentSnapshotId,
    records,
  );
  for (let offset = 0; offset < pending.length; offset += PRODUCT_INSERT_BATCH_MAX_STATEMENTS) {
    const batch = pending.slice(offset, offset + PRODUCT_INSERT_BATCH_MAX_STATEMENTS);
    const bindBytes = batch.reduce((total, item) => total + item.bindBytes, 0);
    if (bindBytes > PRODUCT_INSERT_BATCH_MAX_BIND_BYTES) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        "Official product staging exceeded its bounded transaction size.",
      );
    }
    await db.batch(batch.map((item) => item.statement));
  }
}

async function loadRefreshProgress(
  db: D1Database,
  registryCode: string,
) {
  return db.prepare(`SELECT registry_code, snapshot_id, replay_contract,
      source_index, source_key, phase, supplement_batch_count,
      supplement_value_count, product_batch_count, product_record_count,
      last_product_record_key, revision, created_at, updated_at
    FROM compliance_official_product_refresh_progress
    WHERE registry_code = ?`)
    .bind(registryCode)
    .first<RefreshProgressRow>();
}

export async function hasPendingCreditexOfficialProductRefresh(
  db: D1Database,
  registryCode: string,
) {
  await ensureCreditexProductRegistrySchemaGuards(db);
  return Boolean(await loadPendingOfficialProductRefresh(db, registryCode));
}

async function loadPendingOfficialProductRefresh(
  db: D1Database,
  registryCode: string,
): Promise<PendingOfficialProductRefresh | null> {
  const [
    progress,
    acquisition,
    acquisitionProducts,
    current,
    currentReceipt,
  ] = await Promise.all([
    loadRefreshProgress(db, registryCode),
    db.prepare(`SELECT acquisition_id, phase, cleanup_disposition,
        total_record_count, created_at
      FROM compliance_official_product_source_acquisitions
      WHERE registry_code = ?`)
      .bind(registryCode)
      .first<SourceAcquisitionProgressRow>(),
    db.prepare(`SELECT stream.record_count
      FROM compliance_official_product_source_acquisition_streams stream
      INNER JOIN compliance_official_product_source_acquisitions acquisition
        ON acquisition.acquisition_id = stream.acquisition_id
      WHERE acquisition.registry_code = ? AND stream.stream_index = 0`)
      .bind(registryCode)
      .first<{ record_count: number }>(),
    db.prepare(`SELECT id, source_manifest_json, source_sha256, record_count,
        activated_at
      FROM compliance_official_product_snapshots
      WHERE registry_code = ? AND status = 'current' LIMIT 1`)
      .bind(registryCode)
      .first<SnapshotRow>(),
    db.prepare(`SELECT run.checked_at
      FROM compliance_official_product_sync_runs run
      INNER JOIN compliance_official_product_snapshots snapshot
        ON snapshot.id = run.snapshot_id
      WHERE run.registry_code = ? AND run.status IN ('success', 'unchanged')
        AND snapshot.status = 'current'
      ORDER BY run.checked_at DESC, run.rowid DESC LIMIT 1`)
      .bind(registryCode)
      .first<{ checked_at: string }>(),
  ]);
  const currentReceiptCovers = (since: string) => Boolean(
    currentReceipt
    && Number.isFinite(Date.parse(currentReceipt.checked_at))
    && Number.isFinite(Date.parse(since))
    && Date.parse(currentReceipt.checked_at) >= Date.parse(since)
  );
  if (progress) {
    const snapshot = progress.snapshot_id === current?.id
      ? current
      : await db.prepare(`SELECT id, source_manifest_json, source_sha256,
          record_count, activated_at
        FROM compliance_official_product_snapshots WHERE id = ?`)
        .bind(progress.snapshot_id)
        .first<SnapshotRow>();
    return {
      phase: progress.phase,
      snapshotId: progress.snapshot_id,
      sourceSha256: snapshot?.source_sha256 || null,
      recordCount: Number(snapshot?.record_count || 0),
      stagedRecordCount: progress.product_record_count,
      checkedAt: progress.created_at,
      postActivationCleanup: progress.phase === "cleanup"
        && progress.snapshot_id === current?.id
        && currentReceiptCovers(progress.created_at),
    };
  }
  if (!acquisition) return null;
  return {
    phase: acquisition.phase === "cleanup" ? "cleanup" : "acquisition",
    snapshotId: current?.id || null,
    sourceSha256: current?.source_sha256 || null,
    recordCount: Number(acquisition.total_record_count),
    stagedRecordCount: Number(acquisitionProducts?.record_count || 0),
    checkedAt: acquisition.created_at,
    postActivationCleanup: acquisition.phase === "cleanup"
      && acquisition.cleanup_disposition === "finish"
      && currentReceiptCovers(acquisition.created_at),
  };
}

function validatedStreamValues(
  sourceKey: string,
  batch: readonly CreditexOfficialProductStreamValue[],
) {
  if (batch.length < 1 || batch.length > PRODUCT_INSERT_MAX_ROWS) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${sourceKey} returned an invalid stream batch.`,
    );
  }
  const seen = new Set<string>();
  return batch.map((item) => {
    const sourceRecordKey = cleanText(
      item.sourceRecordKey,
      "stream value sourceRecordKey",
      500,
      true,
    );
    const valueJson = canonicalJson(item.value);
    if (seen.has(sourceRecordKey) || valueJson.length > 65_536) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${sourceKey} returned duplicate or oversized stream values.`,
      );
    }
    seen.add(sourceRecordKey);
    return { sourceRecordKey, value: item.value };
  });
}

function refreshOwnershipPredicate() {
  return `EXISTS (
      SELECT 1 FROM compliance_official_product_sync_leases inner_lease
      WHERE inner_lease.registry_code = ?
        AND inner_lease.lease_id = ?
        AND inner_lease.expires_at > ?
    ) AND (? = '' OR EXISTS (
      SELECT 1 FROM compliance_official_product_sync_leases fleet
      WHERE fleet.registry_code = ?
        AND fleet.lease_id = ?
        AND fleet.expires_at > ?
    ))`;
}

function refreshOwnershipBindings(input: Readonly<{
  registryCode: string;
  leaseId: string;
  fleetLeaseId?: string;
  leaseFenceAt: string;
}>) {
  return [
    input.registryCode,
    input.leaseId,
    input.leaseFenceAt,
    input.fleetLeaseId || "",
    CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
    input.fleetLeaseId || "",
    input.leaseFenceAt,
  ] as const;
}

type SourceAcquisitionCleanupRow = Readonly<{
  acquisition_id: string;
  cleanup_disposition: "restart" | "finish";
  revision: number;
}>;

async function loadSourceAcquisitionCleanup(
  db: D1Database,
  registryCode: string,
) {
  return db.prepare(`SELECT acquisition_id, cleanup_disposition, revision
    FROM compliance_official_product_source_acquisitions
    WHERE registry_code = ? AND phase = 'cleanup'`)
    .bind(registryCode)
    .first<SourceAcquisitionCleanupRow>();
}

async function cleanupRetainedSourceAcquisition(
  db: D1Database,
  artifactStore: CreditexOfficialProductArtifactStore,
  registryCode: string,
  acquisition: SourceAcquisitionCleanupRow,
  input: Readonly<{
    leaseId: string;
    fleetLeaseId?: string;
    leaseFenceAt: string;
  }>,
) {
  if (!artifactStore.delete) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_CUSTODY_UNAVAILABLE",
      503,
      `Official registry ${registryCode} cannot clean retained acquisition fragments.`,
    );
  }
  const selected = await db.prepare(`SELECT object_key
    FROM compliance_official_product_source_acquisition_fragments
    WHERE acquisition_id = ? ORDER BY kind, stream_index, fragment_index
    LIMIT ?`)
    .bind(
      acquisition.acquisition_id,
      SOURCE_ACQUISITION_FRAGMENT_CLEANUP_BUDGET,
    )
    .all<{ object_key: string }>();
  const objectKeys = (selected.results || []).map((row) => row.object_key);
  await Promise.all(objectKeys.map((objectKey) => artifactStore.delete!(objectKey)));
  if (objectKeys.length > 0) {
    const result = await db.prepare(`DELETE FROM
        compliance_official_product_source_acquisition_fragments
      WHERE acquisition_id = ?
        AND object_key IN (SELECT value FROM json_each(?))
        AND ${refreshOwnershipPredicate()}`)
      .bind(
        acquisition.acquisition_id,
        canonicalJson(objectKeys),
        ...refreshOwnershipBindings({ registryCode, ...input }),
      )
      .run();
    if (Number(result.meta?.changes || 0) !== objectKeys.length) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        `Official registry ${registryCode} fragment cleanup ownership was lost.`,
      );
    }
  }
  const remaining = await db.prepare(`SELECT count(*) remaining_count
    FROM compliance_official_product_source_acquisition_fragments
    WHERE acquisition_id = ?`)
    .bind(acquisition.acquisition_id)
    .first<{ remaining_count: number }>();
  if (Number(remaining?.remaining_count || 0) > 0) {
    return { complete: false as const, disposition: acquisition.cleanup_disposition };
  }
  const deleted = await db.prepare(`DELETE FROM
      compliance_official_product_source_acquisitions
    WHERE registry_code = ? AND acquisition_id = ? AND phase = 'cleanup'
      AND revision = ? AND ${refreshOwnershipPredicate()}`)
    .bind(
      registryCode,
      acquisition.acquisition_id,
      acquisition.revision,
      ...refreshOwnershipBindings({ registryCode, ...input }),
    )
    .run();
  if (Number(deleted.meta?.changes || 0) !== 1) {
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
      409,
      `Official registry ${registryCode} fragment cleanup ownership was lost.`,
    );
  }
  return { complete: true as const, disposition: acquisition.cleanup_disposition };
}

async function loadStreamingValues(
  db: D1Database,
  snapshotId: string,
  sourceKey: string,
  sourceRecordKeys: readonly string[],
) {
  if (
    sourceRecordKeys.length < 1
    || sourceRecordKeys.length > PRODUCT_INSERT_MAX_ROWS
  ) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      502,
      `Official source ${sourceKey} requested an invalid stream lookup.`,
    );
  }
  const rows = await db.prepare(`WITH requested AS (
      SELECT value source_record_key FROM json_each(?)
    ) SELECT staged.source_record_key, staged.value_json
    FROM requested
    JOIN compliance_official_product_stream_values staged
      ON staged.snapshot_id = ?
      AND staged.source_key = ?
      AND staged.source_record_key = requested.source_record_key`)
    .bind(canonicalJson(sourceRecordKeys), snapshotId, sourceKey)
    .all<{ source_record_key: string; value_json: string }>();
  const values = new Map<string, Readonly<Record<string, unknown>>>();
  for (const row of rows.results || []) {
    const value = parseAttributes(row.value_json);
    values.set(row.source_record_key, value);
  }
  return values;
}

async function bootstrapLegacyRefreshProgress(
  db: D1Database,
  artifact: RetainedSourceArtifact,
  snapshotId: string,
  sourceIndex: number,
  bytes: Uint8Array,
  sourceCheckedAt: string,
  operationAt: string,
) {
  const parser = artifact.source.streamingParser;
  if (!parser) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      500,
      `Official source ${artifact.source.sourceKey} has no stream parser.`,
    );
  }
  const [streamCountRow, productCountRow, lastProduct] = await Promise.all([
    db.prepare(`SELECT count(*) AS count
      FROM compliance_official_product_stream_values
      WHERE snapshot_id = ? AND source_key = ?`)
      .bind(snapshotId, artifact.source.sourceKey)
      .first<{ count: number }>(),
    db.prepare(`SELECT count(*) AS count FROM compliance_official_products
      WHERE snapshot_id = ? AND source_key = ?`)
      .bind(snapshotId, artifact.source.sourceKey)
      .first<{ count: number }>(),
    db.prepare(`SELECT source_record_key FROM compliance_official_products
      WHERE snapshot_id = ? AND source_key = ?
      ORDER BY rowid DESC LIMIT 1`)
      .bind(snapshotId, artifact.source.sourceKey)
      .first<{ source_record_key: string }>(),
  ]);
  const streamCount = Number(streamCountRow?.count || 0);
  const productCount = Number(productCountRow?.count || 0);
  if (
    !Number.isSafeInteger(streamCount)
    || streamCount < 0
    || !Number.isSafeInteger(productCount)
    || productCount < 0
    || productCount > artifact.recordCount
    || (
      productCount !== artifact.recordCount
      && productCount % PRODUCT_INSERT_MAX_ROWS !== 0
    )
    || Boolean(lastProduct?.source_record_key) !== (productCount > 0)
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official source ${artifact.source.sourceKey} legacy replay boundary is invalid.`,
    );
  }
  let supplementValueCount = 0;
  let streamBoundaryMatched = streamCount === 0;
  for (const batch of parser.supplementalBatches(bytes, artifact.contentType)) {
    const values = validatedStreamValues(artifact.source.sourceKey, batch);
    supplementValueCount += values.length;
    if (supplementValueCount === streamCount) streamBoundaryMatched = true;
    if (supplementValueCount > streamCount && !streamBoundaryMatched) break;
  }
  const completeSupplementValueCount = supplementValueCount;
  if (
    !streamBoundaryMatched
    || streamCount > completeSupplementValueCount
    || (productCount > 0 && streamCount !== completeSupplementValueCount)
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official source ${artifact.source.sourceKey} legacy supplement boundary is invalid.`,
    );
  }
  let retainedSupplementBatches = 0;
  let retainedSupplementValues = 0;
  if (streamCount > 0) {
    for (const batch of parser.supplementalBatches(bytes, artifact.contentType)) {
      retainedSupplementBatches += 1;
      retainedSupplementValues += batch.length;
      if (retainedSupplementValues >= streamCount) break;
    }
  }
  const phase: RefreshProgressPhase = streamCount < completeSupplementValueCount
    ? "supplements"
    : productCount === artifact.recordCount
      ? "activate"
      : "products";
  const lastProductRecordKey = lastProduct?.source_record_key || "";
  if (productCount > 0) {
    await parser.recordBatches(
      bytes,
      artifact.contentType,
      (sourceRecordKeys) => loadStreamingValues(
        db,
        snapshotId,
        artifact.source.sourceKey,
        sourceRecordKeys,
      ),
      {
        afterRecordCount: productCount,
        afterSourceRecordKey: lastProductRecordKey,
        maximumBatches: 1,
      },
    )[Symbol.asyncIterator]().next();
  }
  await db.prepare(`INSERT INTO compliance_official_product_refresh_progress (
      registry_code, snapshot_id, replay_contract, source_index, source_key,
      phase, supplement_batch_count, supplement_value_count,
      product_batch_count, product_record_count, last_product_record_key,
      revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(
      artifact.source.registryCode,
      snapshotId,
      OFFICIAL_PRODUCT_REFRESH_REPLAY_CONTRACT,
      sourceIndex,
      artifact.source.sourceKey,
      phase,
      retainedSupplementBatches,
      retainedSupplementValues,
      Math.ceil(productCount / PRODUCT_INSERT_MAX_ROWS),
      productCount,
      lastProductRecordKey,
      sourceCheckedAt,
      operationAt,
    )
    .run();
  return loadRefreshProgress(db, artifact.source.registryCode);
}

async function stageSupplementQuantum(
  db: D1Database,
  parser: CreditexOfficialProductStreamingParser,
  bytes: Uint8Array,
  artifact: RetainedSourceArtifact,
  progress: RefreshProgressRow,
  input: Readonly<{
    checkedAt: string;
    leaseId: string;
    fleetLeaseId?: string;
    leaseFenceAt: string;
    maximumRecords: number;
    signal?: AbortSignal;
  }>,
) {
  const selected: Array<readonly ReturnType<typeof validatedStreamValues>[number][]> = [];
  let batchIndex = 0;
  let priorValueCount = 0;
  let hasMore = false;
  const maximumBatches = Math.max(
    1,
    Math.ceil(input.maximumRecords / PRODUCT_INSERT_MAX_ROWS),
  );
  for (const batch of parser.supplementalBatches(bytes, artifact.contentType)) {
    assertOfficialProductRefreshActive(
      input.signal,
      artifact.source.registryCode,
    );
    const values = validatedStreamValues(artifact.source.sourceKey, batch);
    if (batchIndex < progress.supplement_batch_count) {
      priorValueCount += values.length;
      batchIndex += 1;
      continue;
    }
    if (selected.length >= maximumBatches) {
      hasMore = true;
      break;
    }
    selected.push(values);
    batchIndex += 1;
  }
  if (priorValueCount !== progress.supplement_value_count) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official source ${artifact.source.sourceKey} supplement cursor changed.`,
    );
  }
  if (selected.length === 0) {
    if (hasMore) {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        `Official source ${artifact.source.sourceKey} supplement replay stalled.`,
      );
    }
    const result = await db.prepare(`UPDATE compliance_official_product_refresh_progress
      SET phase = 'products', revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND snapshot_id = ? AND source_key = ?
        AND phase = 'supplements' AND revision = ?
        AND ${refreshOwnershipPredicate()}`)
      .bind(
        input.checkedAt,
        progress.registry_code,
        progress.snapshot_id,
        progress.source_key,
        progress.revision,
        ...refreshOwnershipBindings({
          registryCode: progress.registry_code,
          leaseId: input.leaseId,
          fleetLeaseId: input.fleetLeaseId,
          leaseFenceAt: input.leaseFenceAt,
        }),
      )
      .run();
    if (Number(result.meta?.changes || 0) !== 1) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        `Official registry ${progress.registry_code} refresh ownership was lost.`,
      );
    }
    return loadRefreshProgress(db, progress.registry_code);
  }
  let next = progress;
  for (let offset = 0; offset < selected.length; offset += STREAMING_QUANTUM_MAX_BATCHES) {
    assertOfficialProductRefreshActive(
      input.signal,
      artifact.source.registryCode,
    );
    const quantum = selected.slice(offset, offset + STREAMING_QUANTUM_MAX_BATCHES);
    const statements = quantum.map((values) => db.prepare(`INSERT INTO
        compliance_official_product_stream_values (
          snapshot_id, source_key, source_record_key, value_json, created_at
        ) SELECT ?, ?, json_extract(value, '$.sourceRecordKey'),
          json_extract(value, '$.value'), ?
        FROM json_each(?)
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_refresh_progress progress
          WHERE progress.registry_code = ? AND progress.snapshot_id = ?
            AND progress.source_key = ? AND progress.phase = 'supplements'
            AND progress.revision = ?
        ) AND ${refreshOwnershipPredicate()}`)
      .bind(
        next.snapshot_id,
        next.source_key,
        input.checkedAt,
        canonicalJson(values),
        next.registry_code,
        next.snapshot_id,
        next.source_key,
        next.revision,
        ...refreshOwnershipBindings({
          registryCode: next.registry_code,
          leaseId: input.leaseId,
          fleetLeaseId: input.fleetLeaseId,
          leaseFenceAt: input.leaseFenceAt,
        }),
      ));
    const addedValues = quantum.reduce((total, values) => total + values.length, 0);
    const finalQuantum = offset + quantum.length === selected.length;
    const nextPhase = finalQuantum && !hasMore ? "products" : "supplements";
    statements.push(db.prepare(`UPDATE compliance_official_product_refresh_progress
      SET phase = ?, supplement_batch_count = ?, supplement_value_count = ?,
        revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND snapshot_id = ? AND source_key = ?
        AND phase = 'supplements' AND revision = ?
        AND ${refreshOwnershipPredicate()}`)
      .bind(
        nextPhase,
        next.supplement_batch_count + quantum.length,
        next.supplement_value_count + addedValues,
        input.checkedAt,
        next.registry_code,
        next.snapshot_id,
        next.source_key,
        next.revision,
        ...refreshOwnershipBindings({
          registryCode: next.registry_code,
          leaseId: input.leaseId,
          fleetLeaseId: input.fleetLeaseId,
          leaseFenceAt: input.leaseFenceAt,
        }),
      ));
    const results = await db.batch(statements);
    for (let index = 0; index < quantum.length; index += 1) {
      if (Number(results[index]?.meta?.changes || 0) !== quantum[index].length) {
        return fail(
          "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
          409,
          `Official registry ${next.registry_code} refresh ownership was lost.`,
        );
      }
    }
    if (Number(results[results.length - 1]?.meta?.changes || 0) !== 1) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        `Official registry ${next.registry_code} refresh ownership was lost.`,
      );
    }
    const loaded = await loadRefreshProgress(db, next.registry_code);
    if (!loaded) {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        `Official registry ${next.registry_code} lost its replay progress.`,
      );
    }
    next = loaded;
  }
  return next;
}

async function stageProductQuantum(
  db: D1Database,
  parser: CreditexOfficialProductStreamingParser,
  bytes: Uint8Array,
  artifact: RetainedSourceArtifact,
  currentSnapshotId: string | null,
  activatedOn: string,
  progress: RefreshProgressRow,
  input: Readonly<{
    checkedAt: string;
    leaseId: string;
    fleetLeaseId?: string;
    leaseFenceAt: string;
    maximumRecords: number;
    signal?: AbortSignal;
  }>,
) {
  let next = progress;
  let insertedThisRun = 0;
  let pendingRecords: StagedOfficialProductRecord[] = [];
  let pendingParserBatches = 0;
  const commit = async () => {
    if (pendingRecords.length === 0) return;
    assertOfficialProductRefreshActive(
      input.signal,
      artifact.source.registryCode,
    );
    const records = pendingRecords;
    const parserBatchCount = pendingParserBatches;
    pendingRecords = [];
    pendingParserBatches = 0;
    const fence: ProductInsertFence = {
      registryCode: next.registry_code,
      sourceKey: next.source_key,
      revision: next.revision,
      leaseId: input.leaseId,
      fleetLeaseId: input.fleetLeaseId,
      leaseFenceAt: input.leaseFenceAt,
    };
    const productStatements = buildProductInsertStatements(
      db,
      next.snapshot_id,
      currentSnapshotId,
      records,
      fence,
    );
    const bindBytes = productStatements.reduce(
      (total, item) => total + item.bindBytes,
      0,
    );
    if (
      productStatements.length > PRODUCT_INSERT_BATCH_MAX_STATEMENTS
      || bindBytes > PRODUCT_INSERT_BATCH_MAX_BIND_BYTES
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${artifact.source.sourceKey} exceeded its replay quantum.`,
      );
    }
    const nextRecordCount = next.product_record_count + records.length;
    const nextPhase = nextRecordCount === artifact.recordCount
      ? "activate"
      : "products";
    const lastProductRecordKey = records[records.length - 1].sourceRecordKey;
    const progressStatement = db.prepare(`UPDATE
        compliance_official_product_refresh_progress
      SET phase = ?, product_batch_count = ?, product_record_count = ?,
        last_product_record_key = ?, revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND snapshot_id = ? AND source_key = ?
        AND phase = 'products' AND revision = ?
        AND ${refreshOwnershipPredicate()}`)
      .bind(
        nextPhase,
        next.product_batch_count + parserBatchCount,
        nextRecordCount,
        lastProductRecordKey,
        input.checkedAt,
        next.registry_code,
        next.snapshot_id,
        next.source_key,
        next.revision,
        ...refreshOwnershipBindings({
          registryCode: next.registry_code,
          leaseId: input.leaseId,
          fleetLeaseId: input.fleetLeaseId,
          leaseFenceAt: input.leaseFenceAt,
        }),
      );
    const results = await db.batch([
      ...productStatements.map((item) => item.statement),
      progressStatement,
    ]);
    for (let index = 0; index < productStatements.length; index += 1) {
      if (
        Number(results[index]?.meta?.changes || 0)
          !== productStatements[index].rowCount
      ) {
        return fail(
          "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
          409,
          `Official registry ${next.registry_code} refresh ownership was lost.`,
        );
      }
    }
    if (Number(results[results.length - 1]?.meta?.changes || 0) !== 1) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        `Official registry ${next.registry_code} refresh ownership was lost.`,
      );
    }
    insertedThisRun += records.length;
    const loaded = await loadRefreshProgress(db, next.registry_code);
    if (!loaded) {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        `Official registry ${next.registry_code} lost its replay progress.`,
      );
    }
    next = loaded;
  };
  const maximumBatches = Math.max(
    1,
    Math.ceil(input.maximumRecords / PRODUCT_INSERT_MAX_ROWS),
  );
  for await (const rawBatch of parser.recordBatches(
    bytes,
    artifact.contentType,
    (sourceRecordKeys) => loadStreamingValues(
      db,
      next.snapshot_id,
      artifact.source.sourceKey,
      sourceRecordKeys,
    ),
    {
      afterRecordCount: next.product_record_count,
      afterSourceRecordKey: next.last_product_record_key,
      maximumBatches,
    },
  )) {
    assertOfficialProductRefreshActive(
      input.signal,
      artifact.source.registryCode,
    );
    if (rawBatch.length < 1 || rawBatch.length > PRODUCT_INSERT_MAX_ROWS) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        502,
        `Official source ${artifact.source.sourceKey} returned an invalid product batch.`,
      );
    }
    const validated = validateRecords(
      { ...artifact.source, minimumRecords: 1 },
      rawBatch,
    );
    const resolved = await resolveEligibilityStarts(
      db,
      artifact.source.registryCode,
      validated,
      activatedOn,
      Boolean(currentSnapshotId),
    );
    const staged = resolveRegistryEffectiveStarts(
      resolved,
      activatedOn,
      Boolean(currentSnapshotId),
    );
    const trial = buildProductInsertStatements(
      db,
      next.snapshot_id,
      currentSnapshotId,
      [...pendingRecords, ...staged],
      {
        registryCode: next.registry_code,
        sourceKey: next.source_key,
        revision: next.revision,
        leaseId: input.leaseId,
        fleetLeaseId: input.fleetLeaseId,
        leaseFenceAt: input.leaseFenceAt,
      },
    );
    const trialBytes = trial.reduce((total, item) => total + item.bindBytes, 0);
    if (
      pendingRecords.length > 0
      && (
        trial.length > PRODUCT_INSERT_BATCH_MAX_STATEMENTS
        || trialBytes > PRODUCT_INSERT_BATCH_MAX_BIND_BYTES
      )
    ) {
      await commit();
    }
    pendingRecords.push(...staged);
    pendingParserBatches += 1;
    if (
      pendingParserBatches >= STREAMING_QUANTUM_MAX_BATCHES
      || next.product_record_count + pendingRecords.length
        === artifact.recordCount
    ) {
      await commit();
    }
    if (insertedThisRun >= input.maximumRecords || next.phase === "activate") {
      break;
    }
  }
  await commit();
  if (
    next.product_record_count > artifact.recordCount
    || (
      next.product_record_count === artifact.recordCount
      && next.product_record_count < artifact.source.minimumRecords
    )
    || (next.product_record_count < artifact.recordCount && insertedThisRun === 0)
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official source ${artifact.source.sourceKey} stream count did not reconcile.`,
    );
  }
  return { progress: next, insertedThisRun };
}

async function stageStreamingSource(
  db: D1Database,
  artifactStore: CreditexOfficialProductArtifactStore,
  artifact: RetainedSourceArtifact,
  snapshotId: string,
  sourceIndex: number,
  currentSnapshotId: string | null,
  activatedOn: string,
  sourceCheckedAt: string,
  checkedAt: string,
  maximumRecords: number,
  leaseId: string,
  fleetLeaseId?: string,
  leaseFenceAt = new Date().toISOString(),
  signal?: AbortSignal,
) {
  const parser = artifact.source.streamingParser;
  if (!parser) {
    return fail(
      "OFFICIAL_PRODUCT_SOURCE_INVALID",
      500,
      `Official source ${artifact.source.sourceKey} has no stream parser.`,
    );
  }
  assertOfficialProductRefreshActive(signal, artifact.source.registryCode);
  let bytes: Uint8Array | null = await readRetainedArtifactBytes(
    artifactStore,
    artifact,
  );
  let progress = await loadRefreshProgress(db, artifact.source.registryCode);
  if (!progress) {
    progress = await bootstrapLegacyRefreshProgress(
      db,
      artifact,
      snapshotId,
      sourceIndex,
      bytes,
      sourceCheckedAt,
      checkedAt,
    );
  }
  if (
    !progress
    || progress.snapshot_id !== snapshotId
    || progress.source_index !== sourceIndex
    || progress.source_key !== artifact.source.sourceKey
    || progress.replay_contract !== OFFICIAL_PRODUCT_REFRESH_REPLAY_CONTRACT
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official source ${artifact.source.sourceKey} replay progress changed.`,
    );
  }
  const ownership = {
    checkedAt,
    leaseId,
    fleetLeaseId,
    leaseFenceAt,
    maximumRecords,
    signal,
  };
  if (progress.phase === "supplements") {
    const next = await stageSupplementQuantum(
      db,
      parser,
      bytes,
      artifact,
      progress,
      ownership,
    );
    if (!next) {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        `Official source ${artifact.source.sourceKey} lost supplement progress.`,
      );
    }
    progress = next;
  }
  let insertedThisRun = 0;
  if (progress.phase === "products") {
    const result = await stageProductQuantum(
      db,
      parser,
      bytes,
      artifact,
      currentSnapshotId,
      activatedOn,
      progress,
      ownership,
    );
    progress = result.progress;
    insertedThisRun = result.insertedThisRun;
  }
  bytes = null;
  return {
    complete: progress.phase === "activate",
    phase: progress.phase,
    insertedThisRun,
    recordCount: progress.product_record_count,
  };
}

async function activateOfficialProductStagingSnapshot(
  db: D1Database,
  input: Readonly<{
    registryCode: string;
    stagingSnapshotId: string;
    currentSnapshotId: string | null;
    checkedAt: string;
    checkedOn: string;
    sourceManifestJson: string;
    sourceSha256: string;
    recordCount: number;
    reviewAuditMessage: string;
    leaseId: string;
    fleetLeaseId?: string;
    leaseFenceAt?: string;
    progressRevision?: number;
    operationAt?: string;
  }>,
) {
  const leaseFenceAt = input.leaseFenceAt || new Date().toISOString();
  const activationStatements: D1PreparedStatement[] = [];
  if (input.progressRevision !== undefined) {
    activationStatements.push(db.prepare(`UPDATE
        compliance_official_product_refresh_progress
      SET phase = 'cleanup', revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND snapshot_id = ? AND phase = 'activate'
        AND revision = ? AND ${refreshOwnershipPredicate()}`)
      .bind(
        input.operationAt || leaseFenceAt,
        input.registryCode,
        input.stagingSnapshotId,
        input.progressRevision,
        ...refreshOwnershipBindings({
          registryCode: input.registryCode,
          leaseId: input.leaseId,
          fleetLeaseId: input.fleetLeaseId,
          leaseFenceAt,
        }),
      ));
  }
  activationStatements.push(
    db.prepare(`UPDATE compliance_official_product_snapshots
      SET status = 'superseded', superseded_at = ?, superseded_on = ?
      WHERE registry_code = ? AND status = 'current'`)
      .bind(input.checkedAt, input.checkedOn, input.registryCode),
    db.prepare(`UPDATE compliance_official_product_snapshots
      SET status = 'current', activated_at = ?, activated_on = ?,
        superseded_at = NULL, superseded_on = NULL
      WHERE id = ? AND registry_code = ? AND status = 'staging'
        AND EXISTS (
          SELECT 1 FROM compliance_official_product_sync_leases AS inner_lease
          WHERE inner_lease.registry_code = ?
            AND inner_lease.lease_id = ?
            AND inner_lease.expires_at > ?
        ) AND (? = '' OR EXISTS (
          SELECT 1 FROM compliance_official_product_sync_leases AS fleet
          WHERE fleet.registry_code = ?
            AND fleet.lease_id = ?
            AND fleet.expires_at > ?
        ))`)
      .bind(
        input.checkedAt,
        input.checkedOn,
        input.stagingSnapshotId,
        input.registryCode,
        input.registryCode,
        input.leaseId,
        leaseFenceAt,
        input.fleetLeaseId || "",
        CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
        input.fleetLeaseId || "",
        leaseFenceAt,
      ),
  );
  if (
    input.progressRevision === undefined
    && input.currentSnapshotId
  ) {
    activationStatements.push(pruneUnchangedHistoricalProducts(
      db,
      input.currentSnapshotId,
      input.stagingSnapshotId,
    ));
  }
  activationStatements.push(
    db.prepare(`INSERT INTO compliance_official_product_sync_runs (
      id, registry_code, status, snapshot_id, source_manifest_json,
      source_sha256, record_count, checked_at, message
    ) VALUES (?, ?, 'success', ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        input.registryCode,
        input.stagingSnapshotId,
        input.sourceManifestJson,
        input.sourceSha256,
        input.recordCount,
        input.checkedAt,
        input.reviewAuditMessage,
      ),
  );
  const results = await db.batch(activationStatements);
  if (
    input.progressRevision !== undefined
    && Number(results[0]?.meta?.changes || 0) !== 1
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
      409,
      `Official registry ${input.registryCode} refresh ownership was lost.`,
    );
  }
}

async function cleanupActivatedRefreshProgress(
  db: D1Database,
  progress: RefreshProgressRow,
  input: Readonly<{
    leaseId: string;
    fleetLeaseId?: string;
    leaseFenceAt: string;
  }>,
) {
  if (progress.phase !== "cleanup") {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official registry ${progress.registry_code} cleanup progress is invalid.`,
    );
  }
  const ownership = refreshOwnershipBindings({
    registryCode: progress.registry_code,
    leaseId: input.leaseId,
    fleetLeaseId: input.fleetLeaseId,
    leaseFenceAt: input.leaseFenceAt,
  });
  const removed = await db.prepare(`DELETE FROM compliance_official_products
    WHERE id IN (
      SELECT historical.id
      FROM compliance_official_products historical
      JOIN compliance_official_product_snapshots historical_snapshot
        ON historical_snapshot.id = historical.snapshot_id
        AND historical_snapshot.registry_code = ?
        AND historical_snapshot.status = 'superseded'
      WHERE EXISTS (
        SELECT 1 FROM compliance_official_products current_product
        WHERE current_product.snapshot_id = ?
          AND current_product.source_key = historical.source_key
          AND current_product.source_record_key = historical.source_record_key
          AND current_product.product_kind = historical.product_kind
          AND current_product.manufacturer = historical.manufacturer
          AND current_product.brand = historical.brand
          AND current_product.model = historical.model
          AND current_product.series = historical.series
          AND current_product.registration_number = historical.registration_number
          AND current_product.certificate_number = historical.certificate_number
          AND current_product.approval_status = historical.approval_status
          AND current_product.eligible_from = historical.eligible_from
          AND current_product.eligible_to = historical.eligible_to
          AND current_product.available_in_australia = historical.available_in_australia
          AND current_product.registry_effective_from = historical.registry_effective_from
          AND current_product.search_text = historical.search_text
          AND current_product.attributes_json = historical.attributes_json
      )
      LIMIT ?
    ) AND ${refreshOwnershipPredicate()}`)
    .bind(
      progress.registry_code,
      progress.snapshot_id,
      HISTORICAL_CLEANUP_RECORD_BUDGET,
      ...ownership,
    )
    .run();
  const removedCount = Number(removed.meta?.changes || 0);
  if (removedCount >= HISTORICAL_CLEANUP_RECORD_BUDGET) {
    return { complete: false as const, removedCount };
  }
  const remaining = await db.prepare(`SELECT count(*) AS count
    FROM compliance_official_products historical
    JOIN compliance_official_product_snapshots historical_snapshot
      ON historical_snapshot.id = historical.snapshot_id
      AND historical_snapshot.registry_code = ?
      AND historical_snapshot.status = 'superseded'
    WHERE EXISTS (
      SELECT 1 FROM compliance_official_products current_product
      WHERE current_product.snapshot_id = ?
        AND current_product.source_key = historical.source_key
        AND current_product.source_record_key = historical.source_record_key
        AND current_product.product_kind = historical.product_kind
        AND current_product.manufacturer = historical.manufacturer
        AND current_product.brand = historical.brand
        AND current_product.model = historical.model
        AND current_product.series = historical.series
        AND current_product.registration_number = historical.registration_number
        AND current_product.certificate_number = historical.certificate_number
        AND current_product.approval_status = historical.approval_status
        AND current_product.eligible_from = historical.eligible_from
        AND current_product.eligible_to = historical.eligible_to
        AND current_product.available_in_australia = historical.available_in_australia
        AND current_product.registry_effective_from = historical.registry_effective_from
        AND current_product.search_text = historical.search_text
        AND current_product.attributes_json = historical.attributes_json
    )`)
    .bind(progress.registry_code, progress.snapshot_id)
    .first<{ count: number }>();
  if (Number(remaining?.count || 0) > 0) {
    return { complete: false as const, removedCount };
  }
  const results = await db.batch([
    db.prepare(`DELETE FROM compliance_official_product_stream_values
      WHERE snapshot_id = ? AND ${refreshOwnershipPredicate()}`)
      .bind(progress.snapshot_id, ...ownership),
    db.prepare(`DELETE FROM compliance_official_product_refresh_progress
      WHERE registry_code = ? AND snapshot_id = ? AND phase = 'cleanup'
        AND ${refreshOwnershipPredicate()}`)
      .bind(
        progress.registry_code,
        progress.snapshot_id,
        ...ownership,
      ),
  ]);
  if (Number(results[1]?.meta?.changes || 0) !== 1) {
    return fail(
      "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
      409,
      `Official registry ${progress.registry_code} refresh ownership was lost.`,
    );
  }
  return { complete: true as const, removedCount };
}

async function continueResumableStagingSnapshot(
  db: D1Database,
  artifactStore: CreditexOfficialProductArtifactStore,
  definition: CreditexOfficialProductRegistryDefinition,
  staging: ResumableStagingSnapshot,
  current: SnapshotRow | null,
  input: Readonly<{
    checkedAt: string;
    checkedOn: string;
    leaseId: string;
    fleetLeaseId?: string;
    maximumStreamingRecords: number;
    leaseFenceAt?: string;
    signal?: AbortSignal;
  }>,
) {
  const streamingArtifacts = staging.artifacts
    .map((artifact, sourceIndex) => ({ artifact, sourceIndex }))
    .filter(({ artifact }) => artifact.source.streamingParser);
  if (streamingArtifacts.length !== 1 || staging.artifacts.length !== 1) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official registry ${definition.registryCode} resumable source composition is unsupported.`,
    );
  }
  const [{ artifact, sourceIndex }] = streamingArtifacts;
  await renewLease(
    db,
    definition.registryCode,
    input.leaseId,
    input.checkedAt,
  );
  const sourceCheckedAt = staging.snapshot.created_at;
  const sourceCheckedOn = australianRegulatorDate(sourceCheckedAt);
  const replay = await stageStreamingSource(
    db,
    artifactStore,
    artifact,
    staging.snapshot.id,
    sourceIndex,
    current?.id || null,
    sourceCheckedOn,
    sourceCheckedAt,
    input.checkedAt,
    input.maximumStreamingRecords,
    input.leaseId,
    input.fleetLeaseId,
    input.leaseFenceAt || new Date().toISOString(),
    input.signal,
  );
  assertOfficialProductRefreshActive(input.signal, definition.registryCode);
  const inserted = await db.prepare(`SELECT count(*) AS count
    FROM compliance_official_products WHERE snapshot_id = ?`)
    .bind(staging.snapshot.id)
    .first<{ count: number }>();
  const stagedRecordCount = Number(inserted?.count || 0);
  if (!replay.complete || stagedRecordCount !== staging.snapshot.record_count) {
    return {
      changed: false,
      complete: false as const,
      phase: replay.phase,
      registryCode: definition.registryCode,
      snapshotId: staging.snapshot.id,
      sourceSha256: staging.snapshot.source_sha256,
      recordCount: staging.snapshot.record_count,
      stagedRecordCount,
      insertedThisRun: replay.insertedThisRun,
      checkedAt: input.checkedAt,
    };
  }
  await renewLease(
    db,
    definition.registryCode,
    input.leaseId,
    input.checkedAt,
  );
  const activationProgress = await loadRefreshProgress(
    db,
    definition.registryCode,
  );
  if (
    !activationProgress
    || activationProgress.snapshot_id !== staging.snapshot.id
    || activationProgress.phase !== "activate"
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
      500,
      `Official registry ${definition.registryCode} activation progress is invalid.`,
    );
  }
  await activateOfficialProductStagingSnapshot(db, {
    registryCode: definition.registryCode,
    stagingSnapshotId: staging.snapshot.id,
    currentSnapshotId: current?.id || null,
    checkedAt: sourceCheckedAt,
    checkedOn: sourceCheckedOn,
    sourceManifestJson: staging.snapshot.source_manifest_json,
    sourceSha256: staging.snapshot.source_sha256,
    recordCount: staging.snapshot.record_count,
    reviewAuditMessage: "",
    leaseId: input.leaseId,
    fleetLeaseId: input.fleetLeaseId,
    leaseFenceAt: input.leaseFenceAt,
    progressRevision: activationProgress.revision,
    operationAt: input.checkedAt,
  });
  return {
    changed: true,
    complete: false as const,
    phase: "cleanup" as const,
    registryCode: definition.registryCode,
    snapshotId: staging.snapshot.id,
    sourceSha256: staging.snapshot.source_sha256,
    recordCount: staging.snapshot.record_count,
    stagedRecordCount,
    insertedThisRun: replay.insertedThisRun,
    checkedAt: sourceCheckedAt,
    reviewedCountDecrease: false,
  };
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
    fetchImpl?: CreditexOfficialProductFetch;
    now?: Date;
    reviewedCountDecrease?: CreditexReviewedProductCountDecrease;
    controlledImportReview?: CreditexControlledProductImportReview;
    controlledImportPermissionArtifact?:
      CreditexControlledProductPermissionArtifact;
    fleetLeaseId?: string;
    maximumStreamingRecordsPerRun?: number;
    sourceFetchTimeoutMs?: number;
    signal?: AbortSignal;
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
  const maximumStreamingRecords = options.maximumStreamingRecordsPerRun
    === undefined
    ? Number.MAX_SAFE_INTEGER
    : Number(options.maximumStreamingRecordsPerRun);
  if (
    options.maximumStreamingRecordsPerRun !== undefined
    && (
      !Number.isSafeInteger(maximumStreamingRecords)
      || maximumStreamingRecords < PRODUCT_INSERT_MAX_ROWS
      || maximumStreamingRecords > 50_000
    )
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "The official product streaming refresh budget is invalid.",
    );
  }
  const sourceFetchTimeoutMs = options.sourceFetchTimeoutMs === undefined
    ? OFFICIAL_SOURCE_FETCH_TIMEOUT_MS
    : Number(options.sourceFetchTimeoutMs);
  if (
    !Number.isSafeInteger(sourceFetchTimeoutMs)
    || sourceFetchTimeoutMs < 1_000
    || sourceFetchTimeoutMs > OFFICIAL_SOURCE_FETCH_TIMEOUT_MS
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "The official product source fetch timeout is invalid.",
    );
  }
  const controlledImportReview = options.controlledImportReview
    ? {
        importedByUid: cleanText(
          options.controlledImportReview.importedByUid,
          "controlled import operator",
          128,
          true,
        ),
        governanceIdentityVerified:
          options.controlledImportReview.governanceIdentityVerified,
        permissionArtifactId: cleanText(
          options.controlledImportReview.permissionArtifactId,
          "controlled import permission artifact",
          180,
          true,
        ),
        permissionArtifactSha256: cleanText(
          options.controlledImportReview.permissionArtifactSha256,
          "controlled import permission artifact hash",
          64,
          true,
        ).toLowerCase(),
        permissionArtifactObjectKey: cleanText(
          options.controlledImportReview.permissionArtifactObjectKey,
          "controlled import permission object key",
          2_000,
          true,
        ),
        permissionReviewDecisionId: cleanText(
          options.controlledImportReview.permissionReviewDecisionId,
          "controlled import permission decision",
          180,
          true,
        ),
        permissionReviewedByUid: cleanText(
          options.controlledImportReview.permissionReviewedByUid,
          "controlled import permission reviewer",
          128,
          true,
        ),
      }
    : undefined;
  const controlledImportPermissionArtifact =
    options.controlledImportPermissionArtifact;
  const resumableStagingAllowed = !options.reviewedCountDecrease
    && !options.controlledImportReview
    && !controlledImportPermissionArtifact;
  if (
    Boolean(controlledImportReview)
      !== Boolean(controlledImportPermissionArtifact)
    || (
      controlledImportReview
      && controlledImportPermissionArtifact
      && (
        controlledImportReview.governanceIdentityVerified !== true
        || !/^[0-9a-f]{64}$/.test(
          controlledImportReview.permissionArtifactSha256,
        )
        || controlledImportReview.permissionReviewedByUid
          === controlledImportReview.importedByUid
        || controlledImportPermissionArtifact.artifactId
          !== controlledImportReview.permissionArtifactId
        || controlledImportPermissionArtifact.sha256
          !== controlledImportReview.permissionArtifactSha256
        || controlledImportPermissionArtifact.objectKey
          !== controlledImportReview.permissionArtifactObjectKey
      )
    )
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      403,
      "Controlled official product imports require a governance-verified reviewer.",
    );
  }
  const fetchImpl = withOfficialSourceFetchDeadline(
    options.fetchImpl || fetch,
    sourceFetchTimeoutMs,
    options.signal,
  );
  const leaseId = options.fleetLeaseId || crypto.randomUUID();
  let leaseAcquired = false;
  let stagingSnapshotId = "";
  try {
    await acquireLease(
      db,
      definition.registryCode,
      leaseId,
      checkedAt,
      options.fleetLeaseId,
    );
    leaseAcquired = true;
    if (!options.artifactStore) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_CUSTODY_UNAVAILABLE",
        503,
        "Immutable official source storage is unavailable.",
      );
    }
    const current = await db.prepare(`SELECT
      id, source_manifest_json, source_sha256, record_count, activated_at
      FROM compliance_official_product_snapshots
      WHERE registry_code = ? AND status = 'current' LIMIT 1`)
      .bind(definition.registryCode)
      .first<SnapshotRow>();
    const retainedProgress = resumableStagingAllowed
      ? await loadRefreshProgress(db, definition.registryCode)
      : null;
    if (retainedProgress?.phase === "cleanup") {
      if (!current || retainedProgress.snapshot_id !== current.id) {
        return fail(
          "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
          500,
          `Official registry ${definition.registryCode} cleanup lost its current snapshot.`,
        );
      }
      const cleanup = await cleanupActivatedRefreshProgress(
        db,
        retainedProgress,
        {
          leaseId,
          fleetLeaseId: options.fleetLeaseId,
          leaseFenceAt: options.now ? checkedAt : new Date().toISOString(),
        },
      );
      return {
        changed: false,
        complete: cleanup.complete,
        phase: cleanup.complete ? "complete" as const : "cleanup" as const,
        registryCode: definition.registryCode,
        snapshotId: current.id,
        sourceSha256: current.source_sha256,
        recordCount: current.record_count,
        stagedRecordCount: current.record_count,
        insertedThisRun: 0,
        checkedAt: retainedProgress.created_at,
      };
    }
    const resumable = resumableStagingAllowed
      ? await loadResumableStagingSnapshot(
          db,
          definition,
          current,
        )
      : null;
    if (resumable) {
      stagingSnapshotId = resumable.snapshot.id;
      return await continueResumableStagingSnapshot(
        db,
        options.artifactStore,
        definition,
        resumable,
        current,
        {
          checkedAt,
          checkedOn,
          leaseId,
          fleetLeaseId: options.fleetLeaseId,
          maximumStreamingRecords,
          leaseFenceAt: options.now ? checkedAt : undefined,
          signal: options.signal,
        },
      );
    }
    const sourceAcquisitionCleanup = await loadSourceAcquisitionCleanup(
      db,
      definition.registryCode,
    );
    if (sourceAcquisitionCleanup) {
      const cleanup = await cleanupRetainedSourceAcquisition(
        db,
        options.artifactStore,
        definition.registryCode,
        sourceAcquisitionCleanup,
        {
          leaseId,
          fleetLeaseId: options.fleetLeaseId,
          leaseFenceAt: options.now ? checkedAt : new Date().toISOString(),
        },
      );
      const finished = cleanup.complete && cleanup.disposition === "finish";
      return {
        changed: false,
        complete: finished,
        phase: finished ? "complete" as const : "cleanup" as const,
        registryCode: definition.registryCode,
        snapshotId: current?.id || null,
        sourceSha256: current?.source_sha256 || null,
        recordCount: current?.record_count || 0,
        stagedRecordCount: current?.record_count || 0,
        insertedThisRun: 0,
        checkedAt,
      };
    }
    await cleanStagingRows(db, definition.registryCode);
    // Phase one keeps only compact, custody-verified receipts. Parsed records and
    // source bytes leave scope before the next official source is requested.
    const artifacts: RetainedSourceArtifact[] = [];
    const acquisition = await acquireRegistrySourceArtifacts(
      definition,
      fetchImpl,
      {
        database: db,
        artifactStore: options.artifactStore,
        registryCode: definition.registryCode,
        checkedAt,
        leaseId,
        fleetLeaseId: options.fleetLeaseId,
        leaseFenceAt: options.now ? checkedAt : new Date().toISOString(),
        yieldAt: Date.now() + Math.max(sourceFetchTimeoutMs - 3_500, 1_000),
        signal: options.signal,
      },
    );
    if (acquisition?.complete === false) {
      return {
        changed: false,
        complete: false as const,
        phase: "acquisition" as const,
        registryCode: definition.registryCode,
        snapshotId: current?.id || null,
        sourceSha256: current?.source_sha256 || null,
        recordCount: acquisition.recordCount,
        stagedRecordCount: acquisition.stagedRecordCount,
        insertedThisRun: 0,
        checkedAt,
      };
    }
    const acquiredSources = acquisition?.sources || null;
    const completedAcquisitionId = acquisition?.acquisitionId;
    const cleanupCompletedAcquisition = Boolean(
      acquisition?.complete && acquisition.cleanupRetainedFragments,
    );
    assertOfficialProductRefreshActive(options.signal, definition.registryCode);
    for (const source of definition.sources) {
      assertOfficialProductRefreshActive(options.signal, definition.registryCode);
      const acquiredSource = acquiredSources?.get(source.sourceKey);
      artifacts.push(await fetchInspectAndRetainSource(
        definition,
        source,
        fetchImpl,
        options.artifactStore,
        acquiredSource,
        controlledImportReview,
      ));
      acquiredSources?.delete(source.sourceKey);
      assertOfficialProductRefreshActive(options.signal, definition.registryCode);
      await renewLease(db, definition.registryCode, leaseId, checkedAt);
    }
    const recordCount = artifacts.reduce(
      (total, artifact) => total + artifact.recordCount,
      0,
    );
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
      ...(controlledImportReview
        ? {
            controlledImportReview: {
              contract: "creditex-controlled-product-import-review/v1",
              importedByUid: controlledImportReview.importedByUid,
              reviewedAt: checkedAt,
              permissionArtifactId:
                controlledImportReview.permissionArtifactId,
              permissionArtifactSha256:
                controlledImportReview.permissionArtifactSha256,
              permissionArtifactObjectKey:
                controlledImportReview.permissionArtifactObjectKey,
              permissionReviewDecisionId:
                controlledImportReview.permissionReviewDecisionId,
              permissionReviewedByUid:
                controlledImportReview.permissionReviewedByUid,
            },
          }
        : {}),
      sources: artifacts.map((artifact) => ({
        sourceKey: artifact.source.sourceKey,
        ...(artifact.source.productKind
          ? { productKind: artifact.source.productKind }
          : { productKinds: artifact.source.productKinds }),
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
      await renewLease(db, definition.registryCode, leaseId, checkedAt);
      const leaseFenceAt = options.now
        ? checkedAt
        : new Date().toISOString();
      const receiptStatement = db.prepare(`INSERT INTO compliance_official_product_sync_runs (
        id, registry_code, status, snapshot_id, source_manifest_json,
        source_sha256, record_count, checked_at, message
      ) SELECT ?, ?, 'unchanged', ?, ?, ?, ?, ?, ''
      WHERE EXISTS (
        SELECT 1 FROM compliance_official_product_sync_leases AS inner_lease
        WHERE inner_lease.registry_code = ?
          AND inner_lease.lease_id = ?
          AND inner_lease.expires_at > ?
      ) AND (? = '' OR EXISTS (
        SELECT 1 FROM compliance_official_product_sync_leases AS fleet
        WHERE fleet.registry_code = ?
          AND fleet.lease_id = ?
          AND fleet.expires_at > ?
      ))`)
        .bind(
          crypto.randomUUID(),
          definition.registryCode,
          current.id,
          sourceManifestJson,
          sourceSha256,
          recordCount,
          checkedAt,
          definition.registryCode,
          leaseId,
          leaseFenceAt,
          options.fleetLeaseId || "",
          CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
          options.fleetLeaseId || "",
          leaseFenceAt,
        );
      const completedAcquisitionStatement = completedAcquisitionId
        ? cleanupCompletedAcquisition
          ? db.prepare(`UPDATE compliance_official_product_source_acquisitions
              SET phase = 'cleanup', cleanup_disposition = 'finish',
                revision = revision + 1, updated_at = ?
              WHERE registry_code = ? AND acquisition_id = ? AND phase = 'ready'
                AND ${refreshOwnershipPredicate()}`)
            .bind(
              checkedAt,
              definition.registryCode,
              completedAcquisitionId,
              ...refreshOwnershipBindings({
                registryCode: definition.registryCode,
                leaseId,
                fleetLeaseId: options.fleetLeaseId,
                leaseFenceAt,
              }),
            )
          : db.prepare(`DELETE FROM
              compliance_official_product_source_acquisitions
            WHERE registry_code = ? AND acquisition_id = ?
              AND ${refreshOwnershipPredicate()}`)
            .bind(
              definition.registryCode,
              completedAcquisitionId,
              ...refreshOwnershipBindings({
                registryCode: definition.registryCode,
                leaseId,
                fleetLeaseId: options.fleetLeaseId,
                leaseFenceAt,
              }),
            )
        : null;
      const receiptResults = completedAcquisitionStatement
        ? await db.batch([
            receiptStatement,
            completedAcquisitionStatement,
          ])
        : [await receiptStatement.run()];
      if (
        Number(receiptResults[0]?.meta?.changes || 0) !== 1
        || (
          completedAcquisitionId
          && Number(receiptResults[1]?.meta?.changes || 0) !== 1
        )
      ) {
        return fail(
          "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
          409,
          `Official registry ${definition.registryCode} refresh ownership was lost.`,
        );
      }
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
    const boundedStreamingSources = artifacts
      .map((artifact, sourceIndex) => ({ artifact, sourceIndex }))
      .filter(({ artifact }) => artifact.source.streamingParser);
    if (
      options.maximumStreamingRecordsPerRun !== undefined
      && (
        boundedStreamingSources.length !== 1
        || artifacts.length !== 1
      )
    ) {
      return fail(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        500,
        `Official registry ${definition.registryCode} has an unsupported resumable source composition.`,
      );
    }
    const stagingStatements = [db.prepare(`INSERT INTO
      compliance_official_product_snapshots (
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
      )];
    for (const artifact of artifacts) {
      stagingStatements.push(db.prepare(`INSERT INTO
        compliance_official_product_artifacts (
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
        ));
    }
    if (options.maximumStreamingRecordsPerRun !== undefined) {
      const [{ artifact, sourceIndex }] = boundedStreamingSources;
      stagingStatements.push(db.prepare(`INSERT INTO
        compliance_official_product_refresh_progress (
          registry_code, snapshot_id, replay_contract, source_index,
          source_key, phase, supplement_batch_count, supplement_value_count,
          product_batch_count, product_record_count, last_product_record_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'supplements', 0, 0, 0, 0, '', 1, ?, ?)`)
        .bind(
          definition.registryCode,
          stagingSnapshotId,
          OFFICIAL_PRODUCT_REFRESH_REPLAY_CONTRACT,
          sourceIndex,
          artifact.source.sourceKey,
          checkedAt,
          checkedAt,
        ));
    }
    if (completedAcquisitionId) {
      const leaseFenceAt = options.now ? checkedAt : new Date().toISOString();
      stagingStatements.push(cleanupCompletedAcquisition
        ? db.prepare(`UPDATE compliance_official_product_source_acquisitions
            SET phase = 'cleanup', cleanup_disposition = 'finish',
              revision = revision + 1, updated_at = ?
            WHERE registry_code = ? AND acquisition_id = ? AND phase = 'ready'
              AND ${refreshOwnershipPredicate()}`)
          .bind(
            checkedAt,
            definition.registryCode,
            completedAcquisitionId,
            ...refreshOwnershipBindings({
              registryCode: definition.registryCode,
              leaseId,
              fleetLeaseId: options.fleetLeaseId,
              leaseFenceAt,
            }),
          )
        : db.prepare(`DELETE FROM
            compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ?
            AND ${refreshOwnershipPredicate()}`)
          .bind(
            definition.registryCode,
            completedAcquisitionId,
            ...refreshOwnershipBindings({
              registryCode: definition.registryCode,
              leaseId,
              fleetLeaseId: options.fleetLeaseId,
              leaseFenceAt,
            }),
          ));
    }
    assertOfficialProductRefreshActive(options.signal, definition.registryCode);
    const stagingResults = await db.batch(stagingStatements);
    if (
      completedAcquisitionId
      && Number(stagingResults.at(-1)?.meta?.changes || 0) !== 1
    ) {
      return fail(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        `Official registry ${definition.registryCode} refresh ownership was lost.`,
      );
    }
    assertOfficialProductRefreshActive(options.signal, definition.registryCode);
    if (
      options.maximumStreamingRecordsPerRun !== undefined
      && boundedStreamingSources.length === 1
    ) {
      return {
        changed: false,
        complete: false as const,
        registryCode: definition.registryCode,
        snapshotId: stagingSnapshotId,
        sourceSha256,
        recordCount,
        stagedRecordCount: 0,
        insertedThisRun: 0,
        phase: "supplements" as const,
        checkedAt,
      };
    }
    // Phase two replays each exact R2 artifact independently into the staging
    // snapshot. The current snapshot is not changed until every replay reconciles.
    for (let sourceIndex = 0; sourceIndex < artifacts.length; sourceIndex += 1) {
      const artifact = artifacts[sourceIndex];
      await renewLease(db, definition.registryCode, leaseId, checkedAt);
      if (artifact.source.streamingParser) {
        let replayComplete = false;
        while (!replayComplete) {
          const replay = await stageStreamingSource(
            db,
            options.artifactStore,
            artifact,
            stagingSnapshotId,
            sourceIndex,
            current?.id || null,
            checkedOn,
            checkedAt,
            checkedAt,
            CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET,
            leaseId,
            options.fleetLeaseId,
            options.now ? checkedAt : new Date().toISOString(),
            options.signal,
          );
          replayComplete = replay.complete;
          if (!replayComplete) {
            await renewLease(db, definition.registryCode, leaseId, checkedAt);
          }
        }
      } else {
        let records: readonly CreditexOfficialProductRecord[] | null =
          await loadRetainedSourceRecords(
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
          resolveRegistryEffectiveStarts(
            records,
            checkedOn,
            current !== null,
          );
        records = null;
        await insertProductChunks(
          db,
          stagingSnapshotId,
          current?.id || null,
          stagedRecords,
        );
        stagedRecords = null;
      }
      await renewLease(db, definition.registryCode, leaseId, checkedAt);
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
    await renewLease(db, definition.registryCode, leaseId, checkedAt);
    if (controlledImportPermissionArtifact) {
      // Permission is mutable independently of the staged product artifacts.
      // Re-read its exact retained bytes at the activation boundary, after all
      // staging work and with no intervening await before the atomic D1 batch.
      await verifyCreditexControlledProductPermissionArtifact(
        options.artifactStore,
        controlledImportPermissionArtifact,
      );
    }
    const activationProgress = await loadRefreshProgress(
      db,
      definition.registryCode,
    );
    if (activationProgress && activationProgress.phase !== "activate") {
      return fail(
        "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
        500,
        `Official registry ${definition.registryCode} activation progress is invalid.`,
      );
    }
    await activateOfficialProductStagingSnapshot(db, {
      registryCode: definition.registryCode,
      stagingSnapshotId,
      currentSnapshotId: current?.id || null,
      checkedAt,
      checkedOn,
      sourceManifestJson,
      sourceSha256,
      recordCount,
      reviewAuditMessage,
      leaseId,
      fleetLeaseId: options.fleetLeaseId,
      leaseFenceAt: options.now ? checkedAt : undefined,
      progressRevision: activationProgress?.revision,
      operationAt: checkedAt,
    });
    if (activationProgress) {
      const cleanupProgress = await loadRefreshProgress(
        db,
        definition.registryCode,
      );
      if (!cleanupProgress || cleanupProgress.phase !== "cleanup") {
        return fail(
          "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED",
          500,
          `Official registry ${definition.registryCode} cleanup progress is invalid.`,
        );
      }
      await cleanupActivatedRefreshProgress(db, cleanupProgress, {
        leaseId,
        fleetLeaseId: options.fleetLeaseId,
        leaseFenceAt: options.now ? checkedAt : new Date().toISOString(),
      });
    }
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
    const deterministicStagingFailure = error instanceof CreditexOfficialProductError
      && (
        error.code === "OFFICIAL_PRODUCT_SOURCE_INVALID"
        || error.code === "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED"
      );
    if (
      stagingSnapshotId
      && (!resumableStagingAllowed || deterministicStagingFailure)
    ) {
      await db.prepare(`DELETE FROM compliance_official_product_snapshots
        WHERE id = ? AND status = 'staging'`)
        .bind(stagingSnapshotId)
        .run()
        .catch(() => undefined);
    }
    const ownershipLost = error instanceof CreditexOfficialProductError
      && error.code === "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS";
    const pendingRefresh = leaseAcquired
      ? await loadPendingOfficialProductRefresh(
          db,
          definition.registryCode,
        ).catch(() => null)
      : null;
    const boundedCheckpointYield = error instanceof CreditexOfficialProductError
      && error.code === "OFFICIAL_PRODUCT_REFRESH_DEADLINE"
      && options.signal?.aborted === true
      && options.signal.reason
        === CREDITEX_OFFICIAL_PRODUCT_BACKGROUND_TIMEOUT_REASON
      && pendingRefresh !== null;
    if (leaseAcquired && !ownershipLost && !boundedCheckpointYield
      && !pendingRefresh?.postActivationCleanup) {
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
    if (boundedCheckpointYield && pendingRefresh) {
      return {
        changed: false,
        complete: false as const,
        phase: pendingRefresh.phase,
        registryCode: definition.registryCode,
        snapshotId: pendingRefresh.snapshotId,
        sourceSha256: pendingRefresh.sourceSha256,
        recordCount: pendingRefresh.recordCount,
        stagedRecordCount: pendingRefresh.stagedRecordCount,
        insertedThisRun: 0,
        checkedAt: pendingRefresh.checkedAt,
      };
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
  const checkedAgeMs = lastCheckedAt
    ? now.getTime() - new Date(lastCheckedAt).getTime()
    : Number.NaN;
  const current = Boolean(
    snapshot
    && lastCheckedAt
    && lastSuccessfulCheck?.snapshot_id === snapshot.id
    && Number.isFinite(checkedAgeMs)
    && checkedAgeMs >= 0
    && checkedAgeMs <= FRESHNESS_WINDOW_MS,
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

export function creditexOfficialProductRegistryCanServeCalculator(
  status: CreditexOfficialProductRegistryStatus,
  now = new Date(),
) {
  if (status.status === "current") return true;
  if (
    status.status !== "stale"
    || !status.snapshotId
    || !status.sourceSha256
    || !Number.isSafeInteger(status.recordCount)
    || status.recordCount < 1
    || !status.lastCheckedAt
  ) {
    return false;
  }
  const checkedAt = Date.parse(status.lastCheckedAt);
  const currentTime = now.getTime();
  return Number.isFinite(checkedAt)
    && Number.isFinite(currentTime)
    && checkedAt <= currentTime;
}

function requireOfficialProductRegistry(
  status: CreditexOfficialProductRegistryStatus,
  options: {
    allowStaleAcceptedSnapshot?: boolean;
    now?: Date;
  },
) {
  if (
    options.allowStaleAcceptedSnapshot
    && creditexOfficialProductRegistryCanServeCalculator(
      status,
      options.now,
    )
  ) {
    return;
  }
  if (status.status !== "current") registryFailure(status);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function failedAutomaticRefreshBackoffActive(
  status: CreditexOfficialProductRegistryStatus,
  now: Date,
) {
  if (status.lastAttempt?.status !== "failed") return false;
  const attemptedAt = Date.parse(status.lastAttempt.checkedAt);
  const elapsed = now.getTime() - attemptedAt;
  return Number.isFinite(elapsed)
    && elapsed >= 0
    && elapsed < AUTOMATIC_REFRESH_FAILURE_BACKOFF_MS;
}

export async function ensureAutomaticOfficialProductRegistryCurrent(
  db: D1Database,
  definition: CreditexOfficialProductRegistryDefinition,
  options: {
    artifactStore?: CreditexOfficialProductArtifactStore;
    fetchImpl?: CreditexOfficialProductFetch;
    now?: Date;
    waitForRefreshMs?: number;
    pollIntervalMs?: number;
    fleetLeaseId?: string;
  } = {},
): Promise<CreditexOfficialProductRegistryStatus> {
  const statusOptions = options.now ? { now: options.now } : {};
  let status = await loadOfficialProductRegistryStatus(
    db,
    definition.registryCode,
    statusOptions,
  );
  if (status.status === "current") return status;
  if (failedAutomaticRefreshBackoffActive(status, options.now || new Date())) {
    registryFailure(status);
  }

  try {
    await syncOfficialProductRegistry(db, definition, {
      artifactStore: options.artifactStore,
      fetchImpl: options.fetchImpl,
      now: options.now,
      fleetLeaseId: options.fleetLeaseId,
    });
  } catch (error) {
    if (
      !(error instanceof CreditexOfficialProductError)
      || error.code !== "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS"
    ) {
      throw error;
    }
    const waitForRefreshMs = Math.min(
      Math.max(Number(options.waitForRefreshMs ?? AUTOMATIC_REFRESH_WAIT_MS), 0),
      AUTOMATIC_REFRESH_WAIT_MS,
    );
    const pollIntervalMs = Math.min(
      Math.max(Number(options.pollIntervalMs ?? AUTOMATIC_REFRESH_POLL_MS), 250),
      AUTOMATIC_REFRESH_POLL_MS,
    );
    const deadline = Date.now() + waitForRefreshMs;
    while (Date.now() < deadline) {
      await wait(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 1)));
      status = await loadOfficialProductRegistryStatus(
        db,
        definition.registryCode,
        statusOptions,
      );
      if (status.status === "current") return status;
    }
  }

  status = await loadOfficialProductRegistryStatus(
    db,
    definition.registryCode,
    statusOptions,
  );
  if (status.status !== "current") registryFailure(status);
  return status;
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

const MAXIMUM_OFFICIAL_PRODUCT_FACET_OPTIONS = 10_000;
const MAXIMUM_OFFICIAL_PRODUCT_EXACT_RECORDS = 100;
const OFFICIAL_PRODUCT_OWNER_UNPUBLISHED = "__official_owner_not_published__";
const OFFICIAL_PRODUCT_TYPE_UNPUBLISHED = "__official_product_type_not_published__";

const OFFICIAL_PRODUCT_OWNER_SQL = `CASE
  WHEN product.brand <> '' THEN product.brand
  WHEN product.manufacturer <> '' THEN product.manufacturer
  ELSE '${OFFICIAL_PRODUCT_OWNER_UNPUBLISHED}'
END`;

const OFFICIAL_PRODUCT_TYPE_SQL = `CASE
  WHEN json_type(product.attributes_json, '$.veuProductType') = 'text'
    AND trim(CAST(json_extract(product.attributes_json, '$.veuProductType') AS TEXT)) <> ''
    AND json_type(product.attributes_json, '$.veuProductConfiguration') = 'text'
    AND trim(CAST(json_extract(product.attributes_json, '$.veuProductConfiguration') AS TEXT)) <> ''
    THEN trim(CAST(json_extract(product.attributes_json, '$.veuProductType') AS TEXT))
      || ' | '
      || trim(CAST(json_extract(product.attributes_json, '$.veuProductConfiguration') AS TEXT))
  WHEN json_type(product.attributes_json, '$.veuProductType') = 'text'
    AND trim(CAST(json_extract(product.attributes_json, '$.veuProductType') AS TEXT)) <> ''
    THEN trim(CAST(json_extract(product.attributes_json, '$.veuProductType') AS TEXT))
  WHEN json_type(product.attributes_json, '$.veuProductConfiguration') = 'text'
    AND trim(CAST(json_extract(product.attributes_json, '$.veuProductConfiguration') AS TEXT)) <> ''
    THEN trim(CAST(json_extract(product.attributes_json, '$.veuProductConfiguration') AS TEXT))
  WHEN product.series <> '' THEN product.series
  WHEN json_type(product.attributes_json, '$.veuProductCategoryNumber') = 'text'
    AND trim(CAST(json_extract(product.attributes_json, '$.veuProductCategoryNumber') AS TEXT)) <> ''
    THEN trim(CAST(json_extract(product.attributes_json, '$.veuProductCategoryNumber') AS TEXT))
  ELSE '${OFFICIAL_PRODUCT_TYPE_UNPUBLISHED}'
END`;

function exactProductFacetFilter(
  value: unknown,
  label: string,
  maximumLength: number,
) {
  const text = String(value || "").trim();
  if (text.length > maximumLength) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      `${label} must not exceed ${maximumLength} characters.`,
    );
  }
  return text;
}

function eligibleOfficialProductRelation(input: {
  registryCode: string;
  productKind: CreditexOfficialProductKind;
  installationDate: string;
  query: string;
  veuProductCategoryNumbers?: readonly string[];
  veuRefrigerantTypes?: readonly string[];
  brand?: string;
  model?: string;
  productType?: string;
}) {
  const conditions = [
    "snapshot.registry_code = ?",
    "snapshot.status IN ('current', 'superseded')",
    `(snapshot.registry_code <> 'veu-approved-products'
      OR snapshot.status = 'current')`,
    "product.product_kind = ?",
    "product.available_in_australia = 1",
    `product.approval_status NOT IN (
      'cancelled', 'ineligible', 'not_approved', 'rejected', 'superseded',
      'unknown', 'withdrawn'
    )`,
    `(snapshot.registry_code <> 'gems-products'
      OR product.approval_status = 'approved')`,
    `(
      (product.eligible_from <> '' AND product.eligible_from <= ?)
      OR (
        product.eligible_from = ''
        AND snapshot.activated_on <= ?
      )
    )`,
    "(product.eligible_to = '' OR product.eligible_to >= ?)",
    `(snapshot.registry_code = 'veu-approved-products'
      OR product.registry_effective_from <= ?)`,
    `(
      snapshot.registry_code = 'veu-approved-products'
      OR snapshot.status = 'current'
      OR snapshot.superseded_on > ?
    )`,
  ];
  const bindings: string[] = [
    input.registryCode,
    input.productKind,
    input.installationDate,
    input.installationDate,
    input.installationDate,
    input.installationDate,
    input.installationDate,
  ];
  if (input.veuProductCategoryNumbers) {
    conditions.push(`json_type(
      product.attributes_json,
      '$.veuProductCategoryNumber'
    ) = 'text'`);
    conditions.push(`trim(CAST(json_extract(
      product.attributes_json,
      '$.veuProductCategoryNumber'
    ) AS TEXT)) IN (${input.veuProductCategoryNumbers.map(() => "?").join(", ")})`);
    bindings.push(...input.veuProductCategoryNumbers);
  }
  if (input.veuRefrigerantTypes) {
    conditions.push(`json_type(
      product.attributes_json,
      '$.refrigerantType'
    ) = 'text'`);
    conditions.push(`trim(CAST(json_extract(
      product.attributes_json,
      '$.refrigerantType'
    ) AS TEXT)) IN (${input.veuRefrigerantTypes.map(() => "?").join(", ")})`);
    bindings.push(...input.veuRefrigerantTypes);
  }
  if (input.query) {
    conditions.push("instr(product.search_text, ?) > 0");
    bindings.push(input.query);
  }
  if (input.brand) {
    conditions.push(`${OFFICIAL_PRODUCT_OWNER_SQL} = ?`);
    bindings.push(input.brand);
  }
  if (input.model) {
    conditions.push("product.model = ?");
    bindings.push(input.model);
  }
  if (input.productType) {
    conditions.push(`${OFFICIAL_PRODUCT_TYPE_SQL} = ?`);
    bindings.push(input.productType);
  }
  return {
    sql: `FROM compliance_official_products product
      JOIN compliance_official_product_snapshots snapshot
        ON snapshot.id = product.snapshot_id
      WHERE ${conditions.join("\n        AND ")}`,
    bindings,
  };
}

function publicFacetOptions(rows: readonly ProductFacetRow[]) {
  if (rows.length > MAXIMUM_OFFICIAL_PRODUCT_FACET_OPTIONS) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      409,
      "The official product options are too broad. Narrow the product search before continuing.",
    );
  }
  return rows.map((row) => ({
    value: row.value,
    label: row.value === OFFICIAL_PRODUCT_OWNER_UNPUBLISHED
      ? "Official owner not published"
      : row.value === OFFICIAL_PRODUCT_TYPE_UNPUBLISHED
        ? "Not separately classified"
        : row.value,
    count: Number(row.match_count),
  }));
}

async function officialProductFacet(
  db: D1Database,
  relation: ReturnType<typeof eligibleOfficialProductRelation>,
  expression: string,
) {
  const rows = await db.prepare(`SELECT
      ${expression} AS value, count(*) AS match_count
    ${relation.sql}
      AND ${expression} <> ''
    GROUP BY ${expression}
    ORDER BY value COLLATE NOCASE, value
    LIMIT ?`)
    .bind(
      ...relation.bindings,
      MAXIMUM_OFFICIAL_PRODUCT_FACET_OPTIONS + 1,
    )
    .all<ProductFacetRow>();
  return publicFacetOptions(rows.results || []);
}

export async function searchOfficialProducts(
  db: D1Database,
  input: {
    productKind: unknown;
    installationDate: unknown;
    query?: unknown;
    brand?: unknown;
    model?: unknown;
    productType?: unknown;
    veuActivityCode?: unknown;
    veuScenario?: unknown;
    limit?: unknown;
  },
  options: {
    allowStaleAcceptedSnapshot?: boolean;
    now?: Date;
  } = {},
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
  requireOfficialProductRegistry(status, options);
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
    || requestedLimit > MAXIMUM_OFFICIAL_PRODUCT_EXACT_RECORDS
  ) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      `Product search limit must be a whole number from 1 to ${MAXIMUM_OFFICIAL_PRODUCT_EXACT_RECORDS}.`,
    );
  }
  const limit = requestedLimit;
  const brand = exactProductFacetFilter(input.brand, "Product brand", 300);
  const model = exactProductFacetFilter(input.model, "Product model", 500);
  const productType = exactProductFacetFilter(
    input.productType,
    "Product type",
    700,
  );
  const veuActivityCode = exactProductFacetFilter(
    input.veuActivityCode,
    "VEU activity code",
    20,
  );
  const veuScenario = exactProductFacetFilter(
    input.veuScenario,
    "VEU scenario",
    40,
  );
  if (veuScenario && !veuActivityCode) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "Choose a governed VEU activity before choosing a scenario.",
    );
  }
  if (model && !brand) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "Choose an exact product brand before choosing a model.",
    );
  }
  if (productType && (!brand || !model)) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "Choose an exact product brand and model before choosing a product type.",
    );
  }
  let veuProductCategoryNumbers: readonly string[] | undefined;
  let veuRefrigerantTypes: readonly string[] | undefined;
  if (registryCode === "veu-approved-products") {
    if (!veuActivityCode) {
      return fail(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "Choose a governed VEU activity before searching the VEU Public Registry.",
      );
    }
    const governedKinds = officialProductKindsForVeuActivity(
      veuActivityCode,
      veuScenario || undefined,
      installationDate,
    );
    veuProductCategoryNumbers = officialVeuProductCategoryNumbersForActivity(
      veuActivityCode,
      veuScenario || undefined,
    );
    if (veuActivityCode === "1D" || veuActivityCode === "3C") {
      veuRefrigerantTypes = CREDITEX_VEU_ELIGIBLE_HEAT_PUMP_REFRIGERANTS;
    }
    if (
      !governedKinds.includes(kind)
      || veuProductCategoryNumbers.length < 1
    ) {
      return fail(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "The VEU activity and scenario do not have a governed approved-product contract for this product type.",
      );
    }
  }
  const baseRelation = {
    registryCode,
    productKind: kind,
    installationDate,
    query: "",
    veuProductCategoryNumbers,
    veuRefrigerantTypes,
  } as const;
  const brandRelation = eligibleOfficialProductRelation(baseRelation);
  const modelRelation = brand
    ? eligibleOfficialProductRelation({ ...baseRelation, query, brand })
    : null;
  const productTypeRelation = brand && model
    ? eligibleOfficialProductRelation({ ...baseRelation, query, brand, model })
    : null;
  const productRelation = eligibleOfficialProductRelation({
    ...baseRelation,
    query,
    brand,
    model,
    productType,
  });
  const productStatement = db.prepare(`SELECT
      product.id, product.snapshot_id, snapshot.registry_code,
      snapshot.source_sha256 AS snapshot_source_sha256,
      product.source_key, product.source_record_key, product.product_kind,
      product.manufacturer, product.brand, product.model, product.series,
      product.registration_number, product.certificate_number,
      product.approval_status, product.eligible_from, product.eligible_to,
      product.attributes_json
    ${productRelation.sql}
    ORDER BY product.brand, product.manufacturer, product.model, product.id
    LIMIT ?`)
    .bind(
      ...productRelation.bindings,
      brand && model ? limit + 1 : limit,
    )
    .all<ProductRow>();
  const countStatement = db.prepare(`SELECT count(*) AS match_count
    ${productRelation.sql}`)
    .bind(...productRelation.bindings)
    .first<ProductCountRow>();
  const [rows, count, brands, models, productTypes] = await Promise.all([
    productStatement,
    countStatement,
    officialProductFacet(db, brandRelation, OFFICIAL_PRODUCT_OWNER_SQL),
    modelRelation
      ? officialProductFacet(db, modelRelation, "product.model")
      : Promise.resolve([]),
    productTypeRelation
      ? officialProductFacet(db, productTypeRelation, OFFICIAL_PRODUCT_TYPE_SQL)
      : Promise.resolve([]),
  ]);
  const productRows = rows.results || [];
  const exactIdentityOverflow = Boolean(
    brand && model && productRows.length > limit,
  );
  if (exactIdentityOverflow && productType) {
    return fail(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      409,
      `More than ${limit} official approval records share this exact owner and model. The registry identity requires review before one record can be selected safely.`,
    );
  }
  return {
    registry: status,
    productKind: kind,
    installationDate,
    facets: { brands, models, productTypes },
    matchCount: Number(count?.match_count || 0),
    products: exactIdentityOverflow
      ? []
      : productRows.slice(0, limit).map(publicProduct),
  };
}

export async function validateOfficialProductSelections(
  db: D1Database,
  input: {
    installationDate: unknown;
    requiredKinds: readonly CreditexOfficialProductKind[];
    selectedProductIds: unknown;
  },
  options: {
    allowStaleAcceptedSnapshot?: boolean;
    now?: Date;
  } = {},
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
      requireOfficialProductRegistry(status, options);
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
        AND (
          snapshot.registry_code <> 'veu-approved-products'
          OR snapshot.status = 'current'
        )
        AND product.product_kind = ? AND product.available_in_australia = 1
        AND (
          (product.eligible_from <> '' AND product.eligible_from <= ?)
          OR (
            product.eligible_from = ''
            AND snapshot.activated_on <= ?
          )
        )
        AND (product.eligible_to = '' OR product.eligible_to >= ?)
        AND (
          snapshot.registry_code = 'veu-approved-products'
          OR product.registry_effective_from <= ?
        )
        AND (
          snapshot.registry_code = 'veu-approved-products'
          OR snapshot.status = 'current'
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
