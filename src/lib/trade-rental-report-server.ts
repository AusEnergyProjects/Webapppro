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
  rentalAssessmentCheck,
  rentalAssessmentHistoricalCheck,
  rentalRegimeAssessment,
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
import { loadCustomerPlanPdfFonts } from "@/lib/customer-plan-pdf-fonts";
import { rentalEvidenceCapture, rentalEvidencePhotoCapture } from "@/lib/trade-rental-evidence.mjs";
import { rentalAssessorCheckPresentation, rentalShowerAssessmentProjection } from "@/lib/rental-assessor-workflow.mjs";
import { assertRentalModuleCredentialCurrent } from "@/lib/trade-rental-credentials";
import { rentalReportAnswerPresentation, rentalReportCheckStandard } from "@/lib/rental-report-answer.mjs";
import { rentalReportBrandingProfile } from "@/lib/rental-report-branding.mjs";
import { rentalObservationResponseProjection } from "@/lib/rental-quotation.mjs";
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

async function reportIssueContext(access: TeamAccess, workOrderId: string) {
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
  return { job, inspection };
}

async function reportSource(access: TeamAccess, workOrderId: string) {
  const db = getD1();
  const { job, inspection } = await reportIssueContext(access, workOrderId);
  if (String(inspection.status) === "issuing") throw new Error("RENTAL_REPORT_ISSUING");
  if (!["draft", "scheduled", "in_progress", "submitted"].includes(String(inspection.status))
    || ["completed", "cancelled"].includes(String(job.stage))) {
    throw new Error("RENTAL_INSPECTION_LOCKED");
  }
  const [moduleRows, itemRows, findingRows, evidenceRows, business, assessor] = await Promise.all([
    db.prepare(`SELECT * FROM trade_rental_inspection_modules
      WHERE inspection_id = ? AND firebase_uid = ? ORDER BY COALESCE(selected_required, 1) DESC, created_at, id`)
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
  const selectedModuleKeys = parsedArray(inspection.selected_modules_snapshot || inspection.module_selection_snapshot).map(String).sort();
  const storedModuleKeys = moduleRows.results.map((module) => String(module.module_key)).sort();
  if (!selectedModuleKeys.length
    || selectedModuleKeys.length !== storedModuleKeys.length
    || selectedModuleKeys.some((key, index) => key !== storedModuleKeys[index])) {
    throw new Error("RENTAL_MODULE_SET_INVALID");
  }
  if (!moduleRows.results.length || moduleRows.results.some((module) => module.status !== "complete")) {
    throw new Error("RENTAL_MODULES_INCOMPLETE");
  }
  const activeItems = itemRows.results.filter((item) => {
    const assessmentModule = moduleRows.results.find((candidate) => candidate.id === item.module_id);
    const template = parsedObject(assessmentModule?.template_snapshot);
    return Boolean(rentalAssessmentCheck(template, String(item.section_key), String(item.check_key))
      || rentalAssessmentHistoricalCheck(template, String(item.section_key), String(item.check_key)));
  });
  const activeItemIds = new Set(activeItems.map((item) => String(item.id)));
  const activeEvidence = evidenceRows.results.filter((evidence) => activeItemIds.has(String(evidence.item_id)));
  if (activeEvidence.some((evidence) => String(evidence.content_type || "").startsWith("image/")
    && !rentalEvidencePhotoCapture(evidence.evidence_envelope))) {
    throw new Error("RENTAL_EVIDENCE_METADATA_REQUIRED");
  }
  const evidenceCounts = Object.fromEntries(activeEvidence.map((evidence) => String(evidence.item_id))
    .map((itemId) => [itemId, activeEvidence.filter((evidence) => String(evidence.item_id) === itemId).length]));
  const photoCounts = Object.fromEntries(activeItems.map((item) => [String(item.id), activeEvidence.filter((evidence) =>
    String(evidence.item_id) === String(item.id) && evidence.evidence_type === "photo" && String(evidence.content_type).startsWith("image/")).length]));
  const pdfCounts = Object.fromEntries(activeItems.map((item) => [String(item.id), activeEvidence.filter((entry) => entry.item_id === item.id && entry.content_type === "application/pdf").length]));
  const presentedFindings = findingRows.results.filter((finding) => activeItemIds.has(String(finding.item_id))).map(findingPresentation);
  for (const assessmentModule of moduleRows.results) {
    const moduleItems = itemRows.results.filter((item) => item.module_id === assessmentModule.id);
    const completion = rentalAssessmentCompletion({
      moduleTemplate: parsedObject(assessmentModule.template_snapshot),
      answers: parsedObject(assessmentModule.answers),
      items: moduleItems.map((item) => ({
        id: String(item.id), itemKey: String(item.item_key), sectionKey: String(item.section_key),
        checkKey: String(item.check_key), instanceKey: String(item.instance_key || "property"), locationLabel: String(item.location_label || ""),
        outcome: String(item.outcome), requiredEvidenceCount: number(item.required_evidence_count),
        publicNotes: String(item.public_notes || ""),
        responseJson: parsedObject(item.response_json),
      })),
      findings: presentedFindings.filter((finding) => finding.moduleId === assessmentModule.id),
      evidenceCounts,
      photoCounts, pdfCounts,
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
    items: activeItems,
    findings: presentedFindings,
    evidence: activeEvidence,
    business,
    assessor,
  };
}

// Bound storage requests and preserve source order. All writes in a batch must
// settle before an error reaches cleanup, so a late PUT cannot recreate a file.
async function rentalEvidenceBatches<T, R>(entries: T[], task: (entry: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let offset = 0; offset < entries.length; offset += 4) {
    const settled = await Promise.allSettled(entries.slice(offset, offset + 4).map(task));
    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason;
      output.push(result.value);
    }
  }
  return output;
}

async function evidenceForSnapshot(rows: Row[], input: { reportId: string; revision: number }) {
  const store = bucket();
  const assets: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  if (rows.reduce((total, row) => total + number(row.size_bytes), 0) > MAX_RENTAL_REPORT_EVIDENCE_BYTES) {
    throw new Error("RENTAL_REPORT_EVIDENCE_TOO_LARGE");
  }
  let totalEvidenceBytes = 0;
  const loaded = await rentalEvidenceBatches(rows, async (row) => {
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
    const prepared: PreparedRentalEvidenceObject = {
      objectKey: immutableObjectKey,
      bytes,
      contentType,
      evidenceId: publicEvidenceId,
      sha256: actualSha256,
    };
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
    return { entry, prepared };
  });
  for (const { entry, prepared } of loaded) {
    assets[entry.id] = { bytes: prepared.bytes, contentType: prepared.contentType };
  }
  return { evidence: loaded.map(({ entry }) => entry), assets,
    preparedObjects: loaded.map(({ prepared }) => prepared) };
}

async function storePreparedRentalEvidence(
  preparedObjects: PreparedRentalEvidenceObject[],
  input: { reportId: string; revision: number },
) {
  const store = bucket();
  await rentalEvidenceBatches(preparedObjects, async (prepared) => {
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
  });
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
  const projected = source.modules.map((module) => rentalShowerAssessmentProjection({
    moduleTemplate: { ...parsedObject(module.template_snapshot), key: String(module.module_key) },
    items: source.items.filter((item) => item.module_id === module.id).map((item) => ({ ...itemPresentation(item, ""), moduleId: String(module.id) })),
    findings: source.findings.filter((finding) => finding.moduleId === module.id),
  }));
  const reportItems = projected.flatMap((module) => module.items);
  const reportFindings = projected.flatMap((module) => module.findings);
  const itemPublicIds = new Map(reportItems.map((item) => [String(item.id), crypto.randomUUID()]));
  const findingPublicIds = new Map(reportFindings.map((finding) => [String(finding.id), crypto.randomUUID()]));
  const historicalItemIds = new Set(reportItems.filter((item) => source.modules.some((module) => module.id === item.moduleId && module.module_key === "minimum_standards"
    && (item.instanceKey && item.instanceKey !== "property" || parsedArray(parsedObject(module.template_snapshot).historicalChecks)
      .some((entry) => parsedObject(parsedObject(entry).check).key === item.checkKey))))
    .map((item) => String(item.id)));
  const modules = source.modules.map((module) => {
    const template = parsedObject(module.template_snapshot);
    const moduleItems = reportItems.filter((item) => item.moduleId === module.id);
    return {
      id: String(modulePublicIds.get(String(module.id))),
      key: String(module.module_key),
      title: String(module.template_name),
      required: module.selected_required === null || module.selected_required === undefined ? true : Boolean(module.selected_required),
      status: String(module.status),
      reportBoundary: String(template.reportBoundary || ""),
      assessmentScope: String(template.assessmentScope || "current_minimum_standards"),
      credentialGate: String(parsedObject(module.credential_snapshot).gate || template.credentialGate || module.required_capability || ""),
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
          items: moduleItems.filter((item) => item.sectionKey === section.key).map((item) => {
            const historicalCheck = parsedArray(template.historicalChecks).map(parsedObject).find((entry) => entry.sectionKey === section.key && parsedObject(entry.check).key === item.checkKey);
            const assessmentCheck = checks.map(parsedObject).find((check) => check.key === item.checkKey) || (historicalCheck ? parsedObject(historicalCheck.check) : undefined);
            const historicalObservation = historicalItemIds.has(String(item.id));
            const observation = historicalObservation
              ? { response: parsedObject(item.response), retainedResponse: {} }
              : rentalObservationResponseProjection(String(item.checkKey), String(item.outcome), parsedObject(item.response));
            return {
              itemKey: String(item.itemKey), sectionKey: String(item.sectionKey), checkKey: String(item.checkKey),
              instanceKey: String(item.instanceKey), locationLabel: String(item.locationLabel || ""),
              outcome: String(item.outcome), response: observation.response, publicNotes: String(item.publicNotes || ""),
              ...(Object.keys(observation.retainedResponse).length ? { retainedResponse: observation.retainedResponse } : {}),
              answerLabel: rentalReportAnswerPresentation({ ...item, historicalObservation }, {
                moduleKey: module.module_key, check: assessmentCheck, assessmentScope: template.assessmentScope,
              }).label,
              requiredEvidenceCount: number(item.requiredEvidenceCount), completedAt: String(item.completedAt || ""),
              ...(item.derived ? { derived: true } : {}),
              prompt: historicalObservation ? `Earlier observation: ${String(assessmentCheck?.prompt || item.checkKey)}`
                : item.derived ? "2027 showerhead readiness, derived from the recorded WELS rating"
                  : module.module_key === "minimum_standards" ? rentalAssessorCheckPresentation(assessmentCheck || { key: item.checkKey }, { response: observation.response }).prompt : String(assessmentCheck?.prompt || item.checkKey),
              ...(item.evidenceSourceItemId ? { evidenceSourceItemId: String(itemPublicIds.get(String(item.evidenceSourceItemId)) || "") } : {}),
              historicalObservation,
              standardDescription: rentalReportCheckStandard({ ...item, standardDescription: assessmentCheck?.prompt,
                verificationBasis: assessmentCheck?.verificationBasis }, { moduleKey: String(module.module_key) }),
              ...(assessmentCheck?.verificationBasis ? { verificationBasis: String(assessmentCheck.verificationBasis) } : {}),
              effectiveFrom: String(assessmentCheck?.effectiveFrom || ""),
              assessmentPhase: String(assessmentCheck?.assessmentPhase || (template.assessmentScope === "energy_readiness_2027" ? "energy_readiness_2027" : "current")),
              trigger: String(assessmentCheck?.trigger || ""),
              sourceUrl: String(assessmentCheck?.sourceUrl || ""),
              id: String(itemPublicIds.get(String(item.id))),
            };
          }),
        };
      }),
    };
  });
  const minimumAnswers = parsedObject(source.modules.find((module) => module.module_key === "minimum_standards")?.answers);
  const regimeAssessment = rentalRegimeAssessment(minimumAnswers);
  const readiness = source.inspection.assessment_scope === "energy_readiness_2027";
  const fullReadiness = modules.some((module) => module.sections.some((section) => section.items.some((item) => item.assessmentPhase === "energy_readiness_2027")));
  const safetyChecksOnly = !source.modules.some((assessmentModule) => assessmentModule.module_key === "minimum_standards");
  const sources: Row[] = [];
  for (const assessmentModule of source.modules) {
    for (const rawSource of parsedArray(parsedObject(assessmentModule.template_snapshot).sources)) {
      const ruleSource = parsedObject(rawSource);
      if (!sources.some((entry) => entry.url === ruleSource.url && entry.version === ruleSource.version)) sources.push(ruleSource);
    }
  }
  const businessName = String(source.business.document_business_name || source.business.business_name || "TLink trade business");
  const findings = reportFindings.map((finding) => {
    const { id, moduleId, itemId, ...publicFinding } = finding;
    const reportModule = modules.find((module) => module.id === modulePublicIds.get(String(moduleId)));
    const reportItem = reportModule?.sections.flatMap((section) => section.items).find((item) => item.id === itemPublicIds.get(String(itemId)));
    const status = reportModule?.key === "minimum_standards" && publicFinding.status !== "compliant" && publicFinding.severity !== "immediate_safety_risk"
      ? !regimeAssessment.applicable ? "not_tested" : reportItem?.outcome === "does_not_meet" ? reportItem.assessmentPhase === "energy_readiness_2027" ? "recommendation" : "non_compliant" : "not_tested"
      : publicFinding.status;
    return {
      ...publicFinding,
      ...(parsedObject(publicFinding.details).evidenceSourceItemId ? { details: { ...parsedObject(publicFinding.details),
        evidenceSourceItemId: String(itemPublicIds.get(String(parsedObject(publicFinding.details).evidenceSourceItemId)) || "") } } : {}),
      ...(historicalItemIds.has(String(itemId)) ? { historicalObservation: true, title: `Earlier observation: ${String(publicFinding.title || "Recorded issue")}` } : {}),
      status,
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
      branding: rentalReportBrandingProfile(source.business, minimumAnswers.homeStarCommissioned),
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
      title: readiness ? "2027 Victorian rental energy readiness assessment" : safetyChecksOnly ? "Victorian rental safety-check report" : fullReadiness ? "Victorian rental minimum standards assessment and 2027 readiness report" : "Victorian rental minimum standards assessment",
      assessmentScope: readiness ? "energy_readiness_2027" : "current_minimum_standards",
      reportBoundary: readiness ? "Energy readiness assessment for phased future requirements. Planning findings do not establish non-compliance with current rental law. Refer to each recorded standard's date and trigger." : modules.find((module) => module.key === "minimum_standards")?.reportBoundary || "Assessment of the selected safety-check modules.",
      rentalRegime: String(minimumAnswers.rentalRegime || "unconfirmed"),
      applicabilityLimitation: safetyChecksOnly ? "" : regimeAssessment.limitation,
      number: String(source.inspection.inspection_number),
      jurisdiction: "VIC",
      templateKey: String(source.inspection.template_key),
      templateVersion: number(source.inspection.template_version),
      rulesEffectiveFrom: String(source.inspection.rules_effective_from),
      assessmentDate: String(minimumAnswers.inspectionDate || ""),
    },
    issuer: {
      name: [String(source.assessor.first_name || ""), String(source.assessor.last_name || "")].filter(Boolean).join(" ") || String(source.assessor.display_name || ""),
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
    sources,
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
  await rentalEvidenceBatches(evidenceKeys, (objectKey) => bucket().delete(objectKey));
  const removedPdfReference = row.pdf_object_key && row.pdf_sha256 && number(row.pdf_size_bytes) > 0
    ? { objectKey: String(row.pdf_object_key), sha256: String(row.pdf_sha256), sizeBytes: number(row.pdf_size_bytes) }
    : null;
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
    .bind(JSON.stringify({ cleanupCompletedAt: cleanedAt, removedObjectCount: evidenceKeys.length + (removedPdfReference ? 1 : 0), removedPdfReference }),
      cleanedAt, row.report_id, ownerUid, String(row.pdf_object_key || ""),
      String(row.pdf_sha256 || ""), number(row.pdf_size_bytes))
    .run();
  if (number(cleaned.meta.changes) === 1) return;
  // Another cleanup may have completed these same immutable objects while our
  // deletes were in flight. Only its exact completed manifest confirms success.
  const completed = await getD1().prepare(`SELECT issuer_snapshot FROM trade_rental_reports
    WHERE id = ? AND firebase_uid = ? AND status = 'failed' AND revision = ?
      AND report_snapshot = ? AND pdf_object_key = '' AND pdf_sha256 = '' AND pdf_size_bytes = 0`)
    .bind(row.report_id, ownerUid, number(row.report_revision), String(row.report_snapshot || "{}"))
    .first<Row>();
  const manifest = parsedObject(completed?.issuer_snapshot);
  if (typeof manifest.cleanupCompletedAt !== "string" || !manifest.cleanupCompletedAt
    || manifest.removedObjectCount !== evidenceKeys.length + (removedPdfReference ? 1 : 0)
    || canonicalRentalJson(manifest.removedPdfReference) !== canonicalRentalJson(removedPdfReference)) {
    throw new Error("RENTAL_REPORT_CLEANUP_CONFLICT");
  }
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

type RentalReportIssueInput = { access: TeamAccess; workOrderId: string; origin: string };

export async function recoverRentalAssessmentReport(input: Pick<RentalReportIssueInput, "access" | "workOrderId">) {
  await ensureTradeRentalSchemaGuards(getD1());
  const context = await reportIssueContext(input.access, input.workOrderId);
  if (String(context.inspection.status) === "issuing") {
    await recoverStaleRentalIssuance(input.access.ownerUid, input.workOrderId);
  }
}

async function currentIssuedReport(context: Awaited<ReturnType<typeof reportIssueContext>>, input: RentalReportIssueInput) {
  if (String(context.inspection.status) !== "issued") return null;
  const reports = await ownerRentalReportPresentation({ ownerUid: input.access.ownerUid,
    inspectionId: String(context.inspection.id), origin: input.origin, includeSecret: true });
  const report = reports.find((entry) => entry.id === String(context.inspection.issued_report_id) && entry.status === "issued");
  if (!report) throw new Error("RENTAL_REPORT_RECONCILIATION_REQUIRED");
  return { reportId: report.id, reportNumber: report.reportNumber, revision: report.revision, issuedAt: report.issuedAt,
    expiresAt: report.link?.expiresAt || "", shareUrl: report.link?.shareUrl || "", pdfUrl: report.link?.pdfUrl || "" };
}

export async function issueRentalAssessmentReport(input: RentalReportIssueInput) {
  await ensureTradeRentalSchemaGuards(getD1());
  const context = await reportIssueContext(input.access, input.workOrderId);
  const existing = await currentIssuedReport(context, input);
  if (existing) return existing;
  if (["completed", "cancelled"].includes(String(context.job.stage))) throw new Error("RENTAL_INSPECTION_LOCKED");
  await recoverStaleRentalIssuance(input.access.ownerUid, input.workOrderId);
  try {
    return await createRentalAssessmentReport(input);
  } catch (error) {
    if (error instanceof Error && ["RENTAL_REPORT_ISSUING", "RENTAL_INSPECTION_LOCKED", "RENTAL_REPORT_ISSUE_CONFLICT"].includes(error.message)) {
      const current = await reportIssueContext(input.access, input.workOrderId);
      const issued = await currentIssuedReport(current, input);
      if (issued) return issued;
      if (String(current.inspection.status) === "issuing") throw new Error("RENTAL_REPORT_ISSUING");
    }
    throw error;
  }
}

type RentalReportCorrectionInput = RentalReportIssueInput & {
  reportId: string;
  expectedInspectionRevision: number;
};
type RentalReportCorrectionKind = "formatting" | "cooling_access";

// Both the staging claim and final commit evaluate the email journal in their
// database statement. A review release or delivery claim cannot race this check.
const formattingReviewHeldSql = `COALESCE((SELECT review.event_type
  FROM trade_rental_inspection_events review
  WHERE review.inspection_id = inspection.id AND review.firebase_uid = inspection.firebase_uid
    AND review.actor_type = 'owner' AND review.actor_uid = inspection.firebase_uid
    AND review.event_type IN ('report_email_review_held', 'report_email_review_released')
  ORDER BY review.rowid DESC LIMIT 1), '') = 'report_email_review_held'`;
const formattingDeliveryBlockedSql = `EXISTS (SELECT 1 FROM trade_rental_inspection_events delivery
  WHERE delivery.inspection_id = inspection.id AND delivery.firebase_uid = inspection.firebase_uid
    AND (delivery.event_type = 'report_email_accepted'
      OR (delivery.event_type = 'report_email_failed' AND json_extract(delivery.metadata, '$.outcome') = 'indeterminate')
      OR (delivery.event_type = 'report_email_requested' AND NOT EXISTS (
        SELECT 1 FROM trade_rental_inspection_events failure
        WHERE failure.inspection_id = delivery.inspection_id AND failure.firebase_uid = delivery.firebase_uid
          AND failure.report_id = delivery.report_id AND failure.event_type = 'report_email_failed'
          AND failure.request_id = delivery.request_id || ':failed'))))`;

async function recoverStaleRentalFormatting(ownerUid: string, workOrderId: string) {
  const db = getD1();
  await retryFailedRentalReportCleanup(ownerUid, workOrderId);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const stale = await db.prepare(`SELECT report.id report_id, report.report_snapshot,
      report.revision report_revision, report.pdf_object_key, report.pdf_sha256, report.pdf_size_bytes
    FROM trade_rental_reports report
    JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
      AND inspection.firebase_uid = report.firebase_uid
    WHERE inspection.work_order_id = ? AND inspection.firebase_uid = ? AND inspection.status = 'issued'
      AND report.status = 'staged' AND report.updated_at < ?
      AND EXISTS (SELECT 1 FROM trade_rental_inspection_events requested
        WHERE requested.inspection_id = inspection.id AND requested.firebase_uid = inspection.firebase_uid
          AND requested.report_id = report.id
          AND requested.event_type IN ('report_formatting_revision_requested', 'report_answer_revision_requested')
          AND requested.actor_type = 'owner' AND requested.actor_uid = inspection.firebase_uid)`)
    .bind(workOrderId, ownerUid, cutoff).all<Row>();
  for (const row of stale.results) {
    const failedAt = new Date().toISOString();
    const failed = await db.prepare(`UPDATE trade_rental_reports SET status = 'failed', updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'staged' AND updated_at < ?`)
      .bind(failedAt, row.report_id, ownerUid, cutoff).run();
    if (number(failed.meta.changes) !== 1) continue;
    await cleanupFailedRentalReportObjects(row, ownerUid);
  }
}

function correctFrozenCoolingAccess(snapshot: Row, input: { ownerUid: string; generatedAt: string }) {
  const matches: { item: Row; fieldPath: string }[] = [];
  parsedArray(snapshot.modules).forEach((rawModule, moduleIndex) => {
    parsedArray(parsedObject(rawModule).sections).forEach((rawSection, sectionIndex) => {
      parsedArray(parsedObject(rawSection).items).forEach((rawItem, itemIndex) => {
        const item = parsedObject(rawItem);
        if (item.checkKey === "cooling_2027_readiness") matches.push({ item,
          fieldPath: `$.modules[${moduleIndex}].sections[${sectionIndex}].items[${itemIndex}].response.accessStatus` });
      });
    });
  });
  if (matches.length !== 1) throw new Error("RENTAL_REPORT_COOLING_ACCESS_INVALID");
  const { item, fieldPath } = matches[0];
  const response = parsedObject(item.response);
  if (!String(item.id || "") || response.applianceType !== "No fixed cooling" || response.accessStatus !== "Not accessed") {
    throw new Error("RENTAL_REPORT_COOLING_ACCESS_INVALID");
  }
  response.accessStatus = "Clear access";
  for (const rawFinding of parsedArray(snapshot.findings)) {
    const finding = parsedObject(rawFinding);
    if (finding.itemId !== item.id) continue;
    const retainedResponse = parsedObject(parsedObject(finding.details).responseSnapshot);
    if (!Object.hasOwn(retainedResponse, "accessStatus")) continue;
    if (retainedResponse.accessStatus !== "Not accessed") throw new Error("RENTAL_REPORT_COOLING_ACCESS_INVALID");
    retainedResponse.accessStatus = "Clear access";
  }
  return { field: "accessStatus", fieldPath, checkKey: "cooling_2027_readiness", itemId: String(item.id),
    fromValue: "Not accessed", toValue: "Clear access", correctedByOwnerUid: input.ownerUid, correctedAt: input.generatedAt };
}

async function frozenCorrectionSnapshot(report: Row, input: {
  reportId: string; reportNumber: string; revision: number; generatedAt: string;
  kind: RentalReportCorrectionKind; ownerUid: string;
}) {
  const originalJson = String(report.report_snapshot || "");
  if (await sha256Text(originalJson) !== String(report.source_snapshot_sha256)) {
    throw new Error("RENTAL_REPORT_INVALID");
  }
  const snapshot = parsedObject(originalJson);
  const reportMetadata = parsedObject(snapshot.report);
  if (snapshot.schemaVersion !== REPORT_SCHEMA_VERSION || reportMetadata.id !== report.id
    || reportMetadata.number !== report.report_number || reportMetadata.revision !== report.revision) {
    throw new Error("RENTAL_REPORT_INVALID");
  }
  const answerCorrection = input.kind === "cooling_access"
    ? correctFrozenCoolingAccess(snapshot, input) : null;
  await readImmutableIssuedPdf({ objectKey: String(report.pdf_object_key), sha256: String(report.pdf_sha256),
    sizeBytes: number(report.pdf_size_bytes) }, { kind: "rental-report", documentId: String(report.id), revision: number(report.revision) });
  const evidence = parsedArray(snapshot.evidence).map(parsedObject);
  const assets: Record<string, { bytes: Uint8Array; contentType: string }> = {};
  const sourcePrefix = `trade-issued-documents/rental-report/${safeObjectSegment(report.id, "unknown")}/revision-${number(report.revision)}/evidence/`;
  const evidenceIds = new Set(evidence.map((entry) => String(entry.id || "")));
  if (evidenceIds.size !== evidence.length || evidenceIds.has("")
    || evidence.reduce((total, entry) => total + number(entry.sizeBytes), 0) > MAX_RENTAL_REPORT_EVIDENCE_BYTES) {
    throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
  }
  let actualTotalBytes = 0;
  const preparedObjects = await rentalEvidenceBatches(evidence, async (entry) => {
    const sourceKey = String(entry.objectKey || "");
    if (!sourceKey.startsWith(sourcePrefix)) throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
    const object = await bucket().get(sourceKey);
    if (!object) throw new Error("RENTAL_REPORT_EVIDENCE_UNAVAILABLE");
    const bytes = new Uint8Array(await object.arrayBuffer());
    actualTotalBytes += bytes.byteLength;
    const sha256 = await sha256Bytes(bytes);
    if (bytes.byteLength !== number(entry.sizeBytes) || sha256 !== String(entry.originalSha256 || "")
      || actualTotalBytes > MAX_RENTAL_REPORT_EVIDENCE_BYTES) throw new Error("RENTAL_REPORT_EVIDENCE_INTEGRITY");
    const contentType = String(entry.contentType || "application/octet-stream");
    const objectKey = immutableRentalEvidenceKey({ reportId: input.reportId, revision: input.revision,
      evidenceId: String(entry.id), sha256, fileName: String(entry.fileName) });
    assets[String(entry.id)] = { bytes, contentType };
    entry.objectKey = objectKey;
    return { objectKey, bytes, contentType, evidenceId: String(entry.id), sha256 };
  });
  snapshot.evidence = evidence;
  const sourceCorrection = { sourceReportId: String(report.id), sourceReportNumber: String(report.report_number),
    sourceReportRevision: number(report.revision), sourceIssuedAt: String(report.issued_at) };
  snapshot.report = { ...reportMetadata, id: input.reportId, number: input.reportNumber,
    revision: input.revision, issuedAt: input.generatedAt, generatedAt: input.generatedAt,
    ...(answerCorrection ? { answerCorrection: { ...sourceCorrection, ...answerCorrection } }
      : { formattingCorrection: sourceCorrection }) };
  return { snapshot, assets, preparedObjects, answerCorrection };
}

export async function correctRentalAssessmentReportFormatting(input: RentalReportCorrectionInput) {
  return createRentalAssessmentReportCorrection(input, "formatting");
}

export async function correctRentalAssessmentCoolingAccess(input: RentalReportCorrectionInput) {
  return createRentalAssessmentReportCorrection(input, "cooling_access");
}

async function createRentalAssessmentReportCorrection(input: RentalReportCorrectionInput, kind: RentalReportCorrectionKind) {
  if (!input.access.isOwner || input.access.actorUid !== input.access.ownerUid || !input.access.canRunReports
    || !input.access.canManageFieldEvidence) {
    throw new Error("REPORT_DELIVERY_OWNER_REQUIRED");
  }
  if (!Number.isSafeInteger(input.expectedInspectionRevision) || input.expectedInspectionRevision < 1) {
    throw new Error("RENTAL_REPORT_FORMATTING_CONFLICT");
  }
  const db = getD1();
  const requestedEvent = kind === "formatting" ? "report_formatting_revision_requested" : "report_answer_revision_requested";
  const issuedEvent = kind === "formatting" ? "report_formatting_revision_issued" : "report_answer_revision_issued";
  await ensureTradeRentalSchemaGuards(db);
  const job = await assignedJob(input.access, input.workOrderId);
  await recoverStaleRentalFormatting(input.access.ownerUid, input.workOrderId);
  const inspection = await db.prepare(`SELECT * FROM trade_rental_inspections
    WHERE work_order_id = ? AND firebase_uid = ? AND status = 'issued' LIMIT 1`)
    .bind(input.workOrderId, input.access.ownerUid).first<Row>();
  if (!inspection) throw new Error("RENTAL_INSPECTION_LOCKED");
  const replay = await db.prepare(`SELECT report.id
    FROM trade_rental_reports report JOIN trade_rental_inspection_events corrected
      ON corrected.report_id = report.id AND corrected.inspection_id = report.inspection_id
        AND corrected.firebase_uid = report.firebase_uid
    WHERE report.id = ? AND report.inspection_id = ? AND report.firebase_uid = ? AND report.status = 'issued'
      AND corrected.event_type = ?
      AND json_extract(corrected.metadata, '$.sourceReportId') = ?
      AND json_extract(corrected.metadata, '$.expectedInspectionRevision') = ? LIMIT 1`)
    .bind(inspection.issued_report_id, inspection.id, input.access.ownerUid, issuedEvent,
      input.reportId, input.expectedInspectionRevision).first<Row>();
  if (replay) return currentIssuedReport({ job, inspection }, input);
  if (String(inspection.issued_report_id) !== input.reportId || number(inspection.revision) !== input.expectedInspectionRevision) {
    throw new Error("RENTAL_REPORT_FORMATTING_CONFLICT");
  }
  const review = await db.prepare(`SELECT inspection.id,
      CASE WHEN ${formattingReviewHeldSql} THEN 1 ELSE 0 END review_held,
      CASE WHEN ${formattingDeliveryBlockedSql} THEN 1 ELSE 0 END delivery_blocked
    FROM trade_rental_inspections inspection WHERE inspection.id = ? AND inspection.firebase_uid = ?`)
    .bind(inspection.id, input.access.ownerUid).first<Row>();
  if (!number(review?.review_held)) throw new Error("REPORT_DELIVERY_REVIEW_REQUIRED");
  if (number(review?.delivery_blocked)) throw new Error("REPORT_DELIVERY_ALREADY_SENDING");
  const pending = await db.prepare(`SELECT id FROM trade_rental_reports
    WHERE inspection_id = ? AND firebase_uid = ? AND status = 'staged' LIMIT 1`)
    .bind(inspection.id, input.access.ownerUid).first<Row>();
  if (pending) throw new Error("RENTAL_REPORT_FORMATTING_PENDING");
  const original = await db.prepare(`SELECT * FROM trade_rental_reports
    WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'issued' LIMIT 1`)
    .bind(input.reportId, inspection.id, input.access.ownerUid).first<Row>();
  if (!original) throw new Error("RENTAL_REPORT_LINK_NOT_FOUND");
  const revisionRow = await db.prepare(`SELECT COALESCE(MAX(revision), 0) revision
    FROM trade_rental_reports WHERE inspection_id = ? AND firebase_uid = ?`)
    .bind(inspection.id, input.access.ownerUid).first<Row>();
  const revision = number(revisionRow?.revision) + 1;
  const reportId = crypto.randomUUID();
  const reportNumber = `${String(inspection.inspection_number)}-R${revision}`;
  const generatedAt = new Date().toISOString();
  const linkId = crypto.randomUUID();
  const secret = newRentalReportSecret();
  const expiresAt = rentalReportExpiresAt(generatedAt);
  let pdfReference: ImmutableIssuedPdfReference | null = null;
  let stored: ImmutableIssuedPdfReference | null = null;
  try {
    const { snapshot, assets, preparedObjects, answerCorrection } = await frozenCorrectionSnapshot(original,
      { reportId, reportNumber, revision, generatedAt, kind, ownerUid: input.access.ownerUid });
    const snapshotJson = canonicalRentalJson(snapshot);
    const sourceSnapshotSha256 = await sha256Text(snapshotJson);
    const sourceMetadata = { sourceReportId: String(original.id), sourceReportNumber: String(original.report_number),
      sourceReportRevision: number(original.revision), sourceSnapshotSha256: String(original.source_snapshot_sha256),
      sourceIssuedAt: String(original.issued_at), expectedInspectionRevision: input.expectedInspectionRevision,
      reportRevision: revision, snapshotSha256: sourceSnapshotSha256, ...(answerCorrection || {}) };
    const staged = await db.batch([
      db.prepare(`INSERT INTO trade_rental_reports
        (id, inspection_id, firebase_uid, report_number, revision, status, report_schema_version,
         report_snapshot, source_snapshot_sha256, pdf_object_key, pdf_sha256, pdf_size_bytes,
         issued_by_uid, issued_by_member_id, issuer_snapshot, staged_at, issued_at, superseded_at, created_at, updated_at)
        SELECT ?, inspection.id, inspection.firebase_uid, ?, ?, 'staged', ?, ?, ?, '', '', 0,
          '', '', '{}', ?, '', '', ?, ? FROM trade_rental_inspections inspection
        WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.work_order_id = ?
          AND inspection.status = 'issued' AND inspection.issued_report_id = ? AND inspection.revision = ?
          AND ${formattingReviewHeldSql} AND NOT ${formattingDeliveryBlockedSql}
          AND NOT EXISTS (SELECT 1 FROM trade_rental_reports pending
            WHERE pending.inspection_id = inspection.id AND pending.firebase_uid = inspection.firebase_uid AND pending.status = 'staged')`)
        .bind(reportId, reportNumber, revision, REPORT_SCHEMA_VERSION, snapshotJson, sourceSnapshotSha256,
          generatedAt, generatedAt, generatedAt, inspection.id, input.access.ownerUid, input.workOrderId,
          input.reportId, input.expectedInspectionRevision),
      db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
        SELECT ?, inspection.id, report.id, inspection.firebase_uid, 'owner', ?, ?, ?, ?, ?, ?
        FROM trade_rental_reports report JOIN trade_rental_inspections inspection
          ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid
        WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'staged'
          AND inspection.status = 'issued' AND inspection.issued_report_id = ? AND inspection.revision = ?`)
        .bind(crypto.randomUUID(), input.access.actorUid, requestedEvent, `report-correction:${reportId}:requested`,
          kind === "formatting" ? `${reportNumber} requested to correct report formatting without changing the assessment.`
            : `${reportNumber} requested to correct the recorded cooling access answer from Not accessed to Clear access.`, JSON.stringify(sourceMetadata),
          generatedAt, reportId, input.access.ownerUid, input.reportId, input.expectedInspectionRevision),
    ]);
    if (number(staged[0]?.meta.changes) !== 1 || number(staged[1]?.meta.changes) !== 1) {
      throw new Error("RENTAL_REPORT_FORMATTING_CONFLICT");
    }
    await storePreparedRentalEvidence(preparedObjects, { reportId, revision });
    const fonts = await loadCustomerPlanPdfFonts();
    const { createRentalAssessmentPdfBytes } = await import("@/lib/trade-rental-report-pdf.mjs");
    const { rentalReportBrandBytes } = await import("@/lib/trade-rental-report-brand");
    const pdfBytes = await createRentalAssessmentPdfBytes(snapshot, assets, fonts, rentalReportBrandBytes(snapshot));
    pdfReference = await prepareImmutableIssuedPdfReference({ kind: "rental-report", documentId: reportId, revision, bytes: pdfBytes });
    const prepared = await db.prepare(`UPDATE trade_rental_reports SET pdf_object_key = ?, pdf_sha256 = ?, pdf_size_bytes = ?, updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'
        AND source_snapshot_sha256 = ? AND report_snapshot = ? AND pdf_object_key = '' AND pdf_sha256 = '' AND pdf_size_bytes = 0`)
      .bind(pdfReference.objectKey, pdfReference.sha256, pdfReference.sizeBytes, new Date().toISOString(),
        reportId, inspection.id, input.access.ownerUid, sourceSnapshotSha256, snapshotJson).run();
    if (number(prepared.meta.changes) !== 1) throw new Error("RENTAL_REPORT_FORMATTING_CONFLICT");
    stored = await storeImmutableIssuedPdf({ kind: "rental-report", documentId: reportId, revision, bytes: pdfBytes, expectedSha256: pdfReference.sha256 });
    const tokenHash = await hashRentalReportSecret(secret);
    const encryptedToken = await protectRentalReportSecret(linkId, 1, secret);
    const nextInspectionRevision = input.expectedInspectionRevision + 1;
    const nextWorkRevision = nextJobRevision(job.revision);
    const committedAt = new Date().toISOString();
    await guardedOnlineJobMutationBatch(db, [
      db.prepare(`UPDATE trade_rental_reports SET status = 'issued', issued_by_uid = ?, issued_by_member_id = ?,
          issuer_snapshot = ?, issued_at = ?, updated_at = ?
        WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'
          AND source_snapshot_sha256 = ? AND report_snapshot = ? AND pdf_object_key = ? AND pdf_sha256 = ? AND pdf_size_bytes = ?
          AND EXISTS (SELECT 1 FROM trade_rental_inspections inspection
            WHERE inspection.id = trade_rental_reports.inspection_id AND inspection.firebase_uid = trade_rental_reports.firebase_uid
              AND inspection.status = 'issued' AND inspection.issued_report_id = ? AND inspection.revision = ?
              AND ${formattingReviewHeldSql} AND NOT ${formattingDeliveryBlockedSql})`)
        .bind(original.issued_by_uid, original.issued_by_member_id, original.issuer_snapshot, generatedAt, committedAt,
          reportId, inspection.id, input.access.ownerUid, sourceSnapshotSha256, snapshotJson, stored.objectKey, stored.sha256, stored.sizeBytes,
          input.reportId, input.expectedInspectionRevision),
      db.prepare(`UPDATE trade_rental_inspections SET issued_report_id = ?, revision = ?, updated_at = ?
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND status = 'issued' AND issued_report_id = ? AND revision = ?
          AND EXISTS (SELECT 1 FROM trade_rental_reports report WHERE report.id = ?
            AND report.inspection_id = trade_rental_inspections.id AND report.firebase_uid = trade_rental_inspections.firebase_uid
            AND report.status = 'issued' AND report.pdf_object_key = ? AND report.pdf_sha256 = ? AND report.pdf_size_bytes = ?)`)
        .bind(reportId, nextInspectionRevision, committedAt, inspection.id, input.workOrderId, input.access.ownerUid,
          input.reportId, input.expectedInspectionRevision, reportId, stored.objectKey, stored.sha256, stored.sizeBytes),
      db.prepare(`INSERT INTO trade_rental_report_links
        (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, token_issue, status, expires_at,
         revoked_at, created_by_uid, last_viewed_at, last_downloaded_at, view_count, download_count, created_at, updated_at)
        SELECT ?, report.id, inspection.id, report.firebase_uid, ?, ?, 1, 'active', ?, '', ?, '', '', 0, 0, ?, ?
        FROM trade_rental_reports report JOIN trade_rental_inspections inspection
          ON inspection.id = report.inspection_id AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
        WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued' AND inspection.status = 'issued' AND inspection.revision = ?`)
        .bind(linkId, tokenHash, encryptedToken, expiresAt, input.access.actorUid, committedAt, committedAt,
          reportId, input.access.ownerUid, nextInspectionRevision),
      db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND stage = ? AND revision = ?
          AND EXISTS (SELECT 1 FROM trade_rental_report_links link WHERE link.id = ? AND link.report_id = ? AND link.status = 'active')`)
        .bind(nextWorkRevision, committedAt, input.workOrderId, input.access.ownerUid, job.stage, job.revision, linkId, reportId),
      db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, created_at)
        SELECT ?, inspection.id, report.id, ?, inspection.firebase_uid, 'owner', ?, ?, ?, ?, ?, ?
        FROM trade_rental_inspections inspection JOIN trade_rental_reports report
          ON report.id = inspection.issued_report_id AND report.inspection_id = inspection.id AND report.firebase_uid = inspection.firebase_uid
        WHERE inspection.id = ? AND inspection.firebase_uid = ? AND inspection.status = 'issued' AND inspection.revision = ? AND report.id = ? AND report.status = 'issued'`)
        .bind(crypto.randomUUID(), linkId, input.access.actorUid, issuedEvent, `report-correction:${reportId}:issued`,
          kind === "formatting" ? `${reportNumber} corrects formatting in ${String(original.report_number)}. The original assessment and report are retained.`
            : `${reportNumber} records the business owner's cooling access answer correction. The original assessment and report are retained.`,
          JSON.stringify(sourceMetadata), committedAt, inspection.id, input.access.ownerUid, nextInspectionRevision, reportId),
      ...jobSyncChangeStatements(db, { ownerUid: input.access.ownerUid, workOrderId: input.workOrderId,
        revision: nextWorkRevision, changedAt: committedAt, audienceMemberId: String(job.assignee_member_id || "") }),
    ], { kind: "stage", jobRevision: nextWorkRevision, jobStage: String(job.stage), ownerUid: input.access.ownerUid,
      updatedAt: committedAt, workOrderId: input.workOrderId });
    const path = rentalReportPath(linkId, secret);
    return { reportId, reportNumber, revision, issuedAt: generatedAt, expiresAt,
      shareUrl: `${input.origin}${path}`, pdfUrl: `${input.origin}/api${path}` + "/pdf" };
  } catch (error) {
    const expectedPdf = stored || pdfReference;
    let committed: Row | null;
    try {
      committed = await db.prepare(`SELECT report.id FROM trade_rental_reports report
        JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
          AND inspection.firebase_uid = report.firebase_uid AND inspection.issued_report_id = report.id
        WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued' AND inspection.status = 'issued'
          AND report.pdf_object_key = ? AND report.pdf_sha256 = ? AND report.pdf_size_bytes = ?`)
        .bind(reportId, input.access.ownerUid, expectedPdf?.objectKey || "", expectedPdf?.sha256 || "", expectedPdf?.sizeBytes || 0).first<Row>();
    } catch (cause) {
      throw new Error("RENTAL_REPORT_RECONCILIATION_REQUIRED", { cause });
    }
    if (committed) {
      const path = rentalReportPath(linkId, secret);
      return { reportId, reportNumber, revision, issuedAt: generatedAt, expiresAt,
        shareUrl: `${input.origin}${path}`, pdfUrl: `${input.origin}/api${path}` + "/pdf" };
    }
    await db.prepare(`UPDATE trade_rental_reports SET status = 'failed', updated_at = ?
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'staged'`)
      .bind(new Date().toISOString(), reportId, inspection.id, input.access.ownerUid).run();
    const failed = await db.prepare(`SELECT id report_id, report_snapshot, revision report_revision,
      pdf_object_key, pdf_sha256, pdf_size_bytes FROM trade_rental_reports
      WHERE id = ? AND inspection_id = ? AND firebase_uid = ? AND status = 'failed'`)
      .bind(reportId, inspection.id, input.access.ownerUid).first<Row>();
    if (failed) {
      try { await cleanupFailedRentalReportObjects(failed, input.access.ownerUid); }
      catch (cause) { throw new Error("RENTAL_REPORT_CLEANUP_REQUIRED", { cause }); }
    }
    throw error;
  }
}

async function createRentalAssessmentReport(input: RentalReportIssueInput) {
  const db = getD1();
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
    const { createRentalAssessmentPdfBytes } = await import(
      "@/lib/trade-rental-report-pdf.mjs"
    );
    const { rentalReportBrandBytes } = await import("@/lib/trade-rental-report-brand");
    const pdfBytes = await createRentalAssessmentPdfBytes(snapshot, assets, fonts, rentalReportBrandBytes(snapshot));
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

// A formatting revision retains the original issued report and its existing
// links. Only an audited, successfully issued correction permits a historical
// report to be read independently of the inspection's current report pointer.
const issuedRentalReportVisibilitySql = `(inspection.issued_report_id = report.id OR EXISTS (
  SELECT 1 FROM trade_rental_inspection_events correction
  JOIN trade_rental_reports corrected ON corrected.id = correction.report_id
    AND corrected.inspection_id = correction.inspection_id AND corrected.firebase_uid = correction.firebase_uid
  WHERE correction.inspection_id = inspection.id AND correction.firebase_uid = inspection.firebase_uid
    AND correction.event_type IN ('report_formatting_revision_issued', 'report_answer_revision_issued')
    AND correction.actor_type = 'owner' AND correction.actor_uid = inspection.firebase_uid
    AND json_extract(correction.metadata, '$.sourceReportId') = report.id
    AND corrected.status = 'issued'))`;

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
      AND inspection.firebase_uid = report.firebase_uid
    WHERE report.id = ? AND report.firebase_uid = ? AND report.status = 'issued'
      AND inspection.work_order_id = ? AND inspection.status = 'issued'
      AND ${issuedRentalReportVisibilitySql} LIMIT 1`)
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
      AND inspection.firebase_uid = link.firebase_uid
    WHERE link.id = ? AND link.token_hash = ? AND ${issuedRentalReportVisibilitySql} LIMIT 1`)
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
  for (const key of ["formattingCorrection", "answerCorrection"]) {
    const correction = parsedObject(parsedObject(snapshot.report)[key]);
    delete correction.sourceReportId;
    delete correction.correctedByOwnerUid;
  }
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
