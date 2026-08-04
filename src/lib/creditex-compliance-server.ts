import { ensureCreditexSchemaGuards } from "./creditex-schema-guards";
import {
  CreditexSourceLookupReviewError,
  requireCurrentApprovedOfficialSourceBinding,
} from "./creditex-source-lookup-review-server";

export const COMPLIANCE_SERVICE_CATEGORIES = [
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "electrical",
  "plumbing",
  "mounting-hardware",
  "controls",
  "other",
] as const;

export type ComplianceServiceCategory =
  typeof COMPLIANCE_SERVICE_CATEGORIES[number];

export const COMPLIANCE_PUBLISH_STATES = [
  "draft",
  "published",
  "withdrawn",
] as const;

export type CompliancePublishState =
  typeof COMPLIANCE_PUBLISH_STATES[number];

export const COMPLIANCE_CALCULATION_APPROVAL_STATES = [
  "not_assessed",
  "approved",
  "rejected",
  "not_applicable",
] as const;

export type ComplianceCalculationApprovalState =
  typeof COMPLIANCE_CALCULATION_APPROVAL_STATES[number];

export const COMPLIANCE_CASE_STATUSES = [
  "draft",
  "ready_for_submission",
  "submitted",
  "in_review",
  "changes_requested",
  "accepted",
  "rejected",
  "closed",
] as const;

export const COMPLIANCE_EVIDENCE_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
  "changes_required",
  "verified",
] as const;

export type ComplianceActorType = "installer" | "compliance" | "platform";

export const AUSTRALIAN_SITE_JURISDICTIONS = [
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
] as const;

export type AustralianSiteJurisdiction =
  typeof AUSTRALIAN_SITE_JURISDICTIONS[number];

export const COMPLIANCE_JURISDICTIONS = [
  "AU",
  ...AUSTRALIAN_SITE_JURISDICTIONS,
] as const;

export type ComplianceJurisdiction =
  typeof COMPLIANCE_JURISDICTIONS[number];

export const COMPLIANCE_GOVERNANCE_TARGET_TYPES = [
  "program",
  "activity",
  "evidence_policy",
] as const;

export type ComplianceGovernanceTargetType =
  typeof COMPLIANCE_GOVERNANCE_TARGET_TYPES[number];

export const COMPLIANCE_EVIDENCE_REQUIREMENT_TYPES = [
  "photo",
  "document",
  "declaration",
  "signature",
  "licence",
  "invoice",
  "payment",
  "product",
  "serial",
  "decommission",
  "location",
  "other",
] as const;

export type ComplianceEvidenceRequirementType =
  typeof COMPLIANCE_EVIDENCE_REQUIREMENT_TYPES[number];

export const COMPLIANCE_EVIDENCE_CAPTURE_TIMINGS = [
  "pre_install",
  "during_install",
  "post_install",
  "any",
  "periodic",
] as const;

export type ComplianceEvidenceCaptureTiming =
  typeof COMPLIANCE_EVIDENCE_CAPTURE_TIMINGS[number];

export const CREDITEX_FIELD_SUPPORTED_EVIDENCE_TYPES = [
  "photo",
  "document",
] as const;

export const CREDITEX_FIELD_SUPPORTED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type ComplianceActivityProjection = {
  id: string;
  organisationId: string;
  organisationCode: string;
  organisationLegalName: string;
  organisationTradingName: string;
  organisationName: string;
  programId: string;
  programCode: string;
  programName: string;
  schemeKind: string;
  programJurisdiction: string;
  administeringBody: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: ComplianceServiceCategory;
  registryActivityCode: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  requirementsSnapshot: Record<string, unknown>;
  requirementsSnapshotJson: string;
  publishState: CompliancePublishState;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  pendingPublicationRequestId: string;
  calculationApprovalState: ComplianceCalculationApprovalState;
  publishedAt: string;
  withdrawnAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ComplianceProgramProjection = {
  id: string;
  organisationId: string;
  programCode: string;
  name: string;
  schemeKind: string;
  jurisdiction: string;
  administeringBody: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  publishState: CompliancePublishState;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  pendingPublicationRequestId: string;
  publishedAt: string;
  withdrawnAt: string;
  createdAt: string;
  updatedAt: string;
};

export class ComplianceDomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cleanText(value: unknown, maximum: number) {
  const result = String(value || "").trim();
  if (result.length > maximum) {
    throw new ComplianceDomainError(
      "COMPLIANCE_VALUE_TOO_LONG",
      400,
      `Compliance value must be ${maximum} characters or fewer.`,
    );
  }
  return result;
}

function requiredText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  const result = cleanText(value, maximum);
  if (!result) {
    throw new ComplianceDomainError(code, 400, `${label} is required.`);
  }
  return result;
}

function checkedInternalKey(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  const result = requiredText(value, maximum, code, label).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) {
    throw new ComplianceDomainError(
      code,
      400,
      `${label} must use lower-case letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return result;
}

function checkedDate(value: unknown, code: string, label: string) {
  const result = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new ComplianceDomainError(code, 400, `${label} must be an ISO date.`);
  }
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== result
  ) {
    throw new ComplianceDomainError(code, 400, `${label} is not a valid date.`);
  }
  return result;
}

function checkedOptionalDate(value: unknown, code: string, label: string) {
  const result = cleanText(value, 10);
  return result ? checkedDate(result, code, label) : "";
}

function checkedInstant(value: unknown, code: string, label: string) {
  const result = requiredText(value, 40, code, label);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime())) {
    throw new ComplianceDomainError(
      code,
      400,
      `${label} must be an ISO timestamp.`,
    );
  }
  return parsed.toISOString();
}

function checkedHttpsUrl(value: unknown, code: string, label: string) {
  const result = requiredText(value, 800, code, label);
  try {
    const parsed = new URL(result);
    if (parsed.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    return parsed.toString();
  } catch (error) {
    if (!(error instanceof CreditexSourceLookupReviewError)) throw error;
    throw new ComplianceDomainError(
      code,
      400,
      `${label} must be a valid HTTPS URL.`,
    );
  }
}

function checkedSourceSha256(value: unknown) {
  const result = cleanText(value, 64).toLowerCase();
  if (result && !/^[0-9a-f]{64}$/.test(result)) {
    throw new ComplianceDomainError(
      "INVALID_SOURCE_SHA256",
      400,
      "Official source SHA-256 must contain 64 hexadecimal characters.",
    );
  }
  return result;
}

function checkedJsonObject(
  value: unknown,
  code: string,
  label: string,
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ComplianceDomainError(code, 400, `${label} must be an object.`);
  }
  const serialised = JSON.stringify(value);
  if (serialised.length > 80_000) {
    throw new ComplianceDomainError(
      code,
      400,
      `${label} exceeds the supported size.`,
    );
  }
  return JSON.parse(serialised) as Record<string, unknown>;
}

function checkedBoolean(value: unknown, label: string) {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (
    value === false
    || value === 0
    || value === "0"
    || value === "false"
    || value === undefined
    || value === null
    || value === ""
  ) {
    return false;
  }
  throw new ComplianceDomainError(
    "INVALID_EVIDENCE_REQUIREMENT_FLAG",
    400,
    `${label} must be true or false.`,
  );
}

function checkedPositiveInteger(
  value: unknown,
  label: string,
  { allowZero = false }: { allowZero?: boolean } = {},
) {
  const result = Math.floor(Number(value));
  if (
    !Number.isSafeInteger(result)
    || result < (allowZero ? 0 : 1)
    || result > 10_000
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_COUNT",
      400,
      `${label} must be a supported whole number.`,
    );
  }
  return result;
}

function checkedContentTypes(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_CONTENT_TYPES",
      400,
      "Allowed content types must be a list of no more than 20 MIME types.",
    );
  }
  const contentTypes = [...new Set(value.map((item) =>
    requiredText(
      item,
      120,
      "INVALID_EVIDENCE_CONTENT_TYPES",
      "Allowed content type",
    ).toLowerCase()
  ))];
  if (contentTypes.some((item) =>
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(item)
  )) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_CONTENT_TYPES",
      400,
      "Each allowed content type must be a valid MIME type.",
    );
  }
  return contentTypes;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJsonValue(item)]),
    );
  }
  return value;
}

export function canonicalComplianceSnapshot(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value));
}

export async function complianceSnapshotSha256(snapshot: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(snapshot),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseJsonObject(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function isComplianceServiceCategory(
  value: unknown,
): value is ComplianceServiceCategory {
  return COMPLIANCE_SERVICE_CATEGORIES.includes(
    value as ComplianceServiceCategory,
  );
}

function isCompliancePublishState(
  value: unknown,
): value is CompliancePublishState {
  return COMPLIANCE_PUBLISH_STATES.includes(value as CompliancePublishState);
}

function isCalculationApprovalState(
  value: unknown,
): value is ComplianceCalculationApprovalState {
  return COMPLIANCE_CALCULATION_APPROVAL_STATES.includes(
    value as ComplianceCalculationApprovalState,
  );
}

export function isAustralianSiteJurisdiction(
  value: unknown,
): value is AustralianSiteJurisdiction {
  return AUSTRALIAN_SITE_JURISDICTIONS.includes(
    value as AustralianSiteJurisdiction,
  );
}

export function isComplianceJurisdiction(
  value: unknown,
): value is ComplianceJurisdiction {
  return COMPLIANCE_JURISDICTIONS.includes(value as ComplianceJurisdiction);
}

function checkedComplianceJurisdiction(value: unknown) {
  const jurisdiction = cleanText(value, 20).toUpperCase();
  if (!isComplianceJurisdiction(jurisdiction)) {
    throw new ComplianceDomainError(
      "INVALID_JURISDICTION",
      400,
      "Choose Australia or an Australian state or territory.",
    );
  }
  return jurisdiction;
}

function activityProjection(
  row: Record<string, unknown>,
): ComplianceActivityProjection {
  const serviceCategory = String(row.service_category);
  const publishState = String(row.publish_state);
  const calculationApprovalState = String(row.calculation_approval_state);
  if (
    !isComplianceServiceCategory(serviceCategory)
    || !isCompliancePublishState(publishState)
    || !isCalculationApprovalState(calculationApprovalState)
  ) {
    throw new ComplianceDomainError(
      "INVALID_ACTIVITY_RECORD",
      500,
      "The governed compliance activity contains an unsupported state.",
    );
  }
  const legalName = String(row.organisation_legal_name);
  const tradingName = String(row.organisation_trading_name || "");
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    organisationCode: String(row.organisation_code),
    organisationLegalName: legalName,
    organisationTradingName: tradingName,
    organisationName: tradingName || legalName,
    programId: String(row.program_id),
    programCode: String(row.program_code),
    programName: String(row.program_name),
    schemeKind: String(row.scheme_kind),
    programJurisdiction: String(row.program_jurisdiction),
    administeringBody: String(row.administering_body),
    activityKey: String(row.activity_key),
    version: Number(row.version),
    title: String(row.title),
    serviceCategory,
    registryActivityCode: String(row.registry_activity_code || ""),
    specificationPart: String(row.specification_part || ""),
    productCategory: String(row.product_category),
    scenarioCode: String(row.scenario_code || ""),
    scenario: String(row.scenario),
    jurisdiction: String(row.jurisdiction),
    effectiveFrom: String(row.effective_from),
    effectiveTo: String(row.effective_to || ""),
    officialSourceUrl: String(row.official_source_url),
    officialSourceTitle: String(row.official_source_title),
    officialSourceVersion: String(row.official_source_version || ""),
    officialSourceSha256: String(row.official_source_sha256 || ""),
    officialSourceCheckedAt: String(row.official_source_checked_at),
    requirementsSnapshot: parseJsonObject(row.requirements_snapshot),
    requirementsSnapshotJson: String(row.requirements_snapshot || "{}"),
    publishState,
    publicationRequestId: String(row.publication_request_id || ""),
    publicationSnapshotSha256: String(
      row.publication_snapshot_sha256 || "",
    ),
    pendingPublicationRequestId: String(
      row.pending_publication_request_id || "",
    ),
    calculationApprovalState,
    publishedAt: String(row.published_at || ""),
    withdrawnAt: String(row.withdrawn_at || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const ACTIVITY_SELECT = `SELECT
    activity.id,
    organisation.id organisation_id,
    organisation.organisation_code,
    organisation.legal_name organisation_legal_name,
    organisation.trading_name organisation_trading_name,
    organisation.status organisation_status,
    program.id program_id,
    program.program_code,
    program.name program_name,
    program.scheme_kind,
    program.jurisdiction program_jurisdiction,
    program.administering_body,
    program.official_source_sha256 program_official_source_sha256,
    program.publish_state program_publish_state,
    activity.activity_key,
    activity.version,
    activity.title,
    activity.service_category,
    activity.registry_activity_code,
    activity.specification_part,
    activity.product_category,
    activity.scenario_code,
    activity.scenario,
    activity.jurisdiction,
    activity.effective_from,
    activity.effective_to,
    activity.official_source_url,
    activity.official_source_title,
    activity.official_source_version,
    activity.official_source_sha256,
    activity.official_source_checked_at,
    activity.requirements_snapshot,
    activity.publish_state,
    activity.publication_request_id,
    activity.publication_snapshot_sha256,
    COALESCE((
      SELECT governance.id
      FROM compliance_governance_requests governance
      WHERE governance.organisation_id = organisation.id
        AND governance.target_type = 'activity'
        AND governance.target_id = activity.id
        AND governance.action = 'publish'
        AND governance.status = 'pending'
      LIMIT 1
    ), '') pending_publication_request_id,
    activity.calculation_approval_state,
    activity.published_at,
    activity.withdrawn_at,
    activity.created_at,
    activity.updated_at
  FROM compliance_activity_versions activity
  JOIN compliance_programs program ON program.id = activity.program_id
  JOIN compliance_organisations organisation
    ON organisation.id = program.organisation_id`;

export type InstallerActivityFilters = {
  serviceCategory?: string;
  jurisdiction?: string;
  organisationCode?: string;
  programCode?: string;
  registryActivityCode?: string;
  activityKey?: string;
  onDate?: string;
  afterActivityId?: string;
  limit?: number;
};

export async function listInstallerSelectableActivities(
  database: D1Database,
  filters: InstallerActivityFilters = {},
) {
  const onDate = filters.onDate
    ? checkedDate(filters.onDate, "INVALID_ACTIVITY_DATE", "Activity date")
    : new Date().toISOString().slice(0, 10);
  const serviceCategory = cleanText(filters.serviceCategory, 60);
  if (serviceCategory && !isComplianceServiceCategory(serviceCategory)) {
    throw new ComplianceDomainError(
      "INVALID_SERVICE_CATEGORY",
      400,
      "Choose a current TLink service category.",
    );
  }
  const jurisdiction = cleanText(filters.jurisdiction, 20).toUpperCase();
  if (jurisdiction && !isComplianceJurisdiction(jurisdiction)) {
    throw new ComplianceDomainError(
      "INVALID_JURISDICTION",
      400,
      "Choose Australia or an Australian state or territory.",
    );
  }
  const organisationCode = cleanText(filters.organisationCode, 80);
  const programCode = cleanText(filters.programCode, 80);
  const registryActivityCode = cleanText(filters.registryActivityCode, 120);
  const activityKey = cleanText(filters.activityKey, 180);
  const afterActivityId = cleanText(filters.afterActivityId, 180);
  const conditions = [
    "organisation.status = 'active'",
    "program.publish_state = 'published'",
    "activity.publish_state = 'published'",
    "activity.effective_from <= ?",
    "(activity.effective_to = '' OR activity.effective_to >= ?)",
    `EXISTS (
      SELECT 1 FROM compliance_evidence_policy_versions evidence_policy
      WHERE evidence_policy.organisation_id = organisation.id
        AND evidence_policy.activity_version_id = activity.id
        AND evidence_policy.publish_state = 'published'
        AND evidence_policy.requirements_complete = 1
    )`,
  ];
  const bindings: unknown[] = [onDate, onDate];
  if (serviceCategory) {
    conditions.push("activity.service_category = ?");
    bindings.push(serviceCategory);
  }
  if (jurisdiction) {
    conditions.push("(activity.jurisdiction = ? OR activity.jurisdiction = 'AU')");
    bindings.push(jurisdiction);
  }
  if (organisationCode) {
    conditions.push("organisation.organisation_code = ?");
    bindings.push(organisationCode);
  }
  if (programCode) {
    conditions.push("program.program_code = ?");
    bindings.push(programCode);
  }
  if (registryActivityCode) {
    conditions.push("activity.registry_activity_code = ?");
    bindings.push(registryActivityCode);
  }
  if (activityKey) {
    conditions.push("activity.activity_key = ?");
    bindings.push(activityKey);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filters.limit || 200)));
  const selectable = [];
  let scanAfterActivityId = afterActivityId;
  const scanLimit = Math.min(500, Math.max(50, limit * 2));
  while (selectable.length < limit) {
    const scanConditions = [...conditions];
    const scanBindings = [...bindings];
    if (scanAfterActivityId) {
      scanConditions.push("activity.id > ?");
      scanBindings.push(scanAfterActivityId);
    }
    const rows = await database.prepare(`${ACTIVITY_SELECT}
      WHERE ${scanConditions.join(" AND ")}
      ORDER BY activity.id ASC
      LIMIT ?`)
      .bind(...scanBindings, scanLimit)
      .all<Record<string, unknown>>();
    if (!rows.results.length) break;
    for (const row of rows.results) {
      const activity = activityProjection(row);
      scanAfterActivityId = activity.id;
      try {
        await requireCurrentApprovedOfficialSourceBinding(
          database,
          activity.organisationId,
          "program",
          activity.programId,
          String(row.program_official_source_sha256 || ""),
        );
        await requireCurrentApprovedOfficialSourceBinding(
          database,
          activity.organisationId,
          "activity",
          activity.id,
          activity.officialSourceSha256,
        );
        const evidencePolicy = await database.prepare(`SELECT
            evidence_policy.id,
            evidence_policy.official_source_sha256
          FROM compliance_evidence_policy_versions evidence_policy
          WHERE evidence_policy.organisation_id = ?
            AND evidence_policy.activity_version_id = ?
            AND evidence_policy.publish_state = 'published'
            AND evidence_policy.requirements_complete = 1
          ORDER BY evidence_policy.version DESC, evidence_policy.id DESC
          LIMIT 1`)
          .bind(activity.organisationId, activity.id)
          .first<Record<string, unknown>>();
        if (!evidencePolicy) continue;
        await requireCurrentApprovedOfficialSourceBinding(
          database,
          activity.organisationId,
          "evidence_policy",
          String(evidencePolicy.id),
          String(evidencePolicy.official_source_sha256),
        );
        selectable.push(activity);
        if (selectable.length >= limit) break;
      } catch (error) {
        if (error instanceof CreditexSourceLookupReviewError) continue;
        throw error;
      }
    }
    if (rows.results.length < scanLimit) break;
  }
  return selectable;
}

export async function resolveLiveComplianceActivity(
  database: D1Database,
  activityVersionId: string,
  onDate = new Date().toISOString().slice(0, 10),
) {
  const id = requiredText(
    activityVersionId,
    180,
    "ACTIVITY_REQUIRED",
    "Activity version",
  );
  const caseDate = checkedDate(onDate, "INVALID_ACTIVITY_DATE", "Activity date");
  const row = await database.prepare(`${ACTIVITY_SELECT}
    WHERE activity.id = ?
    LIMIT 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new ComplianceDomainError(
      "ACTIVITY_NOT_FOUND",
      404,
      "The selected compliance activity version does not exist.",
    );
  }
  const activity = activityProjection(row);
  if (String(row.organisation_status) !== "active") {
    throw new ComplianceDomainError(
      "COMPLIANCE_ORGANISATION_INACTIVE",
      409,
      "The selected compliance organisation is not active.",
    );
  }
  if (String(row.program_publish_state) !== "published") {
    throw new ComplianceDomainError(
      "PROGRAM_NOT_PUBLISHED",
      409,
      "The selected compliance program is not published.",
    );
  }
  if (activity.publishState !== "published") {
    throw new ComplianceDomainError(
      "ACTIVITY_NOT_PUBLISHED",
      409,
      "The selected compliance activity version is not published.",
    );
  }
  try {
    await requireCurrentApprovedOfficialSourceBinding(
      database,
      activity.organisationId,
      "program",
      activity.programId,
      String(row.program_official_source_sha256 || ""),
    );
    await requireCurrentApprovedOfficialSourceBinding(
      database,
      activity.organisationId,
      "activity",
      activity.id,
      activity.officialSourceSha256,
    );
  } catch {
    throw new ComplianceDomainError(
      "CURRENT_SOURCE_APPROVAL_REQUIRED",
      409,
      "The selected compliance activity is unavailable until its exact official-source approvals are current.",
    );
  }
  if (activity.effectiveFrom > caseDate) {
    throw new ComplianceDomainError(
      "ACTIVITY_NOT_STARTED",
      409,
      "The selected compliance activity version is not yet effective.",
    );
  }
  if (activity.effectiveTo && activity.effectiveTo < caseDate) {
    throw new ComplianceDomainError(
      "ACTIVITY_EXPIRED",
      409,
      "The selected compliance activity version has expired.",
    );
  }
  return activity;
}

