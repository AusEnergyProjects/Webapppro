import { sha256Hex } from "./creditex-official-source-custody-server.ts";

type FieldAcceptanceMember = {
  uid: string;
  organisationId: string;
  role: string;
  governanceIdentityVerified?: boolean;
};

type FieldAcceptanceStatus =
  | "not_run"
  | "blocked"
  | "failed"
  | "passed"
  | "rejected";
type FieldTestResult = "failed" | "passed";
type FieldAcceptanceDecision = "approved" | "rejected";

type FieldTestArtifactRecord = {
  id: string;
  organisation_id: string;
  client_request_id: string;
  request_sha256: string;
  artifact_sha256: string;
  platform: string;
  native_build_identifier: string;
  native_build_sha256: string;
  device_class: string;
  device_model: string;
  device_os_version: string;
  device_identifier_sha256: string;
  requirement_id: string;
  evidence_id: string;
  integrity_receipt_id: string;
  offline_scenario: string;
  restore_sha256: string;
  test_result: FieldTestResult;
  tester_uid: string;
  tested_at: string;
  created_by_uid: string;
  created_at: string;
};

type FieldAcceptanceRecord = {
  id: string;
  organisation_id: string;
  client_request_id: string;
  platform: string;
  native_build_identifier: string;
  native_build_sha256: string;
  device_class: string;
  device_model: string;
  device_os_version: string;
  device_identifier_sha256: string;
  requirement_id: string;
  evidence_id: string;
  integrity_receipt_id: string;
  offline_scenario: string;
  restore_sha256: string;
  status: FieldAcceptanceStatus;
  test_artifact_id: string;
  test_artifact_sha256: string;
  tester_uid: string;
  independent_approver_uid: string;
  tested_at: string;
  approved_at: string;
  created_by_uid: string;
  created_at: string;
};

type AcceptanceLinkRecord = {
  evidence_sha256: string;
  receipt_result: string;
  receipt_expected_sha256: string;
  receipt_observed_sha256: string;
  tester_uid: string;
  approver_uid: string;
};

export const CREDITEX_FIELD_ACCEPTANCE_MAXIMUM_REQUEST_BYTES = 32 * 1024;

type PhysicalTestIdentityInput = {
  clientRequestId: unknown;
  platform: unknown;
  nativeBuildIdentifier: unknown;
  nativeBuildSha256: unknown;
  deviceModel: unknown;
  deviceOsVersion: unknown;
  deviceIdentifierSha256: unknown;
  requirementId: unknown;
  evidenceId: unknown;
  integrityReceiptId: unknown;
  offlineScenario?: unknown;
};

export type AppendCreditexFieldCustodyTestArtifactInput =
  PhysicalTestIdentityInput & {
  restoreSha256: unknown;
  testResult: unknown;
  testerUid: unknown;
  testedAt: unknown;
};

export type AppendCreditexFieldCustodyAcceptanceInput =
  PhysicalTestIdentityInput & {
  restoreSha256?: unknown;
  status?: unknown;
  testArtifactId?: unknown;
  testerUid: unknown;
  independentApproverUid: unknown;
  testedAt?: unknown;
  approvedAt?: unknown;
};

export type AppendCreditexFieldCustodyDecisionInput = {
  clientRequestId: unknown;
  testArtifactId: unknown;
  decision: unknown;
  decidedAt: unknown;
};

export class CreditexFieldCustodyAcceptanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexFieldCustodyAcceptanceError(code, status, message);
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
) {
  const cleaned = String(value || "").trim();
  if (
    !cleaned
    || cleaned.length > maximum
    || /[\u0000-\u001f\u007f]/.test(cleaned)
  ) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanIdentifier(
  value: unknown,
  code: string,
  message: string,
  maximum = 180,
) {
  const cleaned = cleanText(value, maximum, code, message);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cleaned)) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanClientRequestId(value: unknown) {
  const cleaned = cleanIdentifier(
    value,
    "FIELD_ACCEPTANCE_REQUEST_ID_INVALID",
    "Add a stable field acceptance request reference.",
    120,
  );
  if (cleaned.length < 8) {
    fail(
      "FIELD_ACCEPTANCE_REQUEST_ID_INVALID",
      400,
      "Add a stable field acceptance request reference.",
    );
  }
  return cleaned;
}

function cleanSha256(
  value: unknown,
  code: string,
  message: string,
  allowEmpty = false,
) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (allowEmpty && !cleaned) return "";
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanTimestamp(
  value: unknown,
  code: string,
  message: string,
  allowEmpty = true,
) {
  const cleaned = String(value || "").trim();
  if (allowEmpty && !cleaned) return "";
  const timestamp = new Date(cleaned);
  if (!cleaned || Number.isNaN(timestamp.valueOf())) {
    fail(code, 400, message);
  }
  return timestamp.toISOString();
}

