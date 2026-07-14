import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  adminNotificationRetryAt,
  buildAdminNotificationDeliveryPayload,
} from "../src/lib/admin-notification-delivery-payload.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0014_lonely_alex_wilder.sql");
const delivery = read("../src/lib/admin-notification-delivery.ts");
const notifications = read("../src/lib/admin-notifications.ts");
const route = read("../src/app/api/admin/notifications/route.ts");
const inbox = read("../src/components/AdminNotificationInbox.tsx");
const leads = read("../src/app/api/leads/route.js");
const probe = read("../src/app/api/internal/lead-webhook-probe/route.js");
const stripe = read("../src/app/api/stripe/webhook/route.ts");
const admins = read("../src/app/api/admin/admins/route.ts");

test("actionable admin alerts receive a durable delivery ledger entry", () => {
  assert.match(schema, /sqliteTable\("admin_notification_deliveries"/);
  assert.match(schema, /admin_notification_deliveries_notification_channel_idx/);
  assert.match(migration, /CREATE TRIGGER `admin_notifications_delivery_enqueue`/);
  assert.match(migration, /NEW\.`requires_action` = 1 OR NEW\.`priority` IN \('high', 'urgent'\)/);
  assert.match(migration, /Historic notification retained in the operations inbox/);
  assert.match(notifications, /dispatchAdminNotificationDeliveries\(\{ notificationId: id \}\)/);
});

test("the delivery migration queues new actionable alerts without replaying historic alerts", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE admin_notifications (
    id text PRIMARY KEY NOT NULL,
    event_type text NOT NULL,
    requires_action integer DEFAULT 0 NOT NULL,
    priority text DEFAULT 'normal' NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  database.prepare(`INSERT INTO admin_notifications
    (id, event_type, requires_action, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("historic", "customer.enquiry_submitted", 1, "high", "2026-07-14T00:00:00.000Z", "2026-07-14T00:00:00.000Z");
  migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)
    .forEach((statement) => database.exec(statement));
  database.prepare(`INSERT INTO admin_notifications
    (id, event_type, requires_action, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("new-action", "billing.membership_attention_required", 1, "high", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  database.prepare(`INSERT INTO admin_notifications
    (id, event_type, requires_action, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("new-low", "customer.signup", 0, "low", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  const historic = database.prepare("SELECT status FROM admin_notification_deliveries WHERE notification_id = 'historic'").get();
  const action = database.prepare("SELECT status FROM admin_notification_deliveries WHERE notification_id = 'new-action'").get();
  const low = database.prepare("SELECT status FROM admin_notification_deliveries WHERE notification_id = 'new-low'").get();
  assert.equal(historic.status, "skipped");
  assert.equal(action.status, "pending");
  assert.equal(low, undefined);
  database.close();
});

test("off-screen payloads exclude private account and customer fields", () => {
  const payload = buildAdminNotificationDeliveryPayload({
    notification_id: "notice-1",
    event_type: "customer.enquiry_submitted",
    category: "customer",
    priority: "high",
    title: "Customer enquiry submitted",
    summary: "A privacy-safe project is ready for review.",
    requires_action: 1,
    created_at: "2026-07-15T00:00:00.000Z",
    actor_uid: "private-user-id",
    entity_id: "private-project-id",
    email: "private@example.test",
    phone: "0400000000",
    address: "1 Private Street",
    metadata: { token: "secret" },
  });
  const serialized = JSON.stringify(payload);
  assert.equal(payload.eventType, "admin.notification");
  assert.equal(payload.actionPath, "/operations/control-centre");
  assert.doesNotMatch(serialized, /private-user-id|private-project-id|private@example|0400000000|Private Street|secret/);
  assert.deepEqual(Object.keys(payload.notification), ["id", "type", "category", "priority", "title", "summary", "requiresAction", "createdAt"]);
});

test("failed delivery retries back off without losing the durable record", () => {
  const now = Date.parse("2026-07-15T00:00:00.000Z");
  assert.equal(adminNotificationRetryAt(1, now), "2026-07-15T00:05:00.000Z");
  assert.equal(adminNotificationRetryAt(2, now), "2026-07-15T00:30:00.000Z");
  assert.equal(adminNotificationRetryAt(5, now), "2026-07-15T12:00:00.000Z");
  assert.match(delivery, /status = 'failed'/);
  assert.match(delivery, /waiting_for_channel/);
  assert.match(delivery, /Promise\.all/);
});

test("billing, lead-delivery and administrator security gaps create operations events", () => {
  assert.match(leads, /platform\.lead_delivery_failed/);
  assert.match(leads, /platform\.lead_rate_limit_unavailable/);
  assert.match(probe, /platform\.lead_delivery_probe_failed/);
  assert.match(stripe, /billing\.membership_attention_required/);
  assert.match(stripe, /billing\.webhook_processing_failed/);
  assert.match(stripe, /invoice\.payment_failed/);
  assert.match(admins, /security\.admin_invited/);
  assert.match(admins, /security\.admin_access_changed/);
});

test("administrators can see delivery health, test a channel and retry failures", () => {
  assert.match(route, /action === "send_test"/);
  assert.match(route, /action === "retry_delivery"/);
  assert.match(route, /Only owners and administrators can retry off-screen delivery/);
  assert.match(route, /adminNotificationDeliveryConfiguration/);
  assert.match(inbox, /Off-screen operations alerts/);
  assert.match(inbox, /Send test alert/);
  assert.match(inbox, /Retry alert/);
  assert.match(inbox, /Customer contacts, addresses, files and account credentials are never placed in alert payloads/);
});

test("new operations delivery copy avoids prohibited dash characters", () => {
  for (const source of [delivery, notifications, route, inbox, leads, probe, stripe, admins]) {
    assert.doesNotMatch(source, /[\u2013\u2014]/);
  }
});
