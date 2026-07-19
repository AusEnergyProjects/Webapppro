import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeAustralianMobile,
  sendServiceReminderProviderMessage,
  serviceReminderIdempotencyKey,
  serviceReminderProviderConfiguration,
  serviceReminderSmsBody,
  verifyResendWebhook,
  verifyTwilioWebhook,
} from "../src/lib/service-reminder-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts"); const migration = read("../drizzle/0053_service_reminder_delivery.sql");
const route = read("../src/app/api/trade-service-follow-ups/route.ts");
const customerRoute = read("../src/app/api/customer-asset-lifecycle/route.ts");
const resendRoute = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const twilioRoute = read("../src/app/api/service-reminder-provider-events/twilio/route.ts");
const adminRoute = read("../src/app/api/admin/service-reminder-delivery/route.ts");
const ui = read("../src/components/TradeServiceFollowUpWorkspace.tsx");
const customerUi = read("../src/components/CustomerAssetLifecycle.tsx");
const adminUi = read("../src/components/AdminServiceReminderDelivery.tsx");

test("provider readiness requires send credentials and authenticated callbacks", () => {
  const empty = serviceReminderProviderConfiguration({});
  assert.equal(empty.email.configured, false); assert.equal(empty.sms.configured, false);
  const ready = serviceReminderProviderConfiguration({ RESEND_API_KEY: "re_1234567890123456", RESEND_FROM_EMAIL: "AEA <service@example.com>", RESEND_WEBHOOK_SECRET: "whsec_12345678901234567890",
    TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`, TWILIO_AUTH_TOKEN: "x".repeat(32), TWILIO_MESSAGING_SERVICE_SID: `MG${"2".repeat(32)}`, TWILIO_VERIFY_SERVICE_SID: `VA${"3".repeat(32)}` });
  assert.equal(ready.email.configured && ready.email.callbacks, true);
  assert.equal(ready.sms.configured && ready.sms.callbacks && ready.sms.verifyService, true);
});

test("customer mobile and SMS copy are bounded and opt-out capable", () => {
  assert.equal(normalizeAustralianMobile("0412 345 678"), "+61412345678");
  assert.equal(normalizeAustralianMobile("123"), "");
  const body = serviceReminderSmsBody("A".repeat(600));
  assert.ok(body.length <= 420); assert.match(body, /Reply STOP to unsubscribe\.$/);
});

test("delivery idempotency is stable for one follow-up channel and content revision", async () => {
  const one = await serviceReminderIdempotencyKey("follow-up", "email", 4);
  assert.equal(one, await serviceReminderIdempotencyKey("follow-up", "email", 4));
  assert.notEqual(one, await serviceReminderIdempotencyKey("follow-up", "sms", 4));
  assert.notEqual(one, await serviceReminderIdempotencyKey("follow-up", "email", 5));
});

test("Resend requests use provider idempotency and optional calendar attachments without exposing credentials", async () => {
  let captured;
  const result = await sendServiceReminderProviderMessage({ channel: "email", recipient: "customer@example.com", subject: "Service due", body: "Review your service reminder.", idempotencyKey: "key-1", callbackUrl: "https://example.com/callback",
    attachments: [{ filename: "appointment.ics", content: "QkVHSU46VkNBTEVOREFS", contentType: "text/calendar" }] }, {
    runtime: { RESEND_API_KEY: "re_secret", RESEND_FROM_EMAIL: "AEA <service@example.com>" },
    fetchImpl: async (url, init) => { captured = { url, init }; return Response.json({ id: "email-1" }); },
  });
  assert.equal(result.providerMessageId, "email-1"); assert.equal(captured.init.headers["Idempotency-Key"], "key-1");
  const payload = JSON.parse(String(captured.init.body));
  assert.deepEqual(payload.attachments, [{ filename: "appointment.ics", content: "QkVHSU46VkNBTEVOREFS", content_type: "text/calendar" }]);
  assert.doesNotMatch(String(captured.init.body), /re_secret/);
});

test("Twilio requests include the exact status callback and STOP copy", async () => {
  let body = "";
  await sendServiceReminderProviderMessage({ channel: "sms", recipient: "+61412345678", subject: "", body: "Service is due.", idempotencyKey: "key-2", callbackUrl: "https://compare.example/api/callback" }, {
    runtime: { TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`, TWILIO_AUTH_TOKEN: "secret", TWILIO_MESSAGING_SERVICE_SID: `MG${"2".repeat(32)}` },
    fetchImpl: async (_url, init) => { body = String(init.body); return Response.json({ sid: "SM1", status: "queued" }); },
  });
  const values = new URLSearchParams(body); assert.equal(values.get("StatusCallback"), "https://compare.example/api/callback");
  assert.match(values.get("Body"), /Reply STOP to unsubscribe/);
});

