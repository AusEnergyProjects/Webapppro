import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as scheduleHelpers from "../src/lib/trade-schedule.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

function transpileRoute(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const adminServer = {
  adminJson: (value, status = 200) => Response.json(value, { status }),
  cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
  sameOrigin: () => true,
};

test("batch schedule changes enforce current, target and reassignment permission boundaries", () => {
  const source = read("../src/app/api/trade-schedule/route.ts");
  const batchSchedule = source.slice(
    source.indexOf('action === "save_schedule_changes"'),
    source.indexOf('action === "schedule_appointment"'),
  );
  assert.match(batchSchedule, /body\.changes\.length < 1 \|\| body\.changes\.length > 5/);
  assert.match(batchSchedule, /new Set\(appointmentIds\)\.size !== appointmentIds\.length/);
  const currentScope = batchSchedule.indexOf("assertCurrentScheduleAssignment(access");
  const targetScope = batchSchedule.indexOf("assertScheduleTarget(access", currentScope);
  const assignment = batchSchedule.indexOf("assertAssignmentChange(access", targetScope);
  const member = batchSchedule.indexOf("activeMember(access.ownerUid", assignment);
  const batch = batchSchedule.indexOf("await db.batch(statements)", member);
  assert.ok(currentScope >= 0 && currentScope < targetScope && targetScope < assignment
    && assignment < member && member < batch,
  "every staged change must pass current, target and reassignment checks before the batch commits");
  assert.match(batchSchedule, /WHERE a\.firebase_uid = \? AND a\.id IN/);
  assert.match(batchSchedule, /change\.expectedRevision !== Number\(current\.revision\)/);
});

test("ordinary staff availability is self-only while delegated managers can edit the team", async () => {
  const members = [
    { id: "member-self", member_uid: "staff-uid", display_name: "Sam Field", email: "sam@example.test", status: "active", schedule_colour: "teal", capabilities: "[]" },
    { id: "member-other", member_uid: "other-uid", display_name: "Alex Field", email: "alex@example.test", status: "active", schedule_colour: "rose", capabilities: "[]" },
  ];
  const hours = [
    { id: "hours-self", owner_uid: "owner-1", team_member_id: "member-self", weekday: 1, start_minute: 480, end_minute: 960, is_available: 1 },
    { id: "hours-other", owner_uid: "owner-1", team_member_id: "member-other", weekday: 1, start_minute: 540, end_minute: 1020, is_available: 1 },
  ];
  const unavailable = [
    { id: "leave-self", owner_uid: "owner-1", team_member_id: "member-self", starts_at: "2026-08-17T09:00", ends_at: "2026-08-17T10:00", reason: "Training" },
    { id: "leave-other", owner_uid: "owner-1", team_member_id: "member-other", starts_at: "2026-08-18T09:00", ends_at: "2026-08-18T10:00", reason: "Leave" },
  ];
  const appointments = [
    { id: "appointment-self", work_order_id: "job-self", work_number: "TL-1", title: "Self job", appointment_type: "work", starts_at: "2026-08-17T11:00", ends_at: "2026-08-17T12:00", assignee_member_id: "member-self", assignee_label: "Sam Field", status: "scheduled", revision: 1, service_category: "energy-assessment", source_type: "direct", customer_source: "trade_owned", customer_first_name: "Pat", customer_last_name: "Self", customer_business_name: "", site_label: "Home", suburb: "Melbourne", address_state: "VIC", postcode: "3000", site_area: "", quote_status: "not_started", quoted_value_cents: 0 },
    { id: "appointment-other", work_order_id: "job-other", work_number: "TL-2", title: "Other job", appointment_type: "work", starts_at: "2026-08-18T11:00", ends_at: "2026-08-18T12:00", assignee_member_id: "member-other", assignee_label: "Alex Field", status: "scheduled", revision: 1, service_category: "energy-assessment", source_type: "direct", customer_source: "trade_owned", customer_first_name: "Pat", customer_last_name: "Other", customer_business_name: "", site_label: "Home", suburb: "Melbourne", address_state: "VIC", postcode: "3000", site_area: "", quote_status: "not_started", quoted_value_cents: 0 },
  ];
  let access = {
    ownerUid: "owner-1", actorUid: "staff-uid", memberId: "member-self", isOwner: false,
    canManageTeam: false, canRescheduleJobs: false, canAssignJobs: false, canViewQuotes: false,
    jobScope: "own", scheduleScope: "team",
  };

  class ScheduleStatement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new ScheduleStatement(this.sql, values); }
    async first() {
      if (this.sql.includes("FROM trade_accounts")) return { address_state: "NSW" };
      if (this.sql.includes("FROM trade_team_members") && this.sql.includes("WHERE id = ?")) {
        const member = members.find((item) => item.id === this.values[0]);
        return member && this.values[1] === "owner-1" ? member : null;
      }
      return null;
    }
    async all() {
      if (this.sql.includes("FROM trade_team_members")) {
        const ownOnly = Number(this.values[1]) === 1;
        return { results: members.filter((item) => !ownOnly || item.id === this.values[2]) };
      }
      if (this.sql.includes("FROM trade_team_working_hours")) {
        const ownOnly = Number(this.values[1]) === 1;
        return { results: hours.filter((item) => item.owner_uid === this.values[0] && (!ownOnly || item.team_member_id === this.values[2])) };
      }
      if (this.sql.includes("FROM trade_team_unavailability")) {
        const ownOnly = Number(this.values[1]) === 1;
        return { results: unavailable.filter((item) => item.owner_uid === this.values[0] && (!ownOnly || item.team_member_id === this.values[2])) };
      }
      if (this.sql.includes("FROM trade_crm_appointments a JOIN")) {
        const ownOnly = Number(this.values[3]) === 1;
        return { results: appointments.filter((item) => !ownOnly || item.assignee_member_id === this.values[4]) };
      }
      return { results: [] };
    }
    async run() {
      if (this.sql.includes("INSERT INTO trade_team_working_hours")) {
        const [id, ownerUid, memberId, weekday, startMinute, endMinute, isAvailable] = this.values;
        const existing = hours.findIndex((item) => item.owner_uid === ownerUid && item.team_member_id === memberId && item.weekday === weekday);
        const row = { id, owner_uid: ownerUid, team_member_id: memberId, weekday, start_minute: startMinute, end_minute: endMinute, is_available: isAvailable };
        if (existing >= 0) hours[existing] = row;
        else hours.push(row);
      }
      return { success: true, meta: { changes: 1 } };
    }
  }
  const database = { prepare: (sql) => new ScheduleStatement(sql), batch: async () => [] };
  const scheduleServer = transpileRoute("../src/lib/trade-schedule-server.ts", {
    "../../db": { getD1: () => database },
  });
  const route = transpileRoute("../src/app/api/trade-schedule/route.ts", {
    "../../../../db": { getD1: () => database },
    "@/lib/admin-server": adminServer,
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, canViewSchedule: () => true, canAssignJob: () => false },
    "@/lib/trade-team-sync-server": { jobSyncChangeStatements: () => [], nextJobRevision: (value) => Number(value) + 1 },
    "@/lib/trade-schedule": scheduleHelpers,
    "@/lib/appointment-rescheduling": { parsePreferredWindows: () => [] },
    "@/lib/appointment-notification-server": { queueAppointmentNotifications: async () => {} },
    "@/lib/trade-calendar-sync-server": { syncCreatedAppointmentToConnectedCalendars: async () => ({ connected: 0, synced: 0, failed: 0 }) },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: () => false,
      plannedComplianceIntentReplanStatements: async () => [],
      previousTradeScheduleMutationGuardStatement: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }),
    },
    "@/lib/trade-rental-assignment-server": {
      isRentalInspectionAssignmentConflict: () => false,
      rentalInspectionAssignmentStatements: () => [],
    },
    "@/lib/trade-team-permission-policy.mjs": { canRescheduleWithinScope: () => false },
    "@/lib/trade-schedule-server": scheduleServer,
  });

  const weekUrl = "https://test/api/trade-schedule?rangeStart=2026-08-17";
  const staffGet = await route.GET(new Request(weekUrl));
  assert.equal(staffGet.status, 200);
  const staffPayload = await staffGet.json();
  assert.deepEqual(staffPayload.members.map((item) => item.id), ["member-self", "member-other"]);
  assert.deepEqual(staffPayload.availabilityMembers.map((item) => item.id), ["member-self"]);
  assert.deepEqual(staffPayload.workingHours.map((item) => item.teamMemberId), ["member-self"]);
  assert.deepEqual(staffPayload.unavailability.map((item) => item.teamMemberId), ["member-self"]);
  assert.deepEqual(staffPayload.appointments.map((item) => item.id), ["appointment-self", "appointment-other"]);

  const patch = (body) => route.PATCH(new Request("https://test/api/trade-schedule", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ rangeStart: "2026-08-17", ...body }),
  }));
  const selfUpdate = await patch({ action: "save_working_hours", memberId: "member-self", weekday: 2, startMinute: 480, endMinute: 960, isAvailable: true });
  assert.equal(selfUpdate.status, 200);
  assert.ok(hours.some((item) => item.team_member_id === "member-self" && item.weekday === 2));

  const deniedOther = await patch({ action: "save_working_hours", memberId: "member-other", weekday: 2, startMinute: 480, endMinute: 960, isAvailable: true });
  assert.equal(deniedOther.status, 403);
  assert.equal(hours.some((item) => item.team_member_id === "member-other" && item.weekday === 2), false);

  access = { ...access, actorUid: "manager-uid", canManageTeam: true, scheduleScope: "own" };
  const managerGet = await route.GET(new Request(weekUrl));
  assert.equal(managerGet.status, 200);
  const managerPayload = await managerGet.json();
  assert.deepEqual(managerPayload.members.map((item) => item.id), ["member-self"]);
  assert.deepEqual(managerPayload.availabilityMembers.map((item) => item.id), ["member-self", "member-other"]);
  assert.deepEqual(managerPayload.appointments.map((item) => item.id), ["appointment-self"]);
  const managerUpdate = await patch({ action: "save_working_hours", memberId: "member-other", weekday: 2, startMinute: 540, endMinute: 1020, isAvailable: true });
  assert.equal(managerUpdate.status, 200);
  assert.ok(hours.some((item) => item.team_member_id === "member-other" && item.weekday === 2));
});

