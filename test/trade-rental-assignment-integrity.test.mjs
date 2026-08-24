import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { rentalInspectionAssignmentStatements } from "../src/lib/trade-rental-assignment-server.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function captureAssignmentStatements(input) {
  const captured = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          const statement = { sql, bindings };
          captured.push(statement);
          return statement;
        },
      };
    },
  };
  const returned = rentalInspectionAssignmentStatements(db, input);
  assert.deepEqual(returned, captured);
  return captured;
}

function assertActionUsesAssignmentHelper(routeSource, action, maximumDistance = 13_000) {
  const actionMarker = `action === "${action}"`;
  const actionIndex = routeSource.indexOf(actionMarker);
  assert.notEqual(actionIndex, -1, `missing ${action} action`);
  const helperIndex = routeSource.indexOf("...rentalInspectionAssignmentStatements", actionIndex);
  assert.ok(helperIndex > actionIndex, `${action} does not call the rental assignment helper`);
  assert.ok(helperIndex - actionIndex < maximumDistance, `${action} helper call is outside its mutation branch`);
}

const ASSIGNMENT_CHANGED_AT = "2026-08-24T05:06:07.000Z";
const APPOINTMENT_START = "2026-08-25T09:00:00.000Z";
const APPOINTMENT_END = "2026-08-25T10:30:00.000Z";

class SqliteD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1Statement(this.database, this.sql, bindings);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }
}

