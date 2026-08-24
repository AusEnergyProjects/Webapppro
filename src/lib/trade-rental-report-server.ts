import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import {
  assignedJob,
  type TeamAccess,
} from "@/lib/trade-team-server";
import {
  guardedOnlineJobMutationBatch,
  jobSyncChangeStatements,
  nextJobRevision,
} from "@/lib/trade-team-sync-server";
import {
  canonicalRentalJson,
  publicRentalReportValue,
  rentalAssessmentCompletion,
  rentalReportExpiresAt,
} from "@/lib/trade-rental-assessment.mjs";
import {
  deleteImmutableIssuedPdf,
  prepareImmutableIssuedPdfReference,
  readImmutableIssuedPdf,
  storeImmutableIssuedPdf,
  type ImmutableIssuedPdfReference,
} from "@/lib/trade-issued-document-store";
import {
  hashRentalReportSecret,
  newRentalReportSecret,
  protectRentalReportSecret,
  recoverRentalReportSecret,
  rentalReportPath,
  rentalReportRequestHash,
  splitRentalReportToken,
} from "@/lib/trade-rental-report-links";
import { createRentalAssessmentPdfBytes } from "@/lib/trade-rental-report-pdf.mjs";
import { loadCustomerPlanPdfFonts } from "@/lib/customer-plan-pdf-fonts";
import { rentalEvidenceCapture, rentalEvidencePhotoCapture } from "@/lib/trade-rental-evidence.mjs";
import { assertRentalModuleCredentialCurrent } from "@/lib/trade-rental-credentials";
import { ensureTradeRentalSchemaGuards } from "@/lib/trade-rental-schema-guards";

type Row = Record<string, unknown>;
type EvidenceObject = {
  arrayBuffer(): Promise<ArrayBuffer>;
  body: BodyInit;
  httpMetadata?: { contentType?: string };
};
type EvidenceBucket = { get(key: string): Promise<EvidenceObject | null> };
type MutableEvidenceBucket = EvidenceBucket & {
  put(key: string, value: ArrayBuffer, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  delete(key: string): Promise<void>;
};
type PreparedRentalEvidenceObject = {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  evidenceId: string;
  sha256: string;
};

const REPORT_SCHEMA_VERSION = "tlink-rental-report-v1";
const MAX_RENTAL_REPORT_EVIDENCE_BYTES = 32 * 1024 * 1024;
function bucket() {
  const value = (env as unknown as { EVIDENCE?: MutableEvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("RENTAL_REPORT_STORAGE_UNAVAILABLE");
  return value;
}

function parsedObject(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

function parsedArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function cleanFileName(value: unknown) {
  return String(value || "rental-assessment.pdf").replace(/[\r\n"\\/]/g, "_").slice(0, 180);
}

function exactArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function sha256Bytes(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes))));
}

function safeObjectSegment(value: unknown, fallback: string) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || fallback;
}

function immutableRentalEvidenceKey(input: {
  reportId: string;
  revision: number;
  evidenceId: string;
  sha256: string;
  fileName: string;
}) {
  return `trade-issued-documents/rental-report/${safeObjectSegment(input.reportId, "unknown")}`
    + `/revision-${Math.max(1, Math.trunc(input.revision))}/evidence/${safeObjectSegment(input.evidenceId, "evidence")}`
    + `/${input.sha256}-${safeObjectSegment(input.fileName, "file")}`;
}

function findingPresentation(row: Row) {
  return {
    id: String(row.id),
    itemId: String(row.item_id || ""),
    moduleId: String(row.module_id),
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
    quantityMilli: number(row.quantity_milli, 1000),
    unitLabel: String(row.unit_label || "each"),
    details: parsedObject(row.details),
  };
}

function itemPresentation(row: Row, prompt: string) {
  return {
    id: String(row.id),
    itemKey: String(row.item_key),
    sectionKey: String(row.section_key),
    checkKey: String(row.check_key),
    instanceKey: String(row.instance_key),
    locationLabel: String(row.location_label || ""),
    prompt,
    outcome: String(row.outcome),
    response: parsedObject(row.response_json),
    publicNotes: String(row.public_notes || ""),
    requiredEvidenceCount: number(row.required_evidence_count),
    completedAt: String(row.completed_at || ""),
  };
}

async function reportSource(access: TeamAccess, workOrderId: string) {
  const db = getD1();
  if (!access.canRunReports) throw new Error("REPORT_PERMISSION_REQUIRED");
  const job = await assignedJob(access, workOrderId);
  const inspection = await db.prepare(`SELECT * FROM trade_rental_inspections
    WHERE work_order_id = ? AND firebase_uid = ? LIMIT 1`)
    .bind(workOrderId, access.ownerUid).first<Row>();
  if (!inspection) throw new Error("RENTAL_INSPECTION_NOT_FOUND");
  if (String(inspection.assessor_member_id || "") !== access.memberId
    || String(job.assignee_member_id || "") !== access.memberId) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  if (!["draft", "scheduled", "in_progress", "submitted"].includes(String(inspection.status))) {
    throw new Error("RENTAL_INSPECTION_LOCKED");
  }
  const [moduleRows, itemRows, findingRows, evidenceRows, business, assessor] = await Promise.all([
    db.prepare(`SELECT * FROM trade_rental_inspection_modules
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY required DESC, created_at, id`)
      .bind(inspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM trade_rental_inspection_items
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY sort_order, created_at, id`)
      .bind(inspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM trade_rental_findings
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY sort_order, created_at, id`)
      .bind(inspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT evidence.*, media.file_name, media.content_type, media.size_bytes,
        media.object_key, media.caption media_caption, media.original_sha256, media.evidence_envelope
      FROM trade_rental_evidence_links evidence
      JOIN trade_crm_job_media media ON media.id = evidence.job_media_id
        AND media.work_order_id = ? AND media.firebase_uid = evidence.firebase_uid
      WHERE evidence.inspection_id = ? AND evidence.firebase_uid = ? AND evidence.status = 'active'
      ORDER BY evidence.sort_order, evidence.created_at, evidence.id`)
      .bind(workOrderId, inspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT business_name, abn, contact_name, phone, email, document_business_name,
        document_phone, document_email, address_line_1, suburb, address_state, postcode
      FROM trade_accounts WHERE firebase_uid = ? AND partner_type = 'installer'`)
      .bind(access.ownerUid).first<Row>(),
    db.prepare(`SELECT id, member_uid, display_name, first_name, last_name, email, phone, role, capabilities
      FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active'`)
      .bind(access.memberId, access.ownerUid).first<Row>(),
  ]);
  if (!business || !assessor) throw new Error("ASSESSOR_REQUIRED");
  const selectedModuleKeys = parsedArray(inspection.module_selection_snapshot).map(String).sort();
  const storedModuleKeys = moduleRows.results.map((module) => String(module.module_key)).sort();
  if (!selectedModuleKeys.length
    || selectedModuleKeys.length !== storedModuleKeys.length
    || selectedModuleKeys.some((key, index) => key !== storedModuleKeys[index])) {
    throw new Error("RENTAL_MODULE_SET_INVALID");
  }
  if (!moduleRows.results.length || moduleRows.results.some((module) => module.status !== "complete")) {
    throw new Error("RENTAL_MODULES_INCOMPLETE");
  }
  if (evidenceRows.results.some((evidence) => String(evidence.content_type || "").startsWith("image/")
    && !rentalEvidencePhotoCapture(evidence.evidence_envelope))) {
    throw new Error("RENTAL_EVIDENCE_METADATA_REQUIRED");
  }
  const evidenceCounts = Object.fromEntries(evidenceRows.results.map((evidence) => String(evidence.item_id))
    .map((itemId) => [itemId, evidenceRows.results.filter((evidence) => String(evidence.item_id) === itemId).length]));
  const presentedFindings = findingRows.results.map(findingPresentation);
  for (const assessmentModule of moduleRows.results) {
    const moduleItems = itemRows.results.filter((item) => item.module_id === assessmentModule.id);
    const completion = rentalAssessmentCompletion({
      moduleTemplate: parsedObject(assessmentModule.template_snapshot),
      answers: parsedObject(assessmentModule.answers),
      items: moduleItems.map((item) => ({
        id: String(item.id), itemKey: String(item.item_key), sectionKey: String(item.section_key),
        checkKey: String(item.check_key), locationLabel: String(item.location_label || ""),
        outcome: String(item.outcome), requiredEvidenceCount: number(item.required_evidence_count),
        publicNotes: String(item.public_notes || ""),
        responseJson: parsedObject(item.response_json),
      })),
      findings: presentedFindings.filter((finding) => finding.moduleId === assessmentModule.id),
      evidenceCounts,
    });
    if (!completion.complete) throw new Error("RENTAL_MODULES_INCOMPLETE");
  }
  const credentialCheckedAt = new Date().toISOString();
  await Promise.all(moduleRows.results.map((module) => assertRentalModuleCredentialCurrent({
    db,
    ownerUid: access.ownerUid,
    assessorMemberId: access.memberId,
    moduleKey: String(module.module_key),
    requiredCapability: String(module.required_capability),
    answers: module.answers,
    storedSnapshot: module.credential_snapshot,
    completedAt: String(module.completed_at || ""),
    checkedAt: credentialCheckedAt,
  })));
  return {
    job,
    inspection,
    modules: moduleRows.results,
    items: itemRows.results,
    findings: presentedFindings,
    evidence: evidenceRows.results,
    business,
    assessor,
  };
}

async function evidenceForSnapshot(rows: Row[], input: { reportId: string; revision: number }) {
  const store = bucket();
  const assets: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  const evidence = [];
  const preparedObjects: PreparedRentalEvidenceObject[] = [];
  let totalEvidenceBytes = 0;
  for (const row of rows) {
    const objectKey = String(row.object_key || "");
    const object = objectKey ? await store.get(objectKey) : null;
    if (!object) throw new Error("RENTAL_REPORT_EVIDENCE_UNAVAILABLE");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== number(row.size_bytes)) throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
    totalEvidenceBytes += bytes.byteLength;
    if (totalEvidenceBytes > MAX_RENTAL_REPORT_EVIDENCE_BYTES) {
      throw new Error("RENTAL_REPORT_EVIDENCE_TOO_LARGE");
    }
    const actualSha256 = await sha256Bytes(bytes);
    const recordedSha256 = String(row.original_sha256 || "").toLowerCase();
    if (recordedSha256 && recordedSha256 !== actualSha256) throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
    const contentType = String(row.content_type || object.httpMetadata?.contentType || "application/octet-stream").toLowerCase();
    const publicEvidenceId = crypto.randomUUID();
    const immutableObjectKey = immutableRentalEvidenceKey({
      reportId: input.reportId,
      revision: input.revision,
      evidenceId: publicEvidenceId,
      sha256: actualSha256,
      fileName: cleanFileName(row.file_name),
    });
    preparedObjects.push({
      objectKey: immutableObjectKey,
      bytes,
      contentType,
      evidenceId: publicEvidenceId,
      sha256: actualSha256,
    });
    const entry = {
      id: publicEvidenceId,
      sourceItemId: String(row.item_id || ""),
      sourceFindingId: String(row.finding_id || ""),
      requirementKey: String(row.requirement_key),
      evidenceType: String(row.evidence_type),
      purpose: String(row.purpose || ""),
      caption: String(row.caption_snapshot || row.media_caption || ""),
      fileName: cleanFileName(row.file_name),
      contentType,
      sizeBytes: bytes.byteLength,
      originalSha256: actualSha256,
      capture: rentalEvidenceCapture(row.evidence_envelope),
      objectKey: immutableObjectKey,
      embeddedInPdf: true,
    };
    assets[entry.id] = { bytes, contentType };
    evidence.push(entry);
  }
  return { evidence, assets, preparedObjects };
}

