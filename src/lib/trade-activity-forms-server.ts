import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { assignedJob, type TeamAccess } from "./trade-team-server";
import {
  activityPrefill,
  activityConsumerDocuments,
  applyDefaultActivityFormPolicy,
  defaultActivityFieldForm,
  ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS,
} from "./trade-activity-forms-library.ts";
import {
  activityCanonical, activityConditionMet, activityDeclarationText, activityHash, activityMissing, activitySigningScope,
  assertActivityEditable, assertActivitySignedScopeUnchanged, normaliseActivityAnswers, validateActivityStrokes,
  type ActivityAnswers, type ActivityEvidence, type ActivityForm, type ActivityRecord,
} from "./trade-activity-forms.ts";
import { activityBaseFieldKey, expandedActivityFields, mergeActivityAnswers } from "./trade-activity-form-flow.ts";
import { parseScheduledActivityCustomerDocumentReceipt } from "./scheduled-activity-customer-document-receipt.ts";

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

function activityConsumerDocumentIds(form: Pick<ActivityForm, "activityTemplateId" | "variantId">) {
  return activityConsumerDocuments(form.activityTemplateId, form.variantId).map((document) => document.key);
}

function receiptAnswersAreAccepted(form: ActivityForm, answers: ActivityAnswers) {
  const requiredIds = activityConsumerDocumentIds(form);
  if (!requiredIds.length) return true;
  const ids = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentIds] || "").split(",").map((item) => item.trim()).filter(Boolean);
  const hashes = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentSha256Set] || "").split(",").map((item) => item.trim()).filter(Boolean);
  const acceptedAt = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.acceptedAt] || "");
  const recipient = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.recipient] || "");
  const appointmentId = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.appointmentId] || "");
  const deliveryId = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.deliveryId] || "");
  const packSha256 = String(answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.packSha256] || "");
  return answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted] === true
    && answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.method] === "email"
    && Number.isFinite(Date.parse(acceptedAt)) && new Date(acceptedAt).toISOString() === acceptedAt
    && recipient === recipient.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    && /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(appointmentId)
    && /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(deliveryId)
    && /^[0-9a-f]{64}$/.test(packSha256)
    && ids.length === hashes.length && ids.length > 0 && new Set(ids).size === ids.length
    && hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))
    && requiredIds.every((id) => ids.includes(id));
}

function assertActivityCustomerDocumentsAccepted(record: ActivityRecord) {
  if (!receiptAnswersAreAccepted(record.form, record.answers)) throw new Error("ACTIVITY_CUSTOMER_DOCUMENTS_NOT_ACCEPTED");
}

function acceptedCustomerDocumentGuard(record: ActivityRecord) {
  if (!activityConsumerDocumentIds(record.form).length) return null;
  assertActivityCustomerDocumentsAccepted(record);
  const documentIds = String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentIds] || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const documentSha256Set = String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentSha256Set] || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const recipient = String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.recipient] || "");
  return {
    deliveryId: String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.deliveryId] || ""),
    appointmentId: String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.appointmentId] || ""),
    acceptedAt: String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.acceptedAt] || ""),
    recipientSha256: activityHash(recipient),
    documentIds: JSON.stringify(documentIds),
    documentSha256Set: JSON.stringify(documentSha256Set),
    packSha256: String(record.answers[ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.packSha256] || ""),
    activityTemplateId: record.form.activityTemplateId,
    variantId: record.form.variantId,
  };
}

function replaceCustomerDocumentReceiptAnswers(answers: ActivityAnswers, receipt: ActivityAnswers) {
  const current = { ...answers };
  for (const key of Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS)) delete current[key];
  return { ...current, ...receipt };
}

function refreshableDerivedAnswers(record: ActivityRecord) {
  const clean = { ...record.answers };
  const afterLocked = record.signatures.some((signature) => signature.phase === "after");
  const beforeLocked = afterLocked || record.signatures.some((signature) => signature.phase === "before");
  const phaseUnlocked = (field: ActivityForm["fields"][number]) => !(field.phase === "before" ? beforeLocked : afterLocked);
  for (const field of record.form.fields) {
    if (field.presentation === "derived" && phaseUnlocked(field)) delete clean[field.key];
  }
  return {
    answers: clean,
    canRefreshField: (key: string) => {
      const field = record.form.fields.find((item) => item.key === key);
      if (!field || !phaseUnlocked(field)) return false;
      if (field.presentation === "derived") return true;
      return field.presentation === "prefilled" && (record.answers[key] === undefined || record.answers[key] === "");
    },
  };
}

function mergeProfileAnswers(form: ActivityForm, current: ActivityRecord["answers"], profile: ActivityRecord["answers"]) {
  const merged = { ...current };
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(profile)) {
    const field = fields.get(key);
    if (field?.presentation === "derived"
      || (field?.presentation === "prefilled" && (merged[key] === undefined || merged[key] === ""))) {
      merged[key] = value;
    }
  }
  return merged;
}

