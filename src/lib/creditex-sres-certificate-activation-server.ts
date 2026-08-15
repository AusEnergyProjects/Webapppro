import type {
  CreditexWorkPackGovernanceActor,
} from "./creditex-activity-work-pack-server";
import { creditexCanonicalSha256 } from "./creditex-interchange-preflight";
import {
  ensureCreditexWorkPackSchemaGuards,
} from "./creditex-work-pack-schema-guards";

export const CREDITEX_SRES_ACTIVATION_EVIDENCE_CONTRACT =
  "creditex-sres-certificate-activation-evidence/v1" as const;

export const CREDITEX_SRES_ACTIVATION_EVIDENCE_KINDS = [
  "rec_registry_submission_contract",
  "declaration_snapshot",
  "component_recall_status",
  "calculator_vector_suite",
  "registered_agent_assignment",
  "component_eligibility",
  "installer_accreditation",
  "designer_accreditation",
] as const;

export type CreditexSresActivationEvidenceKind =
  typeof CREDITEX_SRES_ACTIVATION_EVIDENCE_KINDS[number];

export type CreditexSresActivationRecordProjection = Readonly<{
  recordId: string;
  evidenceKind: CreditexSresActivationEvidenceKind;
  subjectKey: string;
  resultCode: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  sourceRecordKey: string;
  responseSha256: string;
  effectiveFrom: string;
  effectiveTo: string;
  observedAt: string;
  validUntil: string;
  reviewed: boolean;
  reviewId: string;
  reviewedByUid: string;
  reviewedAt: string;
  supersedesRecordId: string;
}>;

export type CreditexSresActivationSnapshot = Readonly<{
  contract: typeof CREDITEX_SRES_ACTIVATION_EVIDENCE_CONTRACT;
  snapshotId: string;
  programCode: "SRES";
  activityTemplateId: string;
  caseId: string;
  activityDate: string;
  records: readonly CreditexSresActivationRecordProjection[];
}>;

export type CreditexSresActivationGate = Readonly<{
  evidenceKind: CreditexSresActivationEvidenceKind;
  title: string;
  description: string;
  expectedResult: string;
  status: "missing" | "awaiting_review" | "approved" | "rejected";
  record: CreditexSresActivationRecordProjection | null;
}>;

export class CreditexSresActivationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexSresActivationError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexSresActivationError(code, status, message);
}

function requiredText(value: unknown, maximum: number, label: string) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum) {
    return fail(
      "SRES_ACTIVATION_INPUT_INVALID",
      400,
      `${label} is required.`,
    );
  }
  return result;
}

function optionalText(value: unknown, maximum: number, label: string) {
  const result = String(value || "").trim();
  if (result.length > maximum) {
    return fail(
      "SRES_ACTIVATION_INPUT_INVALID",
      400,
      `${label} is too long.`,
    );
  }
  return result;
}

function exactSha256(value: unknown, label: string) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
    return fail(
      "SRES_ACTIVATION_HASH_INVALID",
      409,
      `${label} must retain its exact SHA-256 identity.`,
    );
  }
  return result;
}

function exactBareSha256(value: unknown, label: string) {
  return exactSha256(
    String(value || "").replace(/^sha256:/, "sha256:"),
    label,
  ).slice(7);
}

function exactSourceSha256(
  value: unknown,
  source: Readonly<{ sha256: string }>,
  label: string,
) {
  const result = exactSha256(value, label);
  if (result !== `sha256:${source.sha256}`) {
    return fail(
      "SRES_ACTIVATION_SOURCE_HASH_MISMATCH",
      409,
      `${label} must be the exact independently reviewed source artifact.`,
    );
  }
  return result;
}

function exactDate(value: unknown, label: string) {
  const result = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)
    || new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10)
      !== result) {
    return fail(
      "SRES_ACTIVATION_DATE_INVALID",
      400,
      `${label} must be an exact ISO date.`,
    );
  }
  return result;
}

