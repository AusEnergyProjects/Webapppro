import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");
const CONTRACT = "tlink-creditex-job-intent-v1";
const OWNER_UID = "installer-1";
const WORK_ORDER_ID = "work-1";
const OLD_START = "2026-08-10T09:00";
const SAME_DAY_START = "2026-08-10T15:00";
const NEW_START = "2026-08-18T10:30";
const NOW = "2026-08-04T00:00:00.000Z";
const CHANGED_AT = "2026-08-05T00:00:00.000Z";

function loadTypescriptModule(file, mocks = {}) {
  const source = read(file);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  const execute = new Function("require", "module", "exports", output);
  execute(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const {
  plannedComplianceIntentReplanStatements,
  previousTradeScheduleMutationGuardStatement,
} = loadTypescriptModule(
  "../src/lib/trade-compliance-intent-replan-server.ts",
  {
    "./trade-compliance-intent": {
      stableTradeComplianceIntentJson: (snapshot) => JSON.stringify(snapshot),
      TRADE_COMPLIANCE_INTENT_CONTRACT: CONTRACT,
    },
  },
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

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: result.lastInsertRowid,
      },
    };
  }
}

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function applyIntentSchema(database) {
  database.exec(read("../drizzle/0015_aromatic_black_knight.sql"));
  database.exec(`
    ALTER TABLE trade_work_orders
    ADD COLUMN revision integer DEFAULT 1 NOT NULL;
  `);
  database.exec(read("../drizzle/0115_trade_creditex_job_intent.sql"));
  database.exec(read("../drizzle/0116_trade_crm_write_guard.sql"));
  const multiActivityIntentSchema = read(
    "../drizzle/0119_trade_multi_activity_jobs.sql",
  ).split("ALTER TABLE `compliance_cases`")[0];
  for (const statement of multiActivityIntentSchema
    .split(/;\s*(?=(?:ALTER|UPDATE|DROP|CREATE)\s)/i)
    .map((item) => item.trim())
    .filter(Boolean)) {
    database.exec(`${statement.replace(/;\s*$/, "")};`);
  }
  database.exec(`
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      activity_date text NOT NULL
    );
  `);
  const dateGuard = CREDITEX_SCHEMA_GUARD_DEFINITIONS.find(
    (definition) => definition.name === "compliance_linked_work_order_date_guard",
  );
  assert.ok(dateGuard);
  database.exec(dateGuard.sql);
}

function insertWorkOrder(database, scheduledStart = OLD_START) {
  database.prepare(`
    INSERT INTO trade_work_orders (
      id,
      firebase_uid,
      partner_type,
      work_type,
      source_type,
      source_reference,
      work_number,
      title,
      service_category,
      site_area,
      stage,
      priority,
      scheduled_start,
      scheduled_end,
      assignee_label,
      record_status,
      created_at,
      updated_at
    ) VALUES (
      ?, ?, 'installer', 'job', 'internal', '', 'TLJ-TEST',
      'Governed test job', 'hot_water', 'VIC', 'scheduled', 'standard',
      ?, ?, '', 'active', ?, ?
    )
  `).run(
    WORK_ORDER_ID,
    OWNER_UID,
    scheduledStart,
    scheduledStart,
    NOW,
    NOW,
  );
}

function snapshot({
  activityTemplateId,
  plannedStart,
  programCode,
  programTemplateId,
  registryActivityCode,
  serviceCategory,
}) {
  return {
    contract: CONTRACT,
    catalogueReviewedOn: "2026-08-01",
    plannedStart,
    siteJurisdiction: "VIC",
    program: {
      templateId: programTemplateId,
      programCode,
      name: `${programCode} test program`,
      jurisdiction: programCode === "VEEC" ? "VIC" : "AU",
      outcomeClass: "certificate",
      claimOutputCode: programCode,
      claimOutputLabel: programCode,
      administeringBody: "Government",
      officialSourceUrl: "https://example.gov.au/",
      officialSourceTitle: "Official test source",
      catalogueState: "current",
      operatingNote: "",
    },
    activity: {
      templateId: activityTemplateId,
      activityKey: activityTemplateId,
      registryActivityCode,
      title: `${registryActivityCode} test activity`,
      serviceCategory,
      specificationPart: "",
      productCategory: serviceCategory,
      scenarioCode: "",
      scenario: "",
      catalogueState: "current",
    },
    governance: {
      state: "setup_required",
      message: "Test governance review required.",
    },
  };
}

