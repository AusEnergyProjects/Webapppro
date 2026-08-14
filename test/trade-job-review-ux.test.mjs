import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0077_trade_job_notification_reads.sql");
const schema = read("../db/schema.ts");
const route = read("../src/app/api/trade-job-notifications/route.ts");
const notifications = read("../src/components/TradeJobNotifications.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const fieldPanel = read("../src/components/TradeFieldWorkPanel.tsx");
const invoiceStep = read("../src/components/TradeQuickInvoiceStep.tsx");
const invoicePanel = read("../src/components/TradeQuickInvoicePanel.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const comparator = read("../public/electricity-comparator.html");
const comparePage = read("../src/app/compare/page.tsx");
const globalStyles = read("../src/app/globals.css");

test("job notification read receipts are owner scoped and durable", () => {
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const columns = db.prepare("PRAGMA table_info(trade_job_notification_reads)").all().map((row) => row.name);
  for (const name of ["firebase_uid", "notification_key", "read_by_uid", "read_at"]) assert.ok(columns.includes(name));
  const indexes = db.prepare("PRAGMA index_list(trade_job_notification_reads)").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_job_notification_reads_actor_key_idx"));
  assert.match(schema, /tradeJobNotificationReads/);
});

test("customer and field activity powers one unread installer review queue", () => {
  assert.match(route, /trade_crm_photo_request_completions/);
  for (const source of ["trade_crm_quote_questions", "trade_crm_quote_acceptances", "trade_crm_quote_events", "trade_crm_appointment_reschedule_events", "trade_work_order_events", "trade_crm_signoffs"]) {
    assert.match(route, new RegExp(source));
  }
  assert.match(route, /trade_job_notification_reads/);
  assert.match(route, /customer-photos-ready:/);
  assert.match(route, /quote-question:/);
  assert.match(route, /quote-decision:/);
  assert.match(route, /Quote accepted/);
  assert.doesNotMatch(route, /trade_crm_payment_events|Customer payment received/);
  assert.match(route, /Field job completed/);
  assert.match(route, /requireInstallerTeamAccess/);
  assert.match(route, /current\.items\.some\(\(item\) => item\.id === notificationKey\)/);
  assert.match(notifications, /30_000/);
  assert.match(notifications, /unread work updates/);
  assert.match(notifications, /jobTab: item\.targetTab/);
  assert.match(notifications, /ref=\{triggerRef\}/);
  assert.match(
    notifications,
    /ref=\{dialogRef\} tabIndex=\{-1\}[\s\S]*role="dialog"/,
  );
  assert.match(
    notifications,
    /requestAnimationFrame\(\(\) => dialogRef\.current\?\.focus\(\)\)/,
  );
  assert.match(
    notifications,
    /const closeNotifications = useCallback\(\(\) => \{[\s\S]*triggerRef\.current\?\.focus\(\)/,
  );
  assert.match(
    notifications,
    /tabIndex=\{-1\} aria-hidden="true" className="tlink-notification-dismiss"/,
  );
  assert.match(dashboard, /<TradeJobNotifications/);
});

test("newly allocated leads enter the owner scoped unread work queue without household details", () => {
  const queryMatch = route.match(
    /db\.prepare\(`(SELECT assignment\.id opportunity_match_id, assignment\.matched_at[\s\S]*?ORDER BY assignment\.matched_at DESC LIMIT 80)`\)\s*\.bind\(access\.ownerUid\)/,
  );
  assert.ok(queryMatch, "the allocated lead query must remain identifiable and owner scoped");
  assert.match(route, /access\.canViewQuotes && scope\.scope === "team" \? db\.prepare/);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL,
    status text NOT NULL
  );
  CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL,
    firebase_uid text NOT NULL,
    status text NOT NULL,
    matched_at text NOT NULL
  );`);
  db.prepare("INSERT INTO trade_opportunities (id, status) VALUES (?, ?)").run("open-lead", "open");
  db.prepare("INSERT INTO trade_opportunities (id, status) VALUES (?, ?)").run("closed-lead", "closed");
  const insert = db.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_at) VALUES (?, ?, ?, ?, ?)`);
  insert.run("owner-match", "open-lead", "owner-a", "offered", "2026-07-31T00:03:00.000Z");
  insert.run("other-owner-match", "open-lead", "owner-b", "offered", "2026-07-31T00:02:00.000Z");
  insert.run("closed-match", "closed-lead", "owner-a", "offered", "2026-07-31T00:01:00.000Z");

  assert.deepEqual(db.prepare(queryMatch[1]).all("owner-a").map((row) => ({ ...row })), [{
    opportunity_match_id: "owner-match",
    matched_at: "2026-07-31T00:03:00.000Z",
  }]);
  db.close();

  assert.match(route, /id: `platform-lead-allocated:\$\{String\(row\.opportunity_match_id\)\}`/);
  assert.match(route, /title: "New lead ready to review"/);
  assert.match(route, /summary: "A new privacy-safe customer enquiry is ready in your Leads workspace\."/);
  assert.match(route, /targetKind: "opportunity" as const,[\s\S]*targetId: String\(row\.opportunity_match_id\)/);
});

test("private job files preview in place and retain an explicit download action", () => {
  assert.match(fieldRoute, /url\.searchParams\.get\("preview"\)/);
  assert.match(fieldRoute, /previewId \? "inline" : "attachment"/);
  assert.match(fieldPanel, /openPreview/);
  assert.match(fieldPanel, /crm-preview-dialog/);
  assert.match(fieldPanel, /application\/pdf/);
  assert.match(fieldPanel, /download=\{preview\.item\.fileName\}/);
  assert.doesNotMatch(fieldPanel, />Open<\/button>/);
});

test("job data refreshes preserve the active job tab", () => {
  assert.match(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{focusedJobTab\}:\$\{selectedJobDetail\.assigneeMemberId\}`\}/);
  assert.equal((crm.match(/<JobDetail key=/g) || []).length, 1);
  assert.doesNotMatch(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{focusedJobTab\}:\$\{refreshNonce\}`\}/);
  assert.doesNotMatch(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{refreshNonce\}`\}/);
  assert.match(fieldPanel, /await refreshAfterReview\(\)/);
  assert.match(crm, /const handleFocus = \(\) => refreshFocusedJob\(true\)/);
  assert.match(crm, /const handleVisibilityChange = \(\) => refreshFocusedJob\(true\)/);
  assert.match(crm, /window\.setInterval\(\(\) => refreshFocusedJob\(\), 30_000\)/);
  assert.match(crm, /if \(failClosed\) setFocusedJobRefreshing\(true\)/);
  assert.match(crm, /refreshing=\{focusedJobRefreshing\}/);
  assert.match(crm, /const bookingControlsBlocked = refreshing \|\| assignmentBusy/);
  assert.match(crm, /navigationTarget\.kind === "job"[\s\S]*setFocusedJobRefreshing\(true\)[\s\S]*setRefreshNonce\(\(value\) => value \+ 1\)/);
});

test("both quick invoice send paths require a visible preview confirmation", () => {
  for (const source of [invoiceStep, invoicePanel]) {
    assert.match(source, /crm-invoice-preview-dialog/);
    assert.match(source, /Check before sending/);
    assert.match(source, /Confirm and send/);
  }
  assert.match(invoiceStep, /Preview invoice and finish/);
  assert.match(invoicePanel, /Preview and send invoice/);
});

test("the compatibility comparator uses local system typography consistently", () => {
  assert.doesNotMatch(comparator, /fonts\.googleapis\.com/);
  assert.match(comparator, /body\{font-family:Arial,Helvetica,sans-serif/);
  assert.match(comparator, /h1,h2,h3\{font-family:Arial,Helvetica,sans-serif/);
  assert.doesNotMatch(comparator, /font-family:'Arvo'/);
  assert.match(comparePage, /electricity-comparison-page/);
  assert.match(globalStyles, /\.electricity-comparison-page h2,[\s\S]*font-family: Arial, Helvetica, sans-serif/);
});

test("new review flow copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${notifications}\n${fieldPanel}\n${invoiceStep}\n${invoicePanel}`, /[\u2013\u2014]/);
});
