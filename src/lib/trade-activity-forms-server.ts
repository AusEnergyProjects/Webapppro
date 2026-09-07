import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { assignedJob, type TeamAccess } from "./trade-team-server";
import { activityPrefill, defaultActivityFieldForm } from "./trade-activity-forms-library.ts";
import {
  activityCanonical, activityConditionMet, activityDeclarationText, activityHash, activityMissing, activitySigningScope,
  assertActivityEditable, assertActivitySignedScopeUnchanged, normaliseActivityAnswers, validateActivityStrokes,
  type ActivityEvidence, type ActivityForm, type ActivityRecord,
} from "./trade-activity-forms.ts";
import { expandedActivityFields } from "./trade-activity-form-flow.ts";

type Row = Record<string, unknown>;
type Bucket = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void> };
function bucket() {
  const value = (env as unknown as { EVIDENCE?: Bucket }).EVIDENCE;
  if (!value) throw new Error("ACTIVITY_STORAGE_UNAVAILABLE");
  return value;
}
const iso = () => new Date().toISOString();
const string = (value: unknown, maximum = 180) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
export function activityPresentation(record: ActivityRecord) {
  const missing = activityMissing(record);
  const total = expandedActivityFields(record.form, record.answers).filter((field) => field.required).length
    + record.form.declarations.filter((item) => item.required && activityConditionMet(item.condition, record.answers)).length;
  return { ...record, evidence: record.evidence.map(({ objectKey, previewObjectKey, ...item }) => { void objectKey; void previewObjectKey; return item; }), missing,
    progress: { complete: Math.max(0, total - missing.length), total },
    reportUrl: record.status === "submitted_for_creditex_review" ? `/api/trade-activity-forms?recordId=${encodeURIComponent(record.id)}&view=pdf` : "" };
}

export function assertActivityFieldAccess(access: Pick<TeamAccess, "isOwner" | "canViewFieldEvidence" | "canManageFieldEvidence">, mutate = false) {
  if (!access.isOwner && !(mutate ? access.canManageFieldEvidence : access.canViewFieldEvidence)) throw new Error("ACTIVITY_ACCESS_REQUIRED");
}

export async function loadActivityRecord(access: TeamAccess, id: string, mutate = false): Promise<ActivityRecord> {
  assertActivityFieldAccess(access, mutate);
  const row = await getD1().prepare("SELECT payload FROM trade_activity_field_records WHERE id = ? AND owner_uid = ?")
    .bind(id, access.ownerUid).first<{ payload: string }>();
  if (!row) throw new Error("ACTIVITY_RECORD_NOT_FOUND");
  const record: ActivityRecord = JSON.parse(row.payload);
  await assignedJob(access, record.workOrderId);
  const intent = await getD1().prepare(`SELECT id FROM trade_work_order_compliance_intents
    WHERE id = ? AND installer_uid = ? AND work_order_id = ? AND compliance_organisation_id = ? AND status IN ('planned', 'case_linked')`)
    .bind(record.intentId, access.ownerUid, record.workOrderId, record.organisationId).first();
  if (!intent && mutate && record.status === "draft") throw new Error("ACTIVITY_INTENT_NOT_ACTIVE");
  if (activityHash(record.form) !== record.formSha256) throw new Error("ACTIVITY_FORM_INTEGRITY_FAILED");
  return record;
}

export async function listActivityRecords(access: TeamAccess, workOrderId: string) {
  assertActivityFieldAccess(access);
  await assignedJob(access, workOrderId);
  const rows = await getD1().prepare(`SELECT i.id, i.activity_template_id, i.program_code, i.intent_snapshot, r.payload
    FROM trade_work_order_compliance_intents i LEFT JOIN trade_activity_field_records r ON r.intent_id = i.id
      AND r.owner_uid = i.installer_uid AND r.work_order_id = i.work_order_id
    WHERE i.work_order_id = ? AND i.installer_uid = ? AND i.status IN ('planned', 'case_linked') ORDER BY i.created_at, i.id`)
    .bind(workOrderId, access.ownerUid).all<Row>();
  return rows.results.map((row) => {
    if (row.payload) { const record: ActivityRecord = JSON.parse(String(row.payload)); const p = activityPresentation(record);
      return { id: record.id, intentId: record.intentId, activityTemplateId: record.form.activityTemplateId, title: record.form.title,
        programCode: record.form.programCode, status: record.status, revision: record.revision, progress: p.progress, recordNumber: record.recordNumber }; }
    const snapshot = JSON.parse(String(row.intent_snapshot));
    return { id: "", intentId: String(row.id), activityTemplateId: String(row.activity_template_id), title: String(snapshot.activity?.title || row.activity_template_id),
      programCode: String(row.program_code), status: "not_started", revision: 0, progress: { complete: 0, total: 0 }, recordNumber: "" };
  });
}

