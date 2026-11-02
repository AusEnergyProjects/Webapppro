import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
import * as assessment from '../src/lib/trade-rental-assessment.mjs';
import * as evidence from '../src/lib/trade-rental-evidence.mjs';
import * as workflow from '../src/lib/rental-assessor-workflow.mjs';
import * as answer from '../src/lib/rental-report-answer.mjs';
import * as branding from '../src/lib/rental-report-branding.mjs';
import * as quotation from '../src/lib/rental-quotation.mjs';
import * as renderer from '../src/lib/trade-rental-report-pdf.mjs';
import * as guards from '../src/lib/trade-rental-correction-schema-guards.ts';
import { ensureTradeRentalSchemaGuards } from '../src/lib/trade-rental-schema-guards.ts';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as predicates from '../src/lib/trade-account-predicates.ts';
import * as visibility from '../src/lib/trade-rental-report-visibility.ts';
import { installVerifiedTradeLeadFixture } from './helpers/creditex-training-fixture.mjs';
import { rentalReportEmailDraft } from '../src/lib/rental-report-email-template.mjs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
function load(path,dependencies) {
  const output=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const record={exports:{}};
  new Function('require','module','exports',output)(name=>{assert.ok(name in dependencies,`Unmapped correction report dependency ${name}`);return dependencies[name];},record,record.exports);
  return record.exports;
}

function databaseBinding(sql,hooks) {
  class Statement {
    constructor(query,values=[]) {this.query=query;this.values=values;}
    bind(...values) {return new Statement(this.query,values);}
    async first() {return sql.prepare(this.query).get(...this.values)||null;}
    async all() {return {results:sql.prepare(this.query).all(...this.values)};}
    sync() {const result=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(result.changes)}};}
    async run() {return this.sync();}
  }
  return {prepare:query=>new Statement(query),async batch(statements) {
    if(hooks.beforeBatch) await hooks.beforeBatch(statements);
    sql.exec('BEGIN');
    try {const result=statements.map(statement=>statement.sync());sql.exec('COMMIT');return result;}
    catch(error) {sql.exec('ROLLBACK');throw error;}
  }};
}

