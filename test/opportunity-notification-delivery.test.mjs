import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  OPPORTUNITY_INBOX_URL,
  opportunityNotificationDraft,
  opportunityNotificationHtml,
  opportunityNotificationEmailHash,
  opportunityNotificationEmailPreferenceAllows,
  opportunityNotificationIdempotencyKey,
} from "../src/lib/opportunity-notifications.ts";
import {
  serviceReminderProviderConfiguration,
} from "../src/lib/service-reminder-delivery.ts";
import {
  publicPlanContactReleaseAccessSql,
  publicPlanContactReleaseConsentSql,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL,
  OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL,
  OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL,
  OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL,
  opportunityNotificationFailureAudit,
  opportunityNotificationRetryAt,
  shouldDrainOpportunityNotificationBacklog,
  takeOpportunityNotificationDispatch,
} from "../src/lib/opportunity-notification-retry.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0087_trade_opportunity_notifications.sql");
const schema = read("../db/schema.ts");
const deliveryServer = read("../src/lib/opportunity-notification-server.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const manualMatches = read("../src/app/api/admin/opportunities/matches/route.ts");
const manualAllocation = read("../src/app/api/admin/opportunities/allocate/route.ts");
const resendCallback = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const worker = read("../worker/index.ts");
const vite = read("../vite.config.ts");
const LEGACY_V6_NOTICE = "2026-08-10-structured-service-address-sharing-v6";
const LEGACY_V6_PURPOSE =
  "Share my email, postcode, services and message with all approved TLink trades in my area, plus name, phone or full service address, and email my private plan";
const CONSENT_VERSION_SKIP_REASON =
  "The public enquiry contact consent is unavailable or no longer current.";

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
    suburb: "Southbank",
    postcode: "3006",
    state: "VIC",
    matchedCategories: ["solar", "battery"],
    timing: "within_3_months",
    expiresAt: "2026-08-31T00:00:00.000Z",
    customerSharedEvidenceCount: 2,
    addressLine1: "70 Southbank Boulevard",
    addressLine2: "Unit 6612",
  });
  assert.match(draft.subject, /New TLink opportunity in Southbank 3006, VIC/);
  for (const value of ["Example Energy", "Broad location: Southbank 3006, VIC", "Rooftop solar", "Home battery",
    "Within 3 months", "Complete privacy-safe customer plan: available after sign-in.",
    "The complete set of 2 customer-shared photos or documents is available after sign-in.",
    OPPORTUNITY_INBOX_URL]) {
    assert.match(draft.body, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(draft.body, /approved evidence|customer-approved/i);
  assert.doesNotMatch(draft.body, /70 Southbank Boulevard|Unit 6612/i);
  assert.doesNotMatch(draft.body, /2000|distance|customer name|customer email|customer phone|filename|meter|usage|token|match id/i);
  assert.ok(draft.subject.length <= 160 && draft.body.length <= 1800);
});

test("opportunity HTML is deterministic, TLink branded, escaped and retains plain-text fallback", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Example <script>alert(1)</script>",
    sourceKind: "public_plan_enquiry",
    customerName: "Jamie & Customer",
    customerMessage: "Please replace <the cooktop>.",
    suburb: "Private suburb",
    postcode: "3000",
    state: "VIC",
    matchedCategories: ["electric-cooking"],
    timing: "planning",
    expiresAt: "2026-09-09T00:00:00.000Z",
    customerSharedEvidenceCount: 0,
  });
  const html = opportunityNotificationHtml(draft);
  assert.equal(html, opportunityNotificationHtml(draft));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, />TLink</);
  assert.match(html, /Installer control centre/);
  assert.match(html, /Electric cooking and cooktops/);
  assert.match(html, /Open this lead in TLink/);
  assert.match(html, /TLink by Australian Energy Assessments/);
  assert.match(html, /&lt;the cooktop&gt;/);
  assert.doesNotMatch(html, /<script>|private suburb/i);
  assert.match(draft.body, /^Hello Example <script>/);
  assert.match(deliveryServer, /const html = opportunityNotificationHtml\(draft\)/);
  assert.match(
    deliveryServer,
    /subject: draft\.subject,[\s\S]*body: draft\.body,[\s\S]*html,[\s\S]*idempotencyKey/,
  );
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