async function storePreparedRentalEvidence(
  preparedObjects: PreparedRentalEvidenceObject[],
  input: { reportId: string; revision: number },
) {
  const store = bucket();
  for (const prepared of preparedObjects) {
    await store.put(prepared.objectKey, exactArrayBuffer(prepared.bytes), {
      httpMetadata: { contentType: prepared.contentType },
      customMetadata: {
        documentKind: "rental-report-evidence",
        reportId: input.reportId,
        revision: String(input.revision),
        evidenceId: prepared.evidenceId,
        sha256: prepared.sha256,
        retention: "immutable-issued-document",
      },
    });
  }
}

function propertyProjection(snapshot: Row) {
  const customer = parsedObject(snapshot.customer);
  const property = parsedObject(snapshot.property);
  return {
    customerName: String(customer.displayName || ""),
    customerEmail: String(customer.email || ""),
    customerPhone: String(customer.phone || ""),
    buildingType: String(property.buildingType || ""),
    addressLine1: String(property.addressLine1 || ""),
    addressLine2: String(property.addressLine2 || ""),
    suburb: String(property.suburb || ""),
    state: String(property.state || ""),
    postcode: String(property.postcode || ""),
    address: [property.addressLine1, property.addressLine2, property.suburb, property.state, property.postcode].filter(Boolean).join(", "),
  };
}

