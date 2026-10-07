import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as formLibrary from "../src/lib/trade-form-library.mjs";
import { isJobMember } from "../src/lib/trade-job-collaboration.ts";
import { installEmptyTradeCrews } from "./helpers/trade-crews-fixture.mjs";
import { loadWattzunFormContext, loadWattzunFormGuideForTurn, prepareWattzunGuidedFormForTurn, verifyWattzunFormForTurn } from "../src/lib/wattzun-form-server.ts";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function loadModule(source, dependencies) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
function fixture() {
  const database = new DatabaseSync(":memory:");
  installEmptyTradeCrews(database);
  database.exec(`CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT,
    source_type TEXT, source_reference TEXT, assignee_member_id TEXT, assignee_label TEXT, stage TEXT, service_category TEXT, revision INTEGER);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT PRIMARY KEY, firebase_uid TEXT, customer_source TEXT, customer_email TEXT);
    CREATE TABLE trade_crm_appointments (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT, assignee_member_id TEXT, status TEXT);
    CREATE TABLE trade_team_members (id TEXT PRIMARY KEY, owner_uid TEXT, status TEXT);
    CREATE TABLE trade_job_forms (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT, template_key TEXT, template_version INTEGER,
      template_name TEXT, jurisdiction TEXT, template_snapshot TEXT, answers TEXT, status TEXT, revision INTEGER, completed_by_uid TEXT,
      completed_at TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO trade_work_orders VALUES ('job-one','owner-one','installer','active','opportunity','private-opportunity','member-one','Worker','in_progress','other',4);
    INSERT INTO trade_work_orders VALUES ('job-two','owner-one','installer','active','manual','','member-two','Other','in_progress','other',1);
    INSERT INTO trade_work_orders VALUES ('foreign-job','foreign-owner','installer','active','manual','','foreign-member','Foreign','in_progress','other',1);
    INSERT INTO trade_crm_job_details VALUES ('job-one','owner-one','platform_private','private-customer@example.test');
    INSERT INTO trade_team_members VALUES ('member-one','owner-one','active');
    INSERT INTO trade_team_members VALUES ('member-two','owner-one','active');`);
  const template = formLibrary.tradeFormTemplate("pre-start-risk-readiness", 1, "other");
  const insert = database.prepare("INSERT INTO trade_job_forms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [id, job, owner] of [["form-one", "job-one", "owner-one"], ["form-two", "job-two", "owner-one"], ["foreign-form", "foreign-job", "foreign-owner"]]) {
    insert.run(id, job, owner, template.key, template.version, template.name, "AU", JSON.stringify(template), '{"work_date":"2026-10-07"}', "draft", 2, "", "", "2026-10-07T00:00:00.000Z", "2026-10-07T00:00:00.000Z");
  }
  const reads = [], state = { assignedCalls: 0, batches: 0, beforeSelected: null, selectedResult: null };
  const db = {
    prepare(sql) {
      assert.match(sql, /^\s*SELECT\b/i, "Selected-form reading must not write");
      return { bind(...values) {
        return {
          async first() { reads.push({ sql, values }); return database.prepare(sql).get(...values) ?? null; },
          async all() {
            reads.push({ sql, values });
            if (state.selectedResult && sql.includes("FROM trade_job_forms")) return state.selectedResult();
            return { success: true, results: database.prepare(sql).all(...values) };
          },
        };
      } };
    },
    async batch(statements) {
      state.batches++;
      if (state.beforeSelected) { const hook = state.beforeSelected; state.beforeSelected = null; hook(); }
      return Promise.all(statements.map(statement => statement.all()));
    },
  };
  const source = read("../src/lib/trade-team-server.ts"), ast = ts.createSourceFile("team.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["assignedJob", "assignedJobStatement", "requireAssignedJob"].includes(node.name?.text));
  assert.equal(declarations.length, 3);
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast).replace(/^export\s+/, "")).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const actual = new Function("getD1", "isJobMember", compiled + "; return {assignedJob, assignedJobStatement, requireAssignedJob};")(() => db, isJobMember);
  const service = loadModule(read("../src/lib/trade-job-forms-server.ts"), {
    "../../db": { getD1: () => db }, "./trade-form-library.mjs": formLibrary,
    "./trade-team-server": { ...actual, requireAssignedJob: async (...args) => { state.assignedCalls++; return actual.requireAssignedJob(...args); } },
    "./trade-form-job-progress": { reconcileTradeFormJobProgress: () => assert.fail("Reading must not reconcile progress") },
    "./trade-team-sync-server": {}, "./asset-lifecycle.mjs": {},
  });
  const team = { ownerUid: "owner-one", actorUid: "worker-one", memberId: "member-one", isOwner: false, jobScope: "own", canViewFieldEvidence: true };
  return { database, db, reads, state, service, team };
}