test("public plan opportunity email is mandatory despite the optional account preference", () => {
  assert.equal(
    opportunityNotificationEmailPreferenceAllows("public_plan_enquiry", false),
    true,
  );
  assert.equal(
    opportunityNotificationEmailPreferenceAllows("quick_upgrade_enquiry", false),
    true,
  );
  assert.equal(
    opportunityNotificationEmailPreferenceAllows("customer_project", false),
    false,
  );
  assert.equal(
    opportunityNotificationEmailPreferenceAllows("legacy_marketplace", true),
    true,
  );
  assert.match(
    deliveryServer,
    /current_account\.email_opportunities = 1[\s\S]*OR EXISTS \([\s\S]*mandatory_public_email/,
  );
  assert.match(
    deliveryServer,
    /mandatory_public_email\.postcode = current_opportunity\.postcode/,
  );
  assert.match(
    deliveryServer,
    /current_public_contact\.postcode = current_opportunity\.postcode/,
  );
  assert.match(
    deliveryServer,
    /publicPlanContactReleaseConsentSql\("mandatory_public_email"\)/,
  );
  assert.match(
    deliveryServer,
    /publicPlanContactReleaseConsentSql\("current_public_contact"\)/,
  );
  assert.doesNotMatch(
    deliveryServer,
    /publicPlanContactReleaseAccessSql\("(?:mandatory_public_email|current_public_contact)"\)/,
  );
  const finalConsentGuard = publicPlanContactReleaseConsentSql("current_public_contact");
  assert.ok(finalConsentGuard.length < 4_096, "final consent guard must stay shallow for D1");
  assert.ok((finalConsentGuard.match(/\bWHEN\b/g) || []).length >= 1);
  assert.equal((finalConsentGuard.match(/\bELSE\b/g) || []).length, 1);
  assert.doesNotMatch(finalConsentGuard, /\b(?:EXISTS|json_)/i);
});

test("quick upgrade notifications state that no plan or PDF exists", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Example Energy",
    sourceKind: "quick_upgrade_enquiry",
    customerName: "",
    customerMessage: "Please quote a suitable hot water option.",
    suburb: "",
    postcode: "3000",
    state: "VIC",
    matchedCategories: ["hot-water"],
    timing: "planning",
    expiresAt: "2026-10-03T00:00:00.000Z",
    customerSharedEvidenceCount: 0,
  });
  assert.match(draft.subject, /New TLink customer enquiry in 3000/);
  assert.match(draft.body, /quick upgrade request/);
  assert.match(draft.body, /No home plan or PDF was created for this request/);
  assert.doesNotMatch(draft.body, /private home plan is not shared/);
  assert.match(deliveryServer, /THEN 'quick_upgrade_enquiry'/);
  assert.match(deliveryServer, /QUICK_UPGRADE_CONSENT_NOTICE_VERSION/);
  assert.match(deliveryServer, /QUICK_UPGRADE_CONSENT_PURPOSE/);
});