async function buildReportSnapshot(source: Awaited<ReturnType<typeof reportSource>>, input: {
  reportId: string;
  reportNumber: string;
  revision: number;
  issuedAt: string;
}) {
  const propertySnapshot = parsedObject(source.inspection.property_snapshot);
  const { evidence: sourceEvidence, assets, preparedObjects } = await evidenceForSnapshot(source.evidence, input);
  const modulePublicIds = new Map(source.modules.map((module) => [String(module.id), crypto.randomUUID()]));
  const itemPublicIds = new Map(source.items.map((item) => [String(item.id), crypto.randomUUID()]));
  const findingPublicIds = new Map(source.findings.map((finding) => [String(finding.id), crypto.randomUUID()]));
  const modules = source.modules.map((module) => {
    const template = parsedObject(module.template_snapshot);
    const moduleItems = source.items.filter((item) => item.module_id === module.id);
    return {
      id: String(modulePublicIds.get(String(module.id))),
      key: String(module.module_key),
      title: String(module.template_name),
      required: Boolean(module.required),
      status: String(module.status),
      reportBoundary: String(template.reportBoundary || ""),
      credentialGate: String(template.credentialGate || module.required_capability || ""),
      credential: parsedObject(module.credential_snapshot),
      answers: parsedObject(module.answers),
      completedAt: String(module.completed_at || ""),
      sections: parsedArray(template.sections).map((rawSection) => {
        const section = parsedObject(rawSection);
        const checks = parsedArray(section.checks);
        return {
          key: String(section.key),
          title: String(section.title),
          summary: String(section.summary || ""),
          items: moduleItems.filter((item) => item.section_key === section.key).map((item) => {
            const assessmentCheck = checks.map(parsedObject).find((check) => check.key === item.check_key);
            return {
              ...itemPresentation(item, String(assessmentCheck?.prompt || item.check_key)),
              id: String(itemPublicIds.get(String(item.id))),
            };
          }),
        };
      }),
    };
  });
  const minimumAnswers = parsedObject(source.modules.find((module) => module.module_key === "minimum_standards")?.answers);
  const businessName = String(source.business.document_business_name || source.business.business_name || "TLink trade business");
  const findings = source.findings.map((finding) => {
    const { id, moduleId, itemId, ...publicFinding } = finding;
    return {
      ...publicFinding,
      id: String(findingPublicIds.get(String(id))),
      moduleId: String(modulePublicIds.get(String(moduleId)) || ""),
      itemId: String(itemPublicIds.get(String(itemId)) || ""),
    };
  });
  const evidence = sourceEvidence.map((entry) => {
    const { sourceItemId, sourceFindingId, ...publicEvidence } = entry;
    return {
      ...publicEvidence,
      itemId: String(itemPublicIds.get(String(sourceItemId)) || ""),
      findingId: String(findingPublicIds.get(String(sourceFindingId)) || ""),
    };
  });
  const snapshot = publicRentalReportValue({
    schemaVersion: REPORT_SCHEMA_VERSION,
    report: {
      id: input.reportId,
      number: input.reportNumber,
      revision: input.revision,
      issuedAt: input.issuedAt,
      generatedAt: input.issuedAt,
    },
    business: {
      name: businessName,
      abn: String(source.business.abn || ""),
      contactName: String(source.business.contact_name || ""),
      email: String(source.business.document_email || source.business.email || ""),
      phone: String(source.business.document_phone || source.business.phone || ""),
      address: [source.business.address_line_1, source.business.suburb, source.business.address_state, source.business.postcode].filter(Boolean).join(", "),
    },
    property: propertyProjection(propertySnapshot),
    inspection: {
      number: String(source.inspection.inspection_number),
      jurisdiction: "VIC",
      templateKey: String(source.inspection.template_key),
      templateVersion: number(source.inspection.template_version),
      rulesEffectiveFrom: String(source.inspection.rules_effective_from),
      assessmentDate: String(minimumAnswers.inspectionDate || ""),
    },
    issuer: {
      name: String(source.assessor.display_name || ""),
      role: String(source.assessor.role || "assessor"),
      email: String(source.assessor.email || ""),
      phone: String(source.assessor.phone || ""),
      qualificationType: String(minimumAnswers.qualificationType || ""),
      qualificationNumber: String(minimumAnswers.qualificationNumber || ""),
      declaration: "I confirm this assessment is complete and accurate to the best of my knowledge.",
      authenticatedAt: input.issuedAt,
    },
    modules,
    findings,
    evidence,
    sources: parsedArray(parsedObject(source.modules[0]?.template_snapshot).sources || []),
  });
  return { snapshot, assets, preparedObjects };
}

function failedReportEvidenceKeys(row: Row) {
  const prefix = `trade-issued-documents/rental-report/${safeObjectSegment(row.report_id, "unknown")}/`;
  const keys = parsedArray(parsedObject(row.report_snapshot).evidence)
    .map((rawEvidence) => String(parsedObject(rawEvidence).objectKey || ""))
    .filter(Boolean);
  if (keys.some((objectKey) => !objectKey.startsWith(prefix))) {
    throw new Error("RENTAL_REPORT_CLEANUP_INVALID");
  }
  return [...new Set(keys)];
}

async function cleanupFailedRentalReportObjects(row: Row, ownerUid: string) {
  const evidenceKeys = failedReportEvidenceKeys(row);
  for (const objectKey of evidenceKeys) await bucket().delete(objectKey);
  if (row.pdf_object_key && row.pdf_sha256 && number(row.pdf_size_bytes) > 0) {
    await deleteImmutableIssuedPdf({
      objectKey: String(row.pdf_object_key),
      sha256: String(row.pdf_sha256),
      sizeBytes: number(row.pdf_size_bytes),
    }, {
      kind: "rental-report",
      documentId: String(row.report_id),
      revision: number(row.report_revision),
    });
  }
  const cleanedAt = new Date().toISOString();
  const cleaned = await getD1().prepare(`UPDATE trade_rental_reports
    SET pdf_object_key = '', pdf_sha256 = '', pdf_size_bytes = 0,
      issuer_snapshot = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND status = 'failed'
      AND pdf_object_key = ? AND pdf_sha256 = ? AND pdf_size_bytes = ?
      AND json_extract(issuer_snapshot, '$.cleanupCompletedAt') IS NULL`)
    .bind(JSON.stringify({ cleanupCompletedAt: cleanedAt, removedObjectCount: evidenceKeys.length + (row.pdf_object_key ? 1 : 0) }),
      cleanedAt, row.report_id, ownerUid, String(row.pdf_object_key || ""),
      String(row.pdf_sha256 || ""), number(row.pdf_size_bytes))
    .run();
  if (number(cleaned.meta.changes) !== 1) throw new Error("RENTAL_REPORT_CLEANUP_CONFLICT");
}

async function retryFailedRentalReportCleanup(ownerUid: string, workOrderId: string) {
  const failed = await getD1().prepare(`SELECT report.id report_id, report.report_snapshot,
      report.revision report_revision, report.pdf_object_key, report.pdf_sha256,
      report.pdf_size_bytes
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid
    WHERE inspection.work_order_id = ? AND report.firebase_uid = ? AND report.status = 'failed'
      AND json_extract(report.issuer_snapshot, '$.cleanupCompletedAt') IS NULL
    ORDER BY report.updated_at, report.id LIMIT 20`)
    .bind(workOrderId, ownerUid).all<Row>();
  for (const row of failed.results) {
    try {
      await cleanupFailedRentalReportObjects(row, ownerUid);
    } catch (error) {
      throw new Error("RENTAL_REPORT_CLEANUP_REQUIRED", { cause: error });
    }
  }
}

