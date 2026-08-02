import type { ComplianceIdentity } from "./compliance-access-server.ts";
import {
  manualEvidenceProgress,
  validateManualEvidenceFormSchema,
  validateManualEvidenceResponses,
} from "./creditex-manual-evidence-lab.ts";

export const CREDITEX_MANUAL_FIELD_ACCEPTANCE_CONTRACT =
  "creditex-manual-field-acceptance/v1";

type AcceptanceStatus =
  | "not_run"
  | "in_progress"
  | "submitted"
  | "passed"
  | "failed";

type AcceptanceRow = {
  id: string;
  organisation_id: string;
  job_id: string;
  tester_uid: string;
  reviewer_uid: string;
  device_id: string;
  platform: string;
  app_version: string;
  scenario_results: string;
  status: AcceptanceStatus;
  tester_note: string;
  reviewer_note: string;
  record_mode: string;
  started_at: string;
  submitted_at: string;
  reviewed_at: string;
  updated_at: string;
};

type CaptureRow = {
  id: string;
  field_code: string;
  device_id: string;
  object_key: string;
  original_sha256: string;
  size_bytes: number;
  metadata_state: string;
  gps_state: string;
  capture_time_state: string;
  physical_device_state: string;
  integrity_receipt_id: string;
  integrity_result: string;
  observed_sha256: string;
  observed_size_bytes: number;
};

type RestoreResult = {
  sha256: string;
  sizeBytes: number;
};

type RestoreObject = (
  objectKey: string,
) => Promise<RestoreResult | null>;

const REQUIRED_SCENARIOS = [
  "physical_device_capture",
  "offline_queue_resume",
  "multipart_upload_resume",
  "r2_original_restore",
] as const;

export class CreditexManualFieldAcceptanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexManualFieldAcceptanceError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexManualFieldAcceptanceError(code, status, message);
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
) {
  const cleaned = cleanText(value, 180, code, message);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(cleaned)) {
    fail(code, 400, message);
  }
  return cleaned;
}

function publicRun(row: AcceptanceRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    testerUid: row.tester_uid,
    reviewerUid: row.reviewer_uid,
    deviceId: row.device_id,
    platform: row.platform,
    appVersion: row.app_version,
    scenarioResults: JSON.parse(row.scenario_results) as unknown[],
    status: row.status,
    testerNote: row.tester_note,
    reviewerNote: row.reviewer_note,
    recordMode: "synthetic_test" as const,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
    physicalCustodyAccepted: row.status === "passed",
    acceptanceBasis:
      "named_tester_independent_creditex_review_and_server_r2_restore" as const,
    deviceAttestation: "not_available" as const,
  };
}

function scenarioInput(value: unknown) {
  if (!Array.isArray(value)) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_SCENARIOS_REQUIRED",
      400,
      "Record every required physical-device acceptance scenario.",
    );
  }
  const results = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_SCENARIO_INVALID",
        400,
        "Enter valid physical-device scenario results.",
      );
    }
    const record = entry as Record<string, unknown>;
    const scenario = cleanIdentifier(
      record.scenario,
      "MANUAL_FIELD_ACCEPTANCE_SCENARIO_INVALID",
      "Choose a supported physical-device scenario.",
    );
    if (!REQUIRED_SCENARIOS.includes(
      scenario as typeof REQUIRED_SCENARIOS[number],
    )) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_SCENARIO_INVALID",
        400,
        "Choose a supported physical-device scenario.",
      );
    }
    const outcome = String(record.outcome || "").trim();
    if (!["passed", "failed"].includes(outcome)) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_SCENARIO_INVALID",
        400,
        "Mark each physical-device scenario passed or failed.",
      );
    }
    const note = String(record.note || "").trim();
    if (
      note.length > 1_000
      || /[\u0000-\u001f\u007f]/.test(note)
    ) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_SCENARIO_INVALID",
        400,
        "Keep each physical-device scenario note within 1,000 characters.",
      );
    }
    return {
      scenario,
      outcome,
      note,
      authority: "named_tester_observation" as const,
    };
  });
  if (
    results.length !== REQUIRED_SCENARIOS.length
    || new Set(results.map(({ scenario }) => scenario)).size
      !== REQUIRED_SCENARIOS.length
    || REQUIRED_SCENARIOS.some(
      (scenario) => !results.some((result) => result.scenario === scenario),
    )
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_SCENARIOS_INCOMPLETE",
      409,
      "Complete each required physical-device scenario exactly once.",
    );
  }
  return REQUIRED_SCENARIOS.map((scenario) =>
    results.find((result) => result.scenario === scenario)!
  );
}

function storedTesterScenarioJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "";
    const testerResults = parsed.filter((entry) =>
      entry
      && typeof entry === "object"
      && !Array.isArray(entry)
      && REQUIRED_SCENARIOS.includes(
        String((entry as Record<string, unknown>).scenario) as
          (typeof REQUIRED_SCENARIOS)[number],
      )
    );
    if (
      testerResults.length !== REQUIRED_SCENARIOS.length
      || new Set(testerResults.map((entry) =>
        String((entry as Record<string, unknown>).scenario)
      )).size !== REQUIRED_SCENARIOS.length
    ) return "";
    return JSON.stringify(REQUIRED_SCENARIOS.map((scenario) => {
      const entry = testerResults.find((candidate) =>
        (candidate as Record<string, unknown>).scenario === scenario
      ) as Record<string, unknown>;
      return {
        scenario,
        outcome: String(entry.outcome || ""),
        note: String(entry.note || ""),
        authority: String(entry.authority || ""),
      };
    }));
  } catch {
    return "";
  }
}

async function acceptanceRow(
  database: D1Database,
  organisationId: string,
  runId: string,
) {
  const row = await database.prepare(`SELECT *
    FROM compliance_manual_field_acceptance_runs
    WHERE id = ? AND organisation_id = ? AND record_mode = 'synthetic_test'
    LIMIT 1`)
    .bind(runId, organisationId)
    .first<AcceptanceRow>();
  if (!row) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_NOT_FOUND",
      404,
      "The synthetic physical-device acceptance run was not found.",
    );
  }
  return row;
}

export async function listManualFieldAcceptanceRuns(
  database: D1Database,
  member: ComplianceIdentity,
  jobIdValue: unknown = "",
) {
  const jobId = String(jobIdValue || "").trim();
  const where = [
    "organisation_id = ?",
    "record_mode = 'synthetic_test'",
  ];
  const bindings: unknown[] = [member.organisationId];
  if (jobId) {
    where.push("job_id = ?");
    bindings.push(cleanIdentifier(
      jobId,
      "MANUAL_FIELD_ACCEPTANCE_JOB_INVALID",
      "Choose a valid synthetic manual job.",
    ));
  }
  const rows = await database.prepare(`SELECT *
    FROM compliance_manual_field_acceptance_runs
    WHERE ${where.join(" AND ")}
    ORDER BY updated_at DESC, id DESC
    LIMIT 500`)
    .bind(...bindings)
    .all<AcceptanceRow>();
  return {
    contract: CREDITEX_MANUAL_FIELD_ACCEPTANCE_CONTRACT,
    runs: rows.results.map(publicRun),
    boundaries: {
      recordMode: "synthetic_test" as const,
      regulatoryAcceptance: "not_assessed" as const,
      deviceAttestation: "not_available" as const,
      externalSubmissionEnabled: false,
    },
  };
}

