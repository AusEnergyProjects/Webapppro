import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as timing from '../src/lib/trade-work-time.ts';
import * as periods from '../src/lib/trade-business-reports.ts';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as guards from '../src/lib/trade-message-media-access.ts';
import * as bounded from '../src/lib/bounded-request-body.mjs';
import { installEmptyTradeCrews } from './helpers/trade-crews-fixture.mjs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,deps){const out={};Function('require','exports',ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},out);return out;}
const at=hour=>`2026-10-01T${String(hour).padStart(2,'0')}:00:00.000Z`;
const now=new Date(at(12));
let sequence=0;
const session=(changes={})=>({id:`12345678-1234-4234-8234-${String(++sequence).padStart(12,'0')}`,kind:'form',source:'native',formKind:'job_form',formId:'form-a',workOrderId:'job-a',pageKey:'before',pageTitle:'Before work',startedAt:at(0),endedAt:at(1),...changes});
const owner={ownerUid:'business-a',actorUid:'owner-user',memberId:'owner',isOwner:true,jobScope:'team',canManageTeam:true,canManageFieldEvidence:true};
const worker={...owner,actorUid:'worker-user',memberId:'worker',isOwner:false,jobScope:'own',canManageTeam:false};
const lead={...worker,actorUid:'lead-user',memberId:'lead'};

test('session boundary accepts page keys, forbids forged actors and invalid completion times',()=>{
  const entry=session({pageKey:'module:before.photo'});
  assert.deepEqual(timing.parseWorkTimeBatch({sessions:[entry]},now.getTime()),[entry]);
  assert.deepEqual(timing.parseWorkTimeBatch({sessions:[{...entry,completedAt:entry.endedAt}]},now.getTime())[0].completedAt,entry.endedAt);
  for(const invalid of [{...entry,ownerUid:'other'},{...entry,pageKey:''},{...entry,pageTitle:'x'.repeat(161)},{...entry,endedAt:at(0),startedAt:at(1)},{...entry,completedAt:at(2)},{...entry,startedAt:'2020-01-01T00:00:00.000Z'},{...entry,endedAt:'2026-10-02T12:00:00.000Z'}]) assert.throws(()=>timing.parseWorkTimeBatch({sessions:[invalid]},now.getTime()),timing.WorkTimeInputError);
  assert.throws(()=>timing.parseWorkTimeBatch({sessions:[entry,entry]},now.getTime()),timing.WorkTimeInputError);
  assert.throws(()=>timing.parseWorkTimeBatch({sessions:Array.from({length:31},()=>session())},now.getTime()),timing.WorkTimeInputError);
});

test('SWMS sessions use the same page, completion and actor validation as other forms',()=>{
  const entry=session({formKind:'swms',formId:'swms-a',pageKey:'controls',pageTitle:'Risk controls',completedAt:at(1)});
  assert.deepEqual(timing.parseWorkTimeBatch({sessions:[entry]},now.getTime()),[entry]);
  for(const changes of [{pageKey:''},{completedAt:at(2)},{memberId:'scheduled-worker'},{kind:'app'}]) {
    assert.throws(()=>timing.parseWorkTimeBatch({sessions:[{...entry,...changes}]},now.getTime()),timing.WorkTimeInputError);
  }
});

test('phone-away gaps remain in elapsed page windows; returns to the same page are coalesced',()=>{
  const windows=timing.formPageWindows([
    {pageKey:'before',startedAt:at(0),endedAt:at(1)},
    {pageKey:'before',startedAt:at(3),endedAt:at(3)},
    {pageKey:'after',startedAt:at(4),endedAt:at(5)},
    {pageKey:'before',startedAt:at(6),endedAt:at(7)},
  ],at(8),at(12));
  assert.deepEqual(windows,[{pageKey:'before',startedAt:at(0),endedAt:at(4)},{pageKey:'after',startedAt:at(4),endedAt:at(6)},{pageKey:'before',startedAt:at(6),endedAt:at(8)}]);
  assert.equal(timing.workTimeSeconds(windows,at(0),at(12)),8*3600);
  assert.equal(timing.formPageWindows([{pageKey:'before',startedAt:at(0),endedAt:at(1)}],'',at(8))[0].endedAt,at(8));
});

