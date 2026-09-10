import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    for (const match of this.sql.matchAll(/\b(?:LIKE|GLOB)\s+\?/gi)) {
      const index = (this.sql.slice(0, match.index).match(/\?/g) || []).length;
      if (Buffer.byteLength(String(values[index]), 'utf8') > 50) throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
    }
    return new TestD1Statement(this.database, this.sql, values);
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
    return this.runSync();
  }
}

function testD1(database) {
  let beforeBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
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



function fixture({ failSend=false, largeReport=false }={}) {
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
 const db=testD1(database);const sent=[];let shouldFail=failSend;
 const api=loadTypescriptModule('../src/lib/trade-rental-report-email-server.ts',{
 '../../db':{getD1:()=>db},'@/lib/trade-team-server':{assignedJob:async()=>({id:'job'})},
 '@/lib/trade-rental-report-server':{authenticatedRentalReportPdf:async()=>({bytes:largeReport ? new Uint8Array(18 * 1024 * 1024 + 1) : new Uint8Array([37,80,68,70,45]),reportNumber:'RMS-123'}),ownerRentalReportPresentation:async()=>largeReport ? [{id:'report',link:{status:'active',shareUrl:'https://example.test/rental-report/secure-test-link'}}] : []},
 '@/lib/service-reminder-delivery':{serviceReminderProviderConfiguration:()=>({email:{configured:true}}),sendServiceReminderProviderMessage:async(input)=>{sent.push(input);if(shouldFail)throw new Error('network');return{provider:'resend',providerMessageId:'message'};}},
 });
 const input={access:{ownerUid:'owner',actorUid:'actor',memberId:'worker',canRunReports:true,isOwner:false},workOrderId:'job',inspectionId:'inspection',reportId:'report',expectedRecipientEmail:'JANE@EXAMPLE.TEST',origin:'https://example.test'};
 return{database,db,sent,input,api,send:()=>api.emailRentalAssessmentReport(input),allowSend:()=>{shouldFail=false;}};
}

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

test('report email greets the client, describes its attachment and offers help without quoting copy',async()=>{
 const f=fixture();assert.equal((await f.send()).status,'accepted');
 assert.match(f.sent[0].body,/^Hi Jane Smith,\n\n/);
 assert.match(f.sent[0].body,/report RMS-123 is ready for you to review/);
 assert.match(f.sent[0].body,/A PDF copy is attached for your records/);
 assert.match(f.sent[0].body,/If you have any questions or would like to talk through the report, please get in touch/);
 assert.match(f.sent[0].body,/Kind regards,\nTLink$/);
 assert.doesNotMatch(f.sent[0].body,/quoting|property findings, evidence and measured work/);
});

test('large report email uses the secure link without claiming an attachment and has a natural unnamed greeting',async()=>{
 const f=fixture({largeReport:true});f.database.exec("UPDATE trade_crm_customers SET first_name='',last_name=''");
 assert.equal((await f.send()).status,'accepted');
 assert.match(f.sent[0].body,/^Hello,\n\n/);
 assert.match(f.sent[0].body,/secure link below:\nhttps:\/\/example\.test\/rental-report\/secure-test-link/);
 assert.doesNotMatch(f.sent[0].body,/attached|quoting|Hi Client/);
 assert.equal(f.sent[0].attachments.length,0);
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
