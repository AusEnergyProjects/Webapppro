import { createLeadWebhookProbeHandler } from "@/lib/lead-webhook-probe.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postLeadWebhookProbe = createLeadWebhookProbeHandler();

export async function POST(request) {
  return postLeadWebhookProbe(request);
}

