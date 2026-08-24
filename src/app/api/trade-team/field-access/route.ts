import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { abortMemberDeviceUploads } from "@/lib/trade-mobile-device-revocation";
import {
  issueFieldSetupPin,
  revokeMemberFieldAccess,
} from "@/lib/trade-field-session-server";
import { canManageTeam, requireInstallerTeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, code, error: "Sign in to continue." }, 401);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, code, error: "Team member not found." }, 404);
  if (code === "MEMBER_INACTIVE") return adminJson({ ok: false, code, error: "Reactivate this team member before creating app access." }, 409);
  if (code === "FIELD_NAME_REQUIRED") return adminJson({ ok: false, code, error: "Add the team member's name before creating app access." }, 409);
  if (code === "TEAM_MANAGEMENT_REQUIRED") return adminJson({ ok: false, code, error: "Your account cannot manage field app access." }, 403);
  return adminJson({ ok: false, error: "Field app access could not be updated." }, 500);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!canManageTeam(access)) throw new Error("TEAM_MANAGEMENT_REQUIRED");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const memberId = cleanAdminText(body.memberId, 180);
    if (!memberId) return adminJson({ ok: false, error: "Choose a team member." }, 400);
    if (action === "issue_pin") {
      const setup = await issueFieldSetupPin({
        ownerUid: access.ownerUid,
        actorUid: access.actorUid,
        teamMemberId: memberId,
      });
      return adminJson({ ok: true, setup }, 201);
    }
    if (action === "revoke") {
      await revokeMemberFieldAccess(access.ownerUid, memberId, access.actorUid);
      await abortMemberDeviceUploads(access.ownerUid, memberId);
      return adminJson({ ok: true, revoked: true });
    }
    return adminJson({ ok: false, error: "Choose a supported field access action." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
