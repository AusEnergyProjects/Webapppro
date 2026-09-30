import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { visibleImportedJobEventSummary } from "../src/lib/trade-import-labels.ts";
import { mergeTradeAssetTimeline } from "../src/lib/trade-asset-timeline.mjs";

const suffix = "; source retained without issuing invoices, certificates or customer notifications.";
const original = `Imported Dataforce job source-42${suffix}`;
const visible = `Imported job source-42${suffix}`;
const event = Object.freeze({
  id: "job-42:import", work_order_id: "job-42", event_type: "data_imported",
  summary: original, created_at: "2026-09-30T01:00:00Z", firebase_uid: "owner-1",
});

// Execute the production read projections with controlled database results.
function readFunction(path, names, result, dependencies) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text);
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(ast)));
  });
  assert.equal(declarations.length, names.length, "Every requested production declaration must exist");
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(dependencies), `${compiled}\nreturn ${result};`)(...Object.values(dependencies));
}

test("generated import history is neutral for display while original audit and source ID stay intact", () => {
  assert.equal(visibleImportedJobEventSummary(event, "job-42"), visible);
  assert.equal(event.summary, original);
  assert.equal(visibleImportedJobEventSummary({ ...event, summary: visible }, "job-42"), visible);
  const sourceId = "Dataforce imported original ID";
  assert.equal(visibleImportedJobEventSummary({ ...event, summary: `Imported Dataforce job ${sourceId}${suffix}` }, "job-42"), `Imported job ${sourceId}${suffix}`);
});

test("different identities, event types and user-authored text are never relabelled", () => {
  for (const changed of [
    { id: "job-42:note" }, { work_order_id: "another-job" }, { event_type: "note_added" },
    { summary: `Staff said: ${original}` }, { summary: `${original} Reviewed by staff.` },
    { summary: `Imported Dataforce job ${suffix}` }, { summary: "Dataforce records checked" },
  ]) {
    const row = { ...event, ...changed };
    assert.equal(visibleImportedJobEventSummary(row, row.work_order_id), row.summary);
  }
  for (const workOrderId of ["", null, undefined, 42, { toString: () => "job-42" }]) {
    assert.equal(visibleImportedJobEventSummary(event, workOrderId), original);
  }
});

test("work order last event and recent activity use neutral copies of stored events", async () => {
  const workOrderPayload = readFunction("../src/app/api/trade-work-orders/route.ts", ["workOrderPayload"], "workOrderPayload", {
    getD1: () => ({ prepare: sql => ({ bind: (...bindings) => ({ all: async () => {
      assert.ok(bindings.every(value => value === "owner-1"));
      if (sql.includes("FROM trade_work_order_events")) return { results: [event] };
      if (sql.includes("FROM trade_work_order_tasks") || sql.includes("FROM trade_handover_packs")) return { results: [] };
      assert.match(sql, /FROM trade_work_orders WHERE firebase_uid = \?/);
      return { results: [{ id: "job-42", stage: "completed", service_category: "assessment" }] };
    } }) }) }),
    visibleImportedJobEventSummary, parseJsonList: () => [], SERVICE_CATEGORIES: new Set(["assessment"]),
    sourceOptions: async () => [], MEMBER_ACTIVE_LIMIT: 5, MEMBER_TASK_LIMIT: 5,
  });
  const payload = await workOrderPayload({ uid: "owner-1", fullAccess: true, teamAccess: true });
  assert.equal(payload.workOrders[0].lastEvent.summary, visible);
  assert.equal(payload.recentActivity[0].summary, visible);
  assert.equal(event.summary, original);
});

test("customer timeline relabels only generated job events and preserves matching note text", async () => {
  const job = Object.freeze({ ...event, source_type: "job", occurred_at: event.created_at });
  const note = Object.freeze({ ...event, source_type: "note", occurred_at: event.created_at });
  let queryCount = 0;
  const timelineRows = readFunction("../src/app/api/trade-assets/route.ts", ["timelineRows"], "timelineRows", {
    getD1: () => ({
      prepare: sql => ({ bind: (...bindings) => {
        assert.deepEqual(bindings, ["owner-1", "customer-1", "site-1", "site-1"]);
        queryCount += 1;
        return sql;
      } }),
      batch: async statements => statements.map(sql => ({ results: sql.includes("'job' source_type") ? [job] : sql.includes("'note' source_type") ? [note] : [] })),
    }),
    visibleImportedJobEventSummary, mergeTradeAssetTimeline,
  });
  const timeline = await timelineRows("owner-1", "customer-1", "site-1");
  assert.equal(queryCount, 7);
  assert.equal(timeline.find(row => row.sourceType === "job").summary, visible);
  assert.equal(timeline.find(row => row.sourceType === "note").summary, original);
  assert.equal(job.summary, original);
  assert.equal(note.summary, original);
});

test("Creditex audit projection retains privacy filtering and limits relabelling to job events", () => {
  const safeRows = readFunction("../src/app/api/creditex/job-intents/[intentId]/route.ts", [
    "PRIVATE_SERVER_FIELDS", "PRIVATE_GROUP_FIELDS", "privateServerField", "safeRow", "safeRows",
  ], "safeRows", { visibleImportedJobEventSummary });
  const [job] = safeRows([event], "jobEvents");
  assert.equal(job.summary, visible);
  assert.equal(Object.hasOwn(job, "firebase_uid"), false);
  const [note] = safeRows([event], "notes");
  assert.equal(note.summary, original);
  assert.equal(Object.hasOwn(note, "firebase_uid"), false);
  assert.equal(event.summary, original);
});

test("pilot workspace work event projection uses its selected job identity without changing stored rows", () => {
  const path = "../src/lib/creditex-veu-pilot-server.ts";
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const workspace = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "loadCreditexVeuPilotJobWorkspace");
  assert.ok(workspace);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "workEvents") initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(workspace);
  assert.ok(initializer);
  const output = ts.transpileModule(`const events = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const project = Function("workEventsResult", "workOrderId", "visibleImportedJobEventSummary", `${output}\nreturn events;`);
  assert.equal(project({ results: [event] }, "job-42", visibleImportedJobEventSummary)[0].summary, visible);
  assert.equal(project({ results: [event] }, "another-job", visibleImportedJobEventSummary)[0].summary, original);
  assert.equal(event.summary, original);
});
