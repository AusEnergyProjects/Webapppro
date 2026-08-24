import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import {
  assignedJob,
  requireInstallerTeamAccess,
  type TeamAccess,
} from "@/lib/trade-team-server";
import {
  guardedOnlineJobMutationBatch,
  jobSyncChangeStatements,
  nextJobRevision,
} from "@/lib/trade-team-sync-server";
import {
  RENTAL_ASSESSMENT_FINDING_SEVERITIES,
  RENTAL_ASSESSMENT_OUTCOMES,
  rentalAssessmentCheck,
  rentalAssessmentCompletion,
  rentalAssessmentItemKey,
} from "@/lib/trade-rental-assessment.mjs";
import { rentalEvidenceCapture, rentalEvidencePhotoCapture } from "@/lib/trade-rental-evidence.mjs";
import { currentRentalModuleCredentialSnapshot } from "@/lib/trade-rental-credentials";
import { ensureTradeRentalSchemaGuards } from "@/lib/trade-rental-schema-guards";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  issueRentalAssessmentReport,
  ownerRentalReportPresentation,
  renewRentalReportLink,
  revokeRentalReportLink,
} from "@/lib/trade-rental-report-server";

export const runtime = "edge";

type Row = Record<string, unknown>;
type InspectionContext = {
  access: TeamAccess;
  inspection: Row;
  job: Awaited<ReturnType<typeof assignedJob>>;
  workOrderId: string;
};

const OUTCOMES = new Set<string>(RENTAL_ASSESSMENT_OUTCOMES);
const FINDING_SEVERITIES = new Set<string>(RENTAL_ASSESSMENT_FINDING_SEVERITIES);
const TERMINAL_INSPECTION_STATUSES = new Set(["issuing", "issued", "superseded", "withdrawn"]);
const MAX_RESPONSE_JSON_BYTES = 12_000;
const MAX_RENTAL_REPORT_EVIDENCE_BYTES = 32 * 1024 * 1024;

function parsedObject(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

function parsedArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function integer(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function cleanBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function dateValue(value: unknown) {
  const text = cleanAdminText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function responseObject(value: unknown) {
  const source = parsedObject(value);
  const result: Row = {};
  const textFields = [
    "make", "model", "serialNumber", "measurement", "measurementUnit", "testMethod",
    "testInstrument", "testInstrumentSerial", "testResult", "acceptanceLimit", "actionTaken",
    "certificateNumber", "credentialNumber", "credentialType", "limitationReason", "exemptionBasis",
    "notificationRecipient", "notificationTime", "applianceType", "gasType", "manufactureDate",
    "certificationNumber", "ratedCurrent", "testCurrent", "tripTime", "circuitIdentifier",
  ];
  for (const key of textFields) {
    const text = cleanAdminText(source[key], 500);
    if (text) result[key] = text;
  }
  for (const key of ["credentialVerified", "responsiblePeopleNotified", "repairCompleted", "isolatedOrDisconnected"]) {
    if (source[key] !== undefined) result[key] = cleanBoolean(source[key]);
  }
  const json = JSON.stringify(result);
  if (new TextEncoder().encode(json).byteLength > MAX_RESPONSE_JSON_BYTES) throw new Error("RENTAL_RESPONSE_TOO_LARGE");
  return result;
}

function normaliseModuleAnswers(moduleTemplate: Row, value: unknown) {
  const source = parsedObject(value);
  const result: Row = {};
  for (const rawField of parsedArray(moduleTemplate.metadataFields)) {
    const field = parsedObject(rawField);
    const key = cleanAdminText(field.key, 80);
    const type = cleanAdminText(field.type, 20);
    if (!key) continue;
    if (type === "checkbox") {
      result[key] = cleanBoolean(source[key]);
      continue;
    }
    if (type === "date") {
      result[key] = dateValue(source[key]);
      continue;
    }
    if (type === "select") {
      const selected = cleanAdminText(source[key], 200);
      const options = parsedArray(field.options).map((option) => cleanAdminText(parsedObject(option).value, 200));
      result[key] = options.includes(selected) ? selected : "";
      continue;
    }
    result[key] = cleanAdminText(source[key], type === "textarea" ? 4000 : 500);
  }
  return result;
}

function inspectionError(error: unknown) {
  if (error instanceof BoundedJsonRequestError) {
    return adminJson({ ok: false, error: error.code === "REQUEST_TOO_LARGE"
      ? "The assessment request is too large."
      : "The assessment request is invalid." }, error.status);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Rental assessments are available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using rental assessments." }, 403);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active installer team access was found." }, 404);
  if (code === "JOB_NOT_FOUND" || code === "RENTAL_INSPECTION_NOT_FOUND") return adminJson({ ok: false, error: "Rental inspection not found." }, 404);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not assigned to your team account." }, 403);
  if (code === "FIELD_EVIDENCE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow assessment records." }, 403);
  if (code === "FIELD_EVIDENCE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow assessment changes." }, 403);
  if (code === "ASSESSOR_REQUIRED") return adminJson({ ok: false, error: "Only the assigned assessor can issue this report." }, 403);
  if (code === "RENTAL_MODULE_CREDENTIAL_REQUIRED") return adminJson({ ok: false, error: "The assigned assessor needs a current matching credential and supporting team document before this module can be completed." }, 409);
  if (code === "RENTAL_MODULE_CREDENTIAL_CHANGED") return adminJson({ ok: false, error: "The saved credential changed or expired. Reopen and complete the module again before issuing." }, 409);
  if (code === "REPORT_PERMISSION_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow issued reports." }, 403);
  if (code === "RENTAL_INSPECTION_LOCKED") return adminJson({ ok: false, error: "This issued assessment is locked and remains in the report history. Start a replacement assessment job if a correction is required." }, 409);
  if (code === "RENTAL_MODULE_NOT_FOUND" || code === "RENTAL_ITEM_NOT_FOUND") return adminJson({ ok: false, error: "The assessment item could not be found." }, 404);
  if (code === "RENTAL_MEDIA_MISMATCH") return adminJson({ ok: false, error: "That evidence file does not belong to this job." }, 409);
  if (code === "RENTAL_EVIDENCE_METADATA_REQUIRED") return adminJson({ ok: false, error: "Assessment photos must include a valid TLink capture time and GPS location. Retake the photo in the field app or add it from a location-enabled browser." }, 409);
  if (code === "RENTAL_FINDING_REQUIRED") return adminJson({ ok: false, error: "An adverse result needs a clear finding title, description, responsible trade and quote-ready scope before it can be saved." }, 400);
  if (code === "RENTAL_MUTATION_CONFLICT" || code === "ONLINE_MUTATION_CONFLICT") return adminJson({ ok: false, error: "This assessment changed on another device. Refresh before trying again." }, 409);
  if (code === "RENTAL_RESPONSE_TOO_LARGE") return adminJson({ ok: false, error: "The assessment response is too large." }, 413);
  if (code === "INVALID_RENTAL_ITEM_KEY") return adminJson({ ok: false, error: "The repeated assessment item is invalid." }, 400);
  if (code === "RENTAL_MODULES_INCOMPLETE") return adminJson({ ok: false, error: "Every selected module must pass its completion checks before the report can be issued." }, 409);
  if (code === "RENTAL_MODULE_SET_INVALID") return adminJson({ ok: false, error: "The attached assessment modules do not match the frozen job selection. Ask an administrator to repair the job before issuing." }, 409);
  if (code === "RENTAL_REPORT_ISSUE_CONFLICT") return adminJson({ ok: false, error: "The report changed while it was being issued. Refresh before trying again." }, 409);
  if (code === "RENTAL_REPORT_RECONCILIATION_REQUIRED") return adminJson({ ok: false, error: "The report issue result is being reconciled. Its immutable files were preserved. Refresh before trying again, and contact support if it remains in progress." }, 503);
  if (code === "RENTAL_REPORT_CLEANUP_REQUIRED") return adminJson({ ok: false, error: "A failed report is still clearing its private staged files. Retry shortly, and contact support if this message remains." }, 503);
  if (code === "RENTAL_REPORT_LINK_NOT_FOUND") return adminJson({ ok: false, error: "That report link was not found." }, 404);
  if (code === "RENTAL_REPORT_LINK_STOPPED") return adminJson({ ok: false, error: "That report link is no longer active." }, 409);
  if (code === "RENTAL_REPORT_LINK_CONFLICT") return adminJson({ ok: false, error: "The report link changed. Refresh before trying again." }, 409);
  if (code === "RENTAL_REPORT_STORAGE_UNAVAILABLE" || code === "ISSUED_PDF_STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Issued-report storage is not available." }, 503);
  if (code === "RENTAL_REPORT_EVIDENCE_UNAVAILABLE" || code === "RENTAL_REPORT_EVIDENCE_INTEGRITY") return adminJson({ ok: false, error: "One or more evidence files could not be verified. Replace the affected evidence before issuing." }, 409);
  if (code === "RENTAL_REPORT_EVIDENCE_TOO_LARGE" || code === "ISSUED_PDF_INVALID") return adminJson({ ok: false, error: "The complete evidence package is too large for one issued report. Reduce or compress the evidence files, then issue again." }, 413);
  if (code === "RENTAL_EVIDENCE_BUDGET_EXCEEDED") return adminJson({ ok: false, error: "This assessment has reached its 32 MB issued-report evidence limit. Compress or remove another file before linking this one." }, 413);
  console.error("Rental assessment API failure", error);
  return adminJson({ ok: false, error: "The rental assessment could not be completed." }, 500);
}

