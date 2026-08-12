import { createLeadWebhookProbeHandler } from "@/lib/lead-webhook-probe.mjs";
import {
  publicPlanInternalRelayConfigured,
  readPublicPlanDeliveryReadiness,
} from "@/lib/public-plan-delivery-readiness.mjs";
import { serviceReminderProviderConfiguration } from "@/lib/service-reminder-delivery";
import { getD1 } from "../../../../../db";
import { getCustomerProjectEvidenceBucket } from "@/lib/customer-project-evidence-bucket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postLeadWebhookProbe = createLeadWebhookProbeHandler({
  readReadiness: async () => {
    const customerEmail = serviceReminderProviderConfiguration(process.env).email;
    return readPublicPlanDeliveryReadiness({
      database: getD1(),
      bucket: getCustomerProjectEvidenceBucket(),
      customerEmailConfigured: customerEmail.configured,
      internalRelayConfigured: publicPlanInternalRelayConfigured(process.env),
    });
  },
});

export async function POST(request) {
  return postLeadWebhookProbe(request);
}