test("Resend submit does not wait for a webhook secret when send credentials are ready", () => {
  const provider = serviceReminderProviderConfiguration({
    RESEND_API_KEY: "re_1234567890123456",
    RESEND_FROM_EMAIL: "Australian Energy Assessments <service@example.com>",
  });
  assert.equal(provider.email.configured, true);
  assert.equal(provider.email.callbacks, false);
  assert.match(deliveryServer, /if \(!provider\.email\.configured\) \{/);
  assert.doesNotMatch(
    deliveryServer,
    /!provider\.email\.configured \|\| !provider\.email\.callbacks/,
  );
  assert.match(deliveryServer, /status <> 'waiting_for_channel' OR \? = 1/);
  assert.match(deliveryServer, /retryWaitingForChannel/);
});

test("transient failures through attempt three remain due for a later successful claim", () => {
  const startedAt = Date.parse("2026-08-11T00:00:00.000Z");
  const expectedMinutes = [5, 30, 120, 240, 480, 960, 1_440, 1_440];
  expectedMinutes.forEach((minutes, index) => {
    assert.equal(
      opportunityNotificationRetryAt(index + 1, startedAt),
      new Date(startedAt + minutes * 60 * 1000).toISOString(),
    );
  });

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE delivery (
    id text PRIMARY KEY,
    status text NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at text NOT NULL
  )`);
  const thirdRetryAt = opportunityNotificationRetryAt(3, startedAt);
  db.prepare("INSERT INTO delivery VALUES ('delivery-1', 'failed', 3, ?)")
    .run(thirdRetryAt);
  const due = db.prepare(`SELECT id FROM delivery
    WHERE status IN (${OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL})
      AND (next_attempt_at = '' OR next_attempt_at <= ?)`);
  assert.equal(due.get(new Date(Date.parse(thirdRetryAt) - 1).toISOString()), undefined);
  assert.equal(due.get(thirdRetryAt).id, "delivery-1");
  assert.equal(
    db.prepare(`UPDATE delivery SET status = 'sending', attempts = attempts + 1,
      next_attempt_at = '' WHERE id = 'delivery-1' AND status = 'failed' AND attempts = 3`)
      .run().changes,
    1,
  );
  assert.equal(
    db.prepare("UPDATE delivery SET status = 'sent' WHERE id = 'delivery-1' AND status = 'sending'")
      .run().changes,
    1,
  );
  const sent = db.prepare("SELECT status, attempts FROM delivery WHERE id = 'delivery-1'").get();
  assert.equal(sent.status, "sent");
  assert.equal(sent.attempts, 4);
  assert.equal(opportunityNotificationFailureAudit(3).eventType, "provider_attempt_failed");
  assert.equal(opportunityNotificationFailureAudit(4).eventType, "provider_retry_escalated");
  db.close();

  assert.doesNotMatch(deliveryServer, /MAX_ATTEMPTS|attempts < \?/);
  assert.match(deliveryServer, /opportunityNotificationRetryAt\(attempts\)/);
});

test("successful health probes trigger bounded backlog recovery without hot looping failures", () => {
  assert.equal(shouldDrainOpportunityNotificationBacklog({
    method: "GET",
    pathname: "/api/health",
    responseOk: true,
  }), true);
  assert.equal(shouldDrainOpportunityNotificationBacklog({
    method: "GET",
    pathname: "/api/health",
    responseOk: false,
  }), false);
  assert.equal(shouldDrainOpportunityNotificationBacklog({
    method: "POST",
    pathname: "/api/health",
    responseOk: true,
  }), false);
  assert.equal(shouldDrainOpportunityNotificationBacklog({
    method: "GET",
    pathname: "/plan",
    responseOk: true,
  }), false);
  assert.match(worker, /shouldDrainOpportunityNotificationBacklog/);
  assert.match(deliveryServer, /next_attempt_at = '' OR next_attempt_at <= \?/);
});

test("the exact dispatch hook is removed before the response reaches the browser", async () => {
  const headerName = "X-AEA-Opportunity-Notification-Dispatch";
  const dispatch = takeOpportunityNotificationDispatch(new Response("accepted", {
    status: 202,
    headers: {
      [headerName]: "opportunity-1",
      "X-Public-Header": "kept",
    },
  }), headerName);
  assert.equal(dispatch.opportunityId, "opportunity-1");
  assert.equal(dispatch.response.status, 202);
  assert.equal(dispatch.response.headers.has(headerName), false);
  assert.equal(dispatch.response.headers.get("X-Public-Header"), "kept");
  assert.equal(await dispatch.response.text(), "accepted");
  assert.match(worker, /takeOpportunityNotificationDispatch/);
});

test("manual exact recovery makes exhausted transient rows immediately claimable and preserves terminal rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE delivery (
    id text PRIMARY KEY,
    status text NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at text NOT NULL
  )`);
  const insert = db.prepare("INSERT INTO delivery VALUES (?, ?, ?, ?)");
  insert.run("failed", "failed", 9, "2026-08-12T00:00:00.000Z");
  insert.run("channel", "waiting_for_channel", 0, "");
  insert.run("suppressed", "suppressed", 2, "");
  insert.run("bounced", "bounced", 1, "");
  insert.run("sent", "sent", 1, "");
  const result = db.prepare(`UPDATE delivery SET status = 'pending', next_attempt_at = ''
    WHERE status IN (${OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL})`).run();
  assert.equal(result.changes, 2);
  const recovered = db.prepare(
    "SELECT status, attempts, next_attempt_at FROM delivery WHERE id = 'failed'",
  ).get();
  assert.equal(recovered.status, "pending");
  assert.equal(recovered.attempts, 9);
  assert.equal(recovered.next_attempt_at, "");
  assert.deepEqual(
    db.prepare("SELECT id, status FROM delivery WHERE id IN ('suppressed', 'bounced', 'sent') ORDER BY id")
      .all().map((row) => ({ id: row.id, status: row.status })),
    [
      { id: "bounced", status: "bounced" },
      { id: "sent", status: "sent" },
      { id: "suppressed", status: "suppressed" },
    ],
  );
  db.close();

  assert.match(manualAllocation, /prepareOpportunityNotificationDeliveriesForManualRetry\(opportunityId\)/);
  assert.match(deliveryServer, /manual_retry_requested/);
});

