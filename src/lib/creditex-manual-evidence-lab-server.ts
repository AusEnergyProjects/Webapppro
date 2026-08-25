import type { ComplianceIdentity } from "./compliance-access-server.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type GovernmentActivityTemplate,
} from "./australian-government-program-catalogue.ts";
import {
  CREDITEX_MANUAL_EVIDENCE_JOB_CONTRACT,
  CreditexManualEvidenceContractError,
  emptyManualEvidenceResponse,
  manualEvidenceActivity,
  manualEvidenceProgram,
  manualEvidenceProgress,
  starterManualEvidenceForm,
  validateManualEvidenceFormSchema,
  validateManualEvidenceResponses,
  type ManualEvidenceFormSchema,
  type ManualEvidenceResponse,
} from "./creditex-manual-evidence-lab.ts";

const WRITE_ROLES = new Set(["admin", "case_manager", "reviewer"]);
const REVIEW_ROLES = new Set(["admin", "reviewer"]);
const MANUAL_JOB_STATUSES = new Set([
  "draft",
  "field_testing",
  "ready_for_audit",
  "changes_required",
  "passed",
  "archived",
]);
const AUSTRALIAN_STATES = new Set([
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
]);

export class CreditexManualEvidenceLabError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexManualEvidenceLabError";
    this.code = code;
    this.status = status;
  }
}

type RecordInput = Record<string, unknown>;

type ManualFormRow = {
  id: string;
  organisation_id: string;
  program_code: string;
  activity_template_id: string;
  activity_snapshot: string;
  version: number;
  title: string;
  status: string;
  form_schema: string;
  form_schema_sha256: string;
  record_mode: string;
  revision: number;
  created_by_uid: string;
  updated_by_uid: string;
  created_at: string;
  locked_at: string;
  archived_at: string;
  updated_at: string;
};

type ManualJobRow = {
  id: string;
  organisation_id: string;
  form_version_id: string;
  program_code: string;
  activity_template_id: string;
  activity_snapshot: string;
  form_schema: string;
  form_schema_sha256: string;
  job_number: string;
  installer_id: string;
  installer_label: string;
  technician_id: string;
  technician_label: string;
  customer_label: string;
  site_state: string;
  site_postcode: string;
  status: string;
  response_snapshot: string;
  response_sha256: string;
  required_count: number;
  completed_required_count: number;
  issue_count: number;
  review_note: string;
  record_mode: string;
  revision: number;
  created_by_uid: string;
  updated_by_uid: string;
  passed_by_uid: string;
  created_at: string;
  passed_at: string;
  archived_at: string;
  updated_at: string;
  field_tester_uid: string;
};

function recordInput(value: unknown, code: string, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexManualEvidenceLabError(code, 400, message);
  }
  return value as RecordInput;
}

function requiredText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  const cleaned = String(value || "").trim();
  if (!cleaned || cleaned.length > maximum) {
    throw new CreditexManualEvidenceLabError(
      code,
      400,
      `${label} is required and can contain up to ${maximum} characters.`,
    );
  }
  return cleaned;
}

function optionalText(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function positiveRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_INVALID",
      400,
      "Refresh the manual evidence workspace before saving.",
    );
  }
  return revision;
}

function boundedPage(value: unknown) {
  const page = Number(value || 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000
    ? page
    : 1;
}

function boundedPageSize(value: unknown) {
  const pageSize = Number(value || 50);
  return Number.isSafeInteger(pageSize) && pageSize >= 10 && pageSize <= 100
    ? pageSize
    : 50;
}

function assertWriteRole(member: ComplianceIdentity) {
  if (!WRITE_ROLES.has(member.role)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_ROLE_REQUIRED",
      403,
      "This compliance role has read-only access to manual evidence tests.",
    );
  }
}

function assertReviewRole(member: ComplianceIdentity) {
  if (!REVIEW_ROLES.has(member.role)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVIEW_ROLE_REQUIRED",
      403,
      "An administrator or reviewer must make this manual test decision.",
    );
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function activitySnapshot(activity: GovernmentActivityTemplate) {
  const program = manualEvidenceProgram(activity.programCode);
  if (!program) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_PROGRAM_NOT_FOUND",
      404,
      "The selected government program is not catalogued.",
    );
  }
  return {
    program: {
      templateId: program.templateId,
      programCode: program.programCode,
      name: program.name,
      jurisdiction: program.jurisdiction,
      outcomeClass: program.outcomeClass,
      administeringBody: program.administeringBody,
      officialSourceUrl: program.officialSourceUrl,
      officialSourceTitle: program.officialSourceTitle,
      catalogueState: program.catalogueState,
    },
    activity: {
      ...activity,
    },
  };
}