export async function listCompliancePrograms(
  database: D1Database,
  organisationId: string,
) {
  const id = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const rows = await database.prepare(`SELECT
      id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_version, official_source_sha256,
      official_source_checked_at, publish_state, publication_request_id,
      publication_snapshot_sha256,
      COALESCE((
        SELECT governance.id
        FROM compliance_governance_requests governance
        WHERE governance.organisation_id = compliance_programs.organisation_id
          AND governance.target_type = 'program'
          AND governance.target_id = compliance_programs.id
          AND governance.action = 'publish'
          AND governance.status = 'pending'
        LIMIT 1
      ), '') pending_publication_request_id,
      published_at, withdrawn_at,
      created_at, updated_at
    FROM compliance_programs
    WHERE organisation_id = ?
    ORDER BY name, program_code`)
    .bind(id)
    .all<Record<string, unknown>>();
  return rows.results.map((row): ComplianceProgramProjection => ({
    id: String(row.id),
    organisationId: String(row.organisation_id),
    programCode: String(row.program_code),
    name: String(row.name),
    schemeKind: String(row.scheme_kind),
    jurisdiction: String(row.jurisdiction),
    administeringBody: String(row.administering_body),
    officialSourceUrl: String(row.official_source_url),
    officialSourceTitle: String(row.official_source_title),
    officialSourceVersion: String(row.official_source_version || ""),
    officialSourceSha256: String(row.official_source_sha256 || ""),
    officialSourceCheckedAt: String(row.official_source_checked_at),
    publishState: String(row.publish_state) as CompliancePublishState,
    publicationRequestId: String(row.publication_request_id || ""),
    publicationSnapshotSha256: String(
      row.publication_snapshot_sha256 || "",
    ),
    pendingPublicationRequestId: String(
      row.pending_publication_request_id || "",
    ),
    publishedAt: String(row.published_at || ""),
    withdrawnAt: String(row.withdrawn_at || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export type ComplianceActivityListFilters = {
  programId?: string;
  publishState?: CompliancePublishState;
  serviceCategory?: string;
};

export async function listComplianceActivityVersions(
  database: D1Database,
  organisationId: string,
  filters: ComplianceActivityListFilters = {},
) {
  const id = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const conditions = ["organisation.id = ?"];
  const bindings: unknown[] = [id];
  const programId = cleanText(filters.programId, 180);
  if (programId) {
    conditions.push("program.id = ?");
    bindings.push(programId);
  }
  if (filters.publishState) {
    if (!isCompliancePublishState(filters.publishState)) {
      throw new ComplianceDomainError(
        "INVALID_PUBLISH_STATE",
        400,
        "The activity publish state is invalid.",
      );
    }
    conditions.push("activity.publish_state = ?");
    bindings.push(filters.publishState);
  }
  const serviceCategory = cleanText(filters.serviceCategory, 60);
  if (serviceCategory) {
    if (!isComplianceServiceCategory(serviceCategory)) {
      throw new ComplianceDomainError(
        "INVALID_SERVICE_CATEGORY",
        400,
        "Choose a current TLink service category.",
      );
    }
    conditions.push("activity.service_category = ?");
    bindings.push(serviceCategory);
  }
  const rows = await database.prepare(`${ACTIVITY_SELECT}
    WHERE ${conditions.join(" AND ")}
    ORDER BY program.name, activity.activity_key, activity.version DESC`)
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return rows.results.map(activityProjection);
}

export type ComplianceSourceInput = {
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion?: string;
  officialSourceSha256?: string;
  officialSourceCheckedAt: string;
};

function checkedSource(input: ComplianceSourceInput) {
  return {
    officialSourceUrl: checkedHttpsUrl(
      input.officialSourceUrl,
      "INVALID_SOURCE_URL",
      "Official source URL",
    ),
    officialSourceTitle: requiredText(
      input.officialSourceTitle,
      300,
      "INVALID_SOURCE_TITLE",
      "Official source title",
    ),
    officialSourceVersion: cleanText(input.officialSourceVersion, 160),
    officialSourceSha256: checkedSourceSha256(input.officialSourceSha256),
    officialSourceCheckedAt: checkedInstant(
      input.officialSourceCheckedAt,
      "INVALID_SOURCE_CHECKED_AT",
      "Official source checked time",
    ),
  };
}

export type CreateComplianceProgramInput = ComplianceSourceInput & {
  id?: string;
  organisationId: string;
  programCode: string;
  name: string;
  schemeKind: string;
  jurisdiction: string;
  administeringBody: string;
  actorUid: string;
  createdAt?: string;
};

export function prepareComplianceProgramCreateStatement(
  database: D1Database,
  input: CreateComplianceProgramInput,
) {
  const id = cleanText(input.id, 180) || crypto.randomUUID();
  const now = input.createdAt
    ? checkedInstant(input.createdAt, "INVALID_CREATED_AT", "Created time")
    : new Date().toISOString();
  const source = checkedSource(input);
  const organisationId = requiredText(
    input.organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const programCode = requiredText(
    input.programCode,
    80,
    "INVALID_PROGRAM_CODE",
    "Program code",
  );
  const name = requiredText(input.name, 240, "INVALID_PROGRAM_NAME", "Program name");
  const schemeKind = checkedInternalKey(
    input.schemeKind,
    60,
    "INVALID_SCHEME_KIND",
    "Scheme kind",
  );
  const jurisdiction = checkedComplianceJurisdiction(input.jurisdiction);
  const administeringBody = requiredText(
    input.administeringBody,
    240,
    "INVALID_ADMINISTERING_BODY",
    "Administering body",
  );
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  return {
    id,
    statement: database.prepare(`INSERT INTO compliance_programs
      (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
       administering_body, official_source_url, official_source_title,
       official_source_version, official_source_sha256,
       official_source_checked_at, publish_state, created_by_uid,
       created_at, updated_at)
      SELECT ?, organisation.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?
      FROM compliance_organisations organisation
      WHERE organisation.id = ? AND organisation.status = 'active'`)
      .bind(
        id,
        programCode,
        name,
        schemeKind,
        jurisdiction,
        administeringBody,
        source.officialSourceUrl,
        source.officialSourceTitle,
        source.officialSourceVersion,
        source.officialSourceSha256,
        source.officialSourceCheckedAt,
        actorUid,
        now,
        now,
        organisationId,
      ),
  };
}

export function prepareComplianceProgramPublishStatement(
  database: D1Database,
  organisationId: string,
  programId: string,
  actorUid: string,
  publishedAt = new Date().toISOString(),
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(programId, 180, "PROGRAM_REQUIRED", "Program");
  const actor = requiredText(actorUid, 180, "ACTOR_REQUIRED", "Actor");
  const now = checkedInstant(
    publishedAt,
    "INVALID_PUBLISHED_AT",
    "Published time",
  );
  return database.prepare(`UPDATE compliance_programs
    SET publish_state = 'published', published_by_uid = ?, published_at = ?,
      withdrawn_by_uid = '', withdrawn_at = '', updated_at = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
      AND official_source_url <> ''
      AND official_source_title <> ''
      AND official_source_checked_at <> ''
      AND length(official_source_sha256) = 64`)
    .bind(actor, now, now, id, organisation);
}

export async function prepareComplianceProgramWithdrawStatement(
  database: D1Database,
  organisationId: string,
  programId: string,
  actorUid: string,
  withdrawnAt = new Date().toISOString(),
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(programId, 180, "PROGRAM_REQUIRED", "Program");
  const actor = requiredText(actorUid, 180, "ACTOR_REQUIRED", "Actor");
  const now = checkedInstant(
    withdrawnAt,
    "INVALID_WITHDRAWN_AT",
    "Withdrawn time",
  );
  await requireNamedActiveAdmin(
    database,
    organisation,
    actor,
    "withdrawer",
  );
  return database.prepare(`UPDATE compliance_programs
    SET publish_state = 'withdrawn', withdrawn_by_uid = ?, withdrawn_at = ?,
      updated_at = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'published'`)
    .bind(actor, now, now, id, organisation);
}

export function prepareComplianceProgramDraftDeleteStatement(
  database: D1Database,
  organisationId: string,
  programId: string,
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(programId, 180, "PROGRAM_REQUIRED", "Program");
  return database.prepare(`DELETE FROM compliance_programs
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_versions activity
        WHERE activity.program_id = compliance_programs.id
      )`)
    .bind(id, organisation);
}

export type CreateComplianceActivityInput = ComplianceSourceInput & {
  id?: string;
  organisationId: string;
  programId: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: string;
  registryActivityCode?: string;
  specificationPart?: string;
  productCategory: string;
  scenarioCode?: string;
  scenario: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo?: string;
  requirementsSnapshot?: unknown;
  calculationApprovalState?: ComplianceCalculationApprovalState;
  actorUid: string;
  createdAt?: string;
};

export function prepareComplianceActivityCreateStatement(
  database: D1Database,
  input: CreateComplianceActivityInput,
) {
  const id = cleanText(input.id, 180) || crypto.randomUUID();
  const now = input.createdAt
    ? checkedInstant(input.createdAt, "INVALID_CREATED_AT", "Created time")
    : new Date().toISOString();
  const source = checkedSource(input);
  const organisationId = requiredText(
    input.organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const programId = requiredText(
    input.programId,
    180,
    "PROGRAM_REQUIRED",
    "Program",
  );
  const activityKey = checkedInternalKey(
    input.activityKey,
    100,
    "INVALID_ACTIVITY_KEY",
    "Activity key",
  );
  const version = Math.floor(Number(input.version));
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ComplianceDomainError(
      "INVALID_ACTIVITY_VERSION",
      400,
      "Activity version must be a positive integer.",
    );
  }
  if (!isComplianceServiceCategory(input.serviceCategory)) {
    throw new ComplianceDomainError(
      "INVALID_SERVICE_CATEGORY",
      400,
      "Choose a current TLink service category.",
    );
  }
  const effectiveFrom = checkedDate(
    input.effectiveFrom,
    "INVALID_EFFECTIVE_FROM",
    "Effective from",
  );
  const effectiveTo = checkedOptionalDate(
    input.effectiveTo,
    "INVALID_EFFECTIVE_TO",
    "Effective to",
  );
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new ComplianceDomainError(
      "INVALID_EFFECTIVE_RANGE",
      400,
      "Effective to cannot be before effective from.",
    );
  }
  const jurisdiction = checkedComplianceJurisdiction(input.jurisdiction);
  const calculationApprovalState =
    input.calculationApprovalState || "not_assessed";
  if (!isCalculationApprovalState(calculationApprovalState)) {
    throw new ComplianceDomainError(
      "INVALID_CALCULATION_APPROVAL_STATE",
      400,
      "The calculation approval state is invalid.",
    );
  }
  const requirementsSnapshot = checkedJsonObject(
    input.requirementsSnapshot,
    "INVALID_REQUIREMENTS_SNAPSHOT",
    "Requirements snapshot",
  );
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  return {
    id,
    statement: database.prepare(`INSERT INTO compliance_activity_versions
      (id, program_id, activity_key, version, title, service_category,
       registry_activity_code, specification_part, product_category,
       scenario_code, scenario, jurisdiction, effective_from, effective_to,
       official_source_url, official_source_title, official_source_version,
       official_source_sha256, official_source_checked_at,
       requirements_snapshot, publish_state, calculation_approval_state,
       created_by_uid, created_at, updated_at)
      SELECT ?, program.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, 'draft', ?, ?, ?, ?
      FROM compliance_programs program
      WHERE program.id = ? AND program.organisation_id = ?
        AND program.publish_state <> 'withdrawn'
        AND (program.jurisdiction = 'AU' OR program.jurisdiction = ?)`)
      .bind(
        id,
        activityKey,
        version,
        requiredText(input.title, 300, "INVALID_ACTIVITY_TITLE", "Activity title"),
        input.serviceCategory,
        cleanText(input.registryActivityCode, 120),
        cleanText(input.specificationPart, 180),
        requiredText(
          input.productCategory,
          180,
          "INVALID_PRODUCT_CATEGORY",
          "Product category",
        ),
        cleanText(input.scenarioCode, 120),
        requiredText(input.scenario, 500, "INVALID_SCENARIO", "Scenario"),
        jurisdiction,
        effectiveFrom,
        effectiveTo,
        source.officialSourceUrl,
        source.officialSourceTitle,
        source.officialSourceVersion,
        source.officialSourceSha256,
        source.officialSourceCheckedAt,
        JSON.stringify(requirementsSnapshot),
        calculationApprovalState,
        actorUid,
        now,
        now,
        programId,
        organisationId,
        jurisdiction,
      ),
  };
}

export function prepareComplianceActivityPublishStatement(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  actorUid: string,
  publishedAt = new Date().toISOString(),
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(
    activityVersionId,
    180,
    "ACTIVITY_REQUIRED",
    "Activity version",
  );
  const actor = requiredText(actorUid, 180, "ACTOR_REQUIRED", "Actor");
  const now = checkedInstant(
    publishedAt,
    "INVALID_PUBLISHED_AT",
    "Published time",
  );
  return database.prepare(`UPDATE compliance_activity_versions
    SET publish_state = 'published', published_by_uid = ?, published_at = ?,
      withdrawn_by_uid = '', withdrawn_at = '', updated_at = ?
    WHERE id = ? AND publish_state = 'draft'
      AND official_source_url <> ''
      AND official_source_title <> ''
      AND official_source_checked_at <> ''
      AND length(official_source_sha256) = 64
      AND effective_from <> ''
      AND EXISTS (
        SELECT 1 FROM compliance_programs program
        WHERE program.id = compliance_activity_versions.program_id
          AND program.organisation_id = ?
          AND program.publish_state = 'published'
      )`)
    .bind(actor, now, now, id, organisation);
}

export async function prepareComplianceActivityWithdrawStatement(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  actorUid: string,
  withdrawnAt = new Date().toISOString(),
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(
    activityVersionId,
    180,
    "ACTIVITY_REQUIRED",
    "Activity version",
  );
  const actor = requiredText(actorUid, 180, "ACTOR_REQUIRED", "Actor");
  const now = checkedInstant(
    withdrawnAt,
    "INVALID_WITHDRAWN_AT",
    "Withdrawn time",
  );
  await requireNamedActiveAdmin(
    database,
    organisation,
    actor,
    "withdrawer",
  );
  return database.prepare(`UPDATE compliance_activity_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = ?, withdrawn_at = ?,
      updated_at = ?
    WHERE id = ? AND publish_state = 'published'
      AND EXISTS (
        SELECT 1 FROM compliance_programs program
        WHERE program.id = compliance_activity_versions.program_id
          AND program.organisation_id = ?
      )`)
    .bind(actor, now, now, id, organisation);
}

export function prepareComplianceActivityDraftDeleteStatement(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(
    activityVersionId,
    180,
    "ACTIVITY_REQUIRED",
    "Activity version",
  );
  return database.prepare(`DELETE FROM compliance_activity_versions
    WHERE id = ? AND publish_state = 'draft'
      AND EXISTS (
        SELECT 1 FROM compliance_programs program
        WHERE program.id = compliance_activity_versions.program_id
          AND program.organisation_id = ?
      )`)
    .bind(id, organisation);
}

export type ComplianceEvidenceRequirementProjection = {
  id: string;
  organisationId: string;
  policyVersionId: string;
  requirementCode: string;
  title: string;
  description: string;
  evidenceType: ComplianceEvidenceRequirementType;
  captureTiming: ComplianceEvidenceCaptureTiming;
  minimumCount: number;
  maximumCount: number;
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  dateStampRequired: boolean;
  installerSignatureRequired: boolean;
  customerSignatureRequired: boolean;
  allowedContentTypes: string[];
  conditionSnapshot: Record<string, unknown>;
  fieldSchema: Record<string, unknown>;
  sourceCitation: string;
  sortOrder: number;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
};

export type CompliancePolicyReadinessBlocker = {
  code: string;
  message: string;
  requirementId?: string;
};

export type CompliancePolicyReadiness = {
  ready: boolean;
  blockers: CompliancePolicyReadinessBlocker[];
  requirementCount: number;
  currentSnapshotSha256: string;
};

export type ComplianceEvidencePolicyProjection = {
  id: string;
  organisationId: string;
  programId: string;
  programCode: string;
  programName: string;
  programPublishState: CompliancePublishState;
  activityVersionId: string;
  activityKey: string;
  activityTitle: string;
  activityPublishState: CompliancePublishState;
  version: number;
  title: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  requirementsComplete: boolean;
  publishState: CompliancePublishState;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  pendingPublicationRequestId: string;
  contentRevision: number;
  publishedAt: string;
  withdrawnAt: string;
  createdAt: string;
  updatedAt: string;
  requirements: ComplianceEvidenceRequirementProjection[];
  readiness: CompliancePolicyReadiness;
};

export type ComplianceGovernanceRequestProjection = {
  id: string;
  organisationId: string;
  targetType: ComplianceGovernanceTargetType;
  targetId: string;
  targetLabel: string;
  action: "publish";
  sealedSnapshotSha256: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  requestReason: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAt: string;
  reviewNote: string;
  canReview: boolean;
  blockReason: string;
  createdAt: string;
  updatedAt: string;
};

const POLICY_SELECT = `SELECT
    policy.id, policy.organisation_id, policy.activity_version_id,
    policy.version, policy.title, policy.official_source_url,
    policy.official_source_title, policy.official_source_version,
    policy.official_source_sha256, policy.official_source_checked_at,
    policy.requirements_complete, policy.publish_state,
    policy.publication_request_id, policy.publication_snapshot_sha256,
    COALESCE((
      SELECT governance.id
      FROM compliance_governance_requests governance
      WHERE governance.organisation_id = policy.organisation_id
        AND governance.target_type = 'evidence_policy'
        AND governance.target_id = policy.id
        AND governance.action = 'publish'
        AND governance.status = 'pending'
      LIMIT 1
    ), '') pending_publication_request_id,
    policy.content_revision, policy.published_at, policy.withdrawn_at,
    policy.created_at, policy.updated_at,
    activity.activity_key, activity.title activity_title,
    activity.publish_state activity_publish_state,
    program.id program_id, program.program_code,
    program.name program_name, program.publish_state program_publish_state
  FROM compliance_evidence_policy_versions policy
  JOIN compliance_activity_versions activity
    ON activity.id = policy.activity_version_id
  JOIN compliance_programs program
    ON program.id = activity.program_id
    AND program.organisation_id = policy.organisation_id`;

const REQUIREMENT_SELECT = `SELECT
    requirement.id, requirement.organisation_id,
    requirement.policy_version_id, requirement.requirement_code,
    requirement.title, requirement.description, requirement.evidence_type,
    requirement.capture_timing, requirement.minimum_count,
    requirement.maximum_count, requirement.original_required,
    requirement.metadata_required, requirement.gps_required,
    requirement.date_stamp_required,
    requirement.installer_signature_required,
    requirement.customer_signature_required,
    requirement.allowed_content_types, requirement.condition_snapshot,
    requirement.field_schema, requirement.source_citation,
    requirement.sort_order, requirement.created_by_uid,
    requirement.created_at, requirement.updated_at
  FROM compliance_evidence_requirements requirement`;

function requirementProjection(
  row: Record<string, unknown>,
): ComplianceEvidenceRequirementProjection {
  const evidenceType = String(row.evidence_type);
  const captureTiming = String(row.capture_timing);
  if (
    !COMPLIANCE_EVIDENCE_REQUIREMENT_TYPES.includes(
      evidenceType as ComplianceEvidenceRequirementType,
    )
    || !COMPLIANCE_EVIDENCE_CAPTURE_TIMINGS.includes(
      captureTiming as ComplianceEvidenceCaptureTiming,
    )
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_RECORD",
      500,
      "A governed evidence requirement contains an unsupported type.",
    );
  }
  let allowedContentTypes: string[] = [];
  try {
    const parsed = JSON.parse(String(row.allowed_content_types || "[]"));
    if (Array.isArray(parsed)) {
      allowedContentTypes = parsed.map(String);
    }
  } catch {
    allowedContentTypes = [];
  }
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    policyVersionId: String(row.policy_version_id),
    requirementCode: String(row.requirement_code),
    title: String(row.title),
    description: String(row.description || ""),
    evidenceType: evidenceType as ComplianceEvidenceRequirementType,
    captureTiming: captureTiming as ComplianceEvidenceCaptureTiming,
    minimumCount: Number(row.minimum_count),
    maximumCount: Number(row.maximum_count),
    originalRequired: Number(row.original_required) === 1,
    metadataRequired: Number(row.metadata_required) === 1,
    gpsRequired: Number(row.gps_required) === 1,
    dateStampRequired: Number(row.date_stamp_required) === 1,
    installerSignatureRequired:
      Number(row.installer_signature_required) === 1,
    customerSignatureRequired:
      Number(row.customer_signature_required) === 1,
    allowedContentTypes,
    conditionSnapshot: parseJsonObject(row.condition_snapshot),
    fieldSchema: parseJsonObject(row.field_schema),
    sourceCitation: String(row.source_citation),
    sortOrder: Number(row.sort_order),
    createdByUid: String(row.created_by_uid),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function policySnapshot(
  policy: Omit<ComplianceEvidencePolicyProjection, "readiness">,
) {
  return {
    targetType: "evidence_policy",
    evidencePolicy: {
      id: policy.id,
      organisationId: policy.organisationId,
      programId: policy.programId,
      activityVersionId: policy.activityVersionId,
      version: policy.version,
      title: policy.title,
      officialSourceUrl: policy.officialSourceUrl,
      officialSourceTitle: policy.officialSourceTitle,
      officialSourceVersion: policy.officialSourceVersion,
      officialSourceSha256: policy.officialSourceSha256,
      officialSourceCheckedAt: policy.officialSourceCheckedAt,
      requirementsComplete: true,
      contentRevision: policy.contentRevision,
    },
    requirements: policy.requirements.map((requirement) => ({
      id: requirement.id,
      requirementCode: requirement.requirementCode,
      title: requirement.title,
      description: requirement.description,
      evidenceType: requirement.evidenceType,
      captureTiming: requirement.captureTiming,
      minimumCount: requirement.minimumCount,
      maximumCount: requirement.maximumCount,
      originalRequired: requirement.originalRequired,
      metadataRequired: requirement.metadataRequired,
      gpsRequired: requirement.gpsRequired,
      dateStampRequired: requirement.dateStampRequired,
      installerSignatureRequired: requirement.installerSignatureRequired,
      customerSignatureRequired: requirement.customerSignatureRequired,
      allowedContentTypes: requirement.allowedContentTypes,
      conditionSnapshot: requirement.conditionSnapshot,
      fieldSchema: requirement.fieldSchema,
      sourceCitation: requirement.sourceCitation,
      sortOrder: requirement.sortOrder,
    })),
  };
}

function policyReadinessBlockers(
  policy: Omit<ComplianceEvidencePolicyProjection, "readiness">,
) {
  const blockers: CompliancePolicyReadinessBlocker[] = [];
  const add = (
    code: string,
    message: string,
    requirementId?: string,
  ) => blockers.push({ code, message, ...(requirementId
    ? { requirementId }
    : {}) });
  if (policy.programPublishState !== "published") {
    add(
      "PROGRAM_NOT_PUBLISHED",
      "Publish the parent program through independent review first.",
    );
  }
  if (policy.activityPublishState !== "published") {
    add(
      "ACTIVITY_NOT_PUBLISHED",
      "Publish the parent activity version through independent review first.",
    );
  }
  if (
    !policy.officialSourceUrl
    || !policy.officialSourceTitle
    || !policy.officialSourceVersion
    || !policy.officialSourceCheckedAt
    || !/^[0-9a-f]{64}$/.test(policy.officialSourceSha256)
  ) {
    add(
      "POLICY_SOURCE_INCOMPLETE",
      "Record the exact source title, version, checked time and SHA-256.",
    );
  }
  if (!policy.requirements.length) {
    add(
      "POLICY_REQUIREMENTS_EMPTY",
      "Add at least one ordered evidence requirement.",
    );
  }
  const sortOrders = new Set<number>();
  const supportedEvidenceTypes = new Set<string>(
    CREDITEX_FIELD_SUPPORTED_EVIDENCE_TYPES,
  );
  const supportedContentTypes = new Set<string>(
    CREDITEX_FIELD_SUPPORTED_CONTENT_TYPES,
  );
  for (const requirement of policy.requirements) {
    if (sortOrders.has(requirement.sortOrder)) {
      add(
        "POLICY_REQUIREMENT_ORDER_DUPLICATE",
        "Every requirement needs a unique order.",
        requirement.id,
      );
    }
    sortOrders.add(requirement.sortOrder);
    if (!supportedEvidenceTypes.has(requirement.evidenceType)) {
      add(
        "POLICY_EVIDENCE_TYPE_UNSUPPORTED",
        `AEA Field cannot yet complete ${requirement.evidenceType} requirements.`,
        requirement.id,
      );
    }
    if (requirement.captureTiming !== "any") {
      add(
        "POLICY_CAPTURE_TIMING_UNSUPPORTED",
        `AEA Field cannot yet enforce ${requirement.captureTiming.replaceAll("_", " ")} capture timing against an authoritative job milestone. Use any timing or keep this requirement in draft.`,
        requirement.id,
      );
    }
    if (!requirement.allowedContentTypes.length) {
      add(
        "POLICY_CONTENT_TYPES_REQUIRED",
        "Choose at least one field-supported file type.",
        requirement.id,
      );
    } else if (
      requirement.allowedContentTypes.some((item) =>
        !supportedContentTypes.has(item)
      )
    ) {
      add(
        "POLICY_CONTENT_TYPE_UNSUPPORTED",
        "This requirement allows a file type that AEA Field cannot preserve and validate.",
        requirement.id,
      );
    }
    if (
      requirement.evidenceType === "photo"
      && requirement.allowedContentTypes.some((item) =>
        !item.startsWith("image/")
      )
    ) {
      add(
        "POLICY_PHOTO_CONTENT_TYPE_INVALID",
        "Photo requirements may allow only supported image types.",
        requirement.id,
      );
    }
    if (
      (
        requirement.evidenceType === "photo"
        || (
          requirement.evidenceType === "document"
          && (requirement.gpsRequired || requirement.metadataRequired)
        )
      )
      && !requirement.allowedContentTypes.includes("image/jpeg")
    ) {
      add(
        "POLICY_CAMERA_JPEG_REQUIRED",
        "In-app camera requirements must allow JPEG camera output.",
        requirement.id,
      );
    }
    if (requirement.originalRequired) {
      add(
        "POLICY_ORIGINAL_ATTESTATION_REQUIRED",
        "Trusted device attestation is not yet available to prove an unedited camera original. Keep this requirement in draft.",
        requirement.id,
      );
    }
    if (Object.keys(requirement.conditionSnapshot).length) {
      add(
        "POLICY_CONDITIONS_UNSUPPORTED",
        "Conditional evidence logic is not yet evaluated by AEA Field.",
        requirement.id,
      );
    }
    if (
      requirement.installerSignatureRequired
      || requirement.customerSignatureRequired
    ) {
      add(
        "POLICY_SIGNATURES_UNSUPPORTED",
        "Field signature capture is not yet governed by this workflow.",
        requirement.id,
      );
    }
    if (Object.keys(requirement.fieldSchema).length) {
      add(
        "POLICY_FIELD_SCHEMA_UNSUPPORTED",
        "Dynamic evidence fields are not yet rendered by AEA Field.",
        requirement.id,
      );
    }
  }
  return blockers;
}

async function evidencePolicyProjection(
  row: Record<string, unknown>,
  requirements: ComplianceEvidenceRequirementProjection[],
): Promise<ComplianceEvidencePolicyProjection> {
  const publishState = String(row.publish_state);
  const programPublishState = String(row.program_publish_state);
  const activityPublishState = String(row.activity_publish_state);
  if (
    !isCompliancePublishState(publishState)
    || !isCompliancePublishState(programPublishState)
    || !isCompliancePublishState(activityPublishState)
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_POLICY_RECORD",
      500,
      "A governed evidence policy contains an unsupported state.",
    );
  }
  const base: Omit<ComplianceEvidencePolicyProjection, "readiness"> = {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    programId: String(row.program_id),
    programCode: String(row.program_code),
    programName: String(row.program_name),
    programPublishState,
    activityVersionId: String(row.activity_version_id),
    activityKey: String(row.activity_key),
    activityTitle: String(row.activity_title),
    activityPublishState,
    version: Number(row.version),
    title: String(row.title),
    officialSourceUrl: String(row.official_source_url),
    officialSourceTitle: String(row.official_source_title),
    officialSourceVersion: String(row.official_source_version),
    officialSourceSha256: String(row.official_source_sha256).toLowerCase(),
    officialSourceCheckedAt: String(row.official_source_checked_at),
    requirementsComplete: Number(row.requirements_complete) === 1,
    publishState,
    publicationRequestId: String(row.publication_request_id || ""),
    publicationSnapshotSha256: String(
      row.publication_snapshot_sha256 || "",
    ),
    pendingPublicationRequestId: String(
      row.pending_publication_request_id || "",
    ),
    contentRevision: Number(row.content_revision || 1),
    publishedAt: String(row.published_at || ""),
    withdrawnAt: String(row.withdrawn_at || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    requirements,
  };
  const snapshot = canonicalComplianceSnapshot(policySnapshot(base));
  const blockers = policyReadinessBlockers(base);
  return {
    ...base,
    readiness: {
      ready: blockers.length === 0,
      blockers,
      requirementCount: requirements.length,
      currentSnapshotSha256: await complianceSnapshotSha256(snapshot),
    },
  };
}

async function loadEvidencePolicy(
  database: D1Database,
  organisationId: string,
  policyId: string,
) {
  const row = await database.prepare(`${POLICY_SELECT}
    WHERE policy.organisation_id = ? AND policy.id = ?
    LIMIT 1`)
    .bind(organisationId, policyId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new ComplianceDomainError(
      "EVIDENCE_POLICY_NOT_FOUND",
      404,
      "The evidence policy was not found in this organisation.",
    );
  }
  const requirementRows = await database.prepare(`${REQUIREMENT_SELECT}
    WHERE requirement.organisation_id = ?
      AND requirement.policy_version_id = ?
    ORDER BY requirement.sort_order, requirement.requirement_code,
      requirement.id`)
    .bind(organisationId, policyId)
    .all<Record<string, unknown>>();
  return evidencePolicyProjection(
    row,
    requirementRows.results.map(requirementProjection),
  );
}

export type ComplianceGovernanceListFilters = {
  programId?: string;
  activityVersionId?: string;
  page?: number;
  pageSize?: number;
};

function checkedGovernanceListPage(filters: ComplianceGovernanceListFilters) {
  const page = Math.floor(Number(filters.page || 1));
  const pageSize = Math.floor(Number(filters.pageSize || 100));
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || page > 10_000
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 100
  ) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_PAGE",
      400,
      "Choose a governance page from 1 to 10,000 with up to 100 records.",
    );
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function listComplianceEvidencePolicies(
  database: D1Database,
  organisationId: string,
  filters: ComplianceGovernanceListFilters = {},
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const { page, pageSize, offset } = checkedGovernanceListPage(filters);
  const conditions = ["policy.organisation_id = ?"];
  const bindings: unknown[] = [organisation];
  const programId = cleanText(filters.programId, 180);
  const activityVersionId = cleanText(filters.activityVersionId, 180);
  if (programId) {
    conditions.push("program.id = ?");
    bindings.push(programId);
  }
  if (activityVersionId) {
    conditions.push("activity.id = ?");
    bindings.push(activityVersionId);
  }
  const totalRow = await database.prepare(`SELECT COUNT(*) total
      FROM compliance_evidence_policy_versions policy
      JOIN compliance_activity_versions activity
        ON activity.id = policy.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
        AND program.organisation_id = policy.organisation_id
      WHERE ${conditions.join(" AND ")}`)
    .bind(...bindings)
    .first<Record<string, unknown>>();
  const total = Number(totalRow?.total || 0);
  const policyRows = await database.prepare(`${POLICY_SELECT}
    WHERE ${conditions.join(" AND ")}
    ORDER BY program.name, activity.activity_key, policy.version DESC,
      policy.id
    LIMIT ? OFFSET ?`)
    .bind(...bindings, pageSize, offset)
    .all<Record<string, unknown>>();
  const ids = policyRows.results.map((row) => String(row.id));
  if (!ids.length) {
    return {
      items: [] as ComplianceEvidencePolicyProjection[],
      pagination: {
        page,
        pageSize,
        total,
        hasNext: offset + pageSize < total,
      },
    };
  }
  const placeholders = ids.map(() => "?").join(", ");
  const requirementRows = await database.prepare(`${REQUIREMENT_SELECT}
    WHERE requirement.organisation_id = ?
      AND requirement.policy_version_id IN (${placeholders})
    ORDER BY requirement.policy_version_id, requirement.sort_order,
      requirement.requirement_code, requirement.id
    LIMIT 10001`)
    .bind(organisation, ...ids)
    .all<Record<string, unknown>>();
  if (requirementRows.results.length > 10_000) {
    throw new ComplianceDomainError(
      "EVIDENCE_REQUIREMENT_SCOPE_TOO_LARGE",
      409,
      "This policy page contains more than 10,000 evidence requirements. Select one activity before continuing.",
    );
  }
  const grouped = new Map<string, ComplianceEvidenceRequirementProjection[]>();
  for (const row of requirementRows.results) {
    const requirement = requirementProjection(row);
    const list = grouped.get(requirement.policyVersionId) || [];
    list.push(requirement);
    grouped.set(requirement.policyVersionId, list);
  }
  return {
    items: await Promise.all(policyRows.results.map((row) =>
      evidencePolicyProjection(row, grouped.get(String(row.id)) || [])
    )),
    pagination: {
      page,
      pageSize,
      total,
      hasNext: offset + pageSize < total,
    },
  };
}

function namedAdminRecord(row: Record<string, unknown> | null) {
  const email = String(row?.email || "").trim().toLowerCase();
  return Boolean(
    row
    && String(row.role) === "admin"
    && String(row.status) === "active"
    && Number(row.governance_identity_verified) === 1
    && String(row.governance_identity_verified_by_uid || "").trim()
    && String(row.governance_identity_verified_by_uid)
      !== String(row.firebase_uid)
    && String(row.governance_identity_verified_at || "").trim()
    && String(row.governance_identity_verification_basis || "").trim()
    && String(row.display_name || "").trim()
    && email.includes("@")
  );
}

export async function listComplianceGovernanceRequests(
  database: D1Database,
  organisationId: string,
  currentUid = "",
  filters: ComplianceGovernanceListFilters = {},
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const uid = cleanText(currentUid, 180);
  const { page, pageSize, offset } = checkedGovernanceListPage(filters);
  const conditions = ["request.organisation_id = ?"];
  const bindings: unknown[] = [organisation];
  const programId = cleanText(filters.programId, 180);
  const activityVersionId = cleanText(filters.activityVersionId, 180);
  if (programId) {
    conditions.push(`(
      (request.target_type = 'program' AND request.target_id = ?)
      OR (
        request.target_type = 'activity'
        AND EXISTS (
          SELECT 1 FROM compliance_activity_versions scoped_activity
          WHERE scoped_activity.id = request.target_id
            AND scoped_activity.program_id = ?
        )
      )
      OR (
        request.target_type = 'evidence_policy'
        AND EXISTS (
          SELECT 1
          FROM compliance_evidence_policy_versions scoped_policy
          JOIN compliance_activity_versions scoped_policy_activity
            ON scoped_policy_activity.id = scoped_policy.activity_version_id
          WHERE scoped_policy.id = request.target_id
            AND scoped_policy_activity.program_id = ?
        )
      )
    )`);
    bindings.push(programId, programId, programId);
  }
  if (activityVersionId) {
    conditions.push(`(
      (request.target_type = 'activity' AND request.target_id = ?)
      OR (
        request.target_type = 'evidence_policy'
        AND EXISTS (
          SELECT 1 FROM compliance_evidence_policy_versions scoped_policy
          WHERE scoped_policy.id = request.target_id
            AND scoped_policy.activity_version_id = ?
        )
      )
    )`);
    bindings.push(activityVersionId, activityVersionId);
  }
  const currentMember = uid
    ? await database.prepare(`SELECT member.firebase_uid, member.role,
        member.status, member.display_name, member.email,
        member.governance_identity_verified,
        member.governance_identity_verified_by_uid,
        member.governance_identity_verified_at,
        member.governance_identity_verification_basis
        FROM compliance_users member
        WHERE member.organisation_id = ? AND member.firebase_uid = ?
        LIMIT 1`)
      .bind(organisation, uid)
      .first<Record<string, unknown>>()
    : null;
  const currentCanReview = namedAdminRecord(currentMember);
  const totals = await database.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN request.status = 'pending' THEN 1 ELSE 0 END) pending
    FROM compliance_governance_requests request
    WHERE ${conditions.join(" AND ")}`)
    .bind(...bindings)
    .first<Record<string, unknown>>();
  const total = Number(totals?.total || 0);
  const pending = Number(totals?.pending || 0);
  const rows = await database.prepare(`SELECT request.*,
      COALESCE(requester.display_name, '') requested_by_name,
      COALESCE(reviewer.display_name, '') reviewed_by_name,
      CASE request.target_type
        WHEN 'program' THEN COALESCE((
          SELECT program.program_code || ' | ' || program.name
          FROM compliance_programs program
          WHERE program.id = request.target_id
            AND program.organisation_id = request.organisation_id
        ), 'Deleted program draft')
        WHEN 'activity' THEN COALESCE((
          SELECT program.program_code || ' | ' ||
            COALESCE(NULLIF(activity.registry_activity_code, ''),
              activity.activity_key) || ' | ' || activity.title
          FROM compliance_activity_versions activity
          JOIN compliance_programs program
            ON program.id = activity.program_id
          WHERE activity.id = request.target_id
            AND program.organisation_id = request.organisation_id
        ), 'Deleted activity draft')
        ELSE COALESCE((
          SELECT program.program_code || ' | ' || activity.activity_key ||
            ' | Evidence policy ' || policy.version
          FROM compliance_evidence_policy_versions policy
          JOIN compliance_activity_versions activity
            ON activity.id = policy.activity_version_id
          JOIN compliance_programs program
            ON program.id = activity.program_id
          WHERE policy.id = request.target_id
            AND policy.organisation_id = request.organisation_id
        ), 'Deleted evidence-policy draft')
      END target_label
    FROM compliance_governance_requests request
    LEFT JOIN compliance_users requester
      ON requester.organisation_id = request.organisation_id
      AND requester.firebase_uid = request.requested_by_uid
    LEFT JOIN compliance_users reviewer
      ON reviewer.organisation_id = request.organisation_id
      AND reviewer.firebase_uid = request.reviewed_by_uid
    WHERE ${conditions.join(" AND ")}
    ORDER BY request.status = 'pending' DESC, request.requested_at DESC,
      request.id DESC
    LIMIT ? OFFSET ?`)
    .bind(...bindings, pageSize, offset)
    .all<Record<string, unknown>>();
  const items = rows.results.map((row): ComplianceGovernanceRequestProjection => {
    const targetType = String(row.target_type);
    const status = String(row.status);
    if (
      !COMPLIANCE_GOVERNANCE_TARGET_TYPES.includes(
        targetType as ComplianceGovernanceTargetType,
      )
      || !["pending", "approved", "rejected", "superseded"].includes(status)
    ) {
      throw new ComplianceDomainError(
        "INVALID_GOVERNANCE_REQUEST_RECORD",
        500,
        "A publication request contains an unsupported state.",
      );
    }
    const selfReview = uid && uid === String(row.requested_by_uid);
    const canReview = status === "pending"
      && Boolean(uid)
      && !selfReview
      && currentCanReview;
    const blockReason = status !== "pending"
      ? "This publication request is no longer pending."
      : selfReview
        ? "A different named Creditex administrator must review this request."
        : !currentCanReview
          ? "Only a named active Creditex administrator can review publication."
          : "";
    return {
      id: String(row.id),
      organisationId: String(row.organisation_id),
      targetType: targetType as ComplianceGovernanceTargetType,
      targetId: String(row.target_id),
      targetLabel: String(row.target_label),
      action: "publish",
      sealedSnapshotSha256: String(row.sealed_snapshot_sha256),
      status: status as ComplianceGovernanceRequestProjection["status"],
      requestReason: String(row.request_reason),
      requestedByUid: String(row.requested_by_uid),
      requestedByName: String(row.requested_by_name || ""),
      requestedAt: String(row.requested_at),
      reviewedByUid: String(row.reviewed_by_uid || ""),
      reviewedByName: String(row.reviewed_by_name || ""),
      reviewedAt: String(row.reviewed_at || ""),
      reviewNote: String(row.review_note || ""),
      canReview,
      blockReason,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      pending,
      hasNext: offset + pageSize < total,
    },
  };
}

export type CreateComplianceEvidencePolicyInput = ComplianceSourceInput & {
  id?: string;
  organisationId: string;
  activityVersionId: string;
  version: number;
  title: string;
  actorUid: string;
  createdAt?: string;
};

function checkedPolicyVersion(value: unknown) {
  return checkedPositiveInteger(value, "Evidence policy version");
}

function checkedPolicyTitle(value: unknown) {
  return requiredText(
    value,
    300,
    "INVALID_EVIDENCE_POLICY_TITLE",
    "Evidence policy title",
  );
}

async function requireDraftEvidencePolicy(
  database: D1Database,
  organisationId: string,
  policyId: string,
) {
  const policy = await loadEvidencePolicy(
    database,
    requiredText(
      organisationId,
      180,
      "ORGANISATION_REQUIRED",
      "Compliance organisation",
    ),
    requiredText(policyId, 180, "EVIDENCE_POLICY_REQUIRED", "Evidence policy"),
  );
  if (policy.publishState !== "draft") {
    throw new ComplianceDomainError(
      "EVIDENCE_POLICY_IMMUTABLE",
      409,
      "Published or withdrawn evidence policies cannot be changed.",
    );
  }
  return policy;
}

export function prepareCompliancePublicationSupersedeStatement(
  database: D1Database,
  organisationId: string,
  targetType: ComplianceGovernanceTargetType,
  targetId: string,
  supersededAt: string,
  note = "The governed draft changed after publication review was requested.",
) {
  return database.prepare(`UPDATE compliance_governance_requests
    SET status = 'superseded', reviewed_at = ?, review_note = ?,
      updated_at = ?
    WHERE organisation_id = ? AND target_type = ? AND target_id = ?
      AND action = 'publish' AND status = 'pending'`)
    .bind(
      supersededAt,
      note,
      supersededAt,
      organisationId,
      targetType,
      targetId,
    );
}

function bumpDraftPolicyStatement(
  database: D1Database,
  organisationId: string,
  policyId: string,
  updatedAt: string,
) {
  return database.prepare(`UPDATE compliance_evidence_policy_versions
    SET requirements_complete = 0, content_revision = content_revision + 1,
      updated_at = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'`)
    .bind(updatedAt, policyId, organisationId);
}

export function prepareComplianceEvidencePolicyCreateStatement(
  database: D1Database,
  input: CreateComplianceEvidencePolicyInput,
) {
  const id = cleanText(input.id, 180) || crypto.randomUUID();
  const now = input.createdAt
    ? checkedInstant(input.createdAt, "INVALID_CREATED_AT", "Created time")
    : new Date().toISOString();
  const source = checkedSource(input);
  if (!source.officialSourceSha256) {
    throw new ComplianceDomainError(
      "INVALID_SOURCE_SHA256",
      400,
      "Evidence-policy drafts require the exact source SHA-256.",
    );
  }
  const organisationId = requiredText(
    input.organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const activityVersionId = requiredText(
    input.activityVersionId,
    180,
    "ACTIVITY_REQUIRED",
    "Activity version",
  );
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  return {
    id,
    statement: database.prepare(`INSERT INTO compliance_evidence_policy_versions
      (id, organisation_id, activity_version_id, version, title,
       official_source_url, official_source_title, official_source_version,
       official_source_sha256, official_source_checked_at,
       requirements_complete, publish_state, content_revision,
       created_by_uid, created_at, updated_at)
      SELECT ?, program.organisation_id, activity.id, ?, ?, ?, ?, ?, ?, ?,
        0, 'draft', 1, ?, ?, ?
      FROM compliance_activity_versions activity
      JOIN compliance_programs program ON program.id = activity.program_id
      WHERE activity.id = ? AND program.organisation_id = ?
        AND activity.publish_state <> 'withdrawn'
        AND program.publish_state <> 'withdrawn'`)
      .bind(
        id,
        checkedPolicyVersion(input.version),
        checkedPolicyTitle(input.title),
        source.officialSourceUrl,
        source.officialSourceTitle,
        requiredText(
          source.officialSourceVersion,
          160,
          "INVALID_SOURCE_VERSION",
          "Official source version",
        ),
        source.officialSourceSha256,
        source.officialSourceCheckedAt,
        actorUid,
        now,
        now,
        activityVersionId,
        organisationId,
      ),
  };
}

export type UpdateComplianceEvidencePolicyInput = ComplianceSourceInput & {
  organisationId: string;
  policyId: string;
  title: string;
  updatedAt?: string;
};

export async function prepareComplianceEvidencePolicyUpdateStatements(
  database: D1Database,
  input: UpdateComplianceEvidencePolicyInput,
) {
  const policy = await requireDraftEvidencePolicy(
    database,
    input.organisationId,
    input.policyId,
  );
  const now = input.updatedAt
    ? checkedInstant(input.updatedAt, "INVALID_UPDATED_AT", "Updated time")
    : new Date().toISOString();
  const source = checkedSource(input);
  if (!source.officialSourceSha256) {
    throw new ComplianceDomainError(
      "INVALID_SOURCE_SHA256",
      400,
      "Evidence-policy drafts require the exact source SHA-256.",
    );
  }
  return {
    id: policy.id,
    statements: [
      prepareCompliancePublicationSupersedeStatement(
        database,
        policy.organisationId,
        "evidence_policy",
        policy.id,
        now,
      ),
      database.prepare(`UPDATE compliance_evidence_policy_versions
        SET title = ?, official_source_url = ?, official_source_title = ?,
          official_source_version = ?, official_source_sha256 = ?,
          official_source_checked_at = ?, requirements_complete = 0,
          content_revision = content_revision + 1, updated_at = ?
        WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'`)
        .bind(
          checkedPolicyTitle(input.title),
          source.officialSourceUrl,
          source.officialSourceTitle,
          requiredText(
            source.officialSourceVersion,
            160,
            "INVALID_SOURCE_VERSION",
            "Official source version",
          ),
          source.officialSourceSha256,
          source.officialSourceCheckedAt,
          now,
          policy.id,
          policy.organisationId,
        ),
    ],
  };
}

export type SaveComplianceEvidenceRequirementInput = {
  organisationId: string;
  policyId: string;
  requirementId?: string;
  requirementCode: string;
  title: string;
  description?: string;
  evidenceType: string;
  captureTiming: string;
  minimumCount: number;
  maximumCount: number;
  originalRequired?: boolean;
  metadataRequired?: boolean;
  gpsRequired?: boolean;
  dateStampRequired?: boolean;
  installerSignatureRequired?: boolean;
  customerSignatureRequired?: boolean;
  allowedContentTypes: unknown;
  conditionSnapshot?: unknown;
  fieldSchema?: unknown;
  sourceCitation: string;
  sortOrder: number;
  actorUid: string;
  updatedAt?: string;
};

function checkedRequirementInput(input: SaveComplianceEvidenceRequirementInput) {
  const evidenceType = cleanText(input.evidenceType, 40);
  const captureTiming = cleanText(input.captureTiming, 40);
  if (
    !COMPLIANCE_EVIDENCE_REQUIREMENT_TYPES.includes(
      evidenceType as ComplianceEvidenceRequirementType,
    )
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_TYPE",
      400,
      "Choose a supported evidence requirement type.",
    );
  }
  if (
    !COMPLIANCE_EVIDENCE_CAPTURE_TIMINGS.includes(
      captureTiming as ComplianceEvidenceCaptureTiming,
    )
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_CAPTURE_TIMING",
      400,
      "Choose a supported evidence capture time.",
    );
  }
  const minimumCount = checkedPositiveInteger(
    input.minimumCount,
    "Minimum count",
    { allowZero: true },
  );
  const maximumCount = checkedPositiveInteger(
    input.maximumCount,
    "Maximum count",
    { allowZero: true },
  );
  if (maximumCount !== 0 && maximumCount < minimumCount) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_COUNT",
      400,
      "Maximum count must be zero for unlimited or at least the minimum count.",
    );
  }
  return {
    requirementCode: checkedInternalKey(
      input.requirementCode,
      120,
      "INVALID_EVIDENCE_REQUIREMENT_CODE",
      "Requirement code",
    ),
    title: requiredText(
      input.title,
      300,
      "INVALID_EVIDENCE_REQUIREMENT_TITLE",
      "Requirement title",
    ),
    description: cleanText(input.description, 4_000),
    evidenceType: evidenceType as ComplianceEvidenceRequirementType,
    captureTiming: captureTiming as ComplianceEvidenceCaptureTiming,
    minimumCount,
    maximumCount,
    originalRequired: checkedBoolean(
      input.originalRequired,
      "Original required",
    ),
    metadataRequired: checkedBoolean(
      input.metadataRequired,
      "Metadata required",
    ),
    gpsRequired: checkedBoolean(input.gpsRequired, "GPS required"),
    dateStampRequired: checkedBoolean(
      input.dateStampRequired,
      "Capture time required",
    ),
    installerSignatureRequired: checkedBoolean(
      input.installerSignatureRequired,
      "Installer signature required",
    ),
    customerSignatureRequired: checkedBoolean(
      input.customerSignatureRequired,
      "Customer signature required",
    ),
    allowedContentTypes: checkedContentTypes(input.allowedContentTypes),
    conditionSnapshot: checkedJsonObject(
      input.conditionSnapshot,
      "INVALID_EVIDENCE_CONDITION",
      "Evidence condition",
    ),
    fieldSchema: checkedJsonObject(
      input.fieldSchema,
      "INVALID_EVIDENCE_FIELD_SCHEMA",
      "Evidence field schema",
    ),
    sourceCitation: requiredText(
      input.sourceCitation,
      1_000,
      "INVALID_EVIDENCE_SOURCE_CITATION",
      "Source citation",
    ),
    sortOrder: checkedPositiveInteger(input.sortOrder, "Requirement order", {
      allowZero: true,
    }),
    actorUid: requiredText(input.actorUid, 180, "ACTOR_REQUIRED", "Actor"),
  };
}