function sqliteD1(database) {
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function assignmentInput(overrides = {}) {
  return {
    actorType: "owner",
    actorUid: "owner-1",
    appointment: {
      id: "appointment-1",
      startsAt: APPOINTMENT_START,
      endsAt: APPOINTMENT_END,
    },
    assigneeLabel: "Alex Assessor",
    assigneeMemberId: "member-2",
    changedAt: ASSIGNMENT_CHANGED_AT,
    jobRevision: 12,
    ownerUid: "owner-1",
    previousAssigneeMemberId: "",
    workOrderId: "work-1",
    ...overrides,
  };
}

function rentalAssignmentFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id TEXT PRIMARY KEY NOT NULL,
      firebase_uid TEXT NOT NULL,
      record_status TEXT NOT NULL,
      assignee_member_id TEXT NOT NULL,
      assignee_label TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_team_members (
      id TEXT PRIMARY KEY NOT NULL,
      owner_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      member_uid TEXT NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      assignee_member_id TEXT NOT NULL,
      assignee_label TEXT NOT NULL
    );
    CREATE TABLE trade_rental_inspections (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      assessor_uid TEXT NOT NULL,
      assessor_member_id TEXT NOT NULL,
      assessor_snapshot TEXT NOT NULL CHECK (json_valid(assessor_snapshot)),
      property_snapshot TEXT NOT NULL CHECK (json_valid(property_snapshot)),
      submitted_at TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_rental_inspection_modules (
      id TEXT PRIMARY KEY NOT NULL,
      inspection_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      credential_snapshot TEXT NOT NULL CHECK (json_valid(credential_snapshot)),
      completed_by_uid TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_rental_inspection_events (
      id TEXT PRIMARY KEY NOT NULL,
      inspection_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      report_link_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_uid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT NOT NULL CHECK (json_valid(metadata)),
      source_ip_sha256 TEXT NOT NULL,
      user_agent_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO trade_work_orders VALUES (
      'work-1', 'owner-1', 'active', 'member-2', 'Alex Assessor', 12,
      '${ASSIGNMENT_CHANGED_AT}'
    );
    INSERT INTO trade_team_members VALUES
      ('member-1', 'owner-1', 'active', 'assessor-uid-1'),
      ('member-2', 'owner-1', 'active', 'assessor-uid-2');
    INSERT INTO trade_crm_appointments VALUES (
      'appointment-1', 'work-1', 'owner-1', 'scheduled',
      '${APPOINTMENT_START}', '${APPOINTMENT_END}', 'member-2', 'Alex Assessor'
    );
    INSERT INTO trade_rental_inspections VALUES (
      'inspection-1', 'work-1', 'owner-1', 'draft', '', '', '{}', '{}', '', 3,
      '2026-08-23T00:00:00.000Z'
    );
    INSERT INTO trade_rental_inspection_modules VALUES (
      'module-1', 'inspection-1', 'owner-1', 'draft', '{}', '', '', 2,
      '2026-08-23T00:00:00.000Z'
    );
  `);
  return { database, d1: sqliteD1(database) };
}

function inspectionRow(database) {
  return database.prepare("SELECT * FROM trade_rental_inspections WHERE id = 'inspection-1'").get();
}

function moduleRow(database) {
  return database.prepare("SELECT * FROM trade_rental_inspection_modules WHERE id = 'module-1'").get();
}

function assignmentState(database) {
  return {
    inspection: inspectionRow(database),
    module: moduleRow(database),
    rentalEvents: database.prepare("SELECT * FROM trade_rental_inspection_events ORDER BY id").all(),
    guardEvents: database.prepare("SELECT * FROM trade_work_order_events ORDER BY id").all(),
  };
}

function configureStoredAssessor(database, {
  assessorMemberId,
  assessorUid,
  displayName = assessorMemberId === "member-2" ? "Alex Assessor" : "Previous Assessor",
  status,
  submittedAt = "",
}) {
  database.prepare(`UPDATE trade_rental_inspections
    SET status = ?, assessor_uid = ?, assessor_member_id = ?,
      assessor_snapshot = json_object('memberId', ?, 'uid', ?, 'displayName', ?),
      submitted_at = ?, revision = 4, updated_at = '2026-08-23T01:00:00.000Z'
    WHERE id = 'inspection-1'`)
    .run(status, assessorUid, assessorMemberId, assessorMemberId, assessorUid, displayName, submittedAt);
}

function configureCompletedModule(database, assessorMemberId) {
  database.prepare(`UPDATE trade_rental_inspection_modules
    SET status = 'complete',
      credential_snapshot = json_object(
        'assessorMemberId', ?, 'licenceNumber', 'LIC-123', 'declaration', 'Reviewed'
      ),
      completed_by_uid = 'assessor-uid', completed_at = '2026-08-23T02:00:00.000Z',
      revision = 7, updated_at = '2026-08-23T02:00:00.000Z'
    WHERE id = 'module-1'`)
    .run(assessorMemberId);
}

async function applyRentalAssignment(fixture, input) {
  return fixture.d1.batch(rentalInspectionAssignmentStatements(fixture.d1, input));
}

async function assertAtomicAssignmentAbort(fixture, input) {
  const before = assignmentState(fixture.database);
  await assert.rejects(
    applyRentalAssignment(fixture, input),
    /NOT NULL constraint failed: trade_work_order_events\.summary/,
  );
  assert.deepEqual(assignmentState(fixture.database), before);
}

test("rental assignment helper preserves SQL placeholder parity across assignment and appointment states", () => {
  const baseInput = {
    actorType: "owner",
    actorUid: "owner-1",
    assigneeLabel: "Alex Assessor",
    assigneeMemberId: "member-2",
    changedAt: "2026-08-24T05:06:07.000Z",
    jobRevision: 12,
    ownerUid: "owner-1",
    workOrderId: "work-1",
  };
  const appointment = {
    id: "appointment-1",
    startsAt: "2026-08-25T09:00:00.000Z",
    endsAt: "2026-08-25T10:30:00.000Z",
  };
  const scenarios = [
    {
      label: "changed assignee with appointment",
      appointment,
      previousAssigneeMemberId: "member-1",
      assignmentChanged: true,
      eventType: "assessment_schedule_synchronised",
    },
    {
      label: "unchanged assignee with appointment",
      appointment,
      previousAssigneeMemberId: "member-2",
      assignmentChanged: false,
      eventType: "assessment_schedule_synchronised",
    },
    {
      label: "changed assignee without appointment",
      previousAssigneeMemberId: "member-1",
      assignmentChanged: true,
      eventType: "assessor_assignment_synchronised",
    },
    {
      label: "unchanged assignee without appointment",
      previousAssigneeMemberId: "member-2",
      assignmentChanged: false,
      eventType: "assessor_assignment_synchronised",
    },
  ];

  for (const scenario of scenarios) {
    const input = {
      ...baseInput,
      ...(scenario.appointment ? { appointment: scenario.appointment } : {}),
      previousAssigneeMemberId: scenario.previousAssigneeMemberId,
    };
    const statements = captureAssignmentStatements(input);
    assert.equal(statements.length, 4, `${scenario.label}: expected one atomic four-statement invariant`);
    for (const statement of statements) {
      assert.equal(
        countMatches(statement.sql, /\?/g),
        statement.bindings.length,
        `${scenario.label}: SQL placeholder and binding counts differ`,
      );
    }

    const [moduleReset, inspectionUpdate, inspectionEvent, failClosedGuard] = statements;
    assert.match(inspectionUpdate.sql, /^UPDATE trade_rental_inspections/);
    assert.match(moduleReset.sql, /^UPDATE trade_rental_inspection_modules/);
    assert.match(inspectionEvent.sql, /^INSERT INTO trade_rental_inspection_events/);
    assert.match(failClosedGuard.sql, /^INSERT INTO trade_work_order_events/);
    assert.match(failClosedGuard.sql, /'rental_assignment_guard', NULL/);
    assert.match(failClosedGuard.sql, /'issuing', 'issued', 'superseded', 'withdrawn'/);

    assert.equal(inspectionUpdate.bindings[0], baseInput.assigneeMemberId, `${scenario.label}: stored-assessor comparison`);
    assert.equal(inspectionUpdate.bindings[1], scenario.appointment ? 1 : 0, `${scenario.label}: appointment flag`);
    assert.match(moduleReset.sql, /inspection\.assessor_member_id[\s\S]*?<> \?/);
    assert.match(moduleReset.sql, /credential_snapshot[\s\S]*?\$\.assessorMemberId/);
    assert.match(failClosedGuard.sql, /assessment_module\.status = 'complete'[\s\S]*?\$\.assessorMemberId/);
    assert.match(failClosedGuard.sql, /FROM trade_team_members active_assessor/);
    assert.equal(inspectionEvent.bindings[3], scenario.eventType, `${scenario.label}: event type`);

    const metadata = JSON.parse(inspectionEvent.bindings[5]);
    assert.deepEqual(metadata.appointment, scenario.appointment || null, `${scenario.label}: appointment metadata`);
    assert.equal(metadata.assigneeMemberId, baseInput.assigneeMemberId);
    assert.equal(metadata.previousAssigneeMemberId, scenario.previousAssigneeMemberId);
    assert.equal(metadata.jobAssignmentChanged, scenario.assignmentChanged);
    assert.equal(metadata.declarationRevalidationChecked, true);

    const assignmentSql = `${inspectionUpdate.sql}\n${failClosedGuard.sql}`;
    for (const key of ["assessorMemberId", "assessorLabel"]) {
      assert.match(assignmentSql, new RegExp(`\\$\\.appointment\\.${key}`));
    }
    for (const key of ["id", "startsAt", "endsAt"]) {
      const path = `$.appointment.${key}`;
      assert.equal(
        assignmentSql.includes(path),
        Boolean(scenario.appointment),
        `${scenario.label}: ${path} inclusion`,
      );
    }
  }
});

test("rental assignment sqlite batch synchronises the initial appointment, assessor and status", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());

  await applyRentalAssignment(fixture, assignmentInput());

  const inspection = inspectionRow(fixture.database);
  assert.equal(inspection.status, "scheduled");
  assert.equal(inspection.assessor_uid, "assessor-uid-2");
  assert.equal(inspection.assessor_member_id, "member-2");
  assert.deepEqual(JSON.parse(inspection.assessor_snapshot), {
    memberId: "member-2",
    uid: "assessor-uid-2",
    displayName: "Alex Assessor",
  });
  assert.deepEqual(JSON.parse(inspection.property_snapshot).appointment, {
    assessorMemberId: "member-2",
    assessorLabel: "Alex Assessor",
    id: "appointment-1",
    startsAt: APPOINTMENT_START,
    endsAt: APPOINTMENT_END,
  });
  assert.equal(inspection.updated_at, ASSIGNMENT_CHANGED_AT);
  assert.equal(inspection.revision, 4);

  const events = fixture.database.prepare(
    "SELECT event_type, metadata FROM trade_rental_inspection_events",
  ).all();
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "assessment_schedule_synchronised");
  assert.equal(JSON.parse(events[0].metadata).assigneeMemberId, "member-2");
  assert.equal(
    fixture.database.prepare("SELECT COUNT(*) AS count FROM trade_work_order_events").get().count,
    0,
  );
});

test("rental assignment sqlite batch preserves a valid completed credential on a time-only update", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());
  configureStoredAssessor(fixture.database, {
    assessorMemberId: "member-2",
    assessorUid: "assessor-uid-2",
    status: "scheduled",
  });
  fixture.database.exec(`UPDATE trade_rental_inspections
    SET property_snapshot = json_object('appointment', json_object(
      'assessorMemberId', 'member-2',
      'assessorLabel', 'Alex Assessor',
      'id', 'appointment-1',
      'startsAt', '2026-08-25T08:00:00.000Z',
      'endsAt', '2026-08-25T09:30:00.000Z'
    ))
    WHERE id = 'inspection-1'`);
  configureCompletedModule(fixture.database, "member-2");
  const completedModule = moduleRow(fixture.database);

  await applyRentalAssignment(fixture, assignmentInput({
    previousAssigneeMemberId: "member-2",
  }));

  assert.deepEqual(moduleRow(fixture.database), completedModule);
  const inspection = inspectionRow(fixture.database);
  assert.equal(inspection.status, "scheduled");
  assert.equal(inspection.assessor_member_id, "member-2");
  assert.equal(JSON.parse(inspection.property_snapshot).appointment.startsAt, APPOINTMENT_START);
  assert.equal(JSON.parse(inspection.property_snapshot).appointment.endsAt, APPOINTMENT_END);
});

test("rental assignment sqlite batch repairs a stale stored assessor and reopens declarations", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());
  configureStoredAssessor(fixture.database, {
    assessorMemberId: "member-1",
    assessorUid: "assessor-uid-1",
    status: "submitted",
    submittedAt: "2026-08-23T03:00:00.000Z",
  });
  configureCompletedModule(fixture.database, "member-1");

  await applyRentalAssignment(fixture, assignmentInput({
    previousAssigneeMemberId: "member-1",
  }));

  const inspection = inspectionRow(fixture.database);
  assert.equal(inspection.status, "in_progress");
  assert.equal(inspection.assessor_uid, "assessor-uid-2");
  assert.equal(inspection.assessor_member_id, "member-2");
  assert.equal(inspection.submitted_at, "");

  const assessmentModule = moduleRow(fixture.database);
  assert.equal(assessmentModule.status, "draft");
  assert.deepEqual(JSON.parse(assessmentModule.credential_snapshot), {});
  assert.equal(assessmentModule.completed_by_uid, "");
  assert.equal(assessmentModule.completed_at, "");
  assert.equal(assessmentModule.revision, 8);
  assert.equal(assessmentModule.updated_at, ASSIGNMENT_CHANGED_AT);
});

test("rental assignment sqlite batch atomically rejects appointment-row mismatch", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());
  configureStoredAssessor(fixture.database, {
    assessorMemberId: "member-1",
    assessorUid: "assessor-uid-1",
    status: "submitted",
    submittedAt: "2026-08-23T03:00:00.000Z",
  });
  configureCompletedModule(fixture.database, "member-1");
  fixture.database.exec(`UPDATE trade_crm_appointments
    SET ends_at = '2026-08-25T11:00:00.000Z'
    WHERE id = 'appointment-1'`);

  await assertAtomicAssignmentAbort(fixture, assignmentInput({
    previousAssigneeMemberId: "member-1",
  }));
});

test("rental assignment sqlite batch atomically rejects a second active appointment", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());
  configureStoredAssessor(fixture.database, {
    assessorMemberId: "member-1",
    assessorUid: "assessor-uid-1",
    status: "submitted",
    submittedAt: "2026-08-23T03:00:00.000Z",
  });
  configureCompletedModule(fixture.database, "member-1");
  fixture.database.exec(`INSERT INTO trade_crm_appointments VALUES (
    'appointment-2', 'work-1', 'owner-1', 'en_route',
    '2026-08-25T12:00:00.000Z', '2026-08-25T13:00:00.000Z',
    'member-2', 'Alex Assessor'
  )`);

  await assertAtomicAssignmentAbort(fixture, assignmentInput({
    previousAssigneeMemberId: "member-1",
  }));
});

test("rental assignment sqlite batch atomically rejects a terminal inspection", async (t) => {
  const fixture = rentalAssignmentFixture();
  t.after(() => fixture.database.close());
  configureStoredAssessor(fixture.database, {
    assessorMemberId: "member-1",
    assessorUid: "assessor-uid-1",
    status: "issued",
    submittedAt: "2026-08-23T03:00:00.000Z",
  });
  configureCompletedModule(fixture.database, "member-1");

  await assertAtomicAssignmentAbort(fixture, assignmentInput({
    previousAssigneeMemberId: "member-1",
  }));
});

test("rental assignment sqlite batch atomically rejects a missing or inactive nonempty member", async (t) => {
  for (const memberState of ["missing", "inactive"]) {
    await t.test(memberState, async (subtest) => {
      const fixture = rentalAssignmentFixture();
      subtest.after(() => fixture.database.close());
      if (memberState === "missing") {
        fixture.database.exec("DELETE FROM trade_team_members WHERE id = 'member-2'");
      } else {
        fixture.database.exec(
          "UPDATE trade_team_members SET status = 'suspended' WHERE id = 'member-2'",
        );
      }

      await assertAtomicAssignmentAbort(fixture, assignmentInput());
    });
  }
});

test("every user-facing assignment and schedule mutation routes through the shared rental invariant", async () => {
  const [
    crmRoute,
    scheduleRoute,
    teamRoute,
    businessHubRoute,
    crmWorkspace,
    scheduleWorkspace,
    teamPortal,
    businessHub,
  ] = await Promise.all([
    source("src/app/api/trade-crm/route.ts"),
    source("src/app/api/trade-schedule/route.ts"),
    source("src/app/api/trade-team/route.ts"),
    source("src/app/api/trade-work-orders/route.ts"),
    source("src/components/InstallerCrmWorkspace.tsx"),
    source("src/components/TradeScheduleWorkspace.tsx"),
    source("src/components/TradeTeamPortal.tsx"),
    source("src/components/TradeBusinessHub.tsx"),
  ]);

  assert.match(crmWorkspace, /action: "create_appointment"/);
  assertActionUsesAssignmentHelper(crmRoute, "create_appointment");
  assert.match(crmRoute, /isRentalInspectionAssignmentConflict\(error\)/);
  assert.match(crmRoute, /RENTAL_ACTIVE_APPOINTMENT/);
  assert.match(crmRoute, /appointment:\s*\{[\s\S]{0,180}id: appointmentId,[\s\S]{0,180}startsAt,[\s\S]{0,180}endsAt/);
  assert.equal(countMatches(crmRoute, /\.\.\.rentalInspectionAssignmentStatements\(/g), 1);

  for (const action of ["review_reschedule_request", "save_schedule_changes", "schedule_job"]) {
    assert.match(scheduleWorkspace, new RegExp(`action: "${action}"`));
    assertActionUsesAssignmentHelper(scheduleRoute, action);
  }
  assert.doesNotMatch(scheduleWorkspace, /action: "schedule_appointment"/);
  assertActionUsesAssignmentHelper(scheduleRoute, "schedule_appointment");
  assert.match(scheduleRoute, /isRentalInspectionAssignmentConflict\(error\)/);
  assert.match(scheduleRoute, /RENTAL_ACTIVE_APPOINTMENT/);
  assert.equal(countMatches(scheduleRoute, /\.\.\.rentalInspectionAssignmentStatements\(/g), 4);

  assert.match(teamPortal, /action: "assign_job"/);
  assertActionUsesAssignmentHelper(teamRoute, "assign_job");
  assert.match(teamRoute, /RENTAL_ACTIVE_APPOINTMENT/);
  assert.equal(countMatches(teamRoute, /\.\.\.rentalInspectionAssignmentStatements\(/g), 1);

  assert.match(businessHub, /action: "update_work_order"/);
  assert.match(businessHubRoute, /service_category[\s\S]*?RENTAL_SCHEDULE_WORKFLOW_REQUIRED/);
  assert.match(businessHubRoute, /body\.assigneeLabel !== undefined[\s\S]*?body\.scheduledStart !== undefined[\s\S]*?body\.scheduledEnd !== undefined/);
  assert.doesNotMatch(businessHubRoute, /rentalInspectionAssignmentStatements/);
});

test("rental report permissions and field images require matching live assignment and capture metadata", async () => {
  const [assessmentRoute, reportServer, fieldRoute, teamSyncRoute] = await Promise.all([
    source("src/app/api/trade-rental-inspections/route.ts"),
    source("src/lib/trade-rental-report-server.ts"),
    source("src/app/api/trade-field-work/route.ts"),
    source("src/app/api/trade-team/sync/route.ts"),
  ]);

  assert.match(assessmentRoute, /canIssue:[\s\S]{0,220}inspection\.assessor_member_id[\s\S]{0,220}job\.assignee_member_id/);
  assert.match(assessmentRoute, /canRevokeLink:[\s\S]{0,320}inspection\.assessor_member_id[\s\S]{0,220}job\.assignee_member_id/);
  assert.match(assessmentRoute, /isAssignedAssessor:[\s\S]{0,220}inspection\.assessor_member_id[\s\S]{0,220}job\.assignee_member_id/);
  assert.match(assessmentRoute, /async function completeModule[\s\S]{0,260}inspection\.assessor_member_id[\s\S]{0,180}job\.assignee_member_id/);

  assert.match(reportServer, /const job = await assignedJob\(access, workOrderId\)/);
  assert.match(reportServer, /inspection\.assessor_member_id[\s\S]{0,160}job\.assignee_member_id[\s\S]{0,120}ASSESSOR_REQUIRED/);
  assert.ok(countMatches(reportServer, /assessor_member_id = \?/g) >= 3, "report issue transitions must retain assessor SQL guards");
  assert.ok(
    countMatches(reportServer, /assessor_member_id \|\| ""\) !== input\.access\.memberId/g) >= 3,
    "report link, revoke and download must retain assessor checks",
  );

  assert.match(fieldRoute, /rentalEvidencePhotoCapture\(evidenceEnvelope, \{ receivedAtUtc: now \}\)/);
  assert.match(assessmentRoute, /rentalEvidencePhotoCapture\(media\.evidence_envelope, \{ receivedAtUtc: String\(media\.created_at \|\| ""\) \}\)/);
  assert.match(reportServer, /rentalEvidencePhotoCapture\(evidence\.evidence_envelope\)/);

  assert.match(teamSyncRoute, /\(\? <> 'own' OR work_order\.assignee_member_id = \?\)/);
  assert.match(teamSyncRoute, /canIssue: access\.canRunReports[\s\S]{0,220}rental\.assessor_member_id[\s\S]{0,180}row\.assignee_member_id[\s\S]{0,100}!terminal/);
});
