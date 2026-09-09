import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  deriveTradeJobLifecycle,
  normaliseTradeJobAuditOutcome,
  tradeJobAuditOutcomeSql,
  tradeJobHasProgressSql,
  tradeJobLifecycleStatusSql,
} from "../src/lib/trade-job-lifecycle.ts";

test("job lifecycle keeps audit outcome subordinate to cancellation and independent of certificates", () => {
  assert.deepEqual(deriveTradeJobLifecycle({}), { status: "unscheduled", auditOutcome: null });
  assert.deepEqual(deriveTradeJobLifecycle({ scheduleDate: "2026-09-09T09:00:00Z" }), { status: "scheduled", auditOutcome: null });
  assert.deepEqual(deriveTradeJobLifecycle({ workStage: "blocked" }), { status: "partial", auditOutcome: null });
  assert.deepEqual(deriveTradeJobLifecycle({ hasProgress: 1 }), { status: "partial", auditOutcome: null });
  assert.deepEqual(deriveTradeJobLifecycle({ workStage: "completed" }), { status: "completed", auditOutcome: null });
  assert.deepEqual(deriveTradeJobLifecycle({ workStage: "completed", auditOutcome: "changes_required" }), {
    status: "audited", auditOutcome: "correction_required",
  });
  assert.deepEqual(deriveTradeJobLifecycle({ workStage: "in_progress", hasProgress: 1, auditOutcome: "approved" }), {
    status: "partial", auditOutcome: null,
  });
  assert.deepEqual(deriveTradeJobLifecycle({ workStage: "cancelled", auditOutcome: "approved" }), {
    status: "cancelled", auditOutcome: null,
  });
  assert.equal(normaliseTradeJobAuditOutcome("duplicate"), "duplicate");
  assert.equal(normaliseTradeJobAuditOutcome("removed"), "withdrawn");
});

