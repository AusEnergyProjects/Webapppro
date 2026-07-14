import { getD1 } from "../../db";
import {
  adminNotificationRetryAt,
  buildAdminNotificationDeliveryPayload,
  createGoogleWorkspaceAdminAlertEnvelope,
} from "@/lib/admin-notification-delivery-payload.mjs";

type DeliveryOptions = {
  notificationId?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
};

type DeliveryRow = Record<string, unknown>;

const DELIVERY_TIMEOUT_MS = 6_000;

function clean(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

type DeliveryProvider = "google_workspace" | "custom_webhook" | "not_configured";

type DeliveryConfiguration = {
  configured: boolean;
  url: string;
  secret: string;
  provider: DeliveryProvider;
};

function secureUrl(value: unknown) {
  const url = clean(value, 1000);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function deliveryConfiguration(): DeliveryConfiguration {
  const runtime = process.env as unknown as Record<string, unknown>;
  const customUrl = secureUrl(runtime.AEA_OPS_ALERT_WEBHOOK_URL);
  const customSecret = clean(runtime.AEA_OPS_ALERT_WEBHOOK_SECRET, 1000);
  if (customUrl) return { configured: true, url: customUrl, secret: customSecret, provider: "custom_webhook" };

  const googleUrl = secureUrl(runtime.AEA_LEAD_WEBHOOK_URL);
  const googleSecret = clean(runtime.AEA_LEAD_WEBHOOK_TEST_TOKEN, 1000);
  if (googleUrl && googleSecret.length >= 32) {
    return { configured: true, url: googleUrl, secret: googleSecret, provider: "google_workspace" };
  }
  return { configured: false, url: "", secret: "", provider: "not_configured" };
}

export function adminNotificationDeliveryConfiguration() {
  const config = deliveryConfiguration();
  return { configured: config.configured, channel: "webhook" as const, provider: config.provider };
}

async function deliver(row: DeliveryRow, config: DeliveryConfiguration, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const payload = buildAdminNotificationDeliveryPayload(row);
    const googleWorkspace = config.provider === "google_workspace";
    const headers: Record<string, string> = {
      "Content-Type": googleWorkspace ? "text/plain; charset=utf-8" : "application/json",
      "X-AEA-Event-Type": "admin.notification",
    };
    if (!googleWorkspace && config.secret) headers.Authorization = `Bearer ${config.secret}`;
    const body = googleWorkspace
      ? JSON.stringify(await createGoogleWorkspaceAdminAlertEnvelope(payload, config.secret))
      : JSON.stringify(payload);
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Alert destination returned HTTP ${response.status}`);
    if (googleWorkspace && (await response.text()).trim() !== "ok") {
      throw new Error("Google Workspace did not acknowledge alert delivery.");
    }
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchAdminNotificationDeliveries({
  notificationId = "",
  force = false,
  fetchImpl = fetch,
}: DeliveryOptions = {}) {
  const db = getD1();
  const config = deliveryConfiguration();
  const now = new Date().toISOString();
  if (!config.configured) {
    const filter = notificationId ? " AND notification_id = ?" : "";
    const statement = db.prepare(`UPDATE admin_notification_deliveries SET status = 'waiting_for_channel',
      last_error = 'No private off-screen alert destination is configured.', updated_at = ?
      WHERE status IN ('pending', 'failed')${filter}`);
    if (notificationId) await statement.bind(now, notificationId).run();
    else await statement.bind(now).run();
    return { configured: false, attempted: 0, delivered: 0, failed: 0 };
  }

  await db.prepare(`UPDATE admin_notification_deliveries SET status = 'skipped',
    last_error = 'Notification was resolved before off-screen delivery.', updated_at = ?
    WHERE status IN ('pending', 'failed', 'waiting_for_channel')
    AND notification_id IN (SELECT id FROM admin_notifications WHERE status = 'resolved')`)
    .bind(now).run();

  const clauses = ["d.status IN ('pending', 'failed', 'waiting_for_channel')", "n.status != 'resolved'"];
  const bindings: string[] = [];
  if (!force) { clauses.push("(d.next_attempt_at = '' OR d.next_attempt_at <= ?)"); bindings.push(now); }
  if (notificationId) { clauses.push("d.notification_id = ?"); bindings.push(notificationId); }
  const rows = await db.prepare(`SELECT d.*, n.event_type, n.category, n.priority, n.title, n.summary,
    n.requires_action, n.created_at FROM admin_notification_deliveries d
    JOIN admin_notifications n ON n.id = d.notification_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY CASE n.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, d.created_at LIMIT 10`)
    .bind(...bindings).all<DeliveryRow>();

  const outcomes = await Promise.all(rows.results.map(async (row: DeliveryRow) => {
    const attempts = Number(row.attempts || 0) + 1;
    const attemptedAt = new Date().toISOString();
    try {
      const responseCode = await deliver(row, config, fetchImpl);
      await db.prepare(`UPDATE admin_notification_deliveries SET status = 'delivered', attempts = ?, last_attempt_at = ?,
        delivered_at = ?, last_error = '', response_code = ?, next_attempt_at = '', updated_at = ? WHERE id = ?`)
        .bind(attempts, attemptedAt, attemptedAt, responseCode, attemptedAt, row.id).run();
      return "delivered" as const;
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "DeliveryError";
      await db.prepare(`UPDATE admin_notification_deliveries SET status = 'failed', attempts = ?, last_attempt_at = ?,
        last_error = ?, response_code = 0, next_attempt_at = ?, updated_at = ? WHERE id = ?`)
        .bind(attempts, attemptedAt, clean(errorType, 120), adminNotificationRetryAt(attempts), attemptedAt, row.id).run();
      return "failed" as const;
    }
  }));
  const delivered = outcomes.filter((outcome: "delivered" | "failed") => outcome === "delivered").length;
  const failed = outcomes.filter((outcome: "delivered" | "failed") => outcome === "failed").length;
  return { configured: true, attempted: rows.results.length, delivered, failed };
}
