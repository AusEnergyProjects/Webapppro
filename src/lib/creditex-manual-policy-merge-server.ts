import type { ComplianceIdentity } from "./compliance-access-server.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type GovernmentActivityTemplate,
  type GovernmentProgramTemplate,
} from "./australian-government-program-catalogue.ts";
import {
  buildManualEvidenceFormV2CompositionPreview,
  canonicalManualPolicyJson,
  CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
  CreditexManualPolicyMergeError,
  manualPolicySha256,
  validatePinnedManualEvidenceFormV2,
  validateManualPolicyActivityReference,
  validateManualPolicyBindingSnapshot,
  type ApprovedManualPolicyBinding,
  type ManualEvidenceFormV2,
  type ManualPolicyActivityReference,
  type ManualPolicyBindingLifecycle,
  type ManualPolicyBindingSnapshot,
  type ManualPolicyGovernmentRequirement,
  type ManualPolicyJson,
} from "./creditex-manual-policy-merge.ts";
import {
  requireCurrentApprovedOfficialSourceBinding,
} from "./creditex-source-lookup-review-server.ts";

type ManualPolicyMember = Pick<
  ComplianceIdentity,
  "uid" | "organisationId" | "role" | "governanceIdentityVerified"
>;

type GovernedChainRow = Record<string, unknown>;

type BindingRow = {
  id: string;
  organisation_id: string;
  activity_template_id: string;
  version: number;
  program_id: string;
  activity_version_id: string;
  evidence_policy_version_id: string;
  program_source_binding_id: string;
  activity_source_binding_id: string;
  evidence_policy_source_binding_id: string;
  binding_snapshot: string;
  binding_snapshot_sha256: string;
  lifecycle_state: ManualPolicyBindingLifecycle;
  requested_by_uid: string;
  requested_at: string;
  approved_by_uid: string;
  approved_at: string;
  approval_note: string;
  withdrawn_by_uid: string;
  withdrawn_at: string;
  withdrawal_note: string;
  created_at: string;
  updated_at: string;
};

type RequirementRow = {
  id: string;
  requirement_code: string;
  title: string;
  description: string;
  evidence_type: string;
  capture_timing: string;
  minimum_count: number;
  maximum_count: number;
  original_required: number;
  metadata_required: number;
  gps_required: number;
  date_stamp_required: number;
  installer_signature_required: number;
  customer_signature_required: number;
  allowed_content_types: string;
  condition_snapshot: string;
  field_schema: string;
  source_citation: string;
  sort_order: number;
};

type CompositionLockRow = {
  id: string;
  organisation_id: string;
  binding_id: string;
  binding_version: number;
  binding_snapshot_sha256: string;
  activity_template_id: string;
  activity_version_id: string;
  reference_type: ManualPolicyActivityReference["referenceType"];
  reference_id: string;
  reference_activity_date: string;
  reference_updated_at: string;
  reference_snapshot_sha256: string;
  revision: number;
  composition_snapshot: string;
  composition_sha256: string;
  diff_snapshot: string;
  diff_sha256: string;
  locked_by_uid: string;
  locked_at: string;
  superseded_by_id: string;
  superseded_at: string;
};

const BINDING_SELECT = `SELECT id, organisation_id, activity_template_id,
    version, program_id, activity_version_id, evidence_policy_version_id,
    program_source_binding_id, activity_source_binding_id,
    evidence_policy_source_binding_id, binding_snapshot,
    binding_snapshot_sha256, lifecycle_state, requested_by_uid, requested_at,
    approved_by_uid, approved_at, approval_note, withdrawn_by_uid,
    withdrawn_at, withdrawal_note, created_at, updated_at
  FROM compliance_manual_policy_bindings`;

const COMPOSITION_LOCK_SELECT = `SELECT id, organisation_id, binding_id,
    binding_version, binding_snapshot_sha256, activity_template_id,
    activity_version_id, reference_type, reference_id,
    reference_activity_date, reference_updated_at,
    reference_snapshot_sha256, revision,
    composition_snapshot, composition_sha256, diff_snapshot, diff_sha256,
    locked_by_uid, locked_at, superseded_by_id, superseded_at
  FROM compliance_manual_policy_composition_locks`;

const GOVERNED_CHAIN_SELECT = `SELECT
    program.id program_id,
    program.program_code,
    program.name program_name,
    program.scheme_kind,
    program.jurisdiction program_jurisdiction,
    program.administering_body,
    program.official_source_url program_source_url,
    program.official_source_title program_source_title,
    program.official_source_version program_source_version,
    program.official_source_sha256 program_source_sha256,
    program.official_source_checked_at program_source_checked_at,
    program.publication_request_id program_publication_request_id,
    program.publication_snapshot_sha256 program_publication_snapshot_sha256,
    program.published_by_uid program_published_by_uid,
    program.published_at program_published_at,
    activity.id activity_id,
    activity.activity_key,
    activity.version activity_version,
    activity.title activity_title,
    activity.service_category,
    activity.registry_activity_code,
    activity.specification_part,
    activity.product_category,
    activity.scenario_code,
    activity.scenario,
    activity.jurisdiction activity_jurisdiction,
    activity.effective_from,
    activity.effective_to,
    activity.official_source_url activity_source_url,
    activity.official_source_title activity_source_title,
    activity.official_source_version activity_source_version,
    activity.official_source_sha256 activity_source_sha256,
    activity.official_source_checked_at activity_source_checked_at,
    activity.publication_request_id activity_publication_request_id,
    activity.publication_snapshot_sha256 activity_publication_snapshot_sha256,
    activity.published_by_uid activity_published_by_uid,
    activity.published_at activity_published_at,
    policy.id evidence_policy_id,
    policy.organisation_id evidence_policy_organisation_id,
    policy.version evidence_policy_version,
    policy.title evidence_policy_title,
    policy.official_source_url evidence_policy_source_url,
    policy.official_source_title evidence_policy_source_title,
    policy.official_source_version evidence_policy_source_version,
    policy.official_source_sha256 evidence_policy_source_sha256,
    policy.official_source_checked_at evidence_policy_source_checked_at,
    policy.publication_request_id evidence_policy_publication_request_id,
    policy.publication_snapshot_sha256 evidence_policy_publication_snapshot_sha256,
    policy.content_revision evidence_policy_content_revision,
    policy.published_by_uid evidence_policy_published_by_uid,
    policy.published_at evidence_policy_published_at
  FROM compliance_programs program
  JOIN compliance_activity_versions activity
    ON activity.program_id = program.id
  JOIN compliance_evidence_policy_versions policy
    ON policy.activity_version_id = activity.id
    AND policy.organisation_id = program.organisation_id`;

function fail(code: string, status: number, message: string): never {
  throw new CreditexManualPolicyMergeError(code, status, message);
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
) {
  const cleaned = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : "";
  if (!cleaned || cleaned.length > maximum) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanNote(value: unknown, code: string, label: string) {
  const note = cleanText(
    value,
    1_000,
    code,
    `${label} must explain the governance decision.`,
  );
  if (note.length < 10) {
    fail(code, 400, `${label} must contain at least 10 characters.`);
  }
  return note;
}

function exactRevision(
  value: unknown,
  minimum: number,
  code: string,
  message: string,
) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < minimum
    || Number(value) > 1_000_000_000
  ) {
    fail(code, 400, message);
  }
  return Number(value);
}

