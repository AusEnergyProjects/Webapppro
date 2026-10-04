import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as permissions from '../src/lib/creditex-permissions.ts';
import * as contract from '../src/lib/creditex-job-audit.ts';
import * as projection from '../src/lib/creditex-job-lifecycle-projection.ts';
import * as lifecycleSql from '../src/lib/creditex-job-lifecycle-sql.ts';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import { CREDITEX_SCHEMA_GUARD_DEFINITIONS } from '../src/lib/creditex-schema-guards.ts';

const NOW='2026-10-02T02:00:00.000Z', SHA='a'.repeat(64), BYTES=new TextEncoder().encode('private evidence');
const FILE_SHA=createHash('sha256').update(BYTES).digest('hex');
const actor={kind:'compliance',uid:'reviewer',memberId:'member',name:'Reviewer',role:'reviewer',organisationId:'org'};
const platform={kind:'admin',uid:'platform',memberId:'platform-member',name:'Platform reviewer',role:'reviewer',organisationId:'org'};
const allYes=Object.fromEntries(contract.CREDITEX_JOB_AUDIT_QUESTIONS.map(({key})=>[key,'yes']));
function loadService(dependencies={}) {
  const exportedModule={exports:{}};
  const imports={'./creditex-permissions':permissions,'node:crypto':{createHash},'./creditex-job-audit':contract,'./creditex-job-lifecycle-projection':projection,'./creditex-job-lifecycle-sql':lifecycleSql,
    './trade-compliance-intent':{CREDITEX_PARTNER_ORGANISATION_CODE:'CREDITEX'},
    './creditex-custody-bucket':{getCreditexCustodyBucket(){throw new Error('Tests must inject private storage');}},...dependencies};
  new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../src/lib/creditex-job-audit-server.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{assert.ok(key in imports,key);return imports[key];},exportedModule,exportedModule.exports);
  return exportedModule.exports;
}
function database(sqlite) {
  let beforeBatch;
  class Statement {
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    async first(){return sqlite.prepare(this.sql).get(...this.values)||null;}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.values)};}
    runSync(){return {meta:{changes:Number(sqlite.prepare(this.sql).run(...this.values).changes)}};}
    async run(){return this.runSync();}
  }
  return {prepare:sql=>new Statement(sql),intercept:fn=>beforeBatch=fn,async batch(statements){if(beforeBatch){const fn=beforeBatch;beforeBatch=null;fn();}sqlite.exec('BEGIN');try{const results=statements.map(s=>s.runSync());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
function fixture(t){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec(`
    CREATE TABLE compliance_organisations(id TEXT,organisation_code TEXT,status TEXT);
    CREATE TABLE compliance_users(id TEXT,organisation_id TEXT,firebase_uid TEXT,role TEXT,status TEXT);
    CREATE TABLE admin_users(id TEXT,firebase_uid TEXT,role TEXT,status TEXT);
    CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,partner_type TEXT,source_type TEXT,record_status TEXT,stage TEXT,revision INTEGER,work_number TEXT,title TEXT,assignee_label TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_organisation_id TEXT,status TEXT,compliance_case_id TEXT,revision INTEGER,intent_snapshot_sha256 TEXT,activity_template_id TEXT,intent_snapshot TEXT,planned_start TEXT);
    CREATE TABLE compliance_cases(id TEXT,organisation_id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_intent_id TEXT,revision INTEGER,activity_date TEXT,status TEXT,evidence_status TEXT,updated_at TEXT);
    CREATE TABLE compliance_case_assignments(organisation_id TEXT,case_id TEXT,compliance_user_id TEXT,status TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT,crm_customer_id TEXT,service_site_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT,firebase_uid TEXT,first_name TEXT,last_name TEXT,business_name TEXT,phone TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT,firebase_uid TEXT,customer_id TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT,address_entry_mode TEXT,address_provider TEXT,address_provider_reference TEXT,address_formatted TEXT,address_verified_at TEXT);
    CREATE TABLE trade_activity_field_records(id TEXT,intent_id TEXT,organisation_id TEXT,owner_uid TEXT,work_order_id TEXT,activity_template_id TEXT,revision INTEGER,status TEXT,pdf_object_key TEXT,pdf_sha256 TEXT,updated_at TEXT,payload TEXT,supersedes_record_id TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT,organisation_id TEXT,work_order_id TEXT,compliance_intent_id TEXT,compliance_case_id TEXT,instance_key TEXT,work_pack_version_id TEXT,revision INTEGER,status TEXT,created_at TEXT,response_sha256 TEXT,response_snapshot TEXT);
    CREATE TABLE compliance_activity_work_pack_versions(id TEXT,organisation_id TEXT,schema_snapshot TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(id TEXT,organisation_id TEXT,case_instance_id TEXT,instance_key TEXT,work_pack_version_id TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,pdf_sha256 TEXT,object_key TEXT,finalised_at TEXT);
    CREATE TABLE compliance_activity_work_pack_artifacts(id TEXT,organisation_id TEXT,instance_key TEXT,original_file_name TEXT,content_type TEXT,size_bytes INTEGER,original_sha256 TEXT,object_key TEXT,captured_at TEXT,metadata_snapshot TEXT,metadata_sha256 TEXT,supersedes_artifact_id TEXT);
    CREATE TABLE compliance_activity_work_pack_signatures(id TEXT,organisation_id TEXT,instance_key TEXT,signer_name TEXT,signature_content_type TEXT,signature_size_bytes INTEGER,signature_sha256 TEXT,signature_object_key TEXT,signed_at TEXT,signer_role TEXT,action TEXT,attestation_snapshot TEXT,signature_payload_snapshot TEXT,supersedes_signature_id TEXT);
    CREATE TABLE trade_job_forms(id TEXT,work_order_id TEXT,firebase_uid TEXT,template_name TEXT,revision INTEGER,status TEXT,updated_at TEXT,template_snapshot TEXT,answers TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT,work_order_id TEXT,firebase_uid TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,original_sha256 TEXT,object_key TEXT,created_at TEXT);
    CREATE TABLE compliance_case_evidence(id TEXT,case_id TEXT,organisation_id TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,original_sha256 TEXT,object_key TEXT,received_at TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE compliance_case_decisions(id TEXT,organisation_id TEXT,case_id TEXT,case_revision INTEGER,decision_type TEXT,outcome TEXT,primary_reviewer_uid TEXT,secondary_reviewer_uid TEXT,decided_at TEXT);
    CREATE TABLE creditex_job_lifecycle_events(id TEXT,organisation_id TEXT,intent_id TEXT,work_order_id TEXT,owner_uid TEXT,action TEXT,created_at TEXT);
    CREATE TABLE creditex_audit_calls(id TEXT,organisation_id TEXT,job_intent_id TEXT,case_id TEXT,status TEXT);
    CREATE TABLE compliance_output_action_packets(id TEXT,organisation_id TEXT,compliance_case_id TEXT,packet_sha256 TEXT,program_code TEXT,case_revision INTEGER,work_pack_instance_key TEXT,work_pack_revision INTEGER,output_code TEXT,prepared_at TEXT,prepared_by_uid TEXT);
    CREATE TABLE compliance_output_action_events(id TEXT,organisation_id TEXT,packet_id TEXT,to_status TEXT,sequence INTEGER);
    CREATE TABLE compliance_output_action_reviews(organisation_id TEXT,packet_id TEXT,packet_sha256 TEXT,reviewed_by_uid TEXT,decision TEXT);
    CREATE TABLE compliance_output_dispatch_intents(organisation_id TEXT,packet_id TEXT,status TEXT);
    CREATE TABLE creditex_registry_batch_items(organisation_id TEXT,packet_id TEXT,batch_id TEXT,packet_sha256 TEXT);
    CREATE TABLE creditex_registry_batches(id TEXT,organisation_id TEXT);
    CREATE TABLE creditex_registry_results(id TEXT,organisation_id TEXT,packet_id TEXT,registry_status TEXT,source TEXT,occurred_at TEXT,created_at TEXT);
    CREATE TABLE creditex_registry_result_reviews(organisation_id TEXT,result_id TEXT,decision TEXT);
    INSERT INTO compliance_organisations VALUES('org','CREDITEX','active'),('other','CREDITEX','active');
    INSERT INTO compliance_users VALUES('member','org','reviewer','reviewer','active');
    INSERT INTO admin_users VALUES('platform-member','platform','reviewer','active');
    INSERT INTO trade_work_orders VALUES('job','owner','installer','internal','active','completed',1,'TLJ-1','Assessment','Technician');
    INSERT INTO trade_work_order_compliance_intents VALUES('intent','job','owner','org','case_linked','case',1,'${SHA}','activity','{"activity":{"title":"Safety assessment"}}','2026-10-02T01:00:00.000Z');
    INSERT INTO compliance_cases VALUES('case','org','job','owner','intent',1,'2026-10-02','in_review','complete','${NOW}');
    INSERT INTO compliance_case_assignments VALUES('org','case','member','assigned');
    INSERT INTO trade_crm_job_details VALUES('job','owner','trade_owned','customer','site');
    INSERT INTO trade_crm_customers VALUES('customer','owner','Laura','Customer','Business Ltd','0400000000');
    INSERT INTO trade_crm_service_sites VALUES('site','owner','customer','123 Test Street','','Melbourne','VIC','3000','manual','','','','');
    ALTER TABLE creditex_job_lifecycle_events ADD COLUMN source_snapshot TEXT DEFAULT '{}';
    ALTER TABLE trade_work_order_compliance_intents ADD COLUMN program_code TEXT DEFAULT 'VEU';
    ALTER TABLE compliance_case_assignments ADD COLUMN assignment_role TEXT DEFAULT 'primary_reviewer';
  `);
  const auditDDL=readFileSync(new URL('../drizzle/0094_creditex_operations_control.sql',import.meta.url),'utf8').match(/CREATE TABLE `compliance_audit_events`[^;]+;/)[0];
  sqlite.exec(readFileSync(new URL('../drizzle/0094_creditex_operations_control.sql',import.meta.url),'utf8').match(/CREATE TABLE `compliance_evidence_requirements`[^;]+;/)[0]);
  sqlite.exec(readFileSync(new URL('../drizzle/0095_creditex_operations_workflows.sql',import.meta.url),'utf8').match(/CREATE TABLE `compliance_case_findings`[^;]+;/)[0]);
  sqlite.exec("ALTER TABLE compliance_cases ADD COLUMN evidence_policy_version_id TEXT DEFAULT 'policy'; ALTER TABLE compliance_case_evidence ADD COLUMN requirement_id TEXT DEFAULT 'requirement';");
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(guard => guard.name.startsWith('compliance_case_findings_'))) sqlite.exec(guard.sql);
  sqlite.exec("ALTER TABLE compliance_users ADD COLUMN permissions_json TEXT DEFAULT NULL;");
  sqlite.exec(auditDDL);sqlite.exec(readFileSync(new URL('../drizzle/0237_creditex_job_audit_checklists.sql',import.meta.url),'utf8'));
  const payload={recordNumber:'FORM-1',form:{title:'Safety form',fields:[{key:'result',label:'Inspection result',section:'Inspection'}]},answers:{result:'Safe'},evidence:[{id:'photo',fileName:'Before.jpg',contentType:'image/jpeg',size:BYTES.length,sha256:FILE_SHA,objectKey:'private/photo',capturedAt:NOW}],signatures:[{id:'signature',role:'customer',signerName:'Laura Customer',signedAt:NOW,phase:'after',declarationText:'I confirm this assessment.',declarationSha256:SHA}],submittedAt:NOW};
  sqlite.prepare('INSERT INTO trade_activity_field_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('field','intent','org','owner','job','activity',1,'submitted_for_creditex_review','private/final.pdf',SHA,NOW,JSON.stringify(payload),'');
  const db=database(sqlite),corrections=[];
  const service=loadService({'./creditex-job-lifecycle-server':{
    loadJobLifecycle:async()=>({capabilities:{canRequestCorrection:true},correctionSourceSha256:SHA,notifications:[{id:'delivery',status:'failed',recipient:'technician@example.test',error:'Check email configuration and retry.'}]}),
    reviewTradeJob:async(db,actor,input,options)=>{await db.batch([...options.auditStatements,db.prepare("UPDATE trade_work_orders SET revision=revision+1,stage='in_progress' WHERE id=?").bind(input.workOrderId)]);corrections.push(input);},
  }});
  async function input(action='save',overrides={}){const w=await service.loadCreditexJobAudit(db,actor,'intent');return {intentId:'intent',expectedAuditRevision:w.checklist?.revision||0,expectedSourceSha256:w.sourceSha256,requestId:crypto.randomUUID(),action,answers:allYes,callOutcome:'completed',callReason:'',note:'Checked',...overrides};}
  function pack(){sqlite.prepare('INSERT INTO compliance_activity_work_pack_versions VALUES(?,?,?)').run('version','org',JSON.stringify({title:'Governed pack',sections:[{sectionKey:'inspection',title:'Inspection',prompts:[{promptKey:'voltage',label:'Supply voltage'}]}]}));sqlite.prepare('INSERT INTO compliance_activity_work_pack_instances VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('pack','org','job','intent','case','instance','version',1,'completed',NOW,SHA,JSON.stringify({answers:{voltage:240},repeatableSections:{}}));sqlite.prepare('INSERT INTO compliance_activity_work_pack_final_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('final','org','pack','instance','version','Final.pdf','application/pdf',BYTES.length,FILE_SHA,'private/pack.pdf',NOW);sqlite.prepare('INSERT INTO compliance_activity_work_pack_artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('artifact','org','instance','Pack.jpg','image/jpeg',BYTES.length,FILE_SHA,'private/pack.jpg',NOW,'{}',SHA,'');sqlite.prepare('INSERT INTO compliance_activity_work_pack_signatures VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('pack-signature','org','instance','Technician','image/png',BYTES.length,FILE_SHA,'private/signature',NOW,'technician','captured','{"text":"Confirmed"}','{}','');}
  return {db,sqlite,service,input,payload,pack,corrections};
}

test('real migrated schema accepts source SQL for compliance and platform-admin audit access',async t=>{
  const {sqlite}=migratedDataforceSqlite();t.after(()=>sqlite.close());
  const service=loadService({'./creditex-job-lifecycle-server':{}}),db=database(sqlite);
  for(const who of [actor,platform]){
    await assert.rejects(service.loadCreditexJobAudit(db,who,'missing'),error=>error.code==='AUDIT_NOT_FOUND');
    assert.equal((await service.loadCreditexAuditDashboard(db,who)).total,0);
    assert.deepEqual(await service.loadCreditexAuditSummaries(db,who,['missing']),[]);
  }
});
test('audit returns every current record, authentic private files and signature facts without storage keys',async t=>{
  const f=fixture(t);f.pack();
  for(let i=0;i<65;i++)f.sqlite.prepare('INSERT INTO trade_crm_job_media VALUES(?,?,?,?,?,?,?,?,?)').run(`media-${i}`,'job','owner',`Photo ${i}.jpg`,'image/jpeg',BYTES.length,FILE_SHA,`private/${i}`,NOW);
  const w=await f.service.loadCreditexJobAudit(f.db,actor,'intent');assert.equal(w.records.length,2);assert.equal(w.files.length,70);assert.equal(w.target.customerName,'Laura Customer');assert.equal(w.target.addressReviewRequired,true);assert.equal(w.records[1].answers[0].label,'Supply voltage');assert.equal(w.records[0].answers[1].value.signerName,'Laura Customer');assert.doesNotMatch(JSON.stringify(w),/private\//);assert.equal(w.submissionReady,false);
  const receipt=f.sqlite.prepare("SELECT metadata FROM compliance_audit_events WHERE event_type='job.audit_opened'").get();assert.deepEqual(Object.keys(JSON.parse(receipt.metadata)),['intentId','sourceSha256']);
});
test('business-only customers retain their name and provider address provenance',async t=>{const f=fixture(t);f.sqlite.exec("UPDATE trade_crm_customers SET first_name='',last_name='';UPDATE trade_crm_service_sites SET address_entry_mode='provider_selected',address_provider='Google',address_provider_reference='place',address_formatted='123 Test Street',address_verified_at='2026-10-02T01:00:00Z'");const w=await f.service.loadCreditexJobAudit(f.db,actor,'intent');assert.equal(w.target.customerName,'Business Ltd');assert.equal(w.target.addressReviewRequired,false);});
test('current organisation, member role, assignment and exact customer graph are enforced',async t=>{const f=fixture(t);for(const sql of ["UPDATE compliance_users SET status='suspended'","UPDATE compliance_users SET role='installer'","UPDATE compliance_case_assignments SET status='removed'","UPDATE trade_crm_customers SET firebase_uid='other'"]){f.sqlite.exec('SAVEPOINT isolation');f.sqlite.exec(sql);await assert.rejects(f.service.loadCreditexJobAudit(f.db,{...actor,role:'admin'},'intent'),e=>e.status===404);f.sqlite.exec('ROLLBACK TO isolation;RELEASE isolation');}await assert.rejects(f.service.loadCreditexJobAudit(f.db,{...actor,organisationId:'other'},'intent'),e=>e.status===404);f.sqlite.exec("DELETE FROM compliance_case_assignments");assert.equal((await f.service.loadCreditexJobAudit(f.db,platform,'intent')).target.intentId,'intent');f.sqlite.exec("UPDATE admin_users SET role='support'");await assert.rejects(f.service.loadCreditexJobAudit(f.db,platform,'intent'),e=>e.status===404);});
test('completed operational checklist retains immutable actor/source versions and never grants formal approval',async t=>{const f=fixture(t),input=await f.input('audited');let w=await f.service.saveCreditexJobAudit(f.db,actor,input);assert.equal(w.auditCompleted,true);assert.equal(w.submissionReady,false);assert.equal(w.checklist.actorUid,'reviewer');assert.equal(w.checklist.sourceSha256,input.expectedSourceSha256);w=await f.service.saveCreditexJobAudit(f.db,actor,input);assert.equal(w.history.length,1);await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,{...input,note:'Changed'}),e=>e.code==='AUDIT_REQUEST_CHANGED');assert.throws(()=>f.sqlite.exec("UPDATE creditex_job_audit_versions SET note='Changed'"),/immutable/);assert.throws(()=>f.sqlite.exec('DELETE FROM creditex_job_audit_versions'),/retained/);f.sqlite.prepare('UPDATE trade_activity_field_records SET payload=?').run(JSON.stringify({...f.payload,answers:{result:'Changed'}}));w=await f.service.loadCreditexJobAudit(f.db,actor,'intent');assert.equal(w.auditCompleted,false);assert.equal(w.checklist.outcome,'audited');});
test('completion requires every yes and completed call or explained exemption; unavailable remains draft',async t=>{const f=fixture(t);for(const override of [{answers:{...allYes,workConfirmed:'no'}},{callOutcome:'unavailable'},{callOutcome:'not_required',callReason:''}])await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited',override)),e=>e.code==='AUDIT_INCOMPLETE');const w=await f.service.saveCreditexJobAudit(f.db,actor,await f.input('save',{callOutcome:'unavailable'}));assert.equal(w.checklist.outcome,'draft');assert.equal(w.auditCompleted,false);await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited',{answers:{...allYes,workConfirmed:'invalid'}})),e=>e.status===400);assert.equal((await f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited',{callOutcome:'not_required',callReason:'Customer confirmation already recorded'}))).auditCompleted,true);});
test('source changes and access revocation during save roll back the entire audit',async t=>{const f=fixture(t);for(const sql of ["UPDATE trade_crm_service_sites SET address_line_1='Changed'","UPDATE compliance_case_assignments SET status='removed'"]){const input=await f.input();f.db.intercept(()=>f.sqlite.exec(sql));await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,input),e=>e.code==='AUDIT_SOURCE_CHANGED');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creditex_job_audit_versions').get().n,0);f.sqlite.exec("UPDATE compliance_case_assignments SET status='assigned'");}});
test('custom audit permission is rechecked for read capabilities and inside the save transaction', async t => {
  const f = fixture(t), input = await f.input();
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs"]');
  const view = await f.service.loadCreditexJobAudit(f.db, actor, 'intent');
  assert.equal(view.capabilities.canSave, false); assert.equal(view.capabilities.canComplete, false); assert.equal(view.capabilities.canRequestCorrection, false);
  assert.equal(view.capabilities.canCall, false);
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs","customers"]');
  assert.equal((await f.service.loadCreditexJobAudit(f.db, actor, 'intent')).capabilities.canCall, false);
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs","customers","customer_calls"]');
  assert.equal((await f.service.loadCreditexJobAudit(f.db, actor, 'intent')).capabilities.canCall, true);
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs"]');
  await assert.rejects(f.service.saveCreditexJobAudit(f.db, actor, input), e => e.code === 'AUDIT_PERMISSION_REQUIRED');
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs","audit"]');
  f.db.intercept(() => f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('["jobs"]'));
  await assert.rejects(f.service.saveCreditexJobAudit(f.db, actor, input), e => e.code === 'AUDIT_SOURCE_CHANGED');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creditex_job_audit_versions').get().n, 0);
  f.sqlite.prepare('UPDATE compliance_users SET permissions_json=?').run('[]');
  await assert.rejects(f.service.loadCreditexJobAudit(f.db, actor, 'intent'), e => e.status === 404);
});
test('correction calls the existing engine once and its scope covers every affected assigned case',async t=>{const f=fixture(t);f.sqlite.exec(`INSERT INTO trade_work_order_compliance_intents SELECT 'other-intent',work_order_id,installer_uid,compliance_organisation_id,status,'other-case',revision,intent_snapshot_sha256,activity_template_id,intent_snapshot,planned_start,program_code FROM trade_work_order_compliance_intents;INSERT INTO compliance_cases SELECT 'other-case',organisation_id,work_order_id,installer_uid,'other-intent',revision,activity_date,status,evidence_status,updated_at,evidence_policy_version_id FROM compliance_cases`);assert.equal((await f.service.loadCreditexJobAudit(f.db,actor,'intent')).capabilities.canRequestCorrection,false);await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('correction_required')),e=>e.code==='AUDIT_CORRECTION_UNAVAILABLE');f.sqlite.exec("INSERT INTO compliance_case_assignments VALUES('org','other-case','member','assigned','primary_reviewer')");const input=await f.input('correction_required');await f.service.saveCreditexJobAudit(f.db,actor,input);await f.service.saveCreditexJobAudit(f.db,actor,input);assert.equal(f.corrections.length,1);assert.equal(f.sqlite.prepare('SELECT revision FROM trade_work_orders').get().revision,2);});
test('private previews verify scoped identity, content type, stored hash and access after storage read',async t=>{const f=fixture(t),input={intentId:'intent',kind:'field_evidence',id:'photo',parentId:'field'};const storage={get:async key=>{assert.equal(key,'private/photo');return {arrayBuffer:async()=>BYTES.buffer};}};const file=await f.service.readCreditexJobAuditFile(f.db,actor,input,storage);assert.deepEqual(file.bytes,BYTES);await assert.rejects(f.service.readCreditexJobAuditFile(f.db,actor,{...input,parentId:'other'},storage),e=>e.status===404);await assert.rejects(f.service.readCreditexJobAuditFile(f.db,actor,input,{get:async()=>({arrayBuffer:async()=>new TextEncoder().encode('tampered').buffer})}),e=>e.code==='AUDIT_FILE_INTEGRITY');await assert.rejects(f.service.readCreditexJobAuditFile(f.db,actor,input,{get:async()=>{f.sqlite.exec("UPDATE compliance_users SET status='suspended'");return {arrayBuffer:async()=>BYTES.buffer};}}),e=>e.status===404);f.sqlite.exec("UPDATE compliance_users SET status='active'");f.payload.evidence[0].contentType='text/html';f.sqlite.prepare('UPDATE trade_activity_field_records SET payload=?').run(JSON.stringify(f.payload));await assert.rejects(f.service.readCreditexJobAuditFile(f.db,actor,input,storage),e=>e.status===415);});
test('compliance case-evidence uses existing access-receipt viewer and cannot bypass it',async t=>{const f=fixture(t);f.sqlite.prepare('INSERT INTO compliance_case_evidence(id,case_id,organisation_id,file_name,content_type,size_bytes,original_sha256,object_key,received_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('evidence','case','org','Evidence.jpg','image/jpeg',BYTES.length,FILE_SHA,'private/evidence',NOW,'received',NOW);const w=await f.service.loadCreditexJobAudit(f.db,actor,'intent');assert.equal(w.files.find(file=>file.kind==='case_evidence').previewPath,'/api/creditex/evidence/evidence');await assert.rejects(f.service.readCreditexJobAuditFile(f.db,actor,{intentId:'intent',kind:'case_evidence',id:'evidence',parentId:'case'},{get:async()=>null}),e=>e.status===404);});

test('dashboard counts the whole assigned workload and source edits invalidate audit summaries',async t=>{
  const f=fixture(t);
  f.sqlite.exec(`INSERT INTO trade_work_orders SELECT 'job-two',firebase_uid,partner_type,source_type,record_status,stage,revision,'TLJ-2',title,assignee_label FROM trade_work_orders;
    INSERT INTO trade_work_order_compliance_intents SELECT 'intent-two','job-two',installer_uid,compliance_organisation_id,status,'case-two',revision,intent_snapshot_sha256,activity_template_id,intent_snapshot,planned_start,program_code FROM trade_work_order_compliance_intents;
    INSERT INTO compliance_cases SELECT 'case-two',organisation_id,'job-two',installer_uid,'intent-two',revision,activity_date,status,evidence_status,updated_at,evidence_policy_version_id FROM compliance_cases;
    INSERT INTO trade_crm_job_details SELECT 'job-two',firebase_uid,customer_source,crm_customer_id,service_site_id FROM trade_crm_job_details;
    INSERT INTO trade_activity_field_records SELECT 'field-two','intent-two',organisation_id,owner_uid,'job-two',activity_template_id,revision,status,pdf_object_key,pdf_sha256,updated_at,payload,supersedes_record_id FROM trade_activity_field_records;`);
  assert.deepEqual(await f.service.loadCreditexAuditDashboard(f.db,actor),{total:1,awaitingAudit:1,correctionsRequired:0,auditCompleted:0,readyForSubmission:0,inProgress:0,countsUnit:'activities'});
  f.sqlite.exec("INSERT INTO compliance_case_assignments VALUES('org','case-two','member','assigned','primary_reviewer')");
  assert.equal((await f.service.loadCreditexAuditDashboard(f.db,actor)).total,2);
  await f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited'));
  let counts=await f.service.loadCreditexAuditDashboard(f.db,actor);assert.equal(counts.auditCompleted,1);assert.equal(counts.awaitingAudit,1);
  assert.deepEqual(await f.service.loadCreditexAuditSummaries(f.db,actor,['intent']),[{intentId:'intent',auditCompleted:true,correctionRequired:false}]);
  f.sqlite.prepare("UPDATE trade_activity_field_records SET payload=? WHERE id='field'").run(JSON.stringify({...f.payload,answers:{result:'New answer'}}));
  counts=await f.service.loadCreditexAuditDashboard(f.db,actor);assert.equal(counts.auditCompleted,0);assert.equal(counts.awaitingAudit,2);
  f.sqlite.exec("UPDATE compliance_cases SET status='changes_requested' WHERE id='case-two'");
  counts=await f.service.loadCreditexAuditDashboard(f.db,actor);assert.equal(counts.correctionsRequired,1);assert.equal(counts.awaitingAudit,1);
  f.sqlite.exec("UPDATE trade_work_orders SET record_status='archived' WHERE id='job-two'");assert.equal((await f.service.loadCreditexAuditDashboard(f.db,actor)).total,1);
});
test('case-manager case evidence preview restrictions are explicit without changing the existing viewer',async t=>{
  const f=fixture(t);f.sqlite.exec("UPDATE compliance_users SET role='case_manager'");
  f.sqlite.prepare('INSERT INTO compliance_case_evidence(id,case_id,organisation_id,file_name,content_type,size_bytes,original_sha256,object_key,received_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('evidence','case','org','Evidence.jpg','image/jpeg',BYTES.length,FILE_SHA,'private/evidence',NOW,'received',NOW);
  const file=(await f.service.loadCreditexJobAudit(f.db,actor,'intent')).files.find(file=>file.kind==='case_evidence');
  assert.equal(file.previewPath,'');assert.match(file.unavailableReason,/assigned reviewer or auditor/);
});

function requirement(f, id='requirement', policy='policy') {
  f.sqlite.prepare(`INSERT INTO compliance_evidence_requirements(id,organisation_id,policy_version_id,requirement_code,title,evidence_type,capture_timing,source_citation,created_by_uid,created_at,updated_at)
    VALUES(?,'org',?,?,?,'photo','post_install','Fixture requirement','reviewer',?,?)`).run(id, policy, id, `${id} title`, NOW, NOW);
}
function evidence(f, id='evidence', requirementId='requirement', caseId='case', status='received') {
  f.sqlite.prepare(`INSERT INTO compliance_case_evidence(id,case_id,organisation_id,file_name,content_type,size_bytes,original_sha256,object_key,received_at,status,updated_at,requirement_id)
    VALUES(?,?,'org',?,'image/jpeg',?,?,?, ?,?,?,?)`).run(id, caseId, `${id}.jpg`, BYTES.length, FILE_SHA, `private/${id}`, NOW, status, NOW, requirementId);
}
async function linkedCorrection(f) {
  requirement(f); evidence(f);
  const input = await f.input('correction_required', { note: 'Replace the blurred equipment label.', correction: { file: { kind:'case_evidence', id:'evidence', parentId:'case' } } });
  const workspace = await f.service.saveCreditexJobAudit(f.db, actor, input);
  return { input, workspace, findingId: workspace.findings[0].id };
}
async function resolution(f, findingId, overrides={}) {
  const workspace = await f.service.loadCreditexJobAudit(f.db, actor, 'intent');
  return { action:'resolve_finding', intentId:'intent', findingId, requestId:crypto.randomUUID(), expectedSourceSha256:workspace.sourceSha256,
    resolutionNote:'Read the replacement label and matched it to the equipment record.', reviewedEvidenceId:'replacement', ...overrides };
}

test('a precise case correction creates one immutable finding and forwards its context through the existing technician notification', async t => {
  const f=fixture(t), {input,workspace}=await linkedCorrection(f);
  assert.equal(workspace.findings.length,1); assert.equal(workspace.findings[0].evidenceId,'evidence'); assert.equal(workspace.findings[0].requirementId,'requirement');
  assert.match(f.corrections[0].note,/Requirement: requirement title\nFile: evidence.jpg\nReplace the blurred/);
  assert.equal(workspace.notifications[0].status,'failed'); assert.equal(workspace.notifications[0].error,'Check email configuration and retry.');
  await f.service.saveCreditexJobAudit(f.db,actor,input);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM compliance_case_findings').get().n,1); assert.equal(f.corrections.length,1);
  assert.throws(()=>f.sqlite.exec("UPDATE compliance_case_findings SET description='changed'"),/COMPLIANCE_FINDING_ORIGINAL_IMMUTABLE/);
  assert.throws(()=>f.sqlite.exec('DELETE FROM compliance_case_findings'),/COMPLIANCE_FINDING_NO_DELETE/);
  assert.equal(workspace.capabilities.canComplete,false);
  await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited')),e=>e.code==='AUDIT_INCOMPLETE');
  assert.equal((await f.service.loadCreditexAuditDashboard(f.db,actor)).correctionsRequired,1);
});

test('requirement-only corrections cover missing evidence while other file families retain precise named-file notes',async t=>{
  const f=fixture(t); requirement(f);
  let w=await f.service.saveCreditexJobAudit(f.db,actor,await f.input('correction_required',{note:'Capture the required label.',correction:{requirementId:'requirement'}}));
  assert.equal(w.findings[0].evidenceId,''); assert.equal(w.findings[0].requirementTitle,'requirement title');
  w=await f.service.saveCreditexJobAudit(f.db,actor,await f.input('correction_required',{note:'Retake the photo in focus.',correction:{file:{kind:'field_evidence',id:'photo',parentId:'field'}}}));
  assert.equal(w.findings.length,1); assert.match(f.corrections[1].note,/File: Before.jpg\nRetake the photo in focus/);
});

test('foreign activity, file, policy and mismatched requirement targets are rejected without partial corrections',async t=>{
  const f=fixture(t); requirement(f); requirement(f,'other-requirement'); requirement(f,'foreign-policy','other-policy'); evidence(f);
  for (const correction of [{file:{kind:'case_evidence',id:'evidence',parentId:'foreign-case'}}, {file:{kind:'field_evidence',id:'foreign-file',parentId:'field'}},
    {requirementId:'foreign-policy'}, {requirementId:'missing'}, {file:{kind:'case_evidence',id:'evidence',parentId:'case'},requirementId:'other-requirement'}]) {
    await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('correction_required',{correction})),e=>e.code==='AUDIT_CORRECTION_TARGET');
  }
  assert.equal(f.corrections.length,0); assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM compliance_case_findings').get().n,0);
  f.sqlite.exec("UPDATE trade_work_order_compliance_intents SET compliance_case_id='',status='planned'; UPDATE compliance_users SET role='admin'");
  await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,await f.input('correction_required',{correction:{requirementId:'requirement'}})),e=>e.code==='AUDIT_CORRECTION_TARGET');
});

test('closing a finding records replacement integrity and actor, preserves the original and requires a new current audit',async t=>{
  const f=fixture(t), {findingId}=await linkedCorrection(f); evidence(f,'replacement'); f.sqlite.exec("UPDATE compliance_case_evidence SET status='superseded' WHERE id='evidence'");
  const input=await resolution(f,findingId), before=f.sqlite.prepare('SELECT revision FROM compliance_cases').get().revision;
  let w=await f.service.resolveCreditexJobAuditFinding(f.db,actor,input);
  assert.equal(w.findings[0].status,'resolved'); assert.equal(w.findings[0].evidenceId,'evidence'); assert.equal(w.findings[0].reviewedEvidenceId,'replacement'); assert.equal(w.findings[0].reviewedEvidenceLabel,'replacement.jpg');
  assert.equal(w.capabilities.canComplete,true); assert.equal(w.auditCompleted,false); assert.equal(w.submissionReady,false);
  const closed=f.sqlite.prepare('SELECT resolved_by_uid,resolution_note FROM compliance_case_findings').get(); assert.equal(closed.resolved_by_uid,'reviewer'); assert.equal(closed.resolution_note,input.resolutionNote);
  const event=f.sqlite.prepare("SELECT metadata FROM compliance_audit_events WHERE event_type='case.finding_resolved'").get(); assert.equal(JSON.parse(event.metadata).reviewedEvidenceSha256,FILE_SHA);
  await f.service.resolveCreditexJobAuditFinding(f.db,actor,input); assert.equal(f.sqlite.prepare('SELECT revision FROM compliance_cases').get().revision,before+1);
  await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,{...input,resolutionNote:'Changed'}),e=>e.code==='AUDIT_REQUEST_CHANGED');
  w=await f.service.saveCreditexJobAudit(f.db,actor,await f.input('audited')); assert.equal(w.auditCompleted,true); assert.equal(w.submissionReady,false);
});

test('closeout rejects foreign, rejected, superseded or wrong-requirement evidence and requires a review explanation',async t=>{
  const f=fixture(t), {findingId}=await linkedCorrection(f); requirement(f,'other'); evidence(f,'wrong','other'); evidence(f,'foreign','requirement','foreign-case'); evidence(f,'rejected','requirement','case','rejected'); evidence(f,'superseded','requirement','case','superseded');
  for (const reviewedEvidenceId of ['wrong','foreign','rejected','superseded']) await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,await resolution(f,findingId,{reviewedEvidenceId})),e=>e.code==='AUDIT_CORRECTION_TARGET');
  await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,await resolution(f,findingId,{resolutionNote:'',reviewedEvidenceId:''})),e=>e.code==='AUDIT_INPUT');
  await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,await resolution(f,'foreign-finding',{reviewedEvidenceId:''})),e=>e.code==='AUDIT_FINDING_NOT_FOUND');
  assert.equal(f.sqlite.prepare('SELECT status FROM compliance_case_findings').get().status,'open');
  assert.equal((await f.service.resolveCreditexJobAuditFinding(f.db,actor,await resolution(f,findingId,{reviewedEvidenceId:'',resolutionNote:'The dated declaration resolves this discrepancy; no replacement image was required.'}))).findings[0].status,'resolved');
});

