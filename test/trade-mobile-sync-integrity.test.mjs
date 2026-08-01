import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/app/api/trade-team/sync/route.ts", import.meta.url),
  "utf8",
);

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database) {
  let beforeNextBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    injectBeforeNextBatch(callback) {
      beforeNextBatch = callback;
    },
    async batch(statements) {
      if (beforeNextBatch) {
        const callback = beforeNextBatch;
        beforeNextBatch = null;
        callback();
      }
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadRoute(mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: "src/app/api/trade-team/sync/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function syncDatabase(stage = "in_progress", revision = 5) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      partner_type text NOT NULL,
      record_status text NOT NULL,
      stage text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_job_forms (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      template_key text NOT NULL,
      template_snapshot text NOT NULL,
      status text NOT NULL,
      revision integer NOT NULL,
      answers text NOT NULL,
      completed_by_uid text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_notes (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      note_type text NOT NULL,
      issue_status text NOT NULL
    );
    CREATE TABLE trade_crm_job_plans (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      completed_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_job_plan_phases (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_plan_requirements (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requests (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      revision integer NOT NULL,
      requirements text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      photo_request_id text NOT NULL,
      photo_requirement_id text NOT NULL,
      source text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requirement_reviews (
      id text PRIMARY KEY NOT NULL,
      photo_request_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      request_revision integer NOT NULL,
      review_revision integer NOT NULL,
      photo_requirement_id text NOT NULL,
      status text NOT NULL,
      reason_code text NOT NULL,
      guidance text NOT NULL,
      reviewed_upload_count integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_request_completions (
      id text PRIMARY KEY NOT NULL,
      photo_request_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      request_revision integer NOT NULL,
      completion_revision integer NOT NULL,
      checklist_version text NOT NULL,
      evidence_key text NOT NULL,
      required_count integer NOT NULL,
      supplied_count integer NOT NULL,
      completed_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      starts_at text NOT NULL,
      travel_started_at text NOT NULL DEFAULT '',
      arrived_at text NOT NULL DEFAULT '',
      work_started_at text NOT NULL DEFAULT '',
      completed_at text NOT NULL DEFAULT '',
      last_transition_by_uid text NOT NULL DEFAULT '',
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      pipeline_stage text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_offline_actions (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      actor_uid text NOT NULL,
      member_id text NOT NULL,
      device_id text NOT NULL,
      client_action_id text NOT NULL,
      payload_hash text NOT NULL,
      action_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      base_revision integer NOT NULL,
      result_revision integer NOT NULL,
      status text NOT NULL,
      lease_until text NOT NULL,
      error_code text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (owner_uid, client_action_id)
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      event_type text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_team_sync_changes (
      sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      operation text NOT NULL,
      revision integer NOT NULL,
      changed_at text NOT NULL
    );
    CREATE TABLE trade_mobile_push_outbox (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      event_key text NOT NULL UNIQUE,
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      payload text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, partner_type, record_status, stage, revision, updated_at)
    VALUES ('job-1', 'owner-1', 'installer', 'active', ?, ?, 'initial')`)
    .run(stage, revision);
  database.prepare(`INSERT INTO trade_work_order_tasks
    (id, work_order_id, firebase_uid, status, completed_at, revision, updated_at)
    VALUES ('task-1', 'job-1', 'owner-1', 'pending', '', 2, 'initial')`)
    .run();
  database.prepare(`INSERT INTO trade_job_forms
    (id, work_order_id, firebase_uid, template_key, template_snapshot,
     status, revision, answers, completed_by_uid, completed_at, updated_at)
    VALUES ('form-1', 'job-1', 'owner-1', 'field-form',
      '{"name":"Field form","fields":[]}', 'draft', 1, '{}', '', '', 'initial')`)
    .run();
  return database;
}

function routeHarness(database, { assigned = true } = {}) {
  const d1 = testD1(database);
  const access = {
    ownerUid: "owner-1",
    actorUid: "actor-1",
    memberId: "member-1",
    role: "technician",
    displayName: "Field technician",
  };
  const route = loadRoute({
    "../../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      cleanAdminText: (value, maximum) => (
        typeof value === "string" ? value.trim().slice(0, maximum) : ""
      ),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      assignedJob: async (_access, workOrderId) => {
        if (!assigned) throw new Error("JOB_NOT_ASSIGNED");
        const row = database.prepare(`SELECT revision FROM trade_work_orders
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
          .get(workOrderId, access.ownerUid);
        if (!row) throw new Error("JOB_NOT_FOUND");
        return {
          revision: Number(row.revision),
          assignee_member_id: "member-1",
          source_type: "internal",
          source_reference: "",
        };
      },
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": {
      nextJobRevision: (value) => Number(value) + 1,
    },
    "@/lib/trade-mobile-server": {
      mobileAppPolicy: () => ({ contractVersion: 3 }),
      mobileErrorResponse: () => null,
      MOBILE_CLIENT_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/,
      MOBILE_CONTRACT_VERSION: 3,
      requireRegisteredMobileDevice: async () => ({
        deviceId: "device-001",
        deviceName: "Field phone",
        platform: "ios",
      }),
    },
    "@/lib/trade-form-library.mjs": {
      normalizeTradeFormAnswers: () => ({}),
      tradeFormCompletion: () => ({ ready: true, missing: [] }),
    },
    "@/lib/asset-lifecycle.mjs": {
      addMonthsToIsoDate: (value) => value,
    },
    "@/lib/photo-request-review": {
      photoRequestEvidenceKey: async (input) => [
        input.requestId,
        input.requestRevision,
        input.checklistVersion,
        ...[...input.mediaIds].sort(),
      ].join("|"),
    },
    "@/lib/trade-photo-requests": {
      normalisePhotoRequirements: (value) => value,
    },
  });
  return { route, d1 };
}

function seedReadyPhotoProof(database) {
  const requirements = JSON.stringify([{
    id: "photo-required",
    label: "Installed unit",
    required: true,
  }]);
  database.prepare(`INSERT INTO trade_crm_photo_requests
    (id, work_order_id, firebase_uid, revision, requirements, status)
    VALUES ('photo-request-1', 'job-1', 'owner-1', 1, ?, 'completed')`)
    .run(requirements);
  database.prepare(`INSERT INTO trade_crm_job_media
    (id, work_order_id, firebase_uid, photo_request_id,
     photo_requirement_id, source, created_at)
    VALUES ('photo-media-1', 'job-1', 'owner-1', 'photo-request-1',
      'photo-required', 'customer_request', '2026-08-01T00:00:00.000Z')`)
    .run();
  database.prepare(`INSERT INTO trade_crm_photo_requirement_reviews
    (id, photo_request_id, work_order_id, firebase_uid, request_revision,
     review_revision, photo_requirement_id, status, reason_code, guidance,
     reviewed_upload_count, created_at)
    VALUES ('photo-review-1', 'photo-request-1', 'job-1', 'owner-1', 1,
      1, 'photo-required', 'accepted', '', '', 1,
      '2026-08-01T00:01:00.000Z')`)
    .run();
  database.prepare(`INSERT INTO trade_crm_photo_request_completions
    (id, photo_request_id, work_order_id, firebase_uid, request_revision,
     completion_revision, checklist_version, evidence_key, required_count,
     supplied_count, completed_at)
    VALUES ('photo-completion-1', 'photo-request-1', 'job-1', 'owner-1', 1,
      1, 'checklist-1',
      'photo-request-1|1|checklist-1|photo-media-1', 1, 1,
      '2026-08-01T00:02:00.000Z')`)
    .run();
}

function prepareFinishableJob(database) {
  database.prepare("DELETE FROM trade_work_order_tasks").run();
  database.prepare("DELETE FROM trade_job_forms").run();
  database.prepare(`INSERT INTO trade_crm_appointments
    (id, work_order_id, firebase_uid, status, starts_at,
     travel_started_at, arrived_at, work_started_at, completed_at,
     last_transition_by_uid, revision, updated_at)
    VALUES ('appointment-1', 'job-1', 'owner-1', 'in_progress',
      '2026-08-01T00:00:00.000Z', '', '', '2026-08-01T00:10:00.000Z',
      '', 'actor-1', 1, 'initial')`)
    .run();
  seedReadyPhotoProof(database);
}

async function postActions(route, actions) {
  const response = await route.POST(new Request(
    "https://app.example/api/trade-team/sync",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-001",
        platform: "ios",
        appVersion: "1.0.0",
        actions,
      }),
    },
  ));
  return { response, payload: await response.json() };
}

test("offline stage changes cannot complete blocked work or reopen a terminal job", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route } = routeHarness(database);
  let result = await postActions(route, [{
    clientActionId: "action-stage-complete",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "completed",
  }]);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.results[0].code, "FINISH_BLOCKED");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision FROM trade_work_orders
      WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);

  database.prepare(`UPDATE trade_work_orders
    SET stage = 'completed' WHERE id = 'job-1'`).run();
  result = await postActions(route, [{
    clientActionId: "action-stage-reopen",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 5,
    stage: "backlog",
  }]);
  assert.equal(result.payload.results[0].code, "JOB_TERMINAL");
  assert.equal(database.prepare("SELECT stage FROM trade_work_orders WHERE id = 'job-1'").get().stage, "completed");
});

