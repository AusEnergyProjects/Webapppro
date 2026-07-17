import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { daysUntilIsoDate, serviceFollowUpDueState, serviceFollowUpReadiness, serviceReminderDraft } from "../src/lib/trade-service-follow-ups.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0052_service_follow_up_preparation.sql");
const route = read("../src/app/api/trade-service-follow-ups/route.ts");
const ui = read("../src/components/TradeServiceFollowUpWorkspace.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const teamPortal = read("../src/components/TradeTeamPortal.tsx");
const lifecycleRoute = read("../src/app/api/trade-asset-lifecycle/route.ts");
const customerLifecycleRoute = read("../src/app/api/customer-asset-lifecycle/route.ts");
const customerLifecycleUi = read("../src/components/CustomerAssetLifecycle.tsx");

test("due states and reminder windows are deterministic", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  assert.equal(daysUntilIsoDate("2026-07-17", now), 0);
  assert.equal(serviceFollowUpDueState("2026-07-16", now), "overdue");
  assert.equal(serviceFollowUpDueState("2026-08-01", now), "due_soon");
  assert.equal(serviceFollowUpDueState("2026-09-01", now), "upcoming");
  assert.equal(serviceFollowUpReadiness({ customerUid: "customer", accountActive: true, accountConsent: true, preferenceExists: true, remindersEnabled: true, reminderLeadDays: 30, dueAt: "2026-08-01", now }), "eligible");
  assert.equal(serviceFollowUpReadiness({ customerUid: "customer", accountActive: true, accountConsent: true, preferenceExists: true, remindersEnabled: true, reminderLeadDays: 7, dueAt: "2026-08-01", now }), "too_early");
  assert.equal(serviceFollowUpReadiness({ customerUid: "", accountActive: true, accountConsent: true, preferenceExists: true, remindersEnabled: true, reminderLeadDays: 30, dueAt: "2026-08-01", now }), "missing_consent");
  assert.equal(serviceFollowUpReadiness({ customerUid: "customer", accountActive: true, accountConsent: true, preferenceExists: true, remindersEnabled: false, reminderLeadDays: 30, dueAt: "2026-08-01", now }), "withdrawn");
});

test("prepared reminder content is bounded and customer safe", () => {
  const draft = serviceReminderDraft({ businessName: "AEA Services", brand: "Example", modelNumber: "HP-1", serviceType: "annual_service", dueAt: "2026-08-01", siteLabel: "Main home" });
  assert.match(draft.subject, /Annual Service due for Example HP-1/);
  assert.match(draft.body, /Contact AEA Services/);
  assert.doesNotMatch(`${draft.subject} ${draft.body}`, /@|\+61|04\d{8}/);
  assert.ok(draft.subject.length <= 180); assert.ok(draft.body.length <= 800);
});

test("follow-up records and audit events are additive and uniqueness protected", () => {
  assert.match(schema, /sqliteTable\("trade_service_follow_ups"/);
  assert.match(schema, /sqliteTable\("trade_service_follow_up_events"/);
  assert.match(migration, /CREATE TABLE `trade_service_follow_ups`/);
  assert.match(migration, /trade_service_follow_ups_plan_due_idx/);
  assert.match(migration, /trade_service_follow_up_events_record_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE `trade_installed_assets`|CREATE TABLE `trade_asset_service_plans`|CREATE TABLE `customer_asset_lifecycle_preferences`/);
});

test("the follow-up migration applies cleanly and rejects duplicate plan dates", () => {
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const insert = db.prepare(`INSERT INTO trade_service_follow_ups
    (id, service_plan_id, asset_id, crm_customer_id, service_site_id, work_order_id, firebase_uid, due_at, status,
     assignee_member_id, suppression_reason, internal_notes, reminder_subject, reminder_body, revision, created_at, updated_at)
    VALUES (?, ?, 'asset', 'customer', 'site', 'job', 'owner', '2026-08-01', 'preparing', '', '', '', '', '', 0, 'now', 'now')`);
  insert.run("one", "plan");
  assert.throws(() => insert.run("two", "plan"), /UNIQUE/);
});

test("every static follow-up query compiles against its production migration chain", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  const migrations = ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0018_military_starhawk.sql", "0019_melodic_unus.sql",
    "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0049_customer_asset_timeline.sql",
    "0052_service_follow_up_preparation.sql", "0053_service_reminder_delivery.sql"];
  for (const file of migrations) for (const statement of fs.readFileSync(new URL(file, directory), "utf8").split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const queries = [...route.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1])
    .concat([...route.matchAll(/prepare\("([^"]+)"\)/g)].map((match) => match[1]));
  assert.ok(queries.length >= 8);
  for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `follow-up SQL should compile: ${sql.slice(0, 90)}`);
});

test("server readiness uses explicit preference, active account consent and customer ownership", () => {
  for (const boundary of ["requireInstallerTeamAccess", "sameOrigin", "canDispatch", "firebase_uid = ?", "customer_asset_lifecycle_preferences", "customer_consent_receipts", "customer_asset_ownerships"]) assert.match(route, new RegExp(boundary));
  assert.match(route, /preference\.id preference_id/);
  assert.match(route, /receipt\.purpose = 'customer_account'/);
  assert.match(route, /receipt\.withdrawn_at = ''/);
  assert.match(route, /lifecycle\.protected_job = 0 OR lifecycle\.customer_uid != ''/);
  assert.match(route, /candidate\.readiness !== "eligible"/);
  assert.match(customerLifecycleRoute, /remindersEnabled: row \? Boolean\(row\.reminders_enabled\) : false/);
  assert.match(customerLifecycleRoute, /recorded: Boolean\(row\)/);
  assert.match(customerLifecycleUi, /Allow service reminders/);
  assert.match(customerLifecycleUi, /Off until you explicitly enable it/);
});

test("status writes are revision protected, idempotently materialised and audited", () => {
  assert.match(route, /ON CONFLICT\(firebase_uid, service_plan_id, due_at\) DO NOTHING/);
  assert.match(route, /Number\(current\.revision\) !== Number\(body\.expectedRevision\)/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \? AND revision = \?/);
  assert.match(route, /trade_service_follow_up_events/);
  assert.match(route, /if \(!results\[0\]\.meta\.changes\) throw new Error\("REVISION_CONFLICT"\)/);
});

test("completed service advances the authoritative plan while follow-ups remain unique per due date", () => {
  assert.match(lifecycleRoute, /addMonthsToIsoDate\(servicedAt, Number\(plan\.cadence_months\)\)/);
  assert.match(lifecycleRoute, /UPDATE trade_asset_service_plans SET next_due_at = \?/);
  assert.match(migration, /UNIQUE INDEX `trade_service_follow_ups_plan_due_idx`/);
});

test("follow-up payload preserves privacy while sends require a reviewed provider boundary", () => {
  assert.doesNotMatch(route, /c\.email|c\.phone|address_line_1|customer_contact_id/);
  assert.doesNotMatch(ui, /customer_email|customer_phone|mobile_e164|account\.email/);
  for (const copy of ["Prepare, review and send service reminders", "I reviewed this exact reminder", "Customer", "Site", "Asset", "Due state", "Assignee", "Consent", "Prepare reminder", "Suppression reason", "Send email", "Send SMS"]) assert.match(ui, new RegExp(copy));
  assert.match(dashboard, /workspace === "follow-ups"/); assert.match(dashboard, /<TradeServiceFollowUpWorkspace/);
  assert.match(teamPortal, /data\.access\.canDispatch && <TradeServiceFollowUpWorkspace/);
});

test("new follow-up copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${ui}`, /[\u2013\u2014]/);
});