function cleanStatus(value: unknown): FieldAcceptanceStatus {
  const cleaned = String(value || "not_run").trim();
  if (
    !["not_run", "blocked", "failed", "passed", "rejected"].includes(cleaned)
  ) {
    fail(
      "FIELD_ACCEPTANCE_STATUS_INVALID",
      400,
      "Choose a supported physical field acceptance status.",
    );
  }
  return cleaned as FieldAcceptanceStatus;
}

function cleanDecision(value: unknown): FieldAcceptanceDecision {
  const cleaned = String(value || "").trim();
  if (!["approved", "rejected"].includes(cleaned)) {
    fail(
      "FIELD_ACCEPTANCE_DECISION_INVALID",
      400,
      "Choose approved or rejected for the field custody decision.",
    );
  }
  return cleaned as FieldAcceptanceDecision;
}

function cleanTestResult(value: unknown): FieldTestResult {
  const cleaned = String(value || "").trim();
  if (!["failed", "passed"].includes(cleaned)) {
    fail(
      "FIELD_TEST_RESULT_INVALID",
      400,
      "Choose failed or passed for the tester-authored physical test artifact.",
    );
  }
  return cleaned as FieldTestResult;
}

function cleanPhysicalTestIdentity(input: PhysicalTestIdentityInput) {
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const platform = String(input.platform || "").trim().toLowerCase();
  if (!["ios", "android"].includes(platform)) {
    fail(
      "FIELD_ACCEPTANCE_PLATFORM_INVALID",
      400,
      "Choose iOS or Android for the native field test.",
    );
  }
  const nativeBuildIdentifier = cleanText(
    input.nativeBuildIdentifier,
    180,
    "FIELD_ACCEPTANCE_BUILD_INVALID",
    "Identify the exact native application build.",
  );
  const nativeBuildSha256 = cleanSha256(
    input.nativeBuildSha256,
    "FIELD_ACCEPTANCE_BUILD_HASH_INVALID",
    "Add the SHA-256 hash of the exact native build.",
  );
  const deviceModel = cleanText(
    input.deviceModel,
    180,
    "FIELD_ACCEPTANCE_DEVICE_INVALID",
    "Identify the physical device model.",
  );
  const deviceOsVersion = cleanText(
    input.deviceOsVersion,
    120,
    "FIELD_ACCEPTANCE_DEVICE_OS_INVALID",
    "Identify the physical device operating system version.",
  );
  const deviceIdentifierSha256 = cleanSha256(
    input.deviceIdentifierSha256,
    "FIELD_ACCEPTANCE_DEVICE_HASH_INVALID",
    "Add a privacy-safe SHA-256 identifier for the physical device.",
  );
  const requirementId = cleanIdentifier(
    input.requirementId,
    "FIELD_ACCEPTANCE_REQUIREMENT_INVALID",
    "Choose the exact evidence requirement.",
  );
  const evidenceId = cleanIdentifier(
    input.evidenceId,
    "FIELD_ACCEPTANCE_EVIDENCE_INVALID",
    "Choose the exact evidence record.",
  );
  const integrityReceiptId = cleanIdentifier(
    input.integrityReceiptId,
    "FIELD_ACCEPTANCE_RECEIPT_INVALID",
    "Choose the exact evidence integrity receipt.",
  );
  const offlineScenario = String(
    input.offlineScenario || "offline_capture_restore",
  ).trim();
  if (offlineScenario !== "offline_capture_restore") {
    fail(
      "FIELD_ACCEPTANCE_SCENARIO_INVALID",
      400,
      "Use the controlled offline capture and restore acceptance scenario.",
    );
  }
  return {
    clientRequestId,
    platform,
    nativeBuildIdentifier,
    nativeBuildSha256,
    deviceModel,
    deviceOsVersion,
    deviceIdentifierSha256,
    requirementId,
    evidenceId,
    integrityReceiptId,
    offlineScenario,
  };
}

function cleanCurrentTimestamp(value: string | undefined) {
  return cleanTimestamp(
    value || new Date().toISOString(),
    "FIELD_ACCEPTANCE_CREATED_AT_INVALID",
    "The field acceptance current timestamp is invalid.",
    false,
  );
}

function requireTimestampNotAfter(
  value: string,
  maximum: string,
  code: string,
  message: string,
) {
  if (value && Date.parse(value) > Date.parse(maximum)) {
    fail(code, 409, message);
  }
}

function requireWriter(member: FieldAcceptanceMember) {
  if (
    !["admin", "case_manager", "reviewer", "auditor"].includes(member.role)
  ) {
    fail(
      "FIELD_ACCEPTANCE_ROLE_REQUIRED",
      403,
      "This compliance role cannot append field custody acceptance records.",
    );
  }
}