function activityEvidenceFitsField(field: ActivityForm["fields"][number], item: ActivityEvidence) {
  const compatibleType = field.type === "photo"
    ? item.contentType === "image/jpeg" || item.contentType === "image/png"
    : field.type === "document"
      ? ["image/jpeg", "image/png", "application/pdf"].includes(item.contentType)
      : false;
  if (!compatibleType) return false;
  if (!field.requireLocation) return true;
  const capturedAt = Date.parse(item.capturedAt || "");
  const locationObservedAt = Date.parse(item.locationObservedAt || "");
  return item.metadataOrigin === "device_capture"
    && item.latitude !== null && Number.isFinite(item.latitude) && item.latitude >= -90 && item.latitude <= 90
    && item.longitude !== null && Number.isFinite(item.longitude) && item.longitude >= -180 && item.longitude <= 180
    && item.accuracy !== null && Number.isFinite(item.accuracy) && item.accuracy >= 0 && item.accuracy <= 100
    && item.locationMocked !== true
    && Number.isFinite(capturedAt) && Number.isFinite(locationObservedAt)
    && Math.abs(capturedAt - locationObservedAt) <= 120_000
    && capturedAt <= Date.now() + 5 * 60 * 1000;
}

async function scheduledActivityDocumentReceiptAnswers(ownerUid: string, workOrderId: string, form: ActivityForm): Promise<ActivityAnswers> {
  const requiredIds = activityConsumerDocumentIds(form);
  if (!requiredIds.length) return {};
  const customer = await getD1().prepare(`SELECT customer.email FROM trade_crm_job_details detail
    JOIN trade_crm_customers customer ON customer.id = detail.crm_customer_id
      AND customer.firebase_uid = detail.firebase_uid
    WHERE detail.work_order_id = ? AND detail.firebase_uid = ? LIMIT 1`)
    .bind(workOrderId, ownerUid).first<{ email: string }>();
  const recipient = String(customer?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return {};
  const events = await getD1().prepare(`SELECT summary FROM trade_work_order_events
    WHERE work_order_id = ? AND firebase_uid = ? AND event_type = 'customer_documents_provider_accepted'
    ORDER BY created_at DESC, id DESC LIMIT 50`).bind(workOrderId, ownerUid).all<{ summary: string }>();
  for (const event of events.results) {
    const receipt = parseScheduledActivityCustomerDocumentReceipt(event.summary);
    if (!receipt || receipt.recipient !== recipient || !requiredIds.every((id) => receipt.documentIds.includes(id))) continue;
    const delivery = await getD1().prepare(`SELECT recipient_email_sha256, activity_bindings, document_ids, document_sha256_set,
        pack_sha256, status, accepted_at
      FROM trade_activity_customer_document_deliveries
      WHERE id = ? AND firebase_uid = ? AND work_order_id = ? AND appointment_id = ?
        AND provider = 'resend' AND provider_message_id = ? LIMIT 1`)
      .bind(receipt.deliveryId, ownerUid, workOrderId, receipt.appointmentId, receipt.providerMessageId).first<{
        recipient_email_sha256: string; activity_bindings: string; document_ids: string; document_sha256_set: string;
        pack_sha256: string; status: string; accepted_at: string;
      }>();
    let storedActivityBindings: unknown = null;
    let storedDocumentIds: unknown = null;
    let storedDocumentHashes: unknown = null;
    try {
      storedActivityBindings = JSON.parse(delivery?.activity_bindings || "null");
      storedDocumentIds = JSON.parse(delivery?.document_ids || "null");
      storedDocumentHashes = JSON.parse(delivery?.document_sha256_set || "null");
    } catch { continue; }
    if (!delivery || !["provider_accepted", "sent", "delivered"].includes(delivery.status)
      || delivery.recipient_email_sha256 !== activityHash(recipient)
      || delivery.accepted_at !== receipt.acceptedAt
      || !/^[0-9a-f]{64}$/.test(delivery.pack_sha256)
      || !Array.isArray(storedActivityBindings)
      || !storedActivityBindings.some((binding) => binding && typeof binding === "object"
        && String((binding as Row).activityTemplateId || "") === form.activityTemplateId
        && String((binding as Row).variantId || "") === form.variantId)
      || !Array.isArray(storedDocumentIds) || !Array.isArray(storedDocumentHashes)
      || JSON.stringify(storedDocumentIds) !== JSON.stringify(receipt.documentIds)
      || JSON.stringify(storedDocumentHashes) !== JSON.stringify(receipt.documentSha256Set)) continue;
    return {
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.deliveryId]: receipt.deliveryId,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted]: true,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.method]: receipt.method,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.acceptedAt]: receipt.acceptedAt,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.recipient]: receipt.recipient,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.appointmentId]: receipt.appointmentId,
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentIds]: receipt.documentIds.join(", "),
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentSha256Set]: receipt.documentSha256Set.join(", "),
      [ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.packSha256]: delivery.pack_sha256,
    };
  }
  return {};
}