export async function prepareComplianceEvidenceRequirementSaveStatements(
  database: D1Database,
  input: SaveComplianceEvidenceRequirementInput,
) {
  const policy = await requireDraftEvidencePolicy(
    database,
    input.organisationId,
    input.policyId,
  );
  const now = input.updatedAt
    ? checkedInstant(input.updatedAt, "INVALID_UPDATED_AT", "Updated time")
    : new Date().toISOString();
  const values = checkedRequirementInput(input);
  const requestedId = cleanText(input.requirementId, 180);
  const existing = requestedId
    ? await database.prepare(`SELECT id FROM compliance_evidence_requirements
        WHERE id = ? AND organisation_id = ? AND policy_version_id = ?
        LIMIT 1`)
      .bind(requestedId, policy.organisationId, policy.id)
      .first<Record<string, unknown>>()
    : null;
  if (requestedId && !existing) {
    throw new ComplianceDomainError(
      "EVIDENCE_REQUIREMENT_NOT_FOUND",
      404,
      "The draft evidence requirement was not found.",
    );
  }
  const id = requestedId || crypto.randomUUID();
  const saveStatement = existing
    ? database.prepare(`UPDATE compliance_evidence_requirements
        SET requirement_code = ?, title = ?, description = ?,
          evidence_type = ?, capture_timing = ?, minimum_count = ?,
          maximum_count = ?, original_required = ?, metadata_required = ?,
          gps_required = ?, date_stamp_required = ?,
          installer_signature_required = ?,
          customer_signature_required = ?, allowed_content_types = ?,
          condition_snapshot = ?, field_schema = ?, source_citation = ?,
          sort_order = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ? AND policy_version_id = ?
          AND EXISTS (
            SELECT 1 FROM compliance_evidence_policy_versions policy
            WHERE policy.id = compliance_evidence_requirements.policy_version_id
              AND policy.organisation_id = compliance_evidence_requirements.organisation_id
              AND policy.publish_state = 'draft'
          )`)
      .bind(
        values.requirementCode,
        values.title,
        values.description,
        values.evidenceType,
        values.captureTiming,
        values.minimumCount,
        values.maximumCount,
        values.originalRequired ? 1 : 0,
        values.metadataRequired ? 1 : 0,
        values.gpsRequired ? 1 : 0,
        values.dateStampRequired ? 1 : 0,
        values.installerSignatureRequired ? 1 : 0,
        values.customerSignatureRequired ? 1 : 0,
        JSON.stringify(values.allowedContentTypes),
        JSON.stringify(values.conditionSnapshot),
        JSON.stringify(values.fieldSchema),
        values.sourceCitation,
        values.sortOrder,
        now,
        id,
        policy.organisationId,
        policy.id,
      )
    : database.prepare(`INSERT INTO compliance_evidence_requirements
        (id, organisation_id, policy_version_id, requirement_code, title,
         description, evidence_type, capture_timing, minimum_count,
         maximum_count, original_required, metadata_required, gps_required,
         date_stamp_required, installer_signature_required,
         customer_signature_required, allowed_content_types,
         condition_snapshot, field_schema, source_citation, sort_order,
         created_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?)`)
      .bind(
        id,
        policy.organisationId,
        policy.id,
        values.requirementCode,
        values.title,
        values.description,
        values.evidenceType,
        values.captureTiming,
        values.minimumCount,
        values.maximumCount,
        values.originalRequired ? 1 : 0,
        values.metadataRequired ? 1 : 0,
        values.gpsRequired ? 1 : 0,
        values.dateStampRequired ? 1 : 0,
        values.installerSignatureRequired ? 1 : 0,
        values.customerSignatureRequired ? 1 : 0,
        JSON.stringify(values.allowedContentTypes),
        JSON.stringify(values.conditionSnapshot),
        JSON.stringify(values.fieldSchema),
        values.sourceCitation,
        values.sortOrder,
        values.actorUid,
        now,
        now,
      );
  return {
    id,
    policyId: policy.id,
    created: !existing,
    statements: [
      prepareCompliancePublicationSupersedeStatement(
        database,
        policy.organisationId,
        "evidence_policy",
        policy.id,
        now,
      ),
      saveStatement,
      bumpDraftPolicyStatement(
        database,
        policy.organisationId,
        policy.id,
        now,
      ),
    ],
  };
}

