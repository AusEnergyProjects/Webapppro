import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  OPPORTUNITY_INBOX_URL,
  opportunityNotificationDraft,
  opportunityNotificationEmailHash,
  opportunityNotificationIdempotencyKey,
} from "../src/lib/opportunity-notifications.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0087_trade_opportunity_notifications.sql");
const schema = read("../db/schema.ts");
const deliveryServer = read("../src/lib/opportunity-notification-server.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const manualMatches = read("../src/app/api/admin/opportunities/matches/route.ts");
const resendCallback = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const worker = read("../worker/index.ts");
const vite = read("../vite.config.ts");

function notificationDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL,
    firebase_uid text NOT NULL,
    status text DEFAULT 'offered' NOT NULL,
    matched_at text NOT NULL,
    updated_at text NOT NULL,
    UNIQUE(opportunity_id, firebase_uid)
  )`);
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    db.exec(statement);
  }
  return db;
}

test("opportunity email copy contains only the bounded business summary and signed-in CTA", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Example Energy",
    state: "NSW",
    matchedCategories: ["solar", "battery"],
    timing: "within_3_months",
    expiresAt: "2026-08-31T00:00:00.000Z",
    customerSharedEvidenceCount: 2,
  });
  assert.match(draft.subject, /New TLink opportunity in NSW/);
  for (const value of ["Example Energy", "Broad location: NSW", "Rooftop solar", "Home battery",
    "Within 3 months", "Complete privacy-safe customer plan: available after sign-in.",
    "The complete set of 2 customer-shared photos or documents is available after sign-in.",
    OPPORTUNITY_INBOX_URL]) {
    assert.match(draft.body, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(draft.body, /approved evidence|customer-approved/i);
  assert.doesNotMatch(draft.body, /2000|distance|customer name|customer email|customer phone|filename|meter|usage|token|match id/i);
  assert.ok(draft.subject.length <= 160 && draft.body.length <= 1800);
});

test("provider and suppression hashes are deterministic without retaining the email address", async () => {
  const key = await opportunityNotificationIdempotencyKey("match-1");
  assert.equal(key, await opportunityNotificationIdempotencyKey("match-1"));
  assert.notEqual(key, await opportunityNotificationIdempotencyKey("match-2"));
  const firstHash = await opportunityNotificationEmailHash("Business@Example.com ");
  assert.equal(firstHash, await opportunityNotificationEmailHash("business@example.com"));
  assert.doesNotMatch(firstHash, /business|example/);
  assert.equal(key.length, 64);
  assert.equal(firstHash.length, 64);
});

test("new automatic or manual match inserts atomically enqueue exactly once and updates do not resend", () => {
  const db = notificationDatabase();
  db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', ?, ?)`)
    .run("automatic-match", "opportunity-1", "installer-1", "2026-07-31T00:00:00.000Z", "2026-07-31T00:00:00.000Z");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_opportunity_notification_deliveries").get().total, 1);

  db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', ?, ?)
    ON CONFLICT(opportunity_id, firebase_uid) DO UPDATE SET updated_at = excluded.updated_at`)
    .run("manual-upsert-id", "opportunity-1", "installer-1", "2026-07-31T00:01:00.000Z", "2026-07-31T00:01:00.000Z");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_opportunity_notification_deliveries").get().total, 1);

  db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', ?, ?)`)
    .run("manual-match", "opportunity-1", "installer-2", "2026-07-31T00:02:00.000Z", "2026-07-31T00:02:00.000Z");
  assert.equal(db.prepare("SELECT COUNT(*) total FROM trade_opportunity_notification_deliveries").get().total, 2);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT match_id) total FROM trade_opportunity_notification_deliveries").get().total, 2);
  db.close();
});