test('closeout enforces current reviewer assignment and explicit audit/correction permissions',async t=>{
  const f=fixture(t),{findingId}=await linkedCorrection(f),input=await resolution(f,findingId,{reviewedEvidenceId:''});
  for(const sql of ["UPDATE compliance_users SET permissions_json='[\"jobs\",\"audit\"]'", "UPDATE compliance_users SET permissions_json='[\"jobs\",\"corrections\"]'", "UPDATE compliance_users SET role='case_manager'", "UPDATE compliance_case_assignments SET assignment_role='observer'", "UPDATE compliance_cases SET status='closed'"]) {
    f.sqlite.exec('SAVEPOINT authority'); f.sqlite.exec(sql);
    assert.equal((await f.service.loadCreditexJobAudit(f.db,actor,'intent')).capabilities.canResolveFindings,false);
    await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,input),e=>e.code==='AUDIT_FINDING_PERMISSION');
    f.sqlite.exec('ROLLBACK TO authority; RELEASE authority');
  }
});

test('source and permission changes inside closeout roll back finding resolution, audit event and case revision',async t=>{
  for(const sql of ["UPDATE compliance_case_evidence SET original_sha256='"+'b'.repeat(64)+"' WHERE id='replacement'", "UPDATE compliance_users SET permissions_json='[\"jobs\",\"audit\"]'", "UPDATE compliance_case_assignments SET assignment_role='observer'"]) {
    const f=fixture(t),{findingId}=await linkedCorrection(f); evidence(f,'replacement');
    const input=await resolution(f,findingId), revision=f.sqlite.prepare('SELECT revision FROM compliance_cases').get().revision;
    f.db.intercept(()=>f.sqlite.exec(sql)); await assert.rejects(f.service.resolveCreditexJobAuditFinding(f.db,actor,input),e=>e.code==='AUDIT_SOURCE_CHANGED');
    assert.equal(f.sqlite.prepare('SELECT status FROM compliance_case_findings').get().status,'open'); assert.equal(f.sqlite.prepare('SELECT revision FROM compliance_cases').get().revision,revision);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='case.finding_resolved'").get().n,0);
  }
});