export async function prepareComplianceEvidenceRequirementDeleteStatements(
  database: D1Database,
  organisationId: string,
  policyId: string,
  requirementId: string,
  deletedAt = new Date().toISOString(),
) {
  const policy = await requireDraftEvidencePolicy(
    database,
    organisationId,
    policyId,
  );
  const id = requiredText(
    requirementId,
    180,
    "EVIDENCE_REQUIREMENT_REQUIRED",
    "Evidence requirement",
  );
  const now = checkedInstant(deletedAt, "INVALID_UPDATED_AT", "Deleted time");
  const existing = await database.prepare(`SELECT id
      FROM compliance_evidence_requirements
      WHERE id = ? AND organisation_id = ? AND policy_version_id = ?
      LIMIT 1`)
    .bind(id, policy.organisationId, policy.id)
    .first<Record<string, unknown>>();
  if (!existing) {
    throw new ComplianceDomainError(
      "EVIDENCE_REQUIREMENT_NOT_FOUND",
      404,
      "The draft evidence requirement was not found.",
    );
  }
  return {
    id,
    policyId: policy.id,
    statements: [
      prepareCompliancePublicationSupersedeStatement(
        database,
        policy.organisationId,
        "evidence_policy",
        policy.id,
        now,
      ),
      database.prepare(`DELETE FROM compliance_evidence_requirements
        WHERE id = ? AND organisation_id = ? AND policy_version_id = ?
          AND EXISTS (
            SELECT 1 FROM compliance_evidence_policy_versions policy
            WHERE policy.id = compliance_evidence_requirements.policy_version_id
              AND policy.organisation_id = compliance_evidence_requirements.organisation_id
              AND policy.publish_state = 'draft'
          )`)
        .bind(id, policy.organisationId, policy.id),
      bumpDraftPolicyStatement(
        database,
        policy.organisationId,
        policy.id,
        now,
      ),
    ],
  };
}

