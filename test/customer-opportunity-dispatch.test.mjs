import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0088_customer_opportunity_dispatch_jobs.sql");
const schema = read("../db/schema.ts");
const customerRoute = read("../src/app/api/customer-projects/route.ts");
const dispatchServer = read("../src/lib/customer-opportunity-dispatch-server.ts");
const deliveryServer = read("../src/lib/opportunity-notification-server.ts");
const worker = read("../worker/index.ts");

test("customer dispatch jobs are additive, unique per opportunity and retry indexed", () => {
  assert.match(schema, /sqliteTable\("customer_opportunity_dispatch_jobs"/);
  assert.match(migration, /CREATE TABLE `customer_opportunity_dispatch_jobs`/);
  assert.match(migration, /customer_opportunity_dispatch_jobs_opportunity_idx/);
  assert.match(migration, /customer_opportunity_dispatch_jobs_status_idx/);
  const db = new DatabaseSync(":memory:");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  const now = "2026-07-31T00:00:00.000Z";
  db.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
    (id, opportunity_id, admin_notification_id, status, attempts, next_attempt_at,
     claimed_at, completed_at, failed_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?)`)
    .run("job-1", "opportunity-1", "notification-1", now, now);
  assert.throws(() => db.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
    (id, opportunity_id, admin_notification_id, status, attempts, next_attempt_at,
     claimed_at, completed_at, failed_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, '', '', '', '', '', ?, ?)`)
    .run("job-2", "opportunity-1", "notification-2", now, now));
  db.close();
});