test('a finding raised at the completion boundary prevents an audit even without a stale client hash',async t=>{
  const f=fixture(t); requirement(f); const input=await f.input('audited');
  f.db.intercept(()=>f.sqlite.prepare(`INSERT INTO compliance_case_findings(id,organisation_id,case_id,requirement_id,finding_code,severity,description,raised_by_uid,raised_at,created_at,updated_at)
    VALUES('concurrent','org','case','requirement','check','minor','Review new evidence','reviewer',?,?,?)`).run(NOW,NOW,NOW));
  await assert.rejects(f.service.saveCreditexJobAudit(f.db,actor,input),e=>e.code==='AUDIT_SOURCE_CHANGED'); assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM creditex_job_audit_versions').get().n,0);
});

test('actual D1 runs composed audit reads, linked correction and guarded reviewer closeout without depth errors',async t=>{
  const f=fixture(t);requirement(f);evidence(f);evidence(f,'replacement');
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-01',d1Databases:['DB']});t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  const schema=f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all();
  for(const item of schema.filter(item=>item.type==='table')) {
    await db.prepare(item.sql).run();
    const rows=f.sqlite.prepare(`SELECT * FROM "${item.name}"`).all();
    for(const row of rows)await db.prepare(`INSERT INTO "${item.name}"(${Object.keys(row).map(key=>`"${key}"`).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
  }
  for(const item of schema.filter(item=>item.type!=='table'))await db.prepare(item.sql).run();
  let w=await f.service.loadCreditexJobAudit(db,actor,'intent');assert.equal(w.requirements[0].id,'requirement');
  w=await f.service.saveCreditexJobAudit(db,actor,{intentId:'intent',expectedAuditRevision:0,expectedSourceSha256:w.sourceSha256,requestId:crypto.randomUUID(),action:'correction_required',answers:allYes,callOutcome:'completed',callReason:'',note:'Read a clear label.',correction:{file:{kind:'case_evidence',id:'evidence',parentId:'case'}}});
  assert.equal((await f.service.loadCreditexAuditDashboard(db,actor)).correctionsRequired,1);
  w=await f.service.resolveCreditexJobAuditFinding(db,actor,{action:'resolve_finding',intentId:'intent',findingId:w.findings[0].id,requestId:crypto.randomUUID(),expectedSourceSha256:w.sourceSha256,resolutionNote:'Verified the replacement label.',reviewedEvidenceId:'replacement'});
  assert.equal(w.findings[0].status,'resolved');assert.equal(w.findings[0].reviewedEvidenceId,'replacement');assert.equal(w.submissionReady,false);
});