export async function submitManualFieldAcceptanceRun(
  database: D1Database,
  member: ComplianceIdentity,
  input: Record<string, unknown>,
  restoreObject: RestoreObject,
  options: { now?: string } = {},
) {
  const runId = cleanIdentifier(
    input.clientRequestId,
    "MANUAL_FIELD_ACCEPTANCE_REQUEST_ID_INVALID",
    "Add a stable acceptance request reference.",
  );
  const jobId = cleanIdentifier(
    input.jobId,
    "MANUAL_FIELD_ACCEPTANCE_JOB_INVALID",
    "Choose a valid synthetic manual job.",
  );
  const deviceId = cleanIdentifier(
    input.deviceId,
    "MANUAL_FIELD_ACCEPTANCE_DEVICE_INVALID",
    "Choose the physical AEA Field device used for this test.",
  );
  const testerNote = cleanText(
    input.testerNote,
    2_000,
    "MANUAL_FIELD_ACCEPTANCE_TESTER_NOTE_REQUIRED",
    "Record what the named tester exercised on the physical device.",
  );
  if (testerNote.length < 10) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_TESTER_NOTE_REQUIRED",
      400,
      "The tester note must contain at least 10 characters.",
    );
  }
  const testerScenarios = scenarioInput(input.scenarioResults);
  const existing = await database.prepare(`SELECT *
    FROM compliance_manual_field_acceptance_runs
    WHERE id = ? AND organisation_id = ? LIMIT 1`)
    .bind(runId, member.organisationId)
    .first<AcceptanceRow>();
  const device = await database.prepare(`SELECT
      platform, app_version, is_physical_device, status
    FROM compliance_manual_field_devices
    WHERE organisation_id = ? AND firebase_uid = ? AND device_id = ?
    LIMIT 1`)
    .bind(member.organisationId, member.uid, deviceId)
    .first<{
      platform: string;
      app_version: string;
      is_physical_device: number;
      status: string;
    }>();
  if (
    !device
    || device.status !== "active"
    || Number(device.is_physical_device) !== 1
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_PHYSICAL_DEVICE_REQUIRED",
      409,
      "Submit this acceptance from the active physical AEA Field device that captured the evidence.",
    );
  }
  const requestPlatform = input.platform === undefined
    ? device.platform
    : cleanText(
      input.platform,
      20,
      "MANUAL_FIELD_ACCEPTANCE_PLATFORM_INVALID",
      "Record the AEA Field platform used for this physical run.",
    );
  const requestAppVersion = input.appVersion === undefined
    ? device.app_version
    : cleanText(
      input.appVersion,
      40,
      "MANUAL_FIELD_ACCEPTANCE_APP_VERSION_INVALID",
      "Record the AEA Field app version used for this physical run.",
    );
  const testerScenarioJson = JSON.stringify(testerScenarios);
  if (existing) {
    if (
      existing.job_id !== jobId
      || existing.tester_uid !== member.uid
      || existing.device_id !== deviceId
      || existing.platform !== requestPlatform
      || existing.app_version !== requestAppVersion
      || existing.tester_note !== testerNote
      || storedTesterScenarioJson(existing.scenario_results)
        !== testerScenarioJson
    ) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_REQUEST_ID_CONFLICT",
        409,
        "That acceptance request reference is already bound to different physical-run contents.",
      );
    }
    return { run: publicRun(existing), reused: true };
  }
  if (
    requestPlatform !== device.platform
    || requestAppVersion !== device.app_version
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_DEVICE_VERSION_MISMATCH",
      409,
      "The submitted platform and app version must match the registered physical AEA Field device.",
    );
  }

  const job = await database.prepare(`SELECT
      id, field_tester_uid, form_schema, response_snapshot, record_mode
    FROM compliance_manual_evidence_test_jobs
    WHERE id = ? AND organisation_id = ?
      AND record_mode = 'synthetic_test'
      AND status NOT IN ('passed', 'archived')
    LIMIT 1`)
    .bind(jobId, member.organisationId)
    .first<{
      id: string;
      field_tester_uid: string;
      form_schema: string;
      response_snapshot: string;
      record_mode: string;
    }>();
  if (!job || job.field_tester_uid !== member.uid) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_TESTER_INVALID",
      403,
      "Only the field tester assigned to this synthetic job can submit its physical run.",
    );
  }
  const schema = validateManualEvidenceFormSchema(JSON.parse(job.form_schema));
  const responses = validateManualEvidenceResponses(
    schema.fields,
    JSON.parse(job.response_snapshot),
  );
  if (!manualEvidenceProgress(schema.fields, responses).readyForAudit) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_EVIDENCE_INCOMPLETE",
      409,
      "Complete every required locked prompt with server-verified physical-device evidence first.",
    );
  }
  const captureResult = await database.prepare(`SELECT
      capture.id,
      capture.field_code,
      capture.device_id,
      capture.object_key,
      capture.original_sha256,
      capture.size_bytes,
      capture.metadata_state,
      capture.gps_state,
      capture.capture_time_state,
      capture.physical_device_state,
      receipt.id integrity_receipt_id,
      receipt.result integrity_result,
      receipt.observed_sha256,
      receipt.observed_size_bytes
    FROM compliance_manual_evidence_test_captures capture
    JOIN compliance_manual_field_integrity_receipts receipt
      ON receipt.capture_id = capture.id
      AND receipt.organisation_id = capture.organisation_id
    WHERE capture.organisation_id = ?
      AND capture.job_id = ?
      AND capture.field_tester_uid = ?
      AND capture.device_id = ?
      AND capture.record_mode = 'synthetic_test'
      AND capture.status = 'captured'
    ORDER BY capture.created_at, capture.id`)
    .bind(member.organisationId, jobId, member.uid, deviceId)
    .all<CaptureRow>();
  const captures = captureResult.results;
  const responseCaptures = responses.flatMap((response) =>
    response.captures.map((capture) => ({
      fieldCode: response.fieldCode,
      captureId: capture.captureId,
    }))
  );
  const responseCaptureIds = responseCaptures.map(
    ({ captureId }) => captureId,
  );
  const captureById = new Map(
    captures.map((capture) => [capture.id, capture]),
  );
  if (
    !responseCaptureIds.length
    || new Set(responseCaptureIds).size !== responseCaptureIds.length
    || responseCaptures.some(({ fieldCode, captureId }) => {
      const capture = captureById.get(captureId);
      const field = schema.fields.find(
        (candidate) => candidate.fieldCode === fieldCode,
      );
      return !capture
        || !field
        || capture.field_code !== fieldCode
        || (field.metadataRequired && capture.metadata_state !== "verified")
        || (field.gpsRequired && capture.gps_state !== "verified")
        || (
          field.fieldType === "photo"
          && capture.capture_time_state !== "verified"
        )
        || capture.physical_device_state !== "reported_physical"
        || capture.integrity_result !== "matched"
        || capture.observed_sha256 !== capture.original_sha256
        || Number(capture.observed_size_bytes)
          !== Number(capture.size_bytes);
    })
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_CAPTURE_LINK_INVALID",
      409,
      "Every locked file response must bind one matching, retained, server-verified physical-device capture.",
    );
  }
  const restoredCaptures = [];
  for (const captureId of responseCaptureIds) {
    const capture = captureById.get(captureId);
    if (!capture) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_CAPTURE_LINK_INVALID",
        409,
        "Every locked file response must bind one matching, retained, server-verified physical-device capture.",
      );
    }
    const restored = await restoreObject(capture.object_key);
    if (
      !restored
      || restored.sha256 !== capture.original_sha256
      || restored.sizeBytes !== Number(capture.size_bytes)
    ) {
      fail(
        "MANUAL_FIELD_ACCEPTANCE_RESTORE_FAILED",
        409,
        "The original evidence object could not be restored with its exact retained hash and size.",
      );
    }
    restoredCaptures.push({
      captureId: capture.id,
      fieldCode: capture.field_code,
      integrityReceiptId: capture.integrity_receipt_id,
      originalSha256: capture.original_sha256,
      restoredSha256: restored.sha256,
      sizeBytes: restored.sizeBytes,
      metadataState: capture.metadata_state,
      gpsState: capture.gps_state,
      captureTimeState: capture.capture_time_state,
      physicalDeviceState: capture.physical_device_state,
      authority: "server_restored_r2_object" as const,
    });
  }
  const now = options.now || new Date().toISOString();
  const scenarioResults = [
    ...testerScenarios,
    {
      scenario: "server_r2_restore",
      outcome: "passed",
      authority: "server_restored_r2_object",
      captures: restoredCaptures,
    },
  ];
  await database.batch([
    database.prepare(`INSERT INTO compliance_manual_field_acceptance_runs (
        id, organisation_id, job_id, tester_uid, reviewer_uid, device_id,
        platform, app_version, scenario_results, status, tester_note,
        reviewer_note, record_mode, started_at, submitted_at, reviewed_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, '', ?, ?, ?, ?, 'submitted', ?, '',
        'synthetic_test', ?, ?, '', ?
      )`)
      .bind(
        runId,
        member.organisationId,
        jobId,
        member.uid,
        deviceId,
        requestPlatform,
        requestAppVersion,
        JSON.stringify(scenarioResults),
        testerNote,
        now,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (
        ?, ?, 'compliance', ?,
        'manual_field.acceptance_submitted',
        'compliance_manual_field_acceptance_run', ?,
        'Named physical-device tester submitted a synthetic custody run for independent review.',
        ?, ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        runId,
        JSON.stringify({
          jobId,
          deviceId,
          captureCount: restoredCaptures.length,
      recordMode: "synthetic_test",
      physicalCustodyAccepted: false,
      deviceAttestation: "not_available",
    }),
        now,
      ),
  ]);
  return {
    run: publicRun(
      await acceptanceRow(database, member.organisationId, runId),
    ),
    reused: false,
  };
}