function exactTimestamp(value: unknown, label: string) {
  const result = String(value || "").trim();
  const parsed = Date.parse(result);
  if (Number.isNaN(parsed)) {
    return fail(
      "SRES_ACTIVATION_TIME_INVALID",
      400,
      `${label} must be an exact timestamp.`,
    );
  }
  return new Date(parsed).toISOString();
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type SresActivationOptions = Readonly<{
  now?: () => string;
  id?: (scope: string) => string;
}>;

function trustedNow(options?: SresActivationOptions) {
  return exactTimestamp(options?.now?.() || new Date().toISOString(), "Server time");
}

function identifier(scope: string, options?: SresActivationOptions) {
  return options?.id?.(scope) || `${scope}:${crypto.randomUUID()}`;
}

async function requireCapability(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  capability: "canAuthor" | "canReview",
) {
  const identity = await activationIdentity(database, actor);
  if (!identity.access[capability]) {
    return fail(
      "SRES_ACTIVATION_PERMISSION_DENIED",
      403,
      "This account is not authorised for that governed SRES action.",
    );
  }
  return identity;
}

async function activationIdentity(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  await ensureCreditexWorkPackSchemaGuards(database);
  const actorUid = requiredText(actor.actorUid, 240, "Governance actor");
  const organisationId = requiredText(
    actor.organisationId,
    180,
    "Governance organisation",
  );
  if (actor.actorKind === "compliance") {
    const row = await database.prepare(`SELECT member.role,
        member.display_name, member.governance_identity_verified,
        member.governance_identity_verified_by_uid
      FROM compliance_users member
      JOIN compliance_organisations organisation
        ON organisation.id = member.organisation_id
        AND organisation.status = 'active'
      WHERE member.organisation_id = ? AND member.firebase_uid = ?
        AND member.status = 'active'`)
      .bind(organisationId, actorUid)
      .first<{
        role: string;
        display_name: string;
        governance_identity_verified: number;
        governance_identity_verified_by_uid: string;
      }>();
    if (!row) {
      return fail(
        "SRES_ACTIVATION_ACCESS_DENIED",
        403,
        "This account cannot access governed SRES activation evidence.",
      );
    }
    const named = Number(row.governance_identity_verified) === 1
      && Boolean(row.display_name.trim());
    const independentlyVerified = named
      && Boolean(row.governance_identity_verified_by_uid.trim())
      && row.governance_identity_verified_by_uid !== actorUid;
    return Object.freeze({
      actorUid,
      role: row.role,
      access: Object.freeze({
        canRead: true,
        canAuthor: named
          && ["admin", "case_manager", "reviewer"].includes(row.role),
        canReview: independentlyVerified
          && ["admin", "reviewer"].includes(row.role),
      }),
    });
  }
  const row = await database.prepare(`SELECT administrator.role,
      administrator.display_name
    FROM admin_users administrator
    JOIN compliance_organisations organisation
      ON organisation.id = ?
      AND organisation.organisation_code = 'CREDITEX-AU'
      AND organisation.status = 'active'
    WHERE administrator.firebase_uid = ?
      AND administrator.status = 'active'`)
    .bind(organisationId, actorUid)
    .first<{ role: string; display_name: string }>();
  if (!row) {
    return fail(
      "SRES_ACTIVATION_ACCESS_DENIED",
      403,
      "This admin account cannot access governed SRES activation evidence.",
    );
  }
  return Object.freeze({
    actorUid,
    role: row.role,
    access: Object.freeze({
      canRead: true,
      canAuthor: ["owner", "admin"].includes(row.role),
      canReview: ["owner", "admin", "reviewer"].includes(row.role),
    }),
  });
}

type SresScopeRecord = {
  activity_template_id: string;
  activity_date: string;
  case_id: string;
  activity_version_id: string;
};

async function loadSresScope(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{ activityTemplateId: unknown; caseId: unknown }>,
) {
  const activityTemplateId = requiredText(
    input.activityTemplateId,
    180,
    "Activity",
  );
  const caseId = requiredText(input.caseId, 180, "Compliance case");
  const row = await database.prepare(`SELECT
      pack.activity_template_id, instance.activity_date,
      compliance_case.id case_id, compliance_case.activity_version_id
    FROM compliance_cases compliance_case
    JOIN compliance_activity_versions activity
      ON activity.id = compliance_case.activity_version_id
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = compliance_case.organisation_id
      AND program.program_code = 'SRES'
    JOIN compliance_activity_work_pack_instances instance
      ON instance.compliance_case_id = compliance_case.id
      AND instance.organisation_id = compliance_case.organisation_id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
      AND pack.organisation_id = instance.organisation_id
      AND pack.activity_version_id = compliance_case.activity_version_id
      AND pack.activity_template_id = ?
    WHERE compliance_case.id = ?
      AND compliance_case.organisation_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    ORDER BY instance.revision DESC LIMIT 1`)
    .bind(activityTemplateId, caseId, actor.organisationId)
    .first<SresScopeRecord>();
  if (!row) {
    return fail(
      "SRES_ACTIVATION_SCOPE_NOT_FOUND",
      404,
      "The selected SRES job is not available to this organisation.",
    );
  }
  return Object.freeze({
    activityTemplateId: row.activity_template_id,
    activityDate: exactDate(row.activity_date, "Activity date"),
    caseId: row.case_id,
    activityVersionId: row.activity_version_id,
  });
}

type ApprovedSourceRecord = {
  id: string;
  sha256: string;
  source_title: string;
  source_url: string;
  source_version: string;
  captured_at: string;
  review_id: string;
  reviewed_at: string;
};

async function loadApprovedSource(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  sourceArtifactIdValue: unknown,
) {
  const sourceArtifactId = requiredText(
    sourceArtifactIdValue,
    240,
    "Approved official source",
  );
  const row = await database.prepare(`SELECT artifact.id, artifact.sha256,
      artifact.source_title, artifact.source_url, artifact.source_version,
      artifact.captured_at, decision.id review_id,
      decision.reviewed_at reviewed_at
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_review_decisions decision
      ON decision.organisation_id = artifact.organisation_id
      AND decision.subject_type = 'artifact'
      AND decision.subject_id = artifact.id
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE artifact.id = ? AND artifact.organisation_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = decision.id
      )
    ORDER BY decision.reviewed_at DESC LIMIT 1`)
    .bind(sourceArtifactId, actor.organisationId)
    .first<ApprovedSourceRecord>();
  if (!row) {
    return fail(
      "SRES_ACTIVATION_SOURCE_NOT_APPROVED",
      409,
      "Choose a current official source with an independent approval.",
    );
  }
  return Object.freeze({
    id: row.id,
    sha256: exactBareSha256(`sha256:${row.sha256}`, "Official source"),
    title: row.source_title,
    url: row.source_url,
    version: row.source_version,
    capturedAt: exactTimestamp(row.captured_at, "Source capture time"),
    reviewId: row.review_id,
    reviewedAt: exactTimestamp(row.reviewed_at, "Source review time"),
  });
}

type EquipmentRecord = {
  id: string;
  product_registry: string;
  product_reference: string;
  quantity: number;
  status: string;
  evidence_snapshot: string;
  recorded_at: string;
};

async function exactInstalledEquipment(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  caseId: string,
) {
  const rows = await database.prepare(`SELECT id, product_registry,
      product_reference, quantity, status, evidence_snapshot, recorded_at
    FROM compliance_equipment_records
    WHERE organisation_id = ? AND case_id = ? AND record_type = 'installed'
      AND status = 'installed'
    ORDER BY id`)
    .bind(actor.organisationId, caseId)
    .all<EquipmentRecord>();
  const records = rows.results.map((row) => {
    let evidence: Record<string, unknown>;
    try {
      evidence = object(JSON.parse(row.evidence_snapshot));
    } catch {
      return fail(
        "SRES_ACTIVATION_COMPONENT_EVIDENCE_INVALID",
        409,
        "An installed component has invalid retained registry evidence.",
      );
    }
    if (
      evidence.contract !== "creditex-work-pack-official-product-selection/v2"
      || !String(row.product_registry || "").trim()
      || !String(row.product_reference || "").trim()
      || !String(evidence.sourceSha256 || "").trim()
    ) {
      return fail(
        "SRES_ACTIVATION_COMPONENT_EVIDENCE_INVALID",
        409,
        "Every installed component must retain its exact official registry selection.",
      );
    }
    return Object.freeze({
      equipmentRecordId: row.id,
      registryCode: row.product_registry,
      productReference: row.product_reference,
      quantity: Number(row.quantity),
      evidenceSha256: creditexCanonicalSha256(evidence),
      recordedAt: exactTimestamp(row.recorded_at, "Equipment record time"),
    });
  });
  if (!records.length) {
    return fail(
      "SRES_ACTIVATION_COMPONENT_EVIDENCE_REQUIRED",
      409,
      "No exact installed SRES component records are available for this job.",
    );
  }
  return Object.freeze(records);
}

type AbilityRecord = {
  id: string;
  participant_id: string;
  participant_type: string;
  legal_name: string;
  external_reference: string;
  ability_code: string;
  ability_role: string;
  status: string;
  effective_from: string;
  effective_to: string;
  evidence_snapshot: string;
  approved_by_uid: string;
  approved_at: string;
};

async function exactActiveAbility(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    abilityId: unknown;
    activityVersionId: string;
    activityDate: string;
    acceptedCodes: readonly string[];
    acceptedParticipantTypes: readonly string[];
  }>,
) {
  const abilityId = requiredText(input.abilityId, 240, "Verified ability");
  const row = await database.prepare(`SELECT ability.id,
      ability.participant_id, participant.participant_type,
      participant.legal_name, participant.external_reference,
      ability.ability_code, ability.ability_role, ability.status,
      ability.effective_from, ability.effective_to,
      ability.evidence_snapshot, ability.approved_by_uid,
      ability.approved_at
    FROM compliance_participant_abilities ability
    JOIN compliance_participants participant
      ON participant.id = ability.participant_id
      AND participant.organisation_id = ability.organisation_id
      AND participant.status = 'active'
    WHERE ability.id = ? AND ability.organisation_id = ?
      AND ability.status = 'active'
      AND (ability.activity_version_id = ''
        OR ability.activity_version_id = ?)
      AND ability.effective_from <= ?
      AND (ability.effective_to = '' OR ability.effective_to >= ?)
      AND trim(ability.approved_by_uid) <> ''
      AND datetime(ability.approved_at) IS NOT NULL
    LIMIT 1`)
    .bind(
      abilityId,
      actor.organisationId,
      input.activityVersionId,
      input.activityDate,
      input.activityDate,
    )
    .first<AbilityRecord>();
  if (
    !row
    || !input.acceptedCodes.includes(row.ability_code)
    || !input.acceptedParticipantTypes.includes(row.participant_type)
  ) {
    return fail(
      "SRES_ACTIVATION_ABILITY_NOT_ACTIVE",
      409,
      "The selected SRES registration or accreditation is not active for the installation date.",
    );
  }
  const evidence = object(JSON.parse(row.evidence_snapshot || "{}"));
  if (Object.keys(evidence).length === 0) {
    return fail(
      "SRES_ACTIVATION_ABILITY_EVIDENCE_REQUIRED",
      409,
      "The selected SRES registration or accreditation has no retained evidence.",
    );
  }
  return Object.freeze({
    abilityId: row.id,
    participantId: row.participant_id,
    participantType: row.participant_type,
    legalName: row.legal_name,
    externalReference: row.external_reference,
    abilityCode: row.ability_code,
    abilityRole: row.ability_role,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    evidenceSha256: creditexCanonicalSha256(evidence),
    approvedByUid: row.approved_by_uid,
    approvedAt: exactTimestamp(row.approved_at, "Ability approval time"),
  });
}

