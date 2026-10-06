import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedDataforceD1, migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import { listSales, loadSalesConfig, saveSalesStages, updateSales } from '../src/lib/trade-sales-server.ts';
import { salesDay, salesStages } from '../src/lib/trade-sales.ts';

const now='2026-10-06T03:00:00.000Z';
const owner={ownerUid:'owner',actorUid:'owner',memberId:'owner-member',isOwner:true,jobScope:'team',canManageJobs:true,canViewCustomers:true,canViewQuotes:true,canManageQuotes:true};
function fixture(t) {
  const {sqlite}=migratedDataforceSqlite();t.after(()=>sqlite.close());
  function insert(table,values) {
    const row={...values};
    for(const column of sqlite.prepare(`PRAGMA table_info(${table})`).all()) if(column.notnull&&column.dflt_value===null&&row[column.name]===undefined) row[column.name]=/INT|REAL/.test(column.type)?0:'';
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  let race;
  const prepare=(sql,values=[])=>({bind:(...args)=>prepare(sql,args),first:async()=>sqlite.prepare(sql).get(...values)||null,
    all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}})});
  const db={prepare,batch:async statements=>{race?.();race=undefined;sqlite.exec('BEGIN');try {const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  insert('trade_team_members',{id:'owner-member',owner_uid:'owner',member_uid:'owner',email:'owner@example.test',display_name:'Owner',status:'active',job_scope:'team',can_manage_jobs:1,can_view_customers:1,can_view_quotes:1,can_manage_quotes:1});
  function job(id='job',changes={},detail={}) {
    insert('trade_work_orders',{id,firebase_uid:'owner',partner_type:'installer',work_number:`TLJ-${id}`,title:`Opportunity ${id}`,service_category:'solar',stage:'backlog',revision:1,created_at:now,updated_at:now,...changes});
    insert('trade_crm_job_details',{id:`detail-${id}`,firebase_uid:changes.firebase_uid||'owner',work_order_id:id,customer_source:'trade_owned',pipeline_stage:'quoting',quote_status:'issued',invoice_status:'not_started',estimated_value_cents:420000,next_action:'Call customer',created_at:now,updated_at:now,...detail});
  }
  job();
  const update=(changes={},access=owner)=>updateSales(db,access,{action:'update',workOrderId:'job',expectedRevision:0,expectedJobRevision:1,...changes},now);
  return {sqlite,db,insert,job,update,race:callback=>{race=callback;}};
}
test('sales pages expose every prospect above 25 with exact stage counts and stable scoped cursors',async t=>{
  const f=fixture(t);for(let n=0;n<61;n++)f.job(`job-${String(n).padStart(3,'0')}`);
  const ids=[];let cursor='';
  do {const result=await listSales(f.db,owner,new URLSearchParams({status:'open',stage:'quoting',pageSize:'25',cursor}));assert.equal(result.total,62);assert.equal(result.stages.find(stage=>stage.id==='quoting').count,62);ids.push(...result.items.map(item=>item.id));cursor=result.nextCursor;}while(cursor);
  assert.equal(ids.length,62);assert.equal(new Set(ids).size,62);
  const first=await listSales(f.db,owner,new URLSearchParams({stage:'quoting',pageSize:'25'}));
  await assert.rejects(listSales(f.db,owner,new URLSearchParams({stage:'enquiry',cursor:first.nextCursor})),error=>error.code==='REVISION_CONFLICT');
});
test('sales search, owner and missing-next-action filters use canonical values across the complete dataset',async t=>{
  const f=fixture(t);f.job('needs',{}, {next_action:'',pipeline_stage:'enquiry'});
  await f.update({ownerMemberId:'owner-member',nextActionOn:'2026-10-10'});
  const assigned=await listSales(f.db,owner,new URLSearchParams({owner:'owner-member'}));assert.deepEqual(assigned.items.map(item=>item.id),['job']);
  const needs=await listSales(f.db,owner,new URLSearchParams({needsNextAction:'1'}));assert.deepEqual(needs.items.map(item=>item.id),['needs']);
  const literal=await listSales(f.db,owner,new URLSearchParams({search:'%'}));assert.equal(literal.total,0);
});
test('metadata changes reuse canonical estimate and next action without touching lifecycle, assignment or quote outcome',async t=>{
  const f=fixture(t);const item=await f.update({stageId:'qualifying',ownerMemberId:'owner-member',estimatedValueCents:650000,nextAction:'Discuss proposal',nextActionOn:'2026-10-09',expectedCloseOn:'2026-10-20',lastContactOn:'2026-10-05'});
  assert.equal(item.revision,1);assert.equal(item.jobRevision,2);assert.equal(item.estimatedValueCents,650000);assert.equal(item.stageId,'qualifying');assert.equal(item.lastContactOn,'2026-10-05');
  const job=f.sqlite.prepare('SELECT * FROM trade_work_orders WHERE id=?').get('job'),detail=f.sqlite.prepare('SELECT * FROM trade_crm_job_details WHERE work_order_id=?').get('job');
  assert.equal(job.stage,'backlog');assert.equal(job.assignee_member_id,'');assert.equal(detail.pipeline_stage,'quoting');assert.equal(detail.quote_status,'issued');assert.equal(detail.estimated_value_cents,650000);assert.equal(detail.next_action,'Discuss proposal');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_crm_appointments').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_crm_quote_acceptances').get().n,0);
  await assert.rejects(f.update({stageId:'enquiry'}),error=>error.code==='REVISION_CONFLICT');
});
test('accepted decisions and lost records are system outcomes; imported and performed jobs stay outside active sales',async t=>{
  const f=fixture(t);f.job('lost',{stage:'cancelled'},{pipeline_stage:'lost'});f.job('imported',{stage:'imported'},{pipeline_stage:'imported'});f.job('performed',{stage:'completed'},{pipeline_stage:'complete'});f.job('won');
  f.insert('trade_crm_quote_acceptances',{id:'accepted',work_order_id:'won',firebase_uid:'owner',decision:'accepted',decided_at:now});
  const all=await listSales(f.db,owner,new URLSearchParams({status:'all'}));assert.deepEqual(new Set(all.items.map(item=>item.id)),new Set(['job','lost','won']));
  assert.equal(all.items.find(item=>item.id==='won').stageId,'won');assert.equal(all.items.find(item=>item.id==='lost').stageId,'lost');
  await assert.rejects(f.update({workOrderId:'won'}),error=>error.code==='SALES_RECORD_CLOSED');
});
test('protected prospects redact identities, searches, next-action text and financial values',async t=>{
  const f=fixture(t);f.job('private',{source_type:'opportunity',title:'Sensitive household'},{customer_source:'platform_private',next_action:'Call Sensitive person'});
  const all=await listSales(f.db,owner,new URLSearchParams({status:'all'})),item=all.items.find(item=>item.id==='private');
  assert.equal(item.title,'Protected opportunity');assert.equal(item.customerName,'');assert.equal(item.nextAction,'');assert.equal(item.estimatedValueCents,null);assert.equal(item.canEdit,false);
  assert.equal((await listSales(f.db,owner,new URLSearchParams({search:'Sensitive'}))).total,0);
});
test('own-scope readers retain job assignment boundaries and sales ownership grants no additional access',async t=>{
  const f=fixture(t);f.insert('trade_team_members',{id:'staff',owner_uid:'owner',member_uid:'staff-user',display_name:'Sales colleague',status:'active',can_view_customers:1,can_view_quotes:1,job_scope:'own'});
  const staff={...owner,isOwner:false,actorUid:'staff-user',memberId:'staff',jobScope:'own',canManageJobs:false};
  f.job('assigned',{assignee_member_id:'staff'});
  f.insert('trade_sales_job_metadata',{owner_uid:'owner',work_order_id:'job',owner_member_id:'staff',stage_id:'quoting',updated_at:now});
  assert.deepEqual((await listSales(f.db,staff,new URLSearchParams())).items.map(item=>item.id),['assigned']);
  await assert.rejects(f.update({},staff),error=>error.code==='SALES_ACCESS_REQUIRED');
  const config=await loadSalesConfig(f.db,staff);assert.equal(config.permissions.canConfigure,false);assert.equal(config.owners.some(person=>person.id==='staff'),false);
  f.sqlite.prepare("UPDATE trade_team_members SET status='suspended' WHERE id='staff'").run();await assert.rejects(listSales(f.db,staff,new URLSearchParams()),error=>error.code==='SALES_ACCESS_REQUIRED');
});
test('crew members and foreign-tenant actors cannot read or write sales',async t=>{
  const f=fixture(t);f.insert('trade_team_members',{id:'staff',owner_uid:'owner',member_uid:'staff-user',status:'active',can_view_customers:1,can_view_quotes:1,can_manage_jobs:1,job_scope:'team'});
  f.insert('trade_crews',{id:'crew',owner_uid:'owner',name:'Crew',lead_member_id:'staff'});f.insert('trade_crew_members',{owner_uid:'owner',crew_id:'crew',member_id:'staff'});
  const staff={...owner,isOwner:false,actorUid:'staff-user',memberId:'staff'};
  await assert.rejects(listSales(f.db,staff,new URLSearchParams()),error=>error.code==='SALES_ACCESS_REQUIRED');
  await assert.rejects(listSales(f.db,{...owner,ownerUid:'foreign'},new URLSearchParams()),error=>error.code==='SALES_ACCESS_REQUIRED');
});
test('current write and quote permissions are rechecked atomically before canonical records change',async t=>{
  const f=fixture(t);f.insert('trade_team_members',{id:'manager',owner_uid:'owner',member_uid:'manager-user',status:'active',can_view_customers:1,can_view_quotes:1,can_manage_jobs:1,can_manage_quotes:1,job_scope:'team'});
  const manager={...owner,isOwner:false,actorUid:'manager-user',memberId:'manager'};
  f.race(()=>f.sqlite.prepare("UPDATE trade_team_members SET can_manage_jobs=0 WHERE id='manager'").run());
  await assert.rejects(f.update({nextAction:'Changed'},manager),error=>error.code==='REVISION_CONFLICT');
  assert.equal(f.sqlite.prepare("SELECT next_action FROM trade_crm_job_details WHERE work_order_id='job'").get().next_action,'Call customer');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_sales_job_metadata').get().n,0);
  f.sqlite.prepare("UPDATE trade_team_members SET can_manage_jobs=1,can_manage_quotes=0 WHERE id='manager'").run();
  await assert.rejects(f.update({estimatedValueCents:100},manager),error=>error.code==='SALES_ACCESS_REQUIRED');
  const item=await f.update({nextAction:'Allowed note'},manager);assert.equal(item.canEditValue,false);
});
test('stage configuration supports owner add, rename and reorder with CAS and preserves existing stage identities',async t=>{
  const f=fixture(t);const config=await loadSalesConfig(f.db,owner);assert.equal(config.settings.revision,0);
  const stages=[{id:'quoting',name:'Proposal sent'},{id:'enquiry',name:'New'},{id:'qualifying',name:'Checking'},{id:'negotiation',name:'Negotiating'}];
  const saved=await saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:0,stages},now);assert.equal(saved.revision,1);
  assert.equal((await listSales(f.db,owner,new URLSearchParams())).items[0].stageName,'Proposal sent');
  await assert.rejects(saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:0,stages},now),error=>error.code==='REVISION_CONFLICT');
  await assert.rejects(saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:1,stages:stages.filter(stage=>stage.id!=='quoting')},now),error=>error.code==='SALES_STAGE_REMOVAL_UNSUPPORTED');
  const moved=await f.update({stageId:'negotiation'});
  assert.equal(moved.stageName,'Negotiating');
  await assert.rejects(saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:1,stages:stages.filter(stage=>stage.id!=='quoting')},now),error=>error.code==='SALES_STAGE_REMOVAL_UNSUPPORTED');
  const events=f.sqlite.prepare("SELECT * FROM trade_team_member_events WHERE event_type='sales_stages_updated'").all();
  assert.equal(events.length,1);assert.equal(events[0].actor_uid,'owner');assert.deepEqual(JSON.parse(events[0].metadata),{revision:1,stages});
  assert.equal((await loadSalesConfig(f.db,owner)).settings.revision,1);
});
test('stage change or quote acceptance racing an edit rolls back metadata and canonical changes',async t=>{
  const f=fixture(t);f.race(()=>f.insert('trade_crm_quote_acceptances',{id:'race-accepted',work_order_id:'job',firebase_uid:'owner',decision:'accepted',decided_at:now}));
  await assert.rejects(f.update({nextAction:'Cannot update'}),error=>error.code==='REVISION_CONFLICT');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_sales_job_metadata').get().n,0);assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders WHERE id='job'").get().revision,1);
});
test('sales dates, identifiers and unsupported outcome movement reject before writes',async t=>{
  const f=fixture(t);await assert.rejects(f.update({stageId:'won'}));await assert.rejects(f.update({ownerMemberId:'foreign'}));await assert.rejects(f.update({estimatedValueCents:-1}));await assert.rejects(f.update({lastContactOn:'2027-01-01'}));
  assert.throws(()=>salesDay('2026-02-30'));assert.throws(()=>salesDay('2026-99-99'),error=>error.status===400);assert.throws(()=>salesStages([{id:'a',name:'A'},{id:'b',name:'a'}]));
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_sales_job_metadata').get().n,0);
});
test('last recorded contact remains a date and uses the business local day around UTC midnight',async t=>{
  const f=fixture(t),earlySydney='2026-10-05T16:00:00.000Z';
  const item=await updateSales(f.db,owner,{action:'update',workOrderId:'job',expectedRevision:0,expectedJobRevision:1,lastContactOn:'2026-10-06'},earlySydney);
  assert.equal(item.lastContactOn,'2026-10-06');
  assert.equal(f.sqlite.prepare("SELECT last_contact_on FROM trade_sales_job_metadata WHERE work_order_id='job'").get().last_contact_on,'2026-10-06');
  await assert.rejects(updateSales(f.db,owner,{action:'update',workOrderId:'job',expectedRevision:1,expectedJobRevision:2,lastContactOn:'2026-10-07'},earlySydney),error=>error.status===400);
});
test('metadata and configuration revisions racing a save roll back canonical writes',async t=>{
  for(const race of ['metadata','settings']) await t.test(race,async sub=>{
    const f=fixture(sub);f.race(()=>race==='metadata'?f.insert('trade_sales_job_metadata',{owner_uid:'owner',work_order_id:'job',stage_id:'enquiry',revision:1,updated_at:now}):f.insert('trade_sales_settings',{owner_uid:'owner',stages_json:JSON.stringify([{id:'new',name:'New'}]),revision:1,updated_at:now}));
    await assert.rejects(f.update({nextAction:'Rejected'}),error=>error.code==='REVISION_CONFLICT');
    assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders WHERE id='job'").get().revision,1);assert.equal(f.sqlite.prepare("SELECT next_action FROM trade_crm_job_details WHERE work_order_id='job'").get().next_action,'Call customer');
  });
});
test('stage configuration rechecks owner authority and configuration revision before writes and audit',async t=>{
  for(const race of ['settings','owner']) await t.test(race,async sub=>{
    const f=fixture(sub),stages=(await loadSalesConfig(f.db,owner)).settings.stages.map(stage=>({...stage,name:`${stage.name} renamed`}));
    f.race(()=>race==='settings'?f.insert('trade_sales_settings',{owner_uid:'owner',stages_json:JSON.stringify(stages),revision:1,updated_at:now}):f.sqlite.prepare("UPDATE trade_team_members SET status='suspended' WHERE id='owner-member'").run());
    await assert.rejects(saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:0,stages},now),error=>error.code==='REVISION_CONFLICT');
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM trade_sales_settings').get().n,race==='settings'?1:0);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM trade_team_member_events WHERE event_type='sales_stages_updated'").get().n,0);
  });
});
test('the migration composite keys and complete sales queries and writes execute within D1',async t=>{
  const f=await migratedDataforceD1();t.after(()=>f.close());
  async function insert(table,values) {
    const row={...values};for(const column of (await f.db.prepare(`PRAGMA table_info(${table})`).all()).results) if(column.notnull&&column.dflt_value===null&&row[column.name]===undefined) row[column.name]=/INT|REAL/.test(column.type)?0:'';
    await f.db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
  }
  await insert('trade_team_members',{id:'owner-member',owner_uid:'owner',member_uid:'owner',status:'active',display_name:'Owner',email:'owner@example.test'});
  await insert('trade_work_orders',{id:'job',firebase_uid:'owner',partner_type:'installer',work_number:'TLJ-D1',title:'D1 opportunity',stage:'backlog',revision:1,created_at:now,updated_at:now});
  await insert('trade_crm_job_details',{id:'detail',firebase_uid:'owner',work_order_id:'job',pipeline_stage:'quoting',quote_status:'issued',invoice_status:'not_started',created_at:now,updated_at:now});
  const list=await listSales(f.db,owner,new URLSearchParams({status:'all'}));assert.equal(list.total,1);assert.equal(list.items[0].stageId,'quoting');
  const changed=await updateSales(f.db,owner,{action:'update',workOrderId:'job',expectedRevision:0,expectedJobRevision:1,nextAction:'D1 call',nextActionOn:'2026-10-09',ownerMemberId:'owner-member'},now);assert.equal(changed.revision,1);
  const stages=(await loadSalesConfig(f.db,owner)).settings.stages.map(stage=>stage.id==='quoting'?{...stage,name:'Proposal sent'}:stage);
  await saveSalesStages(f.db,owner,{action:'save_stages',expectedRevision:0,stages},now);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM trade_team_member_events WHERE event_type='sales_stages_updated'").first()).n,1);
  await assert.rejects(insert('trade_sales_job_metadata',{owner_uid:'foreign',work_order_id:'job',updated_at:now}),/FOREIGN KEY/);
});