async function fixture() {
  const sql=new DatabaseSync(':memory:');
  const hooks={beforeBatch:null,render:null,put:null};
  sql.exec(`CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,record_status TEXT,stage TEXT,revision INTEGER,updated_at TEXT,assignee_member_id TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,service_site_id TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,status TEXT);
    CREATE TABLE trade_work_order_events(id TEXT,work_order_id TEXT,firebase_uid TEXT,event_type TEXT,summary TEXT NOT NULL,created_at TEXT);
    CREATE TABLE trade_crm_write_guards(id TEXT PRIMARY KEY,firebase_uid TEXT,operation_id TEXT,step_number INTEGER,verified INTEGER CHECK(verified=1),created_at TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT,first_name TEXT,last_name TEXT,email TEXT,phone TEXT,role TEXT,capabilities TEXT,
      can_run_reports INTEGER,can_view_field_evidence INTEGER,can_manage_field_evidence INTEGER);
    CREATE TABLE trade_team_member_credentials(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,credential_type TEXT,name TEXT,credential_number TEXT,issuer TEXT,jurisdiction TEXT,expires_at TEXT,file_id TEXT,updated_at TEXT);
    CREATE TABLE trade_team_member_files(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,file_name TEXT,title TEXT,sha256 TEXT,expires_at TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,object_key TEXT,caption TEXT,original_sha256 TEXT,evidence_envelope TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,partner_type TEXT,business_name TEXT,abn TEXT,contact_name TEXT,phone TEXT,email TEXT,document_business_name TEXT,document_phone TEXT,document_email TEXT,address_line_1 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    INSERT INTO trade_work_orders VALUES('job','owner','active','completed',9,'2026-10-01T00:00:00Z','worker');
    INSERT INTO trade_team_members VALUES('worker','owner','kris','active','Kris Chen','Kris','Chen','kris@example.test','','field','["minimum-rental-standards"]',1,1,1);
    INSERT INTO trade_accounts VALUES('owner','installer','Test Business','53004085616','James','','info@example.test','','','','1 Test Street','Melbourne','VIC','3000');`);
  sql.exec(read('drizzle/0160_trade_rental_inspections.sql').replaceAll('--> statement-breakpoint',''));
  sql.exec(`ALTER TABLE trade_rental_inspections ADD COLUMN selected_modules_snapshot TEXT;
    ALTER TABLE trade_rental_inspections ADD COLUMN assessment_scope TEXT DEFAULT 'current_minimum_standards';
    ALTER TABLE trade_rental_inspection_modules ADD COLUMN selected_required INTEGER;`);
  sql.exec(read('drizzle/0263_trade_rental_report_corrections.sql').replaceAll('--> statement-breakpoint',''));
  sql.exec(read('drizzle/0196_trade_outgoing_email.sql').replaceAll('--> statement-breakpoint',''));
  sql.exec(`ALTER TABLE trade_work_orders ADD COLUMN partner_type TEXT DEFAULT 'installer';
    ALTER TABLE trade_work_orders ADD COLUMN source_type TEXT DEFAULT 'internal';
    ALTER TABLE trade_crm_job_details ADD COLUMN crm_customer_id TEXT;
    ALTER TABLE trade_crm_job_details ADD COLUMN customer_source TEXT;
    CREATE TABLE trade_crm_customers(id TEXT,firebase_uid TEXT,email TEXT,first_name TEXT,last_name TEXT,business_name TEXT,record_status TEXT);
    INSERT INTO trade_crm_customers VALUES('customer','owner','customer@example.test','Sam','Bolton','','active');
    INSERT INTO trade_crm_job_details VALUES('job','owner','','customer','trade_owned');`);
  const d1=databaseBinding(sql,hooks);
  installVerifiedTradeLeadFixture(sql);
  const originalAt='2026-10-01T00:00:00.000Z',createdAt='2026-10-02T00:00:00.000Z',completedAt='2026-10-02T01:00:00.000Z';
  const originalPdfDocument=await PDFDocument.create();originalPdfDocument.addPage();const originalPdf=await originalPdfDocument.save();
  const originalPdfHash=hash(originalPdf),originalPdfKey=`trade-issued-documents/rental-report/original/revision-1/${originalPdfHash}.pdf`;
  const originalSnapshot=assessment.canonicalRentalJson({schemaVersion:'tlink-rental-report-v1',report:{id:'original',number:'RMS-TEST-R1',revision:1,issuedAt:originalAt},issuer:{name:'Kris Chen'},modules:[{answers:{recordedAnswer:'Original answer'}}],evidence:[]});
  sql.prepare(`INSERT INTO trade_rental_inspections(id,work_order_id,firebase_uid,inspection_number,status,template_key,template_version,rules_effective_from,module_selection_snapshot,selected_modules_snapshot,
    property_snapshot,assessor_uid,assessor_member_id,assessor_snapshot,issued_report_id,issued_at,created_by_uid,created_at,updated_at)
    VALUES('inspection','job','owner','RMS-TEST','issued','vic-rental-minimum-standards',1,'2026-06-30','["minimum_standards"]','["minimum_standards"]',
      '{"customer":{"displayName":"Test Customer"},"property":{"addressLine1":"1 Test Street","state":"VIC"}}','kris','worker','{}','original',?,'kris',?,?)`).run(originalAt,originalAt,originalAt);
  sql.prepare(`INSERT INTO trade_rental_reports(id,inspection_id,firebase_uid,report_number,revision,status,report_snapshot,source_snapshot_sha256,pdf_object_key,pdf_sha256,pdf_size_bytes,
    issued_by_uid,issued_by_member_id,issuer_snapshot,staged_at,issued_at,created_at,updated_at) VALUES('original','inspection','owner','RMS-TEST-R1',1,'issued',?,?,?,?,?,'kris','worker','{}',?,?,?,?)`)
    .run(originalSnapshot,hash(originalSnapshot),originalPdfKey,originalPdfHash,originalPdf.length,originalAt,originalAt,originalAt,originalAt);
  sql.prepare(`INSERT INTO trade_rental_report_links(id,report_id,inspection_id,firebase_uid,token_hash,encrypted_token,expires_at,created_by_uid,created_at,updated_at)
    VALUES('original-link','original','inspection','owner',?,'encrypted',?,'kris',?,?)`).run(hash('original-secret'),assessment.rentalReportExpiresAt(originalAt),originalAt,originalAt);
  sql.prepare(`INSERT INTO trade_rental_inspection_events(id,inspection_id,report_id,firebase_uid,event_type,actor_type,actor_uid,metadata,created_at)
    VALUES('delivery','inspection','original','owner','report_email_accepted','assessor','kris','{"deliveryId":"accepted-original"}',?)`).run(originalAt);
  sql.prepare(`INSERT INTO trade_rental_corrections(id,work_order_id,firebase_uid,inspection_number,status,template_key,template_version,rules_effective_from,module_selection_snapshot,selected_modules_snapshot,
    property_snapshot,assessor_uid,assessor_member_id,assessor_snapshot,source_inspection_id,source_report_id,source_report_sha256,source_snapshot_sha256,correction_reason,created_by_uid,created_at,updated_at)
    SELECT 'correction',work_order_id,firebase_uid,'RMS-TEST-C1','in_progress',template_key,template_version,rules_effective_from,module_selection_snapshot,selected_modules_snapshot,
      property_snapshot,assessor_uid,assessor_member_id,assessor_snapshot,id,'original',?,?, 'Correct the recorded answer','kris',?,? FROM trade_rental_inspections WHERE id='inspection'`)
    .run(originalPdfHash,hash(originalSnapshot),createdAt,createdAt);
  const template={key:'minimum_standards',name:'Rental minimum standards',credentialGate:'assigned_assessor',metadataFields:[
    {key:'coverageConfirmed',label:'Coverage checked',type:'checkbox',required:true},{key:'assessorDeclaration',label:'New assessor declaration',type:'checkbox',required:true}],
    sections:[{key:'observation',title:'Recorded observation',checks:[{key:'recorded_condition',prompt:'Recorded condition',requiredEvidenceCount:0,credentialGate:'assigned_assessor'}]}],sources:[]};
  const answers={coverageConfirmed:true,assessorDeclaration:true,inspectionDate:'2026-10-02',rentalRegime:'ordinary_residential',recordedAnswer:'Corrected answer'};
  const credentials=load('src/lib/trade-rental-credentials.ts',{});
  const credential=await credentials.currentRentalModuleCredentialSnapshot({db:d1,ownerUid:'owner',assessorMemberId:'worker',moduleKey:'minimum_standards',requiredCapability:'assigned_assessor',answers,confirmedAt:completedAt});
  sql.prepare(`INSERT INTO trade_rental_correction_modules(id,inspection_id,firebase_uid,module_key,required,status,template_version,template_name,required_capability,template_snapshot,answers,credential_snapshot,completed_by_uid,completed_at,created_at,updated_at)
    VALUES('module','correction','owner','minimum_standards',1,'complete',1,'Rental minimum standards','assigned_assessor',?,?,?,'kris',?,?,?)`)
    .run(JSON.stringify(template),JSON.stringify(answers),JSON.stringify(credential),completedAt,createdAt,completedAt);
  sql.prepare(`INSERT INTO trade_rental_inspection_modules(id,inspection_id,firebase_uid,module_key,required,status,template_version,template_name,required_capability,template_snapshot,answers,credential_snapshot,completed_by_uid,completed_at,created_at,updated_at)
    VALUES('original-module','inspection','owner','minimum_standards',1,'complete',1,'Original rental assessment','assigned_assessor',?,'{"recordedAnswer":"Original answer","assessorDeclaration":true}',?,'kris',?,?,?)`)
    .run(JSON.stringify(template),JSON.stringify({...credential,confirmedAt:originalAt}),originalAt,originalAt,originalAt);
  sql.prepare(`INSERT INTO trade_rental_correction_items(id,inspection_id,module_id,firebase_uid,item_key,section_key,check_key,outcome,response_json,public_notes,completed_by_uid,completed_at,created_at,updated_at)
    VALUES('item','correction','module','owner','minimum_standards:observation:recorded_condition:property','observation','recorded_condition','meets','{"condition":"Corrected condition"}','Corrected recorded observation','kris',?,?,?)`)
    .run(completedAt,createdAt,completedAt);
  await guards.ensureRentalCorrectionSchemaGuards(d1);
  const objects=new Map([[originalPdfKey,originalPdf]]),puts=[],deletes=[],snapshots=[];
  const secrets=new Map([['original-link','original-secret']]);
  const store={async get(key) {const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},
    async put(key,bytes) {if(hooks.put) await hooks.put(key);objects.set(key,new Uint8Array(bytes));puts.push(key);},async delete(key) {objects.delete(key);deletes.push(key);}};
  const issuedStore=load('src/lib/trade-issued-document-store.ts',{'cloudflare:workers':{env:{EVIDENCE:store}}});
  const sync=load('src/lib/trade-team-sync-server.ts',{'./trade-job-collaboration.ts':collaboration});
  const actors=load('src/lib/trade-message-media-access.ts',{});
  const drafts=load('src/lib/trade-rental-correction-drafts.ts',{'./trade-rental-correction-schema-guards':guards,
    './trade-message-media-access':actors,'./trade-account-predicates':predicates});
  const api=load('src/lib/trade-rental-report-server.ts',{
    'cloudflare:workers':{env:{EVIDENCE:store}},'../../db':{getD1:()=>d1},
    '@/lib/trade-team-server':{async assignedJob(access,id) {const row=sql.prepare("SELECT * FROM trade_work_orders WHERE id=? AND firebase_uid=? AND record_status='active'").get(id,access.ownerUid);if(!row)throw Error('JOB_NOT_FOUND');return row;}},
    '@/lib/trade-team-sync-server':{...sync,jobSyncChangeStatements:()=>[]},'@/lib/trade-rental-assessment.mjs':assessment,
    '@/lib/trade-issued-document-store':issuedStore,'@/lib/trade-rental-evidence.mjs':evidence,'@/lib/rental-assessor-workflow.mjs':workflow,
    '@/lib/trade-rental-credentials':credentials,'@/lib/rental-report-answer.mjs':answer,'@/lib/rental-report-branding.mjs':branding,'@/lib/rental-quotation.mjs':quotation,
    '@/lib/trade-rental-schema-guards':{ensureTradeRentalSchemaGuards},'@/lib/trade-rental-correction-schema-guards':guards,'@/lib/trade-rental-correction-drafts':drafts,
    '@/lib/trade-rental-report-visibility':visibility,'@/lib/customer-plan-pdf-fonts':{loadCustomerPlanPdfFonts:async()=>undefined},
    '@/lib/trade-rental-report-brand':{rentalReportBrandBytes:()=>undefined},
    '@/lib/trade-rental-report-pdf.mjs':{async createRentalAssessmentPdfBytes(snapshot,...args) {snapshots.push(snapshot);if(hooks.render)await hooks.render();return renderer.createRentalAssessmentPdfBytes(snapshot,...args);}},
    '@/lib/trade-rental-report-links':{newRentalReportSecret:()=>crypto.randomUUID(),hashRentalReportSecret:async value=>hash(value),
      protectRentalReportSecret:async(id,issue,secret)=>{secrets.set(id,secret);return 'encrypted';},recoverRentalReportSecret:async(encrypted,id)=>secrets.get(id),
      rentalReportPath:(id,secret)=>`/rental-report/${id}.${secret}`,splitRentalReportToken:token=>{const dot=token.indexOf('.');return{linkId:token.slice(0,dot),secret:token.slice(dot+1)};}},
  });
  const sent=[];
  const emailApi=load('src/lib/trade-rental-report-email-server.ts',{
    '../../db':{getD1:()=>d1},'@/lib/trade-team-server':{assignedJob:async()=>sql.prepare("SELECT * FROM trade_work_orders WHERE id='job'").get()},
    '@/lib/trade-rental-report-server':api,'./trade-rental-report-visibility':visibility,
    '@/lib/service-reminder-delivery':{reminderProviderFailureOutcome:()=> 'rejected'},'./rental-report-email-template.mjs':{rentalReportEmailDraft},
    './trade-rental-report-provider-events':{readRentalReportProviderReceipt:async()=>null},
    './trade-rental-report-provider-verification':{readRentalReportAttachmentVerification:async()=>null},
    '@/lib/trade-email-server':{tradeCustomerEmailReadiness:async()=>({configured:true,provider:'resend'}),
      sendTradeCustomerEmail:async(owner,actor,message)=>{sent.push(message);return{provider:'resend',providerMessageId:'corrected-message'};}},
  });
  const access={ownerUid:'owner',actorUid:'kris',memberId:'worker',isOwner:false,canRunReports:true,canViewFieldEvidence:true,canManageFieldEvidence:true,displayName:'Kris Chen'};
  const input={access,workOrderId:'job',correctionId:'correction',expectedRevision:1,origin:'https://test'};
  const original=sql.prepare("SELECT * FROM trade_rental_inspections WHERE id='inspection'").get();
  const originalReport=sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get();
  const originalLink=sql.prepare("SELECT * FROM trade_rental_report_links WHERE id='original-link'").get();
  const originalModule=sql.prepare("SELECT * FROM trade_rental_inspection_modules WHERE id='original-module'").get();
  return {sql,d1,hooks,api,emailApi,sent,access,input,objects,puts,deletes,snapshots,original,originalReport,originalLink,originalModule,originalPdf,originalPdfKey,
    issue:patch=>api.issueRentalAssessmentCorrection({...input,...patch})};
}

