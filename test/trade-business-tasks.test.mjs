import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as contracts from '../src/lib/trade-business-tasks.ts';
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const taskId = () => crypto.randomUUID();
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,display_name TEXT,status TEXT DEFAULT 'active',can_manage_team INTEGER DEFAULT 0,UNIQUE(owner_uid,id));
    CREATE TABLE trade_crews(id TEXT PRIMARY KEY,owner_uid TEXT,lead_member_id TEXT);
    CREATE TABLE trade_crew_members(owner_uid TEXT,crew_id TEXT,member_id TEXT,UNIQUE(owner_uid,member_id));
    `);
  sqlite.exec(fs.readFileSync(new URL('../drizzle/0131_trade_team_permissions_and_member_files.sql', import.meta.url), 'utf8').split('--> statement-breakpoint').find(sql => sql.includes('CREATE TABLE `trade_team_member_events`')));
  sqlite.exec(read('drizzle/0234_trade_business_tasks.sql'));
  class Statement {
    constructor(sql, bindings = []) { this.sql=sql; this.bindings=bindings; }
    bind(...bindings) { return new Statement(this.sql, bindings); }
    async first() { return sqlite.prepare(this.sql).get(...this.bindings) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.bindings) }; }
    runSync() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.bindings).changes) } }; }
  }
  let beforeBatch;
  const db={ prepare:sql=>new Statement(sql), async batch(statements) {
    if (beforeBatch) { const next=beforeBatch;beforeBatch=null;next(); }
    sqlite.exec('BEGIN'); try { const result=statements.map(s=>s.runSync());sqlite.exec('COMMIT');return result; } catch(error) { sqlite.exec('ROLLBACK');throw error; }
  }};
  const compiled = ts.transpileModule(read('src/lib/trade-business-tasks-server.ts'), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord={exports:{}};
  new Function('require','module','exports',compiled)(name=> { if(name==='../../db')return {getD1:()=>db};if(name==='./trade-business-tasks')return contracts;throw Error(name);},moduleRecord,moduleRecord.exports);
  function person(id, owner='business', manager=0) { sqlite.prepare('INSERT INTO trade_team_members(id,owner_uid,member_uid,display_name,can_manage_team) VALUES(?,?,?,?,?)').run(id,owner,id==='owner'?owner:`${id}-uid`,id,manager); }
  for(const id of ['owner','a','b','lead','worker','outside'])person(id);person('manager','business',1);person('foreign','another');
  sqlite.exec("INSERT INTO trade_crews VALUES('crew','business','lead'); INSERT INTO trade_crew_members VALUES('business','crew','lead'),('business','crew','worker');");
  const actor=id=>({ownerUid:'business',memberId:id,actorUid:id==='owner'?'business':`${id}-uid`,isOwner:id==='owner'});
  const api=moduleRecord.exports;
  const create=(id='a', assignee='a', extras={})=>api.saveBusinessTask(actor(id),{id:taskId(),action:'create',title:'Call supplier',assigneeMemberId:assignee,...extras},db);
  return {sqlite,db,api,actor,create,beforeBatch:fn=>{beforeBatch=fn;}};
}
test('quick tasks default to active and remain separate from jobs and training',async t=>{
  const f=fixture(t); const task=await f.create();assert.equal(task.status,'open');assert.equal(task.revision,1);
  assert.equal((await f.api.listBusinessTasks(f.actor('a'),{},f.db)).total,1);
  assert.equal(f.sqlite.prepare('SELECT event_type FROM trade_team_member_events').get().event_type,'task.created');
});
test('a task can be assigned to a teammate and tracked by its creator and recipient',async t=>{
  const f=fixture(t);await f.create('a','b');
  assert.equal((await f.api.listBusinessTasks(f.actor('a'),{view:'mine'},f.db)).total,0);
  assert.equal((await f.api.listBusinessTasks(f.actor('a'),{view:'delegated'},f.db)).total,1);
  assert.equal((await f.api.listBusinessTasks(f.actor('b'),{},f.db)).total,1);
  assert.equal((await f.api.listBusinessTasks(f.actor('outside'),{},f.db)).total,0);
  await assert.rejects(()=>f.api.listBusinessTasks(f.actor('b'),{view:'team'},f.db),/Team task access/);
});
test('owners and existing team managers can inspect team work',async t=>{
  const f=fixture(t);await f.create('a','b');
  assert.equal((await f.api.listBusinessTasks(f.actor('owner'),{view:'team'},f.db)).total,1);
  assert.equal((await f.api.listBusinessTasks(f.actor('manager'),{view:'team'},f.db)).total,1);
});
test('foreign business IDs cannot be used for assignments or task reads',async t=>{
  const f=fixture(t);await assert.rejects(()=>f.create('a','foreign'),/no longer available/);
  const task=await f.create('a','b');
  await assert.rejects(()=>f.api.saveBusinessTask({...f.actor('foreign'),ownerUid:'another'},{action:'status',id:task.id,revision:1,status:'done'},f.db),/no longer available/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_business_tasks').get().n,1);
});
test('crew leads can delegate only within their current crew',async t=>{
  const f=fixture(t);await f.create('lead','worker');await assert.rejects(()=>f.create('lead','outside'),/no longer available/);
  const people=await f.api.taskPeople(f.actor('lead'),'',f.db);assert.deepEqual(people.people.map(p=>p.id).sort(),['lead','worker']);
  assert.equal((await f.api.listBusinessTasks(f.actor('lead'),{view:'team'},f.db)).total,1);
  await assert.rejects(()=>f.create('worker','lead'),/no longer available/);
});
test('moving a worker out of a crew revokes the old lead task access immediately',async t=>{
  const f=fixture(t);const task=await f.create('lead','worker');f.sqlite.exec("DELETE FROM trade_crew_members WHERE member_id='worker'");
  assert.equal((await f.api.listBusinessTasks(f.actor('lead'),{view:'delegated'},f.db)).total,0);
  await assert.rejects(()=>f.api.saveBusinessTask(f.actor('lead'),{action:'status',id:task.id,revision:1,status:'done'},f.db),/no longer available/);
});
test('live crew membership prevents a stale non-crew session from assigning outside its new crew',async t=>{
  const f=fixture(t);f.beforeBatch(()=>f.sqlite.exec("INSERT INTO trade_crew_members VALUES('business','crew','a')"));
  await assert.rejects(()=>f.create('a','outside'),/no longer available/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_business_tasks').get().n,0);
});
test('suspended recipients cannot receive new tasks',async t=>{
  const f=fixture(t);f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='b'");
  await assert.rejects(()=>f.create('a','b'),/no longer available/);
  assert.equal((await f.api.taskPeople(f.actor('a'),'b',f.db)).people.length,0);
});
test('revoked actor access prevents writes even after the task was loaded',async t=>{
  const f=fixture(t);const task=await f.create();f.beforeBatch(()=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='a'"));
  await assert.rejects(()=>f.api.saveBusinessTask(f.actor('a'),{action:'status',id:task.id,revision:1,status:'done'},f.db),/access changed/);
  assert.equal(f.sqlite.prepare('SELECT status FROM trade_business_tasks').get().status,'open');
});
test('recipient changes status, but cannot overwrite the assigned instructions or rates',async t=>{
  const f=fixture(t);const task=await f.create('a','b');
  await assert.rejects(()=>f.api.saveBusinessTask(f.actor('b'),{action:'edit',id:task.id,revision:1,title:'Changed',assigneeMemberId:'a'},f.db),/person who assigned/);
  await f.api.saveBusinessTask(f.actor('b'),{action:'status',id:task.id,revision:1,status:'in_progress'},f.db);
  await f.api.saveBusinessTask(f.actor('b'),{action:'status',id:task.id,revision:2,status:'done'},f.db);
  const done=await f.api.listBusinessTasks(f.actor('b'),{status:'done'},f.db);assert.equal(done.total,1);assert.ok(done.tasks[0].completedAt);
  await f.api.saveBusinessTask(f.actor('b'),{action:'status',id:task.id,revision:3,status:'open'},f.db);
  assert.equal(f.sqlite.prepare('SELECT completed_at FROM trade_business_tasks').get().completed_at,'');
});
test('stale edits cannot overwrite a newer update and do not add a false audit event',async t=>{
  const f=fixture(t);const task=await f.create();
  await f.api.saveBusinessTask(f.actor('a'),{action:'status',id:task.id,revision:1,status:'done'},f.db);
  await assert.rejects(()=>f.api.saveBusinessTask(f.actor('a'),{action:'status',id:task.id,revision:1,status:'open'},f.db),/changed/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_team_member_events').get().n,2);
});
test('revision check inside mutation prevents concurrent status loss',async t=>{
  const f=fixture(t);const task=await f.create();f.beforeBatch(()=>f.sqlite.exec('UPDATE trade_business_tasks SET revision=2'));
  await assert.rejects(()=>f.api.saveBusinessTask(f.actor('a'),{action:'status',id:task.id,revision:1,status:'done'},f.db),/changed/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_team_member_events').get().n,1);
});
test('creator can reassign, edit notes and set an optional real calendar date',async t=>{
  const f=fixture(t);const task=await f.create();
  await f.api.saveBusinessTask(f.actor('a'),{action:'edit',id:task.id,revision:1,title:'Order parts',detail:'Blue fittings',dueOn:'2028-02-29',assigneeMemberId:'b'},f.db);
  const tasks=await f.api.listBusinessTasks(f.actor('b'),{},f.db);assert.equal(tasks.tasks[0].dueOn,'2028-02-29');assert.equal(tasks.tasks[0].detail,'Blue fittings');
});
test('invalid dates, status, identifiers and overlong inputs fail before writes',async t=>{
  const f=fixture(t);for(const extras of [{title:''},{title:'a'.repeat(181)},{detail:'a'.repeat(3001)},{dueOn:'2026-02-30'},{dueOn:'2026-13-01'},{id:'bad'}])await assert.rejects(()=>f.create('a','a',extras),contracts.BusinessTaskError);
  assert.throws(()=>contracts.taskStatus('cancelled'),contracts.BusinessTaskError);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_business_tasks').get().n,0);
});
test('repeated create request returns one task and one audit event',async t=>{
  const f=fixture(t);const id=taskId();await f.create('a','a',{id});await f.create('a','a',{id});
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_business_tasks').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_team_member_events').get().n,1);
  await assert.rejects(()=>f.create('a','a',{id,title:'Different'}),/different details/);
});
test('pagination does not silently drop large task lists and people search is bounded',async t=>{
  const f=fixture(t);for(let n=0;n<27;n++)await f.create('a','a',{title:`Task ${n}`});
  const first=await f.api.listBusinessTasks(f.actor('a'),{},f.db);const next=await f.api.listBusinessTasks(f.actor('a'),{page:'2'},f.db);
  assert.equal(first.total,27);assert.equal(first.tasks.length,25);assert.equal(first.totalPages,2);assert.equal(next.tasks.length,2);
  assert.deepEqual((await f.api.taskPeople(f.actor('a'),'outside',f.db)).people.map(p=>p.id),['outside']);
});
test('task migration preserves both member and business foreign key ownership',t=>{
  const f=fixture(t);assert.throws(()=>f.sqlite.prepare("INSERT INTO trade_business_tasks(id,owner_uid,title,assignee_member_id,created_by_member_id,created_at,updated_at) VALUES(?,'business','Task','foreign','a','','')").run(taskId()),/FOREIGN KEY/);
});

test('completing the final task on a later page returns to the last available page',async t=>{
  const f=fixture(t);for(let n=0;n<26;n++)await f.create('a','a',{title:`Task ${n}`});
  const last=(await f.api.listBusinessTasks(f.actor('a'),{page:'2'},f.db)).tasks[0];
  await f.api.saveBusinessTask(f.actor('a'),{action:'status',id:last.id,revision:last.revision,status:'done'},f.db);
  const refreshed=await f.api.listBusinessTasks(f.actor('a'),{page:'2'},f.db);
  assert.equal(refreshed.page,1);assert.equal(refreshed.totalPages,1);assert.equal(refreshed.tasks.length,25);
});
test('tasks and training stay one navigation destination while old training links still work',()=>{
  for(const file of ['DirectTradeDashboard','TradeTeamPortal']){const source=read(`src/components/${file}.tsx`);assert.match(source,/Tasks &amp; training/);assert.match(source,/TradeTasksAndTraining/);assert.match(source,/onOpenOwnTraining=.*training/);assert.match(source,/onOpenSchedule=/);}
  assert.match(read('src/components/TradeHomeDashboard.tsx'),/<TradeTasksWorkspace user=\{user\} compact/);
  const ui=read('src/components/TradeTasksWorkspace.tsx');assert.match(ui,/Assigned by me/);assert.match(ui,/crypto\.randomUUID/);assert.match(ui,/AbortController/);assert.match(ui,/type="date"/);assert.doesNotMatch(ui,/localStorage|dangerouslySetInnerHTML/);
});
