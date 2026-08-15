import { adminJson, sameOrigin } from "@/lib/admin-server";
import { BoundedJsonRequestError } from "@/lib/bounded-json-request";
import {
  CreditexActivityWorkPackServerError,
  type CreditexAssignedWorkPackBytes,
  type CreditexWorkPackTradeScope,
} from "@/lib/creditex-activity-work-pack-server";
import {
  requireInstallerTeamAccess,
  type TeamAccess,
} from "@/lib/trade-team-server";

export function assignedWorkPackOrigin(request: Request) {
  if (sameOrigin(request)) return null;
  return adminJson({
    ok: false,
    code: "ORIGIN_REJECTED",
    error: "Request origin was not accepted.",
  }, 403);
}

export function assignedWorkPackScope(
  access: TeamAccess,
): CreditexWorkPackTradeScope {
  return Object.freeze({
    ownerUid: access.ownerUid,
    actorUid: access.actorUid,
    actorMemberId: access.memberId,
    scope: access.jobScope,
  });
}

export async function assignedWorkPackRequestScope(request: Request) {
  return assignedWorkPackScope(await requireInstallerTeamAccess(request));
}

export function assignedWorkPackError(error: unknown) {
  if (error instanceof CreditexActivityWorkPackServerError) {
    return adminJson({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
  }
  if (error instanceof BoundedJsonRequestError) {
    return adminJson({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
  }
  const code = error instanceof Error ? error.message : "";
  const known = new Map<string, readonly [number, string]>([
    ["AUTH_REQUIRED", [401, "Sign in to continue."]],
    ["EMAIL_VERIFICATION_REQUIRED", [403, "Verify the account email before using field work packs."]],
    ["TEAM_ACCESS_RECORD_REQUIRED", [404, "No active installer team access was found."]],
    ["TEAM_ACCESS_REQUIRED", [403, "Your account does not have installer team access."]],
    ["ACCOUNT_INACTIVE", [403, "This installer account is not active."]],
    ["INSTALLER_ONLY", [403, "Activity work packs are available to installer accounts only."]],
    ["ABN_REVIEW_REQUIRED", [403, "Complete business verification before using activity work packs."]],
  ]);
  const response = known.get(code);
  if (response) {
    return adminJson({ ok: false, code, error: response[1] }, response[0]);
  }
  console.error("Assigned activity work-pack request failed", error);
  return adminJson({
    ok: false,
    code: "WORK_PACK_REQUEST_FAILED",
    error: "The assigned activity work pack could not be loaded or saved.",
  }, 500);
}

function safeFileName(value: string) {
  const fallback = value.replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .slice(0, 180) || "governed-document";
  return {
    fallback,
    encoded: encodeURIComponent(value).replaceAll("'", "%27"),
  };
}

export function assignedWorkPackBytesResponse(
  retained: CreditexAssignedWorkPackBytes,
) {
  const exact = new Uint8Array(retained.bytes.byteLength);
  exact.set(retained.bytes);
  const name = safeFileName(retained.fileName);
  const originalContentType = retained.contentType.split(";", 1)[0]
    .trim().toLowerCase();
  const safeInlineTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  const inline = safeInlineTypes.has(originalContentType);
  return new Response(exact.buffer, {
    status: 200,
    headers: {
      "Content-Type": inline ? retained.contentType : "application/octet-stream",
      "Content-Disposition":
        `${inline ? "inline" : "attachment"}; filename="${name.fallback}"; filename*=UTF-8''${name.encoded}`,
      "Content-Length": String(retained.sizeBytes),
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Creditex-SHA256": retained.sha256,
      "X-Creditex-Size-Bytes": String(retained.sizeBytes),
      "X-Creditex-Custody-Receipt": retained.custodyReceiptId,
      "ETag": `"${retained.sha256}"`,
    },
  });
}
