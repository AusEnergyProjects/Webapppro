import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as contract from '../src/lib/form-compliance.ts';
import * as permissions from '../src/lib/creditex-permissions.ts';
import { jobMemberSql } from '../src/lib/trade-job-collaboration.ts';
import { verifiedTradeAccountPredicate } from '../src/lib/trade-account-predicates.ts';
import * as keyset from '../src/lib/keyset-pagination.ts';
import { installEmptyTradeCrews } from './helpers/trade-crews-fixture.mjs';

function module(source, imports) {
  const result = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(key => {
    assert.ok(key in imports, `Unexpected dependency ${key}`); return imports[key];
  }, result, result.exports);
  return result.exports;
}
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); installEmptyTradeCrews(sqlite);
  sqlite.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,can_manage_forms INTEGER,can_view_field_evidence INTEGER,job_scope TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,abn TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT,business_name TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,assignee_member_id TEXT,stage TEXT,revision INTEGER,work_number TEXT);
    CREATE TABLE trade_job_forms(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,template_key TEXT,template_name TEXT,template_snapshot TEXT,answers TEXT,revision INTEGER,status TEXT,updated_at TEXT);
    CREATE TABLE trade_form_templates(id TEXT,scope_owner_uid TEXT,template_key TEXT,name TEXT,fields TEXT,version INTEGER,updated_at TEXT,status TEXT);
    CREATE TABLE trade_activity_field_masters(id TEXT,organisation_id TEXT,activity_template_id TEXT,variant_id TEXT,version INTEGER,form_json TEXT);
    CREATE TABLE compliance_organisations(id TEXT,organisation_code TEXT,status TEXT);
    CREATE TABLE compliance_users(id TEXT,organisation_id TEXT,firebase_uid TEXT,role TEXT,permissions_json TEXT,status TEXT);
    CREATE TABLE admin_users(id TEXT,firebase_uid TEXT,role TEXT,status TEXT);
    CREATE TABLE compliance_cases(id TEXT,organisation_id TEXT,compliance_intent_id TEXT,work_order_id TEXT,installer_uid TEXT,revision INTEGER);
    CREATE TABLE compliance_case_assignments(organisation_id TEXT,case_id TEXT,compliance_user_id TEXT,status TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_organisation_id TEXT,compliance_case_id TEXT,status TEXT);
    CREATE TABLE trade_activity_field_records(id TEXT,intent_id TEXT,organisation_id TEXT,owner_uid TEXT,work_order_id TEXT,activity_template_id TEXT,payload TEXT,revision INTEGER,status TEXT,updated_at TEXT,supersedes_record_id TEXT);
    CREATE TABLE compliance_activity_work_pack_versions(id TEXT,organisation_id TEXT,activity_template_id TEXT,title TEXT,schema_snapshot TEXT,version INTEGER,publish_state TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT,organisation_id TEXT,work_order_id TEXT,compliance_intent_id TEXT,compliance_case_id TEXT,instance_key TEXT,revision INTEGER,status TEXT,response_snapshot TEXT,response_sha256 TEXT,work_pack_version_id TEXT);
    CREATE TABLE compliance_activity_work_pack_artifacts(id TEXT,organisation_id TEXT,instance_key TEXT,original_sha256 TEXT,metadata_snapshot TEXT,supersedes_artifact_id TEXT);
    CREATE TABLE compliance_activity_work_pack_signatures(id TEXT,organisation_id TEXT,instance_key TEXT,signature_sha256 TEXT,signature_payload_snapshot TEXT,supersedes_signature_id TEXT);
    INSERT INTO trade_team_members VALUES('member','owner','worker','active',1,1,'own'),('owner-member','owner','owner','active',1,1,'team'),('other-member','other','other','active',1,1,'team');
    INSERT INTO trade_accounts VALUES('owner','installer','active','approved','51824753556','51824753556','approved-review','2026-10-12','platform','Test business');
    INSERT INTO trade_account_verification_reviews VALUES('approved-review','owner','51824753556','Test business','installer','approved','official_abr_lookup','platform','2026-10-12');
    INSERT INTO trade_work_orders VALUES('job','owner','installer','active','member','in_progress',2,'TLJ-1'),('other-job','other','installer','active','other-member','in_progress',1,'TLJ-2');
    INSERT INTO compliance_organisations VALUES('org','CREDITEX-AU','active'),('other-org','CREDITEX-AU','active');
    INSERT INTO compliance_users VALUES('reviewer-member','org','reviewer','reviewer',NULL,'active');
    INSERT INTO admin_users VALUES('platform-member','platform','reviewer','active');
    INSERT INTO trade_work_order_compliance_intents VALUES('intent','job','owner','org','case','case_linked');
    INSERT INTO compliance_cases VALUES('case','org','intent','job','owner',3);
    INSERT INTO compliance_case_assignments VALUES('org','case','reviewer-member','assigned');`);
  sqlite.exec(readFileSync(new URL('../drizzle/0260_form_compliance.sql', import.meta.url), 'utf8'));
  const form = { title: 'Hot-water form', fields: [{ key: 'customer', label: 'Customer name' }, { key: 'equipment', label: 'Installed equipment' }] };
  const formSnapshot = JSON.stringify(form);
  sqlite.prepare('INSERT INTO trade_job_forms VALUES(?,?,?,?,?,?,?,?,?,?)').run('form','job','owner','heat-pump','Hot-water form',formSnapshot,'{"customer":"Test person","equipment":"Model X"}',4,'complete','2026-10-12T01:00:00Z');
  sqlite.prepare('INSERT INTO trade_job_forms VALUES(?,?,?,?,?,?,?,?,?,?)').run('other-form','other-job','other','heat-pump','Foreign form',formSnapshot,'{"customer":"Foreign person"}',1,'complete','2026-10-12T01:00:00Z');
  sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('template','owner','heat-pump','Hot-water form',JSON.stringify(form.fields),1,'2026-10-12T01:00:00Z','published');
  const payload = JSON.stringify({ id: 'field', form: { activityTemplateId: 'activity', variantId: '', title: form.title, fields: form.fields }, answers: { customer: 'Test person' } });
  sqlite.prepare('INSERT INTO trade_activity_field_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('field','intent','org','owner','job','activity',payload,1,'submitted_for_creditex_review','2026-10-12T01:00:00Z',null);
  const state = { beforeInsert: null, records: null };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { if (/^INSERT INTO form_compliance/.test(this.sql.trim()) && state.beforeInsert) { const fn = state.beforeInsert; state.beforeInsert = null; fn(); }
      return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const db = { prepare: sql => new Statement(sql) };
  const access = { ownerUid: 'owner', memberId: 'member', actorUid: 'worker', displayName: 'Business reviewer', canManageForms: true, canViewFieldEvidence: true, jobScope: 'own', isOwner: false };
  const business = { scope: 'business', access }, creditex = { scope: 'creditex', access: { kind: 'compliance', organisationId: 'org', uid: 'reviewer', memberId: 'reviewer-member', name: 'Creditex reviewer', role: 'reviewer' } };
  const service = module(readFileSync(new URL('../src/lib/form-compliance-server.ts', import.meta.url), 'utf8'), {
    'node:crypto': { createHash }, './form-compliance': contract, './creditex-permissions': permissions,
    './trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX-AU' }, './trade-job-collaboration': { jobMemberSql },
    './trade-account-predicates': { verifiedTradeAccountPredicate },
    './keyset-pagination': keyset,
    './trade-activity-forms-library': { defaultActivityFieldForm: (activityTemplateId, variantId) => ({ activityTemplateId, variantId, title: 'Activity form', fields: form.fields }) },
    './trade-job-forms-server': { async readSelectedTradeJobForm(team, workOrderId, formId) {
      const row = sqlite.prepare('SELECT * FROM trade_job_forms WHERE id=? AND work_order_id=? AND firebase_uid=?').get(formId,workOrderId,team.ownerUid);
      if (!row) throw new Error('JOB_FORM_NOT_FOUND'); return { form: { revision: row.revision, template: JSON.parse(row.template_snapshot) } };
    } },
    './creditex-job-audit-server': { async loadCreditexJobAudit(database, actor, intentId) {
      assert.equal(intentId,'intent'); assert.equal(actor.organisationId,'org');
      return { target: { ownerUid: 'owner', workOrderId: 'job', jobRevision: 2, caseRevision: 3, caseId: 'case' }, capabilities: { canSave: true },
        records: state.records || [{ kind: 'field', id: 'field', title: 'Activity form', revision: 1, status: 'submitted_for_creditex_review', answers: [{ key: 'customer', label: 'Customer name', value: 'Test person' }] }] };
    } },
  });
  const context = { scope: 'business', workOrderId: 'job', formId: 'form' };
  const creditexContext = { scope: 'creditex', intentId: 'intent', recordId: 'field', recordKind: 'field' };
  const reviewInput = workspace => ({ ...context, action: 'save_review', expectedRevision: workspace.review?.revision || 0, expectedSourceHash: workspace.source.hash,
    templateRevision: workspace.template.revision, status: 'complete', answers: workspace.template.questions.map(question => ({ key: question.key, response: 'pass', note: '' })) });
  return { sqlite, db, service, state, business, creditex, context, creditexContext, reviewInput };
}
test('business defaults use actual form fields and can be saved, reordered, removed and added independently', async t => {
  const f = fixture(t), initial = await f.service.loadFormComplianceTemplate(f.db,f.business,'business:heat-pump');
  assert.equal(initial.canManage,true); assert.equal(initial.template.revision,0); assert.equal(initial.template.questions.length,18);
  const questions = [...initial.template.questions.slice(1).reverse(),{ key: 'custom',label: 'Custom check',required: false }];
  const input = { action: 'save_template',scope: 'business',formKey: 'business:heat-pump',expectedRevision: 0,questions };
  const saved = await f.service.saveFormComplianceTemplate(f.db,f.business,input);
  assert.equal(saved.template.revision,1); assert.deepEqual(saved.template.questions,questions);
  assert.equal((await f.service.saveFormComplianceTemplate(f.db,f.business,input)).template.revision,1,'Exact retries do not duplicate a version');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_template_versions').get().n,1);
  assert.throws(() => f.sqlite.exec("UPDATE form_compliance_template_versions SET title='tampered'"),/immutable/);
  assert.throws(() => f.sqlite.exec('DELETE FROM form_compliance_template_versions'),/immutable/);
  assert.equal(f.sqlite.prepare('SELECT answers FROM trade_job_forms WHERE id=?').get('form').answers,'{"customer":"Test person","equipment":"Model X"}');
});
test('unsupported linked checks, foreign templates and stale author revisions fail closed', async t => {
  const f = fixture(t), question = { key: 'test',label: 'Check',required: true };
  await assert.rejects(() => f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:'business:heat-pump',expectedRevision:0,questions:[{ ...question,sourceFieldKey:'foreign-field' }] }),/Linked checks/);
  await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,f.business,'business:foreign-key'),/unavailable/);
  await f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:'business:heat-pump',expectedRevision:0,questions:[question] });
  await assert.rejects(() => f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:'business:heat-pump',expectedRevision:0,questions:[{ ...question,label:'Different' }] }),/changed/);
});

test('built-in, unknown and another owner\'s templates cannot be edited, reviewed or inferred through the business queue', async t => {
  const f = fixture(t), question = { key:'check',label:'Work checked?',required:true };
  const clone = f.sqlite.prepare('INSERT INTO trade_job_forms SELECT ?,work_order_id,firebase_uid,?,?,template_snapshot,answers,revision,status,updated_at FROM trade_job_forms WHERE id=?');
  clone.run('builtin-form','builtin','Built-in only form','form'); clone.run('unknown-form','unknown','Unknown default form','form');
  f.sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('foreign-created','other','builtin','Foreign custom form','[]',1,'2026-10-12','published');
  f.sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('shared-created','','unknown','Shared only form','[]',1,'2026-10-12','published');
  const unavailable = error => error.code === 'COMPLIANCE_FORM_NOT_FOUND' && error.status === 404;
  const current = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  for (const [key,id] of [['builtin','builtin-form'],['unknown','unknown-form']]) {
    await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,f.business,`business:${key}`),unavailable);
    await assert.rejects(() => f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:`business:${key}`,expectedRevision:0,questions:[question] }),unavailable);
    await assert.rejects(() => f.service.loadFormComplianceWorkspace(f.db,f.business,{ ...f.context,formId:id }),unavailable);
    await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,{ ...f.reviewInput(current),formId:id }),unavailable);
  }
  assert.deepEqual((await f.service.loadFormComplianceQueue(f.db,f.business)).items.map(item => item.formId),['form']);
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business,{ q:'Built-in only' })).items.length,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_template_versions').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,0);
  const fields = JSON.parse(f.sqlite.prepare('SELECT template_snapshot FROM trade_job_forms WHERE id=?').get('form').template_snapshot).fields;
  f.sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('owner-created','owner','builtin','Owner custom form',JSON.stringify(fields),1,'2026-10-12','published');
  assert.equal((await f.service.loadFormComplianceTemplate(f.db,f.business,'business:builtin')).template.title,'Owner custom form');
  assert.equal((await f.service.loadFormComplianceWorkspace(f.db,f.business,{ ...f.context,formId:'builtin-form' })).template.formKey,'business:builtin');
  assert.ok((await f.service.loadFormComplianceQueue(f.db,f.business)).items.some(item => item.formId === 'builtin-form'));
});

test('withdrawing or removing a custom template revokes atomic review saves and queue eligibility', async t => {
  for (const mutation of ["DELETE FROM trade_form_templates WHERE id='template'","UPDATE trade_form_templates SET status='withdrawn' WHERE id='template'",
    "UPDATE trade_form_templates SET scope_owner_uid='other' WHERE id='template'"]) {
    const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
    f.state.beforeInsert = () => f.sqlite.exec(mutation);
    await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(workspace)),/changed/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,0);
    assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business)).items.length,0);
    await assert.rejects(() => f.service.loadFormComplianceWorkspace(f.db,f.business,f.context),/unavailable/);
  }
});
test('business authorship permission is checked again inside the insert', async t => {
  const f = fixture(t);
  f.state.beforeInsert = () => f.sqlite.exec("UPDATE trade_team_members SET can_manage_forms=0 WHERE id='member'");
  await assert.rejects(() => f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:'business:heat-pump',expectedRevision:0,questions:[{ key:'a',label:'Check',required:true }] }),/permission changed/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_template_versions').get().n,0);
});
test('completed review records exact source and questionnaire snapshots without changing installer answers', async t => {
  const f = fixture(t), before = f.sqlite.prepare('SELECT * FROM trade_job_forms WHERE id=?').get('form');
  const workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context), input = f.reviewInput(workspace);
  const saved = await f.service.saveFormComplianceReview(f.db,f.business,input);
  assert.equal(saved.review.revision,1); assert.equal(saved.review.status,'complete'); assert.equal(saved.stale,false);
  assert.equal((await f.service.saveFormComplianceReview(f.db,f.business,input)).review.revision,1,'Identical retry is idempotent');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM trade_job_forms WHERE id=?').get('form'),before);
  const history = f.sqlite.prepare('SELECT * FROM form_compliance_review_versions').get();
  assert.equal(JSON.parse(history.template_snapshot).questions.length,18); assert.equal(history.source_hash,workspace.source.hash);
  assert.throws(() => f.sqlite.exec("UPDATE form_compliance_review_versions SET status='draft'"),/immutable/);
  assert.throws(() => f.sqlite.exec('DELETE FROM form_compliance_review_versions'),/immutable/);
});
test('source changes and questionnaire changes make prior reviews stale while retaining their original questions', async t => {
  const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  await f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(workspace));
  await f.service.saveFormComplianceTemplate(f.db,f.business,{ action:'save_template',scope:'business',formKey:workspace.template.formKey,expectedRevision:0,questions:[{ key:'new',label:'New check',required:true }] });
  const updated = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  assert.equal(updated.stale,true); assert.equal(updated.template.revision,1); assert.equal(updated.review.templateRevision,0);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT template_snapshot FROM form_compliance_review_versions').get().template_snapshot).questions.length,18);
  await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(workspace)),/questions changed/);
});
test('simultaneous reviewers cannot overwrite each other and saving a new draft preserves the completed revision', async t => {
  const f = fixture(t), current = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  const first = { ...f.reviewInput(current),status:'draft',answers:f.reviewInput(current).answers.map((answer,index) => ({ ...answer,note:index ? '' : 'First reviewer' })) };
  const second = { ...first,answers:first.answers.map((answer,index) => ({ ...answer,note:index ? '' : 'Second reviewer' })) };
  const results = await Promise.allSettled([f.service.saveFormComplianceReview(f.db,f.business,first),f.service.saveFormComplianceReview(f.db,f.business,second)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
  assert.equal(results.filter(result => result.status === 'rejected').length,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,1);
  const draft = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  const completed = await f.service.saveFormComplianceReview(f.db,f.business,{ ...f.reviewInput(draft),status:'complete' });
  await f.service.saveFormComplianceReview(f.db,f.business,{ ...f.reviewInput(completed),status:'draft' });
  assert.deepEqual(f.sqlite.prepare('SELECT revision,status FROM form_compliance_review_versions ORDER BY revision').all().map(row => [row.revision,row.status]),[[1,'draft'],[2,'complete'],[3,'draft']]);
});
test('review completion rejects failed checks, missing required checks and an unfinished installer form', async t => {
  const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context), input = f.reviewInput(workspace);
  for (const response of ['fail','unchecked']) {
    await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,{ ...input,answers:[{ ...input.answers[0],response },...input.answers.slice(1)] }),/required question/);
  }
  f.sqlite.exec("UPDATE trade_job_forms SET status='draft' WHERE id='form'");
  const draft = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(draft)),/installer must complete/);
  assert.equal((await f.service.saveFormComplianceReview(f.db,f.business,{ ...f.reviewInput(draft),status:'draft' })).review.status,'draft');
});
test('atomic review guard rejects changed answers, job assignment, permissions and template revisions', async t => {
  for (const mutation of ["UPDATE trade_job_forms SET answers='{}' WHERE id='form'", "UPDATE trade_work_orders SET assignee_member_id='other-member' WHERE id='job'",
    "UPDATE trade_team_members SET can_view_field_evidence=0 WHERE id='member'", "UPDATE trade_team_members SET status='suspended' WHERE id='member'",
    "UPDATE trade_accounts SET account_status='closed' WHERE firebase_uid='owner'", "UPDATE trade_account_verification_reviews SET decision='rejected' WHERE id='approved-review'"]) {
    const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context); f.state.beforeInsert = () => f.sqlite.exec(mutation);
    await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(workspace)),/changed/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,0);
  }
});
test('cross-tenant and unassigned form reads are denied and only accessible completed forms appear in the queue', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.service.loadFormComplianceWorkspace(f.db,f.business,{ ...f.context,formId:'other-form',workOrderId:'other-job' }),/JOB_FORM_NOT_FOUND/);
  const queue = await f.service.loadFormComplianceQueue(f.db,f.business); assert.equal(queue.items.length,1); assert.equal(queue.items[0].status,'not_started'); assert.equal(queue.nextCursor,null);
  const workspace = await f.service.loadFormComplianceWorkspace(f.db,f.business,f.context);
  await f.service.saveFormComplianceReview(f.db,f.business,f.reviewInput(workspace));
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business)).items[0].status,'complete');
  f.sqlite.exec("UPDATE trade_work_orders SET revision=3 WHERE id='job'");
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business)).items[0].status,'stale');
  f.sqlite.exec("UPDATE trade_work_orders SET assignee_member_id='other-member' WHERE id='job'");
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business)).items.length,0);
});
test('queue pagination covers every authorised completed form without duplicates and search spans the full scope', async t => {
  const f = fixture(t);
  const insert = f.sqlite.prepare('INSERT INTO trade_job_forms SELECT ?,work_order_id,firebase_uid,template_key,?,template_snapshot,answers,revision,status,? FROM trade_job_forms WHERE id=?');
  for (let i=0;i<126;i++) insert.run(`paged-${String(i).padStart(3,'0')}`,i===125?'Unique older form':'Hot-water form',i<65?'2026-10-12T01:00:00Z':'2026-10-11T01:00:00Z','form');
  const first = await f.service.loadFormComplianceQueue(f.db,f.business); assert.equal(first.items.length,50); assert.ok(first.nextCursor);
  const second = await f.service.loadFormComplianceQueue(f.db,f.business,{ cursor:first.nextCursor }); assert.equal(second.items.length,50); assert.ok(second.nextCursor);
  const third = await f.service.loadFormComplianceQueue(f.db,f.business,{ cursor:second.nextCursor }); assert.equal(third.items.length,27); assert.equal(third.nextCursor,null);
  const ids = [...first.items,...second.items,...third.items].map(item => item.formId); assert.equal(new Set(ids).size,127); assert.equal(ids.includes('other-form'),false);
  const found = await f.service.loadFormComplianceQueue(f.db,f.business,{ q:' unique OLDER ' }); assert.equal(found.items.length,1); assert.equal(found.items[0].formId,'paged-125');
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business,{ q:'TLJ-2' })).items.length,0,'A foreign job cannot be inferred through search');
  assert.equal((await f.service.loadFormComplianceQueue(f.db,f.business,{ q:'%' })).items.length,0,'Search is a literal substring, not a wildcard');
  await assert.rejects(() => f.service.loadFormComplianceQueue(f.db,f.business,{ q:'new search',cursor:first.nextCursor }),/no longer matches/);
  await assert.rejects(() => f.service.loadFormComplianceQueue(f.db,f.business,{ cursor:'malformed' }),/no longer matches/);
  await assert.rejects(() => f.service.loadFormComplianceQueue(f.db,f.business,{ cursor:'x'.repeat(513) }),/valid review page/);
  const differentActor = { ...f.business,access:{ ...f.business.access,actorUid:'owner',memberId:'owner-member',isOwner:true,jobScope:'team' } };
  await assert.rejects(() => f.service.loadFormComplianceQueue(f.db,differentActor,{ cursor:first.nextCursor }),/no longer matches/);
});
test('Creditex review uses the actual selected field form and immutable source identity', async t => {
  const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.creditex,f.creditexContext);
  assert.equal(workspace.template.formKey,'activity:activity:'); assert.equal(workspace.source.answers[0].value,'Test person');
  const input = { ...f.reviewInput(workspace),...f.creditexContext }; delete input.workOrderId; delete input.formId;
  const saved = await f.service.saveFormComplianceReview(f.db,f.creditex,input);
  assert.equal(saved.review.actorName,'Creditex reviewer'); assert.equal(saved.review.status,'complete');
  assert.equal(f.sqlite.prepare('SELECT scope_id FROM form_compliance_review_versions').get().scope_id,'org');
});
test('Creditex authors can edit governed shared draft questionnaires while built-in and foreign form definitions are excluded', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,f.creditex,'creditex-job-form:builtin'),/unavailable/);
  await assert.rejects(() => f.service.saveFormComplianceTemplate(f.db,f.creditex,{ action:'save_template',scope:'creditex',formKey:'creditex-job-form:builtin',expectedRevision:0,questions:[{ key:'custom',label:'Work verified?',required:true }] }),/unavailable/);
  f.sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('shared','', 'shared-draft','Shared draft','[{"key":"scope","label":"Work scope"}]',1,'2026-10-12','draft');
  const draft = await f.service.loadFormComplianceTemplate(f.db,f.creditex,'creditex-job-form:shared-draft'); assert.equal(draft.template.questions.length,17);
  await f.service.saveFormComplianceTemplate(f.db,f.creditex,{ action:'save_template',scope:'creditex',formKey:'creditex-job-form:shared-draft',expectedRevision:0,questions:[{ key:'custom',label:'Work verified?',required:true }] });
  await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,f.creditex,'creditex-job-form:heat-pump'),/unavailable/);
  f.sqlite.exec("UPDATE trade_form_templates SET status='withdrawn' WHERE id='shared'");
  await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,f.creditex,'creditex-job-form:shared-draft'),/withdrawn/);
  const platformReviewer = { scope:'creditex',access:{ kind:'admin',organisationId:'org',uid:'platform',memberId:'platform-member',name:'Platform reviewer',role:'reviewer' } };
  await assert.rejects(() => f.service.loadFormComplianceTemplate(f.db,platformReviewer,'creditex-job-form:builtin'),/permission/);
});

test('Creditex supporting reviews require a governed shared form and recheck its presence inside the save', async t => {
  const f = fixture(t);
  f.state.records = [{ kind:'job_form',id:'form',title:'Hot-water form',revision:4,status:'complete',answers:[{ key:'customer',label:'Customer name',value:'Test person' }] }];
  const context = { ...f.creditexContext,recordKind:'job_form',recordId:'form' };
  await assert.rejects(() => f.service.loadFormComplianceWorkspace(f.db,f.creditex,context),/shared supporting form is unavailable/);
  const fields = f.sqlite.prepare('SELECT fields FROM trade_form_templates WHERE id=?').get('template').fields;
  f.sqlite.prepare('INSERT INTO trade_form_templates VALUES(?,?,?,?,?,?,?,?)').run('governed-shared','','heat-pump','Governed shared form',fields,1,'2026-10-12','published');
  const workspace = await f.service.loadFormComplianceWorkspace(f.db,f.creditex,context);
  assert.equal(workspace.template.formKey,'creditex-job-form:heat-pump');
  const input = { ...f.reviewInput(workspace),...context }; delete input.workOrderId; delete input.formId;
  f.state.beforeInsert = () => f.sqlite.exec("UPDATE trade_form_templates SET status='withdrawn' WHERE id='governed-shared'");
  await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.creditex,input),/changed/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,0);
});
test('Creditex review writes recheck audit grants, case assignment and superseding field records', async t => {
  for (const mutation of ["UPDATE compliance_users SET permissions_json='[\"jobs\"]' WHERE id='reviewer-member'",
    "UPDATE compliance_case_assignments SET status='released' WHERE case_id='case'",
    "INSERT INTO trade_activity_field_records SELECT 'successor',intent_id,organisation_id,owner_uid,work_order_id,activity_template_id,payload,2,status,updated_at,id FROM trade_activity_field_records WHERE id='field'"]) {
    const f = fixture(t), workspace = await f.service.loadFormComplianceWorkspace(f.db,f.creditex,f.creditexContext);
    const input = { ...f.reviewInput(workspace),...f.creditexContext }; delete input.workOrderId; delete input.formId;
    f.state.beforeInsert = () => f.sqlite.exec(mutation);
    await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.creditex,input),/changed/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM form_compliance_review_versions').get().n,0);
  }
});
test('Creditex work-pack review binds the actual selected room/unit answers and changed evidence invalidates save', async t => {
  const f = fixture(t), pack = { title:'Cooling form',sections:[{ prompts:[{ promptKey:'unit',label:'Installed unit' }] }] };
  f.sqlite.prepare('INSERT INTO compliance_activity_work_pack_versions VALUES(?,?,?,?,?,?,?)').run('pack-version','org','cooling','Cooling form',JSON.stringify(pack),1,'published');
  f.sqlite.prepare('INSERT INTO compliance_activity_work_pack_instances VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('pack','org','job','intent','case','instance',1,'completed','{"answers":{"unit":"Model X"}}','a'.repeat(64),'pack-version');
  f.state.records = [{ kind:'work_pack',id:'pack',title:'Cooling form',revision:1,status:'completed',answers:[{ key:'unit',label:'Installed unit',value:'Model X' }] }];
  const context = { ...f.creditexContext,recordId:'pack',recordKind:'work_pack' }, workspace = await f.service.loadFormComplianceWorkspace(f.db,f.creditex,context);
  assert.equal(workspace.template.formKey,'work-pack:cooling'); assert.equal(workspace.source.answers[0].value,'Model X');
  const input = { ...f.reviewInput(workspace),...context }; delete input.workOrderId; delete input.formId;
  f.state.beforeInsert = () => f.sqlite.prepare('INSERT INTO compliance_activity_work_pack_artifacts VALUES(?,?,?,?,?,?)').run('new-photo','org','instance','b'.repeat(64),'{}','');
  await assert.rejects(() => f.service.saveFormComplianceReview(f.db,f.creditex,input),/changed/);
});