type ActivitySignerSetup = { firstName: string; lastName: string; canSave: boolean; firstNameLocked: boolean; lastNameLocked: boolean };

export function activityPresentation(record: ActivityRecord, signerSetup?: ActivitySignerSetup) {
  const missing = activityMissing(record);
  const total = expandedActivityFields(record.form, record.answers).filter((field) => field.required && field.presentation !== "derived").length
    + record.form.declarations.filter((item) => item.required && activityConditionMet(item.condition, record.answers)).length;
  const userMissing = missing.filter((item) => record.form.fields.find((field) => field.key === activityBaseFieldKey(item.key))?.presentation !== "derived");
  return { ...record, ...(signerSetup ? { signerSetup } : {}), evidence: record.evidence.map(({ objectKey, previewObjectKey, ...item }) => { void objectKey; void previewObjectKey; return item; }), missing,
    signingScopes: { before: activitySigningScope(record, "before"), after: activitySigningScope(record, "after") },
    progress: { complete: Math.max(0, total - userMissing.length), total },
    reportUrl: record.status === "submitted_for_creditex_review" ? `/api/trade-activity-forms?recordId=${encodeURIComponent(record.id)}&view=pdf` : "" };
}

export function assertActivityFieldAccess(access: Pick<TeamAccess, "isOwner" | "canViewFieldEvidence" | "canManageFieldEvidence">, mutate = false) {
  if (!access.isOwner && !(mutate ? access.canManageFieldEvidence : access.canViewFieldEvidence)) throw new Error("ACTIVITY_ACCESS_REQUIRED");
}

async function activityProfileContext(
  access: TeamAccess,
  job: Awaited<ReturnType<typeof assignedJob>>,
  workOrderId: string,
  form: ActivityForm,
) {
  const context = await getD1().prepare(`SELECT c.first_name, c.last_name, c.email, c.phone,
    c.business_name customer_business_name, c.business_number customer_business_number,
    s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode,
    account.address_line_1 business_address_line_1, account.suburb business_suburb,
    account.address_state business_address_state, account.postcode business_postcode,
    COALESCE(NULLIF(account.document_phone, ''), account.phone) business_phone,
    COALESCE(NULLIF(account.document_email, ''), account.email) business_email
    FROM trade_work_orders work
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = work.id AND d.firebase_uid = work.firebase_uid
      AND d.customer_source <> 'platform_private'
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = d.firebase_uid
    LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = d.firebase_uid
    LEFT JOIN trade_accounts account ON account.firebase_uid = work.firebase_uid
    WHERE work.id = ? AND work.firebase_uid = ?`)
    .bind(workOrderId, access.ownerUid).first<Row>();
  const now = iso();
  const member = await getD1().prepare("SELECT first_name, last_name FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active'")
    .bind(job.assignee_member_id, access.ownerUid).first<Row>();
  const technicianName = [member?.first_name, member?.last_name].filter(Boolean).join(" ");
  const credentials = await getD1().prepare(`SELECT credential.credential_number, credential.name, credential.rental_gate, credential.credential_type,
      credential.jurisdiction
    FROM trade_team_member_credentials credential JOIN trade_team_member_files f ON f.id = credential.file_id
      AND f.owner_uid = credential.owner_uid AND f.team_member_id = credential.team_member_id
    WHERE credential.owner_uid = ? AND credential.team_member_id = ? AND credential.status = 'active'
      AND credential.credential_type IN ('licence', 'registration', 'training', 'accreditation')
      AND credential.expires_at <> '' AND date(credential.expires_at) >= date(?)
      AND f.status = 'active' AND f.expires_at <> '' AND date(f.expires_at) >= date(?)
    ORDER BY credential.updated_at DESC, credential.id DESC`)
    .bind(access.ownerUid, job.assignee_member_id, now, now)
    .all<{ credential_number: string; name: string; rental_gate: string; credential_type: string; jurisdiction: string }>();
  const sresInstaller = credentials.results.find((item) => item.rental_gate === "sres_installer_accreditation"
    && item.credential_type === "accreditation" && item.jurisdiction === "NATIONAL");
  const sresDesigner = credentials.results.find((item) => item.rental_gate === "sres_designer_accreditation"
    && item.credential_type === "accreditation" && item.jurisdiction === "NATIONAL");
  const connectionType = (value = "") => /stand[ -]?alone/i.test(value) ? "Stand-alone"
    : /grid/i.test(value) ? "Grid connected" : "";
  const credentialNumbers = {
    electrician: credentials.results.find((item) => item.rental_gate === "licensed_electrician"
      && ["licence", "registration"].includes(item.credential_type))?.credential_number || "",
    licensed_plumber: credentials.results.find((item) => item.rental_gate === "licensed_plumber"
      && item.credential_type === "licence" && item.credential_number)?.credential_number || "",
    registered_plumber: credentials.results.find((item) => item.rental_gate === "registered_plumber"
      && item.credential_type === "registration" && item.credential_number)?.credential_number || "",
    refrigerant_handler: credentials.results.find((item) => item.rental_gate === "refrigerant_handler"
      && item.credential_type === "licence" && item.credential_number)?.credential_number || "",
    installer: sresInstaller?.credential_number || "",
    designer: sresDesigner?.credential_number || "",
  };
  const credentialTypes = {
    installer: String(sresInstaller?.name || ""),
    designer: String(sresDesigner?.name || ""),
    connection: connectionType(String(sresInstaller?.name || "")),
  };
  const customerFullName = context ? `${context.first_name || ""} ${context.last_name || ""}`.trim() : "";
  const answers = activityPrefill(form, {
    address: context ? [context.address_line_1, context.address_line_2, context.suburb, context.address_state, context.postcode].filter(Boolean).join(", ") : "",
    customerName: customerFullName || String(context?.customer_business_name || ""),
    customerEmail: String(context?.email || ""),
    customerPhone: String(context?.phone || ""),
    customerBusinessName: String(context?.customer_business_name || ""),
    customerBusinessNumber: String(context?.customer_business_number || ""),
    businessName: access.businessName,
    businessAddress: context ? [context.business_address_line_1, context.business_suburb, context.business_address_state, context.business_postcode].filter(Boolean).join(", ") : "",
    businessPhone: String(context?.business_phone || ""),
    businessEmail: String(context?.business_email || ""),
    technician: technicianName,
    workerCredentials: credentials.results.filter((item) => item.credential_number).map((item) => ({
      name: item.name, number: item.credential_number, type: item.credential_type, jurisdiction: item.jurisdiction, gate: item.rental_gate,
    })),
    credentialNumbers,
    credentialTypes,
  });
  return {
    answers,
    signerDefaults: {
      technician: technicianName,
      customer: customerFullName,
    },
  };
}