export async function openActivityRecord(access: TeamAccess, workOrderId: string, intentId: string, variantId = "") {
  assertActivityFieldAccess(access, true);
  const job = await assignedJob(access, workOrderId);
  const current = await getD1().prepare("SELECT id FROM trade_activity_field_records WHERE intent_id = ? AND owner_uid = ? AND work_order_id = ?")
    .bind(intentId, access.ownerUid, workOrderId).first<{ id: string }>();
  if (current) return loadActivityRecord(access, current.id);
  const intent = await getD1().prepare(`SELECT activity_template_id, compliance_organisation_id FROM trade_work_order_compliance_intents
    WHERE id = ? AND work_order_id = ? AND installer_uid = ? AND status IN ('planned', 'case_linked')`)
    .bind(intentId, workOrderId, access.ownerUid).first<{ activity_template_id: string; compliance_organisation_id: string }>();
  if (!intent) throw new Error("ACTIVITY_INTENT_NOT_ACTIVE");
  const builtIn = defaultActivityFieldForm(intent.activity_template_id, variantId);
  const master = await getD1().prepare(`SELECT form_json FROM trade_activity_field_masters WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ? ORDER BY version DESC LIMIT 1`)
    .bind(intent.compliance_organisation_id, intent.activity_template_id, builtIn.variantId).first<{ form_json: string }>();
  const form: ActivityForm = master ? JSON.parse(master.form_json) : builtIn;
  const context = await getD1().prepare(`SELECT c.first_name, c.last_name, c.email, c.phone,
    s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode
    FROM trade_crm_job_details d
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = d.firebase_uid
    LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = d.firebase_uid
    WHERE d.work_order_id = ? AND d.firebase_uid = ? AND d.customer_source <> 'platform_private'`)
    .bind(workOrderId, access.ownerUid).first<Row>();
  const id = crypto.randomUUID(); const now = iso();
  const member = await getD1().prepare("SELECT display_name, first_name, last_name FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active'")
    .bind(job.assignee_member_id, access.ownerUid).first<Row>();
  const technicianName = [member?.first_name, member?.last_name].filter(Boolean).join(" ") || String(member?.display_name || job.assignee_label || access.displayName);
  const credentials = await getD1().prepare(`SELECT credential.credential_number, credential.name, credential.rental_gate, credential.credential_type
    FROM trade_team_member_credentials credential JOIN trade_team_member_files f ON f.id = credential.file_id
      AND f.owner_uid = credential.owner_uid AND f.team_member_id = credential.team_member_id
    WHERE credential.owner_uid = ? AND credential.team_member_id = ? AND credential.status = 'active'
      AND credential.credential_type IN ('licence', 'registration', 'training')
      AND credential.expires_at <> '' AND date(credential.expires_at) >= date(?)
      AND f.status = 'active' AND f.expires_at <> '' AND date(f.expires_at) >= date(?)
    ORDER BY credential.updated_at DESC`)
    .bind(access.ownerUid, job.assignee_member_id, now, now).all<{ credential_number: string; name: string; rental_gate: string; credential_type: string }>();
  const record: ActivityRecord = { id, recordNumber: `TAF-${id.slice(0, 8).toUpperCase()}`, intentId, workOrderId, ownerUid: access.ownerUid,
    organisationId: intent.compliance_organisation_id, revision: 1, status: "draft", form, formSha256: activityHash(form),
    answers: activityPrefill(form, { address: context ? [context.address_line_1, context.address_line_2, context.suburb, context.address_state, context.postcode].filter(Boolean).join(", ") : "",
      customerName: context ? `${context.first_name || ""} ${context.last_name || ""}`.trim() : "", customerEmail: String(context?.email || ""), customerPhone: String(context?.phone || ""),
      businessName: access.businessName, technician: technicianName }),
    evidence: [], signatures: [], signerDefaults: { technician: technicianName,
      customer: context ? `${context.first_name || ""} ${context.last_name || ""}`.trim() : "" },
    createdAt: now, updatedAt: now, submittedAt: "", reportUrl: "" };
  for (const field of form.fields.filter((item) => item.type === "text")) {
    if (/^(binding\.)?(installer\.full_name|workers\.installer\.name)$/.test(field.key)) record.answers[field.key] = technicianName;
    const credential = credentials.results.find((item) => {
      if (/electrician/.test(field.key)) return item.rental_gate === "licensed_electrician";
      if (/plumb/.test(field.key)) return /plumb/i.test(item.name) && ["licence", "registration"].includes(item.credential_type);
      if (/refriger|arctick/.test(field.key)) return /refriger|arctick|arc licence/i.test(item.name);
      if (/accreditation/.test(field.key)) return /solar accreditation|saa|cec accredited/i.test(item.name);
      return false;
    });
    if (credential && /licen[cs]e|registration|credential|accreditation/.test(field.key) && /number|_no|licence$/.test(field.key)) record.answers[field.key] = credential.credential_number;
    if (credential && /\.name$/.test(field.key) && !/company/.test(field.key)) record.answers[field.key] = technicianName;
  }
  await getD1().prepare(`INSERT OR IGNORE INTO trade_activity_field_records
    (id, intent_id, work_order_id, owner_uid, organisation_id, activity_template_id, revision, status, payload, actor_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?)`)
    .bind(id, intentId, workOrderId, access.ownerUid, record.organisationId, form.activityTemplateId, activityCanonical(record), access.actorUid, now, now).run();
  const stored = await getD1().prepare("SELECT id FROM trade_activity_field_records WHERE intent_id = ? AND owner_uid = ?").bind(intentId, access.ownerUid).first<{ id: string }>();
  if (!stored) throw new Error("ACTIVITY_SAVE_FAILED");
  return loadActivityRecord(access, stored.id);
}