function mapForm(row: ManualFormRow) {
  const schema = parseJson<ManualEvidenceFormSchema | null>(
    row.form_schema,
    null,
  );
  const snapshot = parseJson<Record<string, unknown> | null>(
    row.activity_snapshot,
    null,
  );
  if (
    !schema
    || !snapshot
    || row.record_mode !== "synthetic_test"
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FORM_RECORD_INVALID",
      500,
      "A manual evidence form record is invalid.",
    );
  }
  return {
    id: row.id,
    programCode: row.program_code,
    activityTemplateId: row.activity_template_id,
    activitySnapshot: snapshot,
    version: Number(row.version),
    title: row.title,
    status: row.status,
    schema,
    schemaSha256: row.form_schema_sha256,
    recordMode: row.record_mode,
    revision: Number(row.revision),
    createdByUid: row.created_by_uid,
    updatedByUid: row.updated_by_uid,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: ManualJobRow) {
  const schema = parseJson<ManualEvidenceFormSchema | null>(
    row.form_schema,
    null,
  );
  const snapshot = parseJson<Record<string, unknown> | null>(
    row.activity_snapshot,
    null,
  );
  const responses = parseJson<ManualEvidenceResponse[] | null>(
    row.response_snapshot,
    null,
  );
  if (
    !schema
    || !snapshot
    || !responses
    || row.record_mode !== "synthetic_test"
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_RECORD_INVALID",
      500,
      "A manual evidence test job record is invalid.",
    );
  }
  return {
    id: row.id,
    formVersionId: row.form_version_id,
    programCode: row.program_code,
    activityTemplateId: row.activity_template_id,
    activitySnapshot: snapshot,
    formSchema: schema,
    formSchemaSha256: row.form_schema_sha256,
    jobNumber: row.job_number,
    installerId: row.installer_id,
    installerLabel: row.installer_label,
    technicianId: row.technician_id,
    technicianLabel: row.technician_label,
    fieldTesterUid: row.field_tester_uid,
    customerLabel: row.customer_label,
    siteState: row.site_state,
    sitePostcode: row.site_postcode,
    status: row.status,
    responses,
    responseSha256: row.response_sha256,
    requiredCount: Number(row.required_count),
    completedRequiredCount: Number(row.completed_required_count),
    issueCount: Number(row.issue_count),
    reviewNote: row.review_note,
    recordMode: row.record_mode,
    revision: Number(row.revision),
    createdByUid: row.created_by_uid,
    updatedByUid: row.updated_by_uid,
    passedByUid: row.passed_by_uid,
    createdAt: row.created_at,
    passedAt: row.passed_at,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}

async function formRow(
  database: D1Database,
  organisationId: string,
  formId: string,
) {
  return database.prepare(`SELECT *
      FROM compliance_manual_evidence_form_versions
      WHERE id = ? AND organisation_id = ?
      LIMIT 1`)
    .bind(formId, organisationId)
    .first<ManualFormRow>();
}

async function jobRow(
  database: D1Database,
  organisationId: string,
  jobId: string,
) {
  return database.prepare(`SELECT *
      FROM compliance_manual_evidence_test_jobs
      WHERE id = ? AND organisation_id = ?
      LIMIT 1`)
    .bind(jobId, organisationId)
    .first<ManualJobRow>();
}

function requireForm(row: ManualFormRow | null) {
  if (!row) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FORM_NOT_FOUND",
      404,
      "The manual evidence form was not found.",
    );
  }
  return row;
}

function requireJob(row: ManualJobRow | null) {
  if (!row) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_NOT_FOUND",
      404,
      "The manual evidence test job was not found.",
    );
  }
  return row;
}

async function nextFormVersion(
  database: D1Database,
  organisationId: string,
  activityTemplateId: string,
) {
  const row = await database.prepare(`SELECT
      COALESCE(MAX(version), 0) + 1 next_version
    FROM compliance_manual_evidence_form_versions
    WHERE organisation_id = ? AND activity_template_id = ?`)
    .bind(organisationId, activityTemplateId)
    .first<{ next_version: number }>();
  return Number(row?.next_version || 1);
}