test("member documents allow owner and delegated manager access without crossing tenants", async () => {
  const memberOwners = new Map([["member-1", "owner-1"], ["member-2", "owner-2"]]);
  const files = [{
    id: "file-1", owner_uid: "owner-1", team_member_id: "member-1", category: "other", description: "",
    title: "Insurance", expires_at: "2027-01-31", file_name: "insurance.pdf", content_type: "application/pdf",
    size_bytes: 100, sha256: "a".repeat(64), object_key: "team/file-1", status: "active", cleanup_attempts: 0,
    next_cleanup_at: "", last_cleanup_error: "", uploaded_by_uid: "owner-1", created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z", deleted_at: "",
  }];
  let access = { ownerUid: "owner-1", actorUid: "owner-1", isOwner: true, canManageTeam: false };
  let audits = 0;
  class FileStatement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new FileStatement(this.sql, values); }
    async first() {
      if (this.sql.includes("FROM trade_team_members")) {
        return memberOwners.get(this.values[0]) === this.values[1] ? { id: this.values[0], display_name: "Member", status: "active" } : null;
      }
      return null;
    }
    async all() {
      if (this.sql.includes("FROM trade_team_member_files")) {
        return { results: files.filter((item) => item.owner_uid === this.values[0] && item.team_member_id === this.values[1]) };
      }
      return { results: [] };
    }
    async run() { if (this.sql.includes("INSERT INTO trade_team_member_events")) audits += 1; return { success: true, meta: { changes: 1 } }; }
  }
  const database = { prepare: (sql) => new FileStatement(sql), batch: async () => [] };
  class TeamMemberFileError extends Error {}
  const bucket = { put: async () => {}, get: async () => null, delete: async () => {} };
  const route = transpileRoute("../src/app/api/trade-team/member-files/route.ts", {
    "cloudflare:workers": { env: { EVIDENCE: bucket } },
    "../../../../../db": { getD1: () => database },
    "@/lib/admin-server": adminServer,
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-team-member-files-server": {
      inspectTeamMemberFile: async () => { throw new Error("not used"); }, safeTeamMemberFileName: (value) => value,
      TEAM_MEMBER_FILE_LIMIT: 20, TeamMemberFileError,
    },
    "@/lib/trade-team-member-file-cleanup": { drainTradeTeamMemberFileCleanup: async () => ({ completed: 0, pending: 0 }) },
  });
  const list = (memberId) => route.GET(new Request(`https://test/api/trade-team/member-files?memberId=${memberId}`));

  const owner = await list("member-1");
  assert.equal(owner.status, 200);
  const ownerPayload = await owner.json();
  assert.equal(ownerPayload.files[0].title, "Insurance");
  assert.equal(ownerPayload.files[0].expiresAt, "2027-01-31");
  assert.equal("category" in ownerPayload.files[0], false);
  assert.equal("description" in ownerPayload.files[0], false);

  access = { ownerUid: "owner-1", actorUid: "manager-uid", isOwner: false, canManageTeam: true };
  assert.equal((await list("member-1")).status, 200);

  access = { ownerUid: "owner-1", actorUid: "staff-uid", isOwner: false, canManageTeam: false };
  assert.equal((await list("member-1")).status, 403);

  access = { ownerUid: "owner-1", actorUid: "manager-uid", isOwner: false, canManageTeam: true };
  assert.equal((await list("member-2")).status, 404);
  assert.equal(audits, 2);
});

