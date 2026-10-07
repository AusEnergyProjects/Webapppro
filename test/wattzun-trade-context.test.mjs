import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import * as collaboration from "../src/lib/trade-job-collaboration.ts";
import * as records from "../src/lib/wattzun-records.ts";
import { FirebaseMfaRequiredError } from "../src/lib/firebase-mfa.ts";
import * as contextContract from "../src/lib/wattzun-work-context.ts";

function load(path, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function("require", "exports", source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const sourceHash = async value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class TradeAccessError extends Error {}
class TradeBusinessContextError extends Error {}

function fixture(t, options = {}) {
  const { sqlite } = migratedDataforceSqlite();
  t.after(() => sqlite.close());
  function insert(table, values) {
    const input = {};
    for (const column of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column.notnull && column.dflt_value === null) input[column.name] = /INT/i.test(column.type) ? 0 : "";
    }
    Object.assign(input, values);
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(input).join(",")}) VALUES (${Object.keys(input).map(() => "?").join(",")})`).run(...Object.values(input));
  }
  const reads = [], authRequests = [], sharedCalls = [], writes = [];
  let beforeRead = () => {}, afterAuth = () => {}, sharedError = null, authError = null;
  let memberScope = "own", quotePermission = false;
  function statement(sql, values = []) {
    return { bind: (...next) => statement(sql, next),
      async first() { beforeRead(sql); reads.push(sql); return sqlite.prepare(sql).get(...values) || null; },
      async all() { beforeRead(sql); reads.push(sql); return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { writes.push(sql); return { meta: sqlite.prepare(sql).run(...values) }; },
    };
  }
  const db = { prepare: statement };
  const now = "2026-10-07T00:00:00.000Z";
  insert("trade_team_members", { id: "member-one", owner_uid: "business-one", member_uid: "actor-one", status: "active", display_name: "Synthetic worker", created_at: now, updated_at: now });
  insert("trade_team_members", { id: "member-two", owner_uid: "business-one", member_uid: "actor-two", status: "active", display_name: "Other worker", created_at: now, updated_at: now });
  insert("trade_work_orders", { id: "job-one", firebase_uid: "business-one", partner_type: "installer", source_type: "internal", source_reference: "synthetic-job", work_number: "JOB-TEST-1", title: "Electrical inspection", service_category: "electrical", stage: "ready", assignee_member_id: "member-one", record_status: "active", revision: 1, created_at: now, updated_at: now });
  insert("trade_crm_job_details", { id: "detail-one", work_order_id: "job-one", firebase_uid: "business-one", description: "Inspect the recorded board condition", customer_source: "trade_owned", estimated_value_cents: 999999, next_action: "PRIVATE_NOTE", created_at: now, updated_at: now });
  insert("trade_work_order_tasks", { id: "task-one", work_order_id: "job-one", firebase_uid: "business-one", title: "Confirm switchboard access", status: "pending", due_at: "2026-10-08T09:00", completed_at: "", revision: 1, sort_order: 0, created_at: now, updated_at: now });
  insert("trade_work_orders", { id: "job-other", firebase_uid: "business-two", partner_type: "installer", source_type: "internal", work_number: "PRIVATE_OTHER_JOB", title: "PRIVATE_OTHER_TITLE", service_category: "electrical", stage: "ready", assignee_member_id: "member-two", record_status: "active", created_at: now, updated_at: now });
  insert("trade_work_order_tasks", { id: "task-other", work_order_id: "job-other", firebase_uid: "business-two", title: "PRIVATE_OTHER_TASK", status: "pending", created_at: now, updated_at: now });
  const teamSource = load("../src/lib/trade-team-server.ts", {
    "../../db": { getD1: () => db }, "./trade-job-collaboration": collaboration,
    "./firebase-server": {}, "./trade-mfa-server": {}, "./trade-access-server": {},
    "./trade-business-context-server": {}, "./trade-team-permission-policy.mjs": {},
    "./trade-crews-server": {}, "./trade-field-session-server": {},
  });
  const team = { ownerUid: "business-one", actorUid: "actor-one", memberId: "member-one", isOwner: false,
    jobScope: "own", canViewQuotes: false, canManageQuotes: false };
  const access = { db, actorUid: "actor-one", scope: { portal: "trade", scopeId: "business-one", label: "Synthetic business" } };
  const server = load("../src/lib/wattzun-trade-context-server.ts", {
    "./wattzun-work-context": contextContract, "./wattzun-records": records,
    "./workflow-ai-server": { workflowAiSourceHash: sourceHash },
    "./firebase-mfa": { FirebaseMfaRequiredError }, "./trade-access-server": { TradeAccessError },
    "./trade-business-context-server": { TradeBusinessContextError },
    "./trade-team-server": { assignedJob: teamSource.assignedJob,
      async requireInstallerTeamAccess(request) {
        authRequests.push(request);
        if (authError) throw authError;
        const actor = sqlite.prepare("SELECT status FROM trade_team_members WHERE id='member-one' AND owner_uid='business-one'").get();
        if (actor?.status !== "active") throw new Error("TEAM_ACCESS_RECORD_REQUIRED");
        const current = { ...team, jobScope: memberScope, canViewQuotes: quotePermission, canManageQuotes: quotePermission, ...options.team };
        afterAuth(authRequests.length);
        return current;
      } },
    "./trade-customer-hub-assist-server": { async tradeHubAssistSource(database, current, id) {
      sharedCalls.push({ database, current, id });
      if (sharedError) throw new Error(sharedError);
      if (!current.canViewQuotes || !current.canManageQuotes) throw new Error("WORKFLOW_AI_FORBIDDEN");
      const input = { job: { id: "job", title: "Shared solar enquiry", description: "Recorded scope" },
        questions: [{ id: "question-one", prompt: "What is needed?", answer: "Rooftop solar", replies: [], attachments: [{ id: "file-one", type: "application/pdf" }] }], attachmentContentsReviewed: false };
      return { input, sourceIds: ["job", "question-one"], sourceHash: await sourceHash(input) };
    } },
  });
  const reference = { kind: "trade_job", recordId: "job-one" };
  const request = new Request("https://example.test/api/wattzun/portal", { method: "POST", headers: { Authorization: "Bearer synthetic", "X-TLink-Business": "forged-business", Origin: "https://example.test", "X-TLink-Field-Session": "synthetic-field" }, body: "already consumed" });
  return { sqlite, db, access, request, server, reads, writes, authRequests, sharedCalls, insert, reference,
    load: (ref = reference, selectedAccess = access) => server.loadWattzunTradeContext(request, selectedAccess, ref),
    beforeRead: fn => { beforeRead = fn; }, afterAuth: fn => { afterAuth = fn; },
    authError: value => { authError = value; },
    scope: value => { memberScope = value; }, quotePermission: value => { quotePermission = value; }, sharedError: value => { sharedError = value; } };
}

test("local context contains only assigned job operations and checklist, with scoped source links and no writes", async t => {
  const f = fixture(t);
  await f.request.text();
  const context = await f.load();
  assert.equal(context.title, "Electrical inspection");
  assert.deepEqual(context.reference, f.reference);
  assert.match(context.sourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(context.facts, {
    job: { sourceId: "trade_job_overview", workNumber: "JOB-TEST-1", title: "Electrical inspection", description: "Inspect the recorded board condition", serviceCategory: "electrical", operationalStage: "ready" },
    checklist: { sourceId: "trade_job_tasks", tasks: [{ id: "task-one", title: "Confirm switchboard access", status: "pending", dueAt: "2026-10-08T09:00", completedAt: "" }] },
  });
  assert.ok(context.sources.length <= 6);
  for (const source of context.sources) assert.equal(source.href, "/direct-trade/team?workspace=work&jobId=job-one&jobTab=summary");
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_|999999|email|phone|object_key|recipient|token/);
  assert.match(context.limitations.join(" "), /read-only|have not been inspected/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.authRequests.length, 2);
  for (const request of f.authRequests) {
    assert.equal(request.headers.get("X-TLink-Business"), "business-one");
    assert.equal(request.headers.get("Authorization"), "Bearer synthetic");
    assert.equal(request.headers.get("X-TLink-Field-Session"), "synthetic-field");
    assert.equal(await request.text(), "");
  }
});

test("wrong actor, business, portal and unknown job fail without shared records", async t => {
  for (const [label, options, accessOverride, reference] of [
    ["actor", { team: { actorUid: "other-actor" } }],
    ["business", { team: { ownerUid: "other-business" } }],
    ["portal", {}, { scope: { portal: "council", scopeId: "business-one" } }],
    ["foreign job", {}, {}, { kind: "trade_job", recordId: "job-other" }],
    ["invalid ID", {}, {}, { kind: "trade_job", recordId: "../foreign" }],
  ]) await t.test(label, async child => {
    const f = fixture(child, options);
    await assert.rejects(f.load(reference, { ...f.access, ...accessOverride }), error => error.status === 403);
    assert.deepEqual(f.sharedCalls, []);
    assert.deepEqual(f.writes, []);
  });
});

test("ordinary workers require current assignment; existing visit collaboration remains supported", async t => {
  const f = fixture(t);
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='member-two' WHERE id='job-one'");
  await assert.rejects(f.load(), error => error.status === 403);
  f.insert("trade_crm_appointments", { id: "visit-one", firebase_uid: "business-one", work_order_id: "job-one", assignee_member_id: "member-one", status: "scheduled", starts_at: "2026-10-08T09:00", ends_at: "2026-10-08T10:00", created_at: "2026-10-07", updated_at: "2026-10-07" });
  assert.equal((await f.load()).title, "Electrical inspection");
  f.sqlite.exec("UPDATE trade_crm_appointments SET status='cancelled' WHERE id='visit-one'");
  await assert.rejects(f.load(), error => error.status === 403);
});

test("protected, unknown source and archived jobs cannot become model context", async t => {
  for (const [label, sql] of [
    ["platform private", "UPDATE trade_crm_job_details SET customer_source='platform_private' WHERE work_order_id='job-one'"],
    ["opportunity", "UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job-one'"],
    ["unknown customer source", "UPDATE trade_crm_job_details SET customer_source='unknown' WHERE work_order_id='job-one'"],
    ["archived", "UPDATE trade_work_orders SET record_status='archived' WHERE id='job-one'"],
  ]) await t.test(label, async child => {
    const f = fixture(child); f.sqlite.exec(sql);
    await assert.rejects(f.load(), error => error.status === 403);
    assert.deepEqual(f.sharedCalls, []);
  });
});

test("inconsistent released lead provenance cannot bypass shared consent through the local projection", async t => {
  for (const [label, sourceType, customerSource] of [
    ["public lead labelled trade owned", "public_lead", "trade_owned"],
    ["public lead labelled internal", "public_lead", "internal"],
    ["local job labelled released", "internal", "public_lead_released"],
  ]) await t.test(label, async child => {
    const f = fixture(child); f.quotePermission(true);
    f.sqlite.prepare("UPDATE trade_work_orders SET source_type=? WHERE id='job-one'").run(sourceType);
    f.sqlite.prepare("UPDATE trade_crm_job_details SET customer_source=? WHERE work_order_id='job-one'").run(customerSource);
    await assert.rejects(f.load(), error => error.status === 403);
    assert.deepEqual(f.sharedCalls, []);
    assert.ok(f.reads.every(query => !query.startsWith("SELECT work.id, work.work_number") && !query.startsWith("SELECT id,title,status")));
    assert.deepEqual(f.writes, []);
  });
});

test("revoked membership, reassignment and job change during projection prevent returning private context", async t => {
  for (const [label, sql, status] of [
    ["membership", "UPDATE trade_team_members SET status='removed' WHERE id='member-one'", 403],
    ["assignment", "UPDATE trade_work_orders SET assignee_member_id='member-two' WHERE id='job-one'", 403],
    ["revision", "UPDATE trade_work_orders SET revision=revision+1 WHERE id='job-one'", 409],
    ["protected source", "UPDATE trade_crm_job_details SET customer_source='platform_private' WHERE work_order_id='job-one'", 403],
  ]) await t.test(label, async child => {
    const f = fixture(child);
    f.beforeRead(query => { if (query.startsWith("SELECT id,title,status")) { f.sqlite.exec(sql); f.beforeRead(() => {}); } });
    await assert.rejects(f.load(), error => error.status === status);
  });
});

test("source hash is deterministic and changes for scope, job and checklist changes", async t => {
  const f = fixture(t), initial = (await f.load()).sourceSha256;
  assert.equal((await f.load()).sourceSha256, initial);
  f.sqlite.exec("UPDATE trade_crm_job_details SET description='Changed recorded work' WHERE work_order_id='job-one'");
  const changedJob = (await f.load()).sourceSha256;
  assert.notEqual(changedJob, initial);
  f.sqlite.exec("UPDATE trade_work_order_tasks SET status='done',completed_at='2026-10-07',revision=revision+1 WHERE id='task-one'");
  const changedTask = (await f.load()).sourceSha256;
  assert.notEqual(changedTask, changedJob);
  f.scope("team");
  assert.notEqual((await f.load()).sourceSha256, changedTask);
});

test("public released enquiry delegates to the exact existing shared source and preserves its explicit coverage", async t => {
  const f = fixture(t);
  f.sqlite.exec("UPDATE trade_work_orders SET source_type='public_lead' WHERE id='job-one'; UPDATE trade_crm_job_details SET customer_source='public_lead_released' WHERE work_order_id='job-one'");
  await assert.rejects(f.load(), error => error.status === 403);
  f.quotePermission(true);
  const context = await f.load();
  assert.equal(context.title, "Shared solar enquiry");
  assert.equal(context.facts.attachmentContentsReviewed, false);
  assert.equal(context.facts.questions[0].answer, "Rooftop solar");
  assert.equal(context.facts.checklist, undefined);
  assert.deepEqual(context.sources.map(source => source.id), ["trade_job_overview", "trade_job_questions"]);
  assert.ok(f.sharedCalls.every(call => call.database === f.db && call.id === "job-one" && call.current.ownerUid === "business-one"));
  assert.ok(f.reads.every(query => !query.startsWith("SELECT id,title,status")));
  f.sharedError("WORKFLOW_AI_FORBIDDEN");
  await assert.rejects(f.load(), error => error.status === 403);
  f.sharedError("WORKFLOW_AI_SOURCE_CHANGED");
  await assert.rejects(f.load(), error => error.status === 409);
});

test("UTF8 context and checklist limits fail completely without truncating records", async t => {
  const f = fixture(t);
  f.sqlite.prepare("UPDATE trade_crm_job_details SET description=? WHERE work_order_id='job-one'").run("界".repeat(9000));
  await assert.rejects(f.load(), error => error.status === 413);
  f.sqlite.prepare("UPDATE trade_crm_job_details SET description=? WHERE work_order_id='job-one'").run("Normal scope");
  for (let n = 2; n <= 51; n++) f.insert("trade_work_order_tasks", { id: `task-${n}`, firebase_uid: "business-one", work_order_id: "job-one", title: `Synthetic task ${n}`, status: "pending", created_at: "2026-10-07", updated_at: "2026-10-07" });
  await assert.rejects(f.load(), error => error.status === 413);
});

test("unexpected source errors produce a private safe failure", async t => {
  const f = fixture(t);
  f.beforeRead(() => { throw new Error("SQL SECRET connection details"); });
  await assert.rejects(f.load(), error => error.status === 503 && !/SECRET|SQL/.test(error.message));
});

test("existing MFA, business-selection and account-access errors keep their portal recovery identity", async t => {
  const f = fixture(t);
  for (const error of [new FirebaseMfaRequiredError(), new TradeAccessError("Account review required"), new TradeBusinessContextError("BUSINESS_ACCESS_REQUIRED")]) {
    f.authError(error);
    await assert.rejects(f.load(), received => received === error);
  }
  assert.equal(f.reads.length, 0);
});

test("the actual job detail handoff supplies only the scoped reference and an editable starter prompt", () => {
  const ui = readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");
  const detail = ui.slice(ui.indexOf("function JobDetail("), ui.indexOf("function CustomerDetail("));
  assert.match(detail, /const business = useTradeBusiness\(\)/);
  assert.match(detail, /business && !isProtected && job\.sourceType !== "opportunity"/);
  assert.match(detail, /requestWattzunAssistant\(\{ userUid: user\.uid, portal: "trade", scopeId: business\.ownerUid, mode: "message", workReference: \{ kind: "trade_job", recordId: job\.id \}, initialMessage: "Summarise this job, what is missing and the next steps\." \}\)/);
  assert.match(detail, />Ask Wattzun<\/button>/);
});
