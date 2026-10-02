import { getD1 } from "../../../../../db";
import { adminError, adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError, requireComplianceAccess } from "@/lib/compliance-access-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "@/lib/trade-compliance-intent";
import { CreditexNotificationError } from "@/lib/creditex-notifications";
import { listCreditexNotifications, updateCreditexNotifications } from "@/lib/creditex-notification-server";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof CreditexNotificationError || error instanceof ComplianceAccessError || error instanceof BoundedJsonRequestError) {
    return adminJson({ ok: false, error: error.message, ...(error instanceof ComplianceAccessError ? { code: error.code } : {}) }, error.status);
  }
  return adminError(error);
}
async function actorFor(request: Request) {
  if (!sameOrigin(request)) throw new CreditexNotificationError("Request origin was not accepted.", 403);
  const access = await requireComplianceAccess(request, { claimPendingInvitation: false });
  if (access.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) throw new CreditexNotificationError("Creditex access is required.", 403);
  return { organisationId: access.organisationId, memberId: access.membershipId, uid: access.uid };
}
export async function GET(request: Request) {
  try { return adminJson({ ok: true, ...await listCreditexNotifications(getD1(), await actorFor(request), new URL(request.url).searchParams) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await actorFor(request); const input = await readBoundedJsonRequest(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CreditexNotificationError("Check the notification request.");
    await updateCreditexNotifications(getD1(), actor, "action" in input ? input.action : undefined, "ids" in input ? input.ids : undefined);
    return adminJson({ ok: true });
  } catch (error) { return failure(error); }
}
