import { getD1 } from "../../../../../db";
import { createAdminNotification } from "@/lib/admin-notifications";
import {
  createEnergyAssistantLead,
  EnergyAssistantLeadError,
} from "@/lib/energy-assistant-lead-server";
import { CUSTOMER_OPPORTUNITY_DISPATCH_HEADER } from "@/lib/customer-opportunity-dispatch-server";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";

export const runtime = "edge";

const MAX_BODY_BYTES = 24_576;
const leadRateLimiterOptions = { env: process.env, getDatabase: getD1 };
const leadRateLimiter = createSharedLeadRateLimiter(leadRateLimiterOptions);

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function requestFingerprint(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

async function bodyFrom(request: Request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new EnergyAssistantLeadError(415, "JSON_REQUIRED", "Send this service request as JSON.");
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new EnergyAssistantLeadError(413, "BODY_TOO_LARGE", "This service request is too large.");
  }
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) {
    throw new EnergyAssistantLeadError(413, "BODY_TOO_LARGE", "This service request is too large.");
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new EnergyAssistantLeadError(400, "INVALID_JSON", "Send a valid service request.");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    const raw = await bodyFrom(request);
    const rateLimit = await leadRateLimiter.check(`energy-assistant-lead:${requestFingerprint(request)}`);
    if (rateLimit.unavailable) {
      return json({ ok: false, error: "Service requests are temporarily unavailable. Please call 1300 241 149." }, 503);
    }
    if (!rateLimit.allowed) {
      return json(
        { ok: false, error: "Too many service requests were sent. Try again later." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds || 3600) },
      );
    }

    const result = await createEnergyAssistantLead(raw, { database: getD1() });
    if (result.tradeSharing !== "shared") {
      await createAdminNotification({
        eventKey: `energy-assistant-lead:${result.leadId}`,
        eventType: "customer.energy_assistant_service_requested",
        category: "customer",
        priority: "high",
        title: "Energy Guide follow-up requested",
        summary: result.tradeSharing === "pending_information"
          ? "A visitor separately consented to trade sharing, but the brief still needs information. No trade opportunity or trade visibility was created."
          : "A visitor explicitly requested AEA follow-up. Their information request was not gated and no trade sharing was requested.",
        entityType: "energy_assistant_lead",
        entityId: result.leadId,
        actorType: "system",
        requiresAction: true,
        metadata: {
          status: result.status,
          opportunityId: result.opportunityId,
          tradeSharing: result.tradeSharing,
        },
      });
    }
    return json({
      ok: true,
      leadId: result.leadId,
      status: result.status,
      opportunityId: result.opportunityId,
      tradeSharing: result.tradeSharing,
    }, result.created ? 201 : 200, result.dispatchJobId
      ? { [CUSTOMER_OPPORTUNITY_DISPATCH_HEADER]: result.dispatchJobId }
      : {});
  } catch (error) {
    if (error instanceof EnergyAssistantLeadError) {
      return json({ ok: false, error: error.message, code: error.code }, error.status);
    }
    console.error("Energy assistant lead request failed", error);
    return json({ ok: false, error: "AEA could not receive this request. Please try again or call 1300 241 149." }, 500);
  }
}