function insertIntent(
  database,
  {
    activityTemplateId,
    id,
    intentKey,
    plannedStart = OLD_START,
    programCode,
    programTemplateId,
    registryActivityCode,
    revision = 1,
    serviceCategory,
    status = "planned",
    complianceCaseId = "",
  },
) {
  const intentSnapshot = JSON.stringify(snapshot({
    activityTemplateId,
    plannedStart,
    programCode,
    programTemplateId,
    registryActivityCode,
    serviceCategory,
  }));
  const intentHash = createHash("sha256")
    .update(intentSnapshot)
    .digest("hex");
  database.prepare(`
    INSERT INTO trade_work_order_compliance_intents (
      id,
      work_order_id,
      intent_key,
      installer_uid,
      compliance_organisation_id,
      program_template_id,
      activity_template_id,
      program_code,
      registry_activity_code,
      service_category,
      site_jurisdiction,
      planned_start,
      catalogue_reviewed_on,
      intent_snapshot,
      intent_snapshot_sha256,
      status,
      compliance_case_id,
      revision,
      created_by_uid,
      created_at,
      updated_at
    ) VALUES (
      ?, ?, ?, ?, 'compliance-org', ?, ?, ?, ?, ?, 'VIC',
      ?, '2026-08-01', ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    id,
    WORK_ORDER_ID,
    intentKey,
    OWNER_UID,
    programTemplateId,
    activityTemplateId,
    programCode,
    registryActivityCode,
    serviceCategory,
    plannedStart,
    intentSnapshot,
    intentHash,
    status,
    complianceCaseId,
    revision,
    OWNER_UID,
    NOW,
    NOW,
  );
}

function twoPlannedIntents(database, plannedStart = OLD_START) {
  insertIntent(database, {
    id: "intent-sres-v1",
    intentKey: "program:au-sres:activity:sres-ashp",
    plannedStart,
    programTemplateId: "au-sres",
    activityTemplateId: "sres-ashp",
    programCode: "SRES",
    registryActivityCode: "ASHP",
    serviceCategory: "hot_water",
  });
  insertIntent(database, {
    id: "intent-veec-v1",
    intentKey: "program:vic-veu:activity:veu-1",
    plannedStart,
    programTemplateId: "vic-veu",
    activityTemplateId: "veu-1",
    programCode: "VEEC",
    registryActivityCode: "1",
    serviceCategory: "hot_water",
  });
}

async function replan(database, plannedStart = NEW_START) {
  const d1 = testD1(database);
  const statements = await plannedComplianceIntentReplanStatements(d1, {
    actorUid: "dispatcher-1",
    changedAt: CHANGED_AT,
    ownerUid: OWNER_UID,
    plannedStart,
    workOrderId: WORK_ORDER_ID,
  });
  return { d1, statements };
}

test("a multi-activity date change supersedes every plan and creates canonical revision-two replacements", async () => {
  const database = new DatabaseSync(":memory:");
  applyIntentSchema(database);
  insertWorkOrder(database);
  twoPlannedIntents(database);
  const { d1, statements } = await replan(database);

  await d1.batch([
    ...statements,
    d1.prepare(`
      UPDATE trade_work_orders
      SET scheduled_start = ?, scheduled_end = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?
    `).bind(NEW_START, NEW_START, CHANGED_AT, WORK_ORDER_ID, OWNER_UID),
  ]);

  const rows = database.prepare(`
    SELECT *
    FROM trade_work_order_compliance_intents
    ORDER BY intent_key, revision
  `).all();
  assert.equal(rows.length, 4);
  for (const intentKey of [
    "program:au-sres:activity:sres-ashp",
    "program:vic-veu:activity:veu-1",
  ]) {
    const history = rows.filter((row) => row.intent_key === intentKey);
    assert.equal(history.length, 2);
    assert.equal(history[0].status, "superseded");
    assert.equal(history[0].revision, 1);
    assert.equal(history[0].planned_start, OLD_START);
    assert.equal(history[1].status, "planned");
    assert.equal(history[1].revision, 2);
    assert.equal(history[1].planned_start, NEW_START);
    assert.equal(history[1].intent_key, history[0].intent_key);
    assert.equal(history[1].program_template_id, history[0].program_template_id);
    assert.equal(history[1].activity_template_id, history[0].activity_template_id);
    assert.equal(
      JSON.parse(history[1].intent_snapshot).plannedStart,
      NEW_START,
    );
    assert.equal(
      history[1].intent_snapshot_sha256,
      createHash("sha256")
        .update(history[1].intent_snapshot)
        .digest("hex"),
    );
  }
  assert.equal(
    database.prepare(`
      SELECT scheduled_start
      FROM trade_work_orders
      WHERE id = ?
    `).get(WORK_ORDER_ID).scheduled_start,
    NEW_START,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count
      FROM trade_work_order_events
      WHERE work_order_id = ?
        AND event_type = 'compliance_intent_replanned'
    `).get(WORK_ORDER_ID).count,
    2,
  );
  database.close();
});

