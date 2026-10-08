import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import * as activity from '../src/lib/trade-activity-forms.ts';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import * as form from '../src/lib/veu-electrical-safety-form.ts';
import * as predicates from '../src/lib/trade-account-predicates.ts';
import * as membership from '../src/lib/trade-job-collaboration.ts';
import * as guardSql from '../src/lib/tlink-schema-guards.ts';
import * as reminder from '../src/lib/service-reminder-delivery.ts';
import { renderVeuElectricalSafetyPdf } from '../src/lib/veu-electrical-safety-pdf.ts';
import { PDFDocument } from 'pdf-lib';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function compile(path, imports = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  Function('require', 'exports', code)(id => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id]; }, exports);
  return exports;
}
const types = compile('../src/lib/veu-electrical-assessment.ts');
const guards = compile('../src/lib/trade-veu-electrical-schema-guards.ts', { './tlink-schema-guards': guardSql });
const draft = compile('../src/lib/trade-veu-electrical-draft.ts', { './trade-activity-forms': activity, './veu-electrical-safety-form': form });
const owner = { ownerUid: 'owner', actorUid: 'owner', memberId: 'owner-member', isOwner: true, displayName: 'Casey Electrician', jobScope: 'team', canViewFieldEvidence: true, canManageFieldEvidence: true };
const worker = { ...owner, actorUid: 'worker-uid', memberId: 'worker', isOwner: false, jobScope: 'team' };
const ink = [{ points: [{ x: 0.05, y: 0.1 }, { x: 0.4, y: 0.8 }, { x: 0.9, y: 0.2 }] }];
function electricalAnswers(overrides) {
  const schema=form.createVeuElectricalForm(), answers={assessment_outcome:'no_rectification',life_support:false,alternative_supply:false,recessed_luminaires:false,
    ceiling_appliances:false,ceiling_flues:false,other_hazards_present:false,non_tps_cables:false,split_metal_conduit:false,damaged_cables:false,
    tps_safe:'yes',initial_electrician_name:'Casey Electrician',owner_name:'Sam Owner',...overrides};
  for(const field of flow.expandedActivityFields(schema,answers)){
    if(!field.required||Object.hasOwn(answers,field.key)||['photo','document'].includes(field.type))continue;
    answers[field.key]=field.type==='boolean'?true:field.type==='date'?'2026-10-08':field.type==='number'?1:field.type==='select'?field.options[0]:`Example ${field.label}`;
  }
  answers.initial_correct=false;return answers;
}

