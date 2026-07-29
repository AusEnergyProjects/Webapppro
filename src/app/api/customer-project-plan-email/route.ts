import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  CUSTOMER_PLAN_EMAIL_SUBJECT,
  createCustomerPlanDocument,
  customerPlanDocumentHtml,
  customerPlanDocumentText,
  normalizeCustomerPlanEmailRequest,
} from "@/lib/customer-plan-document.mjs";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import {
  sendServiceReminderProviderMessage,
  serviceReminderIdempotencyKey,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";

export const runtime = "edge";

const MAX_BODY_BYTES = 4_096;
const planEmailRateLimiterOptions = {
  env: process.env,
  getDatabase: getD1,
};
const planEmailRateLimiter = createSharedLeadRateLimiter(
  planEmailRateLimiterOptions,
);

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function requestBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }

  let identity;
  try {
    identity = await requireFirebaseIdentity(request);
  } catch {
    return json({ ok: false, error: "Sign in to email a saved plan." }, 401);
  }
  if (!identity.emailVerified) {
    return json(
      { ok: false, error: "Verify your account email before emailing a plan." },
      403,
    );
  }

  let raw: unknown;
  try {
    raw = await requestBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return json({ ok: false, error: "The plan email request was too large." }, 413);
    }
    return json({ ok: false, error: "The plan email request was not valid." }, 400);
  }
  const normalized = normalizeCustomerPlanEmailRequest(raw);
  if (!normalized.ok || !normalized.value) {
    return json(
      { ok: false, error: normalized.error || "Enter the plan email details again." },
      400,
    );
  }

  const db = getD1();
  const account = await db.prepare(
    "SELECT account_status FROM customer_accounts WHERE firebase_uid = ?",
  ).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) {
    return json(
      { ok: false, error: "Complete your private household profile first." },
      404,
    );
  }
  if (account.account_status !== "active") {
    return json({ ok: false, error: "This customer account is not active." }, 403);
  }

  const project = await db.prepare(`SELECT
      id, goal, goals, pace, postcode, address_state, property_type,
      household_situation, existing_features, budget_range, property_context,
      advisor_profile, plan_snapshot, completed_plan_items, status, archived_at
    FROM customer_projects
    WHERE id = ? AND firebase_uid = ? AND archived_at = ''
      AND status NOT IN ('withdrawn', 'archived')`)
    .bind(normalized.value.projectId, identity.uid)
    .first<Record<string, unknown>>();
  if (!project) {
    return json(
      { ok: false, error: "This saved plan is not available in your account." },
      404,
    );
  }

  const provider = serviceReminderProviderConfiguration();
  if (!provider.email.configured) {
    return json(
      { ok: false, error: "Plan email delivery is not configured yet." },
      503,
    );
  }

  const rateLimit = await planEmailRateLimiter.check(
    `customer-plan-email:${identity.uid}`,
  );
  if (!rateLimit.allowed) {
    if (rateLimit.unavailable) {
      return json(
        {
          ok: false,
          error: "Plan email delivery is temporarily unavailable. Try again later.",
        },
        503,
      );
    }
    return json(
      {
        ok: false,
        error: "Five plan emails have already been requested in the last hour. Try again later.",
      },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds || 3600) },
    );
  }

  const document = createCustomerPlanDocument(project);
  const idempotencyKey = await serviceReminderIdempotencyKey(
    `customer-plan:${identity.uid}:${normalized.value.projectId}:${normalized.value.recipient}:${normalized.value.requestId}`,
    "email",
    1,
  );
  try {
    await sendServiceReminderProviderMessage({
      channel: "email",
      recipient: normalized.value.recipient,
      subject: CUSTOMER_PLAN_EMAIL_SUBJECT,
      body: customerPlanDocumentText(document),
      html: customerPlanDocumentHtml(document),
      idempotencyKey,
      callbackUrl: `${new URL(request.url).origin}/api/service-reminder-provider-events/resend`,
      messageType: "customer_energy_plan",
    });
  } catch {
    return json(
      {
        ok: false,
        error: "The email provider did not accept this plan. No delivery was confirmed.",
      },
      502,
    );
  }

  return json(
    {
      ok: true,
      status: "accepted",
      message: "Accepted for delivery.",
    },
    202,
  );
}