function answersForUpgradedForm(form: ActivityForm, previous: ActivityAnswers) {
  const groups = new Set(form.fields.map((field) => field.repeatGroup).filter(Boolean));
  let answers = normaliseActivityAnswers(form, Object.fromEntries(Object.entries(previous)
    .filter(([key, value]) => key.startsWith("$repeat.") && groups.has(key.slice(8)) && typeof value === "number")));
  for (const [key, value] of Object.entries(previous).filter(([key]) => !key.startsWith("$repeat."))) {
    if (!form.fields.some((field) => field.key === activityBaseFieldKey(key))) continue;
    try { answers = normaliseActivityAnswers(form, { ...answers, [key]: value }); } catch { /* A superseded invalid answer is intentionally omitted. */ }
  }
  return answers;
}

async function latestActivityMaster(organisationId: string, baseline: ActivityForm) {
  const row = await getD1().prepare(`SELECT form_json, form_sha256 FROM trade_activity_field_masters
    WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ? ORDER BY version DESC LIMIT 1`)
    .bind(organisationId, baseline.activityTemplateId, baseline.variantId).first<{ form_json: string; form_sha256: string }>();
  if (!row) return null;
  const form: ActivityForm = JSON.parse(row.form_json);
  if (activityHash(form) !== row.form_sha256) throw new Error("ACTIVITY_MASTER_INTEGRITY_FAILED");
  return form;
}

async function upgradeDraftActivityPolicy(
  access: TeamAccess,
  job: Awaited<ReturnType<typeof assignedJob>>,
  record: ActivityRecord,
) {
  if (record.status !== "draft" || record.signatures.length) return record;
  let baseline: ActivityForm;
  try {
    baseline = defaultActivityFieldForm(record.form.activityTemplateId, record.form.variantId);
  } catch (error) {
    if (error instanceof Error && ["ACTIVITY_FORM_UNAVAILABLE", "ACTIVITY_FORM_VARIANT_INVALID"].includes(error.message)) return record;
    throw error;
  }
  const latestMaster = await latestActivityMaster(record.organisationId, baseline);
  const source = latestMaster && latestMaster.version > record.form.version ? latestMaster : record.form;
  const form = applyDefaultActivityFormPolicy(source, baseline);
  const formSha256 = activityHash(form);
  if (formSha256 === record.formSha256) return record;
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  const previousFields = new Map(record.form.fields.map((field) => [field.key, field]));
  const evidence: ActivityEvidence[] = [];
  for (const item of record.evidence) {
    const baseKey = activityBaseFieldKey(item.fieldKey);
    const targetField = fields.get(baseKey);
    if (targetField) {
      if (activityEvidenceFitsField(targetField, item)) evidence.push(item);
      continue;
    }
    const previousField = previousFields.get(baseKey);
    const candidates = previousField?.sourceRequirementId ? form.fields.filter((field) => field.sourceRequirementId === previousField.sourceRequirementId
      && field.type === previousField.type && activityEvidenceFitsField(field, item)) : [];
    if (candidates.length !== 1 || (item.fieldKey !== baseKey && !candidates[0].repeatGroup)) return record;
    evidence.push({ ...item, fieldKey: item.fieldKey.replace(baseKey, candidates[0].key) });
  }
  const profile = await activityProfileContext(access, job, record.workOrderId, form);
  const retainedAnswers = answersForUpgradedForm(form, record.answers);
  for (const field of form.fields) if (field.presentation === "derived") delete retainedAnswers[field.key];
  const answers = mergeProfileAnswers(form, retainedAnswers, profile.answers);
  const next: ActivityRecord = { ...record, form, formSha256, answers, evidence, signerDefaults: profile.signerDefaults };
  try { return await saveRecord(access, record, next); }
  catch (error) {
    if (error instanceof Error && error.message === "ACTIVITY_REVISION_CONFLICT") return loadActivityRecord(access, record.id);
    throw error;
  }
}