async function saveRecord(access: TeamAccess, previous: ActivityRecord, next: ActivityRecord, pdf?: { key: string; hash: string }) {
  // Re-check the current worker assignment at the mutation boundary.
  await assignedJob(access, previous.workOrderId);
  next.revision = previous.revision + 1; next.updatedAt = iso();
  const result = await getD1().prepare(`UPDATE trade_activity_field_records SET revision = ?, status = ?, payload = ?, actor_uid = ?, updated_at = ?, submitted_at = ?, pdf_object_key = ?, pdf_sha256 = ?
    WHERE id = ? AND owner_uid = ? AND revision = ? AND status = 'draft'
      AND EXISTS (SELECT 1 FROM trade_work_orders w WHERE w.id = work_order_id AND w.firebase_uid = owner_uid
        AND w.record_status = 'active' AND (? = 1 OR w.assignee_member_id = ?))
      AND EXISTS (SELECT 1 FROM trade_work_order_compliance_intents i WHERE i.id = intent_id AND i.status IN ('planned', 'case_linked'))`)
    .bind(next.revision, next.status, activityCanonical(next), access.actorUid, next.updatedAt, next.submittedAt, pdf?.key || "", pdf?.hash || "",
      previous.id, access.ownerUid, previous.revision, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId).run();
  if (result.meta.changes !== 1) throw new Error("ACTIVITY_REVISION_CONFLICT");
  return next;
}

export async function saveActivityAnswers(access: TeamAccess, id: string, expectedRevision: unknown, answers: unknown) {
  const previous = await loadActivityRecord(access, id, true); assertActivityEditable(previous, expectedRevision);
  const nextAnswers = normaliseActivityAnswers(previous.form, answers);
  const next = { ...previous, answers: nextAnswers, hasUserEdits: previous.hasUserEdits || activityHash(previous.answers) !== activityHash(nextAnswers) };
  assertActivitySignedScopeUnchanged(previous, next);
  return saveRecord(access, previous, next);
}

export async function changeActivityVariant(access: TeamAccess, id: string, expectedRevision: unknown, variantId: string) {
  const previous = await loadActivityRecord(access, id, true); assertActivityEditable(previous, expectedRevision);
  if (previous.signatures.length || previous.evidence.length || previous.hasUserEdits) throw new Error("ACTIVITY_VARIANT_ALREADY_STARTED");
  const builtIn = defaultActivityFieldForm(previous.form.activityTemplateId, variantId);
  const saved = await getD1().prepare("SELECT form_json FROM trade_activity_field_masters WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ? ORDER BY version DESC LIMIT 1")
    .bind(previous.organisationId, builtIn.activityTemplateId, builtIn.variantId).first<{ form_json: string }>();
  const form: ActivityForm = saved ? JSON.parse(saved.form_json) : builtIn;
  const answers = Object.fromEntries(Object.entries(previous.answers).filter(([key]) => form.fields.some((field) => field.key === key)));
  return saveRecord(access, previous, { ...previous, form, formSha256: activityHash(form), answers });
}