function exactHash(value: unknown, code: string, message: string) {
  const hash = cleanText(value, 64, code, message).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(code, 400, message);
  }
  return hash;
}

function optionalExactHash(value: unknown, code: string, message: string) {
  if (value === undefined || value === null || value === "") return "";
  return exactHash(value, code, message);
}

function requireGovernanceAdmin(member: ManualPolicyMember) {
  if (member.role !== "admin" || !member.governanceIdentityVerified) {
    fail(
      "MANUAL_POLICY_GOVERNANCE_ADMIN_REQUIRED",
      403,
      "A named Creditex administrator with independently verified governance identity is required.",
    );
  }
}

function parseJson(value: string, code: string, message: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(code, 500, message);
  }
}

function parsedGovernedJson(
  value: string,
  code: string,
  label: string,
): ManualPolicyJson {
  const parsed = parseJson(
    value,
    code,
    `${label} contains invalid governed JSON.`,
  );
  if (
    parsed === undefined
    || typeof parsed === "function"
    || typeof parsed === "symbol"
  ) {
    return fail(code, 500, `${label} contains invalid governed JSON.`);
  }
  return parsed as ManualPolicyJson;
}

function publicBinding(row: BindingRow) {
  const bindingSnapshot = validateManualPolicyBindingSnapshot(
    parseJson(
      row.binding_snapshot,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "The stored governed binding snapshot is invalid.",
    ),
  );
  return {
    id: row.id,
    organisationId: row.organisation_id,
    activityTemplateId: row.activity_template_id,
    version: Number(row.version),
    programId: row.program_id,
    activityVersionId: row.activity_version_id,
    evidencePolicyVersionId: row.evidence_policy_version_id,
    bindingSnapshot,
    bindingSnapshotSha256: row.binding_snapshot_sha256,
    lifecycleState: row.lifecycle_state,
    requestedByUid: row.requested_by_uid,
    requestedAt: row.requested_at,
    approvedByUid: row.approved_by_uid,
    approvedAt: row.approved_at,
    approvalNote: row.approval_note,
    withdrawnByUid: row.withdrawn_by_uid,
    withdrawnAt: row.withdrawn_at,
    withdrawalNote: row.withdrawal_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function approvedBinding(row: BindingRow): ApprovedManualPolicyBinding {
  const binding = publicBinding(row);
  return {
    id: binding.id,
    version: binding.version,
    lifecycleState: binding.lifecycleState,
    bindingSnapshot: binding.bindingSnapshot,
    bindingSnapshotSha256: binding.bindingSnapshotSha256,
    approvedByUid: binding.approvedByUid,
    approvedAt: binding.approvedAt,
  };
}

function publicCompositionLock(row: CompositionLockRow) {
  return {
    id: row.id,
    bindingId: row.binding_id,
    bindingVersion: Number(row.binding_version),
    bindingSnapshotSha256: row.binding_snapshot_sha256,
    activityTemplateId: row.activity_template_id,
    activityVersionId: row.activity_version_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    referenceActivityDate: row.reference_activity_date,
    referenceUpdatedAt: row.reference_updated_at,
    referenceSnapshotSha256: row.reference_snapshot_sha256,
    revision: Number(row.revision),
    composition: parseJson(
      row.composition_snapshot,
      "MANUAL_POLICY_COMPOSITION_INVALID",
      "The persisted composition snapshot is invalid.",
    ) as ManualEvidenceFormV2,
    compositionSha256: row.composition_sha256,
    diff: parseJson(
      row.diff_snapshot,
      "MANUAL_POLICY_COMPOSITION_DIFF_INVALID",
      "The persisted composition diff is invalid.",
    ),
    diffSha256: row.diff_sha256,
    lockedByUid: row.locked_by_uid,
    lockedAt: row.locked_at,
    supersededById: row.superseded_by_id,
    supersededAt: row.superseded_at,
  };
}

async function loadBindingRow(
  database: D1Database,
  organisationId: string,
  bindingId: string,
) {
  const row = await database.prepare(`${BINDING_SELECT}
    WHERE id = ? AND organisation_id = ?
    LIMIT 1`)
    .bind(bindingId, organisationId)
    .first<BindingRow>();
  if (!row) {
    fail(
      "MANUAL_POLICY_BINDING_NOT_FOUND",
      404,
      "The governed manual-policy binding was not found.",
    );
  }
  return row;
}

async function currentCompositionLockRow(
  database: D1Database,
  organisationId: string,
  referenceType: ManualPolicyActivityReference["referenceType"],
  referenceId: string,
) {
  return database.prepare(`${COMPOSITION_LOCK_SELECT}
    WHERE organisation_id = ?
      AND reference_type = ?
      AND reference_id = ?
      AND superseded_by_id = ''
    LIMIT 1`)
    .bind(organisationId, referenceType, referenceId)
    .first<CompositionLockRow>();
}

async function requireUnambiguousPublishedActivityDate(
  database: D1Database,
  organisationId: string,
  bindingSnapshot: ManualPolicyBindingSnapshot,
  activityDate: string,
) {
  const row = await database.prepare(`SELECT count(*) matching_count,
      sum(CASE WHEN activity.id = ? THEN 1 ELSE 0 END) expected_count
    FROM compliance_activity_versions activity
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = ?
      AND program.publish_state = 'published'
    WHERE activity.publish_state = 'published'
      AND activity.activity_key = ?
      AND ? >= activity.effective_from
      AND (activity.effective_to = '' OR ? <= activity.effective_to)`)
    .bind(
      bindingSnapshot.activity.id,
      organisationId,
      bindingSnapshot.activity.activityKey,
      activityDate,
      activityDate,
    )
    .first<Record<string, unknown>>();
  if (
    Number(row?.matching_count || 0) !== 1
    || Number(row?.expected_count || 0) !== 1
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_DATE_VERSION_AMBIGUOUS",
      409,
      "The authoritative job activity date does not resolve to one unique published activity version.",
    );
  }
}

async function authoritativeActivityReference(
  database: D1Database,
  organisationId: string,
  bindingSnapshot: ManualPolicyBindingSnapshot,
  input: Record<string, unknown>,
): Promise<ManualPolicyActivityReference> {
  const referenceType = cleanText(
    input.referenceType,
    40,
    "MANUAL_POLICY_ACTIVITY_REFERENCE_REQUIRED",
    "Choose an authoritative dated job or case.",
  );
  const referenceId = cleanText(
    input.referenceId,
    180,
    "MANUAL_POLICY_ACTIVITY_REFERENCE_REQUIRED",
    "Choose an authoritative dated job or case.",
  );
  if (referenceType === "compliance_case") {
    const row = await database.prepare(`SELECT id, organisation_id,
        program_id, activity_version_id, activity_date, activity_snapshot,
        revision, updated_at
      FROM compliance_cases
      WHERE id = ? AND organisation_id = ?
      LIMIT 1`)
      .bind(referenceId, organisationId)
      .first<Record<string, unknown>>();
    if (!row) {
      fail(
        "MANUAL_POLICY_ACTIVITY_REFERENCE_NOT_FOUND",
        404,
        "The authoritative compliance case was not found.",
      );
    }
    if (
      String(row.program_id) !== bindingSnapshot.program.id
      || String(row.activity_version_id) !== bindingSnapshot.activity.id
    ) {
      fail(
        "MANUAL_POLICY_ACTIVITY_REFERENCE_MISMATCH",
        409,
        "The compliance case is not linked to this exact published program and activity version.",
      );
    }
    const referenceSnapshot = {
      contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
      referenceType,
      referenceMode: "regulated_case",
      referenceId: String(row.id),
      organisationId: String(row.organisation_id),
      programId: String(row.program_id),
      activityVersionId: String(row.activity_version_id),
      activityTemplateId: bindingSnapshot.activityTemplate.templateId,
      activityDate: String(row.activity_date),
      referenceRevision: Number(row.revision),
      referenceUpdatedAt: String(row.updated_at),
      activitySnapshot: parsedGovernedJson(
        String(row.activity_snapshot),
        "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
        "Compliance case activity snapshot",
      ),
    };
    const reference = validateManualPolicyActivityReference({
      contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
      referenceType,
      referenceId,
      referenceMode: "regulated_case",
      activityDate: String(row.activity_date),
      activityVersionId: String(row.activity_version_id),
      activityTemplateId: bindingSnapshot.activityTemplate.templateId,
      referenceRevision: Number(row.revision),
      referenceUpdatedAt: String(row.updated_at),
      referenceSnapshotSha256: await manualPolicySha256(
        canonicalManualPolicyJson(referenceSnapshot),
      ),
    }, bindingSnapshot);
    await requireUnambiguousPublishedActivityDate(
      database,
      organisationId,
      bindingSnapshot,
      reference.activityDate,
    );
    return reference;
  }
  if (referenceType === "synthetic_pilot_job") {
    const row = await database.prepare(`SELECT job.id, job.pilot_run_id,
        job.activity_template_id, job.activity_key,
        job.registry_activity_code, job.activity_date, job.record_mode,
        job.review_status, job.updated_at
      FROM compliance_pilot_jobs job
      JOIN compliance_pilot_runs run
        ON run.id = job.pilot_run_id
        AND run.organisation_id = ?
        AND run.status = 'active'
      WHERE job.id = ?
        AND job.record_mode = 'synthetic_test'
      LIMIT 1`)
      .bind(organisationId, referenceId)
      .first<Record<string, unknown>>();
    if (!row) {
      fail(
        "MANUAL_POLICY_ACTIVITY_REFERENCE_NOT_FOUND",
        404,
        "The authoritative synthetic pilot job was not found.",
      );
    }
    if (
      String(row.activity_template_id)
        !== bindingSnapshot.activityTemplate.templateId
      || String(row.activity_key) !== bindingSnapshot.activity.activityKey
      || String(row.registry_activity_code)
        !== bindingSnapshot.activity.registryActivityCode
    ) {
      fail(
        "MANUAL_POLICY_ACTIVITY_REFERENCE_MISMATCH",
        409,
        "The synthetic pilot job is not linked to this exact controlled activity template.",
      );
    }
    const referenceSnapshot = {
      contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
      referenceType,
      referenceMode: "synthetic_test",
      referenceId: String(row.id),
      organisationId,
      pilotRunId: String(row.pilot_run_id),
      activityVersionId: bindingSnapshot.activity.id,
      activityTemplateId: String(row.activity_template_id),
      activityKey: String(row.activity_key),
      registryActivityCode: String(row.registry_activity_code),
      activityDate: String(row.activity_date),
      recordMode: String(row.record_mode),
      reviewStatus: String(row.review_status),
      updatedAt: String(row.updated_at),
      referenceRevision: 1,
    };
    const reference = validateManualPolicyActivityReference({
      contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
      referenceType,
      referenceId,
      referenceMode: "synthetic_test",
      activityDate: String(row.activity_date),
      activityVersionId: bindingSnapshot.activity.id,
      activityTemplateId: String(row.activity_template_id),
      referenceRevision: 1,
      referenceUpdatedAt: String(row.updated_at),
      referenceSnapshotSha256: await manualPolicySha256(
        canonicalManualPolicyJson(referenceSnapshot),
      ),
    }, bindingSnapshot);
    await requireUnambiguousPublishedActivityDate(
      database,
      organisationId,
      bindingSnapshot,
      reference.activityDate,
    );
    return reference;
  }
  fail(
    "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
    400,
    "Choose a compliance case or synthetic pilot job as the dated activity reference.",
  );
}

function exactStaticMatch(
  activityTemplate: GovernmentActivityTemplate,
  programTemplate: GovernmentProgramTemplate,
  chain: GovernedChainRow,
) {
  const comparisons: Array<[unknown, unknown, string]> = [
    [chain.program_code, activityTemplate.programCode, "program code"],
    [chain.program_code, programTemplate.programCode, "program template"],
    [chain.program_name, programTemplate.name, "program name"],
    [chain.scheme_kind, programTemplate.outcomeClass, "scheme kind"],
    [chain.program_jurisdiction, programTemplate.jurisdiction, "program jurisdiction"],
    [chain.administering_body, programTemplate.administeringBody, "administering body"],
    [chain.activity_key, activityTemplate.activityKey, "activity key"],
    [chain.activity_title, activityTemplate.title, "activity title"],
    [chain.service_category, activityTemplate.serviceCategory, "service category"],
    [chain.registry_activity_code, activityTemplate.registryActivityCode, "registry activity code"],
    [chain.specification_part, activityTemplate.specificationPart, "specification part"],
    [chain.product_category, activityTemplate.productCategory, "product category"],
    [chain.scenario_code, activityTemplate.scenarioCode, "scenario code"],
    [chain.scenario, activityTemplate.scenario, "scenario"],
    [chain.activity_jurisdiction, programTemplate.jurisdiction, "activity jurisdiction"],
  ];
  const mismatch = comparisons.find(([actual, expected]) =>
    String(actual ?? "") !== String(expected ?? "")
  );
  if (mismatch) {
    fail(
      "MANUAL_POLICY_STATIC_BINDING_MISMATCH",
      409,
      `The governed ${mismatch[2]} does not exactly match the controlled activity template.`,
    );
  }
}

async function governedChain(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  evidencePolicyVersionId: string,
) {
  const row = await database.prepare(`${GOVERNED_CHAIN_SELECT}
    WHERE program.organisation_id = ?
      AND activity.id = ?
      AND policy.id = ?
      AND program.publish_state = 'published'
      AND activity.publish_state = 'published'
      AND policy.publish_state = 'published'
      AND policy.requirements_complete = 1
    LIMIT 1`)
    .bind(organisationId, activityVersionId, evidencePolicyVersionId)
    .first<GovernedChainRow>();
  if (!row) {
    fail(
      "GOVERNED_POLICY_INVENTORY_EMPTY",
      409,
      "No matching published program, activity and complete evidence policy is available for binding.",
    );
  }
  return row;
}

async function governedRequirements(
  database: D1Database,
  organisationId: string,
  evidencePolicyVersionId: string,
) {
  const rows = await database.prepare(`SELECT id, requirement_code, title,
      description, evidence_type, capture_timing, minimum_count,
      maximum_count, original_required, metadata_required, gps_required,
      date_stamp_required, installer_signature_required,
      customer_signature_required, allowed_content_types,
      condition_snapshot, field_schema, source_citation, sort_order
    FROM compliance_evidence_requirements
    WHERE organisation_id = ? AND policy_version_id = ?
    ORDER BY sort_order, requirement_code COLLATE NOCASE, id`)
    .bind(organisationId, evidencePolicyVersionId)
    .all<RequirementRow>();
  if (!rows.results.length) {
    fail(
      "GOVERNED_POLICY_INVENTORY_EMPTY",
      409,
      "The published complete evidence policy has no governed requirements.",
    );
  }
  return rows.results.map((row): ManualPolicyGovernmentRequirement => ({
    id: row.id,
    requirementCode: row.requirement_code,
    title: row.title,
    description: row.description,
    evidenceType: row.evidence_type,
    captureTiming: row.capture_timing,
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
    allowedContentTypes: parsedGovernedJson(
      row.allowed_content_types,
      "MANUAL_POLICY_REQUIREMENT_INVALID",
      "Allowed content types",
    ),
    conditionSnapshot: parsedGovernedJson(
      row.condition_snapshot,
      "MANUAL_POLICY_REQUIREMENT_INVALID",
      "Requirement condition",
    ),
    fieldSchema: parsedGovernedJson(
      row.field_schema,
      "MANUAL_POLICY_REQUIREMENT_INVALID",
      "Requirement field schema",
    ),
    sourceCitation: row.source_citation,
    sortOrder: Number(row.sort_order),
  }));
}

function buildSnapshot(
  organisationId: string,
  activityTemplate: GovernmentActivityTemplate,
  chain: GovernedChainRow,
  sourceApprovals: ManualPolicyBindingSnapshot["sourceApprovals"],
  requirements: ManualPolicyGovernmentRequirement[],
): ManualPolicyBindingSnapshot {
  return validateManualPolicyBindingSnapshot({
    contract: "creditex-manual-policy-binding-v1",
    organisationId,
    activityTemplate: { ...activityTemplate },
    program: {
      id: String(chain.program_id),
      programCode: String(chain.program_code),
      name: String(chain.program_name),
      schemeKind: String(chain.scheme_kind),
      jurisdiction: String(chain.program_jurisdiction),
      administeringBody: String(chain.administering_body),
      officialSourceUrl: String(chain.program_source_url),
      officialSourceTitle: String(chain.program_source_title),
      officialSourceVersion: String(chain.program_source_version || ""),
      officialSourceSha256: String(chain.program_source_sha256).toLowerCase(),
      officialSourceCheckedAt: String(chain.program_source_checked_at),
      publicationRequestId: String(chain.program_publication_request_id),
      publicationSnapshotSha256:
        String(chain.program_publication_snapshot_sha256).toLowerCase(),
      publishedByUid: String(chain.program_published_by_uid),
      publishedAt: String(chain.program_published_at),
    },
    activity: {
      id: String(chain.activity_id),
      programId: String(chain.program_id),
      activityKey: String(chain.activity_key),
      version: Number(chain.activity_version),
      title: String(chain.activity_title),
      serviceCategory: String(chain.service_category),
      registryActivityCode: String(chain.registry_activity_code || ""),
      specificationPart: String(chain.specification_part || ""),
      productCategory: String(chain.product_category),
      scenarioCode: String(chain.scenario_code || ""),
      scenario: String(chain.scenario),
      jurisdiction: String(chain.activity_jurisdiction),
      effectiveFrom: String(chain.effective_from),
      effectiveTo: String(chain.effective_to || ""),
      officialSourceUrl: String(chain.activity_source_url),
      officialSourceTitle: String(chain.activity_source_title),
      officialSourceVersion: String(chain.activity_source_version || ""),
      officialSourceSha256: String(chain.activity_source_sha256).toLowerCase(),
      officialSourceCheckedAt: String(chain.activity_source_checked_at),
      publicationRequestId: String(chain.activity_publication_request_id),
      publicationSnapshotSha256:
        String(chain.activity_publication_snapshot_sha256).toLowerCase(),
      publishedByUid: String(chain.activity_published_by_uid),
      publishedAt: String(chain.activity_published_at),
    },
    evidencePolicy: {
      id: String(chain.evidence_policy_id),
      organisationId: String(chain.evidence_policy_organisation_id),
      activityVersionId: String(chain.activity_id),
      version: Number(chain.evidence_policy_version),
      title: String(chain.evidence_policy_title),
      officialSourceUrl: String(chain.evidence_policy_source_url),
      officialSourceTitle: String(chain.evidence_policy_source_title),
      officialSourceVersion: String(chain.evidence_policy_source_version),
      officialSourceSha256:
        String(chain.evidence_policy_source_sha256).toLowerCase(),
      officialSourceCheckedAt:
        String(chain.evidence_policy_source_checked_at),
      publicationRequestId:
        String(chain.evidence_policy_publication_request_id),
      publicationSnapshotSha256:
        String(chain.evidence_policy_publication_snapshot_sha256).toLowerCase(),
      contentRevision: Number(chain.evidence_policy_content_revision),
      publishedByUid: String(chain.evidence_policy_published_by_uid),
      publishedAt: String(chain.evidence_policy_published_at),
    },
    sourceApprovals,
    requirements,
  });
}

async function exactSourceBindingStillApproved(
  database: D1Database,
  organisationId: string,
  bindingId: string,
  targetType: "program" | "activity" | "evidence_policy",
  targetId: string,
  expectedSha256: string,
) {
  const row = await database.prepare(`SELECT binding.id
    FROM compliance_official_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.artifact_id
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.sha256 = ?
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
    JOIN compliance_official_source_review_decisions artifact_review
      ON artifact_review.organisation_id = artifact.organisation_id
      AND artifact_review.subject_type = 'artifact'
      AND artifact_review.subject_id = artifact.id
      AND artifact_review.artifact_id = artifact.id
      AND artifact_review.artifact_sha256 = artifact.sha256
      AND artifact_review.artifact_object_key = artifact.object_key
      AND artifact_review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = artifact_review.organisation_id
          AND newer.subject_type = artifact_review.subject_type
          AND newer.subject_id = artifact_review.subject_id
          AND (
            newer.reviewed_at > artifact_review.reviewed_at
            OR (
              newer.reviewed_at = artifact_review.reviewed_at
              AND newer.id > artifact_review.id
            )
          )
      )
    JOIN compliance_official_source_review_decisions binding_review
      ON binding_review.organisation_id = binding.organisation_id
      AND binding_review.subject_type = 'binding'
      AND binding_review.subject_id = binding.id
      AND binding_review.artifact_id = artifact.id
      AND binding_review.artifact_sha256 = artifact.sha256
      AND binding_review.artifact_object_key = artifact.object_key
      AND binding_review.binding_target_type = binding.target_type
      AND binding_review.binding_target_id = binding.target_id
      AND binding_review.citation_location = binding.citation_location
      AND binding_review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = binding_review.organisation_id
          AND newer.subject_type = binding_review.subject_type
          AND newer.subject_id = binding_review.subject_id
          AND (
            newer.reviewed_at > binding_review.reviewed_at
            OR (
              newer.reviewed_at = binding_review.reviewed_at
              AND newer.id > binding_review.id
            )
          )
      )
    WHERE binding.id = ?
      AND binding.organisation_id = ?
      AND binding.target_type = ?
      AND binding.target_id = ?
      AND binding.binding_state IN ('draft', 'pending_review')
      AND binding.rule_activation_enabled = 0
    LIMIT 1`)
    .bind(
      expectedSha256.toLowerCase(),
      bindingId,
      organisationId,
      targetType,
      targetId,
    )
    .first<{ id: string }>();
  if (!row) {
    fail(
      "SOURCE_BINDING_APPROVAL_REQUIRED",
      409,
      "The exact retained source and target binding no longer have current independent approval.",
    );
  }
}

async function rebuildStoredSnapshot(
  database: D1Database,
  row: BindingRow,
  activityTemplate: GovernmentActivityTemplate,
) {
  const chain = await governedChain(
    database,
    row.organisation_id,
    row.activity_version_id,
    row.evidence_policy_version_id,
  );
  const programTemplate = GOVERNMENT_PROGRAM_TEMPLATES.find(
    ({ programCode }) => programCode === activityTemplate.programCode,
  );
  if (!programTemplate) {
    fail(
      "MANUAL_POLICY_PROGRAM_TEMPLATE_NOT_FOUND",
      409,
      "The controlled government program template is not available.",
    );
  }
  exactStaticMatch(activityTemplate, programTemplate, chain);
  const stored = validateManualPolicyBindingSnapshot(
    parseJson(
      row.binding_snapshot,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "The stored governed binding snapshot is invalid.",
    ),
  );
  await Promise.all([
    exactSourceBindingStillApproved(
      database,
      row.organisation_id,
      row.program_source_binding_id,
      "program",
      row.program_id,
      String(chain.program_source_sha256),
    ),
    exactSourceBindingStillApproved(
      database,
      row.organisation_id,
      row.activity_source_binding_id,
      "activity",
      row.activity_version_id,
      String(chain.activity_source_sha256),
    ),
    exactSourceBindingStillApproved(
      database,
      row.organisation_id,
      row.evidence_policy_source_binding_id,
      "evidence_policy",
      row.evidence_policy_version_id,
      String(chain.evidence_policy_source_sha256),
    ),
  ]);
  const requirements = await governedRequirements(
    database,
    row.organisation_id,
    row.evidence_policy_version_id,
  );
  const rebuilt = buildSnapshot(
    row.organisation_id,
    activityTemplate,
    chain,
    stored.sourceApprovals,
    requirements,
  );
  const rebuiltJson = canonicalManualPolicyJson(rebuilt);
  const rebuiltSha256 = await manualPolicySha256(rebuiltJson);
  if (
    rebuiltSha256 !== row.binding_snapshot_sha256
    || rebuiltJson !== row.binding_snapshot
  ) {
    fail(
      "MANUAL_POLICY_BINDING_STALE",
      409,
      "The governed source chain changed after this binding draft was sealed. Withdraw or replace the draft.",
    );
  }
  return rebuilt;
}

async function inventoryStatus(
  database: D1Database,
  organisationId: string,
) {
  const row = await database.prepare(`SELECT
      (SELECT count(*) FROM compliance_programs
        WHERE organisation_id = ? AND publish_state = 'published')
        published_programs,
      (SELECT count(*)
        FROM compliance_activity_versions activity
        JOIN compliance_programs program ON program.id = activity.program_id
        WHERE program.organisation_id = ?
          AND program.publish_state = 'published'
          AND activity.publish_state = 'published')
        published_activities,
      (SELECT count(*)
        FROM compliance_evidence_policy_versions policy
        JOIN compliance_activity_versions activity
          ON activity.id = policy.activity_version_id
        JOIN compliance_programs program ON program.id = activity.program_id
        WHERE policy.organisation_id = ?
          AND program.organisation_id = ?
          AND program.publish_state = 'published'
          AND activity.publish_state = 'published'
          AND policy.publish_state = 'published'
          AND policy.requirements_complete = 1
          AND EXISTS (
            SELECT 1 FROM compliance_evidence_requirements requirement
            WHERE requirement.organisation_id = policy.organisation_id
              AND requirement.policy_version_id = policy.id
          ))
        published_complete_evidence_policies`)
    .bind(
      organisationId,
      organisationId,
      organisationId,
      organisationId,
    )
    .first<Record<string, unknown>>();
  return {
    publishedPrograms: Number(row?.published_programs || 0),
    publishedActivities: Number(row?.published_activities || 0),
    publishedCompleteEvidencePolicies:
      Number(row?.published_complete_evidence_policies || 0),
  };
}

export async function loadManualPolicyMergeStatus(
  database: D1Database,
  member: ManualPolicyMember,
  filters: { activityTemplateId?: unknown } = {},
) {
  const activityTemplateId = typeof filters.activityTemplateId === "string"
    ? filters.activityTemplateId.trim()
    : "";
  const statements: unknown[] = [];
  const where = ["organisation_id = ?"];
  statements.push(member.organisationId);
  if (activityTemplateId) {
    where.push("activity_template_id = ?");
    statements.push(activityTemplateId);
  }
  const lockStatements: unknown[] = [member.organisationId];
  const lockWhere = ["organisation_id = ?", "superseded_by_id = ''"];
  if (activityTemplateId) {
    lockWhere.push("activity_template_id = ?");
    lockStatements.push(activityTemplateId);
  }
  const [inventory, rows, compositionLocks] = await Promise.all([
    inventoryStatus(database, member.organisationId),
    database.prepare(`${BINDING_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY activity_template_id, version DESC`)
      .bind(...statements)
      .all<BindingRow>(),
    database.prepare(`${COMPOSITION_LOCK_SELECT}
      WHERE ${lockWhere.join(" AND ")}
      ORDER BY reference_type, reference_id`)
      .bind(...lockStatements)
      .all<CompositionLockRow>(),
  ]);
  let linkedReadyBindings = 0;
  const approvedRows = rows.results.filter(
    ({ lifecycle_state }) => lifecycle_state === "approved",
  );
  for (const row of approvedRows) {
    const activityTemplate = GOVERNMENT_ACTIVITY_TEMPLATES.find(
      ({ templateId }) => templateId === row.activity_template_id,
    );
    if (!activityTemplate) continue;
    try {
      await rebuildStoredSnapshot(database, row, activityTemplate);
      linkedReadyBindings += 1;
    } catch (error) {
      if (!(error instanceof CreditexManualPolicyMergeError)) throw error;
    }
  }
  const linkedInventory = {
    ...inventory,
    linkedApprovedBindings: approvedRows.length,
    linkedReadyBindings,
  };
  const emptyInventory = (
    inventory.publishedPrograms === 0
    || inventory.publishedActivities === 0
    || inventory.publishedCompleteEvidencePolicies === 0
  );
  return {
    inventory: linkedInventory,
    readiness: emptyInventory
      ? {
        status: "blocked" as const,
        code: "GOVERNED_POLICY_INVENTORY_EMPTY",
        message:
          "No published program, activity and complete evidence-policy inventory is available. Manual forms cannot be approved from an empty governed inventory.",
      }
      : linkedReadyBindings === 0
      ? {
        status: "blocked" as const,
        code: "GOVERNED_POLICY_BINDING_NOT_READY",
        message:
          "Published records exist, but no approved binding currently resolves to one exact governed chain with current independent retained-source approvals.",
      }
      : {
        status: "ready" as const,
        code: "GOVERNED_POLICY_INVENTORY_READY",
        message:
          "At least one approved binding currently resolves to an exact governed chain with current independent retained-source approvals.",
    },
    bindings: rows.results.map(publicBinding),
    compositionLocks: compositionLocks.results.map(publicCompositionLock),
  };
}

export async function createManualPolicyBindingDraft(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireGovernanceAdmin(member);
  const activityTemplateId = cleanText(
    input.activityTemplateId,
    180,
    "MANUAL_POLICY_ACTIVITY_TEMPLATE_REQUIRED",
    "Choose a controlled government activity template.",
  );
  const activityVersionId = cleanText(
    input.activityVersionId,
    180,
    "MANUAL_POLICY_ACTIVITY_REQUIRED",
    "Choose an exact published activity version.",
  );
  const evidencePolicyVersionId = cleanText(
    input.evidencePolicyVersionId,
    180,
    "MANUAL_POLICY_EVIDENCE_POLICY_REQUIRED",
    "Choose an exact published complete evidence policy.",
  );
  const activityTemplate = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    ({ templateId }) => templateId === activityTemplateId,
  );
  if (!activityTemplate) {
    fail(
      "MANUAL_POLICY_ACTIVITY_TEMPLATE_NOT_FOUND",
      404,
      "The controlled government activity template was not found.",
    );
  }
  const programTemplate = GOVERNMENT_PROGRAM_TEMPLATES.find(
    ({ programCode }) => programCode === activityTemplate.programCode,
  );
  if (!programTemplate) {
    fail(
      "MANUAL_POLICY_PROGRAM_TEMPLATE_NOT_FOUND",
      409,
      "The controlled government program template is not available.",
    );
  }
  const chain = await governedChain(
    database,
    member.organisationId,
    activityVersionId,
    evidencePolicyVersionId,
  );
  exactStaticMatch(activityTemplate, programTemplate, chain);
  const requirements = await governedRequirements(
    database,
    member.organisationId,
    evidencePolicyVersionId,
  );
  const sourceApprovals = {
    programBindingId:
      await requireCurrentApprovedOfficialSourceBinding(
        database,
        member.organisationId,
        "program",
        String(chain.program_id),
        String(chain.program_source_sha256),
      ),
    activityBindingId:
      await requireCurrentApprovedOfficialSourceBinding(
        database,
        member.organisationId,
        "activity",
        activityVersionId,
        String(chain.activity_source_sha256),
      ),
    evidencePolicyBindingId:
      await requireCurrentApprovedOfficialSourceBinding(
        database,
        member.organisationId,
        "evidence_policy",
        evidencePolicyVersionId,
        String(chain.evidence_policy_source_sha256),
      ),
  };
  const snapshot = buildSnapshot(
    member.organisationId,
    activityTemplate,
    chain,
    sourceApprovals,
    requirements,
  );
  const bindingSnapshot = canonicalManualPolicyJson(snapshot);
  const bindingSnapshotSha256 = await manualPolicySha256(bindingSnapshot);
  const prior = await database.prepare(`SELECT coalesce(max(version), 0) value
    FROM compliance_manual_policy_bindings
    WHERE organisation_id = ? AND activity_template_id = ?`)
    .bind(member.organisationId, activityTemplateId)
    .first<{ value: number }>();
  const version = Number(prior?.value || 0) + 1;
  const now = options.now || new Date().toISOString();
  const id = (options.idFactory || (() => crypto.randomUUID()))();
  const auditId = (options.idFactory || (() => crypto.randomUUID()))();
  const results = await database.batch([
    database.prepare(`INSERT INTO compliance_manual_policy_bindings (
        id, organisation_id, activity_template_id, version, program_id,
        activity_version_id, evidence_policy_version_id,
        program_source_binding_id, activity_source_binding_id,
        evidence_policy_source_binding_id, binding_snapshot,
        binding_snapshot_sha256, lifecycle_state, requested_by_uid,
        requested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .bind(
        id,
        member.organisationId,
        activityTemplateId,
        version,
        String(chain.program_id),
        activityVersionId,
        evidencePolicyVersionId,
        sourceApprovals.programBindingId,
        sourceApprovals.activityBindingId,
        sourceApprovals.evidencePolicyBindingId,
        bindingSnapshot,
        bindingSnapshotSha256,
        member.uid,
        now,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type, target_type,
        target_id, summary, metadata, created_at)
      VALUES (?, ?, 'compliance', ?, 'manual_policy_binding_draft_created',
        'manual_policy_binding', ?, ?, ?, ?)`)
      .bind(
        auditId,
        member.organisationId,
        member.uid,
        id,
        `Sealed manual-policy binding ${activityTemplateId} v${version}.`,
        canonicalManualPolicyJson({
          activityTemplateId,
          activityVersionId,
          evidencePolicyVersionId,
          bindingSnapshotSha256,
        }),
        now,
      ),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    fail(
      "MANUAL_POLICY_BINDING_CONFLICT",
      409,
      "The governed binding draft was not created.",
    );
  }
  return publicBinding(await loadBindingRow(database, member.organisationId, id));
}

export async function approveManualPolicyBinding(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireGovernanceAdmin(member);
  const bindingId = cleanText(
    input.bindingId,
    180,
    "MANUAL_POLICY_BINDING_REQUIRED",
    "Choose a governed binding draft.",
  );
  const expectedSha256 = cleanText(
    input.expectedSnapshotSha256,
    64,
    "MANUAL_POLICY_BINDING_HASH_REQUIRED",
    "Confirm the exact binding snapshot SHA-256.",
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    fail(
      "MANUAL_POLICY_BINDING_HASH_REQUIRED",
      400,
      "Confirm the exact binding snapshot SHA-256.",
    );
  }
  const approvalNote = cleanNote(
    input.approvalNote,
    "MANUAL_POLICY_APPROVAL_NOTE_REQUIRED",
    "Approval note",
  );
  const row = await loadBindingRow(
    database,
    member.organisationId,
    bindingId,
  );
  if (row.lifecycle_state !== "draft") {
    fail(
      "MANUAL_POLICY_BINDING_STATE_CONFLICT",
      409,
      "Only a draft governed binding can be approved.",
    );
  }
  if (row.requested_by_uid === member.uid) {
    fail(
      "MANUAL_POLICY_INDEPENDENT_APPROVER_REQUIRED",
      409,
      "The binding requester cannot approve their own governed snapshot.",
    );
  }
  if (row.binding_snapshot_sha256 !== expectedSha256) {
    fail(
      "MANUAL_POLICY_BINDING_HASH_MISMATCH",
      409,
      "The governed binding changed before approval. Review the exact diff and snapshot again.",
    );
  }
  const activityTemplate = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    ({ templateId }) => templateId === row.activity_template_id,
  );
  if (!activityTemplate) {
    fail(
      "MANUAL_POLICY_ACTIVITY_TEMPLATE_NOT_FOUND",
      409,
      "The controlled activity template is no longer available.",
    );
  }
  await rebuildStoredSnapshot(database, row, activityTemplate);
  const now = options.now || new Date().toISOString();
  const auditId = (options.idFactory || (() => crypto.randomUUID()))();
  const results = await database.batch([
    database.prepare(`UPDATE compliance_manual_policy_bindings
      SET lifecycle_state = 'approved', approved_by_uid = ?,
        approved_at = ?, approval_note = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND lifecycle_state = 'draft'
        AND requested_by_uid <> ? AND binding_snapshot_sha256 = ?`)
      .bind(
        member.uid,
        now,
        approvalNote,
        now,
        bindingId,
        member.organisationId,
        member.uid,
        expectedSha256,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type, target_type,
        target_id, summary, metadata, created_at)
      SELECT ?, ?, 'compliance', ?, 'manual_policy_binding_approved',
        'manual_policy_binding', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_manual_policy_bindings binding
        WHERE binding.id = ?
          AND binding.organisation_id = ?
          AND binding.lifecycle_state = 'approved'
          AND binding.approved_by_uid = ?
          AND binding.approved_at = ?
          AND binding.binding_snapshot_sha256 = ?
      )`)
      .bind(
        auditId,
        member.organisationId,
        member.uid,
        bindingId,
        "Independently approved an immutable manual-policy binding.",
        canonicalManualPolicyJson({
          bindingSnapshotSha256: expectedSha256,
          approvalNote,
        }),
        now,
        bindingId,
        member.organisationId,
        member.uid,
        now,
        expectedSha256,
      ),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    fail(
      "MANUAL_POLICY_BINDING_STATE_CONFLICT",
      409,
      "The governed binding changed before approval completed.",
    );
  }
  return publicBinding(
    await loadBindingRow(database, member.organisationId, bindingId),
  );
}

export async function withdrawManualPolicyBinding(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireGovernanceAdmin(member);
  const bindingId = cleanText(
    input.bindingId,
    180,
    "MANUAL_POLICY_BINDING_REQUIRED",
    "Choose an approved governed binding.",
  );
  const expectedSha256 = cleanText(
    input.expectedSnapshotSha256,
    64,
    "MANUAL_POLICY_BINDING_HASH_REQUIRED",
    "Confirm the exact binding snapshot SHA-256.",
  ).toLowerCase();
  const withdrawalNote = cleanNote(
    input.withdrawalNote,
    "MANUAL_POLICY_WITHDRAWAL_NOTE_REQUIRED",
    "Withdrawal note",
  );
  const row = await loadBindingRow(
    database,
    member.organisationId,
    bindingId,
  );
  if (
    row.lifecycle_state !== "approved"
    || row.binding_snapshot_sha256 !== expectedSha256
  ) {
    fail(
      "MANUAL_POLICY_BINDING_STATE_CONFLICT",
      409,
      "Only the exact approved governed binding can be withdrawn.",
    );
  }
  const now = options.now || new Date().toISOString();
  const auditId = (options.idFactory || (() => crypto.randomUUID()))();
  const results = await database.batch([
    database.prepare(`UPDATE compliance_manual_policy_bindings
      SET lifecycle_state = 'withdrawn', withdrawn_by_uid = ?,
        withdrawn_at = ?, withdrawal_note = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND lifecycle_state = 'approved'
        AND binding_snapshot_sha256 = ?`)
      .bind(
        member.uid,
        now,
        withdrawalNote,
        now,
        bindingId,
        member.organisationId,
        expectedSha256,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type, target_type,
        target_id, summary, metadata, created_at)
      SELECT ?, ?, 'compliance', ?, 'manual_policy_binding_withdrawn',
        'manual_policy_binding', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_manual_policy_bindings binding
        WHERE binding.id = ?
          AND binding.organisation_id = ?
          AND binding.lifecycle_state = 'withdrawn'
          AND binding.withdrawn_by_uid = ?
          AND binding.withdrawn_at = ?
          AND binding.binding_snapshot_sha256 = ?
      )`)
      .bind(
        auditId,
        member.organisationId,
        member.uid,
        bindingId,
        "Withdrew a governed manual-policy binding from new compositions.",
        canonicalManualPolicyJson({
          bindingSnapshotSha256: expectedSha256,
          withdrawalNote,
        }),
        now,
        bindingId,
        member.organisationId,
        member.uid,
        now,
        expectedSha256,
      ),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    fail(
      "MANUAL_POLICY_BINDING_STATE_CONFLICT",
      409,
      "The governed binding changed before withdrawal completed.",
    );
  }
  return publicBinding(
    await loadBindingRow(database, member.organisationId, bindingId),
  );
}