test("SQL projection uses actual progress and the newest explicit audit result", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, stage TEXT, scheduled_start TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT PRIMARY KEY, pipeline_stage TEXT);
    CREATE TABLE trade_job_forms (work_order_id TEXT, firebase_uid TEXT, status TEXT, answers TEXT);
    CREATE TABLE trade_activity_field_records (work_order_id TEXT, owner_uid TEXT, status TEXT, payload TEXT);
    CREATE TABLE compliance_activity_work_pack_instances (work_order_id TEXT, organisation_id TEXT, instance_key TEXT, revision INTEGER, status TEXT);
    CREATE TABLE trade_rental_inspections (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT, status TEXT);
    CREATE TABLE trade_rental_inspection_modules (inspection_id TEXT, firebase_uid TEXT, status TEXT);
    CREATE TABLE trade_work_order_compliance_intents (
      id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT, compliance_case_id TEXT, status TEXT
    );
    CREATE TABLE compliance_cases (
      id TEXT PRIMARY KEY, organisation_id TEXT, work_order_id TEXT, installer_uid TEXT,
      compliance_intent_id TEXT, status TEXT, updated_at TEXT
    );
    CREATE TABLE compliance_case_decisions (id TEXT PRIMARY KEY, organisation_id TEXT, case_id TEXT, decision_type TEXT, outcome TEXT, decided_at TEXT);
    CREATE TABLE compliance_submission_batch_items (id TEXT PRIMARY KEY, organisation_id TEXT, case_id TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE compliance_submission_responses (id TEXT PRIMARY KEY, organisation_id TEXT, batch_item_id TEXT, response_type TEXT, occurred_at TEXT);

    INSERT INTO trade_work_orders VALUES
      ('unscheduled', 'owner', 'ready', ''),
      ('scheduled', 'owner', 'scheduled', '2026-09-09T09:00:00Z'),
      ('draft-activity', 'owner', 'scheduled', '2026-09-09T09:30:00Z'),
      ('partial', 'owner', 'scheduled', '2026-09-09T10:00:00Z'),
      ('completed', 'owner', 'completed', '2026-09-09T11:00:00Z'),
      ('audited', 'owner', 'completed', '2026-09-09T12:00:00Z'),
      ('cancelled', 'owner', 'cancelled', '2026-09-09T13:00:00Z');
    INSERT INTO trade_crm_job_details VALUES
      ('unscheduled', 'quoting'), ('scheduled', 'scheduled'), ('draft-activity', 'scheduled'), ('partial', 'scheduled'),
      ('completed', 'complete'), ('audited', 'complete'), ('cancelled', 'lost');
    INSERT INTO trade_job_forms VALUES ('partial', 'owner', 'draft', '{"existing":"captured"}');
    INSERT INTO trade_activity_field_records VALUES ('draft-activity', 'owner', 'draft', '{}');
    INSERT INTO compliance_cases VALUES ('case-audited', 'creditex', 'audited', 'owner', '', 'accepted', '2026-09-09T10:00:00Z');
    INSERT INTO compliance_submission_batch_items VALUES ('item-audited', 'creditex', 'case-audited', 'accepted', '2026-09-09T11:00:00Z');
    INSERT INTO compliance_submission_responses VALUES ('response-audited', 'creditex', 'item-audited', 'duplicate', '2026-09-09T12:00:00Z');
    INSERT INTO compliance_cases VALUES ('case-cancelled', 'creditex', 'cancelled', 'owner', '', 'accepted', '2026-09-09T14:00:00Z');
  `);
  const auditSql = tradeJobAuditOutcomeSql("w");
  const progressSql = tradeJobHasProgressSql("w");
  const statusSql = tradeJobLifecycleStatusSql({
    workAlias: "w",
    detailAlias: "d",
    scheduleSql: "COALESCE(NULLIF(w.scheduled_start, ''), '')",
    auditOutcomeSql: auditSql,
    hasProgressSql: progressSql,
  });
  const rows = db.prepare(`SELECT w.id, ${auditSql} audit_outcome, ${statusSql} lifecycle_status
    FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    ORDER BY w.id`).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: "audited", audit_outcome: "duplicate", lifecycle_status: "audited" },
    { id: "cancelled", audit_outcome: "passed", lifecycle_status: "cancelled" },
    { id: "completed", audit_outcome: null, lifecycle_status: "completed" },
    { id: "draft-activity", audit_outcome: null, lifecycle_status: "partial" },
    { id: "partial", audit_outcome: null, lifecycle_status: "partial" },
    { id: "scheduled", audit_outcome: null, lifecycle_status: "scheduled" },
    { id: "unscheduled", audit_outcome: null, lifecycle_status: "unscheduled" },
  ]);
});

test("a completed multi-activity job is audited only after every active activity has an outcome", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, stage TEXT, scheduled_start TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT PRIMARY KEY, pipeline_stage TEXT);
    CREATE TABLE trade_job_forms (work_order_id TEXT, firebase_uid TEXT, status TEXT, answers TEXT);
    CREATE TABLE trade_activity_field_records (work_order_id TEXT, owner_uid TEXT, status TEXT, payload TEXT);
    CREATE TABLE compliance_activity_work_pack_instances (work_order_id TEXT, organisation_id TEXT, instance_key TEXT, revision INTEGER, status TEXT);
    CREATE TABLE trade_rental_inspections (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT, status TEXT);
    CREATE TABLE trade_rental_inspection_modules (inspection_id TEXT, firebase_uid TEXT, status TEXT);
    CREATE TABLE trade_work_order_compliance_intents (
      id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT, compliance_case_id TEXT, status TEXT
    );
    CREATE TABLE compliance_cases (
      id TEXT PRIMARY KEY, organisation_id TEXT, work_order_id TEXT, installer_uid TEXT,
      compliance_intent_id TEXT, status TEXT, updated_at TEXT
    );
    CREATE TABLE compliance_case_decisions (id TEXT PRIMARY KEY, organisation_id TEXT, case_id TEXT, decision_type TEXT, outcome TEXT, decided_at TEXT);
    CREATE TABLE compliance_submission_batch_items (id TEXT PRIMARY KEY, organisation_id TEXT, case_id TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE compliance_submission_responses (id TEXT PRIMARY KEY, organisation_id TEXT, batch_item_id TEXT, response_type TEXT, occurred_at TEXT);

    INSERT INTO trade_work_orders VALUES ('multi', 'owner', 'completed', '2026-09-09T09:00:00Z');
    INSERT INTO trade_crm_job_details VALUES ('multi', 'complete');
    INSERT INTO trade_work_order_compliance_intents VALUES
      ('intent-a', 'multi', 'owner', 'case-a', 'case_linked'),
      ('intent-b', 'multi', 'owner', 'case-b', 'case_linked'),
      ('intent-old', 'multi', 'owner', 'case-old', 'superseded');
    INSERT INTO compliance_cases VALUES
      ('case-a', 'creditex', 'multi', 'owner', 'intent-a', 'rejected', '2026-09-09T10:00:00Z'),
      ('case-b', 'creditex', 'multi', 'owner', 'intent-b', 'open', '2026-09-09T11:00:00Z'),
      ('case-old', 'creditex', 'multi', 'owner', 'intent-old', 'rejected', '2026-09-09T12:00:00Z');
  `);
  const auditSql = tradeJobAuditOutcomeSql("w");
  const statusSql = tradeJobLifecycleStatusSql({
    workAlias: "w",
    detailAlias: "d",
    scheduleSql: "COALESCE(NULLIF(w.scheduled_start, ''), '')",
    auditOutcomeSql: auditSql,
  });
  const read = () => ({ ...db.prepare(`SELECT ${auditSql} audit_outcome, ${statusSql} lifecycle_status
    FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    WHERE w.id = 'multi'`).get() });

  assert.deepEqual(read(), { audit_outcome: null, lifecycle_status: "completed" });
  db.prepare(`UPDATE compliance_cases SET status = 'accepted', updated_at = ? WHERE id = 'case-b'`)
    .run("2026-09-09T13:00:00Z");
  assert.deepEqual(read(), { audit_outcome: "failed", lifecycle_status: "audited" });
  db.prepare(`UPDATE compliance_cases SET status = 'accepted', updated_at = ? WHERE id = 'case-a'`)
    .run("2026-09-09T14:00:00Z");
  assert.deepEqual(read(), { audit_outcome: "passed", lifecycle_status: "audited" });
});
