import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { PiesaError, type PiesaRecord } from "@/lib/veu-electrical-assessment";
import { createVeuElectricalForm, VEU_ELECTRICAL_SIGNER_FIELDS, VEU_ELECTRICAL_SOURCE_URL, VEU_ELECTRICAL_SOURCE_PATH, VEU_ELECTRICAL_SOURCE_SHA256 } from "@/lib/veu-electrical-safety-form";
import { attestPiesaInitial, completePiesaRecord, listPiesaRecords, piesaPresentation, readPiesaEvidence, readPiesaPdf,
  readPiesaRecord, retryPiesaDelivery, savePiesaAnswers, signPiesaDeclaration, startPiesaRecord, uploadPiesaEvidence } from "@/lib/trade-veu-electrical-assessment-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new PiesaError(400, "PIESA_INPUT_INVALID", "Check the assessment request and try again."); }
function string(value: unknown): string { if (typeof value !== "string" || !value || value.length > 600) invalid(); return value; }
function revision(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(); return value; }
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof PiesaError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "PIESA_REQUEST_FAILED";
  if (code.startsWith("INVALID_ACTIVITY_") || code === "ACTIVITY_SIGNATURE_REQUIRED") return adminJson({ ok: false, code, error: "Check the highlighted answers or drawn signature and try again." }, 400);
  if (/AUTH|ACCESS|REQUIRED|VERIFICATION|ROLE|SUSPENDED|INACTIVE|JOB_NOT_ASSIGNED/.test(code)) return adminJson({ ok: false, code: "PIESA_ACCESS_REQUIRED", error: "Active authorised business access is required." }, 403);
  return adminJson({ ok: false, code: "PIESA_REQUEST_FAILED", error: "The assessment request could not finish. Refresh its saved state before trying again." }, 503);
}
function bytesResponse(data: { bytes: Uint8Array; contentType: string; fileName: string }) {
  return new Response(new Uint8Array(data.bytes), { headers: { "Content-Type": data.contentType,
    "Content-Disposition": `inline; filename="${data.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
export async function GET(request: Request) {
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canViewFieldEvidence) throw new PiesaError(403, "PIESA_ACCESS_REQUIRED", "Your access does not include job assessments.");
    const query = new URL(request.url).searchParams;
    if (query.get("catalogue") === "1") return adminJson({ ok: true, form: createVeuElectricalForm(), signerFields: VEU_ELECTRICAL_SIGNER_FIELDS, canManage: access.canManageFieldEvidence,
      source: { url: VEU_ELECTRICAL_SOURCE_URL, path: VEU_ELECTRICAL_SOURCE_PATH, sha256: VEU_ELECTRICAL_SOURCE_SHA256, label: "Official Victorian electrical safety assessment, March 2026" } });
    const id = query.get("recordId");
    if (id) {
      if (query.get("view") === "pdf") return bytesResponse(await readPiesaPdf(access, id));
      if (query.get("view") === "evidence") return bytesResponse(await readPiesaEvidence(access, id, string(query.get("evidenceId"))));
      return adminJson({ ok: true, record: await piesaPresentation(access, await readPiesaRecord(access, id)), canManage: access.canManageFieldEvidence });
    }
    return adminJson({ ok: true, records: await listPiesaRecords(access, string(query.get("workOrderId"))), canManage: access.canManageFieldEvidence });
  } catch (error) { return failure(error); }
}
async function multipart(request: Request) {
  const reader = request.body?.getReader(); if (!reader) invalid();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
      if (length > 8 * 1024 * 1024 + 64 * 1024) { await reader.cancel(); throw new PiesaError(413, "PIESA_FILE_TOO_LARGE", "Choose an attachment up to 8 MB."); }
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
    if (!access.canManageFieldEvidence) throw new PiesaError(403, "PIESA_ACCESS_REQUIRED", "Your access does not allow changing assessments.");
    let record: PiesaRecord;
    if (!patch && request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      const data = await multipart(request), file = data.get("file");
      if (!(file instanceof File) || data.get("action") !== "upload") invalid();
      record = await uploadPiesaEvidence(access, string(data.get("recordId")), revision(Number(data.get("baseRevision"))), string(data.get("fieldKey")), file,
        data.has("requestId") ? string(data.get("requestId")) : undefined);
    } else {
      const body = await readBoundedJsonRequest(request, 256 * 1024); if (!isObject(body)) invalid();
      const key = body.requestId === undefined ? undefined : string(body.requestId);
      if (patch) record = await savePiesaAnswers(access, string(body.recordId), revision(body.baseRevision), body.answers, key);
      else if (body.action === "start") record = await startPiesaRecord(access, string(body.workOrderId));
      else if (body.action === "complete") record = await completePiesaRecord(access, string(body.recordId), revision(body.baseRevision), key);
      else if (body.action === "retry_delivery") return adminJson({ ok: true, record: await retryPiesaDelivery(access, string(body.recordId)) });
      else if (body.action === "attest_initial") record = await attestPiesaInitial(access, string(body.recordId), revision(body.baseRevision), string(body.scopeSha256), body.accepted, key);
      else if (body.action === "sign") record = await signPiesaDeclaration(access, string(body.recordId), revision(body.baseRevision), {
        declarationKey: string(body.declarationKey), signerName: string(body.signerName), scopeSha256: string(body.scopeSha256), strokes: body.strokes, accepted: body.accepted,
      }, key);
      else invalid();
    }
    return adminJson({ ok: true, record: await piesaPresentation(access, record) });
  } catch (error) { return failure(error); }
}
export function POST(request: Request) { return mutate(request, false); }
export function PATCH(request: Request) { return mutate(request, true); }
