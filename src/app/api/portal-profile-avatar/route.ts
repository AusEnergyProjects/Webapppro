import { getD1 } from "../../../../db";
import { adminError, adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import { getCustomerProjectEvidenceBucket } from "@/lib/customer-project-evidence-bucket";
import { loadPortalProfile, requirePortalProfileActor } from "@/lib/portal-workspace-profile-server";
import { PortalAvatarError, readPortalAvatar, readPortalAvatarUpload, removePortalAvatar, savePortalAvatar } from "@/lib/portal-profile-avatar-server";

export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof ComplianceAccessError || error instanceof PortalAvatarError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof Error && error.message === "PORTAL_ACCESS_CHANGED") return adminJson({ ok: false, error: "Your access changed. Sign in again." }, 403);
  if (error instanceof Error && error.message === "PORTAL_WORKSPACE_INVALID") return adminJson({ ok: false, error: "Choose a valid workspace." }, 400);
  return adminError(error);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1(), actor = await requirePortalProfileActor(request, database), query = new URL(request.url).searchParams;
    await loadPortalProfile(database, actor);
    const memberId = query.get("memberId") || actor.memberId, revision = query.get("revision") || "";
    const record = await readPortalAvatar(database, actor, memberId, revision);
    if (query.get("metadata") === "1" && memberId === actor.memberId) return adminJson({ ok: true, memberId, revision: record?.avatar_revision || "" });
    if (!record?.avatar_revision) return adminJson({ ok: false, error: "Profile photo not found." }, 404);
    const object = await getCustomerProjectEvidenceBucket().get(record.avatar_object_key);
    const current = await readPortalAvatar(database, actor, memberId, record.avatar_revision);
    if (!object || !current?.avatar_revision) return adminJson({ ok: false, error: "Profile photo not found." }, 404);
    return new Response(object.body, { headers: { "Content-Type": record.avatar_content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1(), actor = await requirePortalProfileActor(request, database);
    return adminJson({ ok: true, ...await savePortalAvatar(database, getCustomerProjectEvidenceBucket(), actor,
      { bytes: await readPortalAvatarUpload(request), contentType: request.headers.get("content-type") || "" }) });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1(), actor = await requirePortalProfileActor(request, database);
    return adminJson({ ok: true, ...await removePortalAvatar(database, getCustomerProjectEvidenceBucket(), actor, new URL(request.url).searchParams.get("revision") || "") });
  } catch (error) { return failure(error); }
}