async function buildDerivedEvidence(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  scope: Awaited<ReturnType<typeof loadSresScope>>,
  source: Awaited<ReturnType<typeof loadApprovedSource>>,
  evidenceKind: CreditexSresActivationEvidenceKind,
  detailsValue: unknown,
) {
  const details = object(detailsValue);
  switch (evidenceKind) {
    case "rec_registry_submission_contract": {
      const submissionMethod = requiredText(
        details.submissionMethod,
        20,
        "Submission method",
      );
      if (submissionMethod !== "manual") {
        return fail(
          "SRES_ACTIVATION_SUBMISSION_METHOD_INVALID",
          400,
          "Choose the retained manual submission contract.",
        );
      }
      return Object.freeze({
        resultCode: "manual_submission_contract_current",
        evidence: Object.freeze({
          submissionMethod,
          providerName: requiredText(details.providerName, 160, "Provider"),
          schemaVersion: requiredText(
            details.schemaVersion,
            120,
            "Submission schema version",
          ),
          contractSha256: exactSourceSha256(
            details.contractSha256,
            source,
            "Submission contract",
          ),
        }),
      });
    }
    case "declaration_snapshot":
      return Object.freeze({
        resultCode: "current",
        evidence: Object.freeze({
          declarationVersion: requiredText(
            details.declarationVersion,
            160,
            "Declaration version",
          ),
          declarationDocumentSha256: exactSourceSha256(
            details.declarationDocumentSha256,
            source,
            "Declaration document",
          ),
        }),
      });
    case "component_recall_status": {
      const components = await exactInstalledEquipment(
        database,
        actor,
        scope.caseId,
      );
      return Object.freeze({
        resultCode: "listed_not_removed",
        evidence: Object.freeze({
          providerReference: requiredText(
            details.providerReference,
            240,
            "Recall search reference",
          ),
          components,
        }),
      });
    }
    case "calculator_vector_suite": {
      const receiptId = requiredText(
        details.engineReceiptId,
        240,
        "Approved engine receipt",
      );
      const receipt = await database.prepare(`SELECT receipt.id,
          receipt.calculator_version_id, receipt.engine_contract_hash,
          receipt.golden_vector_suite_sha256, receipt.engine_suite_hash,
          receipt.suite_receipt_hash, receipt.vector_count,
          receipt.executed_by_uid, receipt.executed_at,
          calculator.calculator_key, calculator.version,
          calculator.official_source_sha256
        FROM compliance_calculator_engine_receipts receipt
        JOIN compliance_calculator_versions calculator
          ON calculator.id = receipt.calculator_version_id
          AND calculator.organisation_id = receipt.organisation_id
          AND calculator.activity_version_id = ?
          AND calculator.approval_state = 'approved'
          AND calculator.primary_approver_uid <>
            calculator.secondary_approver_uid
        WHERE receipt.id = ? AND receipt.organisation_id = ?
          AND receipt.result = 'passed'
        LIMIT 1`)
        .bind(scope.activityVersionId, receiptId, actor.organisationId)
        .first<Record<string, unknown>>();
      if (!receipt) {
        return fail(
          "SRES_ACTIVATION_VECTOR_RECEIPT_INVALID",
          409,
          "Choose a passed engine receipt for the approved exact calculator.",
        );
      }
      const calculatorSourceSha256 = exactBareSha256(
        `sha256:${receipt.official_source_sha256}`,
        "Calculator source",
      );
      if (calculatorSourceSha256 !== source.sha256) {
        return fail(
          "SRES_ACTIVATION_CALCULATOR_SOURCE_MISMATCH",
          409,
          "The passed calculator receipt must use the selected independently reviewed official source.",
        );
      }
      const vectorCount = Number(receipt.vector_count);
      if (!Number.isSafeInteger(vectorCount) || vectorCount < 1) {
        return fail(
          "SRES_ACTIVATION_VECTOR_RECEIPT_INVALID",
          409,
          "The passed calculator receipt must retain at least one exact golden vector.",
        );
      }
      return Object.freeze({
        resultCode: "passed",
        evidence: Object.freeze({
          engineReceiptId: String(receipt.id),
          calculatorVersionId: String(receipt.calculator_version_id),
          calculatorKey: String(receipt.calculator_key),
          calculatorVersion: Number(receipt.version),
          engineContractSha256: exactSha256(
            receipt.engine_contract_hash,
            "Engine contract",
          ),
          vectorSuiteSha256: exactSha256(
            `sha256:${receipt.golden_vector_suite_sha256}`,
            "Vector suite",
          ),
          engineSuiteSha256: exactSha256(
            receipt.engine_suite_hash,
            "Engine suite",
          ),
          suiteReceiptSha256: exactSha256(
            receipt.suite_receipt_hash,
            "Suite receipt",
          ),
          sourceSha256: exactSha256(
            `sha256:${calculatorSourceSha256}`,
            "Calculator source",
          ),
          vectorCount,
          executedByUid: String(receipt.executed_by_uid),
          executedAt: exactTimestamp(
            receipt.executed_at,
            "Vector execution time",
          ),
        }),
      });
    }
    case "registered_agent_assignment": {
      const ability = await exactActiveAbility(database, actor, {
        abilityId: details.participantAbilityId,
        activityVersionId: scope.activityVersionId,
        activityDate: scope.activityDate,
        acceptedCodes: ["sres_registered_agent", "registered_agent"],
        acceptedParticipantTypes: ["agent", "aggregator"],
      });
      return Object.freeze({
        resultCode: "verified_assigned",
        evidence: Object.freeze({
          ...ability,
          assignmentReference: requiredText(
            details.assignmentReference,
            240,
            "Creditex assignment reference",
          ),
        }),
      });
    }
    case "component_eligibility": {
      const components = await exactInstalledEquipment(
        database,
        actor,
        scope.caseId,
      );
      return Object.freeze({
        resultCode: "eligible",
        evidence: Object.freeze({
          installationDate: scope.activityDate,
          components,
        }),
      });
    }
    case "installer_accreditation":
    case "designer_accreditation": {
      const role = evidenceKind === "installer_accreditation"
        ? "installer"
        : "designer";
      const ability = await exactActiveAbility(database, actor, {
        abilityId: details.participantAbilityId,
        activityVersionId: scope.activityVersionId,
        activityDate: scope.activityDate,
        acceptedCodes: role === "installer"
          ? ["sres_installer_accreditation", "cec_installer_accreditation"]
          : ["sres_designer_accreditation", "cec_designer_accreditation"],
        acceptedParticipantTypes: ["installer"],
      });
      return Object.freeze({
        resultCode: "active",
        evidence: Object.freeze({ role, ...ability }),
      });
    }
  }
}