test('freshly completed correction issues a downloadable immutable PDF revision and retains the original accepted report',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  const issued=await f.issue();
  assert.equal(issued.revision,2);assert.equal(issued.reportNumber,'RMS-TEST-R2');
  const report=f.sql.prepare('SELECT * FROM trade_rental_reports WHERE id=?').get(issued.reportId);
  const snapshot=JSON.parse(report.report_snapshot);
  assert.equal(snapshot.modules[0].answers.recordedAnswer,'Corrected answer');
  assert.equal(snapshot.report.assessmentCorrection.sourceReportId,'original');
  assert.equal(snapshot.report.assessmentCorrection.sourceReportPdfSha256,f.originalReport.pdf_sha256);
  assert.equal(snapshot.report.assessmentCorrection.reason,'Correct the recorded answer');
  const downloaded=await f.api.authenticatedRentalReportPdf({access:f.access,workOrderId:'job',reportId:issued.reportId});
  assert.ok((await PDFDocument.load(downloaded.bytes)).getPageCount()>0);
  assert.equal(hash(downloaded.bytes),report.pdf_sha256);
  if(process.env.RENTAL_CORRECTION_PDF_QA_PATH) fs.writeFileSync(process.env.RENTAL_CORRECTION_PDF_QA_PATH,downloaded.bytes);
  assert.equal((await f.api.authoriseRentalReportToken('original-link.original-secret')).report_id,'original');
  assert.equal((await f.api.authoriseRentalReportToken(new URL(issued.shareUrl).pathname.split('/').at(-1))).report_id,issued.reportId);
  assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_inspections WHERE id='inspection'").get(),f.original);
  assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get(),f.originalReport);
  assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_inspection_modules WHERE id='original-module'").get(),f.originalModule);
  assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_report_links WHERE id='original-link'").get(),f.originalLink);
  assert.deepEqual(f.objects.get(f.originalPdfKey),f.originalPdf);assert.ok(!f.deletes.includes(f.originalPdfKey));
  assert.equal(f.sql.prepare("SELECT COUNT(*) total FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get().total,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) total FROM trade_rental_inspection_events WHERE event_type='report_email_requested'").get().total,0);
  assert.equal(f.sql.prepare("SELECT stage FROM trade_work_orders WHERE id='job'").get().stage,'completed');
  assert.equal(f.sql.prepare("SELECT status FROM trade_rental_corrections WHERE id='correction'").get().status,'issued');
  assert.throws(()=>f.sql.prepare("UPDATE trade_rental_correction_items SET public_notes='tampered' WHERE id='item'").run(),/immutable/);
  assert.throws(()=>f.sql.prepare('UPDATE trade_rental_reports SET report_snapshot=? WHERE id=?').run('{}',issued.reportId),/immutable/);
  const history=await f.api.ownerRentalReportPresentation({ownerUid:'owner',inspectionId:'inspection',origin:'https://test',includeSecret:true});
  assert.deepEqual(history.map(row=>row.revision),[2,1]);assert.ok(history.every(row=>row.link?.pdfUrl));
});

