import { getD1 } from "../../../../../db";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import { readBoundedRequestText } from "@/lib/bounded-request-body.mjs";
import { normalizeTLinkPasswordResetEmail, sendTLinkPasswordResetEmail } from "@/lib/tlink-password-reset-server";

export const runtime = "edge";

const MAX_BODY_BYTES = 2048;
const rateLimitOptions = { env: process.env, getDatabase: getD1 };
const ipLimiter = createSharedLeadRateLimiter({ ...rateLimitOptions, limit: 10 });
const emailLimiter = createSharedLeadRateLimiter({ ...rateLimitOptions, limit: 3 });
const unavailable = "Password reset is temporarily unavailable. Please try again later.";

function json(body: { ok: true } | { error: string }, status: number, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...headers,
  } });
}

function limited(result: { allowed: boolean; unavailable?: boolean; retryAfterSeconds?: number }): Response | null {
  if (result.unavailable) return json({ error: unavailable }, 503);
  return result.allowed ? null : json({ error: "Too many password reset requests. Please try again later." }, 429,
    { "Retry-After": String(result.retryAfterSeconds || 3600) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Request origin was not accepted." }, 403);
  try {
    // Cloudflare sets this at ingress. Forwarded headers are client-controlled and must not bypass limits.
    const client = request.headers.get("cf-connecting-ip") || "unknown";
    const ipResponse = limited(await ipLimiter.check(`tlink-password-reset:ip:${client}`));
    if (ipResponse) return ipResponse;
    if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Send a valid password reset request." }, 400);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readBoundedRequestText(request, MAX_BODY_BYTES));
    } catch {
      return json({ error: "Send a valid password reset request." }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("email" in payload)) {
      return json({ error: "Enter a valid email address." }, 400);
    }
    const email = normalizeTLinkPasswordResetEmail(payload.email);
    if (!email) return json({ error: "Enter a valid email address." }, 400);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    const emailHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const emailResponse = limited(await emailLimiter.check(`tlink-password-reset:email:${emailHash}`));
    if (emailResponse) return emailResponse;
    await sendTLinkPasswordResetEmail({ email, continuePath: "continuePath" in payload ? payload.continuePath : undefined });
    return json({ ok: true }, 202);
  } catch {
    return json({ error: unavailable }, 503);
  }
}
