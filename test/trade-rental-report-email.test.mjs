import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import ts from "typescript";
import { rentalReportEmailDraft } from "../src/lib/rental-report-email-template.mjs";
import { ReminderProviderDeliveryError, reminderProviderFailureOutcome } from "../src/lib/service-reminder-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

class TestD1Statement {
  constructor(database, sql, values = [], hooks = {}) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.hooks = hooks;
  }

  bind(...values) {
    for (const match of this.sql.matchAll(/\b(?:LIKE|GLOB)\s+\?/gi)) {
      const index = (this.sql.slice(0, match.index).match(/\?/g) || []).length;
      if (Buffer.byteLength(String(values[index]), 'utf8') > 50) throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
    }
    return new TestD1Statement(this.database, this.sql, values, this.hooks);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    const result = this.runSync();
    const callback = this.hooks.afterRun;
    this.hooks.afterRun = null;
    if (callback) await callback();
    return result;
  }
}

function testD1(database) {
  let beforeBatch = null;
  const hooks = { afterRun: null };
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql, [], hooks);
    },
    setAfterRun(callback) { hooks.afterRun = callback; },
    setBeforeBatch(callback) {
      beforeBatch = callback;
    },
    async batch(statements) {
      const callback = beforeBatch;
      beforeBatch = null;
      if (callback) callback();
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadTypescriptModule(path, mocks = {}) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : {};
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}



function fixture({ failSend=false, largeReport=false, linkStatus="active", provider="resend", configured=true, indeterminate=false, pdfSize=0 }={}) {
 const database=new DatabaseSync(':memory:');
 database.exec(`CREATE TABLE trade_work_orders(id text,firebase_uid text,partner_type text,record_status text,source_type text);
 CREATE TABLE trade_crm_job_details(work_order_id text,firebase_uid text,crm_customer_id text,customer_source text);
 CREATE TABLE trade_crm_customers(id text,firebase_uid text,email text,first_name text,last_name text,business_name text,record_status text);
 CREATE TABLE trade_rental_reports(id text,firebase_uid text,inspection_id text,status text,report_number text,pdf_sha256 text);
 CREATE TABLE trade_rental_inspections(id text PRIMARY KEY,firebase_uid text,work_order_id text,status text,issued_report_id text,assessor_member_id text);
 INSERT INTO trade_work_orders VALUES('job','owner','installer','active','internal');
 INSERT INTO trade_crm_job_details VALUES('job','owner','customer','trade_owned');
 INSERT INTO trade_crm_customers VALUES('customer','owner','jane@example.test','Jane','Smith','','active');
 INSERT INTO trade_rental_inspections VALUES('inspection','owner','job','issued','report','worker');
 INSERT INTO trade_rental_reports VALUES('report','owner','inspection','issued','RMS-123','hash');`);
 const migration = read('../drizzle/0160_trade_rental_inspections.sql');
 database.exec(migration.slice(migration.indexOf('CREATE TABLE `trade_rental_inspection_events`')).replaceAll('--> statement-breakpoint', ''));
 const db=testD1(database);const sent=[];const sendOptions=[];const hooks={beforePdf:null,beforeSend:null};const assignedCalls=[];let shouldFail=failSend;
 const api=loadTypescriptModule('../src/lib/trade-rental-report-email-server.ts',{
 './rental-report-email-template.mjs':{rentalReportEmailDraft},
 '../../db':{getD1:()=>db},'@/lib/trade-team-server':{assignedJob:async(access,workOrderId)=>{assignedCalls.push({access,workOrderId});const job=database.prepare("SELECT id FROM trade_work_orders WHERE id=? AND firebase_uid=? AND record_status='active'").get(workOrderId,access.ownerUid);if(!job)throw new Error('JOB_NOT_FOUND');return job;}},
 '@/lib/trade-rental-report-server':{authenticatedRentalReportPdf:async()=>{await hooks.beforePdf?.();return{bytes:largeReport ? new Uint8Array(18 * 1024 * 1024 + 1) : pdfSize ? new Uint8Array(pdfSize) : new Uint8Array([37,80,68,70,45]),reportNumber:'RMS-123'};},ownerRentalReportPresentation:async()=>[{id:'report',link:linkStatus ? {status:linkStatus,shareUrl:'https://example.test/rental-report/secure-test-link'} : null}]},
 '@/lib/service-reminder-delivery':{reminderProviderFailureOutcome,sendServiceReminderProviderMessage:async()=>{throw new Error('Platform sender must not be called');}},
 '@/lib/trade-email-server':{tradeCustomerEmailReadiness:async(ownerUid)=>{assert.equal(ownerUid,'owner');return{configured,provider,from:'team@trade.example'};},sendTradeCustomerEmail:async(ownerUid,actorUid,input,options)=>{assert.equal(ownerUid,'owner');assert.equal(actorUid,'actor');sent.push(input);sendOptions.push(options);await hooks.beforeSend?.();if(shouldFail)throw indeterminate ? new ReminderProviderDeliveryError('indeterminate','unknown') : new Error('rejected');return{provider,providerMessageId:'message'};}},
 });
 const input={access:{ownerUid:'owner',actorUid:'actor',memberId:'worker',canRunReports:true,isOwner:false},workOrderId:'job',inspectionId:'inspection',reportId:'report',expectedRecipientEmail:'JANE@EXAMPLE.TEST',origin:'https://example.test'};
 const reviewInput={access:{...input.access,isOwner:true,actorUid:'owner'},workOrderId:'job',inspectionId:'inspection',hold:true};
 return{database,db,sent,sendOptions,hooks,assignedCalls,input,reviewInput,api,send:()=>api.emailRentalAssessmentReport(input),allowSend:()=>{shouldFail=false;},hold:(hold=true)=>api.setRentalReportDeliveryReview({...reviewInput,hold})};
}