const RESPONSE_CONTRACTS: Readonly<Record<
  CreditexSresActivationEvidenceKind,
  string
>> = Object.freeze({
  rec_registry_submission_contract:
    "creditex-sres-rec-registry-submission-contract/v1",
  declaration_snapshot: "creditex-sres-declaration-snapshot/v1",
  component_recall_status: "creditex-sres-component-recall-status/v1",
  calculator_vector_suite: "creditex-sres-calculator-vector-suite/v1",
  registered_agent_assignment:
    "creditex-sres-registered-agent-assignment/v1",
  component_eligibility: "creditex-sres-component-eligibility/v1",
  installer_accreditation: "creditex-sres-accreditation-status/v1",
  designer_accreditation: "creditex-sres-accreditation-status/v1",
});

export async function recordCreditexSresActivationEvidence(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    clientRequestId: unknown;
    activityTemplateId: unknown;
    caseId: unknown;
    evidenceKind: unknown;
    subjectKey: unknown;
    sourceArtifactId: unknown;
    sourceRecordKey: unknown;
    details: unknown;
    observedAt?: unknown;
    validUntil?: unknown;
    supersedesRecordId?: unknown;
  }>,
  options?: SresActivationOptions,
) {
  await requireCapability(database, actor, "canAuthor");
  const now = trustedNow(options);
  const scope = await loadSresScope(database, actor, input);
  const evidenceKind = String(input.evidenceKind || "").trim();
  if (!CREDITEX_SRES_ACTIVATION_EVIDENCE_KINDS.includes(
    evidenceKind as CreditexSresActivationEvidenceKind,
  )) {
    return fail(
      "SRES_ACTIVATION_KIND_INVALID",
      400,
      "Choose one of the governed SRES activation evidence gates.",
    );
  }
  const typedKind = evidenceKind as CreditexSresActivationEvidenceKind;
  const source = await loadApprovedSource(
    database,
    actor,
    input.sourceArtifactId,
  );
  const observedAt = optionalText(
    input.observedAt,
    40,
    "Evidence occurrence time",
  )
    ? exactTimestamp(input.observedAt, "Evidence occurrence time")
    : now;
  if (Date.parse(observedAt) > Date.parse(now)) {
    return fail(
      "SRES_ACTIVATION_TIME_INVALID",
      400,
      "Evidence occurrence cannot be ahead of the server clock.",
    );
  }
  const validUntil = optionalText(input.validUntil, 40, "Evidence expiry")
    ? exactTimestamp(input.validUntil, "Evidence expiry")
    : "";
  if (validUntil && Date.parse(validUntil) < Date.parse(now)) {
    return fail(
      "SRES_ACTIVATION_EVIDENCE_EXPIRED",
      409,
      "Expired SRES activation evidence cannot be recorded as current.",
    );
  }
  const subjectKey = requiredText(input.subjectKey, 240, "Evidence subject");
  const clientRequestId = requiredText(
    input.clientRequestId,
    240,
    "Client request",
  );
  const sourceRecordKey = requiredText(
    input.sourceRecordKey,
    500,
    "Official source record",
  );
  const derived = await buildDerivedEvidence(
    database,
    actor,
    scope,
    source,
    typedKind,
    input.details,
  );
  const caseId = [
    "component_recall_status",
    "registered_agent_assignment",
    "component_eligibility",
    "installer_accreditation",
    "designer_accreditation",
  ].includes(typedKind) ? scope.caseId : "";
  const supersedesRecordId = optionalText(
    input.supersedesRecordId,
    240,
    "Superseded activation record",
  );
  if (supersedesRecordId) {
    const prior = await database.prepare(`SELECT prior.id
      FROM compliance_sres_activation_records prior
      WHERE prior.id = ? AND prior.organisation_id = ?
        AND prior.program_code = 'SRES'
        AND prior.activity_template_id = ? AND prior.case_id = ?
        AND prior.evidence_kind = ? AND prior.subject_key = ?
        AND NOT EXISTS (
          SELECT 1 FROM compliance_sres_activation_records successor
          WHERE successor.supersedes_record_id = prior.id
            AND successor.client_request_id <> ?
        )
      LIMIT 1`)
      .bind(
        supersedesRecordId,
        actor.organisationId,
        scope.activityTemplateId,
        caseId,
        typedKind,
        subjectKey,
        clientRequestId,
      )
      .first<{ id: string }>();
    if (!prior) {
      return fail(
        "SRES_ACTIVATION_SUPERSESSION_INVALID",
        409,
        "Replacement evidence must supersede the current record for this exact gate and subject.",
      );
    }
  }
  const responseContract = RESPONSE_CONTRACTS[typedKind];
  const responseSnapshot = Object.freeze({
    contract: responseContract,
    programCode: "SRES",
    activityTemplateId: scope.activityTemplateId,
    caseId,
    evidenceKind: typedKind,
    subjectKey,
    resultCode: derived.resultCode,
    sourceArtifactId: source.id,
    sourceArtifactSha256: source.sha256,
    sourceRecordKey,
    effectiveFrom: scope.activityDate,
    effectiveTo: "",
    observedAt,
    validUntil,
    supersedesRecordId,
    officialSource: Object.freeze({
      title: source.title,
      url: source.url,
      version: source.version,
      capturedAt: source.capturedAt,
      reviewId: source.reviewId,
      reviewedAt: source.reviewedAt,
    }),
    evidence: derived.evidence,
  });
  const responseSha256 = creditexCanonicalSha256(responseSnapshot);
  const id = identifier("sres-activation-record", options);
  const existing = await database.prepare(`SELECT id, evidence_kind,
      result_code, response_sha256, supersedes_record_id
    FROM compliance_sres_activation_records
    WHERE organisation_id = ? AND client_request_id = ? LIMIT 1`)
    .bind(actor.organisationId, clientRequestId)
    .first<Record<string, unknown>>();
  if (existing) {
    if (
      String(existing.evidence_kind) === typedKind
      && String(existing.result_code) === derived.resultCode
      && String(existing.response_sha256) === responseSha256
      && String(existing.supersedes_record_id) === supersedesRecordId
    ) {
      return Object.freeze({
        recordId: String(existing.id),
        evidenceKind: typedKind,
        resultCode: derived.resultCode,
        responseSha256,
      });
    }
    return fail(
      "SRES_ACTIVATION_IDEMPOTENCY_CONFLICT",
      409,
      "This client request is already bound to different immutable SRES evidence.",
    );
  }
  await database.prepare(`INSERT INTO compliance_sres_activation_records (
      id, client_request_id, organisation_id, program_code,
      activity_template_id, case_id, evidence_kind, subject_key, result_code,
      source_artifact_id, source_artifact_sha256, source_record_key,
      response_contract, response_snapshot, response_sha256,
      effective_from, effective_to, observed_at, valid_until,
      supersedes_record_id, created_by_uid, created_actor_kind, created_at
    ) VALUES (?, ?, ?, 'SRES', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?,
      ?, ?, ?, ?)`)
    .bind(
      id,
      clientRequestId,
      actor.organisationId,
      scope.activityTemplateId,
      caseId,
      typedKind,
      subjectKey,
      derived.resultCode,
      source.id,
      source.sha256,
      sourceRecordKey,
      responseContract,
      JSON.stringify(responseSnapshot),
      responseSha256,
      scope.activityDate,
      observedAt,
      validUntil,
      supersedesRecordId,
      actor.actorUid,
      actor.actorKind,
      now,
    )
    .run();
  return Object.freeze({
    recordId: id,
    evidenceKind: typedKind,
    resultCode: derived.resultCode,
    responseSha256,
  });
}

