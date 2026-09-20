import { receiveSmsWebhook } from "@/lib/trade-sms-server";

export const runtime = "edge";

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await context.params;
    await receiveSmsWebhook(request, connectionId);
    return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "SMS_WEBHOOK_INVALID";
    return new Response(null, { status: invalid ? 403 : 503 });
  }
}