async function recoverStaleRentalIssuance(ownerUid: string, workOrderId: string) {
  const db = getD1();
  await retryFailedRentalReportCleanup(ownerUid, workOrderId);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const stale = await db.prepare(`SELECT report.id report_id, report.report_snapshot,
      report.revision report_revision, report.pdf_object_key, report.pdf_sha256,
      report.pdf_size_bytes, inspection.id inspection_id
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid
    WHERE inspection.work_order_id = ? AND inspection.firebase_uid = ?
      AND inspection.status = 'issuing' AND inspection.issued_report_id = ''
      AND report.status = 'staged' AND report.updated_at < ?`)
    .bind(workOrderId, ownerUid, cutoff).all<Row>();
  for (const row of stale.results) {
    const recoveredAt = new Date().toISOString();
    let recovered = false;
    try {
      const recoveryResults = await db.batch([
      db.prepare(`UPDATE trade_rental_reports SET status = 'failed', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'staged' AND updated_at < ?
          AND EXISTS (SELECT 1 FROM trade_rental_inspections inspection
            WHERE inspection.id = trade_rental_reports.inspection_id
              AND inspection.firebase_uid = trade_rental_reports.firebase_uid
              AND inspection.status = 'issuing' AND inspection.issued_report_id = '')`)
        .bind(recoveredAt, row.report_id, ownerUid, cutoff),
      db.prepare(`UPDATE trade_rental_inspections SET status = 'in_progress', revision = revision + 1,
          updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'issuing' AND issued_report_id = ''
          AND EXISTS (SELECT 1 FROM trade_rental_reports report
            WHERE report.id = ? AND report.inspection_id = trade_rental_inspections.id
              AND report.firebase_uid = trade_rental_inspections.firebase_uid AND report.status = 'failed'
              AND report.updated_at = ?)`)
        .bind(recoveredAt, row.inspection_id, ownerUid, row.report_id, recoveredAt),
      db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
         event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
        SELECT ?, inspection.id, report.id, '', inspection.firebase_uid, 'system', '',
          'report_issue_recovered', '', 'A stale report issue was safely released for retry.',
          '{}', '', '', ?
        FROM trade_rental_inspections inspection
        JOIN trade_rental_reports report ON report.id = ? AND report.inspection_id = inspection.id
          AND report.firebase_uid = inspection.firebase_uid
        WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.status = 'in_progress'
          AND inspection.updated_at = ? AND report.status = 'failed' AND report.updated_at = ?`)
        .bind(crypto.randomUUID(), recoveredAt, row.report_id, row.inspection_id, ownerUid,
          recoveredAt, recoveredAt),
      db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
         event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
        SELECT ?, ?, ?, '', ?, 'system', '', 'report_issue_recovery_guard', '',
          'A stale report issue recovery guard recorded that another transition won the race.',
          '{}', '', '', ?
        WHERE NOT EXISTS (SELECT 1 FROM trade_rental_inspections inspection
          JOIN trade_rental_reports report ON report.id = ? AND report.inspection_id = inspection.id
            AND report.firebase_uid = inspection.firebase_uid
          WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.status = 'in_progress'
            AND inspection.updated_at = ? AND report.status = 'failed' AND report.updated_at = ?)`)
        .bind(crypto.randomUUID(), row.inspection_id, row.report_id, ownerUid, recoveredAt,
          row.report_id, row.inspection_id, ownerUid, recoveredAt, recoveredAt),
      ]);
      recovered = number(recoveryResults[0]?.meta.changes) === 1
        && number(recoveryResults[1]?.meta.changes) === 1
        && number(recoveryResults[2]?.meta.changes) === 1
        && number(recoveryResults[3]?.meta.changes) === 0;
    } catch {
      continue;
    }
    if (!recovered) continue;
    try {
      await cleanupFailedRentalReportObjects(row, ownerUid);
    } catch (error) {
      throw new Error("RENTAL_REPORT_CLEANUP_REQUIRED", { cause: error });
    }
  }
}

