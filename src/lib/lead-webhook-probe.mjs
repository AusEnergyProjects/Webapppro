import { randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_MIN_LENGTH = 32;
export const LEAD_PROCESSOR_TIMEOUT_MS = 20_000;
export const LEAD_READINESS_TIMEOUT_MS = 2_000;

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function tokenMatches(authorization, expectedToken) {
  if (
    typeof expectedToken !== "string" ||
    expectedToken.length < TOKEN_MIN_LENGTH
  )
    return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer "))
    return false;

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function createLeadWebhookProbeHandler({
  env = process.env,
  createId = randomUUID,
  readReadiness,
  timeoutMs = LEAD_READINESS_TIMEOUT_MS,
} = {}) {
  return async function postLeadWebhookProbe(request) {
    const expectedToken = env.AEA_LEAD_WEBHOOK_TEST_TOKEN;
    if (
      typeof expectedToken !== "string" ||
      expectedToken.length < TOKEN_MIN_LENGTH
    ) {
      return json(
        { ok: false, error: "Webhook probes are not configured." },
        503,
      );
    }

    if (!tokenMatches(request.headers.get("authorization"), expectedToken)) {
      return json({ ok: false, error: "Authentication is required." }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }

    const probeId = createId();
    if (typeof readReadiness !== "function") {
      return json({
        ok: false,
        error: "Durable lead readiness is unavailable.",
        probeId,
      }, 503);
    }
    let timeout;

    try {
      const readiness = await Promise.race([
        Promise.resolve().then(() => readReadiness()),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(Object.assign(new Error("READINESS_TIMEOUT"), { name: "TimeoutError" })),
            timeoutMs,
          );
        }),
      ]);
      const body = {
        ok: readiness?.ok === true,
        probeId,
        mode: "durable_outbox_readiness",
        checks: Array.isArray(readiness?.checks) ? readiness.checks : [],
        schedulerExecutionVerified: readiness?.schedulerExecutionVerified === true,
        providerDeliveryVerified: readiness?.providerDeliveryVerified === true,
      };
      return json(body, body.ok ? 200 : 503);
    } catch {
      return json(
        {
          ok: false,
          error: "Durable lead readiness could not be confirmed.",
          probeId,
          mode: "durable_outbox_readiness",
          checks: [],
          schedulerExecutionVerified: false,
          providerDeliveryVerified: false,
        },
        503,
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}