function requireReader(member: FieldAcceptanceMember) {
  if (
    !["admin", "case_manager", "reviewer", "auditor"].includes(member.role)
  ) {
    fail(
      "FIELD_ACCEPTANCE_ROLE_REQUIRED",
      403,
      "This compliance role cannot view field custody acceptance records.",
    );
  }
}

function requireGovernanceApprover(member: FieldAcceptanceMember) {
  if (member.role !== "admin" || member.governanceIdentityVerified !== true) {
    fail(
      "FIELD_ACCEPTANCE_GOVERNANCE_APPROVER_REQUIRED",
      403,
      "A governance-verified Creditex administrator is required to approve or reject a field custody test artifact.",
    );
  }
}

function publicTestArtifact(
  artifact: FieldTestArtifactRecord,
  reused?: boolean,
) {
  return {
    id: artifact.id,
    clientRequestId: artifact.client_request_id,
    artifactSha256: artifact.artifact_sha256,
    platform: artifact.platform,
    nativeBuildIdentifier: artifact.native_build_identifier,
    nativeBuildSha256: artifact.native_build_sha256,
    deviceClass: artifact.device_class,
    deviceModel: artifact.device_model,
    deviceOsVersion: artifact.device_os_version,
    deviceIdentifierSha256: artifact.device_identifier_sha256,
    requirementId: artifact.requirement_id,
    evidenceId: artifact.evidence_id,
    integrityReceiptId: artifact.integrity_receipt_id,
    offlineScenario: artifact.offline_scenario,
    restoreSha256: artifact.restore_sha256,
    testResult: artifact.test_result,
    testerUid: artifact.tester_uid,
    testedAt: artifact.tested_at,
    createdByUid: artifact.created_by_uid,
    createdAt: artifact.created_at,
    testerAuthored: artifact.created_by_uid === artifact.tester_uid,
    ...(reused === undefined ? {} : { reused }),
  };
}

function publicRecord(record: FieldAcceptanceRecord, reused?: boolean) {
  return {
    id: record.id,
    clientRequestId: record.client_request_id,
    platform: record.platform,
    nativeBuildIdentifier: record.native_build_identifier,
    nativeBuildSha256: record.native_build_sha256,
    deviceClass: record.device_class,
    deviceModel: record.device_model,
    deviceOsVersion: record.device_os_version,
    deviceIdentifierSha256: record.device_identifier_sha256,
    requirementId: record.requirement_id,
    evidenceId: record.evidence_id,
    integrityReceiptId: record.integrity_receipt_id,
    offlineScenario: record.offline_scenario,
    restoreSha256: record.restore_sha256,
    status: record.status,
    testArtifactId: record.test_artifact_id,
    testArtifactSha256: record.test_artifact_sha256,
    testerUid: record.tester_uid,
    independentApproverUid: record.independent_approver_uid,
    testedAt: record.tested_at,
    approvedAt: record.approved_at,
    createdByUid: record.created_by_uid,
    createdAt: record.created_at,
    physicalCustodyAccepted:
      record.status === "passed"
      && Boolean(record.test_artifact_id)
      && Boolean(record.test_artifact_sha256),
    ...(reused === undefined ? {} : { reused }),
  };
}

async function linkedEvidence(
  database: D1Database,
  organisationId: string,
  requirementId: string,
  evidenceId: string,
  integrityReceiptId: string,
  testerUid: string,
  independentApproverUid: string,
) {
  const linked = await database.prepare(`SELECT
      evidence.original_sha256 AS evidence_sha256,
      receipt.result AS receipt_result,
      receipt.expected_sha256 AS receipt_expected_sha256,
      receipt.observed_sha256 AS receipt_observed_sha256,
      tester.firebase_uid AS tester_uid,
      approver.firebase_uid AS approver_uid
    FROM compliance_evidence_requirements requirement
    JOIN compliance_case_evidence evidence
      ON evidence.requirement_id = requirement.id
      AND evidence.organisation_id = requirement.organisation_id
    JOIN compliance_evidence_integrity_receipts receipt
      ON receipt.evidence_id = evidence.id
      AND receipt.organisation_id = evidence.organisation_id
    JOIN compliance_users tester
      ON tester.organisation_id = evidence.organisation_id
      AND tester.firebase_uid = ?
      AND tester.status = 'active'
      AND tester.role IN ('admin', 'case_manager', 'reviewer', 'auditor')
    JOIN compliance_users approver
      ON approver.organisation_id = evidence.organisation_id
      AND approver.firebase_uid = ?
      AND approver.status = 'active'
      AND approver.role IN ('admin', 'reviewer', 'auditor')
    WHERE requirement.id = ?
      AND requirement.organisation_id = ?
      AND evidence.id = ?
      AND receipt.id = ?
    LIMIT 1`)
    .bind(
      testerUid,
      independentApproverUid,
      requirementId,
      organisationId,
      evidenceId,
      integrityReceiptId,
    )
    .first<AcceptanceLinkRecord>();
  if (!linked) {
    fail(
      "FIELD_ACCEPTANCE_LINK_INVALID",
      409,
      "The requirement, evidence, integrity receipt, tester, or approver link is not valid in this Creditex organisation.",
    );
  }
  return linked;
}