for (const terminalStage of ["completed", "cancelled"]) {
  test(`all offline mutations reject immutable ${terminalStage} jobs`, async () => {
    const database = syncDatabase(terminalStage, 5);
    const { route } = routeHarness(database);
    const { payload } = await postActions(route, [
      {
        clientActionId: `terminal-stage-${terminalStage}`,
        type: "set_job_stage",
        workOrderId: "job-1",
        baseRevision: 5,
        stage: "ready",
      },
      {
        clientActionId: `terminal-task-${terminalStage}`,
        type: "set_task_status",
        workOrderId: "job-1",
        taskId: "task-1",
        baseRevision: 2,
        status: "done",
      },
      {
        clientActionId: `terminal-form-${terminalStage}`,
        type: "save_job_form",
        workOrderId: "job-1",
        formId: "form-1",
        baseRevision: 1,
        answers: {},
        complete: false,
      },
      {
        clientActionId: `terminal-time-${terminalStage}`,
        type: "add_time_entry",
        workOrderId: "job-1",
        baseRevision: 5,
        workDate: "2026-08-01",
        durationMinutes: 30,
        notes: "",
      },
      {
        clientActionId: `terminal-field-${terminalStage}`,
        type: "advance_field_job",
        workOrderId: "job-1",
        baseRevision: 5,
        transition: "start_work",
      },
    ]);
    assert.deepEqual(
      payload.results.map((item) => item.code),
      Array(5).fill("JOB_TERMINAL"),
    );
    assert.deepEqual(
      { ...database.prepare(`SELECT stage, revision, updated_at
        FROM trade_work_orders WHERE id = 'job-1'`).get() },
      { stage: terminalStage, revision: 5, updated_at: "initial" },
    );
    assert.deepEqual(
      { ...database.prepare(`SELECT status, revision, updated_at
        FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
      { status: "pending", revision: 2, updated_at: "initial" },
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 0);
  });
}

test("a concurrent job CAS loss rolls back child, receipt, event and sync writes", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route, d1 } = routeHarness(database);
  const action = {
    clientActionId: "action-task-race",
    type: "set_task_status",
    workOrderId: "job-1",
    taskId: "task-1",
    baseRevision: 2,
    status: "done",
  };
  d1.injectBeforeNextBatch(() => {
    database.prepare(`UPDATE trade_work_orders
      SET revision = 9, updated_at = 'concurrent'
      WHERE id = 'job-1'`).run();
  });
  const { payload } = await postActions(route, [action]);
  assert.equal(payload.results[0].status, "conflict");
  assert.equal(payload.results[0].currentJobRevision, 9);
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision, updated_at
      FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
    { status: "pending", revision: 2, updated_at: "initial" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 9, updated_at: "concurrent" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, result_revision
      FROM trade_offline_actions WHERE client_action_id = 'action-task-race'`).get() },
    { status: "conflict", result_revision: 9 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 0);
  const replay = await postActions(route, [action]);
  assert.deepEqual(
    {
      status: replay.payload.results[0].status,
      entityId: replay.payload.results[0].entityId,
      currentRevision: replay.payload.results[0].currentRevision,
      currentJobRevision: replay.payload.results[0].currentJobRevision,
    },
    {
      status: "conflict",
      entityId: "task-1",
      currentRevision: 2,
      currentJobRevision: 9,
    },
  );
});

test("stale task and form conflicts include both child and current job revisions", async () => {
  const database = syncDatabase("in_progress", 5);
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [
    {
      clientActionId: "action-task-stale",
      type: "set_task_status",
      workOrderId: "job-1",
      taskId: "task-1",
      baseRevision: 1,
      status: "done",
    },
    {
      clientActionId: "action-form-stale",
      type: "save_job_form",
      workOrderId: "job-1",
      formId: "form-1",
      baseRevision: 2,
      answers: {},
    },
  ]);
  assert.deepEqual(
    payload.results.map((result) => ({
      status: result.status,
      entityId: result.entityId,
      currentRevision: result.currentRevision,
      currentJobRevision: result.currentJobRevision,
    })),
    [
      {
        status: "conflict",
        entityId: "task-1",
        currentRevision: 2,
        currentJobRevision: 5,
      },
      {
        status: "conflict",
        entityId: "form-1",
        currentRevision: 1,
        currentJobRevision: 5,
      },
    ],
  );
});

test("conflict replay reasserts technician assignment before returning revisions", async () => {
  const database = syncDatabase("in_progress", 5);
  database.prepare(`INSERT INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id,
     payload_hash, action_type, entity_type, entity_id, base_revision,
     result_revision, status, lease_until, error_code, created_at, updated_at)
    VALUES ('receipt-unassigned', 'owner-1', 'actor-1', 'member-1',
      'device-001', 'action-task-unassigned', '', 'set_task_status', 'job',
      'job-1', 2, 5, 'conflict', '', 'REVISION_CONFLICT', 'initial', 'initial')`)
    .run();
  const action = {
    clientActionId: "action-task-unassigned",
    type: "set_task_status",
    workOrderId: "job-1",
    taskId: "task-1",
    baseRevision: 2,
    status: "done",
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(
      Object.fromEntries(
        Object.entries(action).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )),
  );
  const hashText = Buffer.from(hash).toString("base64url");
  database.prepare(`UPDATE trade_offline_actions SET payload_hash = ?
    WHERE id = 'receipt-unassigned'`).run(hashText);
  const { route } = routeHarness(database, { assigned: false });
  const { payload } = await postActions(route, [action]);
  assert.deepEqual(payload.results[0], {
    clientActionId: "action-task-unassigned",
    status: "rejected",
    code: "JOB_NOT_ASSIGNED",
    error: "This job is no longer assigned to this team account.",
  });
});

test("an allowed nonterminal stage change writes its receipt, event, sync audiences and push", async () => {
  const database = syncDatabase("backlog", 1);
  database.prepare("DELETE FROM trade_work_order_tasks").run();
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [{
    clientActionId: "action-stage-ready",
    type: "set_job_stage",
    workOrderId: "job-1",
    baseRevision: 1,
    stage: "ready",
  }]);
  assert.equal(payload.results[0].status, "applied");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "ready", revision: 2 },
  );
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_offline_actions WHERE status = 'applied'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 1);
});