export async function loadManualEvidenceLab(
  database: D1Database,
  member: ComplianceIdentity,
  filters: {
    programCode?: string;
    activityTemplateId?: string;
    jobId?: string;
    formPage?: number;
    jobPage?: number;
    pageSize?: number;
  } = {},
) {
  const programCode = optionalText(filters.programCode, 80);
  const activityTemplateId = optionalText(filters.activityTemplateId, 180);
  const jobId = optionalText(filters.jobId, 180);
  const formPage = boundedPage(filters.formPage);
  const jobPage = boundedPage(filters.jobPage);
  const pageSize = boundedPageSize(filters.pageSize);
  if (programCode && !manualEvidenceProgram(programCode)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_PROGRAM_NOT_FOUND",
      404,
      "The selected government program is not catalogued.",
    );
  }
  if (activityTemplateId && !manualEvidenceActivity(activityTemplateId)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_ACTIVITY_NOT_FOUND",
      404,
      "The selected activity is not catalogued.",
    );
  }

  const formConditions = ["organisation_id = ?"];
  const formValues: unknown[] = [member.organisationId];
  if (programCode) {
    formConditions.push("program_code = ?");
    formValues.push(programCode);
  }
  if (activityTemplateId) {
    formConditions.push("activity_template_id = ?");
    formValues.push(activityTemplateId);
  } else {
    formConditions.push("1 = 0");
  }
  const jobConditions = ["organisation_id = ?"];
  const jobValues: unknown[] = [member.organisationId];
  if (programCode) {
    jobConditions.push("program_code = ?");
    jobValues.push(programCode);
  }
  if (activityTemplateId) {
    jobConditions.push("activity_template_id = ?");
    jobValues.push(activityTemplateId);
  }
  if (jobId) {
    jobConditions.push("id = ?");
    jobValues.push(jobId);
  } else if (!activityTemplateId) {
    jobConditions.push("1 = 0");
  }

  const [
    formsResult,
    jobsResult,
    formCount,
    jobCount,
    metrics,
    installersResult,
    techniciansResult,
  ] = await Promise.all([
    database.prepare(`SELECT *
        FROM compliance_manual_evidence_form_versions
        WHERE ${formConditions.join(" AND ")}
        ORDER BY updated_at DESC, version DESC
        LIMIT ? OFFSET ?`)
      .bind(...formValues, pageSize, (formPage - 1) * pageSize)
      .all<ManualFormRow>(),
    database.prepare(`SELECT *
        FROM compliance_manual_evidence_test_jobs
        WHERE ${jobConditions.join(" AND ")}
        ORDER BY updated_at DESC, id DESC
        LIMIT ? OFFSET ?`)
      .bind(...jobValues, pageSize, (jobPage - 1) * pageSize)
      .all<ManualJobRow>(),
    database.prepare(`SELECT COUNT(*) count
        FROM compliance_manual_evidence_form_versions
        WHERE ${formConditions.join(" AND ")}`)
      .bind(...formValues)
      .first<{ count: number }>(),
    database.prepare(`SELECT COUNT(*) count
        FROM compliance_manual_evidence_test_jobs
        WHERE ${jobConditions.join(" AND ")}`)
      .bind(...jobValues)
      .first<{ count: number }>(),
    database.prepare(`SELECT
        (
          SELECT COUNT(*)
          FROM compliance_manual_evidence_form_versions
          WHERE organisation_id = ? AND status <> 'archived'
        ) active_forms,
        (
          SELECT COUNT(*)
          FROM compliance_manual_evidence_form_versions
          WHERE organisation_id = ? AND status = 'test_ready'
        ) test_ready_forms,
        (
          SELECT COUNT(*)
          FROM compliance_manual_evidence_test_jobs
          WHERE organisation_id = ? AND status <> 'archived'
        ) active_jobs,
        (
          SELECT COUNT(*)
          FROM compliance_manual_evidence_test_jobs
          WHERE organisation_id = ? AND status = 'ready_for_audit'
        ) awaiting_review,
        (
          SELECT COUNT(*)
          FROM compliance_manual_evidence_test_jobs
          WHERE organisation_id = ? AND status = 'passed'
        ) passed_jobs`)
      .bind(
        member.organisationId,
        member.organisationId,
        member.organisationId,
        member.organisationId,
        member.organisationId,
      )
      .first<Record<string, number>>(),
    database.prepare(`SELECT
        installer.id,
        installer.business_name,
        installer.company_code
      FROM compliance_pilot_installers installer
      JOIN compliance_pilot_runs run ON run.id = installer.pilot_run_id
      WHERE run.organisation_id = ?
        AND run.status = 'active'
        AND installer.status = 'test_active'
      ORDER BY installer.installer_slot
      LIMIT 100`)
      .bind(member.organisationId)
      .all<{
        id: string;
        business_name: string;
        company_code: string;
      }>(),
    database.prepare(`SELECT
        technician.id,
        technician.installer_id,
        technician.display_name,
        technician.technician_code
      FROM compliance_pilot_technicians technician
      JOIN compliance_pilot_runs run ON run.id = technician.pilot_run_id
      WHERE run.organisation_id = ?
        AND run.status = 'active'
        AND technician.status = 'test_active'
      ORDER BY technician.installer_id, technician.technician_slot
      LIMIT 300`)
      .bind(member.organisationId)
      .all<{
        id: string;
        installer_id: string;
        display_name: string;
        technician_code: string;
      }>(),
  ]);

  return {
    contract: CREDITEX_MANUAL_EVIDENCE_JOB_CONTRACT,
    recordMode: "synthetic_test",
    externalActionsEnabled: false,
    programmes: GOVERNMENT_PROGRAM_TEMPLATES.map((program) => ({
      ...program,
      activityCount: GOVERNMENT_ACTIVITY_TEMPLATES.filter(
        (activity) => activity.programCode === program.programCode,
      ).length,
    })),
    activities: GOVERNMENT_ACTIVITY_TEMPLATES,
    forms: formsResult.results.map(mapForm),
    jobs: jobsResult.results.map(mapJob),
    pagination: {
      pageSize,
      forms: {
        page: formPage,
        total: Number(formCount?.count || 0),
        totalPages: Math.max(
          1,
          Math.ceil(Number(formCount?.count || 0) / pageSize),
        ),
      },
      jobs: {
        page: jobPage,
        total: Number(jobCount?.count || 0),
        totalPages: Math.max(
          1,
          Math.ceil(Number(jobCount?.count || 0) / pageSize),
        ),
      },
    },
    installers: installersResult.results.map((installer) => ({
      id: installer.id,
      label: `${installer.company_code} | ${installer.business_name}`,
    })),
    technicians: techniciansResult.results.map((technician) => ({
      id: technician.id,
      installerId: technician.installer_id,
      label: `${technician.technician_code} | ${technician.display_name}`,
    })),
    metrics: {
      activeForms: Number(metrics?.active_forms || 0),
      testReadyForms: Number(metrics?.test_ready_forms || 0),
      activeJobs: Number(metrics?.active_jobs || 0),
      awaitingReview: Number(metrics?.awaiting_review || 0),
      passedJobs: Number(metrics?.passed_jobs || 0),
      cataloguedPrograms: GOVERNMENT_PROGRAM_TEMPLATES.length,
      cataloguedActivities: GOVERNMENT_ACTIVITY_TEMPLATES.length,
    },
    boundaries: {
      regulatedCasesCreated: 0,
      evidenceObjectsCreated: 0,
      certificatesCreated: 0,
      regulatorSubmissionsCreated: 0,
      tradesCreated: 0,
      settlementsCreated: 0,
      governmentPolicyAuthority:
        "Separate governed evidence-policy workflow with independent approval",
    },
  };
}

