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

test("customer photo completion powers an unread installer review queue", () => {
  assert.match(route, /trade_crm_photo_request_completions/);
  assert.match(route, /trade_job_notification_reads/);
  assert.match(route, /customer-photos-ready:/);
  assert.match(route, /requireInstallerTeamAccess/);
  assert.match(notifications, /60_000/);
  assert.match(notifications, /unread job updates/);
  assert.match(notifications, /jobTab: "field"/);
  assert.match(dashboard, /<TradeJobNotifications/);
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
  assert.match(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{focusedJobTab\}`\}/);
  assert.match(crm, /key=\{selectedJobDetail\.id\}/);
  assert.doesNotMatch(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{focusedJobTab\}:\$\{refreshNonce\}`\}/);
  assert.doesNotMatch(crm, /key=\{`\$\{selectedJobDetail\.id\}:\$\{refreshNonce\}`\}/);
  assert.match(fieldPanel, /await refreshAfterReview\(\)/);
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
