import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { SafetyCheckError, type SafetyCheckKind, type SafetyCheckRecord } from "@/lib/job-safety-check";
import { createOfficialSafetyCheckForm, OFFICIAL_SAFETY_SIGNER_FIELDS } from "@/lib/official-safety-check-forms";
import { completeSafetyCheckRecordWithProgress, listSafetyCheckRecords, safetyCheckPresentation, readSafetyCheckEvidence,
  readSafetyCheckPdf, readSafetyCheckRecord, recoverSafetyCheckJobProgress, retrySafetyCheckDelivery,
  saveSafetyCheckAnswers, signSafetyCheckDeclaration, startSafetyCheckRecord, uploadSafetyCheckEvidence } from "@/lib/trade-safety-checks-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new SafetyCheckError(400, "SAFETY_CHECK_INPUT_INVALID", "Check the safety check request and try again."); }
function string(value: unknown): string { if (typeof value !== "string" || !value || value.length > 600) invalid(); return value; }
function revision(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(); return value; }
function kind(value: unknown): SafetyCheckKind { if (value !== "electrical" && value !== "gas") invalid(); return value; }
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof SafetyCheckError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "SAFETY_CHECK_REQUEST_FAILED";
  if (code.startsWith("INVALID_ACTIVITY_") || code === "ACTIVITY_SIGNATURE_REQUIRED") return adminJson({ ok: false, code, error: "Check the answers or drawn signature and try again." }, 400);
  if (/AUTH|ACCESS|REQUIRED|VERIFICATION|ROLE|SUSPENDED|INACTIVE|JOB_NOT_ASSIGNED/.test(code)) return adminJson({ ok: false, code: "SAFETY_CHECK_ACCESS_REQUIRED", error: "Active authorised business access is required." }, 403);
  return adminJson({ ok: false, code: "SAFETY_CHECK_REQUEST_FAILED", error: "The safety check request could not finish. Refresh its saved state before trying again." }, 503);
}
function bytesResponse(data: { bytes: Uint8Array; contentType: string; fileName: string }) {
  return new Response(new Uint8Array(data.bytes), { headers: { "Content-Type": data.contentType,
    "Content-Disposition": `inline; filename="${data.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
export async function GET(request: Request) {
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canViewFieldEvidence) throw new SafetyCheckError(403, "SAFETY_CHECK_ACCESS_REQUIRED", "Your access does not include job safety checks.");
    const query = new URL(request.url).searchParams;
    if (query.get("view") === "catalogue" || query.get("catalogue") === "1") return adminJson({ ok: true,
      forms: [createOfficialSafetyCheckForm("electrical"), createOfficialSafetyCheckForm("gas")],
      signerFields: OFFICIAL_SAFETY_SIGNER_FIELDS, canManage: access.canManageFieldEvidence });
    const id = query.get("recordId");
    if (id) {
      if (query.get("view") === "pdf") return bytesResponse(await readSafetyCheckPdf(access, id));
      if (query.get("view") === "evidence") return bytesResponse(await readSafetyCheckEvidence(access, id, string(query.get("evidenceId"))));
      return adminJson({ ok: true, record: await safetyCheckPresentation(access, await readSafetyCheckRecord(access, id)), canManage: access.canManageFieldEvidence });
    }
    return adminJson({ ok: true, records: await listSafetyCheckRecords(access, string(query.get("workOrderId"))), canManage: access.canManageFieldEvidence });
  } catch (error) { return failure(error); }
}
async function multipart(request: Request) {
  const reader = request.body?.getReader(); if (!reader) invalid();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
      if (length > 6 * 1024 * 1024 + 64 * 1024) { await reader.cancel(); throw new SafetyCheckError(413, "SAFETY_CHECK_FILE_TOO_LARGE", "Choose a PDF up to 6 MB or a photo up to 2 MB."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
}
async function mutate(request: Request, patch: boolean) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canManageFieldEvidence) throw new SafetyCheckError(403, "SAFETY_CHECK_ACCESS_REQUIRED", "Your access does not allow changing safety checks.");
    let record: SafetyCheckRecord;
    if (!patch && request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      const data = await multipart(request), file = data.get("file");
      if (!(file instanceof File) || data.get("action") !== "upload") invalid();
      const key = data.get("requestKey") ?? data.get("requestId");
      record = await uploadSafetyCheckEvidence(access, string(data.get("recordId")), revision(Number(data.get("baseRevision"))), string(data.get("fieldKey")), file,
        key === null ? undefined : string(key));
    } else {
      const body = await readBoundedJsonRequest(request, 256 * 1024); if (!isObject(body)) invalid();
      const requestKey = body.requestKey ?? body.requestId, key = requestKey === undefined ? undefined : string(requestKey);
      if (patch || body.action === "save") record = await saveSafetyCheckAnswers(access, string(body.recordId), revision(body.baseRevision), body.answers, key);
      else if (body.action === "start") record = await startSafetyCheckRecord(access, string(body.workOrderId), kind(body.kind));
      else if (body.action === "complete" || body.action === "recover_progress") {
        const completed = body.action === "complete"
          ? await completeSafetyCheckRecordWithProgress(access, string(body.recordId), revision(body.baseRevision), key)
          : await recoverSafetyCheckJobProgress(access, string(body.recordId), revision(body.baseRevision));
        return adminJson({ ok: true, record: await safetyCheckPresentation(access, completed.record, completed.jobProgress) });
      }
      else if (body.action === "retry_delivery") return adminJson({ ok: true, record: await retrySafetyCheckDelivery(access, string(body.recordId), revision(body.baseRevision)) });
      else if (body.action === "sign") record = await signSafetyCheckDeclaration(access, string(body.recordId), revision(body.baseRevision), {
        declarationKey: string(body.declarationKey), signerName: string(body.signerName), scopeSha256: string(body.scopeSha256), strokes: body.strokes, accepted: body.accepted,
      }, key);
      else invalid();
    }
    return adminJson({ ok: true, record: await safetyCheckPresentation(access, record) });
  } catch (error) { return failure(error); }
}
export function POST(request: Request) { return mutate(request, false); }
export function PATCH(request: Request) { return mutate(request, true); }