export async function createStarterManualEvidenceForm(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence form request.",
  );
  const activityTemplateId = requiredText(
    body.activityTemplateId,
    180,
    "MANUAL_EVIDENCE_ACTIVITY_REQUIRED",
    "Activity",
  );
  const activity = manualEvidenceActivity(activityTemplateId);
  if (!activity) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_ACTIVITY_NOT_FOUND",
      404,
      "The selected activity is not catalogued.",
    );
  }
  const version = await nextFormVersion(
    database,
    member.organisationId,
    activity.templateId,
  );
  const schema = starterManualEvidenceForm(activity);
  const schemaJson = canonicalJson(schema);
  const snapshotJson = canonicalJson(activitySnapshot(activity));
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO compliance_manual_evidence_form_versions (
      id, organisation_id, program_code, activity_template_id,
      activity_snapshot, version, title, status, form_schema,
      form_schema_sha256, record_mode, revision, created_by_uid,
      updated_by_uid, created_at, locked_at, archived_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 'synthetic_test', 1,
      ?, ?, ?, '', '', ?)`)
    .bind(
      id,
      member.organisationId,
      activity.programCode,
      activity.templateId,
      snapshotJson,
      version,
      `${activity.programCode} ${activity.registryActivityCode || activity.activityKey} manual capture form`,
      schemaJson,
      await sha256Hex(schemaJson),
      member.uid,
      member.uid,
      now,
      now,
    )
    .run();
  return mapForm(requireForm(
    await formRow(database, member.organisationId, id),
  ));
}

export async function updateManualEvidenceForm(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence form update.",
  );
  const formId = requiredText(
    body.formId,
    180,
    "MANUAL_EVIDENCE_FORM_REQUIRED",
    "Manual evidence form",
  );
  const revision = positiveRevision(body.revision);
  const current = requireForm(
    await formRow(database, member.organisationId, formId),
  );
  if (current.status !== "draft") {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FORM_IMMUTABLE",
      409,
      "Test-ready and archived forms are immutable. Clone the form to change it.",
    );
  }
  if (Number(current.revision) !== revision) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The form changed before this save. Refresh and reconcile the current version.",
    );
  }
  let schema: ManualEvidenceFormSchema;
  try {
    schema = validateManualEvidenceFormSchema(body.schema);
  } catch (error) {
    if (error instanceof CreditexManualEvidenceContractError) {
      throw new CreditexManualEvidenceLabError(
        error.code,
        400,
        error.message,
      );
    }
    throw error;
  }
  const schemaJson = canonicalJson(schema);
  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE
      compliance_manual_evidence_form_versions
    SET title = ?, form_schema = ?, form_schema_sha256 = ?,
      revision = revision + 1, updated_by_uid = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND status = 'draft'
      AND revision = ?`)
    .bind(
      requiredText(
        body.title,
        240,
        "MANUAL_EVIDENCE_FORM_TITLE_REQUIRED",
        "Form title",
      ),
      schemaJson,
      await sha256Hex(schemaJson),
      member.uid,
      now,
      formId,
      member.organisationId,
      revision,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The form changed before this save. Refresh and reconcile the current version.",
    );
  }
  return mapForm(requireForm(
    await formRow(database, member.organisationId, formId),
  ));
}