test('owner review holds this inspection durably without changing or sending its completed report',async()=>{
 const f=fixture();assert.equal(await f.api.rentalReportDeliveryReview('owner','inspection'),null);
 assert.equal((await f.hold()).status,'held');assert.equal((await f.hold()).status,'held');
 assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_review_held'").get().n,1);
 for(let retry=0;retry<3;retry++){
  const result=await f.send();assert.equal(result.status,'held');assert.equal(result.reportId,'report');
  assert.equal(result.message,'The business owner is reviewing this report. The completed report is saved; email will wait for their approval.');
 }
 assert.equal(f.sent.length,0);assert.equal(await f.api.rentalReportDeliveryState('owner','inspection'),null);
 assert.equal(f.database.prepare("SELECT status,issued_report_id FROM trade_rental_inspections WHERE id='inspection'").get().status,'issued');
 const audit=f.database.prepare("SELECT actor_type,actor_uid,report_id FROM trade_rental_inspection_events WHERE event_type='report_email_review_held'").get();
 assert.equal(audit.actor_type,'owner');assert.equal(audit.actor_uid,'owner');assert.equal(audit.report_id,'report');
 assert.equal(await f.api.rentalReportDeliveryReview('other-owner','inspection'),null);
 assert.equal(await f.api.rentalReportDeliveryReview('owner','missing'),null);
});

test('review can be saved before issuance and stays authoritative for the later issued report',async()=>{
 const f=fixture();f.database.exec("UPDATE trade_rental_inspections SET status='ready_to_issue',issued_report_id=''");
 assert.equal((await f.hold()).status,'held');
 assert.equal(f.database.prepare("SELECT report_id FROM trade_rental_inspection_events WHERE event_type='report_email_review_held'").get().report_id,'');
 f.database.exec("UPDATE trade_rental_inspections SET status='issued',issued_report_id='report'");
 assert.equal((await f.send()).status,'held');assert.equal(f.sent.length,0);
});

test('explicit owner approval releases the review and emails the exact issued report once',async()=>{
 const f=fixture();await f.hold();assert.equal((await f.hold(false)).status,'released');
 assert.equal((await f.api.rentalReportDeliveryReview('owner','inspection')).status,'released');
 assert.equal((await f.send()).status,'accepted');assert.equal((await f.send()).status,'accepted');assert.equal(f.sent.length,1);
 const audit=f.database.prepare("SELECT actor_type,actor_uid,report_id FROM trade_rental_inspection_events WHERE event_type='report_email_review_released'").get();
 assert.equal(audit.actor_type,'owner');assert.equal(audit.actor_uid,'owner');assert.equal(audit.report_id,'report');
 const receipt=await f.api.rentalReportDeliveryState('owner','inspection');assert.equal(receipt.status,'accepted');assert.equal(receipt.reportId,'report');
});

test('review does not become a default hold for another inspection or business',async()=>{
 const f=fixture();f.database.exec("INSERT INTO trade_rental_inspections VALUES('other-inspection','owner','other-job','issued','other-report','worker')");
 await f.hold();assert.equal(await f.api.rentalReportDeliveryReview('owner','other-inspection'),null);
 assert.equal(await f.api.rentalReportDeliveryReview('other-owner','inspection'),null);
});

