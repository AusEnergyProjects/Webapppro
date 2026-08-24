import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import {
  redeemFieldSetupPin,
  revokeCurrentFieldSession,
} from "@/lib/trade-field-session-server";
import {
  appVersionAccepted,
  mobileAppPolicy,
  MOBILE_CLIENT_ID_PATTERN,
  MOBILE_PLATFORMS,
} from "@/lib/trade-mobile-server";

export const runtime = "edge";

function errorResponse(error: unknown) {
  if (error instanceof BoundedJsonRequestError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "FIELD_CREDENTIALS_INVALID") return adminJson({ ok: false, code, error: "The name or PIN is not correct. Check the details sent by your TLink administrator." }, 401);
  if (code === "FIELD_ACCESS_RATE_LIMITED") return adminJson({ ok: false, code, error: "Too many attempts. Wait 15 minutes before trying again." }, 429);
  if (code === "DEVICE_REAUTHORISATION_REQUIRED") return adminJson({ ok: false, code, error: "This phone was previously revoked. Ask the business owner to authorise it again." }, 403);
  if (code === "ACCOUNT_INACTIVE" || code === "INSTALLER_ONLY" || code === "ABN_REVIEW_REQUIRED") {
    return adminJson({ ok: false, code, error: "This installer business cannot currently issue field app access." }, 403);
  }
  return adminJson({ ok: false, error: "Field app sign-in could not be completed." }, 500);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const parsed = await readBoundedJsonRequest(request, 8 * 1024);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const displayName = cleanAdminText(body.displayName, 160);
    const pin = cleanAdminText(body.pin, 12);
    const deviceId = cleanAdminText(body.deviceId, 120);
    const platform = cleanAdminText(body.platform, 20);
    const appVersion = cleanAdminText(body.appVersion, 40);
    const deviceName = cleanAdminText(body.deviceName, 100) || "Field device";
    if (!displayName || !pin) return adminJson({ ok: false, error: "Enter the team member name and six-digit PIN." }, 400);
    if (!MOBILE_CLIENT_ID_PATTERN.test(deviceId) || !MOBILE_PLATFORMS.has(platform)) {
      return adminJson({ ok: false, error: "This field app does not have a valid device identity." }, 400);
    }
    if (!appVersionAccepted(platform, appVersion)) {
      const policy = mobileAppPolicy(platform);
      return adminJson({ ok: false, code: "APP_UPDATE_REQUIRED", error: "Update AEA Field before signing in.",
        minimumVersion: policy.minimumVersion, policy }, 426);
    }
    const session = await redeemFieldSetupPin({
      request,
      displayName,
      pin,
      deviceId,
      platform: platform as "ios" | "android",
      appVersion,
      deviceName,
    });
    return adminJson({ ok: true, ...session, policy: mobileAppPolicy(platform) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  await revokeCurrentFieldSession(request);
  return adminJson({ ok: true, signedOut: true });
}
