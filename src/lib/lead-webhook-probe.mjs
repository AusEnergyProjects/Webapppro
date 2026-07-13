import { randomUUID, timingSafeEqual } from "node:crypto";

const PROBE_EVENT = "webhook.delivery_probe";
const TOKEN_MIN_LENGTH = 32;
const TIMEOUT_MS = 10_000;

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function tokenMatches(authorization, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < TOKEN_MIN_LENGTH) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createLeadWebhookProbeHandler({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
  createId = randomUUID,
} = {}) {
  return async function postLeadWebhookProbe(request) {
    const expectedToken = env.AEA_LEAD_WEBHOOK_TEST_TOKEN;
    if (typeof expectedToken !== "string" || expectedToken.length < TOKEN_MIN_LENGTH) {
      return json({ ok: false, error: "Webhook probes are not configured." }, 503);
    }

    if (!tokenMatches(request.headers.get("authorization"), expectedToken)) {
      return json(
        { ok: false, error: "Authentication is required." },
        401,
        { "WWW-Authenticate": "Bearer" },
      );
    }

    const webhook = env.AEA_LEAD_WEBHOOK_URL;
    if (!webhook) return json({ ok: false, error: "Lead delivery is not configured." }, 503);

    const probeId = createId();
    const probe = {
      schemaVersion: "1",
      eventType: PROBE_EVENT,
      test: true,
      probeId,
      sentAt: now().toISOString(),
      source: "aea-energy",
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetchImpl(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-AEA-Event-Type": PROBE_EVENT,
          "X-AEA-Probe-Id": probeId,
        },
        body: JSON.stringify(probe),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Lead processor returned ${response.status}`);
      return json({ ok: true, probeId });
    } catch {
      return json({ ok: false, error: "The lead processor did not acknowledge the probe.", probeId }, 502);
    } finally {
      clearTimeout(timeout);
    }
  };
}