export async function markManualEvidenceFormTestReady(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence form request.",
  );
  const formId = requiredText(
    body.formId,
    180,
    "MANUAL_EVIDENCE_FORM_REQUIRED",
    "Manual evidence form",
  );
  const revision = positiveRevision(body.revision);
  const current = requireForm(
    await formRow(database, member.organisationId, formId),
  );
  if (current.status !== "draft" || Number(current.revision) !== revision) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "Only the current draft can be locked for manual testing.",
    );
  }
  try {
    validateManualEvidenceFormSchema(JSON.parse(current.form_schema));
  } catch (error) {
    if (error instanceof CreditexManualEvidenceContractError) {
      throw new CreditexManualEvidenceLabError(
        error.code,
        400,
        error.message,
      );
    }
    throw error;
  }
  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE
      compliance_manual_evidence_form_versions
    SET status = 'test_ready', revision = revision + 1,
      locked_at = ?, updated_by_uid = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND status = 'draft'
      AND revision = ?`)
    .bind(
      now,
      member.uid,
      now,
      formId,
      member.organisationId,
      revision,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The form changed before it could be locked.",
    );
  }
  return mapForm(requireForm(
    await formRow(database, member.organisationId, formId),
  ));
}

export async function cloneManualEvidenceForm(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence form clone request.",
  );
  const formId = requiredText(
    body.formId,
    180,
    "MANUAL_EVIDENCE_FORM_REQUIRED",
    "Manual evidence form",
  );
  const current = requireForm(
    await formRow(database, member.organisationId, formId),
  );
  const version = await nextFormVersion(
    database,
    member.organisationId,
    current.activity_template_id,
  );
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO compliance_manual_evidence_form_versions (
      id, organisation_id, program_code, activity_template_id,
      activity_snapshot, version, title, status, form_schema,
      form_schema_sha256, record_mode, revision, created_by_uid,
      updated_by_uid, created_at, locked_at, archived_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 'synthetic_test', 1,
      ?, ?, ?, '', '', ?)`)
    .bind(
      id,
      member.organisationId,
      current.program_code,
      current.activity_template_id,
      current.activity_snapshot,
      version,
      `${current.title.replace(/\s+v\d+$/i, "")} v${version}`,
      current.form_schema,
      current.form_schema_sha256,
      member.uid,
      member.uid,
      now,
      now,
    )
    .run();
  return mapForm(requireForm(
    await formRow(database, member.organisationId, id),
  ));
}

export async function deleteDraftManualEvidenceForm(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence form delete request.",
  );
  const formId = requiredText(
    body.formId,
    180,
    "MANUAL_EVIDENCE_FORM_REQUIRED",
    "Manual evidence form",
  );
  const revision = positiveRevision(body.revision);
  const result = await database.prepare(`DELETE FROM
      compliance_manual_evidence_form_versions
    WHERE id = ? AND organisation_id = ? AND status = 'draft'
      AND revision = ?`)
    .bind(formId, member.organisationId, revision)
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FORM_IMMUTABLE",
      409,
      "Only the current unreferenced draft can be deleted.",
    );
  }
  return { deleted: true, formId };
}

async function selectedPilotIdentity(
  database: D1Database,
  organisationId: string,
  installerId: string,
  technicianId: string,
) {
  if (!installerId && !technicianId) {
    return {
      installerId: "",
      installerLabel: "Unassigned test installer",
      technicianId: "",
      technicianLabel: "Unassigned test technician",
    };
  }
  if (!installerId || !technicianId) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_TEAM_INVALID",
      400,
      "Choose both a test installer and its test technician.",
    );
  }
  const row = await database.prepare(`SELECT
      installer.id installer_id,
      installer.company_code,
      installer.business_name,
      technician.id technician_id,
      technician.technician_code,
      technician.display_name
    FROM compliance_pilot_installers installer
    JOIN compliance_pilot_technicians technician
      ON technician.installer_id = installer.id
      AND technician.pilot_run_id = installer.pilot_run_id
    JOIN compliance_pilot_runs run ON run.id = installer.pilot_run_id
    WHERE run.organisation_id = ? AND run.status = 'active'
      AND installer.id = ? AND technician.id = ?
      AND installer.status = 'test_active'
      AND technician.status = 'test_active'
    LIMIT 1`)
    .bind(organisationId, installerId, technicianId)
    .first<{
      installer_id: string;
      company_code: string;
      business_name: string;
      technician_id: string;
      technician_code: string;
      display_name: string;
    }>();
  if (!row) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_TEAM_INVALID",
      400,
      "Choose an active synthetic installer and one of its test technicians.",
    );
  }
  return {
    installerId: row.installer_id,
    installerLabel: `${row.company_code} | ${row.business_name}`,
    technicianId: row.technician_id,
    technicianLabel: `${row.technician_code} | ${row.display_name}`,
  };
}