test('only the actual business owner with report permission can hold or release delivery',async()=>{
 for(const kind of ['assessor','manager','impersonated-owner','permission'])for(const hold of [true,false]){
  const f=fixture();const input={...f.reviewInput,access:{...f.reviewInput.access},hold};
  if(kind==='assessor'||kind==='manager')input.access.isOwner=false;
  if(kind==='impersonated-owner')input.access.actorUid='admin';
  if(kind==='permission')input.access.canRunReports=false;
  await assert.rejects(()=>f.api.setRentalReportDeliveryReview(input),/REPORT_DELIVERY_OWNER_REQUIRED/);
  assert.equal(f.assignedCalls.length,0);assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspection_events').get().n,0);
 }
});

test('review validates the assigned job and exact inspection owner relation before journalling',async()=>{
 for(const kind of ['job','inspection','foreign-inspection']){
  const f=fixture();const input={...f.reviewInput};
  if(kind==='job')input.workOrderId='other-job';
  if(kind==='inspection')input.inspectionId='missing';
  if(kind==='foreign-inspection')f.database.exec("UPDATE trade_rental_inspections SET firebase_uid='other-owner'");
  await assert.rejects(()=>f.api.setRentalReportDeliveryReview(input),kind==='job'?/JOB_NOT_FOUND/:/RENTAL_INSPECTION_NOT_FOUND/);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspection_events').get().n,0);
 }
});

test('accepted and indeterminate email cannot be falsely paused after transmission',async()=>{
 for(const indeterminate of [false,true]){
  const f=fixture({failSend:indeterminate,indeterminate});
  assert.equal((await f.send()).status,indeterminate?'reconciliation_required':'accepted');
  await assert.rejects(()=>f.hold(),/REPORT_DELIVERY_ALREADY_SENDING/);
  assert.equal(await f.api.rentalReportDeliveryReview('owner','inspection'),null);assert.equal(f.sent.length,1);
 }
});

test('a confirmed failed email may be held and then approved for a safe same-key retry',async()=>{
 const f=fixture({failSend:true});assert.equal((await f.send()).status,'failed');
 assert.equal((await f.hold()).status,'held');f.allowSend();assert.equal((await f.send()).status,'held');assert.equal(f.sent.length,1);
 await f.hold(false);assert.equal((await f.send()).status,'accepted');assert.equal(f.sent.length,2);
 assert.equal(f.sent[0].idempotencyKey,f.sent[1].idempotencyKey);
});

test('hold winning during PDF preparation prevents the atomic email claim and provider call',async()=>{
 const f=fixture();let begin;let resume;const began=new Promise(resolve=>{begin=resolve;});const proceed=new Promise(resolve=>{resume=resolve;});
 f.hooks.beforePdf=async()=>{begin();await proceed;};
 const delivery=f.send();await began;assert.equal((await f.hold()).status,'held');resume();
 assert.equal((await delivery).status,'held');assert.equal(f.sent.length,0);
 assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_requested'").get().n,0);
});

test('delivery claim winning first refuses a hold while provider transmission is in flight',async()=>{
 const f=fixture();let begin;let resume;const began=new Promise(resolve=>{begin=resolve;});const proceed=new Promise(resolve=>{resume=resolve;});
 f.hooks.beforeSend=async()=>{begin();await proceed;};
 const delivery=f.send();await began;await assert.rejects(()=>f.hold(),/REPORT_DELIVERY_ALREADY_SENDING/);
 assert.equal(await f.api.rentalReportDeliveryReview('owner','inspection'),null);resume();
 assert.equal((await delivery).status,'accepted');assert.equal(f.sent.length,1);
});

test('concurrent owner hold cannot be reported as a successful release',async()=>{
 const f=fixture();await f.hold();
 f.db.setAfterRun(async()=>{assert.equal((await f.hold()).status,'held');});
 await assert.rejects(()=>f.hold(false),/REPORT_DELIVERY_REVIEW_CHANGED/);
 assert.equal((await f.api.rentalReportDeliveryReview('owner','inspection')).status,'held');assert.equal((await f.send()).status,'held');assert.equal(f.sent.length,0);
});

test('concurrent owner release cannot be reported as a successful hold',async()=>{
 const f=fixture();
 f.db.setAfterRun(async()=>{assert.equal((await f.hold(false)).status,'released');});
 await assert.rejects(()=>f.hold(),/REPORT_DELIVERY_REVIEW_CHANGED/);
 assert.equal((await f.api.rentalReportDeliveryReview('owner','inspection')).status,'released');
});