export async function loadActivityRecord(access: TeamAccess, id: string, mutate = false): Promise<ActivityRecord> {
  assertActivityFieldAccess(access, mutate);
  const row = await getD1().prepare("SELECT payload FROM trade_activity_field_records WHERE id = ? AND owner_uid = ?")
    .bind(id, access.ownerUid).first<{ payload: string }>();
  if (!row) throw new Error("ACTIVITY_RECORD_NOT_FOUND");
  const record: ActivityRecord = JSON.parse(row.payload);
  const job = await assignedJob(access, record.workOrderId);
  const intent = await getD1().prepare(`SELECT id FROM trade_work_order_compliance_intents
    WHERE id = ? AND installer_uid = ? AND work_order_id = ? AND compliance_organisation_id = ? AND status IN ('planned', 'case_linked')`)
    .bind(record.intentId, access.ownerUid, record.workOrderId, record.organisationId).first();
  if (!intent && mutate && record.status === "draft") throw new Error("ACTIVITY_INTENT_NOT_ACTIVE");
  if (activityHash(record.form) !== record.formSha256) throw new Error("ACTIVITY_FORM_INTEGRITY_FAILED");
  if (record.status !== "draft") return record;
  const profile = await activityProfileContext(access, job, record.workOrderId, record.form);
  const refresh = refreshableDerivedAnswers(record);
  const profileAnswers = Object.fromEntries(Object.entries(profile.answers).filter(([key]) => refresh.canRefreshField(key)));
  const receiptAnswers = await scheduledActivityDocumentReceiptAnswers(record.ownerUid, record.workOrderId, record.form);
  return { ...record,
    answers: replaceCustomerDocumentReceiptAnswers({ ...refresh.answers, ...profileAnswers }, receiptAnswers),
    signerDefaults: profile.signerDefaults };
}

async function assignedSigningProfile(access: TeamAccess, record: ActivityRecord) {
  const job = await assignedJob(access, record.workOrderId);
  const member = await getD1().prepare(`SELECT member.first_name, member.last_name, member.member_uid,
      account.contact_name owner_contact_name
    FROM trade_team_members member LEFT JOIN trade_accounts account ON account.firebase_uid = member.owner_uid
    WHERE member.id = ? AND member.owner_uid = ? AND member.status = 'active'`)
    .bind(job.assignee_member_id, access.ownerUid).first<Row>();
  return { job, member };
}

export async function activitySigningProfileSetup(access: TeamAccess, record: ActivityRecord): Promise<ActivitySignerSetup | undefined> {
  if (record.status !== "draft") return undefined;
  const { job, member } = await assignedSigningProfile(access, record);
  if (!member) return undefined;
  const firstName = string(member.first_name, 80); const lastName = string(member.last_name, 80);
  if (firstName && lastName) return undefined;
  // The account contact is only a suggestion for an owner signing as themselves.
  // It never becomes a technician identity until the member confirms and saves it.
  const candidate = member.member_uid === access.ownerUid ? string(member.owner_contact_name, 120).split(/\s+/).filter(Boolean) : [];
  const candidateLastName = candidate.length > 1 ? candidate.pop()! : "";
  return { firstName: firstName || candidate.join(" "), lastName: lastName || candidateLastName,
    firstNameLocked: Boolean(firstName), lastNameLocked: Boolean(lastName),
    canSave: job.assignee_member_id === access.memberId && (access.isOwner || access.canManageFieldEvidence) };
}

