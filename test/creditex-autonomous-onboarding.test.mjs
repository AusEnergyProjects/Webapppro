import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as onboarding from '../src/lib/creditex-onboarding-server.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
class Statement {
  constructor(sql, query, values = []) { Object.assign(this, { sql, query, values }); }
  bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, this.query, values); }
  async first() { return this.sql.prepare(this.query).get(...this.values) || null; }
  async all() { return { results: this.sql.prepare(this.query).all(...this.values) }; }
  async run() { return { success: true, meta: { changes: Number(this.sql.prepare(this.query).run(...this.values).changes) } }; }
}
function fixture({ beforeMigration } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,abn TEXT,business_name TEXT,capabilities TEXT,service_states TEXT,address_state TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,status TEXT,display_name TEXT,member_uid TEXT,capabilities TEXT);
    CREATE TABLE trade_team_member_files(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT,category TEXT);
    INSERT INTO trade_accounts VALUES('owner','53004085616','Test Pty Ltd','["hot-water"]','["VIC"]','VIC');
    INSERT INTO trade_team_members VALUES('owner-member','owner','active','Owner','owner','["hot-water"]');`);
  for (const file of ['0116_trade_crm_write_guard.sql', '0176_creditex_onboarding_training.sql', '0177_autonomous_activity_training.sql']) sql.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
  beforeMigration?.(sql);
  sql.exec(fs.readFileSync('drizzle/0178_autonomous_business_onboarding.sql', 'utf8'));
  const objects = new Map();
  const db = { prepare: query => new Statement(sql, query), batch: async statements => {
    sql.exec('BEGIN');
    try { const values = []; for (const statement of statements) values.push(await statement.run()); sql.exec('COMMIT'); return values; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  function document(id, kind, owner = 'owner') {
    const key = `creditex-onboarding/${owner}/${id}`; const body = `%PDF-1.7 fixture ${id}`;
    objects.set(key, body);
    sql.prepare('INSERT INTO creditex_onboarding_documents VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,kind,`${id}.pdf`,'application/pdf',body.length,sha(body),key,owner,new Date().toISOString());
    return id;
  }
  const verify = async document => {
    const object = objects.get(document.object_key);
    if (!object || sha(object) !== document.sha256) throw new onboarding.CreditexComplianceError('DOCUMENT_UNAVAILABLE', 'Upload the missing private document again.', 409);
  };
  return { sql, db, objects, document, verify };
}
function application(f) {
  return { legalName:'Test Pty Ltd',acn:'004085616',hasWebsite:false,website:'',address:'1 Example Street, Melbourne VIC 3000',
    insuranceDocumentId:f.document('insurance','insurance'),insuranceExpiresOn:'2099-12-31',priorProposalDocumentId:'',
    doesNswWork:false,contractorLicenceDocumentId:'',director:{name:'Director',address:'Private director address',email:'director@company.example',mobile:'0400000000',idDocumentId:f.document('director-id','director_id'),selfieDocumentId:f.document('director-selfie','director_selfie')},
    directorIsGuarantor:true,guarantor:{name:'',address:'',email:'',mobile:'',idDocumentId:'',selfieDocumentId:'',position:''},witness:{name:'Witness',position:'Manager',email:'witness@company.example'},acceptedPrivacy:true,
    agreementDocumentId:f.document('agreement','partnership_agreement'),acceptedCompliance:true };
}
async function complete(f, app = application(f)) {
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,app);
  return onboarding.submitCreditexApplication(f.db,'owner','owner',1,f.verify);
}
function route(f, isOwner = true) {
  const dependencies = {
    'cloudflare:workers': { env: { EVIDENCE: { get: async key => f.objects.has(key) ? { body: f.objects.get(key) } : null } } },
    '../../../../db': { getD1: () => f.db }, '@/lib/admin-server': { sameOrigin: () => true },
    '@/lib/bounded-json-request': { readBoundedJsonRequest: request => request.json() },
    '@/lib/creditex-onboarding-api': {
      requireCreditexOnboardingAccess: async () => ({ ownerUid:'owner',actorUid:isOwner?'owner':'member',isOwner }),
      creditexJson: (body,status=200) => Response.json(body,{status}),
      creditexApiError: error => Response.json({ok:false,code:error.code || 'FAILED'}, {status:error.status || 503}),
    }, '@/lib/creditex-onboarding-server': onboarding, '@/lib/trade-team-member-files-server': {},
  };
  const code = ts.transpileModule(fs.readFileSync('src/app/api/creditex-onboarding/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded = {exports:{}}; new Function('require','module','exports',code)(name => { assert.ok(dependencies[name],name);return dependencies[name]; },loaded,loaded.exports); return loaded.exports;
}
const submitRequest = () => new Request('https://example.test/api/creditex-onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',expectedRevision:1})});

test('valid supplied agreement completes onboarding automatically without reviewer or fabricated execution reference', async () => {
  const f=fixture(); const business=await complete(f);
  assert.equal(business.status,'completed'); assert.equal(business.approved,true); assert.equal(business.revision,2);
  assert.match(business.completionReference,/^TL-CX-ONBOARD-/); assert.ok(business.completedAt); assert.deepEqual(business.blockedReasons,[]);
  const row=f.sql.prepare('SELECT * FROM creditex_business_onboarding').get();
  assert.equal(row.status,'submitted'); assert.equal(row.reviewed_by_uid,''); assert.equal(row.agreement_reference,'');
  const receipt=f.sql.prepare('SELECT * FROM creditex_onboarding_completions').get();
  assert.equal(receipt.actor_uid,'owner'); assert.equal(receipt.agreement_document_id,'agreement'); assert.equal(receipt.business_abn,'53004085616');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM creditex_current_business_jurisdictions WHERE state='VIC'").get().n,1);
});

test('legacy application remains editable but neither missing agreement nor unchecked declaration can complete', async () => {
  for (const missing of ['agreementDocumentId','acceptedCompliance']) {
    const f=fixture(); const app=application(f); delete app[missing];
    const saved=await onboarding.saveCreditexApplication(f.db,'owner','owner',0,app);
    assert.equal(saved.approved,false); assert.ok(saved.blockedReasons.some(reason=>reason.includes(missing==='agreementDocumentId'?'signed Creditex':'compliance declaration')));
    await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',1,f.verify),error=>error.code==='ONBOARDING_INCOMPLETE');
    assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,0);
  }
});

test('intake completes before team bootstrap without making inactive people qualified', async () => {
  const f=fixture(); f.sql.exec('DELETE FROM trade_team_members');
  const business=await complete(f);
  assert.equal(business.status,'completed'); assert.equal(business.approved,true);
  assert.match(business.completionReference,/^TL-CX-ONBOARD-/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_current_category_qualifications').get().n,0);
});

test('existing pending intake can complete directly once all required evidence is present', async () => {
  for (const status of ['submitted','agreement_pending']) {
    const f=fixture(); await onboarding.saveCreditexApplication(f.db,'owner','owner',0,application(f));
    f.sql.prepare('UPDATE creditex_business_onboarding SET status=?').run(status);
    const business=await onboarding.submitCreditexApplication(f.db,'owner','owner',1,f.verify);
    assert.equal(business.status,'completed'); assert.equal(business.approved,true);
    await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',2,f.verify),error=>error.code==='REVISION_CONFLICT');
  }
});

test('API checks private storage presence and SHA-256 before creating a receipt', async () => {
  for (const mode of ['missing','changed','valid']) {
    const f=fixture(); await onboarding.saveCreditexApplication(f.db,'owner','owner',0,application(f));
    const key='creditex-onboarding/owner/agreement';
    if(mode==='missing')f.objects.delete(key); if(mode==='changed')f.objects.set(key,'different file');
    const response=await route(f).POST(submitRequest());
    assert.equal(response.status,mode==='valid'?200:409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,mode==='valid'?1:0);
  }
});

test('cross-business or wrong-kind document IDs cannot complete or save', async () => {
  for (const change of ["owner_uid='other'","kind='insurance'"]) {
    const f=fixture(); const app=application(f); f.sql.exec(`UPDATE creditex_onboarding_documents SET ${change} WHERE id='agreement'`);
    await assert.rejects(onboarding.saveCreditexApplication(f.db,'owner','owner',0,app),error=>error.code==='DOCUMENT_INVALID');
  }
});

test('NSW service selection requires the company licence even when the intake checkbox is false', async () => {
  const f=fixture();const app=application(f);f.sql.exec(`UPDATE trade_accounts SET service_states='["NSW","VIC"]'`);
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,app);
  await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',1,f.verify),error=>error.code==='ONBOARDING_INCOMPLETE' && /NSW company contractor licence/.test(error.message));
  app.contractorLicenceDocumentId=f.document('nsw-licence','contractor_licence');
  await onboarding.saveCreditexApplication(f.db,'owner','owner',1,app);
  assert.equal((await onboarding.submitCreditexApplication(f.db,'owner','owner',2,f.verify)).approved,true);
  assert.equal(JSON.parse(f.sql.prepare('SELECT application_json FROM creditex_business_onboarding').get().application_json).doesNswWork,true);
});

test('changed service jurisdiction, identity, insurance or document invalidates a current receipt immediately', async () => {
  for (const query of [
    `UPDATE trade_accounts SET service_states='["VIC","NSW"]'`,
    `UPDATE trade_accounts SET business_name='Changed Pty Ltd'`,
    `UPDATE creditex_business_onboarding SET insurance_expires_on='2000-01-01'`,
    `UPDATE creditex_onboarding_documents SET sha256='${'b'.repeat(64)}' WHERE id='agreement'`,
    `DELETE FROM creditex_onboarding_documents WHERE id='director-id'`,
  ]) {
    const f=fixture();await complete(f);f.sql.exec(query);
    assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false,query);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_current_business_approvals').get().n,0,query);
  }
});

test('saving another revision invalidates receipt without deleting history and replay cannot resubmit', async () => {
  const f=fixture();const app=application(f);await complete(f,app);
  await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',2,f.verify),error=>error.code==='REVISION_CONFLICT');
  assert.equal((await onboarding.saveCreditexApplication(f.db,'owner','owner',2,app)).approved,false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,1);
  await onboarding.submitCreditexApplication(f.db,'owner','owner',3,f.verify);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,2);
  assert.throws(()=>f.sql.exec("UPDATE creditex_onboarding_completions SET actor_uid='other'"),/append-only/);
  assert.throws(()=>f.sql.exec('DELETE FROM creditex_onboarding_completions'),/append-only/);
});

test('existing suspensions and rejections cannot be bypassed by editing or submitting', async () => {
  for (const status of ['suspended','rejected']) {
    const f=fixture();const app=application(f);await complete(f,app);f.sql.prepare('UPDATE creditex_business_onboarding SET status=?').run(status);
    await assert.rejects(onboarding.saveCreditexApplication(f.db,'owner','owner',2,app),error=>error.code==='ONBOARDING_RESTRICTED');
    await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',2,f.verify),error=>error.code==='ONBOARDING_RESTRICTED');
    assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false);
  }
});

test('concurrent identity, revision or document change rolls back automatic completion atomically', async () => {
  for (const query of [
    "UPDATE trade_accounts SET business_name='Changed Pty Ltd'",
    'UPDATE creditex_business_onboarding SET revision=revision+1',
    "UPDATE creditex_onboarding_documents SET owner_uid='other' WHERE id='agreement'",
  ]) {
    const f=fixture();await onboarding.saveCreditexApplication(f.db,'owner','owner',0,application(f));let changed=false;
    const verify=async document=>{await f.verify(document);if(document.kind==='partnership_agreement'&&!changed){f.sql.exec(query);changed=true;}};
    await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',1,verify),/CHECK constraint failed/);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,0);
    assert.equal(f.sql.prepare('SELECT status FROM creditex_business_onboarding').get().status,'draft');
  }
});

test('forward migration retains original private documents, legacy signed approvals and dependent jurisdiction view', async () => {
  const f=fixture({beforeMigration:sql=>{
    sql.prepare('INSERT INTO creditex_onboarding_documents VALUES(?,?,?,?,?,?,?,?,?,?)').run('retained','owner','insurance','original.pdf','application/pdf',10,'a'.repeat(64),'original/key','owner','2026-01-01');
    sql.exec(`INSERT INTO creditex_business_onboarding(owner_uid,business_abn,business_name,status,revision,application_json,insurance_expires_on,agreement_reference,reviewed_by_uid,updated_at) VALUES('owner','53004085616','Test Pty Ltd','approved',1,'{}','2099-12-31','SIGNED-OLD','real-reviewer','2026-01-01')`);
  }});
  assert.equal(f.sql.prepare('SELECT object_key FROM creditex_onboarding_documents WHERE id=?').get('retained').object_key,'original/key');
  assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,true);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_current_business_jurisdictions').get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM creditex_onboarding_completions').get().n,0);
});

test('team members receive progress labels without private applicant details or document IDs', async () => {
  const f=fixture();const app=application(f);app.acceptedCompliance=false;
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,app);
  const response=await route(f,false).GET(new Request('https://example.test/api/creditex-onboarding'));const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.application,undefined);assert.equal(body.documents,undefined);
  assert.equal(JSON.stringify(body).includes('Private director address'),false);assert.equal(JSON.stringify(body).includes('director@company.example'),false);
  assert.match(body.business.blockedReasons.join(' '),/compliance declaration/);
});