test('overlaps and week clipping never double count the same person across forms or devices',()=>{
  assert.equal(timing.workTimeSeconds([{startedAt:at(0),endedAt:at(5)},{startedAt:at(3),endedAt:at(8)},{startedAt:at(3),endedAt:at(8)}],at(2),at(7)),5*3600);
});

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,display_name TEXT,status TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT,address_state TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,assignee_member_id TEXT,work_number TEXT,title TEXT,stage TEXT,source_type TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT);
    CREATE TABLE trade_job_forms(id TEXT PRIMARY KEY,firebase_uid TEXT,work_order_id TEXT,template_name TEXT,completed_at TEXT);
    CREATE TABLE trade_activity_field_records(id TEXT,owner_uid TEXT,work_order_id TEXT,payload TEXT,submitted_at TEXT);
    CREATE TABLE trade_rental_inspections(id TEXT,firebase_uid TEXT,work_order_id TEXT,inspection_number TEXT,submitted_at TEXT,issued_at TEXT);
    CREATE TABLE compliance_cases(id TEXT,organisation_id TEXT,work_order_id TEXT,installer_uid TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT,instance_key TEXT,organisation_id TEXT,compliance_case_id TEXT,work_order_id TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(organisation_id TEXT,instance_key TEXT,finalised_at TEXT);
    INSERT INTO trade_team_members VALUES('owner','business-a','owner-user','Owner','active'),('worker','business-a','worker-user','Worker','active'),('lead','business-a','lead-user','Lead','active'),('other','business-a','other-user','Other','active'),('foreign','business-b','foreign-user','Foreign','active');
    INSERT INTO trade_accounts VALUES('business-a','NSW');
    INSERT INTO trade_work_orders VALUES('job-a','business-a','installer','active','worker','JOB-A','Crew job','scheduled','direct'),('job-b','business-a','installer','active','other','JOB-B','Other crew','scheduled','direct'),('job-x','business-b','installer','active','foreign','JOB-X','Foreign job','scheduled','direct');
    INSERT INTO trade_job_forms VALUES('form-a','business-a','job-a','Safety check',''),('form-b','business-a','job-a','Photos',''),('form-other','business-a','job-b','Other form',''),('form-x','business-b','job-x','Foreign form','');`);
  installEmptyTradeCrews(sqlite);
  sqlite.exec(`INSERT INTO trade_crews VALUES('crew','business-a','Crew','','lead',1,'',''); INSERT INTO trade_crew_members VALUES('business-a','crew','lead',''),('business-a','crew','worker','');`);
  sqlite.exec(read('../drizzle/0232_trade_work_time.sql'));
  sqlite.exec(read('../drizzle/0233_trade_job_swms.sql'));
  sqlite.exec(`INSERT INTO trade_job_swms
    (id,firebase_uid,work_order_id,template_key,template_name,template_version,template_snapshot,context_json,answers_json,last_actor_uid,last_actor_member_id,created_by_uid,created_at,updated_at)
    VALUES('swms-a','business-a','job-a','tlink-swms-v1','Safe work method statement',1,'{}','{"scheduledWorker":{"memberId":"lead","name":"Lead"}}','{}','worker-user','worker','worker-user','','');`);
  let beforeRun;
  const statement=(sql,values=[])=>({bind:(...next)=>statement(sql,next),first:async()=>sqlite.prepare(sql).get(...values)||null,all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>{if(beforeRun){const action=beforeRun;beforeRun=null;action();}return{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}});
  const db={prepare:statement},progress=[];
  const server=load('../src/lib/trade-work-time-server.ts',{'../../db':{getD1:()=>db},'./trade-work-time':timing,'./trade-business-reports':periods,'./trade-job-collaboration':collaboration,'./trade-message-media-access':guards,
    './trade-form-job-progress':{reconcileTradeFormJobProgress:async(...args)=>progress.push(args)},
    './trade-crews-server':{readTradeCrewScope:async access=>{const row=sqlite.prepare('SELECT c.id,c.lead_member_id FROM trade_crews c JOIN trade_crew_members m ON m.crew_id=c.id AND m.owner_uid=c.owner_uid WHERE m.member_id=? AND m.owner_uid=?').get(access.memberId,access.ownerUid);return row?{crewId:row.id,isLead:row.lead_member_id===access.memberId}:null;},readTradeCrewMemberIds:async access=>sqlite.prepare('SELECT member_id FROM trade_crew_members WHERE owner_uid=? AND crew_id=(SELECT crew_id FROM trade_crew_members WHERE owner_uid=? AND member_id=?)').all(access.ownerUid,access.ownerUid,access.memberId).map(row=>row.member_id)}});
  return{sqlite,db,server,progress,beforeRun:action=>{beforeRun=action;},close:()=>sqlite.close()};
}

test('server derives identity, updates spans monotonically and keeps page identity immutable',async()=>{
  const f=fixture();try{
    const entry=session();await f.server.saveWorkTimeSessions(worker,[entry],f.db,at(12));
    await f.server.saveWorkTimeSessions(worker,[{...entry,endedAt:at(2)}],f.db,at(12));
    await f.server.saveWorkTimeSessions(worker,[entry],f.db,at(12));
    const saved=f.sqlite.prepare('SELECT * FROM trade_work_time_sessions').get();assert.equal(saved.owner_uid,'business-a');assert.equal(saved.member_id,'worker');assert.equal(saved.ended_at,at(2));assert.equal(saved.page_key,'before');assert.equal(saved.form_key,'job_form:job-a:form-a');
    await assert.rejects(f.server.saveWorkTimeSessions(worker,[{...entry,pageKey:'after'}],f.db),f.server.WorkTimeConflictError);
    assert.equal(f.progress.length,3);assert.equal(f.progress[0][2].startOnly,true);
  }finally{f.close();}
});

for(const ordinaryCompletion of ['',at(8)]) test(`SWMS timing cannot start or finish work alongside ${ordinaryCompletion?'completed':'unfinished'} ordinary forms, including later recovery`,async()=>{
  const f=fixture();try{
    f.sqlite.prepare('UPDATE trade_job_forms SET completed_at=? WHERE work_order_id=?').run(ordinaryCompletion,'job-a');
    const opened=session({formKind:'swms',formId:'swms-a',pageKey:'work-description',pageTitle:'Work description'});
    await f.server.saveWorkTimeSessions(worker,[opened],f.db,at(12));
    assert.equal(f.progress.length,0,'opening an optional SWMS never calls job progress');
    f.sqlite.prepare("UPDATE trade_job_swms SET status='complete',signature_json='{}',snapshot_sha256=?,completed_at=? WHERE id='swms-a'").run('a'.repeat(64),at(10));
    const completed=session({formKind:'swms',formId:'swms-a',pageKey:'signature',pageTitle:'Signature',startedAt:at(6),endedAt:at(6),completedAt:at(6)});
    await f.server.saveWorkTimeSessions(worker,[completed],f.db,at(12));
    assert.equal(f.progress.length,0,'a SWMS completion marker never calls job progress');
    await f.server.saveWorkTimeSessions(worker,[session({kind:'app',formKind:'',formId:'',workOrderId:'',pageKey:'',pageTitle:''})],f.db,at(12));
    assert.equal(f.progress.length,0,'persisted SWMS completion cannot be recovered as job completion');
    assert.equal(f.sqlite.prepare("SELECT stage FROM trade_work_orders WHERE id='job-a'").get().stage,'scheduled');
    await f.server.saveWorkTimeSessions(worker,[session()],f.db,at(12));
    assert.equal(f.progress.length,1,'ordinary form activity still reconciles');
    assert.equal(f.progress[0][2].startOnly,true,'the saved SWMS marker cannot upgrade ordinary activity into a finish signal');
  }finally{f.close();}
});

test('SWMS pages and observed completion appear in time reports under the actual actor, not the scheduled worker',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[
      session({formKind:'swms',formId:'swms-a',pageKey:'description',pageTitle:'Work description'}),
      session({formKind:'swms',formId:'swms-a',pageKey:'controls',pageTitle:'Risk controls',startedAt:at(3),endedAt:at(4)}),
      session({formKind:'swms',formId:'swms-a',pageKey:'controls',pageTitle:'Risk controls',startedAt:at(6),endedAt:at(6),completedAt:at(6)}),
    ],f.db,at(12));
    f.sqlite.prepare("UPDATE trade_job_swms SET status='complete',signature_json='{}',snapshot_sha256=?,completed_at=? WHERE id='swms-a'").run('a'.repeat(64),at(10));
    const report=await f.server.loadWorkTimeReport(owner,new URLSearchParams(),f.db,now);
    const form=report.forms.find(row=>row.formKind==='swms'),person=report.members.find(row=>row.memberId==='worker');
    assert.equal(form.formId,'swms-a');assert.equal(form.title,'Safe work method statement');
    assert.equal(form.completedAt,at(10));assert.equal(form.workFinishedAt,at(6));
    assert.equal(form.elapsedSeconds,6*3600);assert.equal(form.activeSeconds,2*3600);
    assert.deepEqual(form.pages.map(page=>[page.key,page.elapsedSeconds,page.activeSeconds]),[['description',3*3600,3600],['controls',3*3600,3600]]);
    assert.deepEqual(form.members,['Worker']);assert.equal(person.formSeconds,2*3600);assert.equal(person.workSeconds,6*3600);
    assert.equal(report.members.find(row=>row.memberId==='lead').formSeconds,0);
    assert.equal(f.progress.length,0);
    const later=await f.server.loadWorkTimeReport(owner,new URLSearchParams(),f.db,new Date('2026-10-08T12:00:00.000Z'));
    assert.equal(later.forms.length,0,'a completed SWMS must not appear to remain open in later weeks');
  }finally{f.close();}
});

test('server rejects foreign forms, unassigned jobs, inactive actors and write-time revocation',async()=>{
  const f=fixture();try{
    await assert.rejects(f.server.saveWorkTimeSessions(worker,[session({formId:'form-x'})],f.db),f.server.WorkTimeConflictError);
    await assert.rejects(f.server.saveWorkTimeSessions(worker,[session({formId:'form-other',workOrderId:'job-b'})],f.db),f.server.WorkTimeAccessError);
    await assert.rejects(f.server.saveWorkTimeSessions({...worker,memberId:'other'},[session()],f.db),f.server.WorkTimeAccessError);
    f.beforeRun(()=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='worker'"));
    await assert.rejects(f.server.saveWorkTimeSessions(worker,[session()],f.db),f.server.WorkTimeAccessError);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_work_time_sessions').get().n,0);
  }finally{f.close();}
});

test('reports before/after elapsed work separately from active use; offline completion excludes sync delay',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[session({endedAt:at(1)}),session({pageKey:'after',pageTitle:'After work',startedAt:at(4),endedAt:at(5)}),session({pageKey:'after',pageTitle:'After work',startedAt:at(6),endedAt:at(6),completedAt:at(6)})],f.db,at(12));
    f.sqlite.prepare('UPDATE trade_job_forms SET completed_at=? WHERE id=?').run(at(10),'form-a');
    await f.server.saveWorkTimeSessions(worker,[session({formId:'form-b',startedAt:at(2),endedAt:at(3)})],f.db,at(12));
    f.sqlite.prepare('UPDATE trade_job_forms SET completed_at=? WHERE id=?').run(at(8),'form-b');
    const report=await f.server.loadWorkTimeReport(owner,new URLSearchParams(),f.db,now);
    assert.equal(f.progress[0][2].startOnly,false,'a durable completion marker retries the full guarded projection');
    const person=report.members.find(row=>row.memberId==='worker'),form=report.forms.find(row=>row.formId==='form-a');
    assert.equal(form.elapsedSeconds,6*3600);assert.equal(form.activeSeconds,2*3600);assert.equal(form.completedAt,at(10));assert.equal(form.workFinishedAt,at(6));
    assert.equal(form.pages.find(page=>page.key==='before').elapsedSeconds,4*3600);
    assert.equal(person.appSeconds,3*3600);assert.equal(person.workSeconds,8*3600);assert.equal(report.jobs[0].elapsedSeconds,8*3600);
  }finally{f.close();}
});

test('form left open continues across background time and weekly boundaries without app activity',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[session({startedAt:'2026-09-27T12:00:00.000Z',endedAt:'2026-09-27T12:01:00.000Z'})],f.db,at(12));
    const report=await f.server.loadWorkTimeReport(owner,new URLSearchParams(),f.db,now);
    const person=report.members.find(row=>row.memberId==='worker');
    assert.equal(person.appSeconds,0);assert.ok(person.workSeconds>3*86400);assert.equal(report.forms.length,1);assert.equal(report.forms[0].completedAt,'');
  }finally{f.close();}
});

test('shared offline form completion bounds a self report without exposing the completing contributor',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[session()],f.db,at(12));
    await f.server.saveWorkTimeSessions(owner,[session({startedAt:at(6),endedAt:at(6),completedAt:at(6)})],f.db,at(12));
    f.sqlite.prepare('UPDATE trade_job_forms SET completed_at=? WHERE id=?').run(at(10),'form-a');
    const report=await f.server.loadWorkTimeReport(worker,new URLSearchParams(),f.db,now);
    assert.equal(report.forms[0].workFinishedAt,at(6));assert.equal(report.forms[0].elapsedSeconds,6*3600);
    assert.deepEqual(report.forms[0].members,['Worker']);assert.deepEqual(report.members.map(row=>row.memberId),['worker']);
  }finally{f.close();}
});

test('later app activity retries own saved completion when another worker has since cleared blockers',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[session({startedAt:at(6),endedAt:at(6),completedAt:at(6)})],f.db,at(12));
    f.progress.length=0;
    await f.server.saveWorkTimeSessions(worker,[session({kind:'app',formKind:'',formId:'',workOrderId:'',pageKey:'',pageTitle:''})],f.db,at(12));
    assert.equal(f.progress.length,1);assert.equal(f.progress[0][1],'job-a');assert.equal(f.progress[0][2].startOnly,false);
    f.progress.length=0;f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='other' WHERE id='job-a'");
    await f.server.saveWorkTimeSessions(worker,[session({kind:'app',formKind:'',formId:'',workOrderId:'',pageKey:'',pageTitle:''})],f.db,at(12));
    assert.equal(f.progress.length,0,'reassignment never borrows another worker authority');
  }finally{f.close();}
});

test('lead report is restricted to current crew and assigned jobs; changing crew removes access immediately',async()=>{
  const f=fixture();try{
    await f.server.saveWorkTimeSessions(worker,[session()],f.db,at(12));
    await f.server.saveWorkTimeSessions({...worker,actorUid:'other-user',memberId:'other'},[session({formId:'form-other',workOrderId:'job-b'})],f.db,at(12));
    let report=await f.server.loadWorkTimeReport(lead,new URLSearchParams(),f.db,now);
    assert.equal(report.scope,'crew');assert.deepEqual(report.members.map(row=>row.memberId).sort(),['lead','worker']);assert.ok(report.forms.every(form=>form.workOrderId==='job-a'));
    await assert.rejects(f.server.loadWorkTimeReport(lead,new URLSearchParams({memberId:'other'}),f.db,now),f.server.WorkTimeAccessError);
    await assert.rejects(f.server.loadWorkTimeReport(lead,new URLSearchParams({workOrderId:'job-b'}),f.db,now),f.server.WorkTimeAccessError);
    f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='other' WHERE id='job-a'");
    report=await f.server.loadWorkTimeReport(lead,new URLSearchParams(),f.db,now);assert.equal(report.forms.length,0);assert.equal(report.jobs.length,0);
    f.sqlite.exec("DELETE FROM trade_crew_members WHERE member_id='worker'");
    report=await f.server.loadWorkTimeReport(lead,new URLSearchParams(),f.db,now);assert.deepEqual(report.members.map(row=>row.memberId),['lead']);
  }finally{f.close();}
});

test('all form families and optional SWMS resolve only within the business and job',async()=>{
  const f=fixture();try{
    f.sqlite.exec(`INSERT INTO trade_activity_field_records VALUES('activity','business-a','job-a','{"form":{"title":"Activity"}}',''); INSERT INTO trade_rental_inspections VALUES('rental','business-a','job-a','RI-1','','');
      INSERT INTO compliance_cases VALUES('case','org','job-a','business-a'); INSERT INTO compliance_activity_work_pack_instances VALUES('pack','logical-pack','org','case','job-a');`);
    for(const [formKind,formId]of [['job_form','form-a'],['activity_record','activity'],['rental_inspection','rental'],['work_pack','pack'],['swms','swms-a']]){
      assert.ok(await f.server.workTimeFormMeta(f.db,'business-a',{formKind,formId,workOrderId:'job-a'}));
      assert.equal(await f.server.workTimeFormMeta(f.db,'business-b',{formKind,formId,workOrderId:'job-a'}),null);
      assert.equal(await f.server.workTimeFormMeta(f.db,'business-a',{formKind,formId,workOrderId:'job-b'}),null);
    }
  }finally{f.close();}
});

test('timing migration enforces kind, page and completion consistency',()=>{
  const f=fixture();try{assert.throws(()=>f.sqlite.exec("INSERT INTO trade_work_time_sessions(id,owner_uid,member_id,actor_uid,kind,source,started_at,ended_at,received_at,updated_at) VALUES('invalid','x','x','x','form','native','2026-01-01','2026-01-02','','')"),/CHECK constraint/);}finally{f.close();}
});

test('API bounds inputs, derives actor, rejects cross-origin and hides internal errors',async()=>{
  class AccessError extends Error{};class Conflict extends Error{};class Capacity extends Error{};
  const calls=[];
  const route=load('../src/app/api/trade-work-time/route.ts',{
    '@/lib/admin-server':{sameOrigin:r=>!r.headers.get('origin')||r.headers.get('origin')===new URL(r.url).origin,mfaErrorResponse:()=>null,adminJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})},
    '@/lib/trade-team-server':{requireInstallerTeamAccess:async r=>{if(!r.headers.get('authorization'))throw new Error('AUTH_REQUIRED');return worker;}},
    '@/lib/trade-access-server':{TradeAccessError:AccessError},'@/lib/bounded-request-body.mjs':bounded,'@/lib/trade-business-reports':periods,'@/lib/trade-work-time':{...timing,parseWorkTimeBatch:value=>timing.parseWorkTimeBatch(value,now.getTime())},
    '@/lib/trade-work-time-server':{WorkTimeAccessError:AccessError,WorkTimeConflictError:Conflict,WorkTimeCapacityError:Capacity,saveWorkTimeSessions:async(actor,items)=>{calls.push({actor,items});return items.map(item=>item.id);},loadWorkTimeReport:async()=>{throw new Error('private SQL');}},
  });
  const req=(body,headers={authorization:'Bearer test'})=>new Request('https://tlink.test/api/trade-work-time',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await route.POST(req({sessions:[session()]},{}))).status,401);
  assert.equal((await route.POST(req({sessions:[session()]},{authorization:'test',origin:'https://evil.test'}))).status,403);
  assert.equal((await route.POST(req({sessions:[session({memberId:'other'})]}))).status,400);
  assert.equal((await route.POST(req({sessions:['x'.repeat(49000)]}))).status,413);
  const response=await route.POST(req({sessions:[session()]}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(calls[0].actor,worker);
  const failed=await route.GET(new Request('https://tlink.test/api/trade-work-time',{headers:{authorization:'test'}}));assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(await failed.json()),/private SQL/);
});