test("an explicit active submit retry revives exhausted jobs but preserves terminal or in-flight jobs", () => {
  const retryBranch = customerRoute.slice(
    customerRoute.indexOf("if (activeSubmitRetry)"),
    customerRoute.indexOf("const stored = {", customerRoute.indexOf("if (activeSubmitRetry)")),
  );
  const retrySql = retryBranch.match(
    /db\.prepare\(`(INSERT INTO customer_opportunity_dispatch_jobs[\s\S]*?updated_at = excluded\.updated_at)`\)/,
  )?.[1];
  assert.ok(retrySql, "active submit retry dispatch upsert must remain extractable");
  const db = new DatabaseSync(":memory:");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY,
    firebase_uid text NOT NULL,
    status text NOT NULL,
    opportunity_id text NOT NULL
  );`);
  db.prepare(`INSERT INTO customer_projects
    (id, firebase_uid, status, opportunity_id)
    VALUES ('project-1', 'customer-1', 'matching', 'opportunity-1')`).run();
  db.prepare(`INSERT INTO customer_opportunity_dispatch_jobs
    (id, opportunity_id, admin_notification_id, status, attempts, next_attempt_at,
     claimed_at, completed_at, failed_at, last_error, created_at, updated_at)
    VALUES ('job-1', 'opportunity-1', 'notification-old', 'failed', 5, 'future',
      'claimed', 'completed', 'failed', 'exhausted', 'created', 'updated')`).run();
  const requeue = db.prepare(retrySql);
  const bindRequeue = (notificationId, now) => requeue.run(
    "job-1",
    "opportunity-1",
    notificationId,
    now,
    now,
    "project-1",
    "customer-1",
    "opportunity-1",
  );
  bindRequeue("notification-requeued", "requeued");
  const readJob = () => ({
    ...db.prepare(`SELECT status, attempts, next_attempt_at, claimed_at,
      completed_at, failed_at, last_error, admin_notification_id
      FROM customer_opportunity_dispatch_jobs WHERE id = 'job-1'`).get(),
  });
  assert.deepEqual(readJob(), {
    status: "pending",
    attempts: 0,
    next_attempt_at: "",
    claimed_at: "",
    completed_at: "",
    failed_at: "",
    last_error: "",
    admin_notification_id: "notification-requeued",
  });
  for (const protectedStatus of ["completed", "processing"]) {
    db.prepare(`UPDATE customer_opportunity_dispatch_jobs
      SET status = ?, attempts = 4, next_attempt_at = 'protected-next',
        claimed_at = 'protected-claim', completed_at = 'protected-complete',
        failed_at = 'protected-fail', last_error = 'protected-error'
      WHERE id = 'job-1'`).run(protectedStatus);
    bindRequeue(`notification-${protectedStatus}`, `updated-${protectedStatus}`);
    assert.deepEqual(readJob(), {
      status: protectedStatus,
      attempts: 4,
      next_attempt_at: "protected-next",
      claimed_at: "protected-claim",
      completed_at: "protected-complete",
      failed_at: "protected-fail",
      last_error: "protected-error",
      admin_notification_id: `notification-${protectedStatus}`,
    });
  }
  db.close();
});

test("submit atomically queues dispatch and returns a compact mergeable acknowledgement", () => {
  assert.match(customerRoute, /INSERT INTO customer_opportunity_dispatch_jobs/);
  assert.match(customerRoute, /adminNotificationStatement\(db,[\s\S]*adminNotificationId\)/);
  assert.match(customerRoute, /dispatchJson\(\{[\s\S]*project: \{[\s\S]*status: "matching"/);
  assert.match(customerRoute, /dispatch: \{ status: "queued" \}/);
  assert.doesNotMatch(customerRoute, /await allocateNearestInstallers/);
  const submitBlock = customerRoute.slice(
    customerRoute.indexOf('action === "submit"'),
    customerRoute.indexOf('action === "release_contact"'),
  );
  assert.doesNotMatch(submitBlock, /projectsForOwner/);
});

test("submit sharing promotes only active images with one immutable event per photo", () => {
  assert.match(customerRoute, /action === "share_all_photos"/);
  assert.match(customerRoute, /confirmAllProjectPhotoSharing/);
  assert.doesNotMatch(customerRoute, /raw\.confirmInstallerPhotoSharing/);
  assert.match(customerRoute, /LOWER\(content_type\) LIKE 'image\/%'/);
  assert.match(customerRoute, /'shared_with_allocated_installers'/);
  assert.match(customerRoute, /'installer-photo-share:' \|\| id \|\| ':' \|\| revision/);
  assert.match(customerRoute, /SET sharing_scope = 'allocated-installers', revision = revision \+ 1/);
  assert.match(customerRoute, /privatePhotoCount > 0 \|\| !evidenceConsent/);
  assert.match(customerRoute, /notice_version = \?/);
  const sharingHelper = customerRoute.slice(
    customerRoute.indexOf("function projectPhotoSharingStatements"),
    customerRoute.indexOf("function planRevisionConflict"),
  );
  assert.equal(
    sharingHelper.match(/AND updated_at <= \?/g)?.length,
    3,
    "event, promotion and consent must share only the confirmed request-time photo set",
  );
  assert.doesNotMatch(customerRoute, /LOWER\(content_type\) LIKE 'application\/pdf'/);
});

test("the submitted sharing SQL leaves documents private and records each promoted photo", () => {
  const eventSql = customerRoute.match(
    /db\.prepare\(`(INSERT OR IGNORE INTO customer_project_evidence_events[\s\S]*?sharing_scope <> 'allocated-installers')`\)/,
  )?.[1];
  const updateSql = customerRoute.match(
    /db\.prepare\(`(UPDATE customer_project_evidence[\s\S]*?sharing_scope <> 'allocated-installers')`\)/,
  )?.[1];
  assert.ok(eventSql && updateSql);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_project_evidence (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    customer_uid text NOT NULL,
    content_type text NOT NULL,
    sharing_scope text NOT NULL,
    revision integer NOT NULL,
    status text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE customer_project_evidence_events (
    id text PRIMARY KEY,
    evidence_id text NOT NULL,
    project_id text NOT NULL,
    customer_uid text NOT NULL,
    installer_uid text NOT NULL,
    actor_type text NOT NULL,
    actor_uid text NOT NULL,
    event_type text NOT NULL,
    created_at text NOT NULL
  );`);
  const insert = db.prepare(`INSERT INTO customer_project_evidence
    (id, project_id, customer_uid, content_type, sharing_scope, revision, status, updated_at)
    VALUES (?, 'project-1', 'customer-1', ?, ?, 1, 'active', '')`);
  insert.run("photo-private", "image/jpeg", "private-plan");
  insert.run("photo-shared", "image/png", "allocated-installers");
  insert.run("photo-newer", "image/webp", "private-plan");
  insert.run("document-private", "application/pdf", "private-plan");
  const now = "2026-07-31T00:00:00.000Z";
  db.prepare("UPDATE customer_project_evidence SET updated_at = ? WHERE id = ?")
    .run("2026-07-31T00:00:01.000Z", "photo-newer");
  db.prepare(eventSql).run("customer-1", now, "project-1", "customer-1", now);
  db.prepare(updateSql).run(now, "project-1", "customer-1", now);
  assert.deepEqual(
    db.prepare("SELECT id, sharing_scope scope, revision FROM customer_project_evidence ORDER BY id")
      .all()
      .map((item) => ({ ...item })),
    [
      { id: "document-private", scope: "private-plan", revision: 1 },
      { id: "photo-newer", scope: "private-plan", revision: 1 },
      { id: "photo-private", scope: "allocated-installers", revision: 2 },
      { id: "photo-shared", scope: "allocated-installers", revision: 1 },
    ],
  );
  assert.deepEqual(
    db.prepare("SELECT evidence_id, event_type FROM customer_project_evidence_events")
      .all()
      .map((item) => ({ ...item })),
    [{
      evidence_id: "photo-private",
      event_type: "shared_with_allocated_installers",
    }],
  );
  db.close();
});

