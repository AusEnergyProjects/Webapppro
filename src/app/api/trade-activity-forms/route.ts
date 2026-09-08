import { getD1 } from "../../../../db";
import { adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { requireComplianceAccess } from "@/lib/compliance-access-server";
import { canEditCreditexFieldMasters } from "@/lib/creditex-field-master-access";
import { resolveActiveCreditexOfficialSourceOrganisation } from "@/lib/creditex-official-source-custody-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { activityFieldCatalogue, applyDefaultActivityFormPolicy, defaultActivityFieldForm } from "@/lib/trade-activity-forms-library";
import { activityCanonical, activityHash, normaliseActivityAnswers, type ActivityForm } from "@/lib/trade-activity-forms";
import {
  activityPresentation, activitySigningProfileSetup, saveActivitySigningProfile, changeActivityVariant, listActivityRecords, loadActivityRecord, openActivityRecord, readActivityConsumerDocument, readActivityEvidence, readActivityPdf,
  saveActivityAnswers, shareActivityReport, sharedActivityRecord, signActivityDeclaration, submitActivityRecord, uploadActivityEvidence,
} from "@/lib/trade-activity-forms-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const errorMessages: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, "Sign in to continue."],
  ACTIVITY_ACCESS_REQUIRED: [403, "Your Team access does not include this action."],
  ACTIVITY_AUTHOR_REQUIRED: [403, "An authorised Australian Energy Assessments or Creditex master-form login is required."],
  ACTIVITY_RECORD_NOT_FOUND: [404, "This activity form was not found."],
  JOB_NOT_FOUND: [404, "Job not found."], JOB_NOT_ASSIGNED: [403, "This job is assigned to another worker."],
  ACTIVITY_INTENT_NOT_ACTIVE: [409, "This activity is no longer part of the job."],
  ACTIVITY_REVISION_CONFLICT: [409, "The latest changes are being saved. Your work is retained."],
  ACTIVITY_SIGNING_SCOPE_CHANGED: [409, "The work details changed before signing. Check the updated details and sign again."],
  ACTIVITY_ALREADY_SUBMITTED: [409, "This completed record has already been provided to Creditex."],
  ACTIVITY_CUSTOMER_DOCUMENTS_NOT_ACCEPTED: [409, "Resend the required customer documents and wait for the email provider to accept them before customer agreement."],
  ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED: [409, "The assigned technician must sign this work. Check the job's worker assignment."],
  ACTIVITY_SIGNING_PROFILE_NAME_REQUIRED: [400, "Add your first and last name for technician signing."],
  ACTIVITY_SIGNING_PROFILE_CHANGED: [409, "Your team profile or job assignment changed. Reopen this signature to use the current details."],
  ACTIVITY_TECHNICIAN_IDENTITY_REQUIRED: [409, "Add the assigned technician's name in Teams, then return to this job."],
  ACTIVITY_SIGNED_SCOPE_LOCKED: [409, "These details have been signed. Signed details must stay unchanged. After-work fields remain available after before-work signing."],
  ACTIVITY_SIGNING_NOT_READY: [409, "Complete the required fields and evidence for this stage before signing."],
  ACTIVITY_SIGNATURE_REQUIRED: [400, "Enter the signer's name, draw their signature and confirm the displayed declaration."],
  ACTIVITY_DECLARATION_ALREADY_SIGNED: [409, "This declaration has already been signed."],
  ACTIVITY_DECLARATION_DETAILS_REQUIRED: [409, "Complete the declaration details before signing."],
  ACTIVITY_FORM_INCOMPLETE: [409, "Complete the required answers, evidence and signatures before providing this record to Creditex."],
  ACTIVITY_REPORT_LINK_UNAVAILABLE: [404, "This report link has expired or been revoked."],
  INVALID_ACTIVITY_FILE: [400, "Choose a JPEG, PNG or PDF file up to 8 MB. Photo questions require an image."],
  ACTIVITY_EVIDENCE_LIMIT: [400, "This record has reached its evidence limit."],
  ACTIVITY_REPORT_EVIDENCE_LIMIT: [400, "Add a smaller report preview for this image. The original file remains the evidence record."],
  ACTIVITY_PHOTO_LOCATION_REQUIRED: [400, "This photo needs its capture time and an accurate location. Enable location access and capture it again."],
  ACTIVITY_FORM_UNAVAILABLE: [404, "This activity is not current. Choose a current activity."],
  ACTIVITY_VARIANT_ALREADY_STARTED: [409, "The premises form cannot change after work has been saved. Choose the premises type when first opening the form."],
};
function failure(error: unknown) {
  if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "ACTIVITY_REQUEST_FAILED";
  const known = errorMessages[code];
  if (known) return adminJson({ ok: false, code, error: known[1] }, known[0]);
  if (code.startsWith("INVALID_ACTIVITY_") || code === "ACTIVITY_DECLARATION_INVALID") return adminJson({ ok: false, code, error: "Check the form details and try again." }, 400);
  if (/AUTH|ACCESS|REQUIRED|IDENTITY|VERIFICATION|ROLE|SUSPENDED|INACTIVE/.test(code)) return adminJson({ ok: false, code, error: "Active authorised access is required." }, 403);
  console.error("Activity field form request failed", code);
  return adminJson({ ok: false, code: "ACTIVITY_REQUEST_FAILED", error: "The activity form could not be loaded or saved. Your saved work is retained." }, 500);
}
function bytesResponse(data: { bytes: Uint8Array; contentType: string; fileName: string }) {
  return new Response(new Uint8Array(data.bytes), { headers: { "Content-Type": data.contentType,
    "Content-Disposition": `inline; filename="${data.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
async function masterActor(request: Request, mode: string) {
  if (mode === "admin") {
    const actor = await requireAdminIdentity(request, ["owner", "admin"]);
    return { uid: actor.uid, organisationId: await resolveActiveCreditexOfficialSourceOrganisation(getD1()) };
  }
  if (mode !== "creditex") throw new Error("ACTIVITY_AUTHOR_REQUIRED");
  const actor = await requireComplianceAccess(request, { allowedRoles: ["admin", "case_manager", "reviewer"] }, getD1());
  if (!canEditCreditexFieldMasters(actor)) throw new Error("ACTIVITY_AUTHOR_REQUIRED");
  return { uid: actor.uid, organisationId: actor.organisationId };
}

function validateMaster(raw: unknown, expected: ActivityForm): ActivityForm {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_ACTIVITY_MASTER");
  const form = raw as ActivityForm;
  if (form.activityTemplateId !== expected.activityTemplateId || form.programCode !== expected.programCode || form.variantId !== expected.variantId
    || typeof form.title !== "string" || !form.title.trim() || form.title.length > 300 || !Array.isArray(form.fields) || !form.fields.length || form.fields.length > 700
    || !Array.isArray(form.declarations) || form.declarations.length > 100 || !Array.isArray(form.sources) || !form.sources.length || !Array.isArray(form.reviewNotes)
    || form.reviewNotes.some((value) => typeof value !== "string" || value.length > 4000)) throw new Error("INVALID_ACTIVITY_MASTER");
  const keys = new Set<string>();
  for (const field of form.fields) {
    if (!field || typeof field.key !== "string" || !/^[a-zA-Z0-9._:-]{1,180}$/.test(field.key) || keys.has(field.key)
      || typeof field.label !== "string" || !field.label.trim() || field.label.length > 1000 || typeof field.section !== "string" || field.section.length > 200
      || !["text", "number", "date", "select", "boolean", "photo", "document"].includes(field.type)
      || typeof field.required !== "boolean" || !["before", "after"].includes(field.phase) || typeof field.help !== "string" || field.help.length > 10_000
      || (field.presentation !== undefined && !["question", "prefilled", "derived"].includes(field.presentation))
      || (field.autofill !== undefined && (typeof field.autofill !== "string" || !/^[a-zA-Z0-9._:\[\]-]{1,240}$/.test(field.autofill)))
      || (field.sourceRequirementId !== undefined && (typeof field.sourceRequirementId !== "string" || !/^[a-zA-Z0-9._:-]{1,240}$/.test(field.sourceRequirementId)))
      || (field.evidenceFor !== undefined && (!Array.isArray(field.evidenceFor) || field.evidenceFor.length > 24
        || field.evidenceFor.some((key) => typeof key !== "string" || !/^[a-zA-Z0-9._:\[\]-]{1,180}$/.test(key))))
      || (field.requireLocation !== undefined && (typeof field.requireLocation !== "boolean" || (field.requireLocation && field.type !== "photo")))
      || (field.repeatGroup !== undefined && (typeof field.repeatGroup !== "string" || !/^[a-zA-Z0-9._:\[\]-]{1,100}$/.test(field.repeatGroup)))
      || (field.requiredValue !== undefined && !["string", "number", "boolean"].includes(typeof field.requiredValue))
      || (field.referenceDocuments !== undefined && (!Array.isArray(field.referenceDocuments) || field.referenceDocuments.length > 12
        || field.referenceDocuments.some((document) => !document || typeof document.title !== "string" || !document.title.trim() || document.title.length > 300
          || typeof document.url !== "string" || document.url.length > 2048 || !(/^https:\/\/[^\s]+$/.test(document.url) || document.url === "/api/trade-activity-forms?consumerDocument=veu-rights-v1"))))
      || !Array.isArray(field.options) || field.options.length > 100 || field.options.some((option) => typeof option !== "string" || option.length > 1000)
      || (field.optionLabels !== undefined && (!field.optionLabels || typeof field.optionLabels !== "object" || Array.isArray(field.optionLabels)
        || Object.entries(field.optionLabels).some(([key, label]) => !field.options.includes(key) || typeof label !== "string" || !label.trim() || label.length > 1000)))
      || (field.type === "select" && field.options.length < 2)) throw new Error("INVALID_ACTIVITY_MASTER");
    keys.add(field.key);
  }
  const conditionValid = (value: unknown, depth = 0): boolean => {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) return false;
    const c = value as Row;
    if (c.all !== undefined || c.any !== undefined) {
      const items = c.all ?? c.any;
      return Object.keys(c).length === 1 && Array.isArray(items) && items.length <= 20 && items.every((item) => conditionValid(item, depth + 1));
    }
    if (typeof c.fieldKey !== "string" || !keys.has(c.fieldKey) || Object.keys(c).length !== 2) return false;
    const operators = ["equals", "notEquals", "lessThanOrEqual"].filter((key) => Object.prototype.hasOwnProperty.call(c, key));
    if (operators.length !== 1) return false;
    const item = c[operators[0]];
    return operators[0] === "lessThanOrEqual" ? typeof item === "number" && Number.isFinite(item)
      : ["string", "number", "boolean"].includes(typeof item) && (typeof item !== "number" || Number.isFinite(item));
  };
  if (form.fields.some((field) => !conditionValid(field.condition))) throw new Error("INVALID_ACTIVITY_MASTER");
  const declarationKeys = new Set<string>();
  for (const declaration of form.declarations) {
    if (!declaration || typeof declaration.key !== "string" || declarationKeys.has(declaration.key) || typeof declaration.title !== "string"
      || typeof declaration.text !== "string" || !declaration.text.trim() || declaration.text.length > 40_000 || !["before", "after"].includes(declaration.phase)
      || !["customer", "technician", "other"].includes(declaration.role) || typeof declaration.required !== "boolean" || !conditionValid(declaration.condition)) throw new Error("INVALID_ACTIVITY_MASTER");
    declarationKeys.add(declaration.key);
  }
  const fieldMap = new Map(form.fields.map((field) => [field.key, field]));
  const references = (condition: typeof form.fields[number]["condition"]): string[] => condition
    ? condition.fieldKey ? [condition.fieldKey] : [...(condition.all || []), ...(condition.any || [])].flatMap(references) : [];
  const conditionLeaves = (condition: typeof form.fields[number]["condition"]): NonNullable<typeof condition>[] => condition
    ? condition.fieldKey ? [condition] : [...(condition.all || []), ...(condition.any || [])].flatMap(conditionLeaves) : [];
  const dependencies = new Map(form.fields.map((field) => [field.key, references(field.condition)]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const checkDependency = (key: string) => {
    if (visiting.has(key)) throw new Error("INVALID_ACTIVITY_MASTER");
    if (visited.has(key)) return;
    visiting.add(key);
    const field = fieldMap.get(key)!;
    for (const dependency of dependencies.get(key) || []) {
      const input = fieldMap.get(dependency)!;
      if (["photo", "document"].includes(input.type) || (field.phase === "before" && input.phase === "after")) throw new Error("INVALID_ACTIVITY_MASTER");
      if (conditionLeaves(field.condition).some((condition) => condition.fieldKey === dependency
        && condition.lessThanOrEqual !== undefined && input.type !== "number")) throw new Error("INVALID_ACTIVITY_MASTER");
      checkDependency(dependency);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const field of form.fields) {
    checkDependency(field.key);
    if (field.requiredValue !== undefined) {
      try { if (normaliseActivityAnswers(form, { [field.key]: field.requiredValue })[field.key] === undefined) throw new Error("INVALID_ACTIVITY_MASTER"); }
      catch { throw new Error("INVALID_ACTIVITY_MASTER"); }
    }
  }
  for (const declaration of form.declarations) {
    for (const key of references(declaration.condition)) {
      const input = fieldMap.get(key)!;
      if (["photo", "document"].includes(input.type) || (declaration.phase === "before" && input.phase === "after")) throw new Error("INVALID_ACTIVITY_MASTER");
    }
    for (const token of declaration.text.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const input = fieldMap.get(`binding.${token[1]}`);
      if (!input || ["photo", "document"].includes(input.type) || (declaration.phase === "before" && input.phase === "after")
        || (input.condition && activityCanonical(input.condition) !== activityCanonical(declaration.condition))) throw new Error("INVALID_ACTIVITY_MASTER");
    }
    if (/\{\{|\}\}/.test(declaration.text.replace(/\{\{[^{}]+\}\}/g, ""))) throw new Error("INVALID_ACTIVITY_MASTER");
  }
  if (form.sources.some((source) => !source || typeof source.title !== "string" || !/^https:\/\//.test(source.url) || (source.sha256 && !/^[0-9a-f]{64}$/.test(source.sha256)))) throw new Error("INVALID_ACTIVITY_MASTER");
  return { ...form, id: expected.id, version: expected.version, variantOptions: expected.variantOptions };
}

const escape = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const query = new URL(request.url).searchParams; const token = query.get("reportToken") || "";
    if (query.has("consumerDocument")) return bytesResponse(await readActivityConsumerDocument(query.get("consumerDocument") || ""));
    if (token) {
      const record = await sharedActivityRecord(token);
      if (query.get("view") === "pdf") return bytesResponse(await readActivityPdf(record));
      if (query.get("view") === "evidence") return bytesResponse(await readActivityEvidence(record, query.get("evidenceId") || ""));
      const base = `?reportToken=${encodeURIComponent(token)}`;
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(record.form.title)} | TLink</title><style>body{font:16px system-ui;background:#081923;color:#e8f4f7;margin:0}main{max-width:800px;margin:auto;padding:24px}a{color:#62e5c0}article{padding:18px;background:#112b39;border-radius:12px;margin:16px 0}img{width:100%;max-height:500px;object-fit:contain}small{overflow-wrap:anywhere;color:#b9cbd3}h1{font-size:28px}</style><main><p>TLink / Creditex</p><h1>${escape(record.form.title)}</h1><p>${escape(record.recordNumber)} | Completed ${escape(record.submittedAt)}</p><p>Field record provided to Creditex for review.</p><p><a href="${base}&view=pdf">View complete signed report (PDF)</a></p>${record.evidence.map((item) => `<article><h2>${escape(record.form.fields.find((field) => field.key === item.fieldKey)?.label || item.fileName)}</h2>${item.contentType.startsWith("image/") ? `<img alt="${escape(item.fileName)}" src="${base}&view=evidence&evidenceId=${encodeURIComponent(item.id)}">` : `<a href="${base}&view=evidence&evidenceId=${encodeURIComponent(item.id)}">${escape(item.fileName)}</a>`}<p>Captured ${escape(item.capturedAt || "Time unavailable")}</p><p>Location: ${item.latitude === null || item.longitude === null ? "Unavailable" : escape(`${item.latitude}, ${item.longitude} (accuracy ${item.accuracy ?? "unavailable"} m)`)}</p><small>Original SHA-256 ${escape(item.sha256)}</small></article>`).join("")}</main></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    }
    if (query.get("view") === "masters" || query.get("view") === "review_queue") {
      const actor = await masterActor(request, query.get("actorMode") || "");
      if (query.get("view") === "review_queue") {
        const records = await getD1().prepare(`SELECT payload FROM trade_activity_field_records WHERE organisation_id = ? AND status = 'submitted_for_creditex_review' ORDER BY submitted_at DESC LIMIT 100`).bind(actor.organisationId).all<{ payload: string }>();
        return adminJson({ ok: true, records: records.results.map((row) => activityPresentation(JSON.parse(row.payload))) });
      }
      const templateId = query.get("activityTemplateId") || "";
      if (!templateId) return adminJson({ ok: true, catalogue: activityFieldCatalogue() });
      const builtIn = defaultActivityFieldForm(templateId, query.get("variantId") || "");
      const saved = await getD1().prepare("SELECT form_json, version FROM trade_activity_field_masters WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ? ORDER BY version DESC LIMIT 1")
        .bind(actor.organisationId, templateId, builtIn.variantId).first<{ form_json: string; version: number }>();
      return adminJson({ ok: true, form: applyDefaultActivityFormPolicy(saved ? JSON.parse(saved.form_json) : builtIn, builtIn), expectedVersion: saved?.version || 0 });
    }
    const access = await requireInstallerTeamAccess(request); const id = query.get("recordId") || "";
    if (id) {
      const record = await loadActivityRecord(access, id);
      if (query.get("view") === "pdf") return bytesResponse(await readActivityPdf(record));
      if (query.get("view") === "evidence") return bytesResponse(await readActivityEvidence(record, query.get("evidenceId") || ""));
      return adminJson({ ok: true, record: activityPresentation(record, record.signerDefaults.technician ? undefined : await activitySigningProfileSetup(access, record)) });
    }
    return adminJson({ ok: true, records: await listActivityRecords(access, query.get("workOrderId") || "") });
  } catch (error) { return failure(error); }
}

async function boundedFormData(request: Request) {
  if (!request.body) throw new Error("INVALID_ACTIVITY_FILE");
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 9 * 1024 * 1024 + 32 * 1024) { await reader.cancel(); throw new Error("INVALID_ACTIVITY_FILE"); } parts.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const access = await requireInstallerTeamAccess(request); const data = await boundedFormData(request); const file = data.get("file");
      if (!(file instanceof File)) throw new Error("INVALID_ACTIVITY_FILE");
      const preview = data.get("preview");
      const record = await uploadActivityEvidence(access, String(data.get("recordId") || ""), Number(data.get("expectedRevision")), String(data.get("fieldKey") || ""), file, JSON.parse(String(data.get("captureMetadata") || "{}")), String(data.get("clientUploadId") || ""), preview instanceof File ? preview : undefined);
      return adminJson({ ok: true, record: activityPresentation(record, record.signerDefaults.technician ? undefined : await activitySigningProfileSetup(access, record)) });
    }
    const parsed = await readBoundedJsonRequest(request, 1024 * 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_ACTIVITY_REQUEST");
    const body = parsed as Row; const action = str(body.action);
    if (action === "view_review_report") {
      const actor = await masterActor(request, str(body.actorMode));
      const record = await getD1().prepare(`SELECT id FROM trade_activity_field_records WHERE id = ? AND organisation_id = ? AND status = 'submitted_for_creditex_review'`)
        .bind(str(body.recordId), actor.organisationId).first<{ id: string }>();
      if (!record) throw new Error("ACTIVITY_RECORD_NOT_FOUND");
      const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); const now = new Date().toISOString();
      await getD1().prepare(`INSERT INTO trade_activity_field_report_links (id, record_id, token_sha256, expires_at, created_by_uid, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), record.id, activityHash(secret), new Date(Date.now() + 60 * 60 * 1000).toISOString(), actor.uid, now).run();
      return adminJson({ ok: true, reportUrl: `${new URL(request.url).origin}${new URL(request.url).pathname}?reportToken=${secret}` });
    }
    if (action === "save_master") {
      const actor = await masterActor(request, str(body.actorMode)); const builtIn = defaultActivityFieldForm(str(body.activityTemplateId), str(body.variantId));
      const current = await getD1().prepare("SELECT MAX(version) version FROM trade_activity_field_masters WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ?")
        .bind(actor.organisationId, builtIn.activityTemplateId, builtIn.variantId).first<{ version: number | null }>();
      const expectedVersion = Number(current?.version || 0);
      if (body.expectedVersion !== expectedVersion) throw new Error("ACTIVITY_REVISION_CONFLICT");
      const governedForm = validateMaster(applyDefaultActivityFormPolicy(validateMaster(body.form, builtIn), builtIn), builtIn);
      const form = { ...governedForm, version: Math.max(builtIn.version, expectedVersion) + 1 };
      const result = await getD1().prepare(`INSERT INTO trade_activity_field_masters (id, organisation_id, activity_template_id, variant_id, version, form_json, form_sha256, published_by_uid, published_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT MAX(version) FROM trade_activity_field_masters WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ?), 0) = ?`)
        .bind(crypto.randomUUID(), actor.organisationId, form.activityTemplateId, form.variantId, form.version, activityCanonical(form), activityHash(form), actor.uid, new Date().toISOString(),
          actor.organisationId, form.activityTemplateId, form.variantId, expectedVersion).run();
      if (result.meta.changes !== 1) throw new Error("ACTIVITY_REVISION_CONFLICT");
      return adminJson({ ok: true, form, expectedVersion: form.version });
    }
    const access = await requireInstallerTeamAccess(request); const id = str(body.recordId);
    if (action === "share_report" || action === "revoke_report") return adminJson({ ok: true, reportUrl: await shareActivityReport(access, id, new URL(request.url).origin, action === "revoke_report") });
    const record = action === "open" ? await openActivityRecord(access, str(body.workOrderId), str(body.intentId), str(body.variantId))
      : action === "save_signing_profile" ? await saveActivitySigningProfile(access, id, body)
      : action === "save" ? await saveActivityAnswers(access, id, body.expectedRevision, body.answers, body.baseAnswers)
      : action === "change_variant" ? await changeActivityVariant(access, id, body.expectedRevision, str(body.variantId))
      : action === "sign" ? await signActivityDeclaration(access, id, body)
      : action === "submit" ? await submitActivityRecord(access, id, body.expectedRevision)
      : null;
    if (!record) throw new Error("INVALID_ACTIVITY_ACTION");
    return adminJson({ ok: true, record: activityPresentation(record, record.signerDefaults.technician ? undefined : await activitySigningProfileSetup(access, record)) });
  } catch (error) { return failure(error); }
}