test("a same-day time change revisions every planned activity with the exact new timestamp", async () => {
  const database = new DatabaseSync(":memory:");
  applyIntentSchema(database);
  insertWorkOrder(database);
  twoPlannedIntents(database);
  const { d1, statements } = await replan(database, SAME_DAY_START);

  await d1.batch([
    ...statements,
    d1.prepare(`
      UPDATE trade_work_orders
      SET scheduled_start = ?, scheduled_end = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?
    `).bind(
      SAME_DAY_START,
      SAME_DAY_START,
      CHANGED_AT,
      WORK_ORDER_ID,
      OWNER_UID,
    ),
  ]);

  const active = database.prepare(`
    SELECT planned_start, revision, intent_snapshot, intent_snapshot_sha256
    FROM trade_work_order_compliance_intents
    WHERE work_order_id = ?
      AND status = 'planned'
    ORDER BY intent_key
  `).all(WORK_ORDER_ID);
  assert.equal(active.length, 2);
  for (const row of active) {
    assert.equal(row.planned_start, SAME_DAY_START);
    assert.equal(row.revision, 2);
    assert.equal(
      JSON.parse(row.intent_snapshot).plannedStart,
      SAME_DAY_START,
    );
    assert.equal(
      row.intent_snapshot_sha256,
      createHash("sha256").update(row.intent_snapshot).digest("hex"),
    );
  }
  database.close();
});

test("first scheduling turns every date-less planned activity into a usable dated revision", async () => {
  const database = new DatabaseSync(":memory:");
  applyIntentSchema(database);
  insertWorkOrder(database, "");
  twoPlannedIntents(database, "");
  const { d1, statements } = await replan(database);

  await d1.batch([
    ...statements,
    d1.prepare(`
      UPDATE trade_work_orders
      SET scheduled_start = ?, scheduled_end = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?
    `).bind(NEW_START, NEW_START, CHANGED_AT, WORK_ORDER_ID, OWNER_UID),
  ]);

  const active = database.prepare(`
    SELECT planned_start, revision, intent_snapshot
    FROM trade_work_order_compliance_intents
    WHERE work_order_id = ?
      AND status = 'planned'
    ORDER BY intent_key
  `).all(WORK_ORDER_ID);
  assert.equal(active.length, 2);
  for (const row of active) {
    assert.equal(row.planned_start, NEW_START);
    assert.equal(row.revision, 2);
    assert.equal(JSON.parse(row.intent_snapshot).plannedStart, NEW_START);
  }
  database.close();
});

