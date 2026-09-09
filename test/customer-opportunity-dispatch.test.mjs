import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0088_customer_opportunity_dispatch_jobs.sql");
const schema = read("../db/schema.ts");
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
