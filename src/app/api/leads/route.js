import { validateLeadPayload } from "@/lib/lead-validation.mjs";
import { createLeadEnvelope } from "@/lib/lead-envelope.mjs";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import { createOperationalRecorder } from "@/lib/operational-events.mjs";
import { getD1 } from "../../../../db";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const leadRateLimiter = createSharedLeadRateLimiter({ getDatabase: getD1 });

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function clientKey(request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return cloudflareIp || netlifyIp || forwarded || request.headers.get("x-real-ip") || "local";
}

function safeMagicLink(value, requestUrl) {
  if (!value) return "";
  try {
    const link = new URL(value);
    const request = new URL(requestUrl);
    const allowedPaths = new Set(["/compare", "/compare/electricity-next"]);
    return link.origin === request.origin && allowedPaths.has(link.pathname) ? link.toString() : "";
  } catch {
    return "";
  }
}

export async function POST(request) {
  const operations = createOperationalRecorder({ event: "api.leads" });
  const respond = (body, status, outcome, metrics = {}, extraHeaders = {}) => {
    operations.record(outcome, status, metrics);
    return json(body, status, { "X-Request-Id": operations.requestId, ...extraHeaders });
  };
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (origin && origin !== requestOrigin) return respond({ ok: false, error: "Request origin was not accepted." }, 403, "origin_rejected");

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return respond({ ok: false, error: "JSON is required." }, 415, "content_type_rejected");

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return respond({ ok: false, error: "Request is too large." }, 413, "body_too_large");

  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return respond({ ok: false, error: "Request is too large." }, 413, "body_too_large");
    raw = JSON.parse(text);
  } catch {
    return respond({ ok: false, error: "Invalid JSON." }, 400, "invalid_json");
  }

  if (raw?.submissionType !== "comparison") {
    return respond(
      { ok: false, error: "Upgrade projects must be created inside a free private customer account." },
      400,
      "protected_project_required",
    );
  }

  const result = validateLeadPayload(raw);
  if (!result.ok) return respond({ ok: false, error: result.error }, 400, "validation_rejected");

  const payload = createLeadEnvelope(result.value);
  const metrics = { submissionType: payload.submissionType };
  const startedTooQuickly = payload.clientStartedAt && Date.now() - payload.clientStartedAt < 1200;
  if (payload.website || startedTooQuickly) return respond({ ok: true, filtered: true }, 200, "bot_filtered", metrics);

  const webhook = process.env.AEA_LEAD_WEBHOOK_URL;
  if (!webhook) return respond({ ok: false, error: "Enquiries are temporarily unavailable. Please call 1300 241 149." }, 503, "webhook_unconfigured", metrics);

  const rateLimit = await leadRateLimiter.check(clientKey(request));
  if (rateLimit.unavailable) return respond({ ok: false, error: "Enquiries are temporarily unavailable. Please call 1300 241 149." }, 503, "rate_limit_unavailable", metrics);
  if (!rateLimit.allowed) return respond(
    { ok: false, error: "Too many requests. Please try again later." },
    429,
    "rate_limited",
    metrics,
    { "Retry-After": String(rateLimit.retryAfterSeconds || 3600) },
  );

  payload.magicLink = safeMagicLink(payload.magicLink, request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const acknowledgement = await response.text();
    if (!response.ok || acknowledgement.trim() !== "ok") throw new Error("Lead processor did not acknowledge delivery.");
    return respond({ ok: true, reference: payload.reference }, 200, "delivered", metrics);
  } catch (error) {
    return respond(
      { ok: false, error: "Your request could not be delivered. Please try again or call 1300 241 149." },
      502,
      "downstream_failure",
      { ...metrics, errorType: error instanceof Error ? error.name : "UnknownError" },
    );
  } finally {
    clearTimeout(timeout);
  }
}