test("a linked-case date guard rolls back every replacement and the work schedule while leaving immutable history untouched", async () => {
  const database = new DatabaseSync(":memory:");
  applyIntentSchema(database);
  insertWorkOrder(database);
  twoPlannedIntents(database);
  insertIntent(database, {
    id: "intent-linked",
    intentKey: "program:legacy:activity:linked",
    programTemplateId: "legacy",
    activityTemplateId: "linked",
    programCode: "LEGACY",
    registryActivityCode: "LINKED",
    serviceCategory: "hot_water",
    status: "case_linked",
    complianceCaseId: "case-linked",
  });
  insertIntent(database, {
    id: "intent-superseded",
    intentKey: "program:legacy:activity:superseded",
    programTemplateId: "legacy",
    activityTemplateId: "superseded",
    programCode: "LEGACY",
    registryActivityCode: "SUPERSEDED",
    serviceCategory: "hot_water",
    status: "superseded",
  });
  database.prepare(`
    INSERT INTO compliance_cases (
      id,
      work_order_id,
      installer_uid,
      activity_date
    ) VALUES (?, ?, ?, ?)
  `).run("case-linked", WORK_ORDER_ID, OWNER_UID, OLD_START.slice(0, 10));
  const beforeLinked = database.prepare(`
    SELECT *
    FROM trade_work_order_compliance_intents
    WHERE id = 'intent-linked'
  `).get();
  const beforeSuperseded = database.prepare(`
    SELECT *
    FROM trade_work_order_compliance_intents
    WHERE id = 'intent-superseded'
  `).get();
  const { d1, statements } = await replan(database);

  await assert.rejects(
    d1.batch([
      ...statements,
      d1.prepare(`
        UPDATE trade_work_orders
        SET scheduled_start = ?, scheduled_end = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?
      `).bind(NEW_START, NEW_START, CHANGED_AT, WORK_ORDER_ID, OWNER_UID),
    ]),
    /Compliance-linked job activity date cannot change without case supersession/,
  );

  assert.deepEqual(
    database.prepare(`
      SELECT *
      FROM trade_work_order_compliance_intents
      WHERE id = 'intent-linked'
    `).get(),
    beforeLinked,
  );
  assert.deepEqual(
    database.prepare(`
      SELECT *
      FROM trade_work_order_compliance_intents
      WHERE id = 'intent-superseded'
    `).get(),
    beforeSuperseded,
  );
  const planned = database.prepare(`
    SELECT id, status, revision, planned_start
    FROM trade_work_order_compliance_intents
    WHERE intent_key IN (
      'program:au-sres:activity:sres-ashp',
      'program:vic-veu:activity:veu-1'
    )
    ORDER BY intent_key, revision
  `).all();
  assert.deepEqual(
    planned.map((row) => ({
      id: row.id,
      plannedStart: row.planned_start,
      revision: row.revision,
      status: row.status,
    })),
    [
      {
        id: "intent-sres-v1",
        plannedStart: OLD_START,
        revision: 1,
        status: "planned",
      },
      {
        id: "intent-veec-v1",
        plannedStart: OLD_START,
        revision: 1,
        status: "planned",
      },
    ],
  );
  assert.equal(
    database.prepare(`
      SELECT scheduled_start
      FROM trade_work_orders
      WHERE id = ?
    `).get(WORK_ORDER_ID).scheduled_start,
    OLD_START,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count
      FROM trade_work_order_events
      WHERE event_type = 'compliance_intent_replanned'
    `).get().count,
    0,
  );
  database.close();
});

test("a stale schedule CAS aborts the batch and rolls back every prepared intent revision", async () => {
  const database = new DatabaseSync(":memory:");
  applyIntentSchema(database);
  insertWorkOrder(database);
  twoPlannedIntents(database);
  const { d1, statements } = await replan(database);

  await assert.rejects(
    d1.batch([
      ...statements,
      d1.prepare(`
        UPDATE trade_work_orders
        SET scheduled_start = ?, scheduled_end = ?, revision = 2,
          updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = 999
      `).bind(NEW_START, NEW_START, CHANGED_AT, WORK_ORDER_ID, OWNER_UID),
      previousTradeScheduleMutationGuardStatement(d1, {
        changedAt: CHANGED_AT,
        ownerUid: OWNER_UID,
      }),
    ]),
    /trade_crm_write_guard_verified_check/,
  );

  assert.equal(
    database.prepare(`
      SELECT scheduled_start
      FROM trade_work_orders
      WHERE id = ?
    `).get(WORK_ORDER_ID).scheduled_start,
    OLD_START,
  );
  assert.deepEqual(
    database.prepare(`
      SELECT status, revision, planned_start
      FROM trade_work_order_compliance_intents
      ORDER BY intent_key, revision
    `).all().map((row) => ({
      planned_start: row.planned_start,
      revision: row.revision,
      status: row.status,
    })),
    [
      {
        status: "planned",
        revision: 1,
        planned_start: OLD_START,
      },
      {
        status: "planned",
        revision: 1,
        planned_start: OLD_START,
      },
    ],
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count
      FROM trade_crm_write_guards
    `).get().count,
    0,
  );
  database.close();
});