test('only explicit Send emails the corrected PDF once and delivery state does not inherit the original accepted receipt',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  const issued=await f.issue();
  assert.equal(f.sent.length,0);
  assert.equal(await f.emailApi.rentalReportDeliveryState('owner','inspection'),null);
  const input={access:f.access,workOrderId:'job',inspectionId:'inspection',reportId:issued.reportId,expectedRecipientEmail:'customer@example.test',origin:'https://test'};
  const result=await f.emailApi.emailRentalAssessmentReport(input);
  assert.equal(result.status,'accepted');assert.equal(f.sent.length,1);
  const report=f.sql.prepare('SELECT pdf_sha256 FROM trade_rental_reports WHERE id=?').get(issued.reportId);
  assert.equal(hash(Buffer.from(f.sent[0].attachments[0].content,'base64')),report.pdf_sha256);
  assert.equal((await f.emailApi.rentalReportDeliveryState('owner','inspection')).reportId,issued.reportId);
  assert.equal((await f.emailApi.emailRentalAssessmentReport(input)).status,'accepted');assert.equal(f.sent.length,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) total FROM trade_rental_inspection_events WHERE report_id='original' AND event_type='report_email_accepted'").get().total,1);
});

for(const scenario of ['stale_revision','missing_fresh_declaration','revoked_access','tampered_source_pdf','source_changed_during_render','credential_changed_during_render']) {
  test(`correction issue rejects ${scenario} and retains the original artifact`,async t=>{
    const f=await fixture();t.after(()=>f.sql.close());
    let patch={};
    if(scenario==='stale_revision')patch={expectedRevision:0};
    if(scenario==='missing_fresh_declaration')f.sql.exec("UPDATE trade_rental_correction_modules SET answers=json_set(answers,'$.assessorDeclaration',json('false')) WHERE id='module'");
    if(scenario==='revoked_access')f.sql.exec("UPDATE trade_team_members SET can_run_reports=0 WHERE id='worker'");
    if(scenario==='tampered_source_pdf')f.objects.set(f.originalPdfKey,new TextEncoder().encode('%PDF-corrupted'));
    if(scenario==='source_changed_during_render')f.hooks.render=async()=>{f.sql.exec("UPDATE trade_work_orders SET revision=revision+1 WHERE id='job'");};
    if(scenario==='credential_changed_during_render')f.hooks.render=async()=>{f.sql.exec("INSERT INTO trade_team_member_credentials(id,owner_uid,team_member_id,status,credential_type,name,credential_number,issuer,jurisdiction,expires_at,file_id,updated_at,rental_gate) VALUES('new-credential','owner','worker','active','training','Updated qualification','Q2','','VIC','','','2026-10-03T00:00:00Z','')");};
    await assert.rejects(f.issue(patch),/CONFLICT|INCOMPLETE|CREDENTIAL|INTEGRITY|CHECK constraint/);
    assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_inspections WHERE id='inspection'").get(),f.original);
    assert.deepEqual(f.sql.prepare("SELECT * FROM trade_rental_reports WHERE id='original'").get(),f.originalReport);
    assert.equal(f.sql.prepare("SELECT COUNT(*) total FROM trade_rental_reports WHERE status='issued'").get().total,1);
    assert.ok(!f.deletes.includes(f.originalPdfKey));
  });
}

