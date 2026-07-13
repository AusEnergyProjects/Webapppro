const CHECK_TIMEOUT_MS = 12_000;
const REPEAT_ALERT_MS = 6 * 60 * 60 * 1000;
const STATE_KEY = "api-health/v1";

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkElectricityPlans({ fetchImpl, siteUrl, monitorId, now }) {
  const startedAt = now();
  try {
    const url = new URL("/api/electricity-plans", siteUrl);
    url.searchParams.set("postcode", "3000");
    url.searchParams.set("customerType", "RESIDENTIAL");
    url.searchParams.set("monitor", monitorId);
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    const planCount = Array.isArray(body?.plans) ? body.plans.length : 0;
    const listSourcesSucceeded = Number(body?.source?.listSourcesSucceeded) || 0;
    const detailPlansSucceeded = Number(body?.source?.detailPlansSucceeded) || 0;
    const plansWithLastUpdated = Number(body?.source?.plansWithLastUpdated) || 0;
    const detailApiVersion = String(body?.source?.detailApiVersion || "");
    const ok = response.ok
      && planCount > 0
      && listSourcesSucceeded > 0
      && detailPlansSucceeded > 0
      && plansWithLastUpdated > 0
      && detailApiVersion === "3";
    const requestId = response.headers.get("x-request-id")?.slice(0, 100);
    return {
      name: "electricity_plans",
      ok,
      status: response.status,
      durationMs: now() - startedAt,
      planCount,
      listSourcesSucceeded,
      detailPlansSucceeded,
      plansWithLastUpdated,
      detailApiVersion,
      partial: Boolean(body?.source?.partial),
      ...(requestId ? { requestId } : {}),
    };
  } catch (error) {
    return {
      name: "electricity_plans",
      ok: false,
      status: 0,
      durationMs: now() - startedAt,
      errorType: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

async function checkLeadDelivery({ fetchImpl, siteUrl, leadProbeToken, now }) {
  const startedAt = now();
  if (!leadProbeToken) {
    return { name: "lead_delivery", ok: false, status: 0, durationMs: 0, errorType: "ProbeTokenMissing" };
  }

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      new URL("/api/internal/lead-webhook-probe", siteUrl),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${leadProbeToken}`, Accept: "application/json" },
        cache: "no-store",
      },
    );
    const body = await response.json().catch(() => null);
    const probeId = typeof body?.probeId === "string" ? body.probeId.slice(0, 100) : "";
    return {
      name: "lead_delivery",
      ok: response.ok && body?.ok === true,
      status: response.status,
      durationMs: now() - startedAt,
      ...(probeId ? { probeId } : {}),
    };
  } catch (error) {
    return {
      name: "lead_delivery",
      ok: false,
      status: 0,
      durationMs: now() - startedAt,
      errorType: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

function alertDue(previous, status, currentTime) {
  if (!previous) return status === "unhealthy";
  if (previous.status !== status) return true;
  return status === "unhealthy"
    && (!Number.isFinite(previous.lastAlertAt) || currentTime - previous.lastAlertAt >= REPEAT_ALERT_MS);
}

async function sendAlert({ alertWebhookUrl, checks, fetchImpl, monitorId, siteUrl, status, now }) {
  if (!alertWebhookUrl) return { attempted: false, sent: false, reason: "alert_webhook_missing" };
  try {
    const failed = checks.filter((check) => !check.ok).map((check) => check.name);
    const text = status === "healthy"
      ? "AEA Energy API monitoring recovered."
      : `AEA Energy API monitoring failed: ${failed.join(", ")}.`;
    const response = await fetchWithTimeout(fetchImpl, alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "1",
        eventType: status === "healthy" ? "ops.health_recovered" : "ops.health_alert",
        text,
        status,
        monitorId,
        occurredAt: new Date(now).toISOString(),
        site: new URL(siteUrl).origin,
        checks,
      }),
      cache: "no-store",
    });
    return { attempted: true, sent: response.ok, status: response.status };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      reason: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

/**
 * @param {{
 *   alertWebhookUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   leadProbeToken?: string,
 *   logger?: Pick<Console, "info" | "error">,
 *   now?: () => number,
 *   siteUrl: string,
 *   stateStore: {
 *     get(key: string, options: { type: "json" }): Promise<any>,
 *     setJSON(key: string, value: unknown): Promise<unknown>
 *   }
 * }} options
 */
export async function runApiHealthMonitor({
  alertWebhookUrl,
  fetchImpl = fetch,
  leadProbeToken,
  logger = console,
  now = Date.now,
  siteUrl,
  stateStore,
}) {
  const currentTime = now();
  const monitorId = `api-health-${currentTime}`;
  const checks = await Promise.all([
    checkElectricityPlans({ fetchImpl, siteUrl, monitorId, now }),
    checkLeadDelivery({ fetchImpl, siteUrl, leadProbeToken, now }),
  ]);
  const status = checks.every((check) => check.ok) ? "healthy" : "unhealthy";

  let previous = null;
  try {
    previous = await stateStore.get(STATE_KEY, { type: "json" });
  } catch {
    logger.error(JSON.stringify({ schemaVersion: "1", event: "monitor.state", outcome: "read_failed", monitorId }));
  }

  let alert = { attempted: false, sent: false, reason: "not_due" };
  const notificationDue = alertDue(previous, status, currentTime);
  if (notificationDue) {
    alert = await sendAlert({ alertWebhookUrl, checks, fetchImpl, monitorId, siteUrl, status, now: currentTime });
  }

  try {
    await stateStore.setJSON(STATE_KEY, {
      status: notificationDue && !alert.sent ? previous?.status ?? "notification_pending" : status,
      checkedAt: currentTime,
      lastAlertAt: alert.sent ? currentTime : previous?.lastAlertAt ?? null,
    });
  } catch {
    logger.error(JSON.stringify({ schemaVersion: "1", event: "monitor.state", outcome: "write_failed", monitorId }));
  }

  const result = { schemaVersion: "1", event: "monitor.api_health", monitorId, status, checks, alert };
  logger[status === "healthy" ? "info" : "error"](JSON.stringify(result));
  return result;
}
