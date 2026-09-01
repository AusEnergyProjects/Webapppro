import { createHmac } from "node:crypto";

const MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_SIGNING_SECRET_MIN_LENGTH = 32;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createSignedLeadWebhookEnvelope(
  payload,
  secret,
  { now = () => new Date() } = {},
) {
  if (typeof secret !== "string" || secret.length < WEBHOOK_SIGNING_SECRET_MIN_LENGTH) {
    throw new Error("LEAD_WEBHOOK_SIGNING_UNCONFIGURED");
  }
  const sentAt = now().toISOString();
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${sentAt}.${encodedPayload}`)
    .digest("base64url");
  return {
    schemaVersion: "1",
    eventType: "lead.webhook",
    sentAt,
    payload: encodedPayload,
    signature,
  };
}

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
  isPublicRentalAssessmentRequest = () => false,
  enqueuePublicPlanDelivery,
  createOpportunityFromLead,
  confirmPublicPlanIntakeOpportunity,
  publicPlanDeliveryDispatchHeader = "",
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
    const rentalAssessmentRequest = raw?.submissionType === "upgrade"
      && isPublicRentalAssessmentRequest(raw?.enquiry);
    if (raw?.submissionType !== "comparison" && !publicPlanEnquiry && !rentalAssessmentRequest) {
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

    let payload = createLeadEnvelope(result.value);
    const metrics = { submissionType: payload.submissionType };
    if (payload.website) {
      return respond({ ok: true, filtered: true }, 200, "bot_filtered", metrics);
    }

    const webhook = env.AEA_LEAD_WEBHOOK_URL;
    if (!publicPlanEnquiry && !webhook) {
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
    try {
      if (publicPlanEnquiry) {
        if (typeof enqueuePublicPlanDelivery !== "function") {
          throw new Error("PUBLIC_PLAN_DURABLE_INTAKE_UNCONFIGURED");
        }
        let intake;
        try {
          intake = await enqueuePublicPlanDelivery({
            envelope: payload,
            validatedPayload: result.value,
          });
        } catch (error) {
          if (Number(error?.status) === 409) {
            return respond({
              ok: false,
              error: "This enquiry reference belongs to different details. Start a new enquiry before sending again.",
            }, 409, "submission_identity_conflict", metrics);
          }
          await recordLeadIncident(
            "platform.public_plan_intake_failed",
            "Public plan enquiry was not durably queued",
            "The intake service could not commit the enquiry and both required delivery jobs. No customer details are included in this alert.",
            "urgent",
          );
          return respond({
            ok: false,
            planEmailSent: false,
            planEmailStatus: "not_queued",
            error: "Your enquiry could not be saved. Please try again or call 1300 241 149.",
          }, 502, "public_plan_intake_failed", {
            ...metrics,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
        const intakeId = String(intake?.id || "").trim();
        const customerEmailStatus = String(intake?.status || "pending");
        if (!intakeId) throw new Error("PUBLIC_PLAN_INTAKE_UNAVAILABLE");
        if (
          typeof createOpportunityFromLead !== "function"
          || typeof confirmPublicPlanIntakeOpportunity !== "function"
        ) throw new Error("PUBLIC_PLAN_OPPORTUNITY_INTAKE_UNCONFIGURED");
        try {
          const createdOpportunity = await createOpportunityFromLead(payload);
          const opportunityId = String(createdOpportunity?.id || "").trim();
          if (!opportunityId) throw new Error("PUBLIC_PLAN_OPPORTUNITY_UNAVAILABLE");
          await confirmPublicPlanIntakeOpportunity({
            intakeId,
            opportunityId,
            expectedQuotePreparation: Boolean(result.value?.quotePreparation),
          });
        } catch (error) {
          await recordLeadIncident(
            "platform.lead_marketplace_preparation_failed",
            "Public enquiry matching was not prepared",
            "The durable intake is safe, but its matching and quote preparation records could not be confirmed. No customer details are included in this alert.",
            "high",
          );
          return respond({
            ok: false,
            received: true,
            reference: payload.reference,
            planEmailSent: false,
            planEmailStatus: "queued",
            error: "Your enquiry is safely queued, but matching is not ready. Please retry with the same enquiry.",
          }, 502, "marketplace_preparation_failed", {
            ...metrics,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
        await resolveSystemAdminNotifications({
          eventTypes: [
            "platform.lead_delivery_unconfigured",
            "platform.lead_delivery_failed",
            "platform.lead_marketplace_preparation_failed",
            "platform.customer_plan_email_enqueue_failed",
            "platform.public_plan_intake_failed",
            "platform.lead_rate_limit_unavailable",
          ],
          entityType: "platform_service",
          entityId: "comparison_lead_delivery",
          note: "A public enquiry and its customer email were durably queued.",
        }).catch(() => null);
        const headers = publicPlanDeliveryDispatchHeader
          ? { [publicPlanDeliveryDispatchHeader]: intakeId }
          : {};
        return respond({
          ok: true,
          reference: payload.reference,
          planEmailSent: ["sent", "delivered"].includes(customerEmailStatus),
          planEmailStatus: ["sent", "delivered"].includes(customerEmailStatus)
            ? customerEmailStatus
            : "queued",
        }, 200, "durably_queued", metrics, headers);
      }

      const signedWebhookEnvelope = createSignedLeadWebhookEnvelope(
        payload,
        env.AEA_LEAD_WEBHOOK_SIGNING_SECRET,
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(webhook, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: JSON.stringify(signedWebhookEnvelope),
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const acknowledgement = await response.text();
      if (!response.ok || acknowledgement.trim() !== "ok") {
        throw new Error("Lead processor did not acknowledge delivery.");
      }
      await resolveSystemAdminNotifications({
        eventTypes: [
          "platform.lead_delivery_unconfigured",
          "platform.lead_delivery_failed",
          "platform.lead_marketplace_preparation_failed",
          "platform.lead_rate_limit_unavailable",
        ],
        entityType: "platform_service",
        entityId: "comparison_lead_delivery",
        note: "A public enquiry was delivered successfully and the service recovered.",
      }).catch(() => null);
      return respond({
        ok: true,
        reference: payload.reference,
      }, 200, "delivered", metrics);
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
    }
  };
}