export async function prepareComplianceEvidenceRequirementReorderStatements(
  database: D1Database,
  organisationId: string,
  policyId: string,
  requirementIdsInput: unknown,
  reorderedAt = new Date().toISOString(),
) {
  const policy = await requireDraftEvidencePolicy(
    database,
    organisationId,
    policyId,
  );
  if (
    !Array.isArray(requirementIdsInput)
    || !requirementIdsInput.length
    || requirementIdsInput.length > 500
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_ORDER",
      400,
      "Provide every draft requirement once in the required order.",
    );
  }
  const requirementIds = requirementIdsInput.map((item) =>
    requiredText(
      item,
      180,
      "INVALID_EVIDENCE_REQUIREMENT_ORDER",
      "Evidence requirement",
    )
  );
  if (new Set(requirementIds).size !== requirementIds.length) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_ORDER",
      400,
      "Each evidence requirement may appear only once.",
    );
  }
  const storedRows = await database.prepare(`SELECT id
      FROM compliance_evidence_requirements
      WHERE organisation_id = ? AND policy_version_id = ?`)
    .bind(policy.organisationId, policy.id)
    .all<Record<string, unknown>>();
  const storedIds = storedRows.results.map((row) => String(row.id)).sort();
  if (
    storedIds.length !== requirementIds.length
    || storedIds.some((id, index) => id !== [...requirementIds].sort()[index])
  ) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_REQUIREMENT_ORDER",
      409,
      "The requirement list changed. Refresh it before reordering.",
    );
  }
  const now = checkedInstant(
    reorderedAt,
    "INVALID_UPDATED_AT",
    "Reordered time",
  );
  return {
    policyId: policy.id,
    statements: [
      prepareCompliancePublicationSupersedeStatement(
        database,
        policy.organisationId,
        "evidence_policy",
        policy.id,
        now,
      ),
      ...requirementIds.map((id, index) =>
        database.prepare(`UPDATE compliance_evidence_requirements
          SET sort_order = ?, updated_at = ?
          WHERE id = ? AND organisation_id = ? AND policy_version_id = ?`)
          .bind(index + 1, now, id, policy.organisationId, policy.id)
      ),
      bumpDraftPolicyStatement(
        database,
        policy.organisationId,
        policy.id,
        now,
      ),
    ],
  };
}

