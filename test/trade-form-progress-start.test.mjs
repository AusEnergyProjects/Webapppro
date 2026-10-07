import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import * as collaboration from "../src/lib/trade-job-collaboration.ts";
import * as completion from "../src/lib/trade-activity-forms-completion.ts";
import { loadFormJobProgress } from "./helpers/trade-form-job-progress-fixture.mjs";
import { installEmptyTradeCrews } from "./helpers/trade-crews-fixture.mjs";

function fixture() {
  const database = new DatabaseSync(":memory:");
  installEmptyTradeCrews(database);
  database.exec(`CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, stage TEXT, revision INTEGER,
      assignee_member_id TEXT, record_status TEXT, partner_type TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT, firebase_uid TEXT, pipeline_stage TEXT);
    CREATE TABLE trade_crm_appointments(id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT,
      assignee_member_id TEXT, status TEXT, revision INTEGER);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY, owner_uid TEXT, member_uid TEXT, status TEXT,
      can_manage_field_evidence INTEGER, job_scope TEXT);
    INSERT INTO trade_work_orders VALUES('job','business','in_progress',8,'worker','active','installer');
    INSERT INTO trade_crm_job_details VALUES('job','business','in_progress');
    INSERT INTO trade_team_members VALUES('worker','business','actor','active',1,'own');`);
  const reads = [];
  const db = {
    prepare(sql) { return { bind(...values) { return { async first() {
      reads.push(sql);
      if (!sql.includes("SELECT current_job.id")) throw new Error("Completion or transition read reached");
      return database.prepare(sql).get(...values) ?? null;
    } }; } }; },
    batch() { assert.fail("Already-started work must not mutate its job or visits"); },
  };
  const progress = loadFormJobProgress(db, specifier => {
    if (specifier === "@/lib/trade-job-collaboration") return collaboration;
    if (specifier === "@/lib/trade-activity-forms-completion") return completion;
    return {};
  });
  const access = { ownerUid: "business", actorUid: "actor", memberId: "worker", isOwner: false,
    jobScope: "own", canManageFieldEvidence: true };
  const run = options => progress.reconcileTradeFormJobProgress(access, "job", { db, startOnly: true, ...options });
  return { database, reads, access, run };
}

test("starting already-started job and visit performs one fresh authority read without completion scans or writes", async () => {
  for (const visit of [false, true]) {
    const f = fixture();
    try {
      if (visit) f.database.exec("INSERT INTO trade_crm_appointments VALUES('visit','job','business','worker','in_progress',2)");
      assert.deepEqual(await f.run(), { changed: false, stage: "in_progress", blockers: [] });
      assert.equal(f.reads.length, 1);
      assert.equal(f.database.prepare("SELECT revision FROM trade_work_orders WHERE id='job'").get().revision, 8);
      if (visit) assert.equal(f.database.prepare("SELECT revision FROM trade_crm_appointments WHERE id='visit'").get().revision, 2);
    } finally { f.database.close(); }
  }
});

test("scheduled own visit and genuine completion still reach canonical transition and requirement checks", async () => {
  for (const scenario of ["scheduled visit", "scheduled job", "completion"]) {
    const f = fixture();
    try {
      if (scenario === "scheduled visit") f.database.exec("INSERT INTO trade_crm_appointments VALUES('visit','job','business','worker','scheduled',2)");
      if (scenario === "scheduled job") f.database.exec("UPDATE trade_work_orders SET stage='scheduled'");
      await assert.rejects(f.run(scenario === "completion" ? { startOnly: false } : {}), /Completion or transition read reached/);
      assert.equal(f.reads.length, 2);
    } finally { f.database.close(); }
  }
});

test("start fast path rereads assignment, account membership and evidence permission every time", async () => {
  for (const change of [
    "UPDATE trade_work_orders SET assignee_member_id='other'",
    "UPDATE trade_work_orders SET firebase_uid='other-business'",
    "UPDATE trade_work_orders SET record_status='archived'",
    "UPDATE trade_work_orders SET partner_type='auditor'",
    "UPDATE trade_team_members SET member_uid='other-actor'",
    "UPDATE trade_team_members SET status='suspended'",
    "UPDATE trade_team_members SET can_manage_field_evidence=0",
  ]) {
    const f = fixture();
    try {
      assert.equal((await f.run()).stage, "in_progress");
      f.database.exec(change);
      const denied = await f.run();
      assert.equal(denied.changed, false); assert.equal(denied.blockers[0]?.key, "access");
      assert.equal(f.reads.length, 2);
    } finally { f.database.close(); }
  }
});

test("team scope downgraded or narrowed to a crew is denied before the start fast path", async () => {
  for (const change of ["UPDATE trade_team_members SET job_scope='own'",
    "INSERT INTO trade_crew_members VALUES('business','crew','worker','2026-10-08')"]) {
    const f = fixture();
    try {
      f.access.jobScope = "team";
      f.database.exec("UPDATE trade_team_members SET job_scope='team'; UPDATE trade_work_orders SET assignee_member_id='other'");
      assert.equal((await f.run()).stage, "in_progress");
      f.database.exec(change);
      assert.equal((await f.run()).blockers[0]?.key, "access"); assert.equal(f.reads.length, 2);
    } finally { f.database.close(); }
  }
});
