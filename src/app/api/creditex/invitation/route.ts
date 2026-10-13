import { getD1 } from "../../../../../db";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import { loadCreditexInvitationSetup } from "@/lib/creditex-invitation-setup-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const invitationLimiterOptions = { env: process.env, getDatabase: getD1, limit: 20, windowMs: 60_000 };
const invitationLimiter = createSharedLeadRateLimiter(invitationLimiterOptions);
const unavailable = {
  ok: false,
  code: "CREDITEX_INVITATION_UNAVAILABLE",
  error: "This invitation is no longer available. Ask your administrator for a new invitation.",
};
const temporarilyUnavailable = {
  ok: false,
  code: "CREDITEX_INVITATION_SETUP_UNAVAILABLE",
  error: "We could not check your invitation. Please try again shortly.",
};

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    ...headers,
  } });
}

/** Public setup prefill only. Verified identity and existing membership/MFA rules still govern the workspace. */
export async function GET(request: Request) {
  try {
    // Only the trusted ingress IP can partition a shared abuse limit.
    const client = request.headers.get("cf-connecting-ip") || "unknown";
    const limit = await invitationLimiter.check(`creditex-invitation-setup:ip:${client}`);
    if (limit.unavailable) return json(temporarilyUnavailable, 503, { "Retry-After": "60" });
    if (!limit.allowed) return json({ ok: false, code: "CREDITEX_INVITATION_RATE_LIMITED",
      error: "Too many invitation checks. Wait a moment and try again." }, 429,
    { "Retry-After": String(limit.retryAfterSeconds || 60) });
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json(unavailable, 404);
    const references = url.searchParams.getAll("invite");
    if (references.length !== 1) return json(unavailable, 404);
    const invitation = await loadCreditexInvitationSetup(getD1(), references[0]);
    return invitation ? json({ ok: true, invitation }) : json(unavailable, 404);
  } catch {
    return json(temporarilyUnavailable, 503, { "Retry-After": "60" });
  }
}