export async function signActivityDeclaration(access: TeamAccess, id: string, body: Row) {
  const previous = await loadActivityRecord(access, id, true); assertActivityEditable(previous, body.expectedRevision);
  const declaration = previous.form.declarations.find((item) => item.key === body.declarationKey);
  if (!declaration || !activityConditionMet(declaration.condition, previous.answers)) throw new Error("ACTIVITY_DECLARATION_INVALID");
  if (body.acknowledged !== true || !string(body.signerName, 150)) throw new Error("ACTIVITY_SIGNATURE_REQUIRED");
  const missing = activityMissing(previous, declaration.phase, false);
  if (missing.length || (declaration.phase === "after" && activityMissing(previous, "before").length)) throw new Error("ACTIVITY_SIGNING_NOT_READY");
  if (previous.signatures.some((item) => item.declarationKey === declaration.key)) throw new Error("ACTIVITY_DECLARATION_ALREADY_SIGNED");
  const declarationText = activityDeclarationText(declaration, previous.answers);
  if (/\{\{/.test(declarationText)) throw new Error("ACTIVITY_DECLARATION_DETAILS_REQUIRED");
  const next = { ...previous, signatures: [...previous.signatures, {
    id: crypto.randomUUID(), declarationKey: declaration.key, signerName: string(body.signerName, 150), role: declaration.role,
    phase: declaration.phase, declarationText, declarationSha256: activityHash(declarationText), scopeSha256: activitySigningScope(previous, declaration.phase),
    signedAt: iso(), actorUid: access.actorUid, strokes: validateActivityStrokes(body.strokes),
  }] };
  assertActivitySignedScopeUnchanged(previous, next);
  return saveRecord(access, previous, next);
}

function capturedMetadata(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { capturedAt: "", latitude: null, longitude: null, accuracy: null, metadataOrigin: "file_upload" as const };
  const input = raw as Row;
  const finite = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
  const capturedAt = typeof input.capturedAt === "string" && Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : "";
  const locationObservedAt = typeof input.locationObservedAt === "string" && Number.isFinite(Date.parse(input.locationObservedAt)) ? new Date(input.locationObservedAt).toISOString() : "";
  return { capturedAt, latitude: finite(input.latitude, -90, 90), longitude: finite(input.longitude, -180, 180), accuracy: finite(input.accuracy, 0, 10_000),
    locationObservedAt, locationMocked: input.mocked === false ? false : input.mocked === true ? true : null,
    metadataOrigin: input.metadataOrigin === "device_capture" && capturedAt ? "device_capture" as const : "file_upload" as const };
}

export async function uploadActivityEvidence(access: TeamAccess, id: string, expectedRevision: number, fieldKey: string, file: File, metadata: unknown, clientUploadId = "", preview?: File) {
  const previous = await loadActivityRecord(access, id, true);
  if (file.size < 5 || file.size > 8 * 1024 * 1024) throw new Error("INVALID_ACTIVITY_FILE");
  const bytes = new Uint8Array(await file.arrayBuffer()); const sha256 = activityHash(bytes);
  if (clientUploadId && !/^[0-9a-f-]{36}$/i.test(clientUploadId)) throw new Error("INVALID_ACTIVITY_UPLOAD_ID");
  const existing = clientUploadId ? previous.evidence.find((item) => item.id === clientUploadId) : null;
  if (existing) {
    if (existing.fieldKey !== fieldKey || existing.sha256 !== sha256 || existing.contentType !== file.type) throw new Error("ACTIVITY_UPLOAD_ID_CONFLICT");
    return previous;
  }
  assertActivityEditable(previous, expectedRevision);
  const field = expandedActivityFields(previous.form, previous.answers).find((item) => item.key === fieldKey);
  if (!field || !["photo", "document"].includes(field.type)) throw new Error("INVALID_ACTIVITY_FIELD");
  if (file.size < 5 || file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)
    || (field.type === "photo" && file.type === "application/pdf")) throw new Error("INVALID_ACTIVITY_FILE");
  if (previous.evidence.length >= 150 || previous.evidence.filter((item) => item.fieldKey === fieldKey).length >= 20
    || previous.evidence.reduce((sum, item) => sum + item.size, 0) + file.size > 96 * 1024 * 1024) throw new Error("ACTIVITY_EVIDENCE_LIMIT");
  if ((file.type === "application/pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    || (file.type === "image/jpeg" && (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255))
    || (file.type === "image/png" && ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))) throw new Error("INVALID_ACTIVITY_FILE");
  const { validateActivityEvidenceBytes } = await import("./trade-activity-forms-pdf.ts");
  await validateActivityEvidenceBytes(bytes, file.type);
  const previewBytes = preview ? new Uint8Array(await preview.arrayBuffer()) : null;
  if (previewBytes && (file.type === "application/pdf" || previewBytes.length > 1024 * 1024 || preview?.type !== "image/jpeg")) throw new Error("INVALID_ACTIVITY_PREVIEW");
  if (previewBytes) await validateActivityEvidenceBytes(previewBytes, "image/jpeg");
  if (previous.evidence.reduce((sum, item) => sum + (item.previewSize || item.size), 0) + (previewBytes?.length || file.size) > 24 * 1024 * 1024) throw new Error("ACTIVITY_REPORT_EVIDENCE_LIMIT");
  const evidenceId = clientUploadId || crypto.randomUUID();
  const objectNonce = crypto.randomUUID();
  const objectKey = `activity-field/${access.ownerUid}/${id}/original/${evidenceId}/${objectNonce}`;
  const previewObjectKey = previewBytes ? `activity-field/${access.ownerUid}/${id}/preview/${evidenceId}/${objectNonce}.jpg` : "";
  const capture = capturedMetadata(metadata);
  if (field.requireLocation && (!capture.capturedAt || capture.latitude === null || capture.longitude === null
    || capture.accuracy === null || capture.accuracy > 100 || capture.metadataOrigin !== "device_capture" || !capture.locationObservedAt
    || capture.locationMocked === true || Math.abs(Date.parse(capture.capturedAt) - Date.parse(capture.locationObservedAt)) > 120_000
    || Date.parse(capture.capturedAt) > Date.now() + 5 * 60 * 1000)) throw new Error("ACTIVITY_PHOTO_LOCATION_REQUIRED");
  const item: ActivityEvidence = { id: evidenceId, fieldKey, fileName: file.name.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 180) || "Evidence",
    contentType: file.type, size: bytes.byteLength, sha256, objectKey, uploadedAt: iso(), ...capture,
    ...(previewBytes ? { previewObjectKey, previewSha256: activityHash(previewBytes), previewSize: previewBytes.length } : {}) };
  const next = { ...previous, evidence: [...previous.evidence, item] };
  assertActivitySignedScopeUnchanged(previous, next);
  await bucket().put(objectKey, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { sha256, fieldRecordId: id, evidenceId } });
  try {
    if (previewBytes) await bucket().put(previewObjectKey, previewBytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { sha256: activityHash(previewBytes), originalSha256: sha256, fieldRecordId: id, evidenceId } });
    return await saveRecord(access, previous, next);
  } catch (error) {
    const committed = await loadActivityRecord(access, id);
    if (!committed.evidence.some((evidence) => evidence.id === evidenceId && evidence.sha256 === sha256 && evidence.objectKey === objectKey)) {
      await bucket().delete(objectKey); if (previewBytes) await bucket().delete(previewObjectKey);
    }
    throw error;
  }
}