export async function issueRentalAssessmentReport(input: {
  access: TeamAccess;
  workOrderId: string;
  origin: string;
}) {
  const db = getD1();
  await ensureTradeRentalSchemaGuards(db);
  await recoverStaleRentalIssuance(input.access.ownerUid, input.workOrderId);
  const source = await reportSource(input.access, input.workOrderId);
  const reportRevisionRow = await db.prepare(`SELECT COALESCE(MAX(revision), 0) revision
    FROM trade_rental_reports WHERE inspection_id = ? AND firebase_uid = ?`)
    .bind(source.inspection.id, input.access.ownerUid).first<Row>();
  const reportRevision = number(reportRevisionRow?.revision) + 1;
  const reportId = crypto.randomUUID();
  const reportNumber = `${String(source.inspection.inspection_number)}-R${reportRevision}`;
  const issuedAt = new Date().toISOString();
  const stagedInspectionRevision = number(source.inspection.revision) + 1;
  const finalInspectionRevision = stagedInspectionRevision + 1;
  const linkId = crypto.randomUUID();
  const secret = newRentalReportSecret();
  const expiresAt = rentalReportExpiresAt(issuedAt);
  let pdfReference: ImmutableIssuedPdfReference | null = null;
  let stored: ImmutableIssuedPdfReference | null = null;
  try {
    const { snapshot, assets, preparedObjects } = await buildReportSnapshot(source, {
      reportId,
      reportNumber,
      revision: reportRevision,
      issuedAt,
    });
    const snapshotJson = canonicalRentalJson(snapshot);
    const sourceSnapshotSha256 = await sha256Text(snapshotJson);
    const stageResults = await db.batch([
      db.prepare(`INSERT INTO trade_rental_reports
        (id, inspection_id, firebase_uid, report_number, revision, status, report_schema_version,
         report_snapshot, source_snapshot_sha256, pdf_object_key, pdf_sha256, pdf_size_bytes,
         issued_by_uid, issued_by_member_id, issuer_snapshot, staged_at, issued_at, superseded_at,
         created_at, updated_at)
        SELECT ?, inspection.id, inspection.firebase_uid, ?, ?, 'staged', ?, ?, ?, '', '', 0,
          '', '', '{}', ?, '', '', ?, ?
        FROM trade_rental_inspections inspection
        WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.work_order_id = ?
          AND inspection.revision = ? AND inspection.status IN ('draft', 'scheduled', 'in_progress', 'submitted')
          AND inspection.assessor_member_id = ?
          AND NOT EXISTS (SELECT 1 FROM trade_rental_reports active_report
            WHERE active_report.inspection_id = inspection.id AND active_report.firebase_uid = inspection.firebase_uid
              AND active_report.status IN ('staged', 'issued'))`)
        .bind(reportId, reportNumber, reportRevision, REPORT_SCHEMA_VERSION, snapshotJson,
          sourceSnapshotSha256, issuedAt, issuedAt, issuedAt, source.inspection.id,
          input.access.ownerUid, input.workOrderId, source.inspection.revision, input.access.memberId),
      db.prepare(`UPDATE trade_rental_inspections SET status = 'issuing', revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?
          AND status IN ('draft', 'scheduled', 'in_progress', 'submitted')
          AND assessor_member_id = ?
          AND EXISTS (SELECT 1 FROM trade_rental_reports report
            WHERE report.id = ? AND report.inspection_id = trade_rental_inspections.id
              AND report.firebase_uid = trade_rental_inspections.firebase_uid AND report.status = 'staged')`)
        .bind(stagedInspectionRevision, issuedAt, source.inspection.id, input.access.ownerUid,
          source.inspection.revision, input.access.memberId, reportId),
    ]);
    if (number(stageResults[0]?.meta.changes) !== 1 || number(stageResults[1]?.meta.changes) !== 1) {
      throw new Error("RENTAL_REPORT_ISSUE_CONFLICT");
    }

    await storePreparedRentalEvidence(preparedObjects, { reportId, revision: reportRevision });
    const fonts = await loadCustomerPlanPdfFonts();
    const pdfBytes = await createRentalAssessmentPdfBytes(snapshot, assets, fonts);
    pdfReference = await prepareImmutableIssuedPdfReference({
      kind: "rental-report",
      documentId: reportId,
      revision: reportRevision,
      bytes: pdfBytes,
    });
    const pdfPreparedAt = new Date().toISOString();
    const pdfPlan = await db.prepare(`UPDATE trade_rental_reports
      SET pdf_object_key = ?, pdf_sha256 = ?, pdf_size_bytes = ?, updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'
        AND source_snapshot_sha256 = ? AND report_snapshot = ?
        AND pdf_object_key = '' AND pdf_sha256 = '' AND pdf_size_bytes = 0`)
      .bind(pdfReference.objectKey, pdfReference.sha256, pdfReference.sizeBytes, pdfPreparedAt,
        reportId, source.inspection.id, input.access.ownerUid, sourceSnapshotSha256, snapshotJson)
      .run();
    if (number(pdfPlan.meta.changes) !== 1) throw new Error("RENTAL_REPORT_ISSUE_CONFLICT");
    stored = await storeImmutableIssuedPdf({
      kind: "rental-report",
      documentId: reportId,
      revision: reportRevision,
      bytes: pdfBytes,
      expectedSha256: pdfReference.sha256,
    });
    const tokenHash = await hashRentalReportSecret(secret);
    const encryptedToken = await protectRentalReportSecret(linkId, 1, secret);
    const nextWorkRevision = nextJobRevision(source.job.revision);
    await guardedOnlineJobMutationBatch(db, [
      db.prepare(`UPDATE trade_rental_reports SET status = 'issued', pdf_object_key = ?, pdf_sha256 = ?,
          pdf_size_bytes = ?, issued_by_uid = ?, issued_by_member_id = ?, issuer_snapshot = ?,
          issued_at = ?, updated_at = ?
        WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'
          AND source_snapshot_sha256 = ? AND report_snapshot = ?
          AND pdf_object_key = ? AND pdf_sha256 = ? AND pdf_size_bytes = ?`)
        .bind(stored.objectKey, stored.sha256, stored.sizeBytes, input.access.actorUid,
          input.access.memberId, JSON.stringify(snapshot.issuer), issuedAt, issuedAt,
          reportId, source.inspection.id, input.access.ownerUid, sourceSnapshotSha256, snapshotJson,
          stored.objectKey, stored.sha256, stored.sizeBytes),
      db.prepare(`UPDATE trade_rental_inspections SET status = 'issued', issued_report_id = ?,
          issued_at = ?, revision = ?, updated_at = ?
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND status = 'issuing'
          AND revision = ? AND assessor_member_id = ?
          AND EXISTS (SELECT 1 FROM trade_rental_reports report
            WHERE report.id = ? AND report.inspection_id = trade_rental_inspections.id
              AND report.firebase_uid = trade_rental_inspections.firebase_uid AND report.status = 'issued'
              AND report.pdf_object_key = ? AND report.pdf_sha256 = ? AND report.pdf_size_bytes = ?)`)
        .bind(reportId, issuedAt, finalInspectionRevision, issuedAt, source.inspection.id,
          input.workOrderId, input.access.ownerUid, stagedInspectionRevision, input.access.memberId,
          reportId, stored.objectKey, stored.sha256, stored.sizeBytes),
      db.prepare(`INSERT INTO trade_rental_report_links
        (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, token_issue,
         status, expires_at, revoked_at, created_by_uid, last_viewed_at, last_downloaded_at,
         view_count, download_count, created_at, updated_at)
        SELECT ?, report.id, inspection.id, report.firebase_uid, ?, ?, 1, 'active', ?, '', ?, '', '', 0, 0, ?, ?
        FROM trade_rental_reports report
        JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
          AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
        WHERE report.id = ? AND report.inspection_id = ? AND report.firebase_uid = ?
          AND report.status = 'issued' AND inspection.status = 'issued' AND inspection.revision = ?`)
        .bind(linkId, tokenHash, encryptedToken, expiresAt, input.access.actorUid, issuedAt,
          issuedAt, reportId, source.inspection.id, input.access.ownerUid, finalInspectionRevision),
      db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND stage = ?
          AND revision = ? AND EXISTS (SELECT 1 FROM trade_rental_report_links link
            WHERE link.id = ? AND link.report_id = ? AND link.status = 'active')`)
        .bind(nextWorkRevision, issuedAt, input.workOrderId, input.access.ownerUid,
          source.job.stage, source.job.revision, linkId, reportId),
      db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
         event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
        SELECT ?, inspection.id, report.id, link.id, inspection.firebase_uid, 'assessor', ?,
          'report_issued', '', ?, ?, '', '', ?
        FROM trade_rental_inspections inspection
        JOIN trade_rental_reports report ON report.id = inspection.issued_report_id
          AND report.inspection_id = inspection.id AND report.firebase_uid = inspection.firebase_uid
        JOIN trade_rental_report_links link ON link.report_id = report.id
          AND link.inspection_id = inspection.id AND link.firebase_uid = inspection.firebase_uid
        WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.status = 'issued'
          AND report.status = 'issued' AND link.id = ? AND link.status = 'active'`)
        .bind(crypto.randomUUID(), input.access.actorUid, `${reportNumber} issued by ${input.access.displayName}.`,
          JSON.stringify({ reportNumber, revision: reportRevision, expiresAt }), issuedAt,
          source.inspection.id, input.access.ownerUid, linkId),
      ...jobSyncChangeStatements(db, { ownerUid: input.access.ownerUid, workOrderId: input.workOrderId,
        revision: nextWorkRevision, changedAt: issuedAt, audienceMemberId: source.job.assignee_member_id }),
    ], {
      kind: "stage",
      jobRevision: nextWorkRevision,
      jobStage: String(source.job.stage),
      ownerUid: input.access.ownerUid,
      updatedAt: issuedAt,
      workOrderId: input.workOrderId,
    });
    const sharePath = rentalReportPath(linkId, secret);
    return {
      reportId,
      reportNumber,
      revision: reportRevision,
      issuedAt,
      expiresAt,
      shareUrl: `${input.origin}${sharePath}`,
      pdfUrl: `${input.origin}/api${sharePath}/pdf`,
    };
  } catch (error) {
    let committed: Row | null;
    const expectedPdf = stored || pdfReference;
    try {
      committed = await db.prepare(`SELECT report.id
        FROM trade_rental_reports report
        WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued'
          AND report.pdf_object_key = ? AND report.pdf_sha256 = ? AND report.pdf_size_bytes = ?`)
        .bind(reportId, input.access.ownerUid, expectedPdf?.objectKey || "", expectedPdf?.sha256 || "",
          expectedPdf?.sizeBytes || 0).first<Row>();
    } catch (reconciliationError) {
      console.error("Rental report issue requires reconciliation", reconciliationError);
      throw new Error("RENTAL_REPORT_RECONCILIATION_REQUIRED", { cause: error });
    }
    if (committed) {
      const sharePath = rentalReportPath(linkId, secret);
      return {
        reportId,
        reportNumber,
        revision: reportRevision,
        issuedAt,
        expiresAt,
        shareUrl: `${input.origin}${sharePath}`,
        pdfUrl: `${input.origin}/api${sharePath}/pdf`,
      };
    }
    const failedAt = new Date().toISOString();
    let failedReport: Row | null;
    try {
      await db.batch([
        db.prepare(`UPDATE trade_rental_reports SET status = 'failed', updated_at = ?
          WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'`)
          .bind(failedAt, reportId, source.inspection.id, input.access.ownerUid),
        db.prepare(`UPDATE trade_rental_inspections SET status = 'in_progress', revision = revision + 1, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'issuing' AND issued_report_id = ''
            AND revision = ? AND updated_at = ?
            AND EXISTS (SELECT 1 FROM trade_rental_reports report
              WHERE report.id = ? AND report.inspection_id = trade_rental_inspections.id
                AND report.firebase_uid = trade_rental_inspections.firebase_uid
                AND report.status = 'failed' AND report.updated_at = ?)`)
          .bind(failedAt, source.inspection.id, input.access.ownerUid, stagedInspectionRevision,
            issuedAt, reportId, failedAt),
      ]);
      failedReport = await db.prepare(`SELECT id report_id, report_snapshot, revision report_revision,
          pdf_object_key, pdf_sha256, pdf_size_bytes
        FROM trade_rental_reports
        WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'failed' LIMIT 1`)
        .bind(reportId, source.inspection.id, input.access.ownerUid).first<Row>();
    } catch (failureTransitionError) {
      console.error("Rental report failure transition requires reconciliation", failureTransitionError);
      throw new Error("RENTAL_REPORT_RECONCILIATION_REQUIRED", { cause: error });
    }
    if (failedReport) {
      try {
        await cleanupFailedRentalReportObjects(failedReport, input.access.ownerUid);
      } catch (cleanupError) {
        console.error("Rental report object cleanup will be retried", cleanupError);
        throw new Error("RENTAL_REPORT_CLEANUP_REQUIRED", { cause: error });
      }
    }
    throw error;
  }
}