test("selected technical form uses canonical assignment once and reads only the exact form without a catalogue or customer details", async () => {
  const f = fixture();
  try {
    const result = await f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one");
    assert.equal(f.state.assignedCalls, 1); assert.equal(f.reads.length, 2); assert.equal(f.state.batches, 1);
    assert.deepEqual(f.reads.map(read => read.values), [["job-one", "owner-one"], ["form-one", "job-one", "owner-one"]]);
    assert.equal(result.job.id, "job-one"); assert.equal(result.job.customer_source, "platform_private");
    assert.equal(result.form.id, "form-one"); assert.equal(result.form.answers.work_date, "2026-10-07");
    assert.equal(result.form.ready, false); assert.equal(result.form.template.fields.length, 6);
    assert.doesNotMatch(JSON.stringify(result), /private-customer@example|foreign-form|form-two/);
    assert.deepEqual(result.form, f.service.tradeJobFormProjection(f.database.prepare("SELECT * FROM trade_job_forms WHERE id='form-one'").get()));
  } finally { f.database.close(); }
});

test("cross-business, cross-job and absent forms are denied without exposing a different form", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "foreign-job", "foreign-form"), /JOB_NOT_FOUND/);
    for (const id of ["foreign-form", "form-two", "missing", "form-one' OR 1=1 --"]) {
      await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", id), /JOB_FORM_NOT_FOUND/);
    }
    assert.equal(f.database.prepare("SELECT count(*) n FROM trade_job_forms").get().n, 3);
  } finally { f.database.close(); }
});

test("canonical own-scope appointment assignment is honoured and removed assignment denies the next read", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-two", "form-two"), /JOB_NOT_ASSIGNED/);
    f.database.exec("INSERT INTO trade_crm_appointments VALUES ('visit','job-two','owner-one','member-one','scheduled')");
    assert.equal((await f.service.readSelectedTradeJobForm(f.team, "job-two", "form-two")).form.id, "form-two");
    f.database.exec("UPDATE trade_crm_appointments SET status='cancelled' WHERE id='visit'");
    await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-two", "form-two"), /JOB_NOT_ASSIGNED/);
  } finally { f.database.close(); }
});

test("assignment changed before the selected-form transaction is denied using the shared canonical rule", async () => {
  const f = fixture();
  try {
    f.state.beforeSelected = () => f.database.exec("UPDATE trade_work_orders SET assignee_member_id='member-two' WHERE id='job-one'");
    await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one"), /JOB_NOT_ASSIGNED/);
    assert.equal(f.state.batches, 1);
    assert.equal(f.state.assignedCalls, 1);
    assert.equal(f.database.prepare("SELECT revision FROM trade_job_forms WHERE id='form-one'").get().revision, 2);
  } finally { f.database.close(); }
});

test("fresh revoked field-evidence permission denies reading and never queries form answers", async () => {
  const f = fixture();
  try {
    await f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one");
    f.team.canViewFieldEvidence = false; f.reads.length = 0;
    await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one"), /FIELD_EVIDENCE_VIEW_REQUIRED/);
    assert.equal(f.reads.length, 0);
  } finally { f.database.close(); }
});

test("archived or non-installer jobs are denied initially and when changed after canonical assignment", async () => {
  for (const change of ["record_status='archived'", "partner_type='auditor'"]) {
    for (const duringRead of [false, true]) {
      const f = fixture();
      try {
        const changeJob = () => f.database.exec(`UPDATE trade_work_orders SET ${change} WHERE id='job-one'`);
        if (duringRead) f.state.beforeSelected = changeJob; else changeJob();
        await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one"), /JOB_NOT_FOUND/);
      } finally { f.database.close(); }
    }
  }
});