export async function prepareComplianceEvidencePolicyDraftDeleteStatements(
  database: D1Database,
  organisationId: string,
  policyId: string,
  deletedAt = new Date().toISOString(),
) {
  const policy = await requireDraftEvidencePolicy(
    database,
    organisationId,
    policyId,
  );
  const now = checkedInstant(deletedAt, "INVALID_UPDATED_AT", "Deleted time");
  return {
    id: policy.id,
    deletedSnapshot: policySnapshot(policy),
    statements: [
      prepareCompliancePublicationSupersedeStatement(
        database,
        policy.organisationId,
        "evidence_policy",
        policy.id,
        now,
        "The evidence-policy draft was deleted.",
      ),
      database.prepare(`DELETE FROM compliance_evidence_requirements
        WHERE organisation_id = ? AND policy_version_id = ?`)
        .bind(policy.organisationId, policy.id),
      database.prepare(`DELETE FROM compliance_evidence_policy_versions
        WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'`)
        .bind(policy.id, policy.organisationId),
    ],
  };
}

export async function prepareComplianceEvidencePolicyWithdrawStatement(
  database: D1Database,
  organisationId: string,
  policyId: string,
  actorUid: string,
  withdrawnAt = new Date().toISOString(),
) {
  const organisation = requiredText(
    organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const id = requiredText(
    policyId,
    180,
    "EVIDENCE_POLICY_REQUIRED",
    "Evidence policy",
  );
  const actor = requiredText(actorUid, 180, "ACTOR_REQUIRED", "Actor");
  const now = checkedInstant(
    withdrawnAt,
    "INVALID_WITHDRAWN_AT",
    "Withdrawn time",
  );
  await requireNamedActiveAdmin(
    database,
    organisation,
    actor,
    "withdrawer",
  );
  return database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = ?,
      withdrawn_at = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'published'`)
    .bind(actor, now, now, id, organisation);
}

type GovernanceTargetSeal = {
  targetType: ComplianceGovernanceTargetType;
  targetId: string;
  targetLabel: string;
  publishState: CompliancePublishState;
  snapshot: Record<string, unknown>;
  blockers: CompliancePolicyReadinessBlocker[];
};

async function loadGovernanceTargetSeal(
  database: D1Database,
  organisationId: string,
  targetType: ComplianceGovernanceTargetType,
  targetId: string,
): Promise<GovernanceTargetSeal> {
  if (targetType === "evidence_policy") {
    const policy = await loadEvidencePolicy(
      database,
      organisationId,
      targetId,
    );
    return {
      targetType,
      targetId: policy.id,
      targetLabel:
        `${policy.programCode} | ${policy.activityKey} | Evidence policy ${policy.version}`,
      publishState: policy.publishState,
      snapshot: policySnapshot(policy),
      blockers: policy.readiness.blockers,
    };
  }
  if (targetType === "program") {
    const row = await database.prepare(`SELECT id, organisation_id,
        program_code, name, scheme_kind, jurisdiction, administering_body,
        official_source_url, official_source_title, official_source_version,
        official_source_sha256, official_source_checked_at, publish_state
      FROM compliance_programs
      WHERE id = ? AND organisation_id = ?
      LIMIT 1`)
      .bind(targetId, organisationId)
      .first<Record<string, unknown>>();
    if (!row) {
      throw new ComplianceDomainError(
        "PROGRAM_NOT_FOUND",
        404,
        "The governed program was not found in this organisation.",
      );
    }
    const publishState = String(row.publish_state);
    if (!isCompliancePublishState(publishState)) {
      throw new ComplianceDomainError(
        "INVALID_PROGRAM_RECORD",
        500,
        "The governed program contains an unsupported state.",
      );
    }
    const blockers: CompliancePolicyReadinessBlocker[] = [];
    if (
      !String(row.official_source_url)
      || !String(row.official_source_title)
      || !String(row.official_source_checked_at)
      || !/^[0-9a-fA-F]{64}$/.test(String(row.official_source_sha256))
    ) {
      blockers.push({
        code: "PROGRAM_SOURCE_INCOMPLETE",
        message: "Record the exact program source and SHA-256.",
      });
    }
    return {
      targetType,
      targetId: String(row.id),
      targetLabel: `${String(row.program_code)} | ${String(row.name)}`,
      publishState,
      snapshot: {
        targetType,
        program: {
          id: String(row.id),
          organisationId: String(row.organisation_id),
          programCode: String(row.program_code),
          name: String(row.name),
          schemeKind: String(row.scheme_kind),
          jurisdiction: String(row.jurisdiction),
          administeringBody: String(row.administering_body),
          officialSourceUrl: String(row.official_source_url),
          officialSourceTitle: String(row.official_source_title),
          officialSourceVersion: String(row.official_source_version || ""),
          officialSourceSha256: String(row.official_source_sha256).toLowerCase(),
          officialSourceCheckedAt: String(row.official_source_checked_at),
        },
      },
      blockers,
    };
  }
  const row = await database.prepare(`SELECT activity.id,
      program.organisation_id, program.id program_id, program.program_code,
      program.name program_name, program.publish_state program_publish_state,
      activity.activity_key, activity.version, activity.title,
      activity.service_category, activity.registry_activity_code,
      activity.specification_part, activity.product_category,
      activity.scenario_code, activity.scenario, activity.jurisdiction,
      activity.effective_from, activity.effective_to,
      activity.official_source_url, activity.official_source_title,
      activity.official_source_version, activity.official_source_sha256,
      activity.official_source_checked_at, activity.requirements_snapshot,
      activity.calculation_approval_state, activity.publish_state
    FROM compliance_activity_versions activity
    JOIN compliance_programs program ON program.id = activity.program_id
    WHERE activity.id = ? AND program.organisation_id = ?
    LIMIT 1`)
    .bind(targetId, organisationId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new ComplianceDomainError(
      "ACTIVITY_NOT_FOUND",
      404,
      "The governed activity was not found in this organisation.",
    );
  }
  const publishState = String(row.publish_state);
  if (!isCompliancePublishState(publishState)) {
    throw new ComplianceDomainError(
      "INVALID_ACTIVITY_RECORD",
      500,
      "The governed activity contains an unsupported state.",
    );
  }
  const blockers: CompliancePolicyReadinessBlocker[] = [];
  if (String(row.program_publish_state) !== "published") {
    blockers.push({
      code: "PROGRAM_NOT_PUBLISHED",
      message: "Publish the parent program through independent review first.",
    });
  }
  if (
    !String(row.official_source_url)
    || !String(row.official_source_title)
    || !String(row.official_source_checked_at)
    || !String(row.effective_from)
    || !/^[0-9a-fA-F]{64}$/.test(String(row.official_source_sha256))
  ) {
    blockers.push({
      code: "ACTIVITY_SOURCE_INCOMPLETE",
      message: "Record the exact activity source, effective date and SHA-256.",
    });
  }
  return {
    targetType,
    targetId: String(row.id),
    targetLabel:
      `${String(row.program_code)} | ${String(row.registry_activity_code || row.activity_key)} | ${String(row.title)}`,
    publishState,
    snapshot: {
      targetType,
      activity: {
        id: String(row.id),
        organisationId: String(row.organisation_id),
        programId: String(row.program_id),
        programCode: String(row.program_code),
        programName: String(row.program_name),
        activityKey: String(row.activity_key),
        version: Number(row.version),
        title: String(row.title),
        serviceCategory: String(row.service_category),
        registryActivityCode: String(row.registry_activity_code || ""),
        specificationPart: String(row.specification_part || ""),
        productCategory: String(row.product_category),
        scenarioCode: String(row.scenario_code || ""),
        scenario: String(row.scenario),
        jurisdiction: String(row.jurisdiction),
        effectiveFrom: String(row.effective_from),
        effectiveTo: String(row.effective_to || ""),
        officialSourceUrl: String(row.official_source_url),
        officialSourceTitle: String(row.official_source_title),
        officialSourceVersion: String(row.official_source_version || ""),
        officialSourceSha256: String(row.official_source_sha256).toLowerCase(),
        officialSourceCheckedAt: String(row.official_source_checked_at),
        requirementsSnapshot: parseJsonObject(row.requirements_snapshot),
        calculationApprovalState: String(row.calculation_approval_state),
      },
    },
    blockers,
  };
}

export type RequestCompliancePublicationInput = {
  organisationId: string;
  targetType: ComplianceGovernanceTargetType;
  targetId: string;
  requestReason: string;
  actorUid: string;
  requestedAt?: string;
};

export async function prepareCompliancePublicationRequestStatements(
  database: D1Database,
  input: RequestCompliancePublicationInput,
) {
  if (!COMPLIANCE_GOVERNANCE_TARGET_TYPES.includes(input.targetType)) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_TARGET",
      400,
      "Choose a governed publication target.",
    );
  }
  const organisationId = requiredText(
    input.organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const targetId = requiredText(
    input.targetId,
    180,
    "GOVERNANCE_TARGET_REQUIRED",
    "Publication target",
  );
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  const requestReason = requiredText(
    input.requestReason,
    2_000,
    "PUBLICATION_REASON_REQUIRED",
    "Publication reason",
  );
  const requestedAt = input.requestedAt
    ? checkedInstant(
      input.requestedAt,
      "INVALID_REQUESTED_AT",
      "Requested time",
    )
    : new Date().toISOString();
  await requireNamedActiveAdmin(
    database,
    organisationId,
    actorUid,
    "requester",
  );
  const target = await loadGovernanceTargetSeal(
    database,
    organisationId,
    input.targetType,
    targetId,
  );
  if (target.publishState !== "draft") {
    throw new ComplianceDomainError(
      "GOVERNANCE_TARGET_IMMUTABLE",
      409,
      "Only a governed draft can be submitted for publication review.",
    );
  }
  if (target.blockers.length) {
    throw new ComplianceDomainError(
      "GOVERNANCE_TARGET_NOT_READY",
      409,
      target.blockers[0].message,
    );
  }
  const pending = await database.prepare(`SELECT id
      FROM compliance_governance_requests
      WHERE organisation_id = ? AND target_type = ? AND target_id = ?
        AND action = 'publish' AND status = 'pending'
      LIMIT 1`)
    .bind(organisationId, input.targetType, targetId)
    .first<Record<string, unknown>>();
  if (pending) {
    throw new ComplianceDomainError(
      "PUBLICATION_REVIEW_ALREADY_PENDING",
      409,
      "This governed draft already has a pending publication review.",
    );
  }
  const id = crypto.randomUUID();
  const sealedSnapshot = canonicalComplianceSnapshot(target.snapshot);
  const sealedSnapshotSha256 = await complianceSnapshotSha256(sealedSnapshot);
  return {
    id,
    targetType: target.targetType,
    targetId: target.targetId,
    targetLabel: target.targetLabel,
    sealedSnapshotSha256,
    statements: [
      ...(target.targetType === "evidence_policy"
        ? [database.prepare(`UPDATE compliance_evidence_policy_versions
            SET requirements_complete = 1, updated_at = ?
            WHERE id = ? AND organisation_id = ?
              AND publish_state = 'draft'`)
          .bind(requestedAt, targetId, organisationId)]
        : []),
      database.prepare(`INSERT INTO compliance_governance_requests
        (id, organisation_id, target_type, target_id, action,
         sealed_snapshot, sealed_snapshot_sha256, status, request_reason,
         requested_by_uid, requested_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'publish', ?, ?, 'pending', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          organisationId,
          input.targetType,
          targetId,
          sealedSnapshot,
          sealedSnapshotSha256,
          requestReason,
          actorUid,
          requestedAt,
          requestedAt,
          requestedAt,
        ),
    ],
  };
}

