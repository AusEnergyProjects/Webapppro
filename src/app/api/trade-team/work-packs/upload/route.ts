import { getD1 } from "../../../../../../db";
import { adminJson } from "@/lib/admin-server";
import {
  captureAssignedCreditexActivityWorkPackBrowserUpload,
  type CreditexWorkPackBrowserUploadPurpose,
} from "@/lib/creditex-activity-work-pack-server";
import {
  assignedWorkPackError,
  assignedWorkPackOrigin,
  assignedWorkPackRequestScope,
} from "../_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAXIMUM_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAXIMUM_MULTIPART_REQUEST_BYTES = MAXIMUM_BROWSER_UPLOAD_BYTES
  + 1024 * 1024;

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const rejected = assignedWorkPackOrigin(request);
  if (rejected) return rejected;
  try {
    const contentType = String(request.headers.get("content-type") || "")
      .toLowerCase();
    if (!contentType.startsWith("multipart/form-data;")) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_MULTIPART_REQUIRED",
        error: "Send the exact browser field file as multipart form data.",
      }, 415);
    }
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = Number(contentLengthHeader);
    if (!contentLengthHeader
      || !Number.isSafeInteger(contentLength) || contentLength < 1) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_LENGTH_REQUIRED",
        error: "Browser work-pack uploads require an exact Content-Length.",
      }, 411);
    }
    if (
      contentLength > MAXIMUM_MULTIPART_REQUEST_BYTES
    ) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_SIZE_INVALID",
        error: "Browser work-pack files must be no larger than 50 MB.",
      }, 413);
    }
    const scope = await assignedWorkPackRequestScope(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_FILE_REQUIRED",
        error: "Choose an exact field file to upload.",
      }, 400);
    }
    if (file.size > MAXIMUM_BROWSER_UPLOAD_BYTES) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_SIZE_INVALID",
        error: "Browser work-pack files must be no larger than 50 MB.",
      }, 413);
    }
    const purposeValue = formText(form, "purpose");
    if (purposeValue !== "artifact" && purposeValue !== "signature") {
      return adminJson({
        ok: false,
        code: "WORK_PACK_UPLOAD_PURPOSE_INVALID",
        error: "Choose artifact or signature browser custody.",
      }, 400);
    }
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const bytes = new Uint8Array(sourceBytes.byteLength);
    bytes.set(sourceBytes);
    const result = await captureAssignedCreditexActivityWorkPackBrowserUpload(
      getD1(),
      {
        ...scope,
        caseInstanceId: formText(form, "caseInstanceId"),
        sectionKey: formText(form, "sectionKey"),
        repeatInstanceKey: formText(form, "repeatInstanceKey") || undefined,
        promptKey: formText(form, "promptKey"),
        clientUploadId: formText(form, "clientUploadId"),
        purpose: purposeValue as CreditexWorkPackBrowserUploadPurpose,
        fileName: file.name,
        contentType: file.type,
        bytes,
      },
    );
    return adminJson({ ok: true, ...result }, result.status === "applied" ? 201 : 200);
  } catch (error) {
    return assignedWorkPackError(error);
  }
}