test("selected form failures, unavailable results and malformed stored objects fail closed", async () => {
  for (const result of [() => { throw new Error("D1 unavailable"); }, () => undefined, () => ({ success: false, results: [] }),
    () => ({ success: true }), () => ({ success: true, results: [{}, {}] })]) {
    const f = fixture();
    try { f.state.selectedResult = result; await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one"), /D1 unavailable|FORM_PAYLOAD_UNAVAILABLE/); }
    finally { f.database.close(); }
  }
  for (const [column, value] of [["template_snapshot", "not json"], ["template_snapshot", "{}"], ["answers", "[]"], ["answers", "null"], ["revision", -1]]) {
    const f = fixture();
    try {
      f.database.prepare(`UPDATE trade_job_forms SET ${column}=? WHERE id='form-one'`).run(value);
      await assert.rejects(f.service.readSelectedTradeJobForm(f.team, "job-one", "form-one"), /FORM_PAYLOAD_UNAVAILABLE/);
    } finally { f.database.close(); }
  }
});

test("Wattzun context and guided preparation use the actual selected SQLite reader and bind its exact current source", async () => {
  const f = fixture();
  try {
    f.team.canManageFieldEvidence = true;
    const access = { actorUid: f.team.actorUid, scope: { portal: "trade", scopeId: f.team.ownerUid, label: "Synthetic installer" }, db: f.db };
    const reference = { kind: "trade_form", formKind: "job_form", jobId: "job-one", recordId: "form-one" };
    const request = new Request("https://fixture.invalid/api/wattzun/form-guide");
    let teamReads = 0, progressReads = 0;
    const deps = { team: async () => { teamReads++; return f.team; }, selectedJobForm: f.service.readSelectedTradeJobForm,
      job: () => assert.fail("The canonical selected reader already checks assignedJob"),
      startFormWork: async (team, jobId) => { assert.equal(team, f.team); assert.equal(jobId, "job-one"); progressReads++; return { changed: false, stage: "in_progress", blockers: [] }; },
      saveJobForm: () => assert.fail("Context and preparation must not save") };
    const context = await loadWattzunFormContext(request, access, reference, deps);
    assert.equal(teamReads, 1); assert.equal(f.state.assignedCalls, 1); assert.equal(f.reads.length, 2);
    assert.equal(context.facts.revision, 2); assert.equal(context.facts.questions.find(field => field.fieldKey === "work_date").value, "2026-10-07");
    assert.doesNotMatch(JSON.stringify(context), /private-customer@example|foreign-form|form-two/);
    const input = { sessionId: "550e8400-e29b-41d4-a716-446655440000", stage: "start", authorization: "ordinary_form_answers", skippedFieldKeys: [] };
    const { guide } = await loadWattzunFormGuideForTurn(request, access, reference, input, f.team, deps);
    assert.equal(guide.sourceSha256, context.sourceSha256); assert.equal(guide.next.fieldKey, "technician"); assert.equal(guide.counts.answered, 1);
    const proposal = { kind: "fill_form", jobQuery: "", jobId: "job-one", formKind: "job_form", formId: "form-one", answers: [{ fieldKey: "technician", value: "Alex Example" }] };
    const prepared = await prepareWattzunGuidedFormForTurn(request, access, proposal,
      { ...input, stage: "continue", sourceSha256: guide.sourceSha256, questionKey: guide.next.fieldKey }, f.team, deps);
    assert.equal(prepared.sourceSha256, context.sourceSha256); assert.equal(prepared.payload.baseRevision, 2); assert.equal(prepared.payload.answers.technician, "Alex Example");
    assert.equal(teamReads, 1); assert.equal(progressReads, 1); assert.equal(f.state.assignedCalls, 4); assert.equal(f.reads.length, 8);
    assert.deepEqual(JSON.parse(f.database.prepare("SELECT answers FROM trade_job_forms WHERE id='form-one'").get().answers), { work_date: "2026-10-07" });
    f.database.exec("UPDATE trade_job_forms SET answers='{\"work_date\":\"2026-10-07\",\"technician\":\"Office correction\"}',revision=3 WHERE id='form-one'");
    await assert.rejects(verifyWattzunFormForTurn(request, access, prepared, f.team, deps), error => error.status === 409);
    f.team.canManageFieldEvidence = false;
    await assert.rejects(verifyWattzunFormForTurn(request, access, prepared, f.team, deps), error => error.status === 403);
  } finally { f.database.close(); }
});