test("the worker removes the private dispatch signal and starts exact background work", () => {
  assert.match(worker, /headers\.delete\(CUSTOMER_OPPORTUNITY_DISPATCH_HEADER\)/);
  assert.match(worker, /ctx\.waitUntil\([\s\S]*drainCustomerOpportunityDispatchJobs\(\{ jobId \}\)/);
  assert.match(worker, /drainCustomerOpportunityDispatchJobs\(\)/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON/);
});

test("dispatch is recoverable, idempotent and attempts both exact notification queues", () => {
  assert.match(dispatchServer, /Recovered an interrupted dispatch attempt/);
  assert.match(dispatchServer, /WHERE id = \? AND status = \? AND attempts = \?/);
  assert.match(dispatchServer, /attempts < \?/);
  const adminIndex = dispatchServer.indexOf("dispatchAdminNotificationDeliveries({");
  const allocationIndex = dispatchServer.indexOf("await allocateNearestInstallers(");
  const tradeIndex = dispatchServer.indexOf("drainOpportunityNotificationDeliveries({");
  assert.ok(adminIndex >= 0 && allocationIndex > adminIndex && tradeIndex > allocationIndex);
  assert.match(dispatchServer, /notificationId: row\.admin_notification_id/);
  assert.match(dispatchServer, /opportunityId: row\.opportunity_id/);
  assert.match(dispatchServer, /Number\(adminOutcome\.result\?\.failed \|\| 0\) > 0/);
  assert.match(dispatchServer, /Number\(tradeOutcome\.failed \|\| 0\) > 0/);
  assert.match(dispatchServer, /throw new Error\(deliveryFailures\.join\(" "\)\)/);
  assert.match(dispatchServer, /SET status = 'failed'[\s\S]*next_attempt_at = \?/);
  assert.match(dispatchServer, /SET status = 'completed'/);
});

test("a future-due exact notification remains outstanding and prevents false completion", () => {
  const helper = dispatchServer.slice(
    dispatchServer.indexOf("async function outstandingNotificationCounts"),
    dispatchServer.indexOf("async function recoverInterruptedJobs"),
  );
  const statements = [...helper.matchAll(/db\.prepare\(`([\s\S]*?)`\)/g)]
    .map((match) => match[1]);
  assert.equal(statements.length, 2);
  assert.doesNotMatch(helper, /next_attempt_at/);
  assert.match(
    dispatchServer,
    /const outstanding = await outstandingNotificationCounts\(row\);[\s\S]*outstanding\.admin > 0 \|\| outstanding\.trade > 0[\s\S]*throw new Error/,
  );
  assert.match(dispatchServer, /const delayMinutes = \[5, 30, 120, 360, 720\]/);
  const pendingCheck = dispatchServer.indexOf(
    "const outstanding = await outstandingNotificationCounts(row);",
  );
  const completion = dispatchServer.indexOf("SET status = 'completed'");
  assert.ok(pendingCheck >= 0 && completion > pendingCheck);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE admin_notification_deliveries (
    notification_id text NOT NULL,
    status text NOT NULL,
    next_attempt_at text NOT NULL
  );
  CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY,
    opportunity_id text NOT NULL
  );
  CREATE TABLE trade_opportunity_notification_deliveries (
    match_id text NOT NULL,
    status text NOT NULL,
    next_attempt_at text NOT NULL
  );`);
  db.prepare(`INSERT INTO admin_notification_deliveries
    (notification_id, status, next_attempt_at)
    VALUES ('notification-1', 'failed', '2099-01-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id) VALUES ('match-1', 'opportunity-1')`).run();
  db.prepare(`INSERT INTO trade_opportunity_notification_deliveries
    (match_id, status, next_attempt_at)
    VALUES ('match-1', 'failed', '2099-01-01T00:00:00.000Z')`).run();
  assert.equal(Number(db.prepare(statements[0]).get("notification-1").count), 1);
  assert.equal(Number(db.prepare(statements[1]).get("opportunity-1").count), 1);
  db.close();
});

test("opportunity email remains eligible through active match states only", () => {
  assert.match(
    deliveryServer,
    /\["offered", "viewed", "interested", "connected"\]\.includes/,
  );
  assert.match(
    deliveryServer,
    /current_match\.status IN \('offered', 'viewed', 'interested', 'connected'\)/,
  );
  for (const boundary of [
    "current_opportunity.status = 'open'",
    "current_account.email_opportunities = 1",
    "current_account.consent_at <> ''",
    "trade_opportunity_email_suppressions",
    "verifiedTradeAccountPredicate",
  ]) {
    assert.match(deliveryServer, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("new dispatch sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(
    `${migration}\n${customerRoute}\n${dispatchServer}\n${deliveryServer}\n${worker}`,
    /[\u2013\u2014]/,
  );
});