async function verifiedCurrentCompositionLock(
  row: CompositionLockRow | null,
) {
  if (!row) return null;
  const lock = publicCompositionLock(row);
  const composition = await validatePinnedManualEvidenceFormV2(
    lock.composition,
  );
  const compositionJson = canonicalManualPolicyJson(
    composition as unknown as ManualPolicyJson,
  );
  const diffJson = canonicalManualPolicyJson(
    lock.diff as unknown as ManualPolicyJson,
  );
  if (
    await manualPolicySha256(compositionJson) !== lock.compositionSha256
    || await manualPolicySha256(diffJson) !== lock.diffSha256
  ) {
    fail(
      "MANUAL_POLICY_COMPOSITION_LOCK_CORRUPT",
      409,
      "The persisted composition lock does not match its immutable hashes.",
    );
  }
  return {
    ...lock,
    composition,
  };
}

async function manualPolicyCompositionContext(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
) {
  if (Object.prototype.hasOwnProperty.call(input, "previousComposition")) {
    fail(
      "MANUAL_POLICY_CALLER_PREVIOUS_COMPOSITION_REJECTED",
      400,
      "Previous composition JSON is resolved from persisted lock state and cannot be supplied by the caller.",
    );
  }
  const bindingId = cleanText(
    input.bindingId,
    180,
    "MANUAL_POLICY_BINDING_REQUIRED",
    "Choose an independently approved governed binding.",
  );
  const row = await loadBindingRow(
    database,
    member.organisationId,
    bindingId,
  );
  const activityTemplate = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    ({ templateId }) => templateId === row.activity_template_id,
  );
  if (!activityTemplate) {
    fail(
      "MANUAL_POLICY_ACTIVITY_TEMPLATE_NOT_FOUND",
      409,
      "The controlled activity template is no longer available.",
    );
  }
  await rebuildStoredSnapshot(database, row, activityTemplate);
  const activityReference = await authoritativeActivityReference(
    database,
    member.organisationId,
    validateManualPolicyBindingSnapshot(
      parseJson(
        row.binding_snapshot,
        "MANUAL_POLICY_SNAPSHOT_INVALID",
        "The stored governed binding snapshot is invalid.",
      ),
    ),
    input,
  );
  const current = await verifiedCurrentCompositionLock(
    await currentCompositionLockRow(
      database,
      member.organisationId,
      activityReference.referenceType,
      activityReference.referenceId,
    ),
  );
  const preview = await buildManualEvidenceFormV2CompositionPreview(
    approvedBinding(row),
    activityReference,
    input.instructionOverlays || [],
    input.operationalFields || [],
    current?.composition ?? null,
  );
  return {
    row,
    activityReference,
    current,
    preview,
  };
}

