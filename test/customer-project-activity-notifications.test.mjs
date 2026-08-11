import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  CUSTOMER_QUOTE_INBOX_URL,
  INSTALLER_LEAD_INBOX_URL,
  customerProjectActivityDraft,
  customerProjectActivityEmailHash,
  customerProjectActivityIdentity,
} from "../src/lib/customer-project-activity-notifications.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0089_customer_project_activity_notifications.sql");
const submissionMigration = read("../drizzle/0090_customer_project_quote_submission_ledger.sql");
const acceptanceMigration = read("../drizzle/0091_customer_project_quote_acceptance_claims.sql");
const schema = read("../db/schema.ts");
const activityServer = read("../src/lib/customer-project-activity-notification-server.ts");
const tradeOpportunities = read("../src/app/api/trade-opportunities/route.ts");
const customerProjects = read("../src/app/api/customer-projects/route.ts");
const quoteEditor = read("../src/components/InstallerPlatformQuote.tsx");
const resendCallback = read("../src/app/api/service-reminder-provider-events/resend/route.ts");
const worker = read("../worker/index.ts");
const tradeNotificationsRoute = read("../src/app/api/trade-job-notifications/route.ts");
const tradeNotificationsUi = read("../src/components/TradeJobNotifications.tsx");
const tradeDashboard = read("../src/components/DirectTradeDashboard.tsx");

