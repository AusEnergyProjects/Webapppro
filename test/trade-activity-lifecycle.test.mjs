import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const serverSource = fs.readFileSync(new URL("../src/lib/trade-activity-forms-server.ts", import.meta.url), "utf8");
const componentSource = fs.readFileSync(new URL("../src/components/TradeActivityFieldRecords.tsx", import.meta.url), "utf8");

function sourceFunction(source, name) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing function ${name}`);
  const output = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${output}; return ${name};`)();
}

test("activity lifecycle follows cancellation, audit, completion, progress and schedule precedence", () => {
  const derive = sourceFunction(serverSource, "deriveActivityLifecycle");
  assert.deepEqual(derive({}), { status: "unscheduled", auditOutcome: null });
  assert.deepEqual(derive({ scheduledStart: "2026-09-09T09:00:00Z" }), { status: "scheduled", auditOutcome: null });
  assert.deepEqual(derive({ hasUserProgress: 1, scheduledStart: "2026-09-09T09:00:00Z" }), { status: "partial", auditOutcome: null });
  assert.deepEqual(derive({ activeWorkPack: 1 }), { status: "partial", auditOutcome: null });
  assert.deepEqual(derive({ fieldRecordStatus: "submitted_for_creditex_review", activeWorkPack: 1 }), { status: "completed", auditOutcome: null });
  assert.deepEqual(derive({ completedWorkPack: 1 }), { status: "completed", auditOutcome: null });
  assert.deepEqual(derive({ completedWorkPack: 1, auditOutcome: "changes_required" }), { status: "completed", auditOutcome: null });
  assert.deepEqual(derive({ completedWorkPack: 1, auditOutcome: "correction_required" }), {
    status: "audited", auditOutcome: "correction_required",
  });
  assert.deepEqual(derive({ parentStage: "cancelled", auditOutcome: "passed" }), { status: "cancelled", auditOutcome: null });
});

test("activity audit projection uses the newest explicit outcome linked to that activity", () => {
  const sql = sourceFunction(serverSource, "activityAuditOutcomeSql")("i");
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_order_compliance_intents (
      id TEXT, work_order_id TEXT, installer_uid TEXT, compliance_case_id TEXT
    );
    CREATE TABLE compliance_cases (
      id TEXT, organisation_id TEXT, work_order_id TEXT, installer_uid TEXT,
      compliance_intent_id TEXT, status TEXT, updated_at TEXT
    );
    CREATE TABLE compliance_case_decisions (
      id TEXT, organisation_id TEXT, case_id TEXT, decision_type TEXT, outcome TEXT, decided_at TEXT
    );
    CREATE TABLE compliance_submission_batch_items (
      id TEXT, organisation_id TEXT, case_id TEXT, status TEXT, updated_at TEXT
    );
    CREATE TABLE compliance_submission_responses (
      id TEXT, organisation_id TEXT, batch_item_id TEXT, response_type TEXT, occurred_at TEXT
    );
    INSERT INTO trade_work_order_compliance_intents VALUES
      ('intent-a', 'job-a', 'owner-a', 'case-a'),
      ('intent-b', 'job-a', 'owner-a', 'case-b');
    INSERT INTO compliance_cases VALUES
      ('case-a', 'creditex', 'job-a', 'owner-a', 'intent-a', 'accepted', '2026-09-09T09:00:00Z'),
      ('case-b', 'creditex', 'job-a', 'owner-a', 'intent-b', 'rejected', '2026-09-09T12:00:00Z');
    INSERT INTO compliance_submission_batch_items VALUES
      ('batch-a', 'creditex', 'case-a', 'accepted', '2026-09-09T10:00:00Z'),
      ('batch-b', 'creditex', 'case-b', 'rejected', '2026-09-09T12:00:00Z');
    INSERT INTO compliance_submission_responses VALUES
      ('response-a', 'creditex', 'batch-a', 'duplicate', '2026-09-09T11:00:00Z');
  `);
  const rows = database.prepare(`SELECT i.id, ${sql} audit_outcome
    FROM trade_work_order_compliance_intents i ORDER BY i.id`).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: "intent-a", audit_outcome: "duplicate" },
    { id: "intent-b", audit_outcome: "failed" },
  ]);
});

test("activity list exposes canonical lifecycle labels without removing completed work", () => {
  assert.match(serverSource, /lifecycleStatus: lifecycle\.status, auditOutcome: lifecycle\.auditOutcome/);
  assert.match(serverSource, /completed_pack\.status = 'completed'/);
  assert.match(serverSource, /active_pack\.status IN \('in_progress', 'ready_to_sign'\)/);
  assert.match(serverSource, /activity_response_case\.compliance_intent_id = \$\{intentAlias\}\.id/);
  assert.match(componentSource, /tradeJobLifecycleLabel\(item\.lifecycleStatus\)/);
  assert.match(componentSource, /item\.lifecycleStatus === "cancelled"/);
  assert.match(componentSource, /item\.lifecycleStatus === "audited" && item\.auditOutcome/);
  assert.match(componentSource, /records\.map\(\(item\) => <article key=\{item\.intentId\}>/);
  assert.doesNotMatch(componentSource, /records\.filter/);
});