async function contextFor(access: TeamAccess, workOrderId: string): Promise<InspectionContext> {
  if (!workOrderId) throw new Error("RENTAL_INSPECTION_NOT_FOUND");
  await ensureTradeRentalSchemaGuards(getD1());
  const job = await assignedJob(access, workOrderId);
  const inspection = await getD1().prepare(`SELECT * FROM trade_rental_inspections
    WHERE work_order_id = ? AND firebase_uid = ? LIMIT 1`)
    .bind(workOrderId, access.ownerUid).first<Row>();
  if (!inspection) throw new Error("RENTAL_INSPECTION_NOT_FOUND");
  return { access, inspection, job, workOrderId };
}

function assertEditable(context: InspectionContext) {
  if (!context.access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
  if (TERMINAL_INSPECTION_STATUSES.has(String(context.inspection.status))) throw new Error("RENTAL_INSPECTION_LOCKED");
  if (["completed", "cancelled"].includes(String(context.job.stage))) throw new Error("RENTAL_INSPECTION_LOCKED");
}

function presentInspection(row: Row) {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    inspectionNumber: String(row.inspection_number),
    jurisdiction: String(row.jurisdiction),
    status: String(row.status),
    templateKey: String(row.template_key),
    templateVersion: integer(row.template_version),
    rulesEffectiveFrom: String(row.rules_effective_from),
    selectedModules: parsedArray(row.module_selection_snapshot).map(String),
    property: parsedObject(row.property_snapshot),
    assessor: parsedObject(row.assessor_snapshot),
    assessorMemberId: String(row.assessor_member_id || ""),
    revision: integer(row.revision),
    submittedAt: String(row.submitted_at || ""),
    issuedAt: String(row.issued_at || ""),
    issuedReportId: String(row.issued_report_id || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function presentModule(row: Row) {
  return {
    id: String(row.id),
    inspectionId: String(row.inspection_id),
    key: String(row.module_key),
    required: Boolean(row.required),
    status: String(row.status),
    templateVersion: integer(row.template_version),
    title: String(row.template_name),
    requiredCapability: String(row.required_capability),
    template: parsedObject(row.template_snapshot),
    answers: parsedObject(row.answers),
    credential: parsedObject(row.credential_snapshot),
    revision: integer(row.revision),
    completedByUid: String(row.completed_by_uid || ""),
    completedAt: String(row.completed_at || ""),
    updatedAt: String(row.updated_at),
  };
}

function presentItem(row: Row) {
  return {
    id: String(row.id),
    moduleId: String(row.module_id),
    itemKey: String(row.item_key),
    sectionKey: String(row.section_key),
    checkKey: String(row.check_key),
    instanceKey: String(row.instance_key),
    locationLabel: String(row.location_label || ""),
    outcome: String(row.outcome),
    response: parsedObject(row.response_json),
    publicNotes: String(row.public_notes || ""),
    internalNotes: String(row.internal_notes || ""),
    requiredEvidenceCount: integer(row.required_evidence_count),
    sortOrder: integer(row.sort_order),
    revision: integer(row.revision),
    completedAt: String(row.completed_at || ""),
    updatedAt: String(row.updated_at),
  };
}

function presentFinding(row: Row) {
  return {
    id: String(row.id),
    moduleId: String(row.module_id),
    itemId: String(row.item_id || ""),
    findingKey: String(row.finding_key),
    category: String(row.category),
    title: String(row.title),
    description: String(row.description || ""),
    standardReference: String(row.standard_reference || ""),
    status: String(row.finding_status),
    severity: String(row.severity),
    tradeCategory: String(row.trade_category || ""),
    locationLabel: String(row.location_label || ""),
    recommendedAction: String(row.recommended_action || ""),
    scopeSummary: String(row.scope_summary || ""),
    quantityMilli: integer(row.quantity_milli, 1000),
    unitLabel: String(row.unit_label || "each"),
    details: parsedObject(row.details),
    internalNotes: String(row.internal_notes || ""),
    sortOrder: integer(row.sort_order),
    revision: integer(row.revision),
    updatedAt: String(row.updated_at),
  };
}

function presentEvidence(row: Row) {
  const capture = rentalEvidenceCapture(row.evidence_envelope);
  return {
    id: String(row.id),
    moduleId: String(row.module_id),
    itemId: String(row.item_id || ""),
    findingId: String(row.finding_id || ""),
    jobMediaId: String(row.job_media_id),
    requirementKey: String(row.requirement_key),
    evidenceType: String(row.evidence_type),
    purpose: String(row.purpose || ""),
    caption: String(row.caption_snapshot || ""),
    status: String(row.status),
    fileName: String(row.file_name || ""),
    contentType: String(row.content_type || ""),
    sizeBytes: integer(row.size_bytes),
    capture,
    createdAt: String(row.created_at),
    previewUrl: `/api/trade-field-work?preview=${encodeURIComponent(String(row.job_media_id))}`,
    downloadUrl: `/api/trade-field-work?download=${encodeURIComponent(String(row.job_media_id))}`,
  };
}

async function assessmentPayload(context: InspectionContext, origin = "") {
  const db = getD1();
  const inspectionId = String(context.inspection.id);
  const [moduleRows, itemRows, findingRows, evidenceRows, reports] = await Promise.all([
    db.prepare(`SELECT * FROM trade_rental_inspection_modules
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY required DESC, created_at, id`)
      .bind(inspectionId, context.access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM trade_rental_inspection_items
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY sort_order, created_at, id`)
      .bind(inspectionId, context.access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM trade_rental_findings
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY sort_order, created_at, id`)
      .bind(inspectionId, context.access.ownerUid).all<Row>(),
    db.prepare(`SELECT evidence.*, media.file_name, media.content_type, media.size_bytes, media.evidence_envelope
      FROM trade_rental_evidence_links evidence
      JOIN trade_crm_job_media media ON media.id = evidence.job_media_id
        AND media.firebase_uid = evidence.firebase_uid
      WHERE evidence.inspection_id = ? AND evidence.firebase_uid = ?
      ORDER BY evidence.sort_order, evidence.created_at, evidence.id`)
      .bind(inspectionId, context.access.ownerUid).all<Row>(),
    ownerRentalReportPresentation({
      ownerUid: context.access.ownerUid,
      inspectionId,
      origin,
      includeSecret: context.access.canRunReports
        && (context.access.isOwner || context.access.memberId === String(context.inspection.assessor_member_id || "")),
    }),
  ]);
  const modules = moduleRows.results.map(presentModule);
  const items = itemRows.results.map(presentItem);
  const findings = findingRows.results.map(presentFinding);
  const evidence = evidenceRows.results.map(presentEvidence);
  const evidenceCounts = Object.fromEntries(items.map((item) => [
    item.id,
    evidence.filter((entry) => entry.itemId === item.id && entry.status === "active").length,
  ]));
  const usedEvidenceBytes = evidence
    .filter((entry) => entry.status === "active")
    .reduce((total, entry) => total + entry.sizeBytes, 0);
  const completion = Object.fromEntries(modules.map((module) => [module.id, rentalAssessmentCompletion({
    moduleTemplate: module.template,
    answers: module.answers,
    items: items.filter((item) => item.moduleId === module.id).map((item) => ({ ...item, responseJson: item.response })),
    findings: findings.filter((finding) => finding.moduleId === module.id),
    evidenceCounts,
  })]));
  return {
    inspection: presentInspection(context.inspection),
    modules,
    items,
    findings,
    evidence,
    evidenceCounts,
    evidenceBudget: {
      usedBytes: usedEvidenceBytes,
      maxBytes: MAX_RENTAL_REPORT_EVIDENCE_BYTES,
      remainingBytes: Math.max(0, MAX_RENTAL_REPORT_EVIDENCE_BYTES - usedEvidenceBytes),
    },
    completion,
    reports,
    permissions: {
      canEdit: context.access.canManageFieldEvidence && !TERMINAL_INSPECTION_STATUSES.has(String(context.inspection.status)),
      canIssue: context.access.memberId === String(context.inspection.assessor_member_id || "")
        && context.access.memberId === String(context.job.assignee_member_id || "")
        && context.access.canRunReports
        && !TERMINAL_INSPECTION_STATUSES.has(String(context.inspection.status)),
      canRevokeLink: context.access.canRunReports
        && (context.access.isOwner || (
          context.access.memberId === String(context.inspection.assessor_member_id || "")
          && context.access.memberId === String(context.job.assignee_member_id || "")
        )),
      isAssignedAssessor: context.access.memberId === String(context.inspection.assessor_member_id || "")
        && context.access.memberId === String(context.job.assignee_member_id || ""),
    },
  };
}

async function moduleRow(context: InspectionContext, moduleId: string) {
  const row = await getD1().prepare(`SELECT * FROM trade_rental_inspection_modules
    WHERE id = ? AND inspection_id = ? AND firebase_uid = ?`)
    .bind(moduleId, context.inspection.id, context.access.ownerUid).first<Row>();
  if (!row) throw new Error("RENTAL_MODULE_NOT_FOUND");
  return row;
}

async function guardedMutation(input: {
  context: InspectionContext;
  primary: D1PreparedStatement;
  additional?: D1PreparedStatement[];
  successPredicate: string;
  successBindings: unknown[];
  eventType: string;
  summary: string;
  metadata?: Row;
}) {
  const { context } = input;
  const db = getD1();
  const now = new Date().toISOString();
  const nextInspectionRevision = integer(context.inspection.revision) + 1;
  const nextWorkRevision = nextJobRevision(context.job.revision);
  const inspectionId = String(context.inspection.id);
  const jobStage = String(context.job.stage);
  const statements = [
    input.primary,
    ...(input.additional || []),
    db.prepare(`UPDATE trade_rental_inspections
      SET status = CASE WHEN status IN ('draft', 'scheduled') THEN 'in_progress' ELSE status END,
        revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?
        AND status NOT IN ('issued', 'superseded', 'withdrawn')
        AND (${input.successPredicate})`)
      .bind(nextInspectionRevision, now, inspectionId, context.access.ownerUid,
        integer(context.inspection.revision), ...input.successBindings),
    db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
        AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?
        AND EXISTS (SELECT 1 FROM trade_rental_inspections inspection
          WHERE inspection.id = ? AND inspection.firebase_uid = ?
            AND inspection.revision = ? AND inspection.updated_at = ?)`)
      .bind(nextWorkRevision, now, context.workOrderId, context.access.ownerUid,
        jobStage, integer(context.job.revision), inspectionId, context.access.ownerUid,
        nextInspectionRevision, now),
    db.prepare(`INSERT INTO trade_rental_inspection_events
      (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
       event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
      SELECT ?, ?, '', '', ?, ?, ?, ?, '', ?, ?, '', '', ?
      WHERE EXISTS (SELECT 1 FROM trade_rental_inspections inspection
        WHERE inspection.id = ? AND inspection.firebase_uid = ?
          AND inspection.revision = ? AND inspection.updated_at = ?)`)
      .bind(crypto.randomUUID(), inspectionId, context.access.ownerUid,
        context.access.isOwner ? "owner" : "assessor", context.access.actorUid,
        input.eventType, input.summary, JSON.stringify(input.metadata || {}), now,
        inspectionId, context.access.ownerUid, nextInspectionRevision, now),
    ...jobSyncChangeStatements(db, {
      ownerUid: context.access.ownerUid,
      workOrderId: context.workOrderId,
      revision: nextWorkRevision,
      changedAt: now,
      audienceMemberId: context.job.assignee_member_id,
    }),
  ];
  try {
    await guardedOnlineJobMutationBatch(db, statements, {
      kind: "stage",
      jobRevision: nextWorkRevision,
      jobStage,
      ownerUid: context.access.ownerUid,
      updatedAt: now,
      workOrderId: context.workOrderId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ONLINE_MUTATION_CONFLICT") throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint") || message.includes("constraint failed")) throw new Error("RENTAL_MUTATION_CONFLICT");
    throw error;
  }
  return await contextFor(context.access, context.workOrderId);
}

async function saveModuleAnswers(context: InspectionContext, body: Row) {
  assertEditable(context);
  const moduleId = cleanAdminText(body.moduleId, 180);
  const assessmentModule = await moduleRow(context, moduleId);
  const expectedRevision = integer(body.expectedRevision);
  if (expectedRevision !== integer(assessmentModule.revision)) throw new Error("RENTAL_MUTATION_CONFLICT");
  const template = parsedObject(assessmentModule.template_snapshot);
  const answers = normaliseModuleAnswers(template, body.answers);
  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;
  return await guardedMutation({
    context,
    primary: getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET answers = ?, credential_snapshot = '{}', status = 'draft', revision = ?, completed_by_uid = '', completed_at = '', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?
        AND status IN ('not_started', 'draft')`)
      .bind(JSON.stringify(answers), nextRevision, now, moduleId, context.inspection.id,
        context.access.ownerUid, expectedRevision),
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_inspection_modules module
      WHERE module.id = ? AND module.inspection_id = trade_rental_inspections.id
        AND module.firebase_uid = trade_rental_inspections.firebase_uid
        AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [moduleId, nextRevision, now],
    eventType: "module_details_saved",
    summary: `${String(assessmentModule.template_name)} details saved.`,
    metadata: { moduleId, moduleKey: String(assessmentModule.module_key), revision: nextRevision },
  });
}

function findingInput(body: Row, outcome: string, itemKey: string, locationLabel: string) {
  const source = parsedObject(body.finding);
  const title = cleanAdminText(source.title, 240);
  const description = cleanAdminText(source.description, 8000);
  const tradeCategory = cleanAdminText(source.tradeCategory, 120);
  const scopeSummary = cleanAdminText(source.scopeSummary, 8000);
  if (!title || !description || !tradeCategory || !scopeSummary) throw new Error("RENTAL_FINDING_REQUIRED");
  const requestedSeverity = cleanAdminText(source.severity, 40);
  const severity = FINDING_SEVERITIES.has(requestedSeverity) ? requestedSeverity : "required";
  const detailsSource = parsedObject(source.details);
  const details = {
    immediateAction: cleanAdminText(detailsSource.immediateAction, 2000),
    responsiblePeopleNotified: cleanBoolean(detailsSource.responsiblePeopleNotified),
    notificationRecipient: cleanAdminText(detailsSource.notificationRecipient, 500),
    notificationTime: cleanAdminText(detailsSource.notificationTime, 100),
  };
  return {
    findingKey: `finding:${itemKey}`,
    title,
    description,
    standardReference: cleanAdminText(source.standardReference, 500),
    status: severity === "immediate_safety_risk" ? "safety_issue"
      : outcome === "does_not_meet" ? "non_compliant" : "not_tested",
    severity,
    tradeCategory,
    locationLabel,
    recommendedAction: cleanAdminText(source.recommendedAction, 4000),
    scopeSummary,
    quantityMilli: Math.min(1_000_000_000, Math.max(0, integer(source.quantityMilli, 1000))),
    unitLabel: cleanAdminText(source.unitLabel, 40) || "each",
    details,
    internalNotes: cleanAdminText(source.internalNotes, 4000),
  };
}

async function saveItem(context: InspectionContext, body: Row) {
  assertEditable(context);
  const moduleId = cleanAdminText(body.moduleId, 180);
  const assessmentModule = await moduleRow(context, moduleId);
  if (!["not_started", "draft"].includes(String(assessmentModule.status))) throw new Error("RENTAL_MUTATION_CONFLICT");
  const expectedModuleRevision = integer(body.expectedModuleRevision);
  if (expectedModuleRevision !== integer(assessmentModule.revision)) throw new Error("RENTAL_MUTATION_CONFLICT");
  const sectionKey = cleanAdminText(body.sectionKey, 120);
  const checkKey = cleanAdminText(body.checkKey, 120);
  const template = parsedObject(assessmentModule.template_snapshot);
  const located = rentalAssessmentCheck(template, sectionKey, checkKey);
  if (!located) return adminJson({ ok: false, error: "Choose a valid assessment check." }, 400);
  const assessmentCheck = parsedObject(located.check);
  const repeated = String(assessmentCheck.repeatBy || "property") !== "property";
  const instanceKey = repeated ? cleanAdminText(body.instanceKey, 120) : "property";
  const locationLabel = cleanAdminText(body.locationLabel, 300);
  if (repeated && (!instanceKey || !locationLabel)) {
    return adminJson({ ok: false, error: "Add a clear location for this repeated assessment item." }, 400);
  }
  const itemKey = rentalAssessmentItemKey(String(assessmentModule.module_key), sectionKey, checkKey, instanceKey);
  const outcome = cleanAdminText(body.outcome, 60);
  if (!OUTCOMES.has(outcome)) return adminJson({ ok: false, error: "Choose an assessment result." }, 400);
  const response = responseObject(body.response);
  const publicNotes = cleanAdminText(body.publicNotes, 4000);
  const internalNotes = cleanAdminText(body.internalNotes, 4000);
  if (outcome === "not_applicable" && !publicNotes) {
    return adminJson({ ok: false, error: "Explain in the public report why this check is not applicable." }, 400);
  }
  const existing = await getD1().prepare(`SELECT id, revision FROM trade_rental_inspection_items
    WHERE inspection_id = ? AND item_key = ? AND firebase_uid = ?`)
    .bind(context.inspection.id, itemKey, context.access.ownerUid).first<Row>();
  const expectedItemRevision = integer(body.expectedItemRevision);
  if ((existing && expectedItemRevision !== integer(existing.revision)) || (!existing && expectedItemRevision !== 0)) {
    throw new Error("RENTAL_MUTATION_CONFLICT");
  }
  const itemId = existing ? String(existing.id) : crypto.randomUUID();
  const now = new Date().toISOString();
  const nextItemRevision = expectedItemRevision + 1;
  const nextModuleRevision = expectedModuleRevision + 1;
  const requiredEvidenceCount = Math.min(20, Math.max(0, integer(assessmentCheck.requiredEvidenceCount, 0)));
  const sortOrder = Math.min(10_000, Math.max(0, integer(body.sortOrder, 0)));
  const primary = existing
    ? getD1().prepare(`UPDATE trade_rental_inspection_items SET location_label = ?, outcome = ?, response_json = ?,
        public_notes = ?, internal_notes = ?, required_evidence_count = ?, sort_order = ?, revision = ?,
        completed_by_uid = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND inspection_id = ? AND module_id = ? AND firebase_uid = ? AND revision = ?`)
      .bind(locationLabel, outcome, JSON.stringify(response), publicNotes, internalNotes,
        requiredEvidenceCount, sortOrder, nextItemRevision, context.access.actorUid, now, now,
        itemId, context.inspection.id, moduleId, context.access.ownerUid, expectedItemRevision)
    : getD1().prepare(`INSERT INTO trade_rental_inspection_items
        (id, inspection_id, module_id, firebase_uid, item_key, section_key, check_key, instance_key,
         location_label, outcome, response_json, public_notes, internal_notes, required_evidence_count,
         sort_order, revision, completed_by_uid, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(itemId, context.inspection.id, moduleId, context.access.ownerUid, itemKey, sectionKey,
        checkKey, instanceKey, locationLabel, outcome, JSON.stringify(response), publicNotes,
        internalNotes, requiredEvidenceCount, sortOrder, context.access.actorUid, now, now, now);
  const additional: D1PreparedStatement[] = [
    getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET status = 'draft', credential_snapshot = '{}', revision = ?, completed_by_uid = '', completed_at = '', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?
        AND status IN ('not_started', 'draft')
        AND EXISTS (SELECT 1 FROM trade_rental_inspection_items item
          WHERE item.id = ? AND item.inspection_id = trade_rental_inspection_modules.inspection_id
            AND item.module_id = trade_rental_inspection_modules.id AND item.firebase_uid = trade_rental_inspection_modules.firebase_uid
            AND item.revision = ? AND item.updated_at = ?)`)
      .bind(nextModuleRevision, now, moduleId, context.inspection.id, context.access.ownerUid,
        expectedModuleRevision, itemId, nextItemRevision, now),
  ];
  const adverse = ["does_not_meet", "specialist_verification_required", "not_accessible", "exemption_evidence_pending"].includes(outcome);
  const existingFinding = await getD1().prepare(`SELECT id, revision FROM trade_rental_findings
    WHERE inspection_id = ? AND finding_key = ? AND firebase_uid = ?`)
    .bind(context.inspection.id, `finding:${itemKey}`, context.access.ownerUid).first<Row>();
  const finding = adverse ? findingInput(body, outcome, itemKey, locationLabel) : null;
  if (finding) {
    const findingId = existingFinding ? String(existingFinding.id) : crypto.randomUUID();
    const findingRevision = integer(existingFinding?.revision) + 1;
    additional.push(existingFinding
      ? getD1().prepare(`UPDATE trade_rental_findings SET item_id = ?, category = ?, title = ?, description = ?,
          standard_reference = ?, finding_status = ?, severity = ?, trade_category = ?, location_label = ?,
          recommended_action = ?, scope_summary = ?, quantity_milli = ?, unit_label = ?, details = ?,
          internal_notes = ?, sort_order = ?, revision = ?, updated_at = ?
        WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?`)
        .bind(itemId, sectionKey, finding.title, finding.description, finding.standardReference,
          finding.status, finding.severity, finding.tradeCategory, finding.locationLabel,
          finding.recommendedAction, finding.scopeSummary, finding.quantityMilli, finding.unitLabel,
          JSON.stringify(finding.details), finding.internalNotes, sortOrder, findingRevision, now,
          findingId, context.inspection.id, context.access.ownerUid, existingFinding.revision)
      : getD1().prepare(`INSERT INTO trade_rental_findings
          (id, inspection_id, module_id, item_id, firebase_uid, finding_key, category, title,
           description, standard_reference, finding_status, severity, trade_category, location_label,
           recommended_action, scope_summary, quantity_milli, unit_label, details, internal_notes,
           sort_order, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(findingId, context.inspection.id, moduleId, itemId, context.access.ownerUid,
          finding.findingKey, sectionKey, finding.title, finding.description, finding.standardReference,
          finding.status, finding.severity, finding.tradeCategory, finding.locationLabel,
          finding.recommendedAction, finding.scopeSummary, finding.quantityMilli, finding.unitLabel,
          JSON.stringify(finding.details), finding.internalNotes, sortOrder, now, now));
  } else if (!adverse && existingFinding) {
    additional.push(getD1().prepare(`UPDATE trade_rental_findings
      SET finding_status = 'compliant', severity = 'information',
        details = json_set(details, '$.resolvedAt', ?, '$.resolution', 'Resolved during the assessment.'),
        revision = revision + 1, updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?`)
      .bind(now, now, existingFinding.id, context.inspection.id, context.access.ownerUid, existingFinding.revision));
  }
  return await guardedMutation({
    context,
    primary,
    additional,
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_inspection_items item
        JOIN trade_rental_inspection_modules module ON module.id = item.module_id
          AND module.inspection_id = item.inspection_id AND module.firebase_uid = item.firebase_uid
      WHERE item.id = ? AND item.inspection_id = trade_rental_inspections.id
        AND item.firebase_uid = trade_rental_inspections.firebase_uid
        AND item.revision = ? AND item.updated_at = ?
        AND module.id = ? AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [itemId, nextItemRevision, now, moduleId, nextModuleRevision, now],
    eventType: "item_saved",
    summary: `${String(parsedObject(located.section).title)} assessment item saved.`,
    metadata: { moduleId, itemId, itemKey, outcome, revision: nextItemRevision },
  });
}

async function linkEvidence(context: InspectionContext, body: Row) {
  assertEditable(context);
  const itemId = cleanAdminText(body.itemId, 180);
  const jobMediaId = cleanAdminText(body.jobMediaId, 180);
  const item = await getD1().prepare(`SELECT item.*, module.revision module_revision, module.status module_status
    FROM trade_rental_inspection_items item
    JOIN trade_rental_inspection_modules module ON module.id = item.module_id
      AND module.inspection_id = item.inspection_id AND module.firebase_uid = item.firebase_uid
    WHERE item.id = ? AND item.inspection_id = ? AND item.firebase_uid = ?`)
    .bind(itemId, context.inspection.id, context.access.ownerUid).first<Row>();
  if (!item) throw new Error("RENTAL_ITEM_NOT_FOUND");
  const media = await getD1().prepare(`SELECT id, caption, content_type, size_bytes, evidence_envelope, created_at FROM trade_crm_job_media
    WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`)
    .bind(jobMediaId, context.workOrderId, context.access.ownerUid).first<Row>();
  if (!media) throw new Error("RENTAL_MEDIA_MISMATCH");
  if (String(media.content_type || "").startsWith("image/")
    && !rentalEvidencePhotoCapture(media.evidence_envelope, { receivedAtUtc: String(media.created_at || "") })) {
    throw new Error("RENTAL_EVIDENCE_METADATA_REQUIRED");
  }
  const existing = await getD1().prepare(`SELECT id FROM trade_rental_evidence_links
    WHERE inspection_id = ? AND requirement_key = ? AND job_media_id = ?`)
    .bind(context.inspection.id, item.item_key, jobMediaId).first<Row>();
  const evidenceBudget = await getD1().prepare(`SELECT COALESCE(SUM(media.size_bytes), 0) total_bytes
    FROM trade_rental_evidence_links evidence
    JOIN trade_crm_job_media media ON media.id = evidence.job_media_id
      AND media.firebase_uid = evidence.firebase_uid
    WHERE evidence.inspection_id = ? AND evidence.firebase_uid = ? AND evidence.status = 'active'
      AND evidence.id <> ?`)
    .bind(context.inspection.id, context.access.ownerUid, existing?.id || "").first<Row>();
  if (integer(evidenceBudget?.total_bytes) + integer(media.size_bytes) > MAX_RENTAL_REPORT_EVIDENCE_BYTES) {
    throw new Error("RENTAL_EVIDENCE_BUDGET_EXCEEDED");
  }
  const evidenceId = existing ? String(existing.id) : crypto.randomUUID();
  const now = new Date().toISOString();
  const expectedModuleRevision = integer(body.expectedModuleRevision);
  if (expectedModuleRevision !== integer(item.module_revision) || String(item.module_status) === "complete") {
    throw new Error("RENTAL_MUTATION_CONFLICT");
  }
  const nextModuleRevision = expectedModuleRevision + 1;
  const primary = existing
    ? getD1().prepare(`UPDATE trade_rental_evidence_links SET status = 'active', purpose = ?,
        caption_snapshot = ?, updated_at = ? WHERE id = ? AND inspection_id = ? AND firebase_uid = ?`)
      .bind(cleanAdminText(body.purpose, 1000), cleanAdminText(media.caption, 1000), now,
        evidenceId, context.inspection.id, context.access.ownerUid)
    : getD1().prepare(`INSERT INTO trade_rental_evidence_links
        (id, inspection_id, module_id, item_id, finding_id, job_media_id, firebase_uid,
         requirement_key, evidence_type, purpose, caption_snapshot, sort_order, status,
         created_by_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(evidenceId, context.inspection.id, item.module_id, itemId, jobMediaId,
        context.access.ownerUid, item.item_key,
        String(media.content_type || "").startsWith("image/") ? "photo" : "document",
        cleanAdminText(body.purpose, 1000), cleanAdminText(media.caption, 1000),
        integer(item.sort_order), context.access.actorUid, now, now);
  return await guardedMutation({
    context,
    primary,
    additional: [getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET status = 'draft', credential_snapshot = '{}', revision = ?, completed_by_uid = '', completed_at = '', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?
        AND status IN ('not_started', 'draft')
        AND EXISTS (SELECT 1 FROM trade_rental_evidence_links evidence
          WHERE evidence.id = ? AND evidence.inspection_id = trade_rental_inspection_modules.inspection_id
            AND evidence.module_id = trade_rental_inspection_modules.id
            AND evidence.firebase_uid = trade_rental_inspection_modules.firebase_uid
            AND evidence.status = 'active' AND evidence.updated_at = ?)`)
      .bind(nextModuleRevision, now, item.module_id, context.inspection.id,
        context.access.ownerUid, expectedModuleRevision, evidenceId, now)],
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_evidence_links evidence
        JOIN trade_rental_inspection_modules module ON module.id = evidence.module_id
          AND module.inspection_id = evidence.inspection_id AND module.firebase_uid = evidence.firebase_uid
      WHERE evidence.id = ? AND evidence.inspection_id = trade_rental_inspections.id
        AND evidence.firebase_uid = trade_rental_inspections.firebase_uid
        AND evidence.status = 'active' AND evidence.updated_at = ?
        AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [evidenceId, now, nextModuleRevision, now],
    eventType: "evidence_linked",
    summary: "Assessment evidence linked to a checklist item.",
    metadata: { evidenceId, itemId, jobMediaId },
  });
}

async function unlinkEvidence(context: InspectionContext, body: Row) {
  assertEditable(context);
  const evidenceId = cleanAdminText(body.evidenceId, 180);
  const evidence = await getD1().prepare(`SELECT evidence.*, module.revision module_revision, module.status module_status
    FROM trade_rental_evidence_links evidence
    JOIN trade_rental_inspection_modules module ON module.id = evidence.module_id
      AND module.inspection_id = evidence.inspection_id AND module.firebase_uid = evidence.firebase_uid
    WHERE evidence.id = ? AND evidence.inspection_id = ? AND evidence.firebase_uid = ? AND evidence.status = 'active'`)
    .bind(evidenceId, context.inspection.id, context.access.ownerUid).first<Row>();
  if (!evidence) throw new Error("RENTAL_ITEM_NOT_FOUND");
  const expectedModuleRevision = integer(body.expectedModuleRevision);
  if (expectedModuleRevision !== integer(evidence.module_revision) || String(evidence.module_status) === "complete") {
    throw new Error("RENTAL_MUTATION_CONFLICT");
  }
  const nextModuleRevision = expectedModuleRevision + 1;
  const now = new Date().toISOString();
  return await guardedMutation({
    context,
    primary: getD1().prepare(`UPDATE trade_rental_evidence_links SET status = 'superseded', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'active'`)
      .bind(now, evidenceId, context.inspection.id, context.access.ownerUid),
    additional: [getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET status = 'draft', credential_snapshot = '{}', revision = ?, completed_by_uid = '', completed_at = '', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?
        AND status IN ('not_started', 'draft')
        AND EXISTS (SELECT 1 FROM trade_rental_evidence_links linked
          WHERE linked.id = ? AND linked.status = 'superseded' AND linked.updated_at = ?)`)
      .bind(nextModuleRevision, now, evidence.module_id, context.inspection.id,
        context.access.ownerUid, expectedModuleRevision, evidenceId, now)],
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_evidence_links evidence
        JOIN trade_rental_inspection_modules module ON module.id = evidence.module_id
      WHERE evidence.id = ? AND evidence.inspection_id = trade_rental_inspections.id
        AND evidence.firebase_uid = trade_rental_inspections.firebase_uid
        AND evidence.status = 'superseded' AND evidence.updated_at = ?
        AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [evidenceId, now, nextModuleRevision, now],
    eventType: "evidence_unlinked",
    summary: "Assessment evidence was removed from a checklist item without deleting the job file.",
    metadata: { evidenceId, itemId: String(evidence.item_id), jobMediaId: String(evidence.job_media_id) },
  });
}

async function completeModule(context: InspectionContext, body: Row) {
  assertEditable(context);
  if (context.access.memberId !== String(context.inspection.assessor_member_id || "")
    || context.access.memberId !== String(context.job.assignee_member_id || "")) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  const moduleId = cleanAdminText(body.moduleId, 180);
  const assessmentModule = await moduleRow(context, moduleId);
  const expectedRevision = integer(body.expectedRevision);
  if (expectedRevision !== integer(assessmentModule.revision) || !["not_started", "draft"].includes(String(assessmentModule.status))) {
    throw new Error("RENTAL_MUTATION_CONFLICT");
  }
  const [itemRows, findingRows, evidenceRows] = await Promise.all([
    getD1().prepare(`SELECT * FROM trade_rental_inspection_items WHERE inspection_id = ? AND module_id = ? AND firebase_uid = ?`)
      .bind(context.inspection.id, moduleId, context.access.ownerUid).all<Row>(),
    getD1().prepare(`SELECT * FROM trade_rental_findings WHERE inspection_id = ? AND module_id = ? AND firebase_uid = ?`)
      .bind(context.inspection.id, moduleId, context.access.ownerUid).all<Row>(),
    getD1().prepare(`SELECT item_id, COUNT(*) count FROM trade_rental_evidence_links
      WHERE inspection_id = ? AND module_id = ? AND firebase_uid = ? AND status = 'active'
      GROUP BY item_id`)
      .bind(context.inspection.id, moduleId, context.access.ownerUid).all<Row>(),
  ]);
  const evidenceCounts = Object.fromEntries(evidenceRows.results.map((row) => [String(row.item_id), integer(row.count)]));
  const completion = rentalAssessmentCompletion({
    moduleTemplate: parsedObject(assessmentModule.template_snapshot),
    answers: parsedObject(assessmentModule.answers),
    items: itemRows.results.map((row) => ({ ...presentItem(row), responseJson: parsedObject(row.response_json) })),
    findings: findingRows.results.map(presentFinding),
    evidenceCounts,
  });
  if (!completion.complete) return adminJson({ ok: false, error: "Finish the highlighted assessment items before completing this module.", blockers: completion.blockers }, 409);
  const now = new Date().toISOString();
  const credential = await currentRentalModuleCredentialSnapshot({
    db: getD1(),
    ownerUid: context.access.ownerUid,
    assessorMemberId: context.access.memberId,
    moduleKey: String(assessmentModule.module_key),
    requiredCapability: String(assessmentModule.required_capability),
    answers: assessmentModule.answers,
    confirmedAt: now,
  });
  const nextRevision = expectedRevision + 1;
  const requiresCredentialRecord = credential.verificationBasis === "manager_attested_document";
  const credentialPredicate = requiresCredentialRecord ? `AND EXISTS (
        SELECT 1 FROM trade_team_member_credentials credential
        JOIN trade_team_member_files file ON file.id = credential.file_id
          AND file.owner_uid = credential.owner_uid AND file.team_member_id = credential.team_member_id
        WHERE credential.owner_uid = trade_rental_inspection_modules.firebase_uid
          AND credential.team_member_id = ? AND credential.rental_gate = ?
          AND credential.status = 'active' AND credential.jurisdiction IN ('VIC', 'NATIONAL')
          AND upper(trim(credential.credential_number)) = upper(trim(?))
          AND credential.expires_at = ? AND credential.updated_at = ?
          AND file.status = 'active' AND file.sha256 = ? AND file.updated_at = ?
          AND date(credential.expires_at) >= date(?) AND date(file.expires_at) >= date(?)
      )` : "";
  const credentialBindings = requiresCredentialRecord ? [
    context.access.memberId,
    credential.gate,
    credential.credentialNumber,
    credential.expiresAt,
    credential.recordedAt,
    credential.supportingFileSha256,
    credential.supportingFileRecordedAt,
    now.slice(0, 10),
    now.slice(0, 10),
  ] : [];
  return await guardedMutation({
    context,
    primary: getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET status = 'complete', credential_snapshot = ?, revision = ?, completed_by_uid = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ?
        AND status IN ('not_started', 'draft') ${credentialPredicate}`)
      .bind(JSON.stringify(credential), nextRevision, context.access.actorUid, now, now, moduleId,
        context.inspection.id, context.access.ownerUid, expectedRevision, ...credentialBindings),
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_inspection_modules module
      WHERE module.id = ? AND module.inspection_id = trade_rental_inspections.id
        AND module.firebase_uid = trade_rental_inspections.firebase_uid
        AND module.status = 'complete' AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [moduleId, nextRevision, now],
    eventType: "module_completed",
    summary: `${String(assessmentModule.template_name)} completed by ${context.access.displayName}.`,
    metadata: { moduleId, moduleKey: String(assessmentModule.module_key), revision: nextRevision },
  });
}

async function reopenModule(context: InspectionContext, body: Row) {
  assertEditable(context);
  const moduleId = cleanAdminText(body.moduleId, 180);
  const assessmentModule = await moduleRow(context, moduleId);
  const expectedRevision = integer(body.expectedRevision);
  if (expectedRevision !== integer(assessmentModule.revision) || String(assessmentModule.status) !== "complete") {
    throw new Error("RENTAL_MUTATION_CONFLICT");
  }
  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;
  return await guardedMutation({
    context,
    primary: getD1().prepare(`UPDATE trade_rental_inspection_modules
      SET status = 'draft', credential_snapshot = '{}', revision = ?, completed_by_uid = '', completed_at = '', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND revision = ? AND status = 'complete'`)
      .bind(nextRevision, now, moduleId, context.inspection.id, context.access.ownerUid, expectedRevision),
    successPredicate: `EXISTS (SELECT 1 FROM trade_rental_inspection_modules module
      WHERE module.id = ? AND module.inspection_id = trade_rental_inspections.id
        AND module.firebase_uid = trade_rental_inspections.firebase_uid
        AND module.status = 'draft' AND module.revision = ? AND module.updated_at = ?)`,
    successBindings: [moduleId, nextRevision, now],
    eventType: "module_reopened",
    summary: `${String(assessmentModule.template_name)} reopened for correction.`,
    metadata: { moduleId, moduleKey: String(assessmentModule.module_key), revision: nextRevision },
  });
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const context = await contextFor(access, workOrderId);
    return adminJson({ ok: true, ...(await assessmentPayload(context, new URL(request.url).origin)) });
  } catch (error) {
    return inspectionError(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
    const parsedBody = await readBoundedJsonRequest(request);
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return adminJson({ ok: false, error: "Invalid rental assessment request." }, 400);
    }
    const body = parsedBody as Row;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    let context = await contextFor(access, workOrderId);
    const action = cleanAdminText(body.action, 40);
    if (action === "revoke_report_link") {
      const revokedLink = await revokeRentalReportLink({ access, workOrderId,
        linkId: cleanAdminText(body.linkId, 180) });
      context = await contextFor(access, workOrderId);
      return adminJson({ ok: true, revokedLink, ...(await assessmentPayload(context, new URL(request.url).origin)) });
    }
    if (action === "renew_report_link") {
      const renewedLink = await renewRentalReportLink({
        access,
        workOrderId,
        reportId: cleanAdminText(body.reportId, 180),
        origin: new URL(request.url).origin,
      });
      context = await contextFor(access, workOrderId);
      return adminJson({ ok: true, renewedLink, ...(await assessmentPayload(context, new URL(request.url).origin)) });
    }
    assertEditable(context);
    if (action === "issue_report") {
      const issuedReport = await issueRentalAssessmentReport({ access, workOrderId, origin: new URL(request.url).origin });
      context = await contextFor(access, workOrderId);
      return adminJson({ ok: true, issuedReport, ...(await assessmentPayload(context, new URL(request.url).origin)) });
    }
    let result: InspectionContext | Response;
    if (action === "save_module_answers") result = await saveModuleAnswers(context, body);
    else if (action === "save_item") result = await saveItem(context, body);
    else if (action === "link_evidence") result = await linkEvidence(context, body);
    else if (action === "unlink_evidence") result = await unlinkEvidence(context, body);
    else if (action === "complete_module") result = await completeModule(context, body);
    else if (action === "reopen_module") result = await reopenModule(context, body);
    else return adminJson({ ok: false, error: "Choose a valid rental assessment action." }, 400);
    if (result instanceof Response) return result;
    context = result;
    return adminJson({ ok: true, ...(await assessmentPayload(context, new URL(request.url).origin)) });
  } catch (error) {
    return inspectionError(error);
  }
}
