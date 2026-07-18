import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  maskPhotoRequestEmail,
  maskPhotoRequestMobile,
  photoRequestDeliveryDraft,
  photoRequestDeliveryIdempotencyKey,
  photoRequestReminderAvailable,
  PHOTO_REQUEST_RESEND_LIMIT,
} from "../src/lib/trade-photo-request-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0062_photo_request_delivery.sql");
const schema = read("../db/schema.ts");
const route = read("../src/app/api/trade-photo-requests/route.ts");
const server = read("../src/lib/photo-request-delivery-server.ts");
const panel = read("../src/components/TradePhotoRequestPanel.tsx");
const resend = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const twilio = read("../src/app/api/service-reminder-provider-events/twilio/route.ts");
const adminRoute = read("../src/app/api/admin/service-reminder-delivery/route.ts");
const adminUi = read("../src/components/AdminServiceReminderDelivery.tsx");

test("delivery identity is bound to request revision, token issue, intent and channel", async () => {
  const base = { requestId: "request-1", requestRevision: 3, tokenIssue: 2, intent: "initial", channel: "email" };
  const key = await photoRequestDeliveryIdempotencyKey(base);
  assert.equal(key, await photoRequestDeliveryIdempotencyKey(base));
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, requestRevision: 4 }));
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, tokenIssue: 3 }));
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, intent: "resend_1" }));
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, channel: "sms" }));
  assert.equal(PHOTO_REQUEST_RESEND_LIMIT, 2);
});

test("recipient previews and message copy are bounded", () => {
  assert.equal(maskPhotoRequestEmail("james@example.com"), "j****@example.com");
  assert.equal(maskPhotoRequestMobile("+61412345678"), "Mobile ending 678");
  const draft = photoRequestDeliveryDraft({ intent: "initial", businessName: "Example Trade", workNumber: "JOB-100",
    shareUrl: "https://example.test/job-information/request.secret", expiresAt: "2026-08-17T00:00:00.000Z" });
  assert.match(draft.subject, /JOB-100/);
  assert.match(draft.body, /request\.secret/);
  assert.doesNotMatch(draft.body, /\S+@\S+|\+614\d{8}/i);
  assert.equal(photoRequestReminderAvailable("2026-07-25T00:00:00.000Z", new Date("2026-07-18T00:00:00.000Z")), true);
  assert.equal(photoRequestReminderAvailable("2026-08-18T00:00:00.000Z", new Date("2026-07-18T00:00:00.000Z")), false);
});

test("the additive migration stores protected token issues and privacy-safe delivery history", () => {
  for (const table of ["trade_crm_photo_request_deliveries", "trade_crm_photo_request_delivery_events"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const column of ["encrypted_token", "token_issue"]) assert.match(migration, new RegExp("ADD `" + column + "`"));
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_photo_requests (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const columns = db.prepare("PRAGMA table_info(trade_crm_photo_requests)").all().map((row) => row.name);
  assert.ok(columns.includes("encrypted_token") && columns.includes("token_issue"));
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  for (const name of ["trade_crm_photo_request_deliveries_idempotency_idx", "trade_crm_photo_request_delivery_events_provider_idx"]) assert.ok(indexes.includes(name));
  db.close();
});

test("installer delivery reuses current contact, consent, opt-out, provider and daily-limit boundaries", () => {
  assert.match(server, /w\.stage work_status/);
  assert.doesNotMatch(server, /w\.status work_status/);
  for (const boundary of ["customer_accounts", "customer_consent_receipts", "customer_service_reminder_opt_outs", "mobile_verified_at",
    "service_reminder_channel_settings", "daily_limit", "TLINK_SMS_SENDER_APPROVED", "CRM_INTEGRATION_ENCRYPTION_KEY"]) {
    assert.match(`${server}\n${read("../src/lib/trade-integration-crypto.ts")}`, new RegExp(boundary));
  }
  assert.match(server, /status = 'sending'[\s\S]*?AND status = \? AND attempts = \?/);
  assert.match(server, /Number\(delivery\.attempts\) >= 3/);
  assert.match(server, /PHOTO_REQUEST_RESEND_LIMIT/);
  assert.match(server, /photoRequestReminderAvailable/);
  assert.match(route, /canDispatch/);
  assert.match(route, /consentConfirmed/);
  assert.match(route, /encrypted_token = ''/);
  assert.match(route, /status = 'replaced'/);
});

test("installer controls preview destinations and keep manual sharing available", () => {
  for (const copy of ["Preview the permitted destination", "Send by", "Resend link", "Send expiry reminder", "Delivery history"]) {
    assert.match(panel, new RegExp(copy));
  }
  assert.match(panel, /navigator\.share/);
  assert.match(panel, /consentConfirmed/);
  assert.match(panel, /delivery\.linkDeliverable/);
});

test("authenticated callbacks and administrator health include photo delivery without private payloads", () => {
  assert.match(resend, /verifyResendWebhook/);
  assert.match(resend, /trade_crm_photo_request_delivery_events/);
  assert.match(twilio, /verifyTwilioWebhook/);
  assert.match(twilio, /trade_crm_photo_request_delivery_events/);
  assert.match(adminRoute, /retryPhotoRequestDelivery/);
  assert.match(adminRoute, /photoRequestCounts/);
  assert.match(adminUi, /Photo request link delivery/);
  assert.match(adminUi, /Customer contacts, secure links and photos stay hidden/);
  assert.doesNotMatch(`${adminRoute}\n${adminUi}`, /customer_email|customer_phone|encrypted_token|token_hash|shareUrl|image_url/);
});

test("photo request delivery sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${server}\n${route}\n${panel}\n${adminRoute}\n${adminUi}`, /[\u2013\u2014]/);
});