async function linkedTesterEvidence(
  database: D1Database,
  organisationId: string,
  requirementId: string,
  evidenceId: string,
  integrityReceiptId: string,
  testerUid: string,
) {
  const linked = await database.prepare(`SELECT
      evidence.original_sha256 AS evidence_sha256,
      receipt.result AS receipt_result,
      receipt.expected_sha256 AS receipt_expected_sha256,
      receipt.observed_sha256 AS receipt_observed_sha256,
      tester.firebase_uid AS tester_uid
    FROM compliance_evidence_requirements requirement
    JOIN compliance_case_evidence evidence
      ON evidence.requirement_id = requirement.id
      AND evidence.organisation_id = requirement.organisation_id
    JOIN compliance_evidence_integrity_receipts receipt
      ON receipt.evidence_id = evidence.id
      AND receipt.organisation_id = evidence.organisation_id
    JOIN compliance_users tester
      ON tester.organisation_id = evidence.organisation_id
      AND tester.firebase_uid = ?
      AND tester.status = 'active'
      AND tester.role IN ('admin', 'case_manager', 'reviewer', 'auditor')
    WHERE requirement.id = ?
      AND requirement.organisation_id = ?
      AND evidence.id = ?
      AND receipt.id = ?
    LIMIT 1`)
    .bind(
      testerUid,
      requirementId,
      organisationId,
      evidenceId,
      integrityReceiptId,
    )
    .first<Omit<AcceptanceLinkRecord, "approver_uid">>();
  if (!linked) {
    fail(
      "FIELD_TEST_ARTIFACT_LINK_INVALID",
      409,
      "The tester, evidence requirement, evidence, or integrity receipt link is not valid in this Creditex organisation.",
    );
  }
  return linked;
}

async function existingTestArtifact(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_field_custody_test_artifacts
    WHERE organisation_id = ? AND client_request_id = ?
    LIMIT 1`)
    .bind(organisationId, clientRequestId)
    .first<FieldTestArtifactRecord>();
}

async function testArtifactById(
  database: D1Database,
  organisationId: string,
  artifactId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_field_custody_test_artifacts
    WHERE organisation_id = ? AND id = ?
    LIMIT 1`)
    .bind(organisationId, artifactId)
    .first<FieldTestArtifactRecord>();
}