test("finish atomically reasserts required photo proof and writes one completion", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  const { route } = routeHarness(database);
  const { payload } = await postActions(route, [{
    clientActionId: "action-finish-success",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(payload.results[0].status, "applied");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "completed", revision: 6 },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision
      FROM trade_crm_appointments WHERE id = 'appointment-1'`).get() },
    { status: "completed", revision: 2 },
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count FROM trade_offline_actions
      WHERE status = 'applied'`).get().count,
    1,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    2,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
    2,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count,
    1,
  );
});

test("a concurrent photo-proof change rolls back the entire finish batch", async () => {
  const database = syncDatabase("in_progress", 5);
  prepareFinishableJob(database);
  const { route, d1 } = routeHarness(database);
  d1.injectBeforeNextBatch(() => {
    database.prepare(`INSERT INTO trade_crm_photo_requirement_reviews
      (id, photo_request_id, work_order_id, firebase_uid, request_revision,
       review_revision, photo_requirement_id, status, reason_code, guidance,
       reviewed_upload_count, created_at)
      VALUES ('photo-review-2', 'photo-request-1', 'job-1', 'owner-1', 1,
        2, 'photo-required', 'retake_requested', 'clearer_photo',
        'Take a clearer photo.', 1, '2026-08-01T00:03:00.000Z')`)
      .run();
  });
  const { payload } = await postActions(route, [{
    clientActionId: "action-finish-photo-race",
    type: "advance_field_job",
    workOrderId: "job-1",
    baseRevision: 5,
    transition: "finish",
  }]);
  assert.equal(payload.results[0].status, "conflict");
  assert.deepEqual(
    { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    { stage: "in_progress", revision: 5, updated_at: "initial" },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, revision, completed_at, updated_at
      FROM trade_crm_appointments WHERE id = 'appointment-1'`).get() },
    {
      status: "in_progress",
      revision: 1,
      completed_at: "",
      updated_at: "initial",
    },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, result_revision
      FROM trade_offline_actions
      WHERE client_action_id = 'action-finish-photo-race'`).get() },
    { status: "conflict", result_revision: 5 },
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count,
    0,
  );
});
