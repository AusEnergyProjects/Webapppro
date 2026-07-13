import { getStore } from "@netlify/blobs";
import { runApiHealthMonitor } from "../../src/lib/api-health-monitor.mjs";

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

async function apiHealthMonitor() {
  const siteUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL");
  if (!siteUrl) {
    console.error(JSON.stringify({ schemaVersion: "1", event: "monitor.api_health", status: "unhealthy", errorType: "SiteUrlMissing" }));
    return new Response(null, { status: 500 });
  }

  const result = await runApiHealthMonitor({
    siteUrl,
    leadProbeToken: Netlify.env.get("AEA_LEAD_WEBHOOK_TEST_TOKEN"),
    alertWebhookUrl: Netlify.env.get("AEA_OPS_ALERT_WEBHOOK_URL"),
    stateStore: getStore({ name: "aea-operations", consistency: "strong" }),
  });
  return Response.json(result, { status: result.status === "healthy" ? 200 : 503 });
}

export default apiHealthMonitor;

export const config = {
  schedule: "@hourly",
};