type ActivationRecordRow = {
  id: string;
  activity_template_id: string;
  case_id: string;
  evidence_kind: string;
  subject_key: string;
  result_code: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  source_record_key: string;
  response_sha256: string;
  effective_from: string;
  effective_to: string;
  observed_at: string;
  valid_until: string;
  created_by_uid: string;
  created_at: string;
  review_id: string;
  review_decision: string;
  reviewed_by_uid: string;
  reviewed_at: string;
  supersedes_record_id: string;
  response_snapshot: string;
};

function projectActivationRecord(
  row: ActivationRecordRow,
): CreditexSresActivationRecordProjection {
  return Object.freeze({
    recordId: row.id,
    evidenceKind: row.evidence_kind as CreditexSresActivationEvidenceKind,
    subjectKey: row.subject_key,
    resultCode: row.result_code,
    sourceArtifactId: row.source_artifact_id,
    sourceArtifactSha256: row.source_artifact_sha256,
    sourceRecordKey: row.source_record_key,
    responseSha256: row.response_sha256,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    reviewed: row.review_decision === "approved",
    reviewId: row.review_id,
    reviewedByUid: row.reviewed_by_uid,
    reviewedAt: row.reviewed_at,
    supersedesRecordId: row.supersedes_record_id,
  });
}