export async function reviewManualFieldAcceptanceRun(
  database: D1Database,
  member: ComplianceIdentity,
  input: Record<string, unknown>,
  options: { now?: string } = {},
) {
  if (
    !member.governanceIdentityVerified
    || !["admin", "reviewer"].includes(member.role)
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_REVIEW_FORBIDDEN",
      403,
      "A governance-verified Creditex administrator or reviewer must decide this run.",
    );
  }
  const runId = cleanIdentifier(
    input.runId,
    "MANUAL_FIELD_ACCEPTANCE_RUN_INVALID",
    "Choose the submitted physical-device acceptance run.",
  );
  const decision = String(input.decision || "").trim();
  if (!["passed", "failed"].includes(decision)) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_DECISION_INVALID",
      400,
      "Approve or fail the submitted physical-device acceptance run.",
    );
  }
  const reviewerNote = cleanText(
    input.reviewerNote,
    2_000,
    "MANUAL_FIELD_ACCEPTANCE_REVIEW_NOTE_REQUIRED",
    "Record the independent review decision.",
  );
  if (reviewerNote.length < 10) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_REVIEW_NOTE_REQUIRED",
      400,
      "The independent review note must contain at least 10 characters.",
    );
  }
  const row = await acceptanceRow(database, member.organisationId, runId);
  if (row.status !== "submitted") {
    if (
      row.status === decision
      && row.reviewer_uid === member.uid
      && row.reviewer_note === reviewerNote
    ) {
      return {
        run: publicRun(row),
        reused: true,
      };
    }
    fail(
      "MANUAL_FIELD_ACCEPTANCE_STATE_CONFLICT",
      409,
      "Only a submitted physical-device run can be independently decided.",
    );
  }
  if (row.tester_uid === member.uid) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
      409,
      "The named physical-device tester cannot review their own run.",
    );
  }
  const results = JSON.parse(row.scenario_results) as Array<{
    scenario?: string;
    outcome?: string;
    authority?: string;
  }>;
  if (
    decision === "passed"
    && (
      results.length !== REQUIRED_SCENARIOS.length + 1
      || results.some((result) => result.outcome !== "passed")
      || !results.some(
        (result) =>
          result.scenario === "server_r2_restore"
          && result.authority === "server_restored_r2_object",
      )
    )
  ) {
    fail(
      "MANUAL_FIELD_ACCEPTANCE_PASS_INVALID",
      409,
      "A physical-device run cannot pass while any tester or server scenario failed.",
    );
  }
  const now = options.now || new Date().toISOString();
  const auditEventId = crypto.randomUUID();
  const batchResults = await database.batch([
    database.prepare(`INSERT INTO compliance_audit_events (
      id, organisation_id, actor_type, actor_uid, event_type,
      target_type, target_id, summary, metadata, created_at
    ) SELECT ?, ?, 'compliance', ?,
      'manual_field.acceptance_reviewed',
      'compliance_manual_field_acceptance_run', ?, ?, ?, ?
    FROM compliance_manual_field_acceptance_runs run
    WHERE run.id = ? AND run.organisation_id = ?
      AND run.status = 'submitted' AND run.reviewer_uid = ''
      AND run.tester_uid <> ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_audit_events existing_event
        WHERE existing_event.organisation_id = ?
          AND existing_event.event_type = 'manual_field.acceptance_reviewed'
          AND existing_event.target_type =
            'compliance_manual_field_acceptance_run'
          AND existing_event.target_id = ?
      )`)
      .bind(
        auditEventId,
        member.organisationId,
        member.uid,
        runId,
        decision === "passed"
          ? "Independent reviewer approved the synthetic physical-device custody run."
          : "Independent reviewer failed the synthetic physical-device custody run.",
        JSON.stringify({
          jobId: row.job_id,
          decision,
          testerUid: row.tester_uid,
          reviewerUid: member.uid,
          physicalCustodyAccepted: decision === "passed",
          deviceAttestation: "not_available",
          recordMode: "synthetic_test",
        }),
        now,
        runId,
        member.organisationId,
        member.uid,
        member.organisationId,
        runId,
      ),
    database.prepare(`UPDATE compliance_manual_field_acceptance_runs
      SET status = ?, reviewer_uid = ?, reviewer_note = ?, reviewed_at = ?,
        updated_at = ?
      WHERE id = ? AND organisation_id = ? AND status = 'submitted'
        AND reviewer_uid = '' AND tester_uid <> ?
        AND EXISTS (
          SELECT 1 FROM compliance_audit_events event
          WHERE event.id = ? AND event.organisation_id = ?
            AND event.event_type = 'manual_field.acceptance_reviewed'
            AND event.target_type =
              'compliance_manual_field_acceptance_run'
            AND event.target_id = ?
        )`)
      .bind(
        decision,
        member.uid,
        reviewerNote,
        now,
        now,
        runId,
        member.organisationId,
        member.uid,
        auditEventId,
        member.organisationId,
        runId,
      ),
  ]);
  if (
    Number(batchResults[0]?.meta.changes || 0) !== 1
    || Number(batchResults[1]?.meta.changes || 0) !== 1
  ) {
    const authoritative = await acceptanceRow(
      database,
      member.organisationId,
      runId,
    );
    if (
      authoritative.status === decision
      && authoritative.reviewer_uid === member.uid
      && authoritative.reviewer_note === reviewerNote
    ) {
      return {
        run: publicRun(authoritative),
        reused: true,
      };
    }
    fail(
      "MANUAL_FIELD_ACCEPTANCE_STATE_CONFLICT",
      409,
      "The physical-device run changed before the decision completed.",
    );
  }
  return {
    run: publicRun(
      await acceptanceRow(database, member.organisationId, runId),
    ),
    reused: false,
  };
}