test("zero-attempt public emails skipped by the old optional preference are safely requeued", () => {
  for (const boundary of [
    "Opportunity email consent is not active.",
    "Optional opportunity emails are disabled.",
    CONSENT_VERSION_SKIP_REASON,
    "status = 'skipped'",
    "attempts = 0",
    "recovery_match.status IN ('offered', 'viewed', 'interested', 'connected')",
    "recovery_opportunity.status = 'open'",
    "recovery_account.consent_at <> ''",
    "recovery_account.availability_status IN ('open', 'limited')",
    "verifiedTradeAccountPredicate(\"recovery_account\")",
    "recovery_public_contact.status = 'active'",
    'publicPlanContactReleaseAccessSql("recovery_public_contact")',
    "recovery_public_contact.withdrawn_at = ''",
    "recovery_public_contact.postcode = recovery_opportunity.postcode",
  ]) {
    assert.match(
      deliveryServer,
      new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  const drainIndex = deliveryServer.indexOf("export async function drainOpportunityNotificationDeliveries");
  const recoveryIndex = deliveryServer.indexOf(
    "await recoverLegacyPublicOptionalEmailSkips(now)",
    drainIndex,
  );
  const claimIndex = deliveryServer.indexOf(
    "const statement = db.prepare(`SELECT id, status, attempts",
    drainIndex,
  );
  assert.ok(drainIndex > 0 && recoveryIndex > drainIndex && claimIndex > recoveryIndex);
});

test("a zero-attempt v6 consent-version skip is requeued while invalid or withdrawn releases stay terminal", () => {
  const recoverySql = deliveryServer.match(
    /async function recoverLegacyPublicOptionalEmailSkips[\s\S]*?prepare\(`([\s\S]*?)`\)\s*\.bind/,
  )?.[1];
  assert.ok(recoverySql, "legacy public skip recovery SQL must be extractable");
  const executableSql = recoverySql
    .replace(
      '${verifiedTradeAccountPredicate("recovery_account")}',
      "recovery_account.status = 'approved'",
    )
    .replace(
      '${publicPlanContactReleaseAccessSql("recovery_public_contact")}',
      publicPlanContactReleaseAccessSql("recovery_public_contact"),
    );
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunity_notification_deliveries (
      id text PRIMARY KEY, match_id text NOT NULL, status text NOT NULL,
      eligibility_reason text NOT NULL, attempts integer NOT NULL,
      next_attempt_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY, opportunity_id text NOT NULL, firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_opportunities (
      id text PRIMARY KEY, status text NOT NULL, expires_at text NOT NULL,
      created_at text NOT NULL, postcode text NOT NULL
    );
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY, partner_type text NOT NULL, consent_at text NOT NULL,
      availability_status text NOT NULL, email text NOT NULL, status text NOT NULL
    );
    CREATE TABLE public_trade_lead_contact_releases (
      id text PRIMARY KEY, opportunity_id text NOT NULL, status text NOT NULL,
      notice_version text NOT NULL, consent_purpose text NOT NULL,
      disclosed_fields text NOT NULL, granted_at text NOT NULL,
      withdrawn_at text NOT NULL, customer_email text NOT NULL, postcode text NOT NULL
    );`);
  const now = "2026-08-11T12:00:00.000Z";
  database.prepare(`INSERT INTO trade_accounts
    VALUES ('installer', 'installer', ?, 'open', 'trade@example.test', 'approved')`).run(now);
  const insertOpportunity = database.prepare(
    "INSERT INTO trade_opportunities VALUES (?, 'open', '2026-09-11T12:00:00.000Z', ?, '3000')",
  );
  const insertMatch = database.prepare(
    "INSERT INTO trade_opportunity_matches VALUES (?, ?, 'installer', 'offered')",
  );
  const insertRelease = database.prepare(`INSERT INTO public_trade_lead_contact_releases
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'customer@example.test', '3000')`);
  const insertDelivery = database.prepare(`INSERT INTO trade_opportunity_notification_deliveries
    VALUES (?, ?, 'skipped', ?, ?, '', ?)`);
  const fields = JSON.stringify(["customer_email", "postcode", "service_categories"]);
  const addCase = ({
    id,
    version = LEGACY_V6_NOTICE,
    purpose = LEGACY_V6_PURPOSE,
    withdrawnAt = "",
    attempts = 0,
  }) => {
    const opportunityId = `opportunity-${id}`;
    const matchId = `match-${id}`;
    insertOpportunity.run(opportunityId, now);
    insertMatch.run(matchId, opportunityId);
    insertRelease.run(`release-${id}`, opportunityId, version, purpose, fields, now, withdrawnAt);
    insertDelivery.run(id, matchId, CONSENT_VERSION_SKIP_REASON, attempts, now);
  };
  addCase({ id: "valid-v6" });
  addCase({ id: "unknown-pair", version: "2026-08-10-unknown-v5" });
  addCase({ id: "withdrawn-v6", withdrawnAt: now });
  addCase({ id: "attempted-v6", attempts: 1 });

  const result = database.prepare(executableSql).run(
    now,
    "Opportunity email consent is not active.",
    "Optional opportunity emails are disabled.",
    CONSENT_VERSION_SKIP_REASON,
    now,
    now,
  );
  assert.equal(result.changes, 1);
  assert.deepEqual(
    database.prepare("SELECT id, status FROM trade_opportunity_notification_deliveries ORDER BY id")
      .all().map((row) => ({ id: row.id, status: row.status })),
    [
      { id: "attempted-v6", status: "skipped" },
      { id: "unknown-pair", status: "skipped" },
      { id: "valid-v6", status: "pending" },
      { id: "withdrawn-v6", status: "skipped" },
    ],
  );
  database.close();
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
  db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at, updated_at)
    VALUES (?, ?, ?, 'offered', ?, ?)`)
    .run("third-match", "opportunity-1", "installer-3", "2026-07-31T00:03:00.000Z", "2026-07-31T00:03:00.000Z");
  const coverage = db.prepare(`SELECT COUNT(*) match_count,
      COUNT(delivery.id) delivery_count,
      COUNT(DISTINCT delivery.match_id) unique_recipient_count
      FROM trade_opportunity_matches assignment
      LEFT JOIN trade_opportunity_notification_deliveries delivery ON delivery.match_id = assignment.id
      WHERE assignment.opportunity_id = 'opportunity-1'`).get();
  assert.equal(coverage.match_count, 3);
  assert.equal(coverage.delivery_count, 3);
  assert.equal(coverage.unique_recipient_count, 3);
  db.close();
});

