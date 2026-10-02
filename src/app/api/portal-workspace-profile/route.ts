import { getD1 } from "../../../../db";
import { adminError, adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { portalProfileInput } from "@/lib/portal-workspace-profile";
import { loadPortalProfile, requirePortalProfileActor, savePortalProfile } from "@/lib/portal-workspace-profile-server";

export const runtime = "edge";
function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof ComplianceAccessError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof Error && error.message === "PORTAL_WORKSPACE_INVALID") return adminJson({ ok: false, error: "Choose a valid workspace." }, 400);
  if (error instanceof Error && error.message === "PORTAL_ACCESS_CHANGED") return adminJson({ ok: false, error: "Your access changed. Sign in again." }, 403);
  return adminError(error);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1(), actor = await requirePortalProfileActor(request, database);
    return adminJson({ ok: true, profile: await loadPortalProfile(database, actor) });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1(), actor = await requirePortalProfileActor(request, database);
    const profile = portalProfileInput(await readBoundedJsonRequest(request, 2048));
    if (!profile) return adminJson({ ok: false, error: "Enter a display name and choose a colour theme and appearance." }, 400);
    return adminJson({ ok: true, profile: await savePortalProfile(database, actor, profile) });
  } catch (error) { return errorResponse(error); }
}