test('report email stays within the production 50-byte LIKE pattern limit', async () => {
 const f=fixture();
 assert.throws(()=>f.db.prepare('SELECT 1 WHERE ? LIKE ?').bind('value','x'.repeat(51)), /pattern too complex/);
 assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,1);
});

test('delivery history ignores adjacent prefixes and different owner, inspection or report identities', async () => {
 const f=fixture();
 f.database.exec("INSERT INTO trade_rental_inspections VALUES('other-inspection','owner','other-job','issued','report','worker')");
 const hash=(value)=>createHash('sha256').update(value).digest('hex');
 const prefix=`report-email:${hash(`rental-report-email|owner|report|hash|${hash('jane@example.test')}`)}`;
 const insert=f.database.prepare(`INSERT INTO trade_rental_inspection_events
  (id,inspection_id,report_id,firebase_uid,event_type,request_id,created_at)
  VALUES(?,?,?,?,'report_email_accepted',?,'2026-09-10T00:00:00.000Z')`);
 for(const [index,[inspection,report,owner,request]] of [
  ['inspection','report','owner',`${prefix}9:accepted`],
  ['inspection','report','owner',`${prefix};accepted`],
  ['inspection','report','other-owner',`${prefix}:owner-accepted`],
  ['other-inspection','report','owner',`${prefix}:inspection-accepted`],
  ['inspection','other-report','owner',`${prefix}:report-accepted`],
 ].entries()) insert.run(`unrelated-${index}`,inspection,report,owner,request);
 assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,1,'Unrelated acceptance must not suppress this report email');
 assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,1,'The matching acceptance still prevents duplicate email');
});
test('issued report email reads immutable PDF and persists acceptance without sending twice',async()=>{
 const f=fixture();assert.equal((await f.send()).status,'accepted');assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].recipient,'jane@example.test');assert.equal(f.sent[0].attachments[0].contentType,'application/pdf');
 assert.equal((await f.api.rentalReportDeliveryState('owner','inspection')).status,'accepted');
});

for (const provider of ['google','microsoft']) test(`report uses the business ${provider} connection and records provider acceptance only`, async () => {
 const f=fixture({provider});assert.equal((await f.send()).status,'accepted');assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,1);
 const receipt=f.database.prepare("SELECT metadata FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get();
 assert.equal(JSON.parse(receipt.metadata).provider,provider);
 assert.equal((await f.api.rentalReportDeliveryState('owner','inspection')).status,'accepted');
});

test('disconnected business sender blocks the report without falling back to platform email',async()=>{
 const f=fixture({configured:false,provider:'google'});assert.equal((await f.send()).status,'failed');assert.equal(f.sent.length,0);
});

test('unknown provider outcome requires reconciliation and cannot send again',async()=>{
 const f=fixture({provider:'microsoft',failSend:true,indeterminate:true});assert.equal((await f.send()).status,'reconciliation_required');
 f.allowSend();assert.equal((await f.send()).status,'reconciliation_required');assert.equal(f.sent.length,1);
 assert.equal((await f.api.rentalReportDeliveryState('owner','inspection')).status,'reconciliation_required');
});

for (const provider of ['google','microsoft']) test(`${provider} evidence reports beyond the direct-send allowance use their secure PDF link`,async()=>{
 const f=fixture({provider,pdfSize:1.5*1024*1024+1});assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent[0].attachments.length,0);assert.match(f.sent[0].body,/secure link/);assert.doesNotMatch(f.sent[0].body,/attached/);
});

for (const provider of ['google','microsoft']) test(`${provider} reports at the attachment allowance retain the PDF`,async()=>{
 const f=fixture({provider,pdfSize:1.5*1024*1024});assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent[0].attachments.length,1);assert.equal(Buffer.from(f.sent[0].attachments[0].content,'base64').length,1.5*1024*1024);
});

test('report email greets the client, describes its attachment and offers help without quoting copy',async()=>{
 const f=fixture();assert.equal((await f.send()).status,'accepted');
 assert.match(f.sent[0].body,/^Hi Jane Smith,\n\n/);
 assert.match(f.sent[0].body,/report RMS-123 is ready for you to review/);
 assert.match(f.sent[0].body,/A PDF copy is attached for your records/);
 assert.match(f.sent[0].body,/secure link below:\nhttps:\/\/example\.test\/rental-report\/secure-test-link/);
 assert.match(f.sent[0].body,/If you have any questions or would like to talk through the report, please get in touch/);
 assert.match(f.sent[0].body,/Kind regards,\nTLink$/);
 assert.match(f.sent[0].html,/View report &amp; download PDF/);
 assert.match(f.sent[0].html,/A PDF copy is attached for your records/);
 assert.match(f.sent[0].html,/An issued report does not mean that every check passed/);
 assert.doesNotMatch(f.sent[0].body,/quoting|property findings, evidence and measured work/);
});