test("coverage repair dynamically inserts only a missing active-match delivery", () => {
  const db = notificationDatabase();
  const now = "2026-08-11T00:00:00.000Z";
  const insertMatch = db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at, updated_at)
    VALUES (?, 'opportunity-repair', ?, 'offered', ?, ?)`);
  insertMatch.run("repair-match-1", "installer-1", now, now);
  insertMatch.run("repair-match-2", "installer-2", now, now);
  db.prepare("DELETE FROM trade_opportunity_notification_deliveries WHERE match_id = 'repair-match-2'")
    .run();

  const repair = db.prepare(OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL);
  assert.equal(repair.run(now, "opportunity-repair").changes, 1);
  assert.equal(repair.run(now, "opportunity-repair").changes, 0);
  const coverage = db.prepare(`SELECT COUNT(*) match_count,
      COUNT(delivery.id) delivery_count,
      COUNT(DISTINCT delivery.match_id) unique_delivery_count
    FROM trade_opportunity_matches assignment
    LEFT JOIN trade_opportunity_notification_deliveries delivery ON delivery.match_id = assignment.id
    WHERE assignment.opportunity_id = 'opportunity-repair'`).get();
  assert.equal(coverage.match_count, 2);
  assert.equal(coverage.delivery_count, 2);
  assert.equal(coverage.unique_delivery_count, 2);

  const selectedByTwoDrains = db.prepare(`SELECT id, status, attempts
    FROM trade_opportunity_notification_deliveries
    WHERE status IN (${OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL})
    ORDER BY id`).all();
  const claim = db.prepare(`UPDATE trade_opportunity_notification_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = ''
    WHERE ${OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL}`);
  let providerSendCount = 0;
  for (const row of selectedByTwoDrains) {
    const claimed = claim.run(row.attempts + 1, row.id, row.status, row.attempts);
    if (claimed.changes) {
      providerSendCount += 1;
      db.prepare("UPDATE trade_opportunity_notification_deliveries SET status = 'sent' WHERE id = ?")
        .run(row.id);
    }
  }
  for (const staleRow of selectedByTwoDrains) {
    assert.equal(
      claim.run(staleRow.attempts + 1, staleRow.id, staleRow.status, staleRow.attempts).changes,
      0,
    );
  }
  assert.equal(providerSendCount, 2);
  assert.equal(
    db.prepare(`SELECT COUNT(*) pending FROM trade_opportunity_notification_deliveries
      WHERE status IN (${OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL})`).get().pending,
    0,
  );
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
    "account.availability_status", "opportunityNotificationEmailPreferenceAllows",
    "opportunity.status opportunity_status", "assignment.status match_status",
    "\"offered\", \"viewed\", \"interested\", \"connected\"", "evidence.sharing_scope = 'allocated-installers'",
    "consent.purpose = 'installer_evidence_sharing'", "consent.withdrawn_at = ''",
    "trade_opportunity_email_suppressions"]) {
    assert.match(deliveryServer, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(deliveryServer, /OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL/);
  assert.match(deliveryServer, /datetime\(current_opportunity\.created_at, '\+30 days'\) > \?/);
  assert.match(deliveryServer, /current_account\.availability_status IN \('open', 'limited'\)/);
  assert.match(deliveryServer, /previousAttempts > 0/);
  assert.match(deliveryServer, /storedIdempotencyKey/);
  assert.match(deliveryServer, /storedEmailHash !== emailHash/);
  assert.match(deliveryServer, /sendServiceReminderProviderMessage/);
  assert.match(deliveryServer, /messageType: "trade_opportunity"/);
  assert.match(deliveryServer, /opportunityNotificationRetryAt/);
  assert.match(deliveryServer, /status = 'failed'/);
});

test("notification location comes from the consented opportunity snapshot without mutable profile fields", () => {
  assert.match(deliveryServer, /opportunity\.suburb opportunity_suburb/);
  assert.match(deliveryServer, /opportunity\.postcode opportunity_postcode/);
  assert.match(
    deliveryServer,
    /opportunity\.source_reference = 'customer-project:' \|\| project\.id/,
  );
  assert.match(
    deliveryServer,
    /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/,
  );
  assert.match(deliveryServer, /suburb: matchingLocality\.suburb/);
  assert.match(deliveryServer, /postcode: matchingLocality\.postcode/);
  assert.doesNotMatch(
    deliveryServer,
    /JOIN customer_accounts|LEFT JOIN customer_accounts/,
  );
});

test("allocation writes matches while the trigger and coverage repair own durable enqueue", () => {
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
  assert.match(vite, /\["\* \* \* \* \*", "15 20 \* \* \*", "5 13,14 \* \* \*", "25 13,14 \* \* \*"\]/);
  assert.match(worker, /drainOpportunityNotificationDeliveries\(\)/);
  assert.match(worker, /dispatchAdminNotificationDeliveries\(\)/);
  assert.match(worker, /drainCustomerOpportunityDispatchJobs\(\)/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON/);
  assert.match(worker, /controller\.cron === DAILY_MAINTENANCE_CRON/);
  assert.match(worker, /const NOTIFICATION_DELIVERY_CRON = "\* \* \* \* \*"/);
  assert.match(worker, /const DAILY_MAINTENANCE_CRON = "15 20 \* \* \*"/);
});

test("public lead responses dispatch exact opportunity notifications without exposing the private handoff header", () => {
  assert.match(worker, /takeOpportunityNotificationDispatch/);
  assert.match(
    worker,
    /ctx\.waitUntil\([\s\S]*drainOpportunityNotificationDeliveriesForOpportunity\(\{ opportunityId \}\)/,
  );
  assert.match(
    deliveryServer,
    /export async function drainOpportunityNotificationDeliveriesForOpportunity/,
  );
  assert.match(deliveryServer, /while \(true\)/);
  assert.match(deliveryServer, /if \(result\.attempted < batchSize\) break/);
  assert.doesNotMatch(deliveryServer, /batch < \d+/);
  assert.match(opportunityServer, /await ensureOpportunityNotificationDeliveries\(opportunityId\)/);
  assert.match(deliveryServer, /OPPORTUNITY_NOTIFICATION_ENQUEUE_INCOMPLETE/);
  assert.match(worker, /shouldDrainOpportunityNotificationBacklog/);
  assert.match(worker, /Opportunity notification backlog delivery failed\./);
  assert.match(worker, /Opportunity notification delivery remains pending\./);
  assert.match(worker, /Opportunity notification backlog remains pending\./);
});

test("authenticated manual allocation safely recovers already-enqueued notifications for one opportunity", () => {
  assert.match(
    manualAllocation,
    /drainOpportunityNotificationDeliveriesForOpportunity\(\{ opportunityId \}\)/,
  );
  assert.match(
    manualAllocation,
    /prepareOpportunityNotificationDeliveriesForManualRetry\(opportunityId\)/,
  );
  assert.match(manualAllocation, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(manualAllocation, /notificationDelivery/);
});

test("opportunity notification sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${migration}\n${deliveryServer}\n${resendCallback}\n${worker}`, /[\u2013\u2014]/);
});
