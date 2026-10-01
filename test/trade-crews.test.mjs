import { TRADE_CREW_SCHEMA_GUARDS } from "../src/lib/trade-crews-schema-guards.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as collaboration from "../src/lib/trade-job-collaboration.ts";
import { canAssignWithinScope, canRescheduleWithinScope } from "../src/lib/trade-team-permission-policy.mjs";
import { crewMutationGuard } from "../src/lib/trade-crews.ts";
import { jobSyncChangeStatements } from "../src/lib/trade-team-sync-server.ts";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const now = "2026-10-02T00:00:00.000Z";
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT DEFAULT 'active',revision INTEGER DEFAULT 1);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
    CREATE TABLE trade_team_sync_changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner_uid TEXT,audience_member_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,revision INTEGER,changed_at TEXT);
    CREATE TABLE trade_mobile_push_outbox(id TEXT PRIMARY KEY,owner_uid TEXT,audience_member_id TEXT,event_key TEXT,event_type TEXT,entity_type TEXT,entity_id TEXT,payload TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,created_at TEXT,updated_at TEXT);`);
  for (const file of ["0025_dizzy_spot.sql", "0070_frictionless_team_roster.sql", "0131_trade_team_permissions_and_member_files.sql"]) sqlite.exec(read(`drizzle/${file}`));
  sqlite.exec("ALTER TABLE trade_team_members ADD can_send_sms INTEGER NOT NULL DEFAULT 0;");
  for (const statement of read("drizzle/0231_trade_crews.sql").split(";")) {
    if (statement.replace(/--[^\n]*/g, "").trim()) sqlite.prepare(statement).run();
  }
  for (const definition of TRADE_CREW_SCHEMA_GUARDS) sqlite.prepare(definition.sql).run();
  class Statement {
    constructor(sql, values=[]) { this.sql=sql;this.values=values; }
    bind(...values) { return new Statement(this.sql,values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values)||null; }
    async all() { return { results:sqlite.prepare(this.sql).all(...this.values) }; }
    runSync() { return { meta:{ changes:Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    async run() { return this.runSync(); }
  }
  let beforeBatch;
  const db={prepare:sql=>new Statement(sql),async batch(statements){
    if(beforeBatch){const hook=beforeBatch;beforeBatch=null;hook();}
    sqlite.exec("BEGIN");try{const result=statements.map(statement=>statement.runSync());sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}
  }};
  const source=ts.transpileModule(read("src/lib/trade-crews-server.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const moduleRecord={exports:{}};new Function("require","module","exports",source)(specifier=>{
    if(specifier==="../../db")return {getD1:()=>db};
    if(specifier==="./trade-job-collaboration")return collaboration;
    throw new Error(`Unexpected dependency ${specifier}`);
  },moduleRecord,moduleRecord.exports);
  function person(id,owner="owner") { sqlite.prepare(`INSERT INTO trade_team_members(id,owner_uid,member_uid,email,display_name,status,invited_at,created_at,updated_at,can_manage_jobs,can_assign_jobs,can_reschedule_jobs,can_view_field_evidence,can_manage_field_evidence,can_run_reports)
    VALUES(?,?,?,?,?,'active',?,?,?,1,1,1,1,1,1)`).run(id,owner,`${id}-uid`,`${id}@test.invalid`,id,now,now,now); }
  for(const id of ["lead","worker","other-lead","other-worker"])person(id);person("foreign","another-owner");
  for(const [id,assignee] of [["crew-job","worker"],["outside-job","other-worker"],["lead-job","lead"]])sqlite.prepare("INSERT INTO trade_work_orders(id,firebase_uid,assignee_member_id) VALUES(?,'owner',?)").run(id,assignee);
  const owner={ownerUid:"owner",actorUid:"owner",memberId:"owner-member",isOwner:true};
  const actor=id=>({ownerUid:"owner",actorUid:`${id}-uid`,memberId:id,isOwner:false,jobScope:"team",scheduleScope:"team",canManageJobs:true,canAssignJobs:true,canRescheduleJobs:true,canManageTeam:true,canViewCustomers:true,canSearchCustomers:true,canViewInvoices:true,canViewQuotes:true,canRunReports:true});
  const save=(extra={})=>moduleRecord.exports.saveTradeCrew(owner,{name:"Installers",companyName:"Subcontractor Pty Ltd",leadMemberId:"lead",memberIds:["lead","worker"],...extra},db);
  return {sqlite,db,owner,actor,save,server:moduleRecord.exports,setBeforeBatch:hook=>{beforeBatch=hook;}};
}

test("crew migration and save enforce same-business active memberships, owner-only edits and optimistic revision",async t=>{
  const f=fixture(t);const crew=await f.save();
  assert.equal(crew.revision,1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM trade_crew_members").get().n,2);
  await assert.rejects(()=>f.server.saveTradeCrew(f.actor("lead"),{},f.db),/Only the business owner/);
  await assert.rejects(()=>f.save({name:"Foreign",leadMemberId:"foreign",memberIds:["foreign"]}),/active people from this business/);
  await assert.rejects(()=>f.save({name:"Duplicate"}),/another crew/);
  await assert.rejects(()=>f.save({id:crew.id,revision:99}),/changed/);
  f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='other-worker'");
  await assert.rejects(()=>f.save({name:"Inactive",leadMemberId:"other-lead",memberIds:["other-lead","other-worker"]}),/active people/);
});

test("crew lead sees own crew jobs and personally assigned jobs, never other crews or businesses",async t=>{
  const f=fixture(t);await f.save();await f.save({name:"Other",leadMemberId:"other-lead",memberIds:["other-lead","other-worker"]});
  assert.equal(await collaboration.isJobMember(f.db,"owner","crew-job","lead"),true);
  assert.equal(await collaboration.isJobMember(f.db,"owner","outside-job","lead"),false);
  assert.equal(await collaboration.isJobMember(f.db,"owner","lead-job","worker"),false);
  assert.equal(await collaboration.isJobMember(f.db,"another-owner","crew-job","lead"),false);
  f.sqlite.exec("INSERT INTO trade_crm_appointments VALUES('outside-job','owner','worker','scheduled')");
  assert.equal(await collaboration.isJobMember(f.db,"owner","outside-job","lead"),true);
  f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='lead'");
  assert.equal(await collaboration.isJobMember(f.db,"owner","crew-job","lead"),false);
});

test("crew access restricts scopes and sensitive grants while preserving qualified assigned-report permission",async t=>{
  const f=fixture(t);await f.save();const access=await f.server.applyTradeCrewAccess(f.actor("lead"),f.db);
  assert.equal(access.crewLead,true);assert.deepEqual(access.crewMemberIds,["lead","worker"]);
  assert.equal(access.jobScope,"own");assert.equal(access.scheduleScope,"own");
  for(const permission of ["canCreateJobs","canManageTeam","canEditTeamPermissions","canViewCustomers","canSearchCustomers","canViewInvoices","canViewQuotes","canManagePriceBook","canSendSms"])assert.equal(access[permission],false,permission);
  assert.equal(access.canRunReports,true);assert.equal(access.canAssignJobs,true);
  const worker=await f.server.applyTradeCrewAccess(f.actor("worker"),f.db);assert.equal(worker.canAssignJobs,false);assert.deepEqual(worker.crewMemberIds,["worker"]);
  const nonCrew=f.actor("other-lead");assert.equal(await f.server.applyTradeCrewAccess(nonCrew,f.db),nonCrew);
  assert.equal(await f.server.applyTradeCrewAccess(f.owner,f.db),f.owner);
  assert.throws(()=>f.sqlite.exec("UPDATE trade_team_members SET job_scope='team' WHERE id='lead'"),/CREW_SCOPE_REQUIRED/);
  assert.throws(()=>f.sqlite.exec("UPDATE trade_team_members SET can_view_invoices=1 WHERE id='worker'"),/CREW_SCOPE_REQUIRED/);
});

test("crew lead assignment is limited to currently assigned crew jobs and same-crew targets",async t=>{
  const f=fixture(t);await f.save();const access=await f.server.applyTradeCrewAccess(f.actor("lead"),f.db);
  assert.equal(canAssignWithinScope(access,"lead","worker"),true);
  for(const [from,to]of [["other-worker","worker"],["worker","other-worker"],["","worker"],["worker",""]])assert.equal(canAssignWithinScope(access,from,to),false);
  assert.equal(canRescheduleWithinScope(access,"worker"),true);assert.equal(canRescheduleWithinScope(access,"other-worker"),false);
  const guard=crewMutationGuard(access,["lead","worker"]);
  assert.equal(f.sqlite.prepare(`SELECT ${guard.sql} allowed`).get(...guard.bindings).allowed,1);
  f.sqlite.exec("DELETE FROM trade_crew_members WHERE member_id='worker'");
  assert.equal(f.sqlite.prepare(`SELECT ${guard.sql} allowed`).get(...guard.bindings).allowed,0);
});

test("membership changes emit cache removals, preserve member history and cannot restore broader scopes",async t=>{
  const f=fixture(t);const crew=await f.save();await f.save({id:crew.id,revision:crew.revision,memberIds:["lead"]});
  assert.equal(await collaboration.isJobMember(f.db,"owner","crew-job","lead"),false);
  const change=f.sqlite.prepare("SELECT operation FROM trade_team_sync_changes WHERE audience_member_id='lead' AND entity_id='crew-job' ORDER BY sequence DESC LIMIT 1").get();
  assert.equal(change.operation,"delete");
  assert.equal(f.sqlite.prepare("SELECT job_scope FROM trade_team_members WHERE id='worker'").get().job_scope,"own");
  assert.ok(f.sqlite.prepare("SELECT count(*) n FROM trade_team_member_events WHERE team_member_id='worker'").get().n>=2);
  assert.equal(f.sqlite.prepare("SELECT assignee_member_id FROM trade_work_orders WHERE id='crew-job'").get().assignee_member_id,"worker");
});

test("crew save rolls back stale membership and permission edits atomically",async t=>{
  const f=fixture(t);const crew=await f.save();f.setBeforeBatch(()=>f.sqlite.prepare("UPDATE trade_crews SET revision=revision+1 WHERE id=?").run(crew.id));
  await assert.rejects(()=>f.save({id:crew.id,revision:crew.revision,memberIds:["lead"]}),/changed/);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM trade_crew_members WHERE crew_id=?").get(crew.id).n,2);
});

test("ongoing job sync includes authorised crew leads and removes their access after reassignment",async t=>{
  const f=fixture(t);await f.save();await f.db.batch(jobSyncChangeStatements(f.db,{ownerUid:"owner",workOrderId:"crew-job",revision:2,changedAt:now}));
  assert.equal(f.sqlite.prepare("SELECT operation FROM trade_team_sync_changes WHERE audience_member_id='lead' AND entity_id='crew-job' ORDER BY sequence DESC LIMIT 1").get().operation,"upsert");
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='other-worker' WHERE id='crew-job'");
  await f.db.batch(jobSyncChangeStatements(f.db,{ownerUid:"owner",workOrderId:"crew-job",revision:3,changedAt:now}));
  assert.equal(f.sqlite.prepare("SELECT operation FROM trade_team_sync_changes WHERE audience_member_id='lead' AND entity_id='crew-job' ORDER BY sequence DESC LIMIT 1").get().operation,"delete");
});

test("crew read payload exposes only authorised crew names and operational member names",async t=>{
  const f=fixture(t);await f.save();await f.save({name:"Other",leadMemberId:"other-lead",memberIds:["other-lead","other-worker"]});
  const result=await f.server.listTradeCrews(f.actor("lead"),f.db);assert.equal(result.crews.length,1);assert.equal(result.crews[0].name,"Installers");
  assert.deepEqual(result.members.map(row=>row.id),["lead","worker"]);assert.equal(JSON.stringify(result).includes("@test.invalid"),false);
  await assert.rejects(()=>f.server.listTradeCrews(f.actor("missing"),f.db),/Crew access/);
});
