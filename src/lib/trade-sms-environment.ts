import { env } from "cloudflare:workers";

function setting(name: string) {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" ? value.trim() : "";
}
export function smsEnvironment() {
  return { username: setting("TLINK_CLICKSEND_USERNAME"), apiKey: setting("TLINK_CLICKSEND_API_KEY"),
    stripeKey: setting("TLINK_SMS_STRIPE_SECRET_KEY"), stripeWebhookSecret: setting("TLINK_SMS_STRIPE_WEBHOOK_SECRET"),
    origin: setting("TLINK_SMS_PUBLIC_ORIGIN"), urlsEnabled: setting("TLINK_SMS_URLS_ENABLED") === "true" };
}
export function smsPublicOrigin() {
  const value = smsEnvironment().origin;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SMS_ADMIN_SETUP_REQUIRED"); }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value) throw new Error("SMS_ADMIN_SETUP_REQUIRED");
  return url.origin;
}
