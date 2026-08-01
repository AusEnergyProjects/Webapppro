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
  } catch {
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
  if (afterActivityId) {
    conditions.push("activity.id > ?");
    bindings.push(afterActivityId);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filters.limit || 200)));
  const rows = await database.prepare(`${ACTIVITY_SELECT}
    WHERE ${conditions.join(" AND ")}
    ORDER BY activity.id ASC
    LIMIT ?`)
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();
  return rows.results.map(activityProjection);
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
      official_source_checked_at, publish_state, published_at, withdrawn_at,
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

export function prepareComplianceProgramWithdrawStatement(
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

export function prepareComplianceActivityWithdrawStatement(
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

export type CreateLiveComplianceCaseInput = {
  activityVersionId: string;
  activityDate: string;
  serviceCategory: string;
  jurisdiction: string;
  workOrderId: string;
  installerUid: string;
  actorType?: ComplianceActorType;
  actorUid: string;
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
  };
}

export async function appendLiveComplianceCaseStatements(
  database: D1Database,
  batch: D1PreparedStatement[],
  input: CreateLiveComplianceCaseInput,
): Promise<PreparedLiveComplianceCase> {
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
  const evidencePolicyRow = await database.prepare(
    `SELECT id, version, official_source_title, official_source_version,
        official_source_sha256
      FROM compliance_evidence_policy_versions
      WHERE organisation_id = ? AND activity_version_id = ?
        AND publish_state = 'published' AND requirements_complete = 1
      ORDER BY version DESC, id DESC
      LIMIT 1`,
  ).bind(activity.organisationId, activity.id).first<Record<string, unknown>>();
  if (!evidencePolicyRow) {
    throw new ComplianceDomainError(
      "EVIDENCE_POLICY_REQUIRED",
      409,
      "The selected activity is not available until Creditex publishes its complete evidence policy.",
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
  const caseId = cleanText(input.caseId, 180) || crypto.randomUUID();
  const eventId = cleanText(input.eventId, 180) || crypto.randomUUID();
  const nextCaseNumber = cleanText(input.caseNumber, 80)
    || caseNumber(caseId, createdAt);
  const snapshot = activityCaseSnapshot(
    activity,
    activityDate,
    siteJurisdiction,
    evidencePolicy,
  );
  const caseStatementIndex = batch.push(
    database.prepare(`INSERT INTO compliance_cases
      (id, case_number, organisation_id, program_id, work_order_id,
       installer_uid, activity_version_id, evidence_policy_version_id,
       activity_date, site_jurisdiction,
       activity_snapshot, status,
       evidence_status, revision, created_by_type, created_by_uid,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'not_started', 1, ?, ?, ?, ?)`)
      .bind(
        caseId,
        nextCaseNumber,
        activity.organisationId,
        activity.programId,
        workOrderId,
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