export async function createManualEvidenceTestJob(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence test job request.",
  );
  const formId = requiredText(
    body.formId,
    180,
    "MANUAL_EVIDENCE_FORM_REQUIRED",
    "Test-ready evidence form",
  );
  const form = requireForm(
    await formRow(database, member.organisationId, formId),
  );
  if (form.status !== "test_ready") {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FORM_NOT_READY",
      409,
      "Lock the evidence form for manual testing before creating a job.",
    );
  }
  const schema = validateManualEvidenceFormSchema(
    JSON.parse(form.form_schema),
  );
  const installer = await selectedPilotIdentity(
    database,
    member.organisationId,
    optionalText(body.installerId, 180),
    optionalText(body.technicianId, 180),
  );
  const customerLabel = requiredText(
    body.customerLabel,
    160,
    "MANUAL_EVIDENCE_TEST_CUSTOMER_REQUIRED",
    "Synthetic customer alias",
  );
  if (!customerLabel.toLowerCase().startsWith("[test]")) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_CUSTOMER_INVALID",
      400,
      "Synthetic customer aliases must start with [TEST]. Do not enter real customer data.",
    );
  }
  const siteState = requiredText(
    body.siteState,
    3,
    "MANUAL_EVIDENCE_TEST_STATE_REQUIRED",
    "Test state",
  ).toUpperCase();
  if (!AUSTRALIAN_STATES.has(siteState)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_STATE_INVALID",
      400,
      "Choose an Australian state or territory.",
    );
  }
  const sitePostcode = requiredText(
    body.sitePostcode,
    4,
    "MANUAL_EVIDENCE_TEST_POSTCODE_REQUIRED",
    "Test postcode",
  );
  if (!/^\d{4}$/.test(sitePostcode)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_POSTCODE_INVALID",
      400,
      "Enter a four digit synthetic test postcode.",
    );
  }
  const responses = schema.fields.map((field) =>
    emptyManualEvidenceResponse(field.fieldCode)
  );
  const responseJson = canonicalJson(responses);
  const progress = manualEvidenceProgress(schema.fields, responses);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const jobNumber = [
    "TEST",
    form.program_code.replace(/[^A-Z0-9]/gi, "").slice(0, 10).toUpperCase(),
    now.replace(/\D/g, "").slice(2, 14),
    id.replace(/-/g, "").slice(0, 6).toUpperCase(),
  ].join("-");
  const [insertResult] = await database.batch([
    database.prepare(`INSERT INTO compliance_manual_evidence_test_jobs (
        id, organisation_id, form_version_id, program_code,
        activity_template_id, activity_snapshot, form_schema,
        form_schema_sha256, job_number, installer_id, installer_label,
        technician_id, technician_label, customer_label, site_state,
        site_postcode, status, response_snapshot, response_sha256,
        required_count, completed_required_count, issue_count, review_note,
        record_mode, revision, created_by_uid, updated_by_uid, passed_by_uid,
        created_at, passed_at, archived_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft',
        ?, ?, ?, ?, ?, '', 'synthetic_test', 1, ?, ?, '', ?, '', '', ?)`)
      .bind(
        id,
        member.organisationId,
        form.id,
        form.program_code,
        form.activity_template_id,
        form.activity_snapshot,
        form.form_schema,
        form.form_schema_sha256,
        jobNumber,
        installer.installerId,
        installer.installerLabel,
        installer.technicianId,
        installer.technicianLabel,
        customerLabel,
        siteState,
        sitePostcode,
        responseJson,
        await sha256Hex(responseJson),
        progress.requiredCount,
        progress.completedRequired,
        progress.issueCount,
        member.uid,
        member.uid,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_manual_evidence_test_events (
        id, organisation_id, job_id, event_type, actor_uid, summary, metadata,
        created_at
      ) VALUES (?, ?, ?, 'manual_test_job.created', ?,
        'Synthetic manual evidence test job created.', ?, ?)`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        id,
        member.uid,
        canonicalJson({
          formVersionId: form.id,
          formVersion: form.version,
          formSchemaSha256: form.form_schema_sha256,
          programCode: form.program_code,
          activityTemplateId: form.activity_template_id,
          status: "draft",
          responseSnapshot: responses,
          responseSha256: await sha256Hex(responseJson),
          requiredCount: progress.requiredCount,
          completedRequiredCount: progress.completedRequired,
          issueCount: progress.issueCount,
          reviewNote: "",
          recordMode: "synthetic_test",
        }),
        now,
      ),
  ]);
  if (Number(insertResult.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_WRITE_FAILED",
      500,
      "The synthetic manual evidence test job could not be created.",
    );
  }
  return mapJob(requireJob(
    await jobRow(database, member.organisationId, id),
  ));
}

export async function assignManualEvidenceFieldTester(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid TLink test assignment.",
  );
  const jobId = requiredText(
    body.jobId,
    180,
    "MANUAL_EVIDENCE_TEST_JOB_REQUIRED",
    "Manual evidence test job",
  );
  const revision = positiveRevision(body.revision);
  const current = requireJob(
    await jobRow(database, member.organisationId, jobId),
  );
  if (Number(current.revision) !== revision) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The test job changed before this assignment. Refresh and try again.",
    );
  }
  if (["ready_for_audit", "passed", "archived"].includes(current.status)) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FIELD_ASSIGNMENT_LOCKED",
      409,
      "Return the test job to field testing before changing its TLink assignment.",
    );
  }
  if (
    current.field_tester_uid
    && current.field_tester_uid !== member.uid
    && member.role !== "admin"
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_FIELD_ASSIGNMENT_REQUIRED",
      403,
      "An administrator must replace another tester's TLink assignment.",
    );
  }
  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare(`UPDATE compliance_manual_evidence_test_jobs
      SET field_tester_uid = ?, revision = revision + 1,
        updated_by_uid = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND revision = ?
        AND record_mode = 'synthetic_test'
        AND status IN ('draft', 'field_testing', 'changes_required')`)
      .bind(
        member.uid,
        member.uid,
        now,
        jobId,
        member.organisationId,
        revision,
      ),
    database.prepare(`INSERT INTO compliance_manual_evidence_test_events (
        id, organisation_id, job_id, event_type, actor_uid, summary,
        metadata, created_at
      ) SELECT ?, ?, ?, 'manual_field.tester_assigned', ?,
        'Synthetic job assigned to the current verified TLink login.',
        ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_manual_evidence_test_jobs
        WHERE id = ? AND organisation_id = ? AND revision = ?
          AND field_tester_uid = ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        jobId,
        member.uid,
        canonicalJson({
          previousFieldTesterUid: current.field_tester_uid,
          fieldTesterUid: member.uid,
          recordMode: "synthetic_test",
        }),
        now,
        jobId,
        member.organisationId,
        revision + 1,
        member.uid,
      ),
  ]);
  if (
    Number(results[0]?.meta.changes || 0) !== 1
    || Number(results[1]?.meta.changes || 0) !== 1
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The test job changed before the TLink assignment completed.",
    );
  }
  return mapJob(requireJob(
    await jobRow(database, member.organisationId, jobId),
  ));
}

