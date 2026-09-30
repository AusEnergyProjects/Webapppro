import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {migratedDataforceD1} from './helpers/trade-dataforce-database.mjs';
const migration=fs.readFileSync(new URL('../drizzle/0225_imported_job_lifecycle.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean);

test('Imported lifecycle migration preserves source and audit history, separates original visits, and is idempotent',async()=>{
 const f=await migratedDataforceD1();const {db}=f;
 try{
  const insert=(table,value)=>db.prepare(`INSERT INTO ${table} (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(()=>'?').join(',')})`).bind(...Object.values(value));
  const now='2026-09-30T00:00:00.000Z',hash='a'.repeat(64),seed=[];
  const specs=[['complete','import','active','completed','complete'],['partial','import','active','in_progress','in_progress'],['ready','import','active','ready','approved'],['archived','import','archived','completed','complete'],['native','internal','active','completed','complete'],['already','import','active','imported','imported']];
  for(const [id,source,recordStatus,stage,pipeline] of specs){
   seed.push(insert('trade_work_orders',{id,firebase_uid:'owner',partner_type:'installer',source_type:source,work_number:id,title:id,stage,record_status:recordStatus,revision:5,scheduled_start:'2020-01-01T09:00',scheduled_end:'2020-01-01T10:00',assignee_member_id:id==='complete'?'lead':'',created_at:now,updated_at:now}));
   seed.push(insert('trade_crm_job_details',{id:id+':detail',work_order_id:id,firebase_uid:'owner',pipeline_stage:pipeline,description:'Original notes',created_at:now,updated_at:now}));
   seed.push(insert('trade_crm_appointments',{id:id+':visit',work_order_id:id,firebase_uid:'owner',title:'Original visit',starts_at:'2020-01-01T09:00',status:stage==='imported'?'imported':'completed',assignee_member_id:id==='complete'?'visitor':'',revision:2,notes:'Original time',created_at:now,updated_at:now}));
   seed.push(insert('trade_work_order_events',{id:id+':import',work_order_id:id,firebase_uid:'owner',event_type:'data_imported',summary:'Immutable original status completed',created_at:now}));
   seed.push(insert('trade_dataforce_sources',{id:'source-'+id,firebase_uid:'owner',source_job_id:'source-'+id,row_sha256:hash,raw_json:JSON.stringify({Status:'completed',SubStatus:'audited','Scheduled Datetime':'01/01/2020 9:00 AM'}),import_batch_id:'batch',import_row_id:id,work_order_id:id,customer_id:'customer',service_site_id:'site',customer_key:'customer',site_key:'site',created_at:now}));
  }
  seed.push(insert('trade_crm_appointments',{id:'new-visit',work_order_id:'complete',firebase_uid:'owner',title:'New TLink visit',starts_at:'2027-01-01T09:00',status:'scheduled',assignee_member_id:'current-worker',revision:2,created_at:now,updated_at:now}));

  for(let i=0;i<seed.length;i+=20)await db.batch(seed.slice(i,i+20));
  await db.prepare("UPDATE trade_crm_job_details SET firebase_uid='other-owner' WHERE work_order_id='partial'").run();
  const all=async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY ${table==='trade_team_sync_changes'?'sequence':'id'}`).all()).results;
  const sourceBefore=await all('trade_dataforce_sources'),eventsBefore=await all('trade_work_order_events');
  await db.batch(migration.map(sql=>db.prepare(sql)));
  const jobs=await all('trade_work_orders'),details=await all('trade_crm_job_details'),visits=await all('trade_crm_appointments'),sync=await all('trade_team_sync_changes');
  for(const [id,source,status,stage,pipeline] of specs){
   const changed=source==='import'&&status==='active'&&stage!=='imported';
   const job=jobs.find(row=>row.id===id),detail=details.find(row=>row.id===id+':detail'),visit=visits.find(row=>row.id===id+':visit');
   assert.equal(job.stage,changed?'imported':stage,id);assert.equal(job.revision,changed?6:5,id);
   assert.equal(job.scheduled_start,'2020-01-01T09:00');assert.equal(job.scheduled_end,'2020-01-01T10:00');
   assert.equal(detail.pipeline_stage,changed&&id!=='partial'?'imported':pipeline,id);assert.equal(detail.description,'Original notes');
   assert.equal(visit.status,changed||stage==='imported'?'imported':'completed',id);assert.equal(visit.revision,changed?3:2,id);assert.equal(visit.starts_at,'2020-01-01T09:00');
  }
  assert.equal(details.find(row=>row.id==='partial:detail').pipeline_stage,'in_progress');
  assert.equal(visits.find(row=>row.id==='new-visit').status,'scheduled');
  assert.deepEqual(sync.filter(row=>row.entity_id==='complete').map(row=>row.audience_member_id).sort(),['','current-worker','lead','visitor']);
  assert.equal(sync.length,6);assert.ok(sync.every(row=>row.operation==='upsert'&&row.revision===6));
  assert.deepEqual(await all('trade_dataforce_sources'),sourceBefore);assert.deepEqual(await all('trade_work_order_events'),eventsBefore);
  for(const table of ['trade_mobile_push_outbox','trade_crm_accepted_invoices','trade_crm_quick_invoices','creditex_job_lifecycle_events'])assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
  await db.batch(migration.map(sql=>db.prepare(sql)));
  assert.deepEqual(await all('trade_work_orders'),jobs);assert.deepEqual(await all('trade_crm_job_details'),details);assert.deepEqual(await all('trade_crm_appointments'),visits);assert.deepEqual(await all('trade_team_sync_changes'),sync);
 }finally{await f.close();}
});
