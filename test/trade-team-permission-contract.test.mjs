import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canAssignWithinScope, canRescheduleWithinScope } from "../src/lib/trade-team-permission-policy.mjs";
import { memberLifecycleDecision } from "../src/lib/trade-team-lifecycle-policy.mjs";
import { TLINK_SCHEMA_GUARD_DEFINITIONS } from "../src/lib/tlink-schema-guards.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function apply(db, sql) {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

test("own-scope assignment can claim self and hand a self-owned job to an active target", () => {
  const actor = { isOwner: false, canAssignJobs: true, jobScope: "own", memberId: "member-a" };
  assert.equal(canAssignWithinScope(actor, "", "member-a"), true);
  assert.equal(canAssignWithinScope(actor, "member-a", ""), true);
  assert.equal(canAssignWithinScope(actor, "member-a", "member-a"), true);
  assert.equal(canAssignWithinScope(actor, "member-a", "member-b"), true);
  assert.equal(canAssignWithinScope(actor, "", "member-b"), false);
  assert.equal(canAssignWithinScope(actor, "member-b", "member-a"), false);
  assert.equal(canAssignWithinScope({ ...actor, canAssignJobs: false }, "", "member-a"), false);
  assert.equal(canAssignWithinScope({ ...actor, jobScope: "team" }, "member-b", "member-a"), true);
});

test("rescheduling uses schedule scope independently from job scope", () => {
  const access = { isOwner: false, canRescheduleJobs: true, scheduleScope: "team", jobScope: "own", memberId: "member-a" };
  assert.equal(canRescheduleWithinScope(access, "member-b"), true);
  assert.equal(canRescheduleWithinScope({ ...access, scheduleScope: "own", jobScope: "team" }, "member-b"), false);
  assert.equal(canRescheduleWithinScope({ ...access, scheduleScope: "own" }, "member-a"), true);
  assert.equal(canRescheduleWithinScope({ ...access, canRescheduleJobs: false }, "member-a"), false);
});

test("CRM appointment creation atomically authorises the requested assignment and first booking", async () => {
  const crm = await read("../src/app/api/trade-crm/route.ts");
  const createAppointment = crm.slice(
    crm.indexOf('action === "create_appointment"'),
    crm.indexOf('action === "create_note"'),
  );
  for (const boundary of [
    /expectedRevision !== Number\(job\.revision\)/,
    /if \(!requestedAssigneeMemberId\)/,
    /identity\.access\.scheduleScope === "own"[\s\S]*?assigneeMemberId !== identity\.memberId/,
    /assignmentChanged && !canAssignJob\(identity\.access, currentAssigneeMemberId, assigneeMemberId\)/,
    /assignmentChanged[\s\S]*?status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\)[\s\S]*?ACTIVE_APPOINTMENT_REASSIGN/,
  ]) assert.match(createAppointment, boundary);
  const statements = createAppointment.indexOf("const statements = [");
  const jobUpdate = createAppointment.indexOf("UPDATE trade_work_orders", statements);
  const mutationGuard = createAppointment.indexOf("previousTradeScheduleMutationGuardStatement", jobUpdate);
  const appointmentInsert = createAppointment.indexOf("INSERT INTO trade_crm_appointments", mutationGuard);
  const eligibilityGuard = createAppointment.indexOf("tradeJobScheduleEligibilityGuardStatement", appointmentInsert);
  const availabilityGuard = createAppointment.indexOf("tradeScheduleAvailabilityGuardStatement", eligibilityGuard);
  const batch = createAppointment.indexOf("await db.batch(statements)", availabilityGuard);
  assert.ok(statements >= 0 && statements < jobUpdate && jobUpdate < mutationGuard
    && mutationGuard < appointmentInsert && appointmentInsert < eligibilityGuard
    && eligibilityGuard < availabilityGuard && availabilityGuard < batch,
  "assignment, booking and authoritative guards must share one ordered mutation batch");
  assert.match(createAppointment, /WHERE id = \? AND firebase_uid = \?[\s\S]*?AND revision = \? AND stage = \?[\s\S]*?AND assignee_member_id = \?/);
  assert.match(createAppointment, /return adminJson\(\{ ok: true, id: appointmentId, revision: jobRevision, calendarSync \}, 201\)/);
  const actor = { isOwner: false, canAssignJobs: false, jobScope: "team", memberId: "member-a" };
  assert.equal(canAssignWithinScope(actor, "member-a", "member-b"), false);
  assert.equal(canAssignWithinScope({ ...actor, canAssignJobs: true }, "member-a", "member-b"), true);
});