function allowedStatusTransition(current: string, next: string) {
  if (current === next) return true;
  const transitions: Record<string, readonly string[]> = {
    draft: ["field_testing", "archived"],
    field_testing: ["ready_for_audit", "changes_required", "archived"],
    ready_for_audit: ["changes_required", "passed", "archived"],
    changes_required: ["field_testing", "ready_for_audit", "archived"],
    passed: ["archived"],
    archived: [],
  };
  return transitions[current]?.includes(next) || false;
}

export async function updateManualEvidenceTestJob(
  database: D1Database,
  member: ComplianceIdentity,
  input: unknown,
) {
  assertWriteRole(member);
  const body = recordInput(
    input,
    "MANUAL_EVIDENCE_REQUEST_INVALID",
    "Enter a valid manual evidence test job update.",
  );
  const jobId = requiredText(
    body.jobId,
    180,
    "MANUAL_EVIDENCE_TEST_JOB_REQUIRED",
    "Manual evidence test job",
  );
  const revision = positiveRevision(body.revision);
  const current = requireJob(
    await jobRow(database, member.organisationId, jobId),
  );
  if (Number(current.revision) !== revision) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The test job changed before this save. Refresh and reconcile the current result.",
    );
  }
  if (current.status === "archived") {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_IMMUTABLE",
      409,
      "Archived manual test jobs are immutable.",
    );
  }
  const schema = validateManualEvidenceFormSchema(
    JSON.parse(current.form_schema),
  );
  let currentResponses: ManualEvidenceResponse[];
  let responses: ManualEvidenceResponse[];
  try {
    currentResponses = validateManualEvidenceResponses(
      schema.fields,
      JSON.parse(current.response_snapshot),
    );
    responses = body.responses === undefined
      ? currentResponses
      : validateManualEvidenceResponses(schema.fields, body.responses);
    responses = responses.map((response) => {
      const field = schema.fields.find(
        (candidate) => candidate.fieldCode === response.fieldCode,
      );
      if (
        field?.fieldType !== "photo"
        && field?.fieldType !== "document"
      ) return response;
      return currentResponses.find(
        (currentResponse) =>
          currentResponse.fieldCode === response.fieldCode,
      ) || response;
    });
  } catch (error) {
    if (error instanceof CreditexManualEvidenceContractError) {
      throw new CreditexManualEvidenceLabError(
        error.code,
        400,
        error.message,
      );
    }
    throw error;
  }
  const currentResponseJson = canonicalJson(currentResponses);
  const responseJson = canonicalJson(responses);
  const nextStatus = optionalText(body.status, 40) || current.status;
  if (
    !MANUAL_JOB_STATUSES.has(nextStatus)
    || !allowedStatusTransition(current.status, nextStatus)
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_TRANSITION_INVALID",
      409,
      "The manual test job cannot move to that state.",
    );
  }
  const progress = manualEvidenceProgress(schema.fields, responses);
  const reviewNote = body.reviewNote === undefined
    ? current.review_note
    : optionalText(body.reviewNote, 2_000);
  if (nextStatus === "ready_for_audit" && !progress.readyForAudit) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_INCOMPLETE",
      409,
      "Complete every required prompt and resolve issues before requesting review.",
    );
  }
  if (nextStatus === "passed") {
    assertReviewRole(member);
    if (!progress.readyForAudit) {
      throw new CreditexManualEvidenceLabError(
        "MANUAL_EVIDENCE_TEST_JOB_INCOMPLETE",
        409,
        "Every required prompt must be complete before the synthetic workflow can pass.",
      );
    }
    if (reviewNote.length < 10) {
      throw new CreditexManualEvidenceLabError(
        "MANUAL_EVIDENCE_REVIEW_NOTE_REQUIRED",
        400,
        "Record the manual audit completed before passing the synthetic workflow.",
      );
    }
  }
  if (nextStatus === "changes_required") {
    assertReviewRole(member);
    if (reviewNote.length < 10) {
      throw new CreditexManualEvidenceLabError(
        "MANUAL_EVIDENCE_REVIEW_NOTE_REQUIRED",
        400,
        "Explain the changes the installer must make.",
      );
    }
  }
  if (
    current.status === "ready_for_audit"
    && responseJson !== currentResponseJson
  ) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVIEW_SNAPSHOT_LOCKED",
      409,
      "Return the job for changes before modifying a submitted evidence response.",
    );
  }
  if (current.status === "passed" && nextStatus !== "archived") {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_TEST_JOB_IMMUTABLE",
      409,
      "Passed manual test jobs are immutable.",
    );
  }
  const responseSha256 = await sha256Hex(responseJson);
  const now = new Date().toISOString();
  const passedAt = nextStatus === "passed" ? now : current.passed_at;
  const passedByUid = nextStatus === "passed" ? member.uid : current.passed_by_uid;
  const archivedAt = nextStatus === "archived" ? now : current.archived_at;
  const [updateResult, eventResult] = await database.batch([
    database.prepare(`UPDATE compliance_manual_evidence_test_jobs
      SET status = ?, response_snapshot = ?, response_sha256 = ?,
        required_count = ?, completed_required_count = ?, issue_count = ?,
        review_note = ?, revision = revision + 1, updated_by_uid = ?,
        passed_by_uid = ?, passed_at = ?, archived_at = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND revision = ?`)
      .bind(
        nextStatus,
        responseJson,
        responseSha256,
        progress.requiredCount,
        progress.completedRequired,
        progress.issueCount,
        reviewNote,
        member.uid,
        passedByUid,
        passedAt,
        archivedAt,
        now,
        jobId,
        member.organisationId,
        revision,
      ),
    database.prepare(`INSERT INTO compliance_manual_evidence_test_events (
        id, organisation_id, job_id, event_type, actor_uid, summary, metadata,
        created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_manual_evidence_test_jobs
        WHERE id = ? AND organisation_id = ? AND revision = ?
          AND updated_at = ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        jobId,
        `manual_test_job.${nextStatus}`,
        member.uid,
        nextStatus === current.status
          ? "Manual evidence test responses updated."
          : `Manual evidence test moved from ${current.status} to ${nextStatus}.`,
        canonicalJson({
          previousStatus: current.status,
          status: nextStatus,
          previousResponseSha256: current.response_sha256,
          responseSnapshot: responses,
          responseSha256,
          requiredCount: progress.requiredCount,
          completedRequiredCount: progress.completedRequired,
          issueCount: progress.issueCount,
          reviewNote,
          recordMode: "synthetic_test",
        }),
        now,
        jobId,
        member.organisationId,
        revision + 1,
        now,
      ),
  ]);
  if (Number(updateResult.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_REVISION_CONFLICT",
      409,
      "The test job changed before this save. Refresh and reconcile the current result.",
    );
  }
  if (Number(eventResult.meta.changes || 0) !== 1) {
    throw new CreditexManualEvidenceLabError(
      "MANUAL_EVIDENCE_AUDIT_EVENT_WRITE_FAILED",
      500,
      "The synthetic job audit event could not be recorded.",
    );
  }
  return mapJob(requireJob(
    await jobRow(database, member.organisationId, jobId),
  ));
}

export async function loadManualEvidenceTestJobEvents(
  database: D1Database,
  member: ComplianceIdentity,
  jobId: string,
) {
  requireJob(await jobRow(database, member.organisationId, jobId));
  const result = await database.prepare(`SELECT
      id, event_type, actor_uid, summary, metadata, created_at
    FROM compliance_manual_evidence_test_events
    WHERE organisation_id = ? AND job_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 200`)
    .bind(member.organisationId, jobId)
    .all<{
      id: string;
      event_type: string;
      actor_uid: string;
      summary: string;
      metadata: string;
      created_at: string;
    }>();
  return result.results.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    actorUid: event.actor_uid,
    summary: event.summary,
    metadata: parseJson<Record<string, unknown>>(event.metadata, {}),
    createdAt: event.created_at,
  }));
}