test('concurrent correction issue cannot emit a second report while the claimed draft renders',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  let started,release;const waiting=new Promise(resolve=>{started=resolve;});const pause=new Promise(resolve=>{release=resolve;});
  f.hooks.render=async()=>{started();await pause;};
  const first=f.issue();await waiting;
  await assert.rejects(f.issue(),/MUTATION_CONFLICT|ISSUING/);
  release();const issued=await first;
  assert.equal(issued.revision,2);assert.equal(f.sql.prepare("SELECT COUNT(*) total FROM trade_rental_reports WHERE status='issued'").get().total,2);
});

test('assessment correction triggers and actual issue statements compile within the deployed D1 expression-depth limit',async t=>{
  const f=await fixture();t.after(()=>f.sql.close());
  const probes=[];f.hooks.beforeBatch=statements=>{for(const statement of statements)probes.push({sql:statement.query,values:statement.values});};
  await f.issue();
  const schema=f.sql.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").all();
  const python=process.env.TLINK_SQLITE_DEPTH_PYTHON||(process.platform==='win32'?join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'):'python3');
  const script=String.raw`import json,sqlite3,sys
fixture=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
for row in fixture['schema']: db.execute(row['sql'])
for probe in fixture['probes']: db.execute('EXPLAIN '+probe['sql'],probe['values']).fetchall()
print(len(fixture['probes']))`;
  const run=spawnSync(python,['-c',script],{input:JSON.stringify({schema,probes}),encoding:'utf8',timeout:10000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stderr);assert.ok(Number(run.stdout)>=10);
});