async function existingRecord(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_field_custody_acceptance_records
    WHERE organisation_id = ? AND client_request_id = ?
    LIMIT 1`)
    .bind(organisationId, clientRequestId)
    .first<FieldAcceptanceRecord & { request_sha256: string }>();
}

export async function appendCreditexFieldCustodyTestArtifact(
  database: D1Database,
  member: FieldAcceptanceMember,
  input: AppendCreditexFieldCustodyTestArtifactInput,
  options: { now?: string } = {},
) {
  requireWriter(member);
  const identity = cleanPhysicalTestIdentity(input);
  const restoreSha256 = cleanSha256(
    input.restoreSha256,
    "FIELD_TEST_ARTIFACT_RESTORE_HASH_INVALID",
    "Add the SHA-256 hash of the restored evidence bytes.",
  );
  const testResult = cleanTestResult(input.testResult);
  const testerUid = cleanText(
    input.testerUid,
    180,
    "FIELD_TEST_ARTIFACT_TESTER_INVALID",
    "Assign the physical-device tester.",
  );
  if (member.uid !== testerUid) {
    fail(
      "FIELD_TEST_ARTIFACT_AUTHOR_INVALID",
      403,
      "Only the named physical-device tester can author this immutable test artifact.",
    );
  }
  const testedAt = cleanTimestamp(
    input.testedAt,
    "FIELD_TEST_ARTIFACT_TESTED_AT_INVALID",
    "Add a valid physical test timestamp.",
    false,
  );
  const createdAt = cleanCurrentTimestamp(options.now);
  requireTimestampNotAfter(
    testedAt,
    createdAt,
    "FIELD_TEST_ARTIFACT_FUTURE_INVALID",
    "The physical test timestamp cannot be later than the artifact creation time.",
  );

  const links = await linkedTesterEvidence(
    database,
    member.organisationId,
    identity.requirementId,
    identity.evidenceId,
    identity.integrityReceiptId,
    testerUid,
  );
  if (
    testResult === "passed"
    && (
      links.receipt_result !== "matched"
      || links.receipt_expected_sha256 !== links.evidence_sha256
      || links.receipt_observed_sha256 !== links.evidence_sha256
      || restoreSha256 !== links.evidence_sha256
    )
  ) {
    fail(
      "FIELD_TEST_ARTIFACT_INTEGRITY_REQUIRED",
      409,
      "A passed tester artifact requires an exact matched integrity receipt and restored bytes hash.",
    );
  }

  const artifactSnapshot = {
    platform: identity.platform,
    nativeBuildIdentifier: identity.nativeBuildIdentifier,
    nativeBuildSha256: identity.nativeBuildSha256,
    deviceClass: "physical",
    deviceModel: identity.deviceModel,
    deviceOsVersion: identity.deviceOsVersion,
    deviceIdentifierSha256: identity.deviceIdentifierSha256,
    requirementId: identity.requirementId,
    evidenceId: identity.evidenceId,
    integrityReceiptId: identity.integrityReceiptId,
    offlineScenario: identity.offlineScenario,
    restoreSha256,
    testResult,
    testerUid,
    testedAt,
  };
  const artifactSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(artifactSnapshot)),
  );
  const requestSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify({
      clientRequestId: identity.clientRequestId,
      artifactSha256,
    })),
  );
  const previous = await existingTestArtifact(
    database,
    member.organisationId,
    identity.clientRequestId,
  );
  if (previous) {
    if (previous.request_sha256 !== requestSha256) {
      fail(
        "FIELD_TEST_ARTIFACT_REQUEST_ID_CONFLICT",
        409,
        "This tester artifact request reference was already used for different immutable test evidence.",
      );
    }
    return {
      testArtifact: publicTestArtifact(previous, true),
    };
  }

  const id = crypto.randomUUID();
  const artifact: FieldTestArtifactRecord = {
    id,
    organisation_id: member.organisationId,
    client_request_id: identity.clientRequestId,
    request_sha256: requestSha256,
    artifact_sha256: artifactSha256,
    platform: identity.platform,
    native_build_identifier: identity.nativeBuildIdentifier,
    native_build_sha256: identity.nativeBuildSha256,
    device_class: "physical",
    device_model: identity.deviceModel,
    device_os_version: identity.deviceOsVersion,
    device_identifier_sha256: identity.deviceIdentifierSha256,
    requirement_id: identity.requirementId,
    evidence_id: identity.evidenceId,
    integrity_receipt_id: identity.integrityReceiptId,
    offline_scenario: identity.offlineScenario,
    restore_sha256: restoreSha256,
    test_result: testResult,
    tester_uid: testerUid,
    tested_at: testedAt,
    created_by_uid: member.uid,
    created_at: createdAt,
  };
  await database.batch([
    database.prepare(`INSERT INTO compliance_field_custody_test_artifacts (
        id, organisation_id, client_request_id, request_sha256,
        artifact_sha256, platform, native_build_identifier,
        native_build_sha256, device_class, device_model, device_os_version,
        device_identifier_sha256, requirement_id, evidence_id,
        integrity_receipt_id, offline_scenario, restore_sha256, test_result,
        tester_uid, tested_at, created_by_uid, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 'physical', ?, ?, ?, ?, ?, ?,
        'offline_capture_restore', ?, ?, ?, ?, ?, ?
      )`)
      .bind(
        id,
        member.organisationId,
        identity.clientRequestId,
        requestSha256,
        artifactSha256,
        identity.platform,
        identity.nativeBuildIdentifier,
        identity.nativeBuildSha256,
        identity.deviceModel,
        identity.deviceOsVersion,
        identity.deviceIdentifierSha256,
        identity.requirementId,
        identity.evidenceId,
        identity.integrityReceiptId,
        restoreSha256,
        testResult,
        testerUid,
        testedAt,
        member.uid,
        createdAt,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (
        ?, ?, 'compliance', ?, 'field_custody.test_artifact_appended',
        'compliance_field_custody_test_artifact', ?, ?, ?, ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        id,
        "Tester-authored physical field custody artifact recorded without an acceptance claim.",
        JSON.stringify({
          artifactSha256,
          testResult,
          platform: identity.platform,
          nativeBuildIdentifier: identity.nativeBuildIdentifier,
          deviceClass: "physical",
          requirementId: identity.requirementId,
          evidenceId: identity.evidenceId,
          integrityReceiptId: identity.integrityReceiptId,
          offlineScenario: identity.offlineScenario,
          testerUid,
          physicalCustodyAccepted: false,
        }),
        createdAt,
      ),
  ]);
  return {
    testArtifact: publicTestArtifact(artifact, false),
  };
}

export async function appendCreditexFieldCustodyAcceptance(
  database: D1Database,
  member: FieldAcceptanceMember,
  input: AppendCreditexFieldCustodyAcceptanceInput,
  options: { now?: string } = {},
) {
  requireWriter(member);
  const identity = cleanPhysicalTestIdentity(input);
  const restoreSha256 = cleanSha256(
    input.restoreSha256,
    "FIELD_ACCEPTANCE_RESTORE_HASH_INVALID",
    "Add the SHA-256 hash of the restored evidence bytes.",
    true,
  );
  const status = cleanStatus(input.status);
  const testArtifactId = String(input.testArtifactId || "").trim();
  if (testArtifactId) {
    cleanIdentifier(
      testArtifactId,
      "FIELD_ACCEPTANCE_TEST_ARTIFACT_INVALID",
      "Choose a valid tester-authored test artifact.",
    );
  }
  const testerUid = cleanText(
    input.testerUid,
    180,
    "FIELD_ACCEPTANCE_TESTER_INVALID",
    "Assign the physical-device tester.",
  );
  const independentApproverUid = cleanText(
    input.independentApproverUid,
    180,
    "FIELD_ACCEPTANCE_APPROVER_INVALID",
    "Assign the independent acceptance approver.",
  );
  if (testerUid === independentApproverUid) {
    fail(
      "FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
      409,
      "The physical-device tester and independent approver must be different people.",
    );
  }
  const testedAt = cleanTimestamp(
    input.testedAt,
    "FIELD_ACCEPTANCE_TESTED_AT_INVALID",
    "Add a valid physical test timestamp.",
  );
  const approvedAt = cleanTimestamp(
    input.approvedAt,
    "FIELD_ACCEPTANCE_APPROVED_AT_INVALID",
    "Add a valid independent approval timestamp.",
  );
  const createdAt = cleanCurrentTimestamp(options.now);
  requireTimestampNotAfter(
    testedAt,
    createdAt,
    "FIELD_ACCEPTANCE_TESTED_AT_FUTURE",
    "The physical test timestamp cannot be later than the acceptance creation time.",
  );
  requireTimestampNotAfter(
    approvedAt,
    createdAt,
    "FIELD_ACCEPTANCE_APPROVED_AT_FUTURE",
    "The independent approval timestamp cannot be later than the acceptance creation time.",
  );
  if (
    status === "not_run"
    && (restoreSha256 || testedAt || approvedAt || testArtifactId)
  ) {
    fail(
      "FIELD_ACCEPTANCE_NOT_RUN_INVALID",
      409,
      "A not-run acceptance record cannot contain test or approval results.",
    );
  }
  if (
    status !== "not_run"
    && (!restoreSha256 || !testedAt || !testArtifactId)
  ) {
    fail(
      "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
      409,
      "Every completed or blocked field custody result must bind the exact tester-authored artifact.",
    );
  }
  if (["blocked", "failed"].includes(status) && approvedAt) {
    fail(
      "FIELD_ACCEPTANCE_NON_DECISION_INVALID",
      409,
      "A blocked or failed test result cannot contain a governance decision time.",
    );
  }
  if (["passed", "rejected"].includes(status)) {
    requireGovernanceApprover(member);
  }
  if (
    ["passed", "rejected"].includes(status)
    && (
      !approvedAt
      || Date.parse(approvedAt) < Date.parse(testedAt)
      || member.uid !== independentApproverUid
    )
  ) {
    fail(
      "FIELD_ACCEPTANCE_DECISION_INVALID",
      409,
      "Only the assigned governance-verified administrator can record a complete independent field custody decision.",
    );
  }
  if (
    status !== "not_run"
    && member.uid !== testerUid
    && member.uid !== independentApproverUid
  ) {
    fail(
      "FIELD_ACCEPTANCE_ACTOR_INVALID",
      403,
      "Only the assigned tester or independent approver can record a test result.",
    );
  }

  const links = await linkedEvidence(
    database,
    member.organisationId,
    identity.requirementId,
    identity.evidenceId,
    identity.integrityReceiptId,
    testerUid,
    independentApproverUid,
  );
  if (
    status === "passed"
    && (
      links.receipt_result !== "matched"
      || links.receipt_expected_sha256 !== links.evidence_sha256
      || links.receipt_observed_sha256 !== links.evidence_sha256
      || restoreSha256 !== links.evidence_sha256
    )
  ) {
    fail(
      "FIELD_ACCEPTANCE_INTEGRITY_REQUIRED",
      409,
      "A passed physical field acceptance requires an exact matched integrity receipt and restored bytes hash.",
    );
  }

  let testArtifact: FieldTestArtifactRecord | null = null;
  if (status !== "not_run") {
    testArtifact = await testArtifactById(
      database,
      member.organisationId,
      testArtifactId,
    );
    if (
      !testArtifact
      || testArtifact.created_by_uid !== testerUid
      || testArtifact.tester_uid !== testerUid
      || testArtifact.platform !== identity.platform
      || testArtifact.native_build_identifier
        !== identity.nativeBuildIdentifier
      || testArtifact.native_build_sha256 !== identity.nativeBuildSha256
      || testArtifact.device_class !== "physical"
      || testArtifact.device_model !== identity.deviceModel
      || testArtifact.device_os_version !== identity.deviceOsVersion
      || testArtifact.device_identifier_sha256
        !== identity.deviceIdentifierSha256
      || testArtifact.requirement_id !== identity.requirementId
      || testArtifact.evidence_id !== identity.evidenceId
      || testArtifact.integrity_receipt_id !== identity.integrityReceiptId
      || testArtifact.offline_scenario !== identity.offlineScenario
      || testArtifact.restore_sha256 !== restoreSha256
      || testArtifact.tested_at !== testedAt
      || (status === "passed" && testArtifact.test_result !== "passed")
      || (status === "failed" && testArtifact.test_result !== "failed")
      || (
        ["passed", "rejected"].includes(status)
        && Date.parse(testArtifact.created_at) > Date.parse(approvedAt)
      )
    ) {
      fail(
        "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
        409,
        "This result requires the exact immutable test artifact authored earlier by the named tester.",
      );
    }
  }
  const testArtifactSha256 = testArtifact?.artifact_sha256 || "";
  const requestSnapshot = {
    platform: identity.platform,
    nativeBuildIdentifier: identity.nativeBuildIdentifier,
    nativeBuildSha256: identity.nativeBuildSha256,
    deviceClass: "physical",
    deviceModel: identity.deviceModel,
    deviceOsVersion: identity.deviceOsVersion,
    deviceIdentifierSha256: identity.deviceIdentifierSha256,
    requirementId: identity.requirementId,
    evidenceId: identity.evidenceId,
    integrityReceiptId: identity.integrityReceiptId,
    offlineScenario: identity.offlineScenario,
    restoreSha256,
    status,
    testArtifactId,
    testArtifactSha256,
    testerUid,
    independentApproverUid,
    testedAt,
    approvedAt,
  };
  const requestSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(requestSnapshot)),
  );
  const previous = await existingRecord(
    database,
    member.organisationId,
    identity.clientRequestId,
  );
  if (previous) {
    if (previous.request_sha256 !== requestSha256) {
      fail(
        "FIELD_ACCEPTANCE_REQUEST_ID_CONFLICT",
        409,
        "This field acceptance request reference was already used for a different immutable record.",
      );
    }
    return {
      acceptance: publicRecord(previous, true),
    };
  }

  const id = crypto.randomUUID();
  const record: FieldAcceptanceRecord = {
    id,
    organisation_id: member.organisationId,
    client_request_id: identity.clientRequestId,
    platform: identity.platform,
    native_build_identifier: identity.nativeBuildIdentifier,
    native_build_sha256: identity.nativeBuildSha256,
    device_class: "physical",
    device_model: identity.deviceModel,
    device_os_version: identity.deviceOsVersion,
    device_identifier_sha256: identity.deviceIdentifierSha256,
    requirement_id: identity.requirementId,
    evidence_id: identity.evidenceId,
    integrity_receipt_id: identity.integrityReceiptId,
    offline_scenario: identity.offlineScenario,
    restore_sha256: restoreSha256,
    status,
    test_artifact_id: testArtifactId,
    test_artifact_sha256: testArtifactSha256,
    tester_uid: testerUid,
    independent_approver_uid: independentApproverUid,
    tested_at: testedAt,
    approved_at: approvedAt,
    created_by_uid: member.uid,
    created_at: createdAt,
  };
  await database.batch([
    database.prepare(`INSERT INTO compliance_field_custody_acceptance_records (
        id, organisation_id, client_request_id, request_sha256, platform,
        native_build_identifier, native_build_sha256, device_class,
        device_model, device_os_version, device_identifier_sha256,
        requirement_id, evidence_id, integrity_receipt_id, offline_scenario,
        restore_sha256, status, test_artifact_id, test_artifact_sha256,
        tester_uid, independent_approver_uid, tested_at, approved_at,
        created_by_uid, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'physical', ?, ?, ?, ?, ?, ?,
        'offline_capture_restore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`)
      .bind(
        id,
        member.organisationId,
        identity.clientRequestId,
        requestSha256,
        identity.platform,
        identity.nativeBuildIdentifier,
        identity.nativeBuildSha256,
        identity.deviceModel,
        identity.deviceOsVersion,
        identity.deviceIdentifierSha256,
        identity.requirementId,
        identity.evidenceId,
        identity.integrityReceiptId,
        restoreSha256,
        status,
        testArtifactId,
        testArtifactSha256,
        testerUid,
        independentApproverUid,
        testedAt,
        approvedAt,
        member.uid,
        createdAt,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (
        ?, ?, 'compliance', ?, 'field_custody.acceptance_appended',
        'compliance_field_custody_acceptance_record', ?, ?, ?, ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        id,
        status === "passed"
          ? "Independently approved physical field custody acceptance recorded."
          : status === "rejected"
            ? "Independently rejected physical field custody acceptance recorded."
            : "Physical field custody acceptance record appended without a governance decision.",
        JSON.stringify({
          status,
          platform: identity.platform,
          nativeBuildIdentifier: identity.nativeBuildIdentifier,
          deviceClass: "physical",
          requirementId: identity.requirementId,
          evidenceId: identity.evidenceId,
          integrityReceiptId: identity.integrityReceiptId,
          offlineScenario: identity.offlineScenario,
          testArtifactId,
          testArtifactSha256,
          testerUid,
          independentApproverUid,
          physicalCustodyAccepted: status === "passed",
        }),
        createdAt,
      ),
  ]);
  return {
    acceptance: publicRecord(record, false),
  };
}

