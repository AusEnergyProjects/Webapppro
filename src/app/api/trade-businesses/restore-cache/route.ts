import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { getD1 } from "../../../../../db";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { manualFieldJobRow, requireManualFieldMember } from "@/lib/creditex-manual-field-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { assignedJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

const MAXIMUM_JOBS = 500;
const MAXIMUM_REQUEST_BYTES = 80 * 1024;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function unconfirmed() {
  return adminJson({ ok: false, code: "CACHE_OWNERSHIP_UNCONFIRMED",
    error: "Some saved work could not be matched to this business and your current access. Your saved work has been kept. Ask your business administrator to check its assignment." }, 403);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, code: "ORIGIN_REJECTED", error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireFirebaseIdentity(request);
    if (!identity.emailVerified) return adminJson({ ok: false, code: "EMAIL_VERIFICATION_REQUIRED",
      error: "Confirm your email address before restoring saved work." }, 403);
    const body = await readBoundedJsonRequest(request, MAXIMUM_REQUEST_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !("ownerUid" in body) || typeof body.ownerUid !== "string"
      || !(identifier.test(body.ownerUid) || body.ownerUid === `compliance:${identity.uid}`)
      || !("workOrderIds" in body) || !Array.isArray(body.workOrderIds)
      || body.workOrderIds.some(id => typeof id !== "string" || !identifier.test(id))) {
      return adminJson({ ok: false, code: "CACHE_PROOF_INVALID", error: "Choose a business and provide the saved job references." }, 400);
    }
    if (body.workOrderIds.length > MAXIMUM_JOBS) return adminJson({ ok: false, code: "CACHE_PROOF_LIMIT",
      error: "This device has more than 500 saved job references. Keep its saved work and contact support to restore it." }, 400);

    if (body.ownerUid === `compliance:${identity.uid}`) {
      // The manual lane retains its existing organisation and assigned-tester
      // boundary. A synthetic cache key cannot grant access to a trade business.
      const headers = new Headers(request.headers);
      headers.delete("X-TLink-Business");
      const database = getD1();
      const member = await requireManualFieldMember(new Request(request.url, { headers }), database);
      if (member.uid !== identity.uid) return unconfirmed();
      for (const workOrderId of new Set<string>(body.workOrderIds)) {
        await manualFieldJobRow(database, member, workOrderId);
      }
      return adminJson({ ok: true, ownerUid: body.ownerUid, memberId: identity.uid });
    }

    // The body proposes a destination, never authority. The normal access resolver
    // proves current membership, employer approval and MFA for this exact business.
    const headers = new Headers(request.headers);
    headers.set("X-TLink-Business", body.ownerUid);
    const access = await requireInstallerTeamAccess(new Request(request.url, { headers }));
    if (access.ownerUid !== body.ownerUid || access.actorUid !== identity.uid || !access.memberId) return unconfirmed();
    if (!access.canViewFieldEvidence) return adminJson({ ok: false, code: "FIELD_EVIDENCE_VIEW_REQUIRED",
      error: "Your team access does not allow offline field records. Your saved work has been kept." }, 403);
    for (const workOrderId of new Set<string>(body.workOrderIds)) {
      // This is the same owner/assignment boundary used by field sync. It can prove
      // protected jobs without returning their customer data or changing any job.
      await assignedJob(access, workOrderId);
    }
    return adminJson({ ok: true, ownerUid: access.ownerUid, memberId: access.memberId });
  } catch (error) {
    const accessFailure = mfaErrorResponse(error);
    if (accessFailure) return accessFailure;
    if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code,
      error: error.code === "REQUEST_TOO_LARGE" ? "The saved-work request is too large. Your saved work has been kept." : "Send a valid saved-work request." }, error.status);
    const code = error instanceof Error && "code" in error ? error.code : error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, code, error: "Sign in to restore saved work." }, 401);
    if (["JOB_NOT_FOUND", "JOB_NOT_ASSIGNED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED",
      "MANUAL_FIELD_JOB_NOT_FOUND", "COMPLIANCE_ACCESS_REQUIRED", "COMPLIANCE_IDENTITY_MISMATCH", "COMPLIANCE_ORGANISATION_INACTIVE",
      "COMPLIANCE_MEMBERSHIP_INACTIVE", "COMPLIANCE_ROLE_REQUIRED"].includes(String(code))) return unconfirmed();
    return adminJson({ ok: false, code: "CACHE_PROOF_UNAVAILABLE",
      error: "Saved work could not be checked right now. It has been kept on this device. Please try again." }, 503);
  }
}
