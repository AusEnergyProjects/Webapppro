import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

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
  let beforeBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    setBeforeBatch(callback) {
      beforeBatch = callback;
    },
    async batch(statements) {
      const callback = beforeBatch;
      beforeBatch = null;
      if (callback) callback();
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

function loadTypescriptModule(path, mocks) {
  const source = read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
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

const syncHelpers = loadTypescriptModule(
  "../src/lib/trade-team-sync-server.ts",
  {},
);

function fixture(stage = "in_progress", revision = 5) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      partner_type text NOT NULL,
      source_type text NOT NULL,
      source_reference text NOT NULL,
      service_category text NOT NULL,
      record_status text NOT NULL,
      stage text NOT NULL,
      priority text NOT NULL,
      scheduled_start text NOT NULL,
      scheduled_end text NOT NULL,
      revision integer NOT NULL,
      assignee_member_id text NOT NULL,
      assignee_label text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      display_name text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      title text NOT NULL,
      due_at text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      completed_at text NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 1,
      sort_order integer NOT NULL DEFAULT 0,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_job_forms (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      template_key text NOT NULL,
      template_version integer NOT NULL,
      template_name text NOT NULL,
      jurisdiction text NOT NULL,
      template_snapshot text NOT NULL,
      answers text NOT NULL,
      status text NOT NULL,
      revision integer NOT NULL,
      completed_by_uid text NOT NULL,
      completed_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (work_order_id, template_key, template_version)
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
    (id, firebase_uid, partner_type, source_type, source_reference,
     service_category, record_status, stage, priority, scheduled_start, scheduled_end,
     revision, assignee_member_id, assignee_label, updated_at)
    VALUES ('job-1', 'owner-1', 'installer', 'internal', '',
      'other', 'active', ?, 'standard', '', '', ?, '', '', 'initial')`).run(stage, revision);
  database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, display_name, status)
    VALUES ('member-2', 'owner-1', 'Technician Two', 'active')`).run();
  database.prepare(`INSERT INTO trade_work_order_tasks
    (id, work_order_id, firebase_uid, title, status, revision, created_at, updated_at)
    VALUES ('task-1', 'job-1', 'owner-1', 'Existing task', 'pending', 2, 'initial', 'initial')`).run();
  database.prepare(`INSERT INTO trade_job_forms
    (id, work_order_id, firebase_uid, template_key, template_version, template_name,
     jurisdiction, template_snapshot, answers, status, revision, completed_by_uid,
     completed_at, created_at, updated_at)
    VALUES ('form-1', 'job-1', 'owner-1', 'field-form', 1, 'Field form',
      'AU', '{"name":"Field form","fields":[]}', '{}', 'draft', 3, '', '', 'initial', 'initial')`).run();
  return { database, db: testD1(database) };
}

const access = {
  ownerUid: "owner-1",
  actorUid: "actor-1",
  actorEmail: "actor@example.com",
  memberId: "member-1",
  displayName: "Actor",
  role: "owner",
  isOwner: true,
  businessName: "Installer",
};

const adminServer = {
  adminJson: (value, status = 200) => Response.json(value, { status }),
  cleanAdminText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
  parseJsonList: (value) => {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  },
  sameOrigin: () => true,
};

function assignedJobFor(db) {
  return async (_access, workOrderId) => {
    const row = await db.prepare(`SELECT id, source_type, source_reference,
        assignee_member_id, revision
      FROM trade_work_orders
      WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer'
        AND record_status = 'active'`)
      .bind(workOrderId, "owner-1").first();
    if (!row) throw new Error("JOB_NOT_FOUND");
    return row;
  };
}

function teamRoute(db) {
  return loadTypescriptModule("../src/app/api/trade-team/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: "actor-1" }) },
    "@/lib/trade-team-server": {
      assignedJob: assignedJobFor(db),
      canDispatch: () => true,
      canManageTeam: () => true,
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
  });
}

function workOrdersRoute(db) {
  class TradeAccessError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  return loadTypescriptModule("../src/app/api/trade-work-orders/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/direct-trade-entitlements-server": {
      accountEntitlements: async () => ({
        features: { business_operations: true, team_access: true },
      }),
    },
    "@/lib/trade-access-server": {
      requireVerifiedTradeAccess: async () => ({
        identity: { uid: "owner-1" },
        partnerType: "installer",
        businessName: "Installer",
      }),
      TradeAccessError,
    },
    "@/lib/trade-job-number-server": {
      nextTlinkJobNumber: async () => "JOB-1",
      nextTradeWorkNumber: async () => "JOB-1",
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/appointment-notification-server": {
      queueAppointmentNotifications: async () => {},
    },
  });
}