export async function appendCreditexFieldCustodyDecision(
  database: D1Database,
  member: FieldAcceptanceMember,
  input: AppendCreditexFieldCustodyDecisionInput,
  options: { now?: string } = {},
) {
  requireGovernanceApprover(member);
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const testArtifactId = cleanIdentifier(
    input.testArtifactId,
    "FIELD_ACCEPTANCE_TEST_ARTIFACT_INVALID",
    "Choose the exact tester-authored test artifact.",
  );
  const decision = cleanDecision(input.decision);
  const decidedAt = cleanTimestamp(
    input.decidedAt,
    "FIELD_ACCEPTANCE_DECIDED_AT_INVALID",
    "Add a valid governance decision timestamp.",
    false,
  );
  const currentAt = cleanCurrentTimestamp(options.now);
  requireTimestampNotAfter(
    decidedAt,
    currentAt,
    "FIELD_ACCEPTANCE_DECIDED_AT_FUTURE",
    "The governance decision timestamp cannot be in the future.",
  );

  const artifact = await testArtifactById(
    database,
    member.organisationId,
    testArtifactId,
  );
  if (!artifact) {
    fail(
      "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
      404,
      "The tester-authored field custody artifact was not found in this Creditex organisation.",
    );
  }
  if (
    artifact.created_by_uid !== artifact.tester_uid
    || artifact.tester_uid === member.uid
  ) {
    fail(
      "FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
      409,
      "The named tester cannot approve or reject their own field custody artifact.",
    );
  }

  return appendCreditexFieldCustodyAcceptance(
    database,
    member,
    {
      clientRequestId,
      platform: artifact.platform,
      nativeBuildIdentifier: artifact.native_build_identifier,
      nativeBuildSha256: artifact.native_build_sha256,
      deviceModel: artifact.device_model,
      deviceOsVersion: artifact.device_os_version,
      deviceIdentifierSha256: artifact.device_identifier_sha256,
      requirementId: artifact.requirement_id,
      evidenceId: artifact.evidence_id,
      integrityReceiptId: artifact.integrity_receipt_id,
      offlineScenario: artifact.offline_scenario,
      restoreSha256: artifact.restore_sha256,
      status: decision === "approved" ? "passed" : "rejected",
      testArtifactId: artifact.id,
      testerUid: artifact.tester_uid,
      independentApproverUid: member.uid,
      testedAt: artifact.tested_at,
      approvedAt: decidedAt,
    },
    { now: currentAt },
  );
}

export async function listCreditexFieldCustodyAcceptances(
  database: D1Database,
  member: FieldAcceptanceMember,
  evidenceIdValue?: unknown,
) {
  requireReader(member);
  const evidenceId = String(evidenceIdValue || "").trim();
  if (evidenceId) {
    cleanIdentifier(
      evidenceId,
      "FIELD_ACCEPTANCE_EVIDENCE_INVALID",
      "Choose a valid evidence record.",
    );
  }
  const result = evidenceId
    ? await database.prepare(`SELECT *
        FROM compliance_field_custody_acceptance_records
        WHERE organisation_id = ? AND evidence_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 100`)
      .bind(member.organisationId, evidenceId)
      .all<FieldAcceptanceRecord>()
    : await database.prepare(`SELECT *
        FROM compliance_field_custody_acceptance_records
        WHERE organisation_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 100`)
      .bind(member.organisationId)
      .all<FieldAcceptanceRecord>();
  return result.results.map((record) => publicRecord(record));
}