export async function previewManualPolicyComposition(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
) {
  const context = await manualPolicyCompositionContext(
    database,
    member,
    input,
  );
  const lockAllowed =
    member.role === "admin" && member.governanceIdentityVerified;
  return {
    lockAllowed,
    lockBlockedCode: lockAllowed
      ? ""
      : "MANUAL_POLICY_GOVERNANCE_ADMIN_REQUIRED",
    expectedRevision: context.current?.revision || 0,
    expectedPreviousCompositionSha256:
      context.current?.compositionSha256 || "",
    previousLock: context.current
      ? {
        id: context.current.id,
        revision: context.current.revision,
        bindingId: context.current.bindingId,
        compositionSha256: context.current.compositionSha256,
        lockedByUid: context.current.lockedByUid,
        lockedAt: context.current.lockedAt,
      }
      : null,
    activityReference: context.activityReference,
    ...context.preview,
  };
}

export async function lockManualPolicyComposition(
  database: D1Database,
  member: ManualPolicyMember,
  input: Record<string, unknown>,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireGovernanceAdmin(member);
  const expectedRevision = exactRevision(
    input.expectedRevision,
    0,
    "MANUAL_POLICY_COMPOSITION_REVISION_REQUIRED",
    "Confirm the current persisted composition revision.",
  );
  const expectedPreviousCompositionSha256 = optionalExactHash(
    input.expectedPreviousCompositionSha256,
    "MANUAL_POLICY_COMPOSITION_PREVIOUS_HASH_REQUIRED",
    "Confirm the current persisted composition SHA-256.",
  );
  const expectedCompositionSha256 = exactHash(
    input.expectedCompositionSha256,
    "MANUAL_POLICY_COMPOSITION_HASH_REQUIRED",
    "Confirm the reviewed composition SHA-256.",
  );
  const expectedDiffSha256 = exactHash(
    input.expectedDiffSha256,
    "MANUAL_POLICY_COMPOSITION_DIFF_HASH_REQUIRED",
    "Confirm the reviewed composition diff SHA-256.",
  );
  const context = await manualPolicyCompositionContext(
    database,
    member,
    input,
  );
  const currentRevision = context.current?.revision || 0;
  const currentCompositionSha256 =
    context.current?.compositionSha256 || "";
  if (
    currentRevision !== expectedRevision
    || currentCompositionSha256 !== expectedPreviousCompositionSha256
  ) {
    fail(
      "MANUAL_POLICY_COMPOSITION_REVISION_CONFLICT",
      409,
      "The persisted composition changed before lock. Refresh and review the authoritative server diff.",
    );
  }
  if (
    context.preview.compositionSha256 !== expectedCompositionSha256
    || context.preview.diffSha256 !== expectedDiffSha256
  ) {
    fail(
      "MANUAL_POLICY_COMPOSITION_REVIEW_STALE",
      409,
      "The reviewed composition or exact diff changed before lock.",
    );
  }
  const now = options.now || new Date().toISOString();
  const makeId = options.idFactory || (() => crypto.randomUUID());
  const id = makeId();
  const auditId = makeId();
  const revision = expectedRevision + 1;
  const compositionSnapshot = canonicalManualPolicyJson(
    context.preview.composition as unknown as ManualPolicyJson,
  );
  const diffSnapshot = canonicalManualPolicyJson(
    context.preview.diff as unknown as ManualPolicyJson,
  );
  const insert = database.prepare(`INSERT INTO
      compliance_manual_policy_composition_locks (
        id, organisation_id, binding_id, binding_version,
        binding_snapshot_sha256, activity_template_id, activity_version_id,
        reference_type, reference_id, reference_activity_date,
        reference_updated_at, reference_snapshot_sha256, revision,
        composition_snapshot,
        composition_sha256, diff_snapshot, diff_sha256, locked_by_uid,
        locked_at, superseded_by_id, superseded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`)
    .bind(
      id,
      member.organisationId,
      context.row.id,
      Number(context.row.version),
      context.row.binding_snapshot_sha256,
      context.row.activity_template_id,
      context.row.activity_version_id,
      context.activityReference.referenceType,
      context.activityReference.referenceId,
      context.activityReference.activityDate,
      context.activityReference.referenceUpdatedAt,
      context.activityReference.referenceSnapshotSha256,
      revision,
      compositionSnapshot,
      context.preview.compositionSha256,
      diffSnapshot,
      context.preview.diffSha256,
      member.uid,
      now,
    );
  const audit = database.prepare(`INSERT INTO compliance_audit_events (
      id, organisation_id, actor_type, actor_uid, event_type, target_type,
      target_id, summary, metadata, created_at
    ) VALUES (?, ?, 'compliance', ?, 'manual_policy_composition_locked',
      'manual_policy_composition_lock', ?,
      'Locked an immutable dated manual evidence composition.', ?, ?)`)
    .bind(
      auditId,
      member.organisationId,
      member.uid,
      id,
      canonicalManualPolicyJson({
        bindingId: context.row.id,
        referenceType: context.activityReference.referenceType,
        referenceId: context.activityReference.referenceId,
        referenceActivityDate: context.activityReference.activityDate,
        referenceUpdatedAt: context.activityReference.referenceUpdatedAt,
        revision,
        compositionSha256: context.preview.compositionSha256,
        diffSha256: context.preview.diffSha256,
        supersedesId: context.current?.id || "",
      }),
      now,
    );
  const statements = context.current
    ? [
      database.prepare(`UPDATE compliance_manual_policy_composition_locks
        SET superseded_by_id = ?, superseded_at = ?
        WHERE id = ? AND organisation_id = ?
          AND revision = ? AND superseded_by_id = ''`)
        .bind(
          id,
          now,
          context.current.id,
          member.organisationId,
          expectedRevision,
        ),
      insert,
      audit,
    ]
    : [insert, audit];
  const results = await database.batch(statements);
  if (
    context.current
    && Number(results[0]?.meta?.changes || 0) !== 1
  ) {
    fail(
      "MANUAL_POLICY_COMPOSITION_REVISION_CONFLICT",
      409,
      "The persisted composition changed before lock. Refresh and review the authoritative server diff.",
    );
  }
  const locked = await database.prepare(`${COMPOSITION_LOCK_SELECT}
    WHERE id = ? AND organisation_id = ?
    LIMIT 1`)
    .bind(id, member.organisationId)
    .first<CompositionLockRow>();
  if (!locked) {
    fail(
      "MANUAL_POLICY_COMPOSITION_LOCK_FAILED",
      500,
      "The immutable composition lock was not retained.",
    );
  }
  return publicCompositionLock(locked);
}