function activationRecordSnapshotIsExact(row: ActivationRecordRow) {
  try {
    const snapshot = object(JSON.parse(row.response_snapshot));
    return creditexCanonicalSha256(snapshot) === row.response_sha256
      && snapshot.activityTemplateId === row.activity_template_id
      && snapshot.caseId === row.case_id
      && snapshot.evidenceKind === row.evidence_kind
      && snapshot.subjectKey === row.subject_key
      && snapshot.resultCode === row.result_code
      && snapshot.sourceArtifactId === row.source_artifact_id
      && snapshot.sourceArtifactSha256 === row.source_artifact_sha256
      && snapshot.sourceRecordKey === row.source_record_key
      && snapshot.effectiveFrom === row.effective_from
      && snapshot.effectiveTo === row.effective_to
      && snapshot.observedAt === row.observed_at
      && snapshot.validUntil === row.valid_until
      && String(snapshot.supersedesRecordId || "")
        === row.supersedes_record_id;
  } catch {
    return false;
  }
}

export async function reviewCreditexSresActivationEvidence(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    recordId: unknown;
    decision: unknown;
    reviewNote: unknown;
  }>,
  options?: SresActivationOptions,
) {
  await requireCapability(database, actor, "canReview");
  const recordId = requiredText(input.recordId, 240, "Activation record");
  const decision = String(input.decision || "").trim();
  if (decision !== "approved" && decision !== "rejected") {
    return fail(
      "SRES_ACTIVATION_REVIEW_DECISION_INVALID",
      400,
      "Choose approved or rejected.",
    );
  }
  const reviewNote = requiredText(
    input.reviewNote,
    2000,
    "Independent review note",
  );
  if (reviewNote.length < 10) {
    return fail(
      "SRES_ACTIVATION_REVIEW_NOTE_REQUIRED",
      400,
      "Independent review notes must contain at least ten characters.",
    );
  }
  const row = await database.prepare(`SELECT id, response_sha256,
      source_artifact_id, source_artifact_sha256, created_by_uid, created_at
    FROM compliance_sres_activation_records
    WHERE id = ? AND organisation_id = ? LIMIT 1`)
    .bind(recordId, actor.organisationId)
    .first<Record<string, unknown>>();
  if (!row) {
    return fail(
      "SRES_ACTIVATION_RECORD_NOT_FOUND",
      404,
      "The immutable activation record was not found.",
    );
  }
  const existingReview = await database.prepare(`SELECT id, decision,
      reviewed_by_uid, review_note, reviewed_at
    FROM compliance_sres_activation_reviews
    WHERE organisation_id = ? AND activation_record_id = ? LIMIT 1`)
    .bind(actor.organisationId, recordId)
    .first<Record<string, unknown>>();
  if (existingReview) {
    if (
      String(existingReview.decision) === decision
      && String(existingReview.reviewed_by_uid) === actor.actorUid
      && String(existingReview.review_note) === reviewNote
    ) {
      return Object.freeze({
        recordId,
        reviewId: String(existingReview.id),
        decision,
        reviewedAt: String(existingReview.reviewed_at),
      });
    }
    return fail(
      "SRES_ACTIVATION_REVIEW_ALREADY_RECORDED",
      409,
      "This immutable activation record already has an independent review.",
    );
  }
  if (String(row.created_by_uid) === actor.actorUid) {
    return fail(
      "SRES_ACTIVATION_SELF_REVIEW_FORBIDDEN",
      409,
      "The evidence author cannot independently review their own record.",
    );
  }
  const now = trustedNow(options);
  if (Date.parse(now) < Date.parse(String(row.created_at))) {
    return fail(
      "SRES_ACTIVATION_REVIEW_TIME_INVALID",
      409,
      "The review cannot predate the immutable evidence record.",
    );
  }
  const reviewId = identifier("sres-activation-review", options);
  await database.prepare(`INSERT INTO compliance_sres_activation_reviews (
      id, organisation_id, activation_record_id, response_sha256,
      source_artifact_id, source_artifact_sha256, decision, reviewed_by_uid,
      reviewed_actor_kind, review_note, reviewed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      reviewId,
      actor.organisationId,
      recordId,
      row.response_sha256,
      row.source_artifact_id,
      row.source_artifact_sha256,
      decision,
      actor.actorUid,
      actor.actorKind,
      reviewNote,
      now,
      now,
    )
    .run();
  return Object.freeze({ recordId, reviewId, decision, reviewedAt: now });
}

const GATE_DEFINITIONS = Object.freeze([
  ["rec_registry_submission_contract", "REC Registry submission contract",
    "Current exact manual pack and provider receipt contract.",
    "manual_submission_contract_current"],
  ["declaration_snapshot", "Current declarations",
    "Exact current declarations retained with document hash.", "current"],
  ["component_recall_status", "Component recall and removal status",
    "Installed component records checked against the current official status source.",
    "listed_not_removed"],
  ["calculator_vector_suite", "Exact calculator vectors",
    "Approved calculator and passed fixed-decimal engine receipt.", "passed"],
  ["registered_agent_assignment", "Creditex registered-agent assignment",
    "Active registered-agent ability and exact case assignment reference.",
    "verified_assigned"],
  ["component_eligibility", "Installation-date component eligibility",
    "Exact installed components remain eligible on the activity date.", "eligible"],
  ["installer_accreditation", "Installer accreditation",
    "Active installer accreditation on the activity date.", "active"],
  ["designer_accreditation", "Designer accreditation",
    "Active designer accreditation on the activity date.", "active"],
] as const);

export async function loadCreditexSresActivationState(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{ activityTemplateId: unknown; caseId: unknown }>,
  options?: SresActivationOptions,
) {
  const identity = await activationIdentity(database, actor);
  const scope = await loadSresScope(database, actor, input);
  const asAt = trustedNow(options);
  const rows = await database.prepare(`SELECT record.id,
      record.activity_template_id, record.case_id, record.evidence_kind,
      record.subject_key, record.result_code, record.source_artifact_id,
      record.source_artifact_sha256, record.source_record_key,
      record.response_snapshot, record.response_sha256,
      record.effective_from, record.effective_to,
      record.observed_at, record.valid_until, record.created_by_uid,
      record.supersedes_record_id, record.created_at,
      COALESCE(review.id, '') review_id,
      COALESCE(review.decision, '') review_decision,
      COALESCE(review.reviewed_by_uid, '') reviewed_by_uid,
      COALESCE(review.reviewed_at, '') reviewed_at
    FROM compliance_sres_activation_records record
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = record.source_artifact_id
      AND artifact.organisation_id = record.organisation_id
      AND artifact.sha256 = record.source_artifact_sha256
    JOIN compliance_official_source_review_decisions source_review
      ON source_review.organisation_id = artifact.organisation_id
      AND source_review.subject_type = 'artifact'
      AND source_review.subject_id = artifact.id
      AND source_review.artifact_id = artifact.id
      AND source_review.artifact_sha256 = artifact.sha256
      AND source_review.artifact_object_key = artifact.object_key
      AND source_review.decision = 'approved'
    LEFT JOIN compliance_sres_activation_reviews review
      ON review.organisation_id = record.organisation_id
      AND review.activation_record_id = record.id
    WHERE record.organisation_id = ?
      AND record.program_code = 'SRES'
      AND record.activity_template_id = ?
      AND record.case_id IN ('', ?)
      AND record.effective_from <= ?
      AND (record.effective_to = '' OR record.effective_to >= ?)
      AND (record.valid_until = '' OR datetime(record.valid_until) >= datetime(?))
      AND NOT EXISTS (
        SELECT 1 FROM compliance_sres_activation_records successor
        WHERE successor.supersedes_record_id = record.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = source_review.id
      )
    ORDER BY record.evidence_kind, record.created_at DESC, record.id DESC`)
    .bind(
      actor.organisationId,
      scope.activityTemplateId,
      scope.caseId,
      scope.activityDate,
      scope.activityDate,
      asAt,
    )
    .all<ActivationRecordRow>();
  const latest = new Map<CreditexSresActivationEvidenceKind, ActivationRecordRow>();
  for (const row of rows.results) {
    const kind = row.evidence_kind as CreditexSresActivationEvidenceKind;
    if (!latest.has(kind) && activationRecordSnapshotIsExact(row)) {
      latest.set(kind, row);
    }
  }
  const gates: CreditexSresActivationGate[] = GATE_DEFINITIONS.map((definition) => {
    const kind = definition[0] as CreditexSresActivationEvidenceKind;
    const row = latest.get(kind);
    const projection = row ? projectActivationRecord(row) : null;
    return Object.freeze({
      evidenceKind: kind,
      title: definition[1],
      description: definition[2],
      expectedResult: definition[3],
      status: !row
        ? "missing" as const
        : row.review_decision === "approved"
          ? "approved" as const
          : row.review_decision === "rejected"
            ? "rejected" as const
            : "awaiting_review" as const,
      record: projection,
    });
  });
  const approvedRecords = gates
    .filter((gate) => gate.status === "approved" && gate.record)
    .map((gate) => gate.record as CreditexSresActivationRecordProjection);
  const snapshotRow = approvedRecords.length === 8
    ? await database.prepare(`SELECT id, snapshot_json, snapshot_sha256,
          created_at
        FROM compliance_sres_activation_snapshots
        WHERE organisation_id = ? AND activity_template_id = ?
          AND case_id = ? AND activity_date = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`)
      .bind(
        actor.organisationId,
        scope.activityTemplateId,
        scope.caseId,
        scope.activityDate,
      )
      .first<{
        id: string;
        snapshot_json: string;
        snapshot_sha256: string;
        created_at: string;
      }>()
    : null;
  let snapshot: CreditexSresActivationSnapshot | null = null;
  if (snapshotRow) {
    try {
      const parsed = JSON.parse(snapshotRow.snapshot_json);
      if (
        creditexCanonicalSha256(parsed) === snapshotRow.snapshot_sha256
        && parsed.contract === CREDITEX_SRES_ACTIVATION_EVIDENCE_CONTRACT
        && parsed.snapshotId === snapshotRow.id
        && parsed.programCode === "SRES"
        && parsed.activityTemplateId === scope.activityTemplateId
        && parsed.caseId === scope.caseId
        && parsed.activityDate === scope.activityDate
        && Array.isArray(parsed.records)
        && creditexCanonicalSha256(parsed.records)
          === creditexCanonicalSha256(approvedRecords)
        && Date.parse(snapshotRow.created_at) <= Date.parse(asAt)
      ) {
        snapshot = Object.freeze(parsed) as CreditexSresActivationSnapshot;
      }
    } catch {
      snapshot = null;
    }
  }
  return Object.freeze({
    contract: "creditex-sres-certificate-activation-state/v1",
    ...scope,
    gates: Object.freeze(gates),
    ready: Boolean(snapshot),
    blockers: Object.freeze(gates
      .filter((gate) => gate.status !== "approved")
      .map((gate) => `sres_${gate.evidenceKind}_${gate.status}`)
      .concat(snapshot ? [] : approvedRecords.length === 8
        ? [snapshotRow
          ? "sres_activation_snapshot_stale_or_invalid"
          : "sres_activation_snapshot_required"]
        : [])),
    snapshot,
    snapshotSha256: snapshot
      ? creditexCanonicalSha256(snapshot)
      : "",
    capabilities: Object.freeze({
      canRecord: identity.access.canAuthor,
      canReview: identity.access.canReview,
      canFreeze: identity.access.canAuthor && approvedRecords.length === 8,
    }),
  });
}

export async function listCreditexSresActivationEvidenceOptions(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{ activityTemplateId: unknown; caseId: unknown }>,
) {
  await activationIdentity(database, actor);
  const scope = await loadSresScope(database, actor, input);
  const sources = await database.prepare(`SELECT artifact.id,
      artifact.source_title, artifact.source_url, artifact.source_version,
      artifact.sha256, decision.reviewed_at reviewed_at
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_review_decisions decision
      ON decision.organisation_id = artifact.organisation_id
      AND decision.subject_type = 'artifact'
      AND decision.subject_id = artifact.id
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE artifact.organisation_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = decision.id
      )
    ORDER BY decision.reviewed_at DESC, artifact.source_title, artifact.id
    LIMIT 250`)
    .bind(actor.organisationId)
    .all<Record<string, unknown>>();
  const engineReceipts = await database.prepare(`SELECT receipt.id,
      calculator.title, calculator.calculator_key, calculator.version,
      calculator.official_source_sha256,
      receipt.vector_count, receipt.suite_receipt_hash, receipt.executed_at
    FROM compliance_calculator_engine_receipts receipt
    JOIN compliance_calculator_versions calculator
      ON calculator.id = receipt.calculator_version_id
      AND calculator.organisation_id = receipt.organisation_id
      AND calculator.activity_version_id = ?
      AND calculator.approval_state = 'approved'
    WHERE receipt.organisation_id = ? AND receipt.result = 'passed'
    ORDER BY receipt.executed_at DESC, receipt.id`)
    .bind(scope.activityVersionId, actor.organisationId)
    .all<Record<string, unknown>>();
  const abilities = await database.prepare(`SELECT ability.id,
      ability.ability_code, ability.ability_role, ability.effective_from,
      ability.effective_to, participant.legal_name,
      participant.external_reference, participant.participant_type
    FROM compliance_participant_abilities ability
    JOIN compliance_participants participant
      ON participant.id = ability.participant_id
      AND participant.organisation_id = ability.organisation_id
      AND participant.status = 'active'
    WHERE ability.organisation_id = ? AND ability.status = 'active'
      AND (ability.activity_version_id = ''
        OR ability.activity_version_id = ?)
      AND ability.effective_from <= ?
      AND (ability.effective_to = '' OR ability.effective_to >= ?)
      AND ability.ability_code IN (
        'sres_registered_agent', 'registered_agent',
        'sres_installer_accreditation', 'cec_installer_accreditation',
        'sres_designer_accreditation', 'cec_designer_accreditation'
      )
      AND (
        (ability.ability_code IN ('sres_registered_agent', 'registered_agent')
          AND participant.participant_type IN ('agent', 'aggregator'))
        OR (ability.ability_code IN (
            'sres_installer_accreditation', 'cec_installer_accreditation',
            'sres_designer_accreditation', 'cec_designer_accreditation'
          ) AND participant.participant_type = 'installer')
      )
    ORDER BY participant.legal_name, ability.ability_code, ability.id`)
    .bind(
      actor.organisationId,
      scope.activityVersionId,
      scope.activityDate,
      scope.activityDate,
    )
    .all<Record<string, unknown>>();
  return Object.freeze({
    contract: "creditex-sres-activation-evidence-options/v1",
    scope,
    sources: Object.freeze(sources.results.map((row) => Object.freeze({
      value: String(row.id),
      label: [row.source_title, row.source_version].filter(Boolean).join(" · "),
      sourceUrl: String(row.source_url),
      sourceSha256: String(row.sha256),
      reviewedAt: String(row.reviewed_at),
    }))),
    engineReceipts: Object.freeze(engineReceipts.results.map((row) =>
      Object.freeze({
        value: String(row.id),
        label: `${row.title} · v${row.version} · ${row.vector_count} vectors`,
        calculatorKey: String(row.calculator_key),
        sourceSha256: String(row.official_source_sha256),
        receiptSha256: String(row.suite_receipt_hash),
        executedAt: String(row.executed_at),
      })
    )),
    abilities: Object.freeze(abilities.results.map((row) => Object.freeze({
      value: String(row.id),
      label: `${row.legal_name} · ${String(row.ability_code).replaceAll("_", " ")}`,
      abilityCode: String(row.ability_code),
      abilityRole: String(row.ability_role),
      participantType: String(row.participant_type),
      externalReference: String(row.external_reference),
      effectiveFrom: String(row.effective_from),
      effectiveTo: String(row.effective_to),
    }))),
  });
}

export async function freezeCreditexSresActivationSnapshot(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    clientRequestId: unknown;
    activityTemplateId: unknown;
    caseId: unknown;
  }>,
  options?: SresActivationOptions,
) {
  await requireCapability(database, actor, "canAuthor");
  const clientRequestId = requiredText(
    input.clientRequestId,
    240,
    "Client request",
  );
  const existing = await database.prepare(`SELECT id, activity_template_id,
      case_id, snapshot_json, snapshot_sha256, created_at
    FROM compliance_sres_activation_snapshots
    WHERE organisation_id = ? AND client_request_id = ? LIMIT 1`)
    .bind(actor.organisationId, clientRequestId)
    .first<Record<string, unknown>>();
  if (existing) {
    try {
      const snapshot = JSON.parse(String(existing.snapshot_json));
      if (
        String(existing.activity_template_id)
          === requiredText(input.activityTemplateId, 240, "Activity template")
        && String(existing.case_id)
          === requiredText(input.caseId, 240, "Compliance case")
        && creditexCanonicalSha256(snapshot)
          === String(existing.snapshot_sha256)
      ) {
        return Object.freeze({
          snapshot: Object.freeze(snapshot) as CreditexSresActivationSnapshot,
          snapshotSha256: String(existing.snapshot_sha256),
          createdAt: String(existing.created_at),
        });
      }
    } catch {
      // The conflict below is fail closed for a corrupt or differently bound row.
    }
    return fail(
      "SRES_ACTIVATION_IDEMPOTENCY_CONFLICT",
      409,
      "This client request is already bound to a different activation snapshot.",
    );
  }
  const state = await loadCreditexSresActivationState(
    database,
    actor,
    input,
    options,
  );
  const records = state.gates
    .filter((gate) => gate.status === "approved" && gate.record)
    .map((gate) => gate.record as CreditexSresActivationRecordProjection);
  if (records.length !== 8) {
    return fail(
      "SRES_ACTIVATION_INCOMPLETE",
      409,
      "All eight exact SRES activation gates require independent approval before freezing the submission evidence.",
    );
  }
  const snapshotId = identifier("sres-activation-snapshot", options);
  const snapshot: CreditexSresActivationSnapshot = Object.freeze({
    contract: CREDITEX_SRES_ACTIVATION_EVIDENCE_CONTRACT,
    snapshotId,
    programCode: "SRES",
    activityTemplateId: state.activityTemplateId,
    caseId: state.caseId,
    activityDate: state.activityDate,
    records: Object.freeze(records),
  });
  const snapshotSha256 = creditexCanonicalSha256(snapshot);
  const now = trustedNow(options);
  await database.prepare(`INSERT INTO compliance_sres_activation_snapshots (
      id, client_request_id, organisation_id, program_code,
      activity_template_id, case_id, activity_date, snapshot_json,
      snapshot_sha256, created_by_uid, created_actor_kind, created_at
    ) VALUES (?, ?, ?, 'SRES', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      snapshotId,
      clientRequestId,
      actor.organisationId,
      state.activityTemplateId,
      state.caseId,
      state.activityDate,
      JSON.stringify(snapshot),
      snapshotSha256,
      actor.actorUid,
      actor.actorKind,
      now,
    )
    .run();
  return Object.freeze({ snapshot, snapshotSha256, createdAt: now });
}