test("authenticated callback SQL keeps opportunity delivery status monotonic", () => {
  const db = notificationDatabase();
  const now = "2026-07-31T00:00:00.000Z";
  db.prepare(`INSERT INTO trade_opportunity_notification_deliveries
    (id, match_id, status, enqueued_at, created_at, updated_at)
    VALUES ('delivery-1', 'match-1', 'delivered', ?, ?, ?)`).run(now, now, now);
  const updateMatch = resendCallback.match(
    /db\.prepare\(`(UPDATE trade_opportunity_notification_deliveries[\s\S]*?updated_at = \? WHERE id = \?)`\)\s*\.bind\(/,
  );
  assert.ok(updateMatch, "opportunity callback update SQL must remain identifiable");
  const update = db.prepare(updateMatch[1]);
  const apply = (incoming, eventType, terminal) => update.run(
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    eventType,
    incoming,
    now,
    terminal ? 1 : 0,
    now,
    terminal ? 1 : 0,
    eventType,
    incoming,
    now,
    "delivery-1",
  );

  apply("sent", "email.sent", false);
  assert.equal(
    db.prepare("SELECT status FROM trade_opportunity_notification_deliveries WHERE id = 'delivery-1'").get().status,
    "delivered",
  );
  apply("bounced", "email.bounced", true);
  assert.equal(
    db.prepare("SELECT status FROM trade_opportunity_notification_deliveries WHERE id = 'delivery-1'").get().status,
    "bounced",
  );
  apply("sent", "email.sent", false);
  assert.equal(
    db.prepare("SELECT status FROM trade_opportunity_notification_deliveries WHERE id = 'delivery-1'").get().status,
    "bounced",
  );
  db.close();
});

test("delivery storage has unique match, provider idempotency, event replay and hash suppression controls", () => {
  for (const table of ["trade_opportunity_notification_deliveries",
    "trade_opportunity_notification_delivery_events", "trade_opportunity_email_suppressions"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(migration, /trade_opportunity_notification_deliveries_match_idx/);
  assert.match(migration, /trade_opportunity_notification_deliveries_idempotency_idx/);
  assert.match(migration, /trade_opportunity_notification_delivery_events_provider_idx/);
  assert.match(migration, /CREATE TRIGGER `trade_opportunity_matches_notification_enqueue`/);
  assert.match(migration, /AFTER INSERT ON `trade_opportunity_matches`/);
});

test("dispatch rechecks authoritative access, consent, current email and live offer state", () => {
  for (const boundary of ["verifiedTradeAccountPredicate", "account.email", "account.consent_at",
    "account.email_opportunities", "opportunity.status opportunity_status", "assignment.status match_status",
    "\"offered\", \"viewed\", \"interested\", \"connected\"", "evidence.sharing_scope = 'allocated-installers'",
    "consent.purpose = 'installer_evidence_sharing'", "consent.withdrawn_at = ''",
    "trade_opportunity_email_suppressions"]) {
    assert.match(deliveryServer, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(deliveryServer, /status = 'sending'[\s\S]*AND status = \? AND attempts = \?/);
  assert.match(deliveryServer, /datetime\(current_opportunity\.created_at, '\+30 days'\) > \?/);
  assert.match(deliveryServer, /previousAttempts > 0/);
  assert.match(deliveryServer, /storedIdempotencyKey/);
  assert.match(deliveryServer, /storedEmailHash !== emailHash/);
  assert.match(deliveryServer, /sendServiceReminderProviderMessage/);
  assert.match(deliveryServer, /messageType: "trade_opportunity"/);
  assert.match(deliveryServer, /serviceReminderRetryAt/);
  assert.match(deliveryServer, /status = 'failed'/);
});

test("allocation paths only write matches while the database trigger owns durable enqueue", () => {
  assert.match(opportunityServer, /INSERT INTO trade_opportunity_matches/);
  assert.match(manualMatches, /INSERT INTO trade_opportunity_matches/);
  assert.match(manualMatches, /ON CONFLICT\(opportunity_id, firebase_uid\) DO UPDATE/);
  assert.doesNotMatch(`${opportunityServer}\n${manualMatches}`, /sendServiceReminderProviderMessage|dispatchDelivery/);
});

test("authenticated Resend events update the ledger and suppress hashes without changing preferences", () => {
  assert.match(resendCallback, /verifyResendWebhook/);
  assert.match(resendCallback, /trade_opportunity_notification_delivery_events/);
  assert.match(resendCallback, /trade_opportunity_email_suppressions/);
  assert.match(resendCallback, /\["email\.bounced", "email\.complained", "email\.suppressed"\]/);
  assert.match(resendCallback, /eventType === "email\.failed" \? "provider_failed"/);
  assert.match(resendCallback, /WHEN status = 'delivered' THEN status/);
  assert.doesNotMatch(resendCallback, /UPDATE trade_accounts SET email_opportunities/);
});

test("minute delivery drain is separate from the existing daily maintenance cron", () => {
  assert.match(vite, /\["\* \* \* \* \*", "15 20 \* \* \*"\]/);
  assert.match(worker, /drainOpportunityNotificationDeliveries\(\)/);
  assert.match(worker, /dispatchAdminNotificationDeliveries\(\)/);
  assert.match(worker, /drainCustomerOpportunityDispatchJobs\(\)/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON/);
  assert.match(worker, /controller\.cron === DAILY_MAINTENANCE_CRON/);
  assert.match(worker, /const NOTIFICATION_DELIVERY_CRON = "\* \* \* \* \*"/);
  assert.match(worker, /const DAILY_MAINTENANCE_CRON = "15 20 \* \* \*"/);
});

test("opportunity notification sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${migration}\n${deliveryServer}\n${resendCallback}\n${worker}`, /[\u2013\u2014]/);
});