test('large report email uses the secure link without claiming an attachment and has a natural unnamed greeting',async()=>{
 const f=fixture({largeReport:true});f.database.exec("UPDATE trade_crm_customers SET first_name='',last_name=''");
 assert.equal((await f.send()).status,'accepted');
 assert.match(f.sent[0].body,/^Hello,\n\n/);
 assert.match(f.sent[0].body,/secure link below:\nhttps:\/\/example\.test\/rental-report\/secure-test-link/);
 assert.doesNotMatch(f.sent[0].body,/attached|quoting|Hi Client/);
 assert.equal(f.sent[0].attachments.length,0);
 assert.match(f.sent[0].html,/available to download as a PDF/);
 assert.doesNotMatch(f.sent[0].html,/attached|Hi Client/);
});
test('recipient changes, protected records, wrong assessor and missing report permission never send',async()=>{
 for(const kind of ['email','protected','assessor','permission']){const f=fixture();
 if(kind==='email')f.database.exec("UPDATE trade_crm_customers SET email='other@example.test'");
 if(kind==='protected')f.database.exec("UPDATE trade_crm_job_details SET customer_source='platform_private'");
 if(kind==='assessor')f.input.access.memberId='other';if(kind==='permission')f.input.access.canRunReports=false;
 await assert.rejects(f.send);assert.equal(f.sent.length,0,kind);}
});
test('unconfirmed delivery retries with the same provider key and never reports sent on failure',async()=>{
 const f=fixture({failSend:true});assert.equal((await f.send()).status,'failed');f.allowSend();assert.equal((await f.send()).status,'accepted');
 assert.equal(f.sent.length,2);assert.equal(f.sent[0].idempotencyKey,f.sent[1].idempotencyKey);
 assert.deepEqual(f.sendOptions.map(options=>options.previouslyAttempted),[false,true]);
});
test('ambiguous delivery beyond provider deduplication window requires review rather than duplicate email',async()=>{
 const f=fixture({failSend:true});await f.send();f.allowSend();
 f.database.exec("UPDATE trade_rental_inspection_events SET created_at='2020-01-01T00:00:00.000Z'");
 assert.equal((await f.send()).status,'reconciliation_required');assert.equal(f.sent.length,1);
});
test('concurrent delivery requests acquire only one journal claim',async()=>{
 const f=fixture();const results=await Promise.all([f.send(),f.send()]);
 assert.equal(f.sent.length,1);assert.ok(results.some(row=>row.status==='accepted'));
});


test('delivery state never presents an earlier report acceptance for a new current report', async () => {
 const f=fixture();await f.send();
 f.database.exec("UPDATE trade_rental_inspections SET issued_report_id='new-report'");
 assert.equal(await f.api.rentalReportDeliveryState('owner','inspection'),null);
});

test('delivery receipt identifies the current report and normalized recipient after a lost send response', async () => {
 const f=fixture();await f.send();
 const receipt=await f.api.rentalReportDeliveryState('owner','inspection');
 assert.equal(receipt.status,'accepted');assert.equal(receipt.reportId,'report');
 assert.equal(receipt.recipientSha256,createHash('sha256').update('jane@example.test').digest('hex'));
 assert.equal(f.sent.length,1);
 assert.equal(await f.api.rentalReportDeliveryState('other-owner','inspection'),null);
 // Report identity comes from the issued-report relation, never untrusted metadata.
 f.database.exec("UPDATE trade_rental_inspection_events SET metadata='{}' WHERE event_type='report_email_accepted'");
 const legacy=await f.api.rentalReportDeliveryState('owner','inspection');
 assert.equal(legacy.reportId,'report');assert.equal(legacy.recipientSha256,'');
});

for (const linkStatus of ['', 'revoked', 'expired']) test(`report email requires active link even with a small PDF: ${linkStatus || 'missing'}`, async () => {
  const f = fixture({ linkStatus }); assert.equal((await f.send()).status, 'failed');
  assert.equal(f.sent.length, 0);
  assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_requested'").get().n, 0);
});