function fixture(t,realPdf=false) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,email TEXT,business_name TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,abn TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,work_number TEXT,partner_type TEXT,record_status TEXT,stage TEXT,revision INTEGER,source_type TEXT,assignee_member_id TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,crm_customer_id TEXT,customer_source TEXT);
    CREATE TABLE trade_crm_customers(id TEXT,firebase_uid TEXT,email TEXT,first_name TEXT,last_name TEXT,record_status TEXT);
    CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,member_uid TEXT,status TEXT,can_view_field_evidence INTEGER,can_manage_field_evidence INTEGER,job_scope TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_crew_members(owner_uid TEXT,member_id TEXT,crew_id TEXT);
    CREATE TABLE trade_crews(id TEXT,owner_uid TEXT,lead_member_id TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT,firebase_uid TEXT,assignee_member_id TEXT,status TEXT);
    CREATE TABLE trade_email_submissions(owner_uid TEXT,request_key TEXT,status TEXT,provider TEXT,provider_message_id TEXT,PRIMARY KEY(owner_uid,request_key));
    INSERT INTO trade_accounts VALUES('owner','office@example.com','Example Electrical','installer','active','approved','51824753556','51824753556','review','2026-10-01','admin');
    INSERT INTO trade_account_verification_reviews VALUES('review','owner','51824753556','Example Electrical','installer','approved','official_abr_lookup','admin','2026-10-01');
    INSERT INTO trade_work_orders VALUES('job','owner','J-001','installer','active','in_progress',1,'direct','worker');
    INSERT INTO trade_work_orders VALUES('foreign-job','foreign','J-002','installer','active','in_progress',1,'direct','foreign-worker');
    INSERT INTO trade_crm_job_details VALUES('job','owner','customer','trade_owned');
    INSERT INTO trade_crm_customers VALUES('customer','owner','customer@example.com','Sam','Owner','active');
    INSERT INTO trade_team_members VALUES('owner-member','owner','owner','active',1,1,'team');
    INSERT INTO trade_team_members VALUES('worker','owner','worker-uid','active',1,1,'team');`);
  sql.exec(`ALTER TABLE trade_accounts ADD COLUMN phone TEXT NOT NULL DEFAULT '';
    ALTER TABLE trade_accounts ADD COLUMN document_phone TEXT NOT NULL DEFAULT '';
    ALTER TABLE trade_crm_job_details ADD COLUMN service_site_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE trade_team_members ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE trade_team_members ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
    CREATE TABLE trade_crm_service_sites(id TEXT,firebase_uid TEXT,customer_id TEXT,record_status TEXT,address_line_1 TEXT,address_line_2 TEXT,suburb TEXT,address_state TEXT,postcode TEXT);
    CREATE TABLE trade_team_member_credentials(id TEXT,owner_uid TEXT,team_member_id TEXT,credential_number TEXT,credential_type TEXT,rental_gate TEXT,jurisdiction TEXT,status TEXT,expires_at TEXT,file_id TEXT,updated_at TEXT);
    CREATE TABLE trade_team_member_files(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_crm_service_sites VALUES('site','owner','customer','active','12 Synthetic Street','','Frankston','VIC','3199');
    UPDATE trade_crm_job_details SET service_site_id='site';
    UPDATE trade_accounts SET phone='0399990000',document_phone='0399990001' WHERE firebase_uid='owner';`);
  sql.exec(read('../drizzle/0256_trade_veu_electrical_assessments.sql').replaceAll('--> statement-breakpoint', ''));
  let hook = () => {}, lostBatch = false, mailFailure = null, inBatch = false;
  const roundTrips = [];
  const trip = (kind, query) => { if (!inBatch) roundTrips.push({ kind, query }); };
  const db = { prepare(query) { let values = []; const stmt = { bind(...args) { values = args; return stmt; },
    async first() { trip('read', query); hook(query); return sql.prepare(query).get(...values) || null; },
    async all() { trip('read', query); hook(query); return { results: sql.prepare(query).all(...values), success: true }; },
    async run() { trip('write', query); hook(query); return { meta: { changes: Number(sql.prepare(query).run(...values).changes) }, success: true }; } }; return stmt; },
    async batch(statements) { roundTrips.push({ kind: 'batch' }); inBatch = true; sql.exec('BEGIN'); let result;
      try { result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); }
      catch (error) { sql.exec('ROLLBACK'); throw error; } finally { inBatch = false; }
      if (lostBatch) { lostBatch = false; throw new Error('SYNTHETIC_LOST_COMMIT_ACK'); } return result; } };
  const objects = new Map(), renders = [], sends = [], progressCalls = [];
  let progressPending = false, completesJob = false;
  const bucket = { async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async get(key) { const bytes = objects.get(key); return bytes ? { async arrayBuffer() { return bytes.slice().buffer; } } : null; }, async delete(key) { objects.delete(key); } };
  const journal = (key, status, id = '') => sql.prepare('INSERT OR REPLACE INTO trade_email_submissions VALUES(?,?,?,?,?)').run('owner', key, status, 'synthetic', id);
  const service = compile('../src/lib/trade-veu-electrical-assessment-server.ts', {
    'cloudflare:workers': { env: { EVIDENCE: bucket } }, '../../db': { getD1: () => db }, './trade-job-collaboration': membership,
    './trade-account-predicates': predicates, './trade-activity-forms': activity, './trade-activity-form-flow': flow,
    './veu-electrical-safety-form': form, './veu-electrical-assessment': types, './trade-veu-electrical-schema-guards': guards,
    './trade-veu-electrical-draft': draft,
    './service-reminder-delivery': reminder,
    './trade-form-job-progress': { async reconcileTradeFormJobProgress(access, workOrderId, options) {
      const record = sql.prepare('SELECT status,pdf_object_key,pdf_sha256,pdf_size_bytes FROM trade_veu_electrical_assessments WHERE work_order_id=? AND owner_uid=?').get(workOrderId, access.ownerUid);
      assert.equal(record.status, 'complete'); assert.ok(record.pdf_object_key); assert.equal(record.pdf_sha256.length, 64); assert.ok(record.pdf_size_bytes > 4);
      progressCalls.push({ access, workOrderId, options });
      if (completesJob) sql.prepare("UPDATE trade_work_orders SET stage='completed',revision=revision+1 WHERE id=? AND firebase_uid=?").run(workOrderId,access.ownerUid);
      return progressPending ? { changed: false, stage: '', pending: true, blockers: [{ key: 'job_progress_pending' }] }
        : { changed: false, stage: 'in_progress', blockers: [] };
    } },
    './trade-email-server': { async sendTradeCustomerEmail(uid, actor, message, options) {
      assert.equal(uid, 'owner'); assert.ok(actor); await options.beforeSend();
      if (mailFailure) return mailFailure(message, journal);
      sends.push(message); journal(message.idempotencyKey, 'accepted', `message-${sends.length}`); return { provider: 'synthetic', providerMessageId: `message-${sends.length}` };
    } },
    './veu-electrical-safety-pdf': { async renderVeuElectricalSafetyPdf(record,assets) { assert.equal(form.veuElectricalCompletion(record).ready, true); renders.push(structuredClone(record));
      return realPdf?renderVeuElectricalSafetyPdf(record,assets,{regular:fs.readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf',import.meta.url)),bold:fs.readFileSync(new URL('../public/fonts/LiberationSans-Bold.ttf',import.meta.url))}):new TextEncoder().encode(`%PDF-${activity.activityCanonical(record)}`); } },
    './customer-plan-pdf-fonts': { async loadCustomerPlanPdfFonts() { return {}; } },
    './trade-activity-forms-pdf': { async validateActivityEvidenceBytes(bytes, type) { assert.equal(type, 'application/pdf'); assert.ok(bytes.length > 5); } },
  });
  async function start() { return service.startPiesaRecord(owner, 'job'); }
  async function answered(overrides = {}) {
    const record = await start(); const answers = electricalAnswers(overrides);
    return service.savePiesaAnswers(owner, record.id, record.revision, answers, 'answers');
  }
  async function attested(overrides = {}) { const record = await answered(overrides); return service.attestPiesaInitial(owner, record.id, record.revision, activity.activitySigningScope(record, 'before'), true, 'initial'); }
  async function signed(overrides = {}) {
    let record = await attested(overrides);
    for (const declaration of record.form.declarations.filter(item => activity.activityConditionMet(item.condition, record.answers, record.form))) {
      const field = form.VEU_ELECTRICAL_SIGNER_FIELDS[declaration.key];
      record = await service.signPiesaDeclaration(owner, record.id, record.revision, { declarationKey: declaration.key, signerName: record.answers[field], strokes: ink,
        accepted: true, scopeSha256: activity.activitySigningScope(record, declaration.phase) }, `sign-${declaration.key}`);
    }
    return record;
  }
  return { sql, db, service, objects, renders, sends, progressCalls, roundTrips, journal, start, answered, attested, signed,
    pendingProgress(value) { progressPending = value; },
    completesJob(value) { completesJob = value; },
    hook(value) { hook = value; }, loseBatch() { lostBatch = true; }, mail(value) { mailFailure = value; } };
}

test('standalone start is job scoped, idempotent and has no compliance intent', async t => {
  const h = fixture(t), first = await h.start(), second = await h.start();
  assert.equal(first.id, second.id); assert.equal(first.status, 'draft'); assert.equal(first.revision, 1);
  assert.equal('intentId' in first, false); assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_versions').get().n, 1);
  await assert.rejects(h.service.startPiesaRecord(owner, 'foreign-job'), /access/);
  await assert.rejects(h.service.readPiesaRecord({ ...owner, ownerUid: 'foreign', actorUid: 'foreign' }, first.id), /not found/);
});

for (const state of ['NSW', 'QLD', '']) test(`a new standalone PIESA rejects a ${state || 'missing'} service-site jurisdiction without creating a record`, async t => {
  const h = fixture(t);
  h.sql.prepare('UPDATE trade_crm_service_sites SET address_state=? WHERE id=?').run(state, 'site');
  await assert.rejects(h.start(), error => error.code === 'PIESA_JURISDICTION_REQUIRED' && error.status === 400);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_assessments').get().n, 0);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_versions').get().n, 0);
});

test('standalone PIESA creation rechecks the service-site jurisdiction at the insert boundary', async t => {
  const h = fixture(t);
  h.hook(query => {
    if (/INSERT OR IGNORE INTO trade_veu_electrical_assessments/.test(query)) {
      h.sql.exec("UPDATE trade_crm_service_sites SET address_state='NSW' WHERE id='site'");
      h.hook(() => {});
    }
  });
  await assert.rejects(h.start(), error => error.code === 'PIESA_REVISION_CONFLICT');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_assessments').get().n, 0);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_versions').get().n, 0);
});

test('an existing historical PIESA remains readable and editable after its job service-site state changes', async t => {
  const h = fixture(t), first = await h.start();
  h.sql.exec("UPDATE trade_crm_service_sites SET address_state='NSW' WHERE id='site'");
  assert.deepEqual(await h.start(), first);
  assert.deepEqual(await h.service.readPiesaRecord(owner, first.id), first);
  const saved = await h.service.savePiesaAnswers(owner, first.id, first.revision, { life_support: false }, 'historical-state-edit');
  assert.equal(saved.answers.life_support, false); assert.equal(saved.revision, 2);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_assessments').get().n, 1);
});

function electricianProfile(h, memberId = 'owner-member', licence = 'SYNTHETIC-LICENCE') {
  h.sql.prepare('UPDATE trade_team_members SET first_name=?,last_name=? WHERE id=?').run('Casey', memberId === 'owner-member' ? 'Current' : 'Assigned', memberId);
  h.sql.prepare('INSERT INTO trade_team_member_files VALUES(?,?,?,?,?)').run(`file-${memberId}`, 'owner', memberId, 'active', '2027-10-08');
  h.sql.prepare('INSERT INTO trade_team_member_credentials VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`credential-${memberId}`, 'owner', memberId, licence,
    'licence', 'licensed_electrician', 'VIC', 'active', '2027-10-08', `file-${memberId}`, '2026-10-08');
}

test('new assessments save only known job/customer details, leaving findings and REC authority unanswered', async t => {
  const h = fixture(t), record = await h.start();
  assert.deepEqual(record.answers, { job_reference: 'J-001', property_address: '12 Synthetic Street, Frankston, VIC, 3199', owner_name: 'Sam Owner' });
  assert.equal(record.signerDefaults.technician, '', 'An account business display name is not an electrician');
  assert.equal(record.initialAttestation, undefined); assert.deepEqual(record.signatures, []);
  const view = await h.service.piesaPresentation(owner, record);
  assert.deepEqual(view.prefillAnswers, {});
  assert.deepEqual(view.businessContactSuggestion, { name: 'Example Electrical', phone: '0399990001' });
  assert.ok(view.missing.some(item => item.key === 'initial_rec_number'));
  assert.equal(h.sql.prepare('SELECT actor_uid FROM trade_veu_electrical_assessments').get().actor_uid, owner.actorUid);
});

test('existing attached drafts offer blank defaults without writing, changing scopes or overwriting entered answers', async t => {
  const h = fixture(t), first = await h.start();
  const saved = await h.service.savePiesaAnswers(owner, first.id, first.revision, { property_address: 'Manual inspection address', life_support: false }, 'existing-draft');
  const before = h.sql.prepare('SELECT * FROM trade_veu_electrical_assessments').get();
  const view = await h.service.piesaPresentation(owner, saved);
  assert.deepEqual(view.answers, saved.answers);
  assert.deepEqual(view.prefillAnswers, { job_reference: 'J-001', owner_name: 'Sam Owner' });
  assert.equal(view.signingScopes.before, activity.activitySigningScope(saved, 'before'));
  assert.equal(view.signingScopes.after, activity.activitySigningScope(saved, 'after'));
  assert.deepEqual(h.sql.prepare('SELECT * FROM trade_veu_electrical_assessments').get(), before);
  assert.deepEqual(await h.start(), saved, 'Opening an existing record is idempotent');
  const persisted = await h.service.savePiesaAnswers(owner, saved.id, saved.revision, { ...view.answers, ...view.prefillAnswers }, 'accept-known-details');
  assert.equal(persisted.answers.property_address, 'Manual inspection address'); assert.equal(persisted.answers.life_support, false);
  assert.equal(persisted.answers.job_reference, 'J-001'); assert.equal(persisted.answers.owner_name, 'Sam Owner');
});

test('electrician defaults belong to the current named worker with supported current credentials, not the job assignee', async t => {
  const h = fixture(t); electricianProfile(h); electricianProfile(h, 'worker', 'SYNTHETIC-ASSIGNED');
  const record = await h.start();
  assert.equal(record.answers.initial_electrician_name, 'Casey Current'); assert.equal(record.answers.initial_electrician_licence, 'SYNTHETIC-LICENCE');
  assert.equal(record.signerDefaults.technician, 'Casey Current');
  const saved = await h.service.savePiesaAnswers(owner, record.id, record.revision, { initial_electrician_name: 'Manual Electrician' }, 'manual-worker');
  const view = await h.service.piesaPresentation(worker, saved);
  assert.equal(view.prefillAnswers.initial_electrician_name, undefined);
  assert.equal(view.prefillAnswers.initial_electrician_licence, undefined, 'Another worker licence cannot be paired with a manual electrician name');
  assert.equal(view.signerDefaults.technician, 'Manual Electrician');
  assert.equal(view.prefillAnswers.rectification_electrician_name, undefined);
  const otherLicence = await h.service.savePiesaAnswers(owner, saved.id, saved.revision, { initial_electrician_licence: 'MANUAL-OTHER-LICENCE' }, 'manual-licence');
  const otherLicenceView = await h.service.piesaPresentation(owner, otherLicence);
  assert.equal(otherLicenceView.prefillAnswers.initial_electrician_name, undefined); assert.equal(otherLicenceView.signerDefaults.technician, '');
});

for (const [reason, change] of [
  ['expired licence', "UPDATE trade_team_member_credentials SET expires_at='2020-01-01'"],
  ['suspended licence', "UPDATE trade_team_member_credentials SET status='suspended'"],
  ['different state', "UPDATE trade_team_member_credentials SET jurisdiction='NSW'"],
  ['unsupported credential type', "UPDATE trade_team_member_credentials SET credential_type='training'"],
  ['missing electrician gate', "UPDATE trade_team_member_credentials SET rental_gate=''"],
  ['missing current expiry', "UPDATE trade_team_member_credentials SET expires_at=''"],
  ['expired evidence', "UPDATE trade_team_member_files SET expires_at='2020-01-01'"],
  ['inactive evidence', "UPDATE trade_team_member_files SET status='deleted'"],
  ['foreign evidence owner', "UPDATE trade_team_member_files SET owner_uid='foreign'"],
  ['another worker evidence', "UPDATE trade_team_member_files SET team_member_id='worker'"],
  ['missing individual name', "UPDATE trade_team_members SET last_name='' WHERE id='owner-member'"],
]) test(`electrician defaults do not infer authority from ${reason}`, async t => {
  const h = fixture(t); electricianProfile(h); h.sql.exec(change);
  const record = await h.start();
  const knownName = reason === 'missing individual name' ? undefined : 'Casey Current';
  assert.equal(record.answers.initial_electrician_name, knownName); assert.equal(record.answers.initial_electrician_licence, undefined);
  assert.equal(record.signerDefaults.technician, knownName || '');
  assert.ok(form.veuElectricalCompletion(record).missing.some(item => item.key === 'initial_electrician_licence'));
});

test('a known person can fill their editable name while missing licence remains required, and actor binding is exact', async t => {
  const h = fixture(t);
  h.sql.exec("UPDATE trade_team_members SET first_name='Casey',last_name='Current' WHERE id='owner-member'");
  const record = await h.start(); assert.equal(record.answers.initial_electrician_name, 'Casey Current');
  assert.equal(record.answers.initial_electrician_licence, undefined);
  const other = { ...owner, memberId: 'worker' };
  electricianProfile(h, 'worker');
  const saved = await h.service.savePiesaAnswers(owner, record.id, record.revision, {}, 'blank-old-identity');
  const view = await h.service.piesaPresentation(other, saved);
  assert.equal(view.prefillAnswers.initial_electrician_name, undefined); assert.equal(view.prefillAnswers.initial_electrician_licence, undefined);
});

test('read-only access sees saved answers without editable profile defaults or contact suggestions', async t => {
  const h = fixture(t), record = await h.start();
  const saved = await h.service.savePiesaAnswers(owner, record.id, record.revision, {}, 'empty-old-record');
  const view = await h.service.piesaPresentation({ ...owner, canManageFieldEvidence: false }, saved);
  assert.deepEqual(view.answers, {}); assert.deepEqual(view.prefillAnswers, {}); assert.equal(view.businessContactSuggestion, undefined);
  assert.deepEqual(view.signerDefaults, saved.signerDefaults);
});

test('access revocation while reading defaults rejects the view rather than returning stale private details', async t => {
  const h = fixture(t), record = await h.start(); let revoked = false;
  h.hook(query => {
    if (!revoked && query.includes('SELECT member.first_name,member.last_name,credential.credential_number')) {
      revoked = true; h.sql.exec("UPDATE trade_accounts SET account_status='suspended'");
    }
  });
  await assert.rejects(h.service.piesaPresentation(owner, record), error => error.code === 'PIESA_ACCESS_REQUIRED');
  assert.equal(revoked, true);
});

for (const [reason, change] of [
  ['private platform customer', "UPDATE trade_crm_job_details SET customer_source='platform_private'"],
  ['opportunity', "UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job'"],
  ['inactive customer', "UPDATE trade_crm_customers SET record_status='archived'"],
  ['foreign customer owner', "UPDATE trade_crm_customers SET firebase_uid='foreign'"],
]) test(`job defaults withhold customer identity/address for ${reason}`, async t => {
  const h = fixture(t); h.sql.exec(change); const record = await h.start();
  assert.deepEqual(record.answers, { job_reference: 'J-001' }); assert.equal(record.signerDefaults.customer, '');
});

for (const [reason, change] of [
  ['a different customer site', "UPDATE trade_crm_service_sites SET customer_id='other'"],
  ['a foreign business site', "UPDATE trade_crm_service_sites SET firebase_uid='foreign'"],
  ['an archived site', "UPDATE trade_crm_service_sites SET record_status='archived'"],
]) test(`job defaults do not use ${reason}`, async t => {
  const h = fixture(t), initial = await h.start();
  const saved = await h.service.savePiesaAnswers(owner, initial.id, initial.revision, { owner_name: 'Sam Owner' }, 'existing-site-defaults');
  h.sql.exec(change); const record = await h.start();
  assert.equal(record.answers.property_address, undefined); assert.equal(record.answers.owner_name, 'Sam Owner');
  assert.equal(record.id, saved.id);
  const view = await h.service.piesaPresentation(owner, record);
  assert.equal(view.prefillAnswers.property_address, undefined);
});

test('attested, signed and completed answers/scopes never gain new profile defaults', async t => {
  const h = fixture(t), attested = await h.attested();
  const signed = await h.service.signPiesaDeclaration(owner, attested.id, attested.revision, { declarationKey: 'property_owner',
    signerName: attested.answers.owner_name, strokes: ink, accepted: true, scopeSha256: activity.activitySigningScope(attested, 'after') }, 'prefill-owner-signature');
  for (const record of [attested, signed]) {
    const view = await h.service.piesaPresentation(owner, record);
    assert.deepEqual(view.prefillAnswers, {}); assert.equal(view.businessContactSuggestion, undefined);
    assert.deepEqual(view.answers, record.answers); assert.deepEqual(view.signerDefaults, record.signerDefaults);
  }
  const done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'prefill-complete');
  const before = h.sql.prepare('SELECT * FROM trade_veu_electrical_assessments').get();
  const view = await h.service.piesaPresentation(owner, done);
  assert.deepEqual(view.prefillAnswers, {}); assert.equal(view.businessContactSuggestion, undefined);
  assert.deepEqual(view.answers, done.answers); assert.deepEqual(h.sql.prepare('SELECT * FROM trade_veu_electrical_assessments').get(), before);
});

test('PIESA completion reconciles saved job progress and exact completion retries repair a pending projection', async t => {
  const h = fixture(t), signed = await h.signed();
  assert.equal(h.progressCalls.length, 0, 'Answering and signing must not trigger job completion');
  h.pendingProgress(true); h.loseBatch();
  const complete = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete-progress');
  assert.equal(complete.status, 'complete'); assert.equal(h.progressCalls.length, 1);
  assert.deepEqual(h.progressCalls[0], { access: owner, workOrderId: 'job', options: { afterSave: true } });
  h.pendingProgress(false);
  const retried = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete-progress');
  assert.equal(retried.revision, complete.revision); assert.equal(h.progressCalls.length, 2);
  assert.deepEqual(h.progressCalls[1], h.progressCalls[0]);
  assert.equal(h.renders.length, 1); assert.equal(h.sends.length, 2);
});

test('canonical save uses strict answers, CAS and exact applied request identity', async t => {
  const h = fixture(t), initial = await h.start(); h.loseBatch();
  const saved = await h.service.savePiesaAnswers(owner, initial.id, 1, { property_address: '12 Test Street' }, 'stable-save');
  assert.equal(saved.revision, 2); assert.equal((await h.service.savePiesaAnswers(owner, initial.id, 1, { property_address: '12 Test Street' }, 'stable-save')).revision, 2);
  const hash = h.service.piesaMutationRequestHash(initial, 1, 'save', { property_address: '12 Test Street' });
  assert.equal((await h.service.readPiesaMutationReceipt(owner, initial.id, 'stable-save', { operation: 'save', baseRevision: 1, requestSha256: hash })).resultRevision, 2);
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 1, { property_address: 'Other' }, 'stable-save'), /request.*changed/);
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 1, {}, 'stale-save'), /changed/);
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 2, { unknown: 'x' }, 'bad'), /INVALID_ACTIVITY_FIELD/);
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 2, { mains_identified: 'yes' }, 'bad'), /INVALID_ACTIVITY_ANSWER/);
  await assert.rejects(h.service.readPiesaMutationReceipt(worker, initial.id, 'stable-save', { operation: 'save', baseRevision: 1 }), /request.*changed/);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_mutations').get().n, 1);
});

for (const lostAck of [false, true]) test(`answer save uses six database trips and one atomic write with lost acknowledgement ${lostAck}`, async t => {
  const h = fixture(t), initial = await h.start(), answers = { property_address: '12 Test Street' };
  h.roundTrips.length = 0;
  if (lostAck) h.loseBatch();
  const saved = await h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'measured-save');
  assert.equal(saved.revision, 2);
  assert.deepEqual(h.roundTrips.map(item => item.kind), ['read', 'read', 'read', 'read', 'batch', 'read']);
  assert.equal(h.progressCalls.length, 0);
  const expected = { operation: 'save', baseRevision: 1, requestSha256: h.service.piesaMutationRequestHash(initial, 1, 'save', answers) };
  for (const key of ['measured-save', 'missing-request']) {
    h.roundTrips.length = 0;
    const receipt = await h.service.readPiesaMutationReceipt(owner, initial.id, key, expected);
    assert.equal(receipt?.resultRevision ?? null, key === 'measured-save' ? 2 : null);
    assert.equal(h.roundTrips.length, 1);
    assert.equal(h.roundTrips[0].kind, 'read');
  }
  h.roundTrips.length = 0;
  assert.deepEqual(await h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'measured-save'), saved);
  assert.deepEqual(h.roundTrips.map(item => item.kind), ['read', 'read', 'read']);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_mutations').get().n, 1);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_versions').get().n, 2);
});

for (const [name, change] of [
  ['business suspended', "UPDATE trade_accounts SET account_status='suspended'"],
  ['authoritative review revoked', "UPDATE trade_account_verification_reviews SET decision='rejected'"],
  ['worker removed', "UPDATE trade_team_members SET status='inactive' WHERE id='worker'"],
  ['view revoked', "UPDATE trade_team_members SET can_view_field_evidence=0 WHERE id='worker'"],
  ['write revoked', "UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='worker'"],
  ['job reassigned', "UPDATE trade_team_members SET job_scope='own' WHERE id='worker'; UPDATE trade_work_orders SET assignee_member_id='elsewhere'"],
  ['crew restricted', "INSERT INTO trade_crew_members VALUES('owner','worker','other-crew'); UPDATE trade_work_orders SET assignee_member_id='elsewhere'"],
  ['job archived', "UPDATE trade_work_orders SET record_status='archived'"],
]) test(`exact receipt uses fresh authority in its record snapshot: ${name}`, async t => {
  const h = fixture(t), initial = await h.start(), answers = { property_address: '12 Test Street' };
  await h.service.savePiesaAnswers(worker, initial.id, 1, answers, 'worker-save');
  let revoked = false;
  h.hook(query => {
    if (!revoked && query.includes('AS current_write_access')) { revoked = true; h.sql.exec(change); }
  });
  await assert.rejects(h.service.readPiesaMutationReceipt(worker, initial.id, 'worker-save', { operation: 'save', baseRevision: 1 }), error => error.status === 403 && error.code === 'PIESA_ACCESS_REQUIRED');
  assert.equal(revoked, true);
  await assert.rejects(h.service.savePiesaAnswers(worker, initial.id, 1, answers, 'worker-save'), error => error.status === 403);
  assert.equal(h.sql.prepare('SELECT revision FROM trade_veu_electrical_assessments').get().revision, 2);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_mutations').get().n, 1);
});

test('field-session revocation blocks the exact receipt without trusting stale caller access', async t => {
  const h = fixture(t), initial = await h.start();
  const access = { ...worker, actorUid: 'field-member:worker', fieldSessionId: 'field-session' };
  h.sql.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('field-session', 'owner', 'worker', 'active', '2099-01-01');
  await h.service.savePiesaAnswers(access, initial.id, 1, { property_address: '12 Test Street' }, 'session-save');
  h.sql.exec("UPDATE trade_field_sessions SET status='revoked'");
  await assert.rejects(h.service.readPiesaMutationReceipt(access, initial.id, 'session-save', { operation: 'save', baseRevision: 1 }), error => error.status === 403);
});

test('receipt snapshot detects newer source, mismatched request and actor, and preserves missing-business isolation', async t => {
  const h = fixture(t), initial = await h.start(), answers = { property_address: '12 Test Street' };
  const saved = await h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'saved-answer');
  const expected = { operation: 'save', baseRevision: 1, requestSha256: h.service.piesaMutationRequestHash(initial, 1, 'save', answers) };
  for (const wrong of [{ operation: 'complete' }, { baseRevision: 2 }, { requestSha256: '0'.repeat(64) }]) {
    await assert.rejects(h.service.readPiesaMutationReceipt(owner, initial.id, 'saved-answer', { ...expected, ...wrong }), error => error.code === 'PIESA_REQUEST_CONFLICT');
  }
  await assert.rejects(h.service.readPiesaMutationReceipt(worker, initial.id, 'saved-answer', expected), error => error.code === 'PIESA_REQUEST_CONFLICT');
  await assert.rejects(h.service.readPiesaMutationReceipt({ ...owner, ownerUid: 'foreign', actorUid: 'foreign' }, initial.id, 'saved-answer', expected), error => error.status === 404);
  await h.service.savePiesaAnswers(owner, initial.id, saved.revision, { ...answers, inspection_date: '2026-10-08' }, 'later-answer');
  await assert.rejects(h.service.readPiesaMutationReceipt(owner, initial.id, 'saved-answer', expected), error => error.code === 'PIESA_REQUEST_CONFLICT');
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'saved-answer'), error => error.code === 'PIESA_REQUEST_CONFLICT');
  assert.equal(h.sql.prepare('SELECT revision FROM trade_veu_electrical_assessments').get().revision, 3);
});

for (const stage of ['imported', 'cancelled', 'completed']) test(`closed job ${stage} permits exact receipt recovery but never another save`, async t => {
  const h = fixture(t), initial = await h.start(), answers = { property_address: '12 Test Street' };
  const saved = await h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'before-closure');
  h.sql.prepare('UPDATE trade_work_orders SET stage=? WHERE id=?').run(stage, 'job');
  assert.equal((await h.service.readPiesaMutationReceipt(owner, initial.id, 'before-closure', { operation: 'save', baseRevision: 1 })).resultRevision, 2);
  assert.deepEqual(await h.service.savePiesaAnswers(owner, initial.id, 1, answers, 'before-closure'), saved);
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 2, { ...answers, inspection_date: '2026-10-08' }, 'after-closure'), error => error.code === 'PIESA_JOB_LOCKED');
  assert.equal(h.sql.prepare('SELECT revision FROM trade_veu_electrical_assessments').get().revision, 2);
});

for (const [name, change] of [
  ['business revocation', "UPDATE trade_accounts SET account_status='suspended'"],
  ['worker permission revocation', 'UPDATE trade_team_members SET can_manage_field_evidence=0'],
  ['current assignment restriction', "UPDATE trade_team_members SET job_scope='own'; UPDATE trade_work_orders SET assignee_member_id='elsewhere'"],
]) test(`${name} between preparation and update prevents any save`, async t => {
  const h = fixture(t), initial = await h.start(); let invoked = false;
  h.hook(query => { if (!invoked && query.startsWith('UPDATE trade_veu_electrical_assessments')) { invoked = true; h.sql.exec(change); } });
  await assert.rejects(h.service.savePiesaAnswers(worker, initial.id, 1, { property_address: 'Must not save' }, 'race'));
  assert.equal(invoked, true); assert.equal(h.sql.prepare('SELECT revision FROM trade_veu_electrical_assessments').get().revision, 1);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_mutations').get().n, 0);
});

test('initial declaration requires its native attestation and repeated answer edits invalidate it', async t => {
  const h = fixture(t), initial = await h.start();
  await assert.rejects(h.service.savePiesaAnswers(owner, initial.id, 1, { initial_correct: true }, 'autoagree'), /own control/);
  const signed = await h.attested({ ceiling_appliances: true, '$repeat.appliances': 2 });
  assert.equal(signed.initialAttestation.actorUid, owner.actorUid); assert.equal(signed.initialAttestation.scopeSha256, activity.activitySigningScope(signed, 'before'));
  await assert.rejects(h.service.attestPiesaInitial(worker,signed.id,signed.revision,activity.activitySigningScope(signed,'before'),true,'replace-attesting-actor'),/already been recorded/);
  const changed = await h.service.savePiesaAnswers(owner, signed.id, signed.revision, { ...signed.answers, 'appliance_location[1]': 'Changed second location' }, 'repeat-edit');
  assert.equal(changed.answers.initial_correct, false); assert.equal(changed.initialAttestation, undefined);
  await assert.rejects(h.service.attestPiesaInitial(owner, changed.id, changed.revision, activity.activitySigningScope(signed, 'before'), true, 'stale-sign'), /current initial/);
});

test('missing and mismatched actual signature blocks completion; drawn signature locks scope', async t => {
  const h = fixture(t), record = await h.attested();
  await assert.rejects(h.service.completePiesaRecord(owner, record.id, record.revision, 'no-sig'), /required assessment/);
  const input = { declarationKey: 'property_owner', signerName: record.answers.owner_name, strokes: ink, accepted: true, scopeSha256: activity.activitySigningScope(record, 'after') };
  await assert.rejects(h.service.signPiesaDeclaration(owner, record.id, record.revision, { ...input, strokes: [] }, 'fake-sig'), /ACTIVITY_SIGNATURE_REQUIRED/);
  await assert.rejects(h.service.signPiesaDeclaration(owner, record.id, record.revision, { ...input, signerName: 'Other Person' }, 'wrong-sig'), /actual signer/);
  const signed = await h.service.signPiesaDeclaration(owner, record.id, record.revision, input, 'real-sig');
  await assert.rejects(h.service.savePiesaAnswers(owner, signed.id, signed.revision, { ...signed.answers, owner_name: 'Other' }, 'edit-signed'), /signed/);
  assert.equal(h.objects.size, 0); assert.equal(h.sends.length, 0);
});

test('completion persists the exact frozen PDF and sends both role envelopes once', async t => {
  const h = fixture(t), signed = await h.signed(), completed = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete');
  assert.equal(completed.status, 'complete'); assert.deepEqual(h.renders, [completed]); assert.equal(h.sends.length, 2);
  assert.deepEqual(h.sends.map(item => item.recipient).sort(), ['customer@example.com', 'office@example.com']);
  const pdf = await h.service.readPiesaPdf(owner, completed.id);
  for (const message of h.sends) assert.deepEqual(Buffer.from(message.attachments[0].content, 'base64'), Buffer.from(pdf.bytes));
  const publicRecord = await h.service.piesaPresentation(owner, completed);
  assert.deepEqual(publicRecord.signerFields, form.VEU_ELECTRICAL_SIGNER_FIELDS);
  assert.equal('ownerUid' in publicRecord, false); assert.match(publicRecord.reportUrl, /view=pdf/); assert.ok(publicRecord.delivery.every(item => item.status === 'accepted'));
  await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete'); await h.service.retryPiesaDelivery(owner, signed.id);
  assert.equal(h.renders.length, 1); assert.equal(h.sends.length, 2);
  assert.throws(() => h.sql.exec("UPDATE trade_veu_electrical_assessments SET actor_uid='other'"), /PIESA_IMMUTABLE/);
  assert.throws(() => h.sql.exec('DELETE FROM trade_veu_electrical_versions'), /PIESA_RETAINED/);
  assert.throws(() => h.sql.exec("UPDATE trade_veu_electrical_mutations SET request_sha256=printf('%064d',0)"), /PIESA_RETAINED/);
});

test('automatic job closure after assessment completion preserves its Files report and both email copies', async t => {
  const h = fixture(t), signed = await h.signed(); h.completesJob(true);
  const completed = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete-and-close-job');
  assert.equal(h.sql.prepare("SELECT stage FROM trade_work_orders WHERE id='job'").get().stage, 'completed');
  assert.equal(completed.status, 'complete');
  assert.deepEqual(h.sends.map(message => message.recipient).sort(), ['customer@example.com', 'office@example.com']);
  const listed = await h.service.listPiesaRecords(owner, 'job');
  assert.equal(listed.length, 1); assert.equal(listed[0].id, completed.id);
  assert.match(listed[0].reportUrl, /view=pdf/); assert.ok(listed[0].delivery.every(row => row.status === 'accepted'));
  const pdf = await h.service.readPiesaPdf(owner, completed.id);
  for (const message of h.sends) assert.deepEqual(Buffer.from(message.attachments[0].content, 'base64'), Buffer.from(pdf.bytes));
  await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete-and-close-job');
  assert.equal(h.renders.length, 1); assert.equal(h.sends.length, 2, 'Closed-job recovery must not send duplicate PDFs');
});

test('missing customer address keeps completed PDF and business receipt, then retries only customer', async t => {
  const h = fixture(t), signed = await h.signed(); h.sql.exec("UPDATE trade_crm_customers SET email=''");
  const done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete');
  assert.equal(done.status, 'complete'); assert.equal(h.sends.length, 1);
  let result = await h.service.piesaPresentation(owner, done); assert.equal(result.delivery.find(row => row.role === 'customer').status, 'blocked');
  assert.ok((await h.service.readPiesaPdf(owner, done.id)).bytes.length);
  h.sql.exec("UPDATE trade_crm_customers SET email='fixed@example.com'"); result = await h.service.retryPiesaDelivery(owner, done.id);
  assert.equal(h.sends.length, 2); assert.equal(h.sends[1].recipient, 'fixed@example.com'); assert.ok(result.delivery.every(row => row.status === 'accepted'));
});

test('definite provider failure does not undo completion and accepted counterpart is never resent', async t => {
  const h = fixture(t), signed = await h.signed();
  h.mail((message, journal) => { journal(message.idempotencyKey, 'failed'); throw new reminder.ReminderProviderDeliveryError('definite_failure', 'SYNTHETIC_REJECTED'); });
  const done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete');
  assert.equal(done.status, 'complete'); assert.ok((await h.service.piesaPresentation(owner, done)).delivery.every(row => row.status === 'failed'));
  h.mail(null); await h.service.retryPiesaDelivery(owner, done.id); await h.service.retryPiesaDelivery(owner, done.id);
  assert.equal(h.sends.length, 2); assert.equal(h.renders.length, 1);
});

test('uncertain provider result is retained for reconciliation and cannot resend on retry', async t => {
  const h = fixture(t), signed = await h.signed();
  h.mail((message, journal) => { journal(message.idempotencyKey, 'uncertain'); throw new reminder.ReminderProviderDeliveryError('indeterminate', 'SYNTHETIC_TIMEOUT'); });
  const done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete'); h.mail(null);
  const result = await h.service.retryPiesaDelivery(owner, done.id);
  assert.ok(result.delivery.every(row => row.status === 'reconciliation_required')); assert.equal(h.sends.length, 0); assert.equal(done.status, 'complete');
});

test('lost provider acknowledgement reconciles accepted durable proof without another send', async t => {
  const h = fixture(t), signed = await h.signed();
  h.mail((message, journal) => { journal(message.idempotencyKey, 'accepted', 'accepted-before-network-loss'); throw new Error('SYNTHETIC_LOST_ACK'); });
  const done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete'); h.mail(null);
  const result = await h.service.retryPiesaDelivery(owner, done.id);
  assert.ok(result.delivery.every(row => row.status === 'accepted')); assert.equal(h.sends.length, 0);
});

test('saved PDF corruption cannot be downloaded or reattached', async t => {
  const h = fixture(t), signed = await h.signed(), done = await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete');
  const key = [...h.objects.keys()][0]; h.objects.set(key, new TextEncoder().encode('%PDF-corrupt'));
  await assert.rejects(h.service.readPiesaPdf(owner, done.id), /integrity/);
  await assert.rejects(h.service.retryPiesaDelivery(owner, done.id), /integrity/); assert.equal(h.sends.length, 2);
});

test('unrectified mandatory defect cannot be signed or published as a no-rectification clearance', async t => {
  const h = fixture(t), record = await h.attested({ clear_conductive_conduit: false });
  await assert.rejects(h.service.signPiesaDeclaration(owner,record.id,record.revision,{declarationKey:'property_owner',signerName:record.answers.owner_name,strokes:ink,accepted:true,scopeSha256:activity.activitySigningScope(record,'after')},'invalid-final-sign'),/resolve its outcome/);
  await assert.rejects(h.service.completePiesaRecord(owner, record.id, record.revision, 'wrong-outcome'), /conflicts/);
  assert.equal(h.renders.length, 0); assert.equal(h.sends.length, 0); assert.equal((await h.service.readPiesaRecord(owner, record.id)).status, 'draft');
});

test('real official seven-page renderer survives canonical completion, storage and both attachments',async t=>{
  const h=fixture(t,true),signed=await h.signed(),completed=await h.service.completePiesaRecord(owner,signed.id,signed.revision,'real-complete');
  const file=await h.service.readPiesaPdf(owner,completed.id),pdf=await PDFDocument.load(file.bytes);
  assert.ok(pdf.getPageCount()>=8);assert.match(pdf.getSubject(),/no_rectification/);
  assert.deepEqual(h.renders[0],completed);
  for(const message of h.sends)assert.deepEqual(Buffer.from(message.attachments[0].content,'base64'),Buffer.from(file.bytes));
  assert.equal(h.sends.length,2);assert.equal(h.objects.size,1);
});

test('incomplete initial questions or absent attestation cannot be locked by final signature',async t=>{
  const h=fixture(t),record=await h.answered();
  const input={declarationKey:'property_owner',signerName:record.answers.owner_name,strokes:ink,accepted:true,scopeSha256:activity.activitySigningScope(record,'after')};
  await assert.rejects(h.service.signPiesaDeclaration(owner,record.id,record.revision,input,'premature'),/initial declaration/);
  const answers={...record.answers};delete answers.property_address;
  const incomplete=await h.service.savePiesaAnswers(owner,record.id,record.revision,answers,'remove-address');
  await assert.rejects(h.service.signPiesaDeclaration(owner,incomplete.id,incomplete.revision,{...input,scopeSha256:activity.activitySigningScope(incomplete,'after')},'incomplete'),/assessment answers/);
  assert.equal((await h.service.readPiesaRecord(owner,record.id)).signatures.length,0);
});

test('rectification final signatures remain separate and both can be recorded in sequence',async t=>{
  const h=fixture(t),record=await h.signed({assessment_outcome:'rectification_required',work_rcd:true,rcd_present:false,electrical_works_performed:true});
  assert.deepEqual(record.signatures.map(item=>item.declarationKey),['rectification_electrician','property_owner']);
  assert.equal(form.veuElectricalCompletion(record).ready,true);
});

test('life-support document attaches only to visible required field and exact upload retry is idempotent',async t=>{
  const h=fixture(t),record=await h.answered({life_support:true,life_support_consent:true});
  const file=new File(['%PDF-synthetic-written-consent'],'consent.pdf',{type:'application/pdf'});
  const saved=await h.service.uploadPiesaEvidence(owner,record.id,record.revision,'life_support_record',file,'upload-consent');
  assert.equal(saved.evidence.length,1);assert.equal(saved.evidence[0].metadataOrigin,'file_upload');assert.equal(saved.evidence[0].latitude,null);
  const duplicate=await h.service.uploadPiesaEvidence(owner,record.id,record.revision,'life_support_record',file,'upload-consent');
  assert.equal(duplicate.revision,saved.revision);assert.equal(h.objects.size,1);
  assert.equal(new TextDecoder().decode((await h.service.readPiesaEvidence(owner,saved.id,saved.evidence[0].id)).bytes),'%PDF-synthetic-written-consent');
  await assert.rejects(h.service.uploadPiesaEvidence(owner,saved.id,saved.revision,'property_address',file,'wrong-field'),/required PDF/);
});