function formsRoute(db) {
  return loadTypescriptModule("../src/app/api/trade-job-forms/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/trade-team-server": {
      assignedJob: assignedJobFor(db),
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-form-library.mjs": {
      normalizeTradeFormAnswers: (_template, answers) => answers || {},
      tradeFormCompletion: () => ({ ready: true, missing: [] }),
    },
    "@/lib/trade-form-templates-server": {
      publishedTradeFormTemplate: async (key, version) => ({
        key,
        version,
        name: "New form",
        jurisdiction: "AU",
        fields: [],
      }),
      publishedTradeFormTemplatesFor: async () => [],
    },
    "@/lib/asset-lifecycle.mjs": {
      addMonthsToIsoDate: () => "2027-01-01",
    },
  });
}

const patchRequest = (body) => new Request("https://example.test/api", {
  method: "PATCH",
  body: JSON.stringify(body),
});

const postRequest = (body) => new Request("https://example.test/api", {
  method: "POST",
  body: JSON.stringify(body),
});

function mutationState(database) {
  return {
    job: { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    task: { ...database.prepare(`SELECT status, revision, updated_at
      FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
    form: { ...database.prepare(`SELECT answers, status, revision, updated_at
      FROM trade_job_forms WHERE id = 'form-1'`).get() },
    tasks: database.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks").get().count,
    forms: database.prepare("SELECT COUNT(*) count FROM trade_job_forms").get().count,
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    syncChanges: database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
  };
}

function directJobState(database) {
  return {
    job: {
      ...database.prepare(`SELECT stage, priority, scheduled_start, scheduled_end,
          revision, assignee_member_id, assignee_label, updated_at
        FROM trade_work_orders WHERE id = 'job-1'`).get(),
    },
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    syncChanges: database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
  };
}

const onlineMutations = [
  {
    name: "team task update",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "update_task",
      taskId: "task-1",
      status: "done",
    })),
  },
  {
    name: "Business Hub task update",
    run: (db) => workOrdersRoute(db).PATCH(patchRequest({
      action: "update_task",
      taskId: "task-1",
      status: "done",
    })),
  },
  {
    name: "Business Hub task creation",
    run: (db) => workOrdersRoute(db).POST(postRequest({
      action: "add_task",
      workOrderId: "job-1",
      title: "New task",
    })),
  },
  {
    name: "field form update",
    run: (db) => formsRoute(db).PATCH(patchRequest({
      workOrderId: "job-1",
      formId: "form-1",
      baseRevision: 3,
      answers: { note: "updated" },
    })),
  },
  {
    name: "field form creation",
    run: (db) => formsRoute(db).POST(postRequest({
      workOrderId: "job-1",
      templateKey: "new-form",
      templateVersion: 1,
    })),
  },
];

for (const stage of ["completed", "cancelled"]) {
  for (const mutation of onlineMutations) {
    test(`${mutation.name} rejects an initially ${stage} job without writes`, async () => {
      const { database, db } = fixture(stage);
      const before = mutationState(database);
      const response = await mutation.run(db);
      assert.equal(response.status, 409);
      assert.deepEqual(mutationState(database), before);
    });
  }
}

for (const mutation of onlineMutations) {
  test(`${mutation.name} rolls back child, parent, event and sync writes on a job race`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_orders
        SET stage = 'completed', revision = 9, updated_at = 'concurrent'
        WHERE id = 'job-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "REVISION_CONFLICT");
    assert.deepEqual(mutationState(database), {
      job: { stage: "completed", revision: 9, updated_at: "concurrent" },
      task: { status: "pending", revision: 2, updated_at: "initial" },
      form: { answers: "{}", status: "draft", revision: 3, updated_at: "initial" },
      tasks: 1,
      forms: 1,
      events: 0,
      syncChanges: 0,
    });
  });
}

for (const mutation of onlineMutations.slice(0, 2)) {
  test(`${mutation.name} preserves a concurrent task revision without partial parent writes`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_order_tasks
        SET status = 'done', revision = 7, updated_at = 'concurrent'
        WHERE id = 'task-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    assert.deepEqual(mutationState(database), {
      job: { stage: "in_progress", revision: 5, updated_at: "initial" },
      task: { status: "done", revision: 7, updated_at: "concurrent" },
      form: { answers: "{}", status: "draft", revision: 3, updated_at: "initial" },
      tasks: 1,
      forms: 1,
      events: 0,
      syncChanges: 0,
    });
  });
}

test("field form update preserves a concurrent form revision without partial parent writes", async () => {
  const { database, db } = fixture();
  db.setBeforeBatch(() => {
    database.prepare(`UPDATE trade_job_forms
      SET answers = '{"note":"concurrent"}', revision = 8, updated_at = 'concurrent'
      WHERE id = 'form-1'`).run();
  });
  const response = await onlineMutations[3].run(db);
  assert.equal(response.status, 409);
  assert.deepEqual(mutationState(database), {
    job: { stage: "in_progress", revision: 5, updated_at: "initial" },
    task: { status: "pending", revision: 2, updated_at: "initial" },
    form: {
      answers: '{"note":"concurrent"}',
      status: "draft",
      revision: 8,
      updated_at: "concurrent",
    },
    tasks: 1,
    forms: 1,
    events: 0,
    syncChanges: 0,
  });
});

test("field form creation preserves a concurrent equivalent form without advancing the parent", async () => {
  const { database, db } = fixture();
  db.setBeforeBatch(() => {
    database.prepare(`INSERT INTO trade_job_forms
      (id, work_order_id, firebase_uid, template_key, template_version, template_name,
       jurisdiction, template_snapshot, answers, status, revision, completed_by_uid,
       completed_at, created_at, updated_at)
      VALUES ('concurrent-form', 'job-1', 'owner-1', 'new-form', 1, 'New form',
        'AU', '{"name":"New form","fields":[]}', '{}', 'draft', 1, '', '',
        'concurrent', 'concurrent')`).run();
  });
  const response = await onlineMutations[4].run(db);
  assert.equal(response.status, 409);
  const state = mutationState(database);
  assert.deepEqual(state.job, {
    stage: "in_progress",
    revision: 5,
    updated_at: "initial",
  });
  assert.equal(state.forms, 2);
  assert.equal(state.events, 0);
  assert.equal(state.syncChanges, 0);
  assert.deepEqual(
    {
      ...database.prepare(`SELECT revision, updated_at FROM trade_job_forms
        WHERE id = 'concurrent-form'`).get(),
    },
    { revision: 1, updated_at: "concurrent" },
  );
});

const directJobMutations = [
  {
    name: "team assignment",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "assign_job",
      workOrderId: "job-1",
      memberId: "member-2",
    })),
  },
  {
    name: "team stage update",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "update_job",
      workOrderId: "job-1",
      stage: "ready",
    })),
  },
  {
    name: "Business Hub job update",
    run: (db) => workOrdersRoute(db).PATCH(patchRequest({
      action: "update_work_order",
      workOrderId: "job-1",
      stage: "ready",
      priority: "high",
      scheduledStart: "2026-08-10",
      scheduledEnd: "2026-08-11",
      assigneeLabel: "Technician Two",
    })),
  },
];

for (const stage of ["completed", "cancelled"]) {
  for (const mutation of directJobMutations) {
    test(`${mutation.name} cannot edit or reopen an initially ${stage} job`, async () => {
      const { database, db } = fixture(stage);
      const before = directJobState(database);
      const response = await mutation.run(db);
      assert.equal(response.status, 409);
      assert.deepEqual(directJobState(database), before);
    });
  }
}

for (const mutation of directJobMutations) {
  test(`${mutation.name} rolls back events and sync writes when the job becomes terminal`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_orders
        SET stage = 'completed', revision = 9, updated_at = 'concurrent'
        WHERE id = 'job-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "REVISION_CONFLICT");
    assert.deepEqual(directJobState(database), {
      job: {
        stage: "completed",
        priority: "standard",
        scheduled_start: "",
        scheduled_end: "",
        revision: 9,
        assignee_member_id: "",
        assignee_label: "",
        updated_at: "concurrent",
      },
      events: 0,
      syncChanges: 0,
    });
  });
}
