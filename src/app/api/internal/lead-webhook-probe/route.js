import { createLeadWebhookProbeHandler } from "@/lib/lead-webhook-probe.mjs";
import { createAdminNotification, resolveSystemAdminNotifications } from "@/lib/admin-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postLeadWebhookProbe = createLeadWebhookProbeHandler({
  onFailure: async ({ kind, probeId }) => {
    await createAdminNotification({
      eventKey: `platform:lead-probe:${kind}:${new Date().toISOString().slice(0, 13)}`,
      eventType: kind === "unconfigured" ? "platform.lead_delivery_unconfigured" : "platform.lead_delivery_probe_failed",
      category: "platform",
      priority: "urgent",
      title: kind === "unconfigured" ? "Lead delivery monitoring is not configured" : "Lead delivery health check failed",
      summary: "The privacy-safe lead processor health check requires operations attention. No customer or household data was included in the probe or this alert.",
      entityType: "platform_service",
      entityId: "comparison_lead_delivery",
      actorType: "system",
      requiresAction: true,
      metadata: { probeId },
    }).catch(() => null);
  },
  onRecovery: async () => {
    await resolveSystemAdminNotifications({
      eventTypes: ["platform.lead_delivery_unconfigured", "platform.lead_delivery_probe_failed", "platform.lead_delivery_failed"],
      entityType: "platform_service",
      entityId: "comparison_lead_delivery",
      note: "The privacy-safe lead delivery health check recovered.",
    }).catch(() => null);
  },
});

export async function POST(request) {
  return postLeadWebhookProbe(request);
}
