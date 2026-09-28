import { getD1 } from "../../../../db";
import { getCustomerProjectEvidenceBucket } from "@/lib/customer-project-evidence-bucket";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { mfaErrorResponse } from "@/lib/admin-server";
import { deleteMessageMedia, readMessageMedia, uploadMessageMedia } from "@/lib/trade-message-media-server";

export const runtime = "edge";
const json = (value: object, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); return !origin || origin === new URL(request.url).origin; }
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError) return json({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return json({ ok: false, error: "Sign in to use attachments." }, 401);
  if (["TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED"].includes(code)) return json({ ok: false, error: "Team access is required." }, 403);
  const errors: Record<string, string> = {
    MESSAGE_ACCESS_REQUIRED: "This conversation or team member is no longer available to you.",
    MESSAGE_MEDIA_SIZE: "Photos must be under 3 MB and voice notes under 5 MB.",
    MESSAGE_IMAGE_INVALID: "Choose a valid photo. Please try exporting a fresh JPEG or PNG.",
    MESSAGE_MEDIA_TYPE: "Choose a JPEG or PNG photo, or record a supported audio-only voice note.",
    MESSAGE_MEDIA_TARGET: "Choose a conversation or a team member.",
    MESSAGE_MEDIA_NOT_FOUND: "This attachment is no longer available.",
    MESSAGE_MEDIA_UPLOAD_DENIED: "Upload could not be saved. Check access or remove unused attachments and try again.",
  };
  if (errors[code]) return json({ ok: false, code, error: errors[code] }, code === "MESSAGE_ACCESS_REQUIRED" ? 403 : 400);
  console.error("trade_message_media_failed", code);
  return json({ ok: false, error: "Media could not be loaded or saved. Please try again." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireInstallerTeamAccess(request), query = new URL(request.url).searchParams;
    const record = await readMessageMedia(getD1(), actor, { id: query.get("id") || undefined, avatarMemberId: query.get("avatarMemberId") || undefined, revision: query.get("revision") || undefined });
    if (!record) return json({ ok: false, error: "Media not found." }, 404);
    const object = await getCustomerProjectEvidenceBucket().get(record.object_key);
    if (!object) return json({ ok: false, error: "Media not found." }, 404);
    const stillAllowed = await readMessageMedia(getD1(), actor, { id: query.get("id") || undefined, avatarMemberId: query.get("avatarMemberId") || undefined, revision: query.get("revision") || undefined });
    if (!stillAllowed || stillAllowed.id !== record.id) return json({ ok: false, error: "Media not found." }, 404);
    return new Response(object.body, { headers: { "Content-Type": record.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireInstallerTeamAccess(request);
    // Bound the actual multipart request, including requests without Content-Length.
    if (Number(request.headers.get("content-length")) > 5 * 1024 * 1024 + 16384) return json({ ok: false, error: "Upload is too large." }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ ok: false, error: "Choose a file." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 5 * 1024 * 1024 + 16384) { await reader.cancel(); return json({ ok: false, error: "Upload is too large." }, 413); } chunks.push(next.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
    catch { return json({ ok: false, error: "Upload could not be read." }, 400); }
    const file = form.get("file"), purpose = form.get("purpose");
    if (!(file instanceof File) || (purpose !== "message" && purpose !== "avatar")) return json({ ok: false, error: "Choose a photo or voice note." }, 400);
    const attachment = await uploadMessageMedia(getD1(), getCustomerProjectEvidenceBucket(), actor,
      { purpose, threadId: String(form.get("threadId") || ""), memberId: String(form.get("memberId") || ""), bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
    return json({ ok: true, attachment }, 201);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireInstallerTeamAccess(request);
    await deleteMessageMedia(getD1(), getCustomerProjectEvidenceBucket(), actor, new URL(request.url).searchParams.get("id") || "");
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