function applyActivityMigration(beforeMigrations) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_project_quotes (
    id text PRIMARY KEY NOT NULL,
    opportunity_match_id text NOT NULL UNIQUE,
    installer_uid text NOT NULL,
    project_id text DEFAULT 'project' NOT NULL,
    total_cents_ex_gst integer DEFAULT 0 NOT NULL,
    customer_decision text DEFAULT 'reviewing' NOT NULL,
    status text DEFAULT 'submitted' NOT NULL,
    updated_at text DEFAULT 'now' NOT NULL
  );
  CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL
  );
  CREATE TABLE customer_project_contact_releases (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    quote_id text NOT NULL,
    opportunity_match_id text NOT NULL,
    customer_uid text NOT NULL,
    installer_uid text NOT NULL,
    status text NOT NULL
  )`);
  beforeMigrations?.(db);
  for (const statement of `${migration}\n--> statement-breakpoint\n${submissionMigration}\n--> statement-breakpoint\n${acceptanceMigration}`
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  return db;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("0089 through 0091 add durable activity, submission and acceptance ledgers", () => {
  const db = applyActivityMigration();
  const quoteColumns = db.prepare(
    "PRAGMA table_info(customer_project_quotes)",
  ).all().map((row) => row.name);
  assert.ok(quoteColumns.includes("submission_request_id"));
  assert.ok(quoteColumns.includes("submission_revision"));

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map((row) => row.name);
  for (const name of [
    "customer_project_activity_events",
    "customer_project_activity_deliveries",
    "customer_project_activity_delivery_events",
    "customer_project_quote_submissions",
    "customer_project_quote_acceptance_claims",
  ]) {
    assert.ok(tables.includes(name));
    assert.match(schema, new RegExp(`sqliteTable\\("${name}"`));
  }

  const indexes = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index'",
  ).all().map((row) => row.name));
  for (const name of [
    "customer_project_activity_events_key_idx",
    "customer_project_activity_deliveries_event_idx",
    "customer_project_activity_deliveries_idempotency_idx",
    "customer_project_activity_deliveries_provider_message_idx",
    "customer_project_activity_delivery_events_provider_idx",
    "customer_project_quote_submissions_request_idx",
    "customer_project_quote_submissions_revision_idx",
    "customer_project_quote_acceptance_claims_quote_idx",
    "customer_project_quote_acceptance_claims_owner_idx",
  ]) {
    assert.ok(indexes.has(name), `${name} must be applied`);
  }
  assert.throws(
    () => db.prepare(`INSERT INTO customer_project_quote_submissions
      (id, opportunity_match_id, installer_uid, submission_request_id, quote_id,
       submission_revision, quote_snapshot, submitted_at, created_at)
      VALUES ('invalid', 'match', 'installer', 'request', 'quote', 0, '{}', 'now', 'now')`).run(),
    /constraint/i,
  );
  db.close();
});

test("0091 backfills an accepted quote after its exact release was withdrawn", () => {
  const db = applyActivityMigration((database) => {
    database.prepare(
      "INSERT INTO customer_projects (id, firebase_uid) VALUES ('project', 'customer')",
    ).run();
    database.prepare(`INSERT INTO customer_project_quotes
      (id, opportunity_match_id, installer_uid, project_id, customer_decision,
       status, updated_at)
      VALUES ('quote', 'match', 'installer', 'project', 'accepted', 'submitted', 'accepted-at')`).run();
    database.prepare(`INSERT INTO customer_project_contact_releases
      (id, project_id, quote_id, opportunity_match_id, customer_uid, installer_uid, status)
      VALUES ('release', 'project', 'quote', 'match', 'customer', 'installer', 'withdrawn')`).run();
  });
  assert.deepEqual(
    { ...db.prepare(`SELECT project_id, quote_id, contact_release_id
      FROM customer_project_quote_acceptance_claims`).get() },
    { project_id: "project", quote_id: "quote", contact_release_id: "release" },
  );
  db.close();
});

test("activity identities are deterministic, audience bound and free of recipient addresses", async () => {
  const eventKey = "platform-quote-submitted:match-1:request-1";
  const customer = await customerProjectActivityIdentity(eventKey, "customer");
  assert.deepEqual(
    customer,
    await customerProjectActivityIdentity(eventKey, "customer"),
  );
  const installer = await customerProjectActivityIdentity(eventKey, "installer");
  assert.equal(customer.eventId, installer.eventId);
  assert.notEqual(customer.deliveryId, installer.deliveryId);
  assert.notEqual(customer.idempotencyKey, installer.idempotencyKey);
  for (const value of Object.values(customer)) {
    assert.equal(value.length, 64);
  }

  const emailHash = await customerProjectActivityEmailHash(
    "Person+Quote@Example.com ",
  );
  assert.equal(
    emailHash,
    await customerProjectActivityEmailHash("person+quote@example.com"),
  );
  assert.doesNotMatch(emailHash, /person|quote|example/i);
});

test("customer and installer emails are bounded, actionable and exclude private contact data", () => {
  const customer = customerProjectActivityDraft({
    eventType: "installer_quote_submitted",
    audience: "customer",
    businessName: `Example <script>alert("x")</script> Energy`,
  });
  assert.match(customer.subject, /installer quote is ready/i);
  assert.match(customer.body, /structured quote for your home project/i);
  assert.match(customer.body, new RegExp(escapePattern(CUSTOMER_QUOTE_INBOX_URL)));
  assert.match(customer.html, /Example &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; Energy/);
  assert.doesNotMatch(customer.html, /<script>alert/);

  const installer = customerProjectActivityDraft({
    eventType: "customer_installer_accepted",
    audience: "installer",
  });
  assert.match(installer.subject, /customer wants to get in touch/i);
  assert.doesNotMatch(installer.body, /accepted your quote/i);
  assert.match(installer.body, /contact details are available only inside the signed-in lead/i);
  assert.match(installer.body, new RegExp(escapePattern(INSTALLER_LEAD_INBOX_URL)));

  for (const draft of [customer, installer]) {
    assert.ok(draft.subject.length <= 160);
    assert.ok(draft.body.length <= 1800);
    assert.ok(draft.html.length <= 12_000);
    assert.doesNotMatch(
      `${draft.body}\n${draft.html}`,
      /70 Southbank|0421731505|customer@example|3006|customer-photo\.jpg|NMI-123456|meter serial 9988|usage record 2026/i,
    );
  }
});

test("quote submission keeps one request identity through retries and atomically records its activity", () => {
  assert.match(quoteEditor, /const submissionRequestId = useRef\(""\)/);
  assert.match(quoteEditor, /const submissionExpectedRevision = useRef<number \| null>\(null\)/);
  assert.match(quoteEditor, /submissionRequestId\.current = crypto\.randomUUID\(\)/);
  assert.match(quoteEditor, /submissionRequestId: submissionRequestId\.current/);
  assert.match(quoteEditor, /expectedSubmissionRevision: submissionExpectedRevision\.current/);
  assert.match(quoteEditor, /submissionRequestId\.current = ""/);
  assert.match(quoteEditor, /applyAuthoritativeQuote\(authoritativeQuote\)/);

  assert.match(tradeOpportunities, /UUID_PATTERN\.test\(submissionRequestId\)/);
  assert.match(
    tradeOpportunities,
    /FROM customer_project_quote_submissions[\s\S]*installer_uid = \? AND opportunity_match_id = \? AND submission_request_id = \?/,
  );
  assert.match(tradeOpportunities, /replayed: true/);
  assert.match(
    tradeOpportunities,
    /expectedSubmissionRevision[\s\S]*QUOTE_REVISION_CHANGED/,
  );
  assert.match(
    tradeOpportunities,
    /WHERE customer_project_quotes\.installer_uid = excluded\.installer_uid[\s\S]*customer_project_quotes\.submission_revision = \?/,
  );
  assert.match(
    tradeOpportunities,
    /INSERT INTO customer_project_quote_submissions[\s\S]*COALESCE\(\([\s\S]*submission_request_id = \? AND submission_revision = \?/,
  );
  assert.match(
    tradeOpportunities,
    /eventKey: `platform-quote-submitted:\$\{matchId\}:\$\{submissionRequestId\}`/,
  );
  assert.match(tradeOpportunities, /eventType: "installer_quote_submitted"/);
  assert.match(tradeOpportunities, /audience: "customer"/);
  assert.match(
    tradeOpportunities,
    /await db\.batch\(\[[\s\S]*\.\.\.activity\.statements[\s\S]*\]\)/,
  );
  assert.match(
    tradeOpportunities,
    /return activityDispatchJson\([\s\S]*activity\.deliveryId\)/,
  );

  const replayCheck = tradeOpportunities.indexOf("if (replay)");
  const productSnapshot = tradeOpportunities.indexOf(
    "snapshot = await productSnapshot",
  );
  assert.ok(
    replayCheck > 0 && replayCheck < productSnapshot,
    "a retried request must return before quote rebuilding and notification enqueue",
  );
});

test("A, B and a late A replay keep B authoritative while stale new writes fail", () => {
  const db = applyActivityMigration();
  function submit(requestId, expectedRevision, total) {
    const replay = db.prepare(`SELECT 1 FROM customer_project_quote_submissions
      WHERE installer_uid = 'installer' AND opportunity_match_id = 'match'
        AND submission_request_id = ?`).get(requestId);
    if (replay) {
      return { replayed: true, total: db.prepare(
        "SELECT total_cents_ex_gst total FROM customer_project_quotes WHERE opportunity_match_id = 'match'",
      ).get().total };
    }
    db.exec("BEGIN");
    try {
      db.prepare(`INSERT INTO customer_project_quotes
        (id, opportunity_match_id, installer_uid, total_cents_ex_gst,
         submission_request_id, submission_revision)
        VALUES ('quote', 'match', 'installer', ?, ?, ?)
        ON CONFLICT(opportunity_match_id) DO UPDATE SET
          total_cents_ex_gst = excluded.total_cents_ex_gst,
          submission_request_id = excluded.submission_request_id,
          submission_revision = excluded.submission_revision
        WHERE customer_project_quotes.installer_uid = excluded.installer_uid
          AND customer_project_quotes.submission_revision = ?`)
        .run(total, requestId, expectedRevision + 1, expectedRevision);
      db.prepare(`INSERT INTO customer_project_quote_submissions
        (id, opportunity_match_id, installer_uid, submission_request_id, quote_id,
         submission_revision, quote_snapshot, submitted_at, created_at)
        VALUES (?, 'match', 'installer', ?, 'quote', COALESCE((
          SELECT submission_revision FROM customer_project_quotes
          WHERE opportunity_match_id = 'match' AND installer_uid = 'installer'
            AND submission_request_id = ? AND submission_revision = ?
        ), 0), '{}', 'now', 'now')`)
        .run(`ledger-${requestId}`, requestId, requestId, expectedRevision + 1);
      db.exec("COMMIT");
      return { replayed: false, total };
    } catch {
      db.exec("ROLLBACK");
      return {
        conflict: true,
        total: db.prepare(
          "SELECT total_cents_ex_gst total FROM customer_project_quotes WHERE opportunity_match_id = 'match'",
        ).get()?.total || 0,
      };
    }
  }

  assert.deepEqual(submit("A", 0, 100), { replayed: false, total: 100 });
  assert.deepEqual(submit("B", 1, 200), { replayed: false, total: 200 });
  assert.deepEqual(submit("A", 0, 100), { replayed: true, total: 200 });
  assert.deepEqual(submit("C", 1, 300), { conflict: true, total: 200 });
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM customer_project_quote_submissions").get().count,
    2,
  );
  db.close();
});

test("one project acceptance claim keeps the winning quote and contact release consistent", () => {
  const db = applyActivityMigration();
  db.prepare("INSERT INTO customer_projects (id, firebase_uid) VALUES ('project', 'customer')").run();
  for (const suffix of ["A", "B"]) {
    db.prepare(`INSERT INTO customer_project_quotes
      (id, opportunity_match_id, installer_uid, project_id, customer_decision,
       status, updated_at)
      VALUES (?, ?, ?, 'project', 'shortlisted', 'submitted', 'before')`)
      .run(`quote-${suffix}`, `match-${suffix}`, `installer-${suffix}`);
    db.prepare(`INSERT INTO customer_project_contact_releases
      (id, project_id, quote_id, opportunity_match_id, customer_uid, installer_uid, status)
      VALUES (?, 'project', ?, ?, 'customer', ?, 'active')`)
      .run(`release-${suffix}`, `quote-${suffix}`, `match-${suffix}`, `installer-${suffix}`);
  }

  function accept(quoteId, { stale = false } = {}) {
    if (!stale) {
      const existing = db.prepare(
        "SELECT quote_id FROM customer_project_quote_acceptance_claims WHERE project_id = 'project'",
      ).get();
      if (existing) return existing.quote_id === quoteId ? "replay" : "locked";
    }
    const suffix = quoteId.endsWith("A") ? "A" : "B";
    db.exec("BEGIN");
    try {
      db.prepare(`INSERT INTO customer_project_quote_acceptance_claims
        (project_id, customer_uid, quote_id, opportunity_match_id,
         contact_release_id, accepted_at, created_at)
        VALUES ('project', 'customer', COALESCE((
          SELECT candidate.id
          FROM customer_project_quotes candidate
          JOIN customer_project_contact_releases release
            ON release.project_id = candidate.project_id
            AND release.quote_id = candidate.id
            AND release.customer_uid = 'customer'
            AND release.status = 'active'
          WHERE candidate.id = ? AND candidate.project_id = 'project'
            AND candidate.customer_decision = 'shortlisted'
            AND NOT EXISTS (
              SELECT 1 FROM customer_project_quotes accepted
              WHERE accepted.project_id = candidate.project_id
                AND accepted.customer_decision = 'accepted'
            )
        ), ''), ?, ?, 'now', 'now')`)
        .run(quoteId, `match-${suffix}`, `release-${suffix}`);
      db.prepare(`UPDATE customer_project_quotes SET customer_decision = 'declined'
        WHERE project_id = 'project' AND id != ?`).run(quoteId);
      db.prepare(`UPDATE customer_project_contact_releases SET status = 'withdrawn'
        WHERE project_id = 'project' AND quote_id != ? AND status = 'active'`).run(quoteId);
      db.prepare(`UPDATE customer_project_quotes SET customer_decision = 'accepted'
        WHERE id = ? AND customer_decision = 'shortlisted'
          AND EXISTS (
            SELECT 1 FROM customer_project_quote_acceptance_claims
            WHERE project_id = 'project' AND customer_uid = 'customer' AND quote_id = ?
          )`).run(quoteId, quoteId);
      db.prepare(`INSERT INTO customer_project_activity_events
        (id, event_key, project_id, quote_id, opportunity_match_id, customer_uid,
         installer_uid, event_type, actor_type, actor_uid, summary, occurred_at, created_at)
        VALUES (?, ?, 'project', ?, ?, 'customer', ?, 'customer_installer_accepted',
          'customer', 'customer', 'accepted', 'now', 'now')`)
        .run(`event-${suffix}`, `accepted-${suffix}`, quoteId, `match-${suffix}`, `installer-${suffix}`);
      db.exec("COMMIT");
      return "accepted";
    } catch {
      db.exec("ROLLBACK");
      const winner = db.prepare(
        "SELECT quote_id FROM customer_project_quote_acceptance_claims WHERE project_id = 'project'",
      ).get();
      return winner?.quote_id === quoteId ? "replay" : "locked";
    }
  }

  const staleB = db.prepare(
    "SELECT customer_decision FROM customer_project_quotes WHERE id = 'quote-B'",
  ).get();
  assert.equal(staleB.customer_decision, "shortlisted");
  assert.equal(accept("quote-A"), "accepted");
  assert.equal(accept("quote-B", { stale: true }), "locked");
  assert.equal(accept("quote-A"), "replay");
  db.prepare(`UPDATE customer_project_contact_releases SET status = 'withdrawn'
    WHERE id = 'release-A'`).run();
  assert.equal(accept("quote-A"), "replay");

  for (const nextDecision of ["shortlisted", "declined"]) {
    const changed = db.prepare(`UPDATE customer_project_quotes
      SET customer_decision = ?
      WHERE id = 'quote-B'
        AND NOT EXISTS (
          SELECT 1 FROM customer_project_quote_acceptance_claims
          WHERE project_id = 'project' AND customer_uid = 'customer'
        )`).run(nextDecision);
    assert.equal(changed.changes, 0);
  }

  assert.deepEqual(
    db.prepare(`SELECT id, customer_decision decision
      FROM customer_project_quotes ORDER BY id`).all().map((row) => ({ ...row })),
    [
      { id: "quote-A", decision: "accepted" },
      { id: "quote-B", decision: "declined" },
    ],
  );
  assert.deepEqual(
    db.prepare(`SELECT quote_id, status FROM customer_project_contact_releases
      ORDER BY quote_id`).all().map((row) => ({ ...row })),
    [
      { quote_id: "quote-A", status: "withdrawn" },
      { quote_id: "quote-B", status: "withdrawn" },
    ],
  );
  assert.deepEqual(
    db.prepare("SELECT quote_id FROM customer_project_activity_events").all()
      .map((row) => ({ ...row })),
    [{ quote_id: "quote-A" }],
  );
  db.close();
});

test("exact opportunity targeting validates one match id and remains owner scoped", () => {
  assert.match(tradeOpportunities, /searchParams\.getAll\("matchId"\)/);
  assert.match(tradeOpportunities, /matchParameters\.length > 1/);
  assert.match(tradeOpportunities, /UUID_PATTERN\.test\(matchParameters\[0\]\.trim\(\)\)/);
  assert.match(
    tradeOpportunities,
    /WHERE m\.firebase_uid = \? AND \(\? = '' OR m\.id = \?\)/,
  );
  assert.match(
    tradeOpportunities,
    /JOIN trade_opportunity_matches m ON m\.opportunity_id = p\.opportunity_id AND m\.firebase_uid = \?[\s\S]*AND \(\? = '' OR m\.id = \?\)/,
  );
  assert.match(
    tradeOpportunities,
    /\.bind\(user\.uid, requestedMatchId, requestedMatchId\)/,
  );
});

test("chosen installer contact activity and release are deterministic in one batch", () => {
  assert.match(
    customerProjects,
    /decision === "accepted"[\s\S]*quote\.customer_decision === "accepted"[\s\S]*return json\(\{ ok: true/,
  );
  assert.match(
    customerProjects,
    /if \(quote\.customer_decision === "accepted"\)[\s\S]*already connected/,
  );
  assert.match(customerProjects, /confirmInstallerContact/);
  assert.match(
    customerProjects,
    /INSERT INTO customer_project_contact_releases[\s\S]*INSERT INTO customer_project_quote_acceptance_claims/,
  );
  assert.match(customerProjects, /customer_project_quote_acceptance_claims/);
  assert.match(
    customerProjects,
    /INSERT INTO customer_project_quote_acceptance_claims[\s\S]*candidate\.customer_decision IN \('reviewing', 'shortlisted'\)/,
  );
  assert.match(
    customerProjects,
    /SET customer_decision = 'accepted'[\s\S]*customer_decision IN \('reviewing', 'shortlisted'\)/,
  );
  assert.match(
    customerProjects,
    /NOT EXISTS \([\s\S]*FROM customer_project_quote_acceptance_claims claim[\s\S]*claim\.project_id = \? AND claim\.customer_uid = \?/,
  );
  assert.match(
    customerProjects,
    /decisionResults\[decisionMutationIndex\]\?\.meta\.changes/,
  );
  assert.match(
    customerProjects,
    /eventKey: `platform-installer-accepted:\$\{quoteId\}`/,
  );
  assert.match(customerProjects, /eventType: "customer_installer_accepted"/);
  assert.match(customerProjects, /audience: "installer"/);
  assert.match(
    customerProjects,
    /statements\.push\(\.\.\.acceptanceActivity\.statements\)/,
  );

  const activityPush = customerProjects.indexOf(
    "statements.push(...acceptanceActivity.statements)",
  );
  const acceptanceBatch = customerProjects.indexOf(
    "await db.batch(statements)",
    activityPush,
  );
  assert.ok(
    activityPush > 0 && acceptanceBatch > activityPush,
    "acceptance state and its activity event must share one D1 batch",
  );
  assert.match(
    customerProjects,
    /return activityDeliveryId[\s\S]*activityDispatchJson\(responseBody, activityDeliveryId\)/,
  );
});

test("activity delivery rechecks recipient consent and preserves exact retry payloads", () => {
  for (const boundary of [
    "account_updates",
    "customer_account_consent",
    "customer_email_opted_out",
    "email_opportunities",
    "installer_consent_at",
    "installer_access_approved",
    "contact_release_status",
    "trade_opportunity_email_suppressions",
  ]) {
    assert.match(activityServer, new RegExp(escapePattern(boundary)));
  }
  assert.match(activityServer, /previousAttempts > 0/);
  assert.match(activityServer, /storedEmailHash !== emailHash/);
  assert.match(activityServer, /storedSubject/);
  assert.match(activityServer, /storedBody/);
  assert.match(activityServer, /storedHtml/);
  assert.match(
    activityServer,
    /WHERE id = \? AND status = \? AND attempts = \?/,
  );
  assert.match(activityServer, /messageType: "customer_project_activity"/);
  assert.match(activityServer, /serviceReminderRetryAt\(attempts\)/);
});

test("worker strips the activity header, dispatches immediately and retains the minute drain", () => {
  assert.match(
    activityServer,
    /CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER[\s\S]*X-AEA-Customer-Project-Activity-Dispatch/,
  );
  assert.match(worker, /function queueCustomerProjectActivityDispatch/);
  assert.match(
    worker,
    /headers\.delete\(CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER\)/,
  );
  assert.match(
    worker,
    /ctx\.waitUntil\([\s\S]*drainCustomerProjectActivityDeliveries\(\{ deliveryId \}\)/,
  );
  assert.match(worker, /queueBackgroundDispatches\(handled, ctx, request\)/);
  assert.match(worker, /const NOTIFICATION_DELIVERY_CRON = "\* \* \* \* \*"/);
  assert.match(
    worker,
    /controller\.cron === NOTIFICATION_DELIVERY_CRON[\s\S]*drainCustomerProjectActivityDeliveries\(\)/,
  );
});

test("authenticated Resend callbacks update the activity ledger and recipient suppressions", () => {
  assert.match(resendCallback, /verifyResendWebhook/);
  assert.match(
    resendCallback,
    /FROM customer_project_activity_deliveries[\s\S]*provider_message_id = \?/,
  );
  assert.match(
    resendCallback,
    /customer_project_activity_delivery_events/,
  );
  assert.match(
    resendCallback,
    /WHEN status IN \('bounced', 'complained', 'opted_out', 'suppressed'\) THEN status/,
  );
  assert.match(
    resendCallback,
    /activityDelivery\?\.audience === "customer"[\s\S]*customer_service_reminder_opt_outs/,
  );
  assert.match(
    resendCallback,
    /activityDelivery\?\.audience === "installer"[\s\S]*trade_opportunity_email_suppressions/,
  );
  assert.match(
    resendCallback,
    /UPDATE customer_project_activity_deliveries[\s\S]*status = 'suppressed'/,
  );
});

test("chosen platform businesses enter the trade queue and open the exact lead", () => {
  assert.match(tradeNotificationsRoute, /customer_project_activity_events/);
  assert.match(
    tradeNotificationsRoute,
    /event\.installer_uid = \?[\s\S]*event\.event_type = 'customer_installer_accepted'/,
  );
  assert.match(
    tradeNotificationsRoute,
    /quote\.customer_decision = 'accepted'/,
  );
  assert.match(
    tradeNotificationsRoute,
    /release\.status = 'active'/,
  );
  assert.match(tradeNotificationsRoute, /Customer wants to get in touch/);
  assert.match(tradeNotificationsRoute, /targetKind: "opportunity"/);
  assert.match(
    tradeNotificationsRoute,
    /targetId: String\(row\.opportunity_match_id\)/,
  );
  assert.match(
    tradeNotificationsUi,
    /item\.targetKind === "opportunity"[\s\S]*onOpenOpportunity\(item\.targetId\)/,
  );
  assert.match(
    tradeDashboard,
    /onOpenOpportunity=\{\(matchId\) => void openOpportunityNotification\(matchId\)\}/,
  );
  assert.match(tradeDashboard, /setWorkspace\("leads"\)/);
  assert.match(
    tradeDashboard,
    /document\.getElementById\([\s\S]*`opportunity-\$\{focusedOpportunityMatchId\}`/,
  );
  assert.match(
    tradeDashboard,
    /id=\{`opportunity-\$\{opportunity\.matchId\}`\}[\s\S]*tabIndex=\{-1\}/,
  );
});