export async function saveActivitySigningProfile(access: TeamAccess, id: string, body: Row) {
  const record = await loadActivityRecord(access, id, true);
  assertActivityEditable(record, record.revision);
  const { job, member } = await assignedSigningProfile(access, record);
  if (!member || job.assignee_member_id !== access.memberId) throw new Error("ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED");
  const existingFirst = string(member.first_name, 80); const existingLast = string(member.last_name, 80);
  if (existingFirst && existingLast) return record;
  const firstName = existingFirst || string(body.firstName, 80);
  const lastName = existingLast || string(body.lastName, 80);
  if (!firstName || !lastName) throw new Error("ACTIVITY_SIGNING_PROFILE_NAME_REQUIRED");
  const db = getD1(); const now = iso();
  const result = await db.batch([
    db.prepare(`UPDATE trade_team_members SET
        first_name = CASE WHEN TRIM(COALESCE(first_name, '')) = '' THEN ? ELSE first_name END,
        last_name = CASE WHEN TRIM(COALESCE(last_name, '')) = '' THEN ? ELSE last_name END,
        updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'active' AND first_name IS ? AND last_name IS ?
        AND EXISTS (SELECT 1 FROM trade_work_orders work WHERE work.id = ? AND work.firebase_uid = ?
          AND work.record_status = 'active' AND work.assignee_member_id = trade_team_members.id)
        AND EXISTS (SELECT 1 FROM trade_activity_field_records record
          JOIN trade_work_order_compliance_intents intent ON intent.id = record.intent_id
          WHERE record.id = ? AND record.owner_uid = ? AND record.status = 'draft'
            AND intent.status IN ('planned', 'case_linked'))`)
      .bind(firstName, lastName, now, access.memberId, access.ownerUid, member.first_name, member.last_name,
        record.workOrderId, access.ownerUid, id, access.ownerUid),
    db.prepare(`INSERT INTO trade_team_member_events
      (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
      SELECT ?, ?, ?, ?, 'member', ?, 'member.signing_name_confirmed', ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), access.ownerUid, access.memberId, access.actorUid, access.memberId,
        JSON.stringify({ source: "activity_signature", recordId: id,
          filledFirstName: !existingFirst, filledLastName: !existingLast }), now),
  ]);
  if (result[0]?.meta.changes !== 1) throw new Error("ACTIVITY_SIGNING_PROFILE_CHANGED");
  return loadActivityRecord(access, id, true);
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
  if (current) return upgradeDraftActivityPolicy(access, job, await loadActivityRecord(access, current.id));
  const intent = await getD1().prepare(`SELECT activity_template_id, compliance_organisation_id, intent_snapshot FROM trade_work_order_compliance_intents
    WHERE id = ? AND work_order_id = ? AND installer_uid = ? AND status IN ('planned', 'case_linked')`)
    .bind(intentId, workOrderId, access.ownerUid).first<{ activity_template_id: string; compliance_organisation_id: string; intent_snapshot: string }>();
  if (!intent) throw new Error("ACTIVITY_INTENT_NOT_ACTIVE");
  let storedVariantId = "";
  try {
    const snapshot = JSON.parse(intent.intent_snapshot || "{}") as { activity?: { variantId?: unknown } };
    storedVariantId = string(snapshot.activity?.variantId, 120);
  } catch { /* Older intent snapshots may not contain structured activity data. */ }
  if (storedVariantId && variantId && storedVariantId !== variantId) throw new Error("ACTIVITY_FORM_VARIANT_MISMATCH");
  const builtIn = defaultActivityFieldForm(intent.activity_template_id, storedVariantId || variantId);
  const master = await latestActivityMaster(intent.compliance_organisation_id, builtIn);
  const form: ActivityForm = applyDefaultActivityFormPolicy(master || builtIn, builtIn);
  const id = crypto.randomUUID(); const now = iso();
  const profile = await activityProfileContext(access, job, workOrderId, form);
  const receiptAnswers = await scheduledActivityDocumentReceiptAnswers(access.ownerUid, workOrderId, form);
  const record: ActivityRecord = { id, recordNumber: `TAF-${id.slice(0, 8).toUpperCase()}`, intentId, workOrderId, ownerUid: access.ownerUid,
    organisationId: intent.compliance_organisation_id, revision: 1, status: "draft", form, formSha256: activityHash(form),
    answers: { ...profile.answers, ...receiptAnswers },
    evidence: [], signatures: [], signerDefaults: profile.signerDefaults,
    createdAt: now, updatedAt: now, submittedAt: "", reportUrl: "" };
  await getD1().prepare(`INSERT OR IGNORE INTO trade_activity_field_records
    (id, intent_id, work_order_id, owner_uid, organisation_id, activity_template_id, revision, status, payload, actor_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?)`)
    .bind(id, intentId, workOrderId, access.ownerUid, record.organisationId, form.activityTemplateId, activityCanonical(record), access.actorUid, now, now).run();
  const stored = await getD1().prepare("SELECT id FROM trade_activity_field_records WHERE intent_id = ? AND owner_uid = ?").bind(intentId, access.ownerUid).first<{ id: string }>();
  if (!stored) throw new Error("ACTIVITY_SAVE_FAILED");
  return loadActivityRecord(access, stored.id);
}

async function saveRecord(access: TeamAccess, previous: ActivityRecord, next: ActivityRecord, pdf?: { key: string; hash: string }, expectedAssigneeMemberId = "", requireCustomerDocuments = false) {
  // Re-check the current worker assignment at the mutation boundary.
  await assignedJob(access, previous.workOrderId);
  const receiptGuard = requireCustomerDocuments ? acceptedCustomerDocumentGuard(next) : null;
  next.revision = previous.revision + 1; next.updatedAt = iso();
  const receiptGuardSql = receiptGuard ? `AND EXISTS (SELECT 1 FROM trade_activity_customer_document_deliveries delivery
        WHERE delivery.work_order_id = trade_activity_field_records.work_order_id
          AND delivery.firebase_uid = trade_activity_field_records.owner_uid
          AND delivery.id = ? AND delivery.appointment_id = ? AND delivery.recipient_email_sha256 = ?
          AND delivery.document_ids = ? AND delivery.document_sha256_set = ?
          AND delivery.pack_sha256 = ? AND delivery.accepted_at = ?
          AND delivery.status IN ('provider_accepted', 'sent', 'delivered')
          AND EXISTS (SELECT 1 FROM json_each(delivery.activity_bindings) binding
            WHERE json_extract(binding.value, '$.activityTemplateId') = ?
              AND json_extract(binding.value, '$.variantId') = ?))` : "";
  const result = await getD1().prepare(`UPDATE trade_activity_field_records SET revision = ?, status = ?, payload = ?, actor_uid = ?, updated_at = ?, submitted_at = ?, pdf_object_key = ?, pdf_sha256 = ?
    WHERE id = ? AND owner_uid = ? AND revision = ? AND status = 'draft'
      AND EXISTS (SELECT 1 FROM trade_work_orders w WHERE w.id = work_order_id AND w.firebase_uid = owner_uid
        AND w.record_status = 'active' AND (? = 1 OR w.assignee_member_id = ?)
        AND (? = '' OR w.assignee_member_id = ?))
      AND EXISTS (SELECT 1 FROM trade_work_order_compliance_intents i WHERE i.id = intent_id AND i.status IN ('planned', 'case_linked'))
      ${receiptGuardSql}`)
    .bind(next.revision, next.status, activityCanonical(next), access.actorUid, next.updatedAt, next.submittedAt, pdf?.key || "", pdf?.hash || "",
      previous.id, access.ownerUid, previous.revision, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId,
      expectedAssigneeMemberId, expectedAssigneeMemberId,
      ...(receiptGuard ? [receiptGuard.deliveryId, receiptGuard.appointmentId, receiptGuard.recipientSha256, receiptGuard.documentIds,
        receiptGuard.documentSha256Set, receiptGuard.packSha256, receiptGuard.acceptedAt,
        receiptGuard.activityTemplateId, receiptGuard.variantId] : [])).run();
  if (result.meta.changes !== 1) {
    // Zero writes can mean a changed assignment, withdrawn intent or bounced email,
    // not just another editor. Reload with the same access checks to identify it.
    const latest = await loadActivityRecord(access, previous.id, true);
    assertActivityEditable(latest, previous.revision);
    if (expectedAssigneeMemberId) {
      const assignment = await assignedJob(access, previous.workOrderId);
      if (assignment.assignee_member_id !== expectedAssigneeMemberId) throw new Error("ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED");
    }
    if (receiptGuard) {
      assertActivityCustomerDocumentsAccepted(latest);
      if (activityCanonical(acceptedCustomerDocumentGuard(latest)) !== activityCanonical(receiptGuard)) {
        throw new Error("ACTIVITY_CUSTOMER_DOCUMENTS_NOT_ACCEPTED");
      }
    }
    throw new Error("ACTIVITY_SAVE_FAILED");
  }
  return next;
}

export async function saveActivityAnswers(access: TeamAccess, id: string, expectedRevision: unknown, answers: unknown, baseAnswers?: unknown) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = await loadActivityRecord(access, id, true);
    assertActivityEditable(previous, baseAnswers === undefined ? expectedRevision : previous.revision);
    const derived = new Set(previous.form.fields.filter((field) => field.presentation === "derived").map((field) => field.key));
    const local = normaliseActivityAnswers(previous.form, answers);
    const nextAnswers = baseAnswers === undefined ? local : mergeActivityAnswers(
      normaliseActivityAnswers(previous.form, baseAnswers), local, previous.answers, derived,
    ).merged;
    for (const key of derived) {
      delete nextAnswers[key];
      if (previous.answers[key] !== undefined) nextAnswers[key] = previous.answers[key];
    }
    const next = { ...previous, answers: nextAnswers, hasUserEdits: previous.hasUserEdits || activityHash(previous.answers) !== activityHash(nextAnswers) };
    assertActivitySignedScopeUnchanged(previous, next);
    try { return await saveRecord(access, previous, next); }
    catch (error) {
      if (baseAnswers === undefined || !(error instanceof Error) || error.message !== "ACTIVITY_REVISION_CONFLICT" || attempt === 2) throw error;
    }
  }
  throw new Error("ACTIVITY_SAVE_FAILED");
}

export async function changeActivityVariant(access: TeamAccess, id: string, expectedRevision: unknown, variantId: string) {
  const previous = await loadActivityRecord(access, id, true); assertActivityEditable(previous, expectedRevision);
  if (previous.signatures.length || previous.evidence.length || previous.hasUserEdits) throw new Error("ACTIVITY_VARIANT_ALREADY_STARTED");
  const intent = await getD1().prepare(`SELECT intent_snapshot FROM trade_work_order_compliance_intents
    WHERE id = ? AND work_order_id = ? AND installer_uid = ? AND status IN ('planned', 'case_linked')`)
    .bind(previous.intentId, previous.workOrderId, previous.ownerUid).first<{ intent_snapshot: string }>();
  if (!intent) throw new Error("ACTIVITY_INTENT_NOT_ACTIVE");
  let bookedVariantId = "";
  try {
    const snapshot = JSON.parse(intent.intent_snapshot || "{}") as { activity?: { variantId?: unknown } };
    bookedVariantId = string(snapshot.activity?.variantId, 120);
  } catch { /* Legacy intent snapshots may not contain structured activity data. */ }
  if (bookedVariantId && variantId !== bookedVariantId) throw new Error("ACTIVITY_FORM_VARIANT_MISMATCH");
  const builtIn = defaultActivityFieldForm(previous.form.activityTemplateId, variantId);
  const saved = await latestActivityMaster(previous.organisationId, builtIn);
  const form: ActivityForm = applyDefaultActivityFormPolicy(saved || builtIn, builtIn);
  const retained = Object.fromEntries(Object.entries(previous.answers).filter(([key]) => form.fields.some((field) => field.key === key)));
  const next = { ...previous, form, formSha256: activityHash(form), answers: retained };
  const profile = await activityProfileContext(access, await assignedJob(access, previous.workOrderId), previous.workOrderId, form);
  const refresh = refreshableDerivedAnswers(next);
  const receiptAnswers = await scheduledActivityDocumentReceiptAnswers(previous.ownerUid, previous.workOrderId, form);
  return saveRecord(access, previous, { ...next,
    answers: { ...mergeProfileAnswers(form, refresh.answers, profile.answers), ...receiptAnswers },
    signerDefaults: profile.signerDefaults });
}

export async function signActivityDeclaration(access: TeamAccess, id: string, body: Row) {
  const previous = await loadActivityRecord(access, id, true);
  const declaration = previous.form.declarations.find((item) => item.key === body.declarationKey);
  if (!declaration || !activityConditionMet(declaration.condition, previous.answers)) throw new Error("ACTIVITY_DECLARATION_INVALID");
  // A background save can advance the record without changing anything signed.
  // Bind to the displayed content, allowing harmless revision changes automatically.
  assertActivityEditable(previous, body.expectedScope === undefined ? body.expectedRevision : previous.revision);
  if (body.expectedScope !== undefined && body.expectedScope !== activitySigningScope(previous, declaration.phase)) throw new Error("ACTIVITY_SIGNING_SCOPE_CHANGED");
  assertActivityCustomerDocumentsAccepted(previous);
  const suppliedSignerName = string(body.signerName, 150);
  let signerName = suppliedSignerName;
  if (declaration.role === "technician") {
    const assignment = await assignedJob(access, previous.workOrderId);
    if (!access.memberId || access.memberId !== assignment.assignee_member_id) throw new Error("ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED");
    signerName = string(previous.signerDefaults.technician, 150);
    if (!signerName) throw new Error("ACTIVITY_TECHNICIAN_IDENTITY_REQUIRED");
  }
  if (body.acknowledged !== true || !signerName) throw new Error("ACTIVITY_SIGNATURE_REQUIRED");
  const missing = activityMissing(previous, declaration.phase, false);
  if (missing.length || (declaration.phase === "after" && activityMissing(previous, "before").length)) throw new Error("ACTIVITY_SIGNING_NOT_READY");
  const declarationText = activityDeclarationText(declaration, previous.answers);
  if (/\{\{/.test(declarationText)) throw new Error("ACTIVITY_DECLARATION_DETAILS_REQUIRED");
  const signingScope = activitySigningScope(previous, declaration.phase);
  if (previous.signatures.some((item) => item.declarationKey === declaration.key
    && item.declarationSha256 === activityHash(declarationText) && item.scopeSha256 === signingScope)) {
    throw new Error("ACTIVITY_DECLARATION_ALREADY_SIGNED");
  }
  const next = { ...previous, signatures: [...previous.signatures, {
    id: crypto.randomUUID(), declarationKey: declaration.key, signerName, role: declaration.role,
    phase: declaration.phase, declarationText, declarationSha256: activityHash(declarationText), scopeSha256: signingScope,
    signedAt: iso(), actorUid: access.actorUid, strokes: validateActivityStrokes(body.strokes),
  }] };
  assertActivitySignedScopeUnchanged(previous, next);
  return saveRecord(access, previous, next, undefined, declaration.role === "technician" ? access.memberId : "", true);
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
  assertActivityCustomerDocumentsAccepted(previous);
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
  try { return await saveRecord(access, previous, next, { key, hash }, "", true); } catch (error) { await bucket().delete(key); throw error; }
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
