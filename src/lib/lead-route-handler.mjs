const MAX_BODY_BYTES = 64 * 1024;

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function clientKey(request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return cloudflareIp || forwarded || request.headers.get("x-real-ip") || "local";
}

function safeMagicLink(value, requestUrl) {
  if (!value) return "";
  try {
    const link = new URL(value);
    const request = new URL(requestUrl);
    const allowedPaths = new Set(["/compare", "/compare/electricity-next"]);
    return link.origin === request.origin && allowedPaths.has(link.pathname)
      ? link.toString()
      : "";
  } catch {
    return "";
  }
}

export function createLeadPostHandler({
  validateLeadPayload,
  createLeadEnvelope,
  createOperationalRecorder,
  leadRateLimiter,
  recordLeadIncident,
  resolveSystemAdminNotifications,
  isPublicPlanEnquiry,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}) {
  return async function postLead(request) {
    const operations = createOperationalRecorder({ event: "api.leads" });
    const respond = (body, status, outcome, metrics = {}, extraHeaders = {}) => {
      operations.record(outcome, status, metrics);
      return json(body, status, { "X-Request-Id": operations.requestId, ...extraHeaders });
    };
    const origin = request.headers.get("origin");
    const requestOrigin = new URL(request.url).origin;
    if (origin && origin !== requestOrigin) {
      return respond({ ok: false, error: "Request origin was not accepted." }, 403, "origin_rejected");
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return respond({ ok: false, error: "JSON is required." }, 415, "content_type_rejected");
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return respond({ ok: false, error: "Request is too large." }, 413, "body_too_large");
    }

    let raw;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return respond({ ok: false, error: "Request is too large." }, 413, "body_too_large");
      }
      raw = JSON.parse(text);
    } catch {
      return respond({ ok: false, error: "Invalid JSON." }, 400, "invalid_json");
    }

    const publicPlanEnquiry = raw?.submissionType === "upgrade"
      && isPublicPlanEnquiry(raw?.enquiry);
    if (raw?.submissionType !== "comparison" && !publicPlanEnquiry) {
      return respond(
        { ok: false, error: "This type of upgrade project must be created inside a free private customer account." },
        400,
        "protected_project_required",
      );
    }

    const result = validateLeadPayload(raw);
    if (!result.ok) {
      return respond({ ok: false, error: result.error }, 400, "validation_rejected");
    }

    const payload = createLeadEnvelope(result.value);
    const metrics = { submissionType: payload.submissionType };
    if (payload.website) {
      return respond({ ok: true, filtered: true }, 200, "bot_filtered", metrics);
    }

    const webhook = env.AEA_LEAD_WEBHOOK_URL;
    if (!webhook) {
      await recordLeadIncident(
        "platform.lead_delivery_unconfigured",
        "Public enquiry delivery is not configured",
        "The public enquiry service cannot deliver requests to the private processor. No customer details are included in this alert.",
      );
      return respond(
        { ok: false, error: "Enquiries are temporarily unavailable. Please call 1300 241 149." },
        503,
        "webhook_unconfigured",
        metrics,
      );
    }

    const rateLimit = await leadRateLimiter.check(clientKey(request));
    if (rateLimit.unavailable) {
      await recordLeadIncident(
        "platform.lead_rate_limit_unavailable",
        "Public enquiry protection is unavailable",
        "The durable enquiry rate limiter could not be reached, so public submissions were safely stopped.",
        "high",
      );
      return respond(
        { ok: false, error: "Enquiries are temporarily unavailable. Please call 1300 241 149." },
        503,
        "rate_limit_unavailable",
        metrics,
      );
    }
    if (!rateLimit.allowed) {
      return respond(
        { ok: false, error: "Too many requests. Please try again later." },
        429,
        "rate_limited",
        metrics,
        { "Retry-After": String(rateLimit.retryAfterSeconds || 3600) },
      );
    }

    payload.magicLink = safeMagicLink(payload.magicLink, request.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(webhook, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
      const acknowledgement = await response.text();
      if (!response.ok || acknowledgement.trim() !== "ok") {
        throw new Error("Lead processor did not acknowledge delivery.");
      }
      await resolveSystemAdminNotifications({
        eventTypes: [
          "platform.lead_delivery_unconfigured",
          "platform.lead_delivery_failed",
          "platform.lead_rate_limit_unavailable",
        ],
        entityType: "platform_service",
        entityId: "comparison_lead_delivery",
        note: "A public enquiry was delivered successfully and the service recovered.",
      }).catch(() => null);
      return respond({ ok: true, reference: payload.reference }, 200, "delivered", metrics);
    } catch (error) {
      await recordLeadIncident(
        "platform.lead_delivery_failed",
        "Public enquiry delivery failed",
        "The private enquiry processor did not acknowledge a valid public request. The customer was told to retry or call, and no customer details are included in this alert.",
      );
      return respond(
        { ok: false, error: "Your request could not be delivered. Please try again or call 1300 241 149." },
        502,
        "downstream_failure",
        { ...metrics, errorType: error instanceof Error ? error.name : "UnknownError" },
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}