export async function readActivityEvidence(record: ActivityRecord, evidenceId: string) {
  const item = record.evidence.find((entry) => entry.id === evidenceId);
  if (!item) throw new Error("ACTIVITY_EVIDENCE_NOT_FOUND");
  const object = await bucket().get(item.objectKey);
  if (!object) throw new Error("ACTIVITY_EVIDENCE_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (activityHash(bytes) !== item.sha256) throw new Error("ACTIVITY_EVIDENCE_INTEGRITY_FAILED");
  return { bytes, contentType: item.contentType, fileName: item.fileName };
}

export async function submitActivityRecord(access: TeamAccess, id: string, expectedRevision: unknown) {
  const previous = await loadActivityRecord(access, id, true); assertActivityEditable(previous, expectedRevision);
  if (activityMissing(previous).length) throw new Error("ACTIVITY_FORM_INCOMPLETE");
  const assets = new Map<string, Uint8Array>();
  for (const evidence of previous.evidence) {
    if (evidence.previewObjectKey && evidence.previewSha256) {
      await readActivityEvidence(previous, evidence.id);
      const preview = await bucket().get(evidence.previewObjectKey);
      if (!preview) throw new Error("ACTIVITY_EVIDENCE_UNAVAILABLE");
      const bytes = new Uint8Array(await preview.arrayBuffer());
      if (activityHash(bytes) !== evidence.previewSha256) throw new Error("ACTIVITY_EVIDENCE_INTEGRITY_FAILED");
      assets.set(evidence.id, bytes);
    } else assets.set(evidence.id, (await readActivityEvidence(previous, evidence.id)).bytes);
  }
  const next: ActivityRecord = { ...previous, status: "submitted_for_creditex_review", submittedAt: iso() };
  const [{ renderActivityFieldPdf }, { loadCustomerPlanPdfFonts }] = await Promise.all([import("./trade-activity-forms-pdf.ts"), import("./customer-plan-pdf-fonts")]);
  const bytes = await renderActivityFieldPdf(next, assets, await loadCustomerPlanPdfFonts());
  const key = `activity-field/${access.ownerUid}/${id}/final/${crypto.randomUUID()}.pdf`; const hash = activityHash(bytes);
  await bucket().put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sha256: hash, fieldRecordId: id } });
  try { return await saveRecord(access, previous, next, { key, hash }); } catch (error) { await bucket().delete(key); throw error; }
}

