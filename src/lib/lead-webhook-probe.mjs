import { randomUUID, timingSafeEqual } from "node:crypto";
import { createSignedLeadWebhookEnvelope } from "./lead-route-handler.mjs";

const PROBE_EVENT = "webhook.delivery_probe";
const TOKEN_MIN_LENGTH = 32;
export const LEAD_PROCESSOR_TIMEOUT_MS = 20_000;

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
  fetchImpl = fetch,
  now = () => new Date(),
  createId = randomUUID,
  onFailure = async () => {},
  onRecovery = async () => {},
  timeoutMs = LEAD_PROCESSOR_TIMEOUT_MS,
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

    const webhook = env.AEA_LEAD_WEBHOOK_URL;
    if (!webhook) {
      await onFailure({ kind: "unconfigured", probeId: "" });
      return json(
        { ok: false, error: "Lead delivery is not configured." },
        503,
      );
    }

    const probeId = createId();
    const sentAt = now();
    const probe = {
      schemaVersion: "1",
      eventType: PROBE_EVENT,
      test: true,
      probeId,
      sentAt: sentAt.toISOString(),
      source: "aea-energy",
    };
    let signedProbe;
    try {
      signedProbe = createSignedLeadWebhookEnvelope(
        probe,
        env.AEA_LEAD_WEBHOOK_SIGNING_SECRET,
        { now: () => sentAt },
      );
    } catch {
      await onFailure({ kind: "unconfigured", probeId });
      return json(
        {
          ok: false,
          error: "Lead webhook signing is not configured.",
          probeId,
        },
        503,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-AEA-Event-Type": PROBE_EVENT,
          "X-AEA-Probe-Id": probeId,
        },
        body: JSON.stringify(signedProbe),
        cache: "no-store",
        signal: controller.signal,
      });
      const acknowledgement = await response.text();
      if (!response.ok || acknowledgement.trim() !== "ok") {
        throw new Error(
          `Lead processor did not acknowledge the signed probe (${response.status})`,
        );
      }
      await onRecovery({ probeId });
      return json({ ok: true, probeId });
    } catch {
      await onFailure({ kind: "delivery_failed", probeId });
      return json(
        {
          ok: false,
          error: "The lead processor did not acknowledge the probe.",
          probeId,
        },
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}
