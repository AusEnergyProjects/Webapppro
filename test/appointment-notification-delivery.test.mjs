import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  appointmentNotificationDraft,
  appointmentNotificationIdempotencyKey,
  appointmentNotificationSummary,
} from "../src/lib/appointment-notifications.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0059_appointment_notifications.sql");
const schema = read("../db/schema.ts");
const server = read("../src/lib/appointment-notification-server.ts");
const provider = read("../src/lib/service-reminder-delivery.ts");
const workOrders = read("../src/app/api/trade-work-orders/route.ts");
const schedule = read("../src/app/api/trade-schedule/route.ts");
const customerProjects = read("../src/app/api/customer-projects/route.ts");
const resendCallback = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const twilioCallback = read("../src/app/api/service-reminder-provider-events/twilio/route.ts");
const adminRoute = read("../src/app/api/admin/service-reminder-delivery/route.ts");
const adminUi = read("../src/components/AdminServiceReminderDelivery.tsx");

test("appointment notification copy is bounded by audience and excludes private dispatch fields", () => {
  const customer = appointmentNotificationDraft({ eventType: "staff_assigned", audience: "customer",
    businessName: "Example Installer", workNumber: "JOB-100", startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T11:00" });
  const installer = appointmentNotificationDraft({ eventType: "preparation_confirmed", audience: "installer",
    businessName: "Example Installer", workNumber: "JOB-100", startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T11:00" });
  assert.match(customer.body, /Internal staff and capacity details remain private/);
  assert.doesNotMatch(customer.body, /assignee|private notes|address/i);
  assert.match(installer.body, /bounded site-preparation checklist/);
  assert.match(appointmentNotificationSummary("appointment_changed", "2026-08-11T13:00"), /Appointment changed/);
  assert.ok(customer.subject.length <= 160 && customer.body.length <= 1200);
});

test("appointment delivery idempotency changes by event, audience and channel", async () => {
  const first = await appointmentNotificationIdempotencyKey("appointment:a:staff_assigned:2", "customer", "email");
  assert.equal(first, await appointmentNotificationIdempotencyKey("appointment:a:staff_assigned:2", "customer", "email"));
  assert.notEqual(first, await appointmentNotificationIdempotencyKey("appointment:a:staff_assigned:2", "installer", "email"));
  assert.notEqual(first, await appointmentNotificationIdempotencyKey("appointment:a:staff_assigned:2", "customer", "sms"));
});

test("additive appointment notification storage applies with unique event and delivery keys", () => {
  for (const table of ["appointment_notification_events", "appointment_notification_deliveries", "appointment_notification_delivery_events"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["appointment_notification_deliveries", "appointment_notification_delivery_events", "appointment_notification_events"]);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  for (const name of ["appointment_notification_events_key_idx", "appointment_notification_deliveries_idempotency_idx", "appointment_notification_delivery_events_provider_idx"]) assert.ok(indexes.includes(name));
  db.close();
});

test("the four authoritative appointment milestones queue one revision-bound event", () => {
  assert.match(workOrders, /eventType: "appointment_created"/);
  assert.match(schedule, /eventType: current\.assignee_member_id \? "appointment_changed" : "staff_assigned"/);
  assert.match(schedule, /eventType: "appointment_changed", appointmentRevision/);
  assert.match(customerProjects, /eventType: "preparation_confirmed"/);
  assert.match(customerProjects, /appointment\.revision appointment_revision/);
  assert.match(server, /appointment:\$\{input\.appointmentId\}:\$\{input\.eventType\}:\$\{revision\}/);
  assert.match(server, /INSERT OR IGNORE INTO appointment_notification_events/);
});

test("delivery rechecks consent, opt-outs, provider readiness, limits and sender approval", () => {
  for (const boundary of ["account_updates", "customer_account_consent", "customer_email_opted_out", "customer_sms_opted_out",
    "mobile_verified_at", "email_opportunities", "installer_consent_at", "service_reminder_channel_settings", "daily_limit"]) assert.match(server, new RegExp(boundary));
  assert.match(server, /TLINK_SMS_SENDER_APPROVED/);
  assert.match(server, /waiting_for_sender/);
  assert.match(server, /Number\(delivery\.attempts\) >= 3/);
  assert.match(server, /status = 'sending'[\s\S]*?AND status = \? AND attempts = \?/);
  assert.match(server, /DELIVERY_ALREADY_CLAIMED/);
  assert.match(provider, /messageType\?: string/);
  assert.match(server, /messageType: "appointment_notification"/);
});

test("authenticated provider callbacks update appointment delivery state and customer opt-outs", () => {
  assert.match(resendCallback, /verifyResendWebhook/);
  assert.match(resendCallback, /appointment_notification_delivery_events/);
  assert.match(resendCallback, /appointment_notification_deliveries SET status = 'opted_out'/);
  assert.match(twilioCallback, /verifyTwilioWebhook/);
  assert.match(twilioCallback, /appointment_notification_delivery_events/);
  assert.match(twilioCallback, /audience = 'customer'/);
});

test("administrators get privacy-safe delivery health and bounded retry controls", () => {
  assert.match(adminRoute, /retryAppointmentNotificationDelivery/);
  assert.match(adminRoute, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(adminRoute, /appointment_notification\.delivery_retry/);
  assert.match(adminUi, /Appointment notification delivery/);
  assert.match(adminUi, /No contact details are displayed here/);
  assert.match(adminUi, /Retry notification/);
  assert.doesNotMatch(adminUi, /recipient_uid|customer_email|installer_email|mobile_e164/);
});

test("appointment notification sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${server}\n${provider}\n${workOrders}\n${schedule}\n${customerProjects}\n${adminRoute}\n${adminUi}`, /[\u2013\u2014]/);
});