export async function readActivityConsumerDocument(version: string) {
  if (version !== "veu-rights-v1") throw new Error("INVALID_ACTIVITY_CONSUMER_DOCUMENT");
  const [{ renderCreditexConsumerRightsPdf }, { loadCustomerPlanPdfFonts }] = await Promise.all([import("./trade-activity-forms-pdf.ts"), import("./customer-plan-pdf-fonts")]);
  return { bytes: await renderCreditexConsumerRightsPdf(await loadCustomerPlanPdfFonts()), contentType: "application/pdf", fileName: "Creditex-Statement-of-Rights-v1.pdf" };
}

export async function readActivityPdf(record: ActivityRecord) {
  const row = await getD1().prepare(`SELECT pdf_object_key, pdf_sha256 FROM trade_activity_field_records WHERE id = ? AND owner_uid = ? AND status = 'submitted_for_creditex_review'`)
    .bind(record.id, record.ownerUid).first<{ pdf_object_key: string; pdf_sha256: string }>();
  if (!row) throw new Error("ACTIVITY_REPORT_NOT_READY");
  const object = await bucket().get(row.pdf_object_key);
  if (!object) throw new Error("ACTIVITY_REPORT_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (activityHash(bytes) !== row.pdf_sha256) throw new Error("ACTIVITY_REPORT_INTEGRITY_FAILED");
  return { bytes, contentType: "application/pdf", fileName: `${record.recordNumber}.pdf` };
}

export async function shareActivityReport(access: TeamAccess, id: string, origin: string, revoke = false) {
  const record = await loadActivityRecord(access, id, true);
  if (record.status !== "submitted_for_creditex_review") throw new Error("ACTIVITY_REPORT_NOT_READY");
  await getD1().prepare("UPDATE trade_activity_field_report_links SET revoked_at = ? WHERE record_id = ? AND revoked_at = ''").bind(iso(), id).run();
  if (revoke) return "";
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); const now = iso();
  await getD1().prepare(`INSERT INTO trade_activity_field_report_links (id, record_id, token_sha256, expires_at, created_by_uid, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), id, activityHash(secret), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), access.actorUid, now).run();
  return `${origin}/api/trade-activity-forms?reportToken=${secret}`;
}

export async function sharedActivityRecord(token: string): Promise<ActivityRecord> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("ACTIVITY_REPORT_LINK_UNAVAILABLE");
  const row = await getD1().prepare(`SELECT r.payload FROM trade_activity_field_report_links l JOIN trade_activity_field_records r ON r.id = l.record_id
    WHERE l.token_sha256 = ? AND l.revoked_at = '' AND l.expires_at > ? AND r.status = 'submitted_for_creditex_review'`)
    .bind(activityHash(token), iso()).first<{ payload: string }>();
  if (!row) throw new Error("ACTIVITY_REPORT_LINK_UNAVAILABLE");
  return JSON.parse(row.payload);
}
