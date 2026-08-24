import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { abortMemberDeviceUploads } from "@/lib/trade-mobile-device-revocation";
import {
  issueFieldSetupPin,
  revokeIssuedFieldSetupPin,
  revokeMemberFieldAccess,
} from "@/lib/trade-field-session-server";
import { tradeFieldAccessEmail } from "@/lib/trade-field-access-email";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";
import { canManageTeam, requireInstallerTeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, code, error: "Sign in to continue." }, 401);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, code, error: "Team member not found." }, 404);
  if (code === "MEMBER_INACTIVE") return adminJson({ ok: false, code, error: "Reactivate this team member before creating app access." }, 409);
  if (code === "FIELD_USERNAME_REQUIRED") return adminJson({ ok: false, code, error: "Save a TLink username for this team member before generating a PIN." }, 409);
  if (code === "FIELD_EMAIL_REQUIRED") return adminJson({ ok: false, code, error: "Add and save an email address before generating a PIN. TLink emails the username and PIN to that address." }, 409);
  if (code === "FIELD_ACCESS_NOT_CONFIGURED") return adminJson({ ok: false, code, error: "TLink app access is not configured yet. Contact the platform administrator." }, 503);
  if (code === "FIELD_EMAIL_NOT_CONFIGURED") return adminJson({ ok: false, code, error: "TLink email delivery is not configured. Contact the platform administrator." }, 503);
  if (code === "FIELD_EMAIL_DELIVERY_FAILED") return adminJson({ ok: false, code, error: "The PIN email could not be sent, so the PIN was cancelled. Check the email address and try again." }, 502);
  if (code === "TEAM_MANAGEMENT_REQUIRED") return adminJson({ ok: false, code, error: "Your account cannot manage field app access." }, 403);
  console.error("TLink field app access failed.", { code: code || "UNKNOWN" });
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
      if (!serviceReminderProviderConfiguration().email.configured) throw new Error("FIELD_EMAIL_NOT_CONFIGURED");
      const issued = await issueFieldSetupPin({
        ownerUid: access.ownerUid,
        actorUid: access.actorUid,
        teamMemberId: memberId,
      });
      const appUrl = new URL("/direct-trade/field-app", request.url).toString();
      const email = tradeFieldAccessEmail({
        recipientName: issued.displayName,
        username: issued.username,
        pin: issued.pin,
        expiresAt: issued.expiresAt,
        appUrl,
      });
      try {
        await sendServiceReminderProviderMessage({
          channel: "email",
          recipient: issued.recipientEmail,
          subject: email.subject,
          body: email.body,
          html: email.html,
          idempotencyKey: `tlink-field-setup:${issued.id}`,
          callbackUrl: new URL("/api/service-reminder-provider-events/resend", request.url).toString(),
          messageType: "tlink_field_setup",
        });
      } catch (deliveryError) {
        await revokeIssuedFieldSetupPin(access.ownerUid, memberId, issued.id).catch((rollbackError) => {
          console.error("TLink field PIN rollback failed.", {
            deliveryError: deliveryError instanceof Error ? deliveryError.message : "UNKNOWN",
            rollbackError: rollbackError instanceof Error ? rollbackError.message : "UNKNOWN",
          });
        });
        throw new Error("FIELD_EMAIL_DELIVERY_FAILED");
      }
      return adminJson({ ok: true, setup: {
        displayName: issued.displayName,
        username: issued.username,
        pin: issued.pin,
        expiresAt: issued.expiresAt,
        deliveredTo: issued.recipientEmail,
      } }, 201);
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