test("Resend and Twilio webhook signatures are verified against raw provider input", async () => {
  const secretBytes = randomBytes(32); const secret = `whsec_${secretBytes.toString("base64")}`;
  const raw = JSON.stringify({ type: "email.delivered", data: { email_id: "email-1" } }); const id = "msg_test"; const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${raw}`).digest("base64");
  assert.equal(await verifyResendWebhook(raw, new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }), secret), true);
  const url = "https://compare.example/api/twilio"; const parameters = new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered" });
  const content = `${url}MessageSidSM1MessageStatusdelivered`; const twilioSignature = createHmac("sha1", "token").update(content).digest("base64");
  assert.equal(await verifyTwilioWebhook(url, parameters, twilioSignature, "token"), true);
});

test("delivery migration is additive, replay-safe and applies after P6-2F", () => {
  for (const name of ["service_reminder_channel_settings", "service_reminder_deliveries", "service_reminder_delivery_events", "customer_service_reminder_contacts", "customer_service_reminder_opt_outs"]) assert.match(schema, new RegExp(`sqliteTable\\("${name}"`));
  assert.match(migration, /service_reminder_deliveries_idempotency_idx/); assert.match(migration, /service_reminder_delivery_events_provider_idx/);
  const db = new DatabaseSync(":memory:");
  const files = ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0018_military_starhawk.sql", "0019_melodic_unus.sql",
    "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0049_customer_asset_timeline.sql",
    "0052_service_follow_up_preparation.sql", "0053_service_reminder_delivery.sql"];
  for (const file of files) for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM service_reminder_channel_settings").get().total, 2);
});

test("send, retry, consent race, rate limit and opt-out boundaries are server enforced", () => {
  assert.match(route, /candidate\.storedStatus !== "ready"/); assert.match(route, /serviceReminderIdempotencyKey/);
  assert.match(route, /DAILY_LIMIT_REACHED/); assert.match(customerRoute, /status IN \('queued', 'failed'\)/);
  assert.match(customerRoute, /email_enabled = excluded\.email_enabled/); assert.match(customerRoute, /mobile_verified_at/);
  assert.match(resendRoute, /verifyResendWebhook/); assert.match(resendRoute, /email\.bounced/); assert.match(resendRoute, /provider_event_key/);
  assert.match(twilioRoute, /verifyTwilioWebhook/); assert.match(twilioRoute, /OptOutType/); assert.match(twilioRoute, /twilio_stop/);
});

test("administrator configuration and deliberate review controls expose no credentials", () => {
  assert.match(adminRoute, /requireAdminIdentity\(request, \["owner"\]\)/); assert.match(adminRoute, /writeAdminAudit/);
  assert.doesNotMatch(`${adminRoute}\n${adminUi}`, /RESEND_API_KEY|TWILIO_AUTH_TOKEN/);
  assert.match(ui, /I reviewed this exact reminder and want to send it now/); assert.match(customerUi, /Verify a mobile number before choosing SMS/);
  assert.doesNotMatch(`${ui}\n${adminUi}`, /customer@example|mobile_e164|account\.email/);
});

test("new delivery copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${customerRoute}\n${resendRoute}\n${twilioRoute}\n${adminRoute}\n${ui}\n${customerUi}\n${adminUi}`, /[\u2013\u2014]/);
});