test("member document and expiry migrations match schema and run with the Sites semicolon splitter", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE trade_team_members (id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL);
    CREATE TABLE trade_team_member_files (
      id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, team_member_id text NOT NULL,
      description text NOT NULL DEFAULT '', file_name text NOT NULL, status text NOT NULL
    );
    INSERT INTO trade_team_members VALUES ('member-1', 'owner-1');
    INSERT INTO trade_team_member_files VALUES ('file-1', 'owner-1', 'member-1', 'Insurance certificate', 'insurance.pdf', 'active');
  `);
  const sitesApply = (sql) => {
    for (const statement of sql.replaceAll("--> statement-breakpoint", "").split(";").map((item) => item.trim()).filter(Boolean)) database.exec(statement);
  };
  const documentsMigration = read("../drizzle/0134_team_member_documents_and_colours.sql");
  const warningsMigration = read("../drizzle/0135_team_document_expiry_warnings.sql");
  assert.doesNotThrow(() => sitesApply(documentsMigration));
  assert.equal(database.prepare("SELECT title FROM trade_team_member_files WHERE id = 'file-1'").get().title, "Insurance certificate");
  assert.throws(() => database.exec("UPDATE trade_team_members SET schedule_colour = 'black' WHERE id = 'member-1'"), /CHECK constraint failed/);
  assert.throws(() => database.exec("UPDATE trade_team_member_files SET expires_at = '2026-02-30' WHERE id = 'file-1'"), /CHECK constraint failed/);
  assert.doesNotThrow(() => sitesApply(warningsMigration));
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  for (const index of ["trade_team_member_files_expiry_idx", "trade_team_document_expiry_warnings_revision_idx", "trade_team_document_expiry_warnings_owner_time_idx", "trade_team_document_expiry_warnings_email_queue_idx"]) assert.ok(indexes.includes(index));
  assert.throws(() => database.prepare(`INSERT INTO trade_team_document_expiry_warnings
    (id, event_key, owner_uid, team_member_id, file_id, document_title, member_name, expires_at,
     email_idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("warning-1", "event-1", "owner-1", "member-1", "file-1", "Insurance", "Sam Field", "2027-01-31", "A".repeat(64), "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z"), /CHECK constraint failed/);

  const schema = read("../db/schema.ts");
  assert.match(schema, /scheduleColour: text\("schedule_colour"\)\.notNull\(\)\.default\("emerald"\)/);
  assert.match(schema, /title: text\("title"\)\.notNull\(\)\.default\(""\)/);
  assert.match(schema, /expiresAt: text\("expires_at"\)\.notNull\(\)\.default\(""\)/);
  assert.match(schema, /export const tradeTeamDocumentExpiryWarnings = sqliteTable\("trade_team_document_expiry_warnings"/);
  assert.match(schema, /trade_team_document_expiry_warnings_idempotency_check/);
});