test("permission migration rejects malformed booleans and privilege dependencies", async () => {
  const [base, roster, migration] = await Promise.all([
    read("../drizzle/0025_dizzy_spot.sql"),
    read("../drizzle/0070_frictionless_team_roster.sql"),
    read("../drizzle/0131_trade_team_permissions_and_member_files.sql"),
  ]);
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL)");
  apply(db, base);
  apply(db, roster);
  apply(db, migration);
  for (const definition of TLINK_SCHEMA_GUARD_DEFINITIONS.slice(0, 2)) db.exec(definition.sql);
  const now = "2026-08-12T00:00:00.000Z";
  db.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, email, display_name, role, status, invited_at, created_at, updated_at)
    VALUES ('member-1', 'owner-1', 'member@example.com', 'Member', 'field', 'active', ?, ?, ?)`)
    .run(now, now, now);
  assert.throws(() => db.prepare("UPDATE trade_team_members SET can_manage_quotes = 1 WHERE id = 'member-1'").run(), /invalid team permissions/);
  assert.throws(() => db.prepare("UPDATE trade_team_members SET can_edit_team_permissions = 1 WHERE id = 'member-1'").run(), /invalid team permissions/);
  assert.throws(() => db.prepare("UPDATE trade_team_members SET can_create_jobs = 2 WHERE id = 'member-1'").run(), /invalid team permissions/);
  db.prepare("UPDATE trade_team_members SET can_manage_team = 1, can_edit_team_permissions = 1 WHERE id = 'member-1'").run();
  assert.equal(db.prepare("SELECT can_edit_team_permissions FROM trade_team_members WHERE id = 'member-1'").get().can_edit_team_permissions, 1);
});

test("legacy roles receive only proven operational permissions during migration", async () => {
  const [base, roster, migration] = await Promise.all([
    read("../drizzle/0025_dizzy_spot.sql"), read("../drizzle/0070_frictionless_team_roster.sql"),
    read("../drizzle/0131_trade_team_permissions_and_member_files.sql"),
  ]);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL)");
  apply(db, base); apply(db, roster);
  const now = "2026-08-12T00:00:00.000Z";
  for (const role of ["manager", "coordinator", "technician"]) {
    db.prepare(`INSERT INTO trade_team_members
      (id, owner_uid, email, display_name, role, status, invited_at, created_at, updated_at)
      VALUES (?, 'owner-1', ?, ?, ?, 'active', ?, ?, ?)`)
      .run(role, `${role}@example.com`, role, role, now, now, now);
  }
  apply(db, migration);
  const manager = db.prepare("SELECT * FROM trade_team_members WHERE id = 'manager'").get();
  const coordinator = db.prepare("SELECT * FROM trade_team_members WHERE id = 'coordinator'").get();
  const technician = db.prepare("SELECT * FROM trade_team_members WHERE id = 'technician'").get();
  for (const row of [manager, coordinator]) {
    assert.equal(row.can_manage_jobs, 1); assert.equal(row.can_assign_jobs, 1);
    assert.equal(row.job_scope, "team"); assert.equal(row.schedule_scope, "team");
    assert.equal(row.can_reschedule_jobs, 1); assert.equal(row.can_manage_field_evidence, 1);
  }
  assert.equal(technician.can_manage_jobs, 0); assert.equal(technician.can_assign_jobs, 0);
  assert.equal(technician.job_scope, "own"); assert.equal(technician.schedule_scope, "own");
  assert.equal(technician.can_manage_field_evidence, 1);
  for (const row of [manager, coordinator, technician]) {
    for (const key of ["can_manage_team", "can_edit_team_permissions", "can_view_customers",
      "can_view_quotes", "can_view_invoices", "can_view_price_book", "can_apply_discounts", "can_run_reports"]) {
      assert.equal(row[key], 0, `${row.id} must not receive ${key}`);
    }
  }
});

test("member lifecycle policy permits managers but protects self and owner", () => {
  const manager = { isOwner: false, canManageTeam: true, ownerUid: "owner-1", actorUid: "uid-a", memberId: "member-a" };
  assert.deepEqual(memberLifecycleDecision(manager, { memberId: "member-b", memberUid: "uid-b" }), { allowed: true, reason: "allowed" });
  assert.equal(memberLifecycleDecision({ ...manager, canManageTeam: false }, { memberId: "member-b", memberUid: "uid-b" }).allowed, false);
  assert.equal(memberLifecycleDecision(manager, { memberId: "member-a", memberUid: "uid-a" }).reason, "self_protected");
  assert.equal(memberLifecycleDecision(manager, { memberId: "owner", memberUid: "owner-1" }).reason, "owner_protected");
  assert.equal(memberLifecycleDecision({ ...manager, isOwner: true }, { memberId: "member-b", memberUid: "uid-b" }).allowed, true);
});

test("deactivation revokes access while preserving tenant history and reactivation restores no device", async () => {
  const [base, roster, migration, route, devices] = await Promise.all([
    read("../drizzle/0025_dizzy_spot.sql"), read("../drizzle/0070_frictionless_team_roster.sql"),
    read("../drizzle/0131_trade_team_permissions_and_member_files.sql"), read("../src/app/api/trade-team/route.ts"),
    read("../src/app/api/trade-team/devices/route.ts"),
  ]);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL);
    CREATE TABLE trade_mobile_devices (
      id text PRIMARY KEY, owner_uid text, member_id text, status text, push_token text,
      push_token_updated_at text, revoked_at text, revoked_by_uid text, updated_at text
    );`);
  apply(db, base); apply(db, roster); apply(db, migration);
  const first = "2026-08-12T00:00:00.000Z"; const second = "2026-08-12T00:01:00.000Z";
  db.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, member_uid, email, display_name, role, status, invited_at, created_at, updated_at)
    VALUES ('member-b', 'owner-1', 'uid-b', 'b@example.com', 'Member B', 'technician', 'active', ?, ?, ?)`)
    .run(first, first, first);
  db.prepare("INSERT INTO trade_work_orders (id, assignee_member_id) VALUES ('job-1', 'member-b')").run();
  db.prepare(`INSERT INTO trade_mobile_devices VALUES
    ('device-1', 'owner-1', 'member-b', 'active', 'push-secret', '', '', '', ?)`).run(first);
  db.prepare(`INSERT INTO trade_team_invites VALUES
    ('invite-1', 'member-b', 'owner-1', 'token-hash', '2026-09-01T00:00:00.000Z', '', ?)`).run(first);
  db.prepare(`INSERT INTO trade_team_member_credentials
    (id, owner_uid, team_member_id, credential_type, name, status, created_at, updated_at)
    VALUES ('credential-1', 'owner-1', 'member-b', 'licence', 'Electrical licence', 'active', ?, ?)`)
    .run(first, first);
  db.prepare(`UPDATE trade_team_members SET status='suspended', updated_at=?
    WHERE id='member-b' AND owner_uid='owner-1' AND status='active' AND updated_at=?`).run(second, first);
  db.prepare(`UPDATE trade_mobile_devices SET status='revoked', push_token='', push_token_updated_at=?,
    revoked_at=?, revoked_by_uid='manager-1', updated_at=? WHERE owner_uid='owner-1' AND member_id='member-b' AND status='active'`)
    .run(second, second, second);
  db.prepare(`UPDATE trade_team_invites SET consumed_at=? WHERE owner_uid='owner-1' AND team_member_id='member-b' AND consumed_at=''`).run(second);
  assert.equal(db.prepare("SELECT status FROM trade_team_members WHERE id='member-b'").get().status, "suspended");
  assert.deepEqual({ ...db.prepare("SELECT status, push_token FROM trade_mobile_devices WHERE id='device-1'").get() }, { status: "revoked", push_token: "" });
  assert.equal(db.prepare("SELECT assignee_member_id FROM trade_work_orders WHERE id='job-1'").get().assignee_member_id, "member-b");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_team_member_credentials WHERE team_member_id='member-b'").get().count, 1);
  db.prepare("UPDATE trade_team_members SET status='active', updated_at=? WHERE id='member-b' AND status='suspended'").run("2026-08-12T00:02:00.000Z");
  assert.equal(db.prepare("SELECT status FROM trade_mobile_devices WHERE id='device-1'").get().status, "revoked");
  assert.notEqual(db.prepare("SELECT consumed_at FROM trade_team_invites WHERE id='invite-1'").get().consumed_at, "");
  assert.match(route, /UPDATE trade_mobile_devices[\s\S]*status = 'revoked'[\s\S]*push_token = ''/);
  assert.match(route, /UPDATE trade_team_invites SET consumed_at/);
  assert.match(devices, /member\.status = 'active'|status = 'active'/);
});

test("team access is permission- and scope-driven with no role template model", async () => {
  const [schema, migration, access, route] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0131_trade_team_permissions_and_member_files.sql"),
    read("../src/lib/trade-team-server.ts"),
    read("../src/app/api/trade-team/route.ts"),
  ]);
  for (const source of [schema, migration, access, route]) {
    assert.doesNotMatch(source, /role_template|permissions_overridden/i);
  }
  assert.doesNotMatch(access, /\.role\b|\brole\s*[=!]==?/);
  for (const column of ["can_apply_discounts", "can_assign_jobs", "can_reschedule_jobs", "can_edit_team_permissions"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(route, /PERMISSION_SELF_EDIT/);
  assert.match(route, /PERMISSION_ESCALATION/);
  assert.match(route, /permissionsBefore: beforePermissions, permissionsAfter: permissions/);
  assert.match(route, /canAssignJob\(access,/);
  assert.doesNotMatch(route, /TEAM_LIMIT|50 member team limit/);
});

test("discount and schedule mutations enforce their authoritative flags", async () => {
  const [quotes, invoices, schedule, crm] = await Promise.all([
    read("../src/app/api/trade-quotes/route.ts"),
    read("../src/app/api/trade-quick-invoices/route.ts"),
    read("../src/app/api/trade-schedule/route.ts"),
    read("../src/app/api/trade-crm/route.ts"),
  ]);
  assert.match(quotes, /!access\.canApplyDiscounts/);
  assert.match(invoices, /!access\.canApplyDiscounts/);
  assert.match(schedule, /!access\.canRescheduleJobs/);
  assert.match(schedule, /canAssignJob\(access,/);
  assert.match(crm, /!identity\.access\.canRescheduleJobs/);
  assert.match(crm, /canAssignJob\(identity\.access,/);
});

test("worker drains member file cleanup from health and minute cron", async () => {
  const worker = await read("../worker/index.ts");
  const occurrences = worker.match(/drainTradeTeamMemberFileCleanup\(/g) || [];
  assert.equal(occurrences.length, 2);
  assert.match(worker, /url\.pathname === "\/api\/health"/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON/);
});