async function requireNamedActiveAdmin(
  database: D1Database,
  organisationId: string,
  firebaseUid: string,
  purpose: "requester" | "reviewer" | "withdrawer" = "reviewer",
) {
  const row = await database.prepare(`SELECT member.firebase_uid, member.role,
      member.status, member.display_name, member.email,
      member.governance_identity_verified,
      member.governance_identity_verified_by_uid,
      member.governance_identity_verified_at,
      member.governance_identity_verification_basis
      FROM compliance_users member
      WHERE member.organisation_id = ? AND member.firebase_uid = ?
      LIMIT 1`)
    .bind(organisationId, firebaseUid)
    .first<Record<string, unknown>>();
  if (!namedAdminRecord(row)) {
    throw new ComplianceDomainError(
      purpose === "requester"
        ? "NAMED_ADMIN_REQUESTER_REQUIRED"
        : purpose === "withdrawer"
          ? "NAMED_ADMIN_WITHDRAWER_REQUIRED"
        : "NAMED_ADMIN_REVIEWER_REQUIRED",
      403,
      purpose === "requester"
        ? "A named active Creditex administrator must request publication."
        : purpose === "withdrawer"
          ? "A verified named active Creditex administrator must withdraw governed rules."
        : "A named active Creditex administrator must review publication.",
    );
  }
}

export type DecideCompliancePublicationInput = {
  organisationId: string;
  requestId: string;
  outcome: "approved" | "rejected";
  reviewNote: string;
  actorUid: string;
  reviewedAt?: string;
};

export async function prepareCompliancePublicationDecisionStatements(
  database: D1Database,
  input: DecideCompliancePublicationInput,
) {
  const organisationId = requiredText(
    input.organisationId,
    180,
    "ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const requestId = requiredText(
    input.requestId,
    180,
    "PUBLICATION_REQUEST_REQUIRED",
    "Publication request",
  );
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  const reviewNote = requiredText(
    input.reviewNote,
    4_000,
    "PUBLICATION_REVIEW_NOTE_REQUIRED",
    "Publication review note",
  );
  const reviewedAt = input.reviewedAt
    ? checkedInstant(input.reviewedAt, "INVALID_REVIEWED_AT", "Reviewed time")
    : new Date().toISOString();
  if (!["approved", "rejected"].includes(input.outcome)) {
    throw new ComplianceDomainError(
      "INVALID_PUBLICATION_OUTCOME",
      400,
      "Choose approve or reject.",
    );
  }
  const request = await database.prepare(`SELECT id, target_type, target_id,
      sealed_snapshot, sealed_snapshot_sha256, requested_by_uid
    FROM compliance_governance_requests
    WHERE id = ? AND organisation_id = ? AND action = 'publish'
      AND status = 'pending'
    LIMIT 1`)
    .bind(requestId, organisationId)
    .first<Record<string, unknown>>();
  if (!request) {
    throw new ComplianceDomainError(
      "PUBLICATION_REQUEST_NOT_FOUND",
      404,
      "The pending publication request was not found.",
    );
  }
  if (String(request.requested_by_uid) === actorUid) {
    throw new ComplianceDomainError(
      "PUBLICATION_SELF_REVIEW_FORBIDDEN",
      409,
      "A different named Creditex administrator must review publication.",
    );
  }
  await requireNamedActiveAdmin(database, organisationId, actorUid);
  const targetType = String(request.target_type);
  if (
    !COMPLIANCE_GOVERNANCE_TARGET_TYPES.includes(
      targetType as ComplianceGovernanceTargetType,
    )
  ) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_REQUEST_RECORD",
      500,
      "The publication request target is invalid.",
    );
  }
  const target = await loadGovernanceTargetSeal(
    database,
    organisationId,
    targetType as ComplianceGovernanceTargetType,
    String(request.target_id),
  );
  if (target.publishState !== "draft") {
    throw new ComplianceDomainError(
      "GOVERNANCE_TARGET_IMMUTABLE",
      409,
      "The publication target is no longer a draft.",
    );
  }
  const currentSnapshot = canonicalComplianceSnapshot(target.snapshot);
  const currentSnapshotSha256 = await complianceSnapshotSha256(currentSnapshot);
  if (
    currentSnapshot !== String(request.sealed_snapshot)
    || currentSnapshotSha256 !== String(request.sealed_snapshot_sha256)
  ) {
    throw new ComplianceDomainError(
      "PUBLICATION_SNAPSHOT_CHANGED",
      409,
      "The governed draft changed after review was requested. Submit a new sealed review.",
    );
  }
  const reviewStatement = database.prepare(`UPDATE compliance_governance_requests
    SET status = ?, reviewed_by_uid = ?, reviewed_at = ?, review_note = ?,
      updated_at = ?
    WHERE id = ? AND organisation_id = ? AND status = 'pending'
      AND requested_by_uid <> ?`)
    .bind(
      input.outcome,
      actorUid,
      reviewedAt,
      reviewNote,
      reviewedAt,
      requestId,
      organisationId,
      actorUid,
    );
  if (input.outcome === "rejected") {
    return {
      requestId,
      targetType: target.targetType,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      outcome: input.outcome,
      statements: [reviewStatement],
    };
  }
  if (target.blockers.length) {
    throw new ComplianceDomainError(
      "GOVERNANCE_TARGET_NOT_READY",
      409,
      target.blockers[0].message,
    );
  }
  const publishStatement = target.targetType === "program"
    ? database.prepare(`UPDATE compliance_programs
        SET publish_state = 'published', publication_request_id = ?,
          publication_snapshot_sha256 = ?, published_by_uid = ?,
          published_at = ?, withdrawn_by_uid = '', withdrawn_at = '',
          updated_at = ?
        WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
          AND official_source_url <> '' AND official_source_title <> ''
          AND official_source_checked_at <> ''
          AND length(official_source_sha256) = 64`)
      .bind(
        requestId,
        currentSnapshotSha256,
        actorUid,
        reviewedAt,
        reviewedAt,
        target.targetId,
        organisationId,
      )
    : target.targetType === "activity"
      ? database.prepare(`UPDATE compliance_activity_versions
          SET publish_state = 'published', publication_request_id = ?,
            publication_snapshot_sha256 = ?, published_by_uid = ?,
            published_at = ?, withdrawn_by_uid = '', withdrawn_at = '',
            updated_at = ?
          WHERE id = ? AND publish_state = 'draft'
            AND official_source_url <> '' AND official_source_title <> ''
            AND official_source_checked_at <> ''
            AND length(official_source_sha256) = 64
            AND effective_from <> ''
            AND EXISTS (
              SELECT 1 FROM compliance_programs program
              WHERE program.id = compliance_activity_versions.program_id
                AND program.organisation_id = ?
                AND program.publish_state = 'published'
            )`)
        .bind(
          requestId,
          currentSnapshotSha256,
          actorUid,
          reviewedAt,
          reviewedAt,
          target.targetId,
          organisationId,
        )
      : database.prepare(`UPDATE compliance_evidence_policy_versions
          SET publish_state = 'published', publication_request_id = ?,
            publication_snapshot_sha256 = ?, requirements_complete = 1,
            published_by_uid = ?, published_at = ?, withdrawn_by_uid = '',
            withdrawn_at = '', updated_at = ?
          WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
            AND requirements_complete = 1
            AND EXISTS (
              SELECT 1 FROM compliance_evidence_requirements requirement
              WHERE requirement.policy_version_id =
                compliance_evidence_policy_versions.id
                AND requirement.organisation_id =
                  compliance_evidence_policy_versions.organisation_id
            )
            AND EXISTS (
              SELECT 1 FROM compliance_activity_versions activity
              JOIN compliance_programs program
                ON program.id = activity.program_id
              WHERE activity.id =
                  compliance_evidence_policy_versions.activity_version_id
                AND activity.publish_state = 'published'
                AND program.organisation_id =
                  compliance_evidence_policy_versions.organisation_id
                AND program.publish_state = 'published'
            )`)
        .bind(
          requestId,
          currentSnapshotSha256,
          actorUid,
          reviewedAt,
          reviewedAt,
          target.targetId,
          organisationId,
        );
  return {
    requestId,
    targetType: target.targetType,
    targetId: target.targetId,
    targetLabel: target.targetLabel,
    outcome: input.outcome,
    statements: [reviewStatement, publishStatement],
  };
}