export async function revokeRentalReportLink(input: {
  access: TeamAccess;
  workOrderId: string;
  linkId: string;
}) {
  if (!input.access.canRunReports || !input.access.canManageFieldEvidence) {
    throw new Error("REPORT_PERMISSION_REQUIRED");
  }
  await assignedJob(input.access, input.workOrderId);
  const db = getD1();
  const link = await db.prepare(`SELECT link.id, link.status, link.report_id, link.inspection_id,
      inspection.assessor_member_id
    FROM trade_rental_report_links link
    JOIN trade_rental_inspections inspection ON inspection.id = link.inspection_id
      AND inspection.firebase_uid = link.firebase_uid
    JOIN trade_rental_reports report ON report.id = link.report_id
      AND report.inspection_id = inspection.id AND report.firebase_uid = inspection.firebase_uid
    WHERE link.id = ? AND inspection.work_order_id = ? AND link.firebase_uid = ?
      AND report.status = 'issued' LIMIT 1`)
    .bind(input.linkId, input.workOrderId, input.access.ownerUid).first<Row>();
  if (!link) throw new Error("RENTAL_REPORT_LINK_NOT_FOUND");
  if (!input.access.isOwner && String(link.assessor_member_id || "") !== input.access.memberId) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  if (String(link.status) === "revoked") return { id: String(link.id), status: "revoked" };
  if (String(link.status) !== "active") throw new Error("RENTAL_REPORT_LINK_STOPPED");
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE trade_rental_report_links
      SET status = 'revoked', revoked_at = ?, token_issue = token_issue + 1, updated_at = ?
      WHERE id = ? AND report_id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'active'`)
      .bind(now, now, link.id, link.report_id, link.inspection_id, input.access.ownerUid),
    db.prepare(`INSERT INTO trade_rental_inspection_events
      (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
       event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
      SELECT ?, link.inspection_id, link.report_id, link.id, link.firebase_uid, ?, ?,
        'report_link_revoked', '', 'Public report access was stopped.', '{}', '', '', ?
      FROM trade_rental_report_links link
      WHERE link.id = ? AND link.firebase_uid = ? AND link.status = 'revoked'
        AND link.revoked_at = ? AND link.updated_at = ?`)
      .bind(crypto.randomUUID(), input.access.isOwner ? "owner" : "assessor", input.access.actorUid,
        now, link.id, input.access.ownerUid, now, now),
  ]);
  if (number(results[0]?.meta.changes) !== 1 || number(results[1]?.meta.changes) !== 1) {
    throw new Error("RENTAL_REPORT_LINK_CONFLICT");
  }
  return { id: String(link.id), status: "revoked" };
}

export async function renewRentalReportLink(input: {
  access: TeamAccess;
  workOrderId: string;
  reportId: string;
  origin: string;
}) {
  if (!input.access.canRunReports || !input.access.canManageFieldEvidence) {
    throw new Error("REPORT_PERMISSION_REQUIRED");
  }
  await assignedJob(input.access, input.workOrderId);
  const db = getD1();
  const report = await db.prepare(`SELECT report.id, report.report_number, report.revision,
      inspection.id inspection_id, inspection.assessor_member_id,
      link.id link_id, link.status link_status, link.expires_at, link.token_hash,
      link.encrypted_token, link.token_issue
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
    LEFT JOIN trade_rental_report_links link ON link.id = (
      SELECT latest.id FROM trade_rental_report_links latest
      WHERE latest.report_id = report.id AND latest.inspection_id = report.inspection_id
        AND latest.firebase_uid = report.firebase_uid
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    )
    WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued'
      AND inspection.work_order_id = ? AND inspection.status = 'issued' LIMIT 1`)
    .bind(input.reportId, input.access.ownerUid, input.workOrderId).first<Row>();
  if (!report) throw new Error("RENTAL_REPORT_LINK_NOT_FOUND");
  if (!input.access.isOwner && String(report.assessor_member_id || "") !== input.access.memberId) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  const now = new Date().toISOString();
  if (report.link_status === "active" && String(report.expires_at || "") > now
    && report.link_id && report.token_hash && report.encrypted_token) {
    const secret = await recoverRentalReportSecret(String(report.encrypted_token), String(report.link_id),
      number(report.token_issue), String(report.token_hash));
    const path = rentalReportPath(String(report.link_id), secret);
    return {
      id: String(report.link_id),
      status: "active",
      expiresAt: String(report.expires_at),
      shareUrl: `${input.origin}${path}`,
      pdfUrl: `${input.origin}/api${path}/pdf`,
    };
  }

  const linkId = crypto.randomUUID();
  const secret = newRentalReportSecret();
  const tokenHash = await hashRentalReportSecret(secret);
  const encryptedToken = await protectRentalReportSecret(linkId, 1, secret);
  const expiresAt = rentalReportExpiresAt(now);
  const results = await db.batch([
    db.prepare(`UPDATE trade_rental_report_links SET status = 'expired', updated_at = ?
      WHERE report_id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'active'
        AND expires_at <= ?`)
      .bind(now, report.id, report.inspection_id, input.access.ownerUid, now),
    db.prepare(`INSERT INTO trade_rental_report_links
      (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, token_issue,
       status, expires_at, revoked_at, created_by_uid, last_viewed_at, last_downloaded_at,
       view_count, download_count, created_at, updated_at)
      SELECT ?, report.id, report.inspection_id, report.firebase_uid, ?, ?, 1,
        'active', ?, '', ?, '', '', 0, 0, ?, ?
      FROM trade_rental_reports report
      JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
        AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
      WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued'
        AND inspection.id = ? AND inspection.status = 'issued'
        AND NOT EXISTS (SELECT 1 FROM trade_rental_report_links active_link
          WHERE active_link.report_id = report.id AND active_link.status = 'active')`)
      .bind(linkId, tokenHash, encryptedToken, expiresAt, input.access.actorUid, now, now,
        report.id, input.access.ownerUid, report.inspection_id),
    db.prepare(`INSERT INTO trade_rental_inspection_events
      (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
       event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
      SELECT ?, link.inspection_id, link.report_id, link.id, link.firebase_uid, ?, ?,
        'report_link_renewed', '', 'A new 60-day public report link was created.', ?, '', '', ?
      FROM trade_rental_report_links link
      WHERE link.id = ? AND link.report_id = ? AND link.firebase_uid = ?
        AND link.status = 'active' AND link.created_at = ?`)
      .bind(crypto.randomUUID(), input.access.isOwner ? "owner" : "assessor", input.access.actorUid,
        JSON.stringify({ expiresAt }), now, linkId, report.id, input.access.ownerUid, now),
  ]);
  if (number(results[1]?.meta.changes) !== 1 || number(results[2]?.meta.changes) !== 1) {
    throw new Error("RENTAL_REPORT_LINK_CONFLICT");
  }
  const path = rentalReportPath(linkId, secret);
  return {
    id: linkId,
    status: "active",
    expiresAt,
    shareUrl: `${input.origin}${path}`,
    pdfUrl: `${input.origin}/api${path}/pdf`,
  };
}

export async function authenticatedRentalReportPdf(input: {
  access: TeamAccess;
  workOrderId: string;
  reportId: string;
}) {
  if (!input.access.canRunReports) throw new Error("REPORT_PERMISSION_REQUIRED");
  await assignedJob(input.access, input.workOrderId);
  const row = await getD1().prepare(`SELECT report.id, report.report_number, report.revision,
      report.pdf_object_key, report.pdf_sha256, report.pdf_size_bytes,
      inspection.assessor_member_id
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
    WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued'
      AND inspection.work_order_id = ? AND inspection.status = 'issued' LIMIT 1`)
    .bind(input.reportId, input.access.ownerUid, input.workOrderId).first<Row>();
  if (!row) throw new Error("RENTAL_REPORT_LINK_NOT_FOUND");
  if (!input.access.isOwner && String(row.assessor_member_id || "") !== input.access.memberId) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  const bytes = await readImmutableIssuedPdf({
    objectKey: String(row.pdf_object_key),
    sha256: String(row.pdf_sha256),
    sizeBytes: number(row.pdf_size_bytes),
  }, { kind: "rental-report", documentId: String(row.id), revision: number(row.revision) });
  return { bytes, reportNumber: String(row.report_number), revision: number(row.revision) };
}

export type AuthorisedRentalReport = Row & {
  id: string;
  report_id: string;
  inspection_id: string;
  token_issue: number;
  token_hash: string;
  expires_at: string;
  report_snapshot: string;
  source_snapshot_sha256: string;
};

export async function authoriseRentalReportToken(token: string): Promise<AuthorisedRentalReport> {
  await ensureTradeRentalSchemaGuards(getD1());
  const parsed = splitRentalReportToken(token);
  const tokenHash = await hashRentalReportSecret(parsed.secret);
  const row = await getD1().prepare(`SELECT link.*, report.report_number, report.revision report_revision,
      report.status report_status, report.report_snapshot, report.source_snapshot_sha256,
      report.pdf_object_key, report.pdf_sha256,
      report.pdf_size_bytes, report.issued_at, inspection.status inspection_status,
      inspection.issued_report_id
    FROM trade_rental_report_links link
    JOIN trade_rental_reports report ON report.id = link.report_id
      AND report.inspection_id = link.inspection_id AND report.firebase_uid = link.firebase_uid
    JOIN trade_rental_inspections inspection ON inspection.id = link.inspection_id
      AND inspection.firebase_uid = link.firebase_uid AND inspection.issued_report_id = report.id
    WHERE link.id = ? AND link.token_hash = ? LIMIT 1`)
    .bind(parsed.linkId, tokenHash).first<Row>();
  if (!row || !row.token_hash) {
    throw new Error("RENTAL_REPORT_NOT_FOUND");
  }
  const now = new Date().toISOString();
  if (String(row.expires_at) <= now) throw new Error("RENTAL_REPORT_EXPIRED");
  if (row.status !== "active" || row.report_status !== "issued" || row.inspection_status !== "issued") {
    throw new Error("RENTAL_REPORT_STOPPED");
  }
  if (String(row.source_snapshot_sha256 || "") !== await sha256Text(String(row.report_snapshot || ""))) {
    throw new Error("RENTAL_REPORT_INVALID");
  }
  const snapshot = parsedObject(row.report_snapshot);
  if (snapshot.schemaVersion !== REPORT_SCHEMA_VERSION || parsedObject(snapshot.report).id !== row.report_id) {
    throw new Error("RENTAL_REPORT_INVALID");
  }
  return {
    ...row,
    id: String(row.id),
    report_id: String(row.report_id),
    inspection_id: String(row.inspection_id),
    token_issue: number(row.token_issue),
    token_hash: String(row.token_hash),
    expires_at: String(row.expires_at),
    report_snapshot: String(row.report_snapshot),
    source_snapshot_sha256: String(row.source_snapshot_sha256),
  };
}

export function publicRentalReportPayload(row: AuthorisedRentalReport, token: string) {
  const snapshot = publicRentalReportValue(parsedObject(row.report_snapshot)) as Row;
  delete parsedObject(snapshot.report).id;
  const evidence = parsedArray(snapshot.evidence).map((rawEvidence) => {
    const entry = publicRentalReportValue(rawEvidence) as Row;
    delete entry.objectKey;
    return {
      ...entry,
      viewUrl: `/api/rental-report/${encodeURIComponent(token)}/evidence/${encodeURIComponent(String(entry.id))}`,
    };
  });
  return {
    ...snapshot,
    evidence,
    access: {
      expiresAt: row.expires_at,
      pdfUrl: `/api/rental-report/${encodeURIComponent(token)}/pdf`,
    },
  };
}

export async function recordRentalReportAccess(row: AuthorisedRentalReport, request: Request, eventType: "viewed" | "pdf_downloaded" | "evidence_viewed") {
  const now = new Date().toISOString();
  const sourceIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const ipHash = await rentalReportRequestHash(sourceIp);
  const userAgentHash = await rentalReportRequestHash(userAgent);
  const update = eventType === "viewed"
    ? "last_viewed_at = ?, view_count = view_count + 1"
    : eventType === "pdf_downloaded"
      ? "last_downloaded_at = ?, download_count = download_count + 1"
      : "last_viewed_at = ?";
  await getD1().batch([
    getD1().prepare(`UPDATE trade_rental_report_links SET ${update}, updated_at = ?
      WHERE id = ? AND report_id = ? AND status = 'active' AND expires_at > ?`)
      .bind(now, now, row.id, row.report_id, now),
    getD1().prepare(`INSERT INTO trade_rental_inspection_events
      (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
       event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
      SELECT ?, ?, ?, ?, ?, 'viewer', '', ?, '', ?, '{}', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM trade_rental_inspection_events recent
        WHERE recent.report_link_id = ? AND recent.event_type = ?
          AND recent.source_ip_sha256 = ? AND recent.user_agent_sha256 = ?
          AND recent.created_at >= ?)`)
      .bind(crypto.randomUUID(), row.inspection_id, row.report_id, row.id, row.firebase_uid,
        eventType, eventType === "pdf_downloaded" ? "Issued report PDF downloaded." : eventType === "evidence_viewed" ? "Report evidence viewed." : "Issued report opened.",
        ipHash, userAgentHash, now, row.id, eventType, ipHash, userAgentHash,
        new Date(Date.now() - 15 * 60 * 1000).toISOString()),
  ]);
}

export async function rentalReportPdf(row: AuthorisedRentalReport) {
  return await readImmutableIssuedPdf({
    objectKey: String(row.pdf_object_key),
    sha256: String(row.pdf_sha256),
    sizeBytes: number(row.pdf_size_bytes),
  }, {
    kind: "rental-report",
    documentId: row.report_id,
    revision: number(row.report_revision),
  });
}

export async function rentalReportEvidence(row: AuthorisedRentalReport, evidenceId: string) {
  const snapshot = parsedObject(row.report_snapshot);
  const entry = parsedArray(snapshot.evidence).map(parsedObject).find((candidate) => candidate.id === evidenceId);
  if (!entry || !entry.objectKey || !entry.originalSha256) throw new Error("RENTAL_REPORT_EVIDENCE_NOT_FOUND");
  const object = await bucket().get(String(entry.objectKey));
  if (!object) throw new Error("RENTAL_REPORT_EVIDENCE_NOT_FOUND");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== number(entry.sizeBytes) || await sha256Bytes(bytes) !== String(entry.originalSha256)) {
    throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
  }
  return {
    bytes,
    contentType: String(entry.contentType || object.httpMetadata?.contentType || "application/octet-stream"),
    fileName: cleanFileName(entry.fileName),
  };
}

export async function ownerRentalReportPresentation(input: {
  ownerUid: string;
  inspectionId: string;
  origin: string;
  includeSecret: boolean;
}) {
  const rows = await getD1().prepare(`SELECT report.id, report.report_number, report.revision, report.status,
      report.issued_at, report.pdf_size_bytes, inspection.work_order_id,
      link.id link_id, link.status link_status,
      link.expires_at, link.view_count, link.download_count, link.token_issue,
      link.token_hash, link.encrypted_token
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid
    LEFT JOIN trade_rental_report_links link ON link.id = (
      SELECT latest.id FROM trade_rental_report_links latest
      WHERE latest.report_id = report.id AND latest.inspection_id = report.inspection_id
        AND latest.firebase_uid = report.firebase_uid
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    )
    WHERE report.inspection_id = ? AND report.firebase_uid = ?
    ORDER BY report.revision DESC LIMIT 10`)
    .bind(input.inspectionId, input.ownerUid).all<Row>();
  return await Promise.all(rows.results.map(async (row) => {
    let shareUrl = "";
    let pdfUrl = "";
    const linkExpired = Boolean(row.expires_at) && String(row.expires_at) <= new Date().toISOString();
    const presentedLinkStatus = row.link_status === "active" && linkExpired ? "expired" : String(row.link_status || "");
    if (input.includeSecret && row.link_id && presentedLinkStatus === "active" && row.token_hash && row.encrypted_token) {
      try {
        const secret = await recoverRentalReportSecret(String(row.encrypted_token), String(row.link_id), number(row.token_issue), String(row.token_hash));
        const path = rentalReportPath(String(row.link_id), secret);
        shareUrl = `${input.origin}${path}`;
        pdfUrl = `${input.origin}/api${path}/pdf`;
      } catch {
        shareUrl = "";
      }
    }
    return {
      id: String(row.id),
      reportNumber: String(row.report_number),
      revision: number(row.revision),
      status: String(row.status),
      issuedAt: String(row.issued_at || ""),
      pdfSizeBytes: number(row.pdf_size_bytes),
      internalPdfUrl: input.includeSecret
        ? `${input.origin}/api/trade-rental-inspections/report/${encodeURIComponent(String(row.id))}/pdf?workOrderId=${encodeURIComponent(String(row.work_order_id))}`
        : "",
      link: row.link_id ? {
        id: String(row.link_id), status: presentedLinkStatus, expiresAt: String(row.expires_at),
        viewCount: number(row.view_count), downloadCount: number(row.download_count), shareUrl, pdfUrl,
      } : null,
    };
  }));
}