test("every existing work-order date mutation path shares the atomic replanning helper", () => {
  const scheduleRoute = read("../src/app/api/trade-schedule/route.ts");
  const crmRoute = read("../src/app/api/trade-crm/route.ts");
  const workOrdersRoute = read("../src/app/api/trade-work-orders/route.ts");
  assert.equal(
    scheduleRoute.match(/plannedComplianceIntentReplanStatements\(/g)?.length,
    3,
  );
  assert.equal(
    scheduleRoute.match(/\.\.\.complianceIntentStatements,/g)?.length,
    3,
  );
  assert.equal(
    scheduleRoute.match(
      /previousTradeScheduleMutationGuardStatement\(/g,
    )?.length,
    4,
  );
  assert.match(
    scheduleRoute,
    /UPDATE trade_crm_appointments[\s\S]*?AND revision = \?`\)\.bind\([\s\S]*?previousTradeScheduleMutationGuardStatement/,
  );
  assert.match(
    scheduleRoute,
    /UPDATE trade_work_orders SET assignee_member_id[\s\S]*?AND revision = \?[\s\S]*?AND assignee_member_id = \?`\)\.bind\([\s\S]*?previousTradeScheduleMutationGuardStatement/,
  );
  assert.equal(
    crmRoute.match(/plannedComplianceIntentReplanStatements\(/g)?.length,
    1,
  );
  assert.equal(
    crmRoute.match(
      /previousTradeScheduleMutationGuardStatement\(/g,
    )?.length,
    1,
  );
  assert.match(
    crmRoute,
    /if \(appointmentType === "installation"\)[\s\S]*?\.\.\.complianceIntentStatements,[\s\S]*?SET scheduled_start = \?[\s\S]*?AND revision = \?[\s\S]*?previousTradeScheduleMutationGuardStatement/,
  );
  assert.equal(
    workOrdersRoute.match(
      /plannedComplianceIntentReplanStatements\(/g,
    )?.length,
    1,
  );
  assert.match(
    workOrdersRoute,
    /\.\.\.complianceIntentStatements,[\s\S]*?UPDATE trade_work_orders SET stage = \?, priority = \?, scheduled_start = \?/,
  );
});