export async function runComplianceGovernanceMutation(
  database: D1Database,
  member: { uid: string; organisationId: string },
  statements: D1PreparedStatement[],
  audit: {
    eventType: string;
    targetType: string;
    targetId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  options: {
    optionalStatementIndexes?: readonly number[];
  } = {},
  occurredAt = new Date().toISOString(),
) {
  if (!statements.length) {
    throw new ComplianceDomainError(
      "EMPTY_GOVERNANCE_MUTATION",
      500,
      "The governed mutation has no state change.",
    );
  }
  const now = checkedInstant(
    occurredAt,
    "INVALID_GOVERNANCE_TIME",
    "Governance time",
  );
  const operationId = crypto.randomUUID();
  const optionalStatementIndexes = new Set(
    options.optionalStatementIndexes || [],
  );
  for (const index of optionalStatementIndexes) {
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= statements.length
    ) {
      throw new ComplianceDomainError(
        "INVALID_GOVERNANCE_MUTATION_GUARD",
        500,
        "The governed mutation has an invalid optional write step.",
      );
    }
  }
  const guardedStatements: D1PreparedStatement[] = [];
  let guardStep = 0;
  statements.forEach((statement, index) => {
    guardedStatements.push(statement);
    if (optionalStatementIndexes.has(index)) return;
    guardStep += 1;
    guardedStatements.push(database.prepare(`INSERT INTO compliance_write_guards (
        id, organisation_id, operation_id, step_number, verified, created_at
      ) VALUES (?, ?, ?, ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        operationId,
        guardStep,
        now,
      ));
  });
  if (!guardStep) {
    throw new ComplianceDomainError(
      "EMPTY_GOVERNANCE_MUTATION_GUARD",
      500,
      "The governed mutation must verify at least one required state change.",
    );
  }
  await database.batch([
    ...guardedStatements,
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (?, ?, 'compliance', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        audit.eventType,
        audit.targetType,
        audit.targetId,
        requiredText(
          audit.summary,
          1_000,
          "INVALID_AUDIT_SUMMARY",
          "Audit summary",
        ),
        JSON.stringify(checkedJsonObject(
          audit.metadata,
          "INVALID_AUDIT_METADATA",
          "Audit metadata",
        )),
        now,
      ),
  ]);
}

export type CreateLiveComplianceCaseInput = {
  activityVersionId: string;
  activityDate: string;
  serviceCategory: string;
  jurisdiction: string;
  workOrderId: string;
  complianceIntentId?: string;
  commercialHandoffId?: string;
  acceptedQuoteVersionId?: string;
  acceptedScopeSha256?: string;
  installerUid: string;
  actorType?: ComplianceActorType;
  actorUid: string;
  expectedOrganisation?: {
    id: string;
    code: string;
  };
  caseId?: string;
  caseNumber?: string;
  eventId?: string;
  createdAt?: string;
};

export type PreparedLiveComplianceCase = {
  caseId: string;
  caseNumber: string;
  organisationId: string;
  programId: string;
  activityVersionId: string;
  evidencePolicyVersionId: string;
  commercialHandoffId: string;
  acceptedQuoteVersionId: string;
  acceptedScopeSha256: string;
  activityDate: string;
  siteJurisdiction: AustralianSiteJurisdiction;
  activitySnapshot: Record<string, unknown>;
  caseStatementIndex: number;
  eventStatementIndex: number;
};

function caseNumber(caseId: string, createdAt: string) {
  const caseHex = caseId.replace(/[^0-9a-f]/gi, "").slice(0, 20);
  const suffix = (caseHex.length >= 16
    ? caseHex
    : crypto.randomUUID().replace(/[^0-9a-f]/gi, "").slice(0, 20)
  ).toUpperCase();
  return `TLC-${createdAt.slice(0, 10).replaceAll("-", "")}-${suffix}`;
}

function activityCaseSnapshot(
  activity: ComplianceActivityProjection,
  activityDate: string,
  siteJurisdiction: AustralianSiteJurisdiction,
  evidencePolicy: {
    id: string;
    version: number;
    officialSourceTitle: string;
    officialSourceVersion: string;
    officialSourceSha256: string;
  },
  acceptedHandoff: {
    commercialHandoffId: string;
    acceptedQuoteVersionId: string;
    acceptedScopeSha256: string;
  },
) {
  return {
    organisationId: activity.organisationId,
    organisationCode: activity.organisationCode,
    organisationLegalName: activity.organisationLegalName,
    organisationTradingName: activity.organisationTradingName,
    programId: activity.programId,
    programCode: activity.programCode,
    programName: activity.programName,
    schemeKind: activity.schemeKind,
    programJurisdiction: activity.programJurisdiction,
    administeringBody: activity.administeringBody,
    activityVersionId: activity.id,
    activityDate,
    siteJurisdiction,
    activityKey: activity.activityKey,
    version: activity.version,
    title: activity.title,
    serviceCategory: activity.serviceCategory,
    registryActivityCode: activity.registryActivityCode,
    specificationPart: activity.specificationPart,
    productCategory: activity.productCategory,
    scenarioCode: activity.scenarioCode,
    scenario: activity.scenario,
    jurisdiction: activity.jurisdiction,
    effectiveFrom: activity.effectiveFrom,
    effectiveTo: activity.effectiveTo,
    officialSourceUrl: activity.officialSourceUrl,
    officialSourceTitle: activity.officialSourceTitle,
    officialSourceVersion: activity.officialSourceVersion,
    officialSourceSha256: activity.officialSourceSha256,
    officialSourceCheckedAt: activity.officialSourceCheckedAt,
    requirementsSnapshot: activity.requirementsSnapshot,
    requirementsSnapshotJson: activity.requirementsSnapshotJson,
    calculationApprovalState: activity.calculationApprovalState,
    evidencePolicyVersionId: evidencePolicy.id,
    evidencePolicyVersion: evidencePolicy.version,
    evidencePolicyOfficialSourceTitle: evidencePolicy.officialSourceTitle,
    evidencePolicyOfficialSourceVersion: evidencePolicy.officialSourceVersion,
    evidencePolicyOfficialSourceSha256: evidencePolicy.officialSourceSha256,
    acceptedHandoff,
  };
}

export async function appendLiveComplianceCaseStatements(
  database: D1Database,
  batch: D1PreparedStatement[],
  input: CreateLiveComplianceCaseInput,
): Promise<PreparedLiveComplianceCase> {
  await ensureCreditexSchemaGuards(database);
  const createdAt = input.createdAt
    ? checkedInstant(input.createdAt, "INVALID_CREATED_AT", "Created time")
    : new Date().toISOString();
  const activityDate = checkedDate(
    input.activityDate,
    "INVALID_ACTIVITY_DATE",
    "Activity date",
  );
  const activity = await resolveLiveComplianceActivity(
    database,
    input.activityVersionId,
    activityDate,
  );
  if (input.expectedOrganisation) {
    const expectedOrganisationId = requiredText(
      input.expectedOrganisation.id,
      180,
      "EXPECTED_ORGANISATION_REQUIRED",
      "Expected compliance organisation",
    );
    const expectedOrganisationCode = requiredText(
      input.expectedOrganisation.code,
      80,
      "EXPECTED_ORGANISATION_REQUIRED",
      "Expected compliance organisation code",
    );
    if (
      activity.organisationId !== expectedOrganisationId
      || activity.organisationCode !== expectedOrganisationCode
    ) {
      throw new ComplianceDomainError(
        "COMPLIANCE_ORGANISATION_MISMATCH",
        409,
        "The selected compliance activity does not belong to the configured compliance partner.",
      );
    }
  }
  const evidencePolicyRow = await database.prepare(
    `SELECT evidence_policy.id, evidence_policy.version,
        evidence_policy.official_source_title,
        evidence_policy.official_source_version,
        evidence_policy.official_source_sha256
      FROM compliance_evidence_policy_versions evidence_policy
      WHERE evidence_policy.organisation_id = ?
        AND evidence_policy.activity_version_id = ?
        AND evidence_policy.publish_state = 'published'
        AND evidence_policy.requirements_complete = 1
      ORDER BY evidence_policy.version DESC, evidence_policy.id DESC
      LIMIT 1`,
  ).bind(activity.organisationId, activity.id).first<Record<string, unknown>>();
  if (!evidencePolicyRow) {
    throw new ComplianceDomainError(
      "EVIDENCE_POLICY_REQUIRED",
      409,
      "The selected activity is not available until the assigned compliance team publishes its complete evidence policy.",
    );
  }
  const evidencePolicySha256 = checkedSourceSha256(
    evidencePolicyRow.official_source_sha256,
  );
  if (!evidencePolicySha256) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_POLICY",
      500,
      "The published evidence policy source SHA-256 is missing.",
    );
  }
  const evidencePolicy = {
    id: requiredText(
      evidencePolicyRow.id,
      180,
      "INVALID_EVIDENCE_POLICY",
      "Evidence policy",
    ),
    version: Number(evidencePolicyRow.version),
    officialSourceTitle: requiredText(
      evidencePolicyRow.official_source_title,
      500,
      "INVALID_EVIDENCE_POLICY",
      "Evidence policy source title",
    ),
    officialSourceVersion: requiredText(
      evidencePolicyRow.official_source_version,
      240,
      "INVALID_EVIDENCE_POLICY",
      "Evidence policy source version",
    ),
    officialSourceSha256: evidencePolicySha256,
  };
  if (!Number.isSafeInteger(evidencePolicy.version) || evidencePolicy.version < 1) {
    throw new ComplianceDomainError(
      "INVALID_EVIDENCE_POLICY",
      500,
      "The published evidence policy version is invalid.",
    );
  }
  try {
    await requireCurrentApprovedOfficialSourceBinding(
      database,
      activity.organisationId,
      "evidence_policy",
      evidencePolicy.id,
      evidencePolicy.officialSourceSha256,
    );
  } catch (error) {
    if (!(error instanceof CreditexSourceLookupReviewError)) throw error;
    throw new ComplianceDomainError(
      "CURRENT_SOURCE_APPROVAL_REQUIRED",
      409,
      "The selected compliance evidence policy is unavailable until its exact official-source approval is current.",
    );
  }
  if (
    !isComplianceServiceCategory(input.serviceCategory)
    || activity.serviceCategory !== input.serviceCategory
  ) {
    throw new ComplianceDomainError(
      "ACTIVITY_CATEGORY_MISMATCH",
      409,
      "The selected compliance activity does not match the TLink job category.",
    );
  }
  const siteJurisdiction = cleanText(input.jurisdiction, 20).toUpperCase();
  if (
    !isAustralianSiteJurisdiction(siteJurisdiction)
    || ![siteJurisdiction, "AU"].includes(activity.jurisdiction)
  ) {
    throw new ComplianceDomainError(
      "ACTIVITY_JURISDICTION_MISMATCH",
      409,
      "The selected compliance activity does not apply in the job jurisdiction.",
    );
  }
  const workOrderId = requiredText(
    input.workOrderId,
    180,
    "WORK_ORDER_REQUIRED",
    "Work order",
  );
  const installerUid = requiredText(
    input.installerUid,
    180,
    "INSTALLER_REQUIRED",
    "Installer",
  );
  const complianceIntentId = cleanText(input.complianceIntentId, 180);
  const actorUid = requiredText(
    input.actorUid,
    180,
    "ACTOR_REQUIRED",
    "Actor",
  );
  const actorType = input.actorType || "installer";
  if (!["installer", "compliance", "platform"].includes(actorType)) {
    throw new ComplianceDomainError(
      "INVALID_ACTOR_TYPE",
      400,
      "The compliance actor type is invalid.",
    );
  }
  if (actorType === "installer" && actorUid !== installerUid) {
    throw new ComplianceDomainError(
      "COMPLIANCE_INSTALLER_ACTOR_MISMATCH",
      403,
      "Installer compliance intake must be attributed to the installer account that owns the job.",
    );
  }
  const commercialHandoffId = cleanText(input.commercialHandoffId, 180);
  const acceptedQuoteVersionId = cleanText(
    input.acceptedQuoteVersionId,
    180,
  );
  const acceptedScopeSha256 = checkedSourceSha256(
    input.acceptedScopeSha256,
  );
  const acceptedHandoffFieldCount = [
    commercialHandoffId,
    acceptedQuoteVersionId,
    acceptedScopeSha256,
  ].filter(Boolean).length;
  if (
    acceptedHandoffFieldCount !== 0
    && acceptedHandoffFieldCount !== 3
  ) {
    throw new ComplianceDomainError(
      "COMPLIANCE_HANDOFF_INCOMPLETE",
      400,
      "Optional accepted quote linkage must include the handoff, quote version and scope digest together.",
    );
  }
  if (acceptedHandoffFieldCount === 3) {
    const acceptedHandoff = await database.prepare(`SELECT
        handoff.scope_snapshot_json
      FROM trade_crm_commercial_handovers handoff
      JOIN trade_crm_quote_acceptances acceptance
        ON acceptance.id = handoff.acceptance_id
        AND acceptance.firebase_uid = handoff.firebase_uid
        AND acceptance.work_order_id = handoff.work_order_id
        AND acceptance.quote_version_id = handoff.quote_version_id
      WHERE handoff.id = ?
        AND handoff.work_order_id = ?
        AND handoff.firebase_uid = ?
        AND handoff.quote_version_id = ?
        AND handoff.status = 'accepted'
        AND acceptance.decision = 'accepted'
      LIMIT 1`)
      .bind(
        commercialHandoffId,
        workOrderId,
        installerUid,
        acceptedQuoteVersionId,
      )
      .first<Record<string, unknown>>();
    const scopeSnapshot = String(
      acceptedHandoff?.scope_snapshot_json || "",
    );
    let parsedScope: unknown;
    try {
      parsedScope = JSON.parse(scopeSnapshot);
    } catch {
      parsedScope = null;
    }
    if (
      !acceptedHandoff
      || !Array.isArray(parsedScope)
      || parsedScope.length < 1
      || await complianceSnapshotSha256(scopeSnapshot)
        !== acceptedScopeSha256
    ) {
      throw new ComplianceDomainError(
        "COMPLIANCE_HANDOFF_LINKAGE_INVALID",
        409,
        "The optional accepted quote linkage does not match this installer job.",
      );
    }
  }
  const caseId = cleanText(input.caseId, 180) || crypto.randomUUID();
  const eventId = cleanText(input.eventId, 180) || crypto.randomUUID();
  const nextCaseNumber = cleanText(input.caseNumber, 80)
    || caseNumber(caseId, createdAt);
  const snapshot = activityCaseSnapshot(
    activity,
    activityDate,
    siteJurisdiction,
    evidencePolicy,
    {
      commercialHandoffId,
      acceptedQuoteVersionId,
      acceptedScopeSha256,
    },
  );
  const caseStatementIndex = batch.push(
    database.prepare(`INSERT INTO compliance_cases
      (id, case_number, organisation_id, program_id, work_order_id,
       compliance_intent_id,
       commercial_handoff_id, accepted_quote_version_id,
       accepted_scope_sha256,
       installer_uid, activity_version_id, evidence_policy_version_id,
       activity_date, site_jurisdiction,
       activity_snapshot, status,
       evidence_status, revision, created_by_type, created_by_uid,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft',
        'not_started', 1, ?, ?, ?, ?)`)
      .bind(
        caseId,
        nextCaseNumber,
        activity.organisationId,
        activity.programId,
        workOrderId,
        complianceIntentId,
        commercialHandoffId,
        acceptedQuoteVersionId,
        acceptedScopeSha256,
        installerUid,
        activity.id,
        evidencePolicy.id,
        activityDate,
        siteJurisdiction,
        JSON.stringify(snapshot),
        actorType,
        actorUid,
        createdAt,
        createdAt,
      ),
  ) - 1;
  const eventStatementIndex = batch.push(
    database.prepare(`INSERT INTO compliance_case_events
      (id, case_id, organisation_id, event_type, actor_type, actor_uid,
       summary, metadata, created_at)
      VALUES (?, ?, ?, 'case_created', ?, ?,
        'Compliance case created from an exact published activity version.',
        ?, ?)`)
      .bind(
        eventId,
        caseId,
        activity.organisationId,
        actorType,
        actorUid,
        JSON.stringify({
          activityVersionId: activity.id,
          evidencePolicyVersionId: evidencePolicy.id,
          programCode: activity.programCode,
          activityKey: activity.activityKey,
          version: activity.version,
          commercialHandoffId,
          acceptedQuoteVersionId,
          acceptedScopeSha256,
        }),
        createdAt,
      ),
  ) - 1;
  return {
    caseId,
    caseNumber: nextCaseNumber,
    organisationId: activity.organisationId,
    programId: activity.programId,
    activityVersionId: activity.id,
    evidencePolicyVersionId: evidencePolicy.id,
    commercialHandoffId,
    acceptedQuoteVersionId,
    acceptedScopeSha256,
    activityDate,
    siteJurisdiction,
    activitySnapshot: snapshot,
    caseStatementIndex,
    eventStatementIndex,
  };
}

export async function prepareLiveComplianceCaseStatements(
  database: D1Database,
  input: CreateLiveComplianceCaseInput,
) {
  const statements: D1PreparedStatement[] = [];
  const prepared = await appendLiveComplianceCaseStatements(
    database,
    statements,
    input,
  );
  return { ...prepared, statements };
}
