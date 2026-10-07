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
  sql.exec(read('../drizzle/0256_trade_veu_electrical_assessments.sql').replaceAll('--> statement-breakpoint', ''));
  let hook = () => {}, lostBatch = false, mailFailure = null;
  const db = { prepare(query) { let values = []; const stmt = { bind(...args) { values = args; return stmt; },
    async first() { hook(query); return sql.prepare(query).get(...values) || null; },
    async all() { hook(query); return { results: sql.prepare(query).all(...values), success: true }; },
    async run() { hook(query); return { meta: { changes: Number(sql.prepare(query).run(...values).changes) }, success: true }; } }; return stmt; },
    async batch(statements) { sql.exec('BEGIN'); let result; try { result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); } catch (error) { sql.exec('ROLLBACK'); throw error; }
      if (lostBatch) { lostBatch = false; throw new Error('SYNTHETIC_LOST_COMMIT_ACK'); } return result; } };
  const objects = new Map(), renders = [], sends = [];
  const bucket = { async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async get(key) { const bytes = objects.get(key); return bytes ? { async arrayBuffer() { return bytes.slice().buffer; } } : null; }, async delete(key) { objects.delete(key); } };
  const journal = (key, status, id = '') => sql.prepare('INSERT OR REPLACE INTO trade_email_submissions VALUES(?,?,?,?,?)').run('owner', key, status, 'synthetic', id);
  const service = compile('../src/lib/trade-veu-electrical-assessment-server.ts', {
    'cloudflare:workers': { env: { EVIDENCE: bucket } }, '../../db': { getD1: () => db }, './trade-job-collaboration': membership,
    './trade-account-predicates': predicates, './trade-activity-forms': activity, './trade-activity-form-flow': flow,
    './veu-electrical-safety-form': form, './veu-electrical-assessment': types, './trade-veu-electrical-schema-guards': guards,
    './service-reminder-delivery': reminder,
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
  return { sql, db, service, objects, renders, sends, journal, start, answered, attested, signed,
    hook(value) { hook = value; }, loseBatch() { lostBatch = true; }, mail(value) { mailFailure = value; } };
}

test('standalone start is job scoped, idempotent and has no compliance intent', async t => {
  const h = fixture(t), first = await h.start(), second = await h.start();
  assert.equal(first.id, second.id); assert.equal(first.status, 'draft'); assert.equal(first.revision, 1);
  assert.equal('intentId' in first, false); assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_veu_electrical_versions').get().n, 1);
  await assert.rejects(h.service.startPiesaRecord(owner, 'foreign-job'), /access/);
  await assert.rejects(h.service.readPiesaRecord({ ...owner, ownerUid: 'foreign', actorUid: 'foreign' }, first.id), /not found/);
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
  assert.equal('ownerUid' in publicRecord, false); assert.match(publicRecord.reportUrl, /view=pdf/); assert.ok(publicRecord.delivery.every(item => item.status === 'accepted'));
  await h.service.completePiesaRecord(owner, signed.id, signed.revision, 'complete'); await h.service.retryPiesaDelivery(owner, signed.id);
  assert.equal(h.renders.length, 1); assert.equal(h.sends.length, 2);
  assert.throws(() => h.sql.exec("UPDATE trade_veu_electrical_assessments SET actor_uid='other'"), /PIESA_IMMUTABLE/);
  assert.throws(() => h.sql.exec('DELETE FROM trade_veu_electrical_versions'), /PIESA_RETAINED/);
  assert.throws(() => h.sql.exec("UPDATE trade_veu_electrical_mutations SET request_sha256=printf('%064d',0)"), /PIESA_RETAINED/);
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
