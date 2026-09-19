import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const modules = new Map();
function load(relative) {
  const file = path.resolve(relative); if (modules.has(file)) return modules.get(file);
  const record = { exports: {} }; modules.set(file, record.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file.replace(/\.mjs$/, '.js') }).outputText;
  new Function('require', 'module', 'exports', code)((name) => name.startsWith('node:') ? nodeRequire(name) : load(path.resolve(path.dirname(file), /\.(?:ts|mjs)$/.test(name) ? name : `${name}.ts`)), record, record.exports);
  return record.exports;
}
const onboarding = load('src/lib/creditex-onboarding-server.ts');
const training = load('src/lib/trade-training-server.ts');
const { TRAINING_MODULES } = load('src/data/creditex-training-curriculum.ts');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { assert.ok(values.length <= 100, 'D1 statement must stay within 100 bound parameters'); return new Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,abn TEXT,business_name TEXT,capabilities TEXT,service_states TEXT,address_state TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,status TEXT,display_name TEXT,member_uid TEXT,capabilities TEXT);
    CREATE TABLE trade_team_member_files(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT,category TEXT);
    INSERT INTO trade_accounts VALUES ('owner','53004085616','Test Pty Ltd','["heating-cooling","insulation","hot-water"]','["VIC"]','VIC');
    INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('owner-member','owner','active','Owner','owner','[]'),('installer-member','owner','active','Installer','installer','["heating-cooling","insulation","hot-water"]');`);
  sql.exec(fs.readFileSync('drizzle/0116_trade_crm_write_guard.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0176_creditex_onboarding_training.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0177_autonomous_activity_training.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0178_autonomous_business_onboarding.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0179_training_questionnaires.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0180_team_member_service_states.sql', 'utf8'));
  const db = { prepare: query => new Statement(sql, query), batch: async statements => {
    sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db };
}
function trainingRoute(f, access = {}) {
  const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', displayName: 'Owner', isOwner: true, canManageTeam: true, ...access };
  const dependencies = {
    '../../../../db': { getD1: () => f.db },
    '@/lib/admin-server': { sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin },
    '@/lib/bounded-json-request': { readBoundedJsonRequest: request => request.json() },
    '@/lib/creditex-onboarding-api': { creditexJson: (body, status = 200) => Response.json(body, { status }), creditexApiError: error => Response.json({ ok: false, code: error.code || 'FAILED' }, { status: error.status || 503 }) },
    '@/lib/creditex-onboarding-server': onboarding,
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => actor },
    '@/lib/trade-training-server': training,
    '@/lib/training-questionnaire-store': load('src/lib/training-questionnaire-store.ts'),
  };
  const file = 'src/app/api/trade-training/route.ts';
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(dependencies[name], name); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0,10);
const today = () => new Date().toISOString().slice(0,10);
const yearLater = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0,10);
function application() {
  const director = { name: 'Director Test', address: '1 Business St, Melbourne VIC 3000', email: 'director@testbusiness.example', mobile: '0400000000', idDocumentId: 'director-id', selfieDocumentId: 'director-selfie' };
  return { legalName: 'Test Pty Ltd', acn: '004085616', hasWebsite: true, website: 'https://testbusiness.example', address: director.address, insuranceDocumentId: 'insurance', insuranceExpiresOn: yearLater(), priorProposalDocumentId: '', doesNswWork: false, contractorLicenceDocumentId: '', director, directorIsGuarantor: true, guarantor: { name: '',address:'',email:'',mobile:'',idDocumentId:'',selfieDocumentId:'',position:'' }, witness: { name: 'Witness Test',position:'Manager',email:'witness@testbusiness.example' }, acceptedPrivacy: true, agreementDocumentId: 'signed-agreement', acceptedCompliance: true };
}
function seedDocuments(sql) {
  for (const [id, kind] of [['director-id','director_id'],['director-selfie','director_selfie'],['insurance','insurance'],['signed-agreement','partnership_agreement']]) sql.prepare('INSERT INTO creditex_onboarding_documents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,'owner',kind,`${id}.pdf`,'application/pdf',10,'a'.repeat(64),id,'owner',new Date().toISOString());
}
async function approveBusiness(f, details = application()) {
  seedDocuments(f.sql);
  if (details.contractorLicenceDocumentId) f.sql.prepare('INSERT INTO creditex_onboarding_documents VALUES (?,?,?,?,?,?,?,?,?,?)').run(details.contractorLicenceDocumentId,'owner','contractor_licence','licence.pdf','application/pdf',10,'b'.repeat(64),'licence','owner',new Date().toISOString());
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,details);
  // This fixture explicitly represents readable private objects. R2 integrity
  // and absence are exercised separately by the onboarding upload route tests.
  const completed = await onboarding.submitCreditexApplication(f.db,'owner','owner',1,async () => {});
  assert.equal(completed.status, 'completed');
}
async function activate(f, moduleId='veu-6') {
  const course = TRAINING_MODULES.find(value => value.id === moduleId);
  const current = f.sql.prepare('SELECT updated_at FROM trade_training_module_reviews WHERE module_id=?').get(moduleId);
  await training.reviewTrainingModule(f.db,'reviewer',{action:'activate_module',moduleId,expectedVersion:course.version,expectedHash:training.getTrainingModuleHash(course),expectedReviewUpdatedAt:current?.updated_at || '',reviewNote:'Reviewed all source requirements and question answers.',sourceReviewedOn:today(),reviewExpiresOn:yearLater(),schemeAuthorityReference:moduleId==='veu-48'?'Verified AP accreditation and direct consumer contract model':''});
  return course;
}
function answerTokens(attempt, course, override = {}) {
  return Object.fromEntries(attempt.questions.map(question => {
    const canonical = course.questions.find(item => item.id === question.id);
    const chosen = override[question.id] || canonical.correctOptionId;
    const text = canonical.options.find(item => item.id === chosen).text;
    return [question.id, question.options.find(option => option.text === text).id];
  }));
}
// Keep the existing bulk-submission compatibility and security regressions tied
// explicitly to attempts opened before guided checking was introduced.
async function startLegacyAttempt(db, input) {
  const attempt = await training.startTrainingAttempt(db, input);
  await db.prepare("UPDATE trade_training_attempts SET course_json='{}' WHERE id=?").bind(attempt.id).run();
  return attempt;
}
async function checkAll(f, actor, attempt, course) {
  const answers = answerTokens(attempt, course);
  for (const question of attempt.questions) {
    const feedback = await training.checkTrainingAnswer(f.db, { ...actor, attemptId: attempt.id, questionId: question.id, answer: answers[question.id] });
    assert.equal(feedback.correct, true);
  }
  return answers;
}
async function pass(f, memberId='owner-member', moduleId='veu-6') {
  const course = TRAINING_MODULES.find(item => item.id === moduleId);
  const actor = {ownerUid:'owner',memberId,actorUid:memberId,moduleId};
  const attempt = await training.startTrainingAttempt(f.db,actor);
  const answers = await checkAll(f, actor, attempt, course);
  return training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers});
}
const booking = {ownerUid:'owner',actorMemberId:'owner-member',assignedMemberId:'installer-member',activityTemplateIds:['veu-6']};

test('submission mirrors conditional Jotform fields and validates company, personal data and consent', () => {
  assert.doesNotThrow(() => onboarding.validateCreditexSubmission(application()));
  for (const altered of [ {...application(),doesNswWork:true}, {...application(),legalName:'Test Sole Trader'}, {...application(),acn:'123456789'}, {...application(),acceptedPrivacy:false}, {...application(),acceptedCompliance:false}, {...application(),agreementDocumentId:''}, {...application(),directorIsGuarantor:false}, {...application(),hasWebsite:true,website:'javascript:alert(1)'}, {...application(),director:{...application().director,email:'director@gmail.com'}} ]) assert.throws(() => onboarding.validateCreditexSubmission(altered), error => error.code==='ONBOARDING_INCOMPLETE');
});
test('business revisions invalidate approval and concurrent saves are rejected with retained audit history', async () => {
  const f = fixture(); await approveBusiness(f);
  assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,true);
  await onboarding.saveCreditexApplication(f.db,'owner','owner',2,application());
  assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false);
  await assert.rejects(onboarding.saveCreditexApplication(f.db,'owner','owner',2,application()), error=>error.code==='REVISION_CONFLICT');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM creditex_onboarding_events').get().n,3);
  assert.equal(f.sql.prepare('SELECT agreement_reference FROM creditex_business_onboarding').get().agreement_reference,'');
});
test('cross-business document reuse and unsigned agreement approval fail closed', async () => {
  const f=fixture(); seedDocuments(f.sql); f.sql.prepare("UPDATE creditex_onboarding_documents SET owner_uid='other' WHERE id='insurance'").run();
  await assert.rejects(onboarding.saveCreditexApplication(f.db,'owner','owner',0,application()),error=>error.code==='DOCUMENT_INVALID');
  f.sql.prepare("UPDATE creditex_onboarding_documents SET owner_uid='owner'").run();
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,{...application(),agreementDocumentId:''});
  await assert.rejects(onboarding.submitCreditexApplication(f.db,'owner','owner',1,async () => {}),error=>error.code==='ONBOARDING_INCOMPLETE');
  // A pre-migration submitted application still cannot acquire a legacy approval
  // without an executed agreement reference, or an autonomous completion receipt.
  f.sql.exec("UPDATE creditex_business_onboarding SET status='submitted'");
  await assert.rejects(onboarding.reviewCreditexApplication(f.db,'owner','reviewer',{expectedRevision:1,status:'approved',reviewNote:'Checked'}),error=>error.code==='SIGNED_AGREEMENT_REQUIRED');
  assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false);
});
test('approval stops when current business identity or insurance changes', async () => {
  const f=fixture(); await approveBusiness(f);
  f.sql.prepare("UPDATE trade_accounts SET abn='51824753556'").run(); assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false);
  f.sql.prepare("UPDATE trade_accounts SET abn='53004085616'").run();
  f.sql.prepare("UPDATE creditex_business_onboarding SET insurance_expires_on='2020-01-01'").run(); assert.equal((await onboarding.getCreditexBusinessStatus(f.db,'owner')).approved,false);
});
test('source-complete courses allow learning while optional governance binds exact version/hash and revision', async () => {
  const f=fixture(); const course=TRAINING_MODULES.find(item=>item.id==='veu-6');
  const attempt = await startLegacyAttempt(f.db,{ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id});
  assert.equal(attempt.questions.length, 25);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_module_reviews').get().n, 0);
  await assert.rejects(training.reviewTrainingModule(f.db,'reviewer',{action:'activate_module',moduleId:course.id,expectedVersion:course.version,expectedHash:'wrong'}),error=>error.code==='TRAINING_VERSION_CHANGED');
  await activate(f);
  await assert.rejects(training.reviewTrainingModule(f.db,'reviewer',{action:'withdraw_module',moduleId:course.id,expectedVersion:course.version,expectedHash:training.getTrainingModuleHash(course),expectedReviewUpdatedAt:'',reviewNote:'Old tab'}),error=>error.code==='TRAINING_REVIEW_CONFLICT');
});
test('attempt projection conceals answer keys, persists opaque options, rejects cross-attempt/person/question tokens and returns its saved result on replay', async () => {
  const f=fixture(); const course=await activate(f);
  const actor={ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id};
  const attempt=await startLegacyAttempt(f.db,actor);
  assert.equal(attempt.questions.length,25); assert.equal(JSON.stringify(attempt).includes('correctOptionId'),false); assert.equal(JSON.stringify(attempt).includes('explanation'),false);
  assert.ok(attempt.questions.every(question=>question.options.every(option=>/^[0-9a-f-]{36}$/.test(option.id))));
  assert.deepEqual(await startLegacyAttempt(f.db,actor),attempt);
  const answers=answerTokens(attempt,course);
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,memberId:'installer-member',attemptId:attempt.id,answers}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:{...answers,[attempt.questions[0].id]:attempt.questions[1].options[0].id}}),error=>error.code==='ANSWER_TOKEN_INVALID');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:Object.fromEntries(course.questions.map(q=>[q.id,q.correctOptionId]))}),error=>error.code==='ANSWER_TOKEN_INVALID');
  const passed=await training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers});
  assert.equal(passed.passed,true); assert.equal(passed.scorePercent,100); assert.equal(passed.feedback.length,25); assert.match(passed.reference,/^TL-CX-TRAIN-/);
  assert.deepEqual(await training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers}), passed);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 1);
});
test('legacy bulk attempts still require every correct answer and permit unlimited immediate retakes', async () => {
  const f=fixture(); const course=await activate(f); const critical=course.questions.find(q=>q.critical);
  const actor={ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id}; const attempt=await startLegacyAttempt(f.db,actor);
  const wrong=critical.options.find(option=>option.id!==critical.correctOptionId).id;
  const result=await training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:answerTokens(attempt,course,{[critical.id]:wrong})});
  assert.equal(result.scorePercent,96); assert.equal(result.criticalPassed,false); assert.equal(result.passed,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_completions').get().n,0);
  for (let i=0;i<5;i++) {
    const retake=await startLegacyAttempt(f.db,actor);
    assert.notEqual(retake.id,attempt.id);
    const failed=await training.submitTrainingAttempt(f.db,{...actor,attemptId:retake.id,answers:answerTokens(retake,course,{[critical.id]:wrong})});
    assert.equal(failed.passed,false);
  }
  const noncritical=course.questions.find(q=>!q.critical);
  const canonical=Object.fromEntries(course.questions.map(q=>[q.id,q.correctOptionId])); canonical[noncritical.id]=noncritical.options.find(option=>option.id!==noncritical.correctOptionId).id;
  assert.equal(training.scoreTrainingAnswers({...course,passPercent:80},canonical).passed,false);
});

test('the same member can switch between web and PIN without transferring another actor or member attempt', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await startLegacyAttempt(f.db,web);
  const other=await startLegacyAttempt(f.db,{...web,memberId:'owner-member',actorUid:'owner'});
  await assert.rejects(startLegacyAttempt(f.db,{...pin,ownerUid:'another-business'}),error=>error.code==='ACTIVITY_CAPABILITY_REQUIRED');
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'in_progress');
  const replacement=await startLegacyAttempt(f.db,pin);
  assert.notEqual(replacement.id,original.id);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'expired');
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(other.id).status,'in_progress');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...web,attemptId:original.id,answers:answerTokens(original,course)}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...web,attemptId:replacement.id,answers:answerTokens(replacement,course)}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...pin,attemptId:replacement.id,answers:answerTokens(original,course)}),error=>error.code==='ANSWER_TOKEN_INVALID');
  const returnedToWeb=await startLegacyAttempt(f.db,web);
  assert.notEqual(returnedToWeb.id,replacement.id);
  assert.deepEqual(await startLegacyAttempt(f.db,web),returnedToWeb);
  assert.equal((await training.submitTrainingAttempt(f.db,{...web,attemptId:returnedToWeb.id,answers:answerTokens(returnedToWeb,course)})).passed,true);
  const event=f.sql.prepare("SELECT metadata_json FROM trade_training_events WHERE event_type='attempt_started' AND actor_uid='installer' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(event.metadata_json).supersededAttemptId,replacement.id);
});

test('concurrent handoffs replace only the observed attempt and create one active assessment', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await startLegacyAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); const queued=[];
  f.db.batch=statements=>new Promise((resolve,reject)=>{queued.push({statements,resolve,reject});if(queued.length===2)ready();});
  const outcomes=Promise.allSettled([startLegacyAttempt(f.db,pin),startLegacyAttempt(f.db,pin)]);
  await waiting; f.db.batch=commit;
  for(const request of queued) { try { request.resolve(await commit(request.statements)); } catch(error) { request.reject(error); } }
  const results=await outcomes; assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.match(results.find(result=>result.status==='rejected').reason.message,/CHECK constraint failed/i);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM trade_training_attempts WHERE member_id='installer-member' AND status='in_progress'").get().n,1);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'expired');
  assert.deepEqual(await startLegacyAttempt(f.db,pin),results.find(result=>result.status==='fulfilled').value);
});

test('a handoff winning the commit race rejects the original already-read submission without creating completion', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await startLegacyAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); let held;
  f.db.batch=statements=>new Promise((resolve,reject)=>{held={statements,resolve,reject};ready();});
  const pending=training.submitTrainingAttempt(f.db,{...web,attemptId:original.id,answers:answerTokens(original,course)});
  const rejected=assert.rejects(pending,/CHECK constraint failed/i);
  await waiting; f.db.batch=commit; const replacement=await startLegacyAttempt(f.db,pin);
  try { held.resolve(await commit(held.statements)); } catch(error) { held.reject(error); }
  await rejected;
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_completions').get().n,0);
  assert.equal((await training.submitTrainingAttempt(f.db,{...pin,attemptId:replacement.id,answers:answerTokens(replacement,course)})).passed,true);
});

test('an original submission winning the commit race preserves its pass and rejects the stale handoff', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await startLegacyAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); let held;
  f.db.batch=statements=>new Promise((resolve,reject)=>{held={statements,resolve,reject};ready();});
  const pending=startLegacyAttempt(f.db,pin); const rejected=assert.rejects(pending,/CHECK constraint failed/i);
  await waiting; f.db.batch=commit;
  const result=await training.submitTrainingAttempt(f.db,{...web,attemptId:original.id,answers:answerTokens(original,course)});
  try { held.resolve(await commit(held.statements)); } catch(error) { held.reject(error); }
  await rejected; assert.equal(result.passed,true);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'passed');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_completions').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_attempts').get().n,1);
});
test('ordinary jobs remain unaffected; unknown activities, untrained owners and untrained assignees fail closed', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f);
  assert.equal((await training.getCertificateActivityEligibility(f.db,{...booking,activityTemplateIds:[]})).eligible,true);
  assert.equal((await training.getCertificateActivityEligibility(f.db,{...booking,activityTemplateIds:['unknown']})).eligible,false);
  assert.equal((await training.getCertificateActivityEligibility(f.db,booking)).eligible,false);
  await pass(f); assert.equal((await training.getCertificateActivityEligibility(f.db,booking)).eligible,false);
  await pass(f,'installer-member'); assert.equal((await training.getCertificateActivityEligibility(f.db,booking)).eligible,true);
});

test('staff bookings still require the owner and current jurisdiction, capability and programme scope', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f); await pass(f,'installer-member');
  const staffBooking={...booking,actorMemberId:'installer-member'};
  assert.equal((await training.getCertificateActivityEligibility(f.db,staffBooking)).eligible,false);
  await pass(f); assert.equal((await training.getCertificateActivityEligibility(f.db,staffBooking)).eligible,true);
  const guard=await training.certificateActivityEligibilityGuardStatement(f.db,staffBooking);
  f.sql.prepare("UPDATE trade_accounts SET service_states='[\"NSW\"]',address_state='NSW'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db,staffBooking)).eligible,false);
  await assert.rejects(guard.run(),/CHECK constraint failed/i);
  f.sql.prepare("UPDATE trade_accounts SET service_states='[\"VIC\"]',address_state='VIC'").run();
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[]' WHERE id='installer-member'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db,staffBooking)).eligible,false);
  const result=await training.getCertificateActivityEligibility(f.db,{...booking,activityTemplateIds:['act-eeis-2-2']});
  assert.equal(result.eligible,false); assert.equal(result.reasons[0].code,'PROGRAMME_ACTIVITY_NOT_OPEN');
  assert.equal((await training.certificateActivityEligibilityPredicate({...booking,activityTemplateIds:['act-eeis-2-2']})).sql,'0=1');
});

test('an office booker needs no course pass when the owner and assigned technician have passed', async () => {
  const f = fixture(); await approveBusiness(f); await activate(f); await pass(f); await pass(f, 'installer-member');
  f.sql.exec("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('office-member','owner','active','Office colleague','office-user','[]')");
  const input = { ...booking, actorMemberId: 'office-member' };
  assert.equal((await training.getCertificateActivityEligibility(f.db, input)).eligible, true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_training_completions WHERE member_id='office-member'").get().count, 0);
  await (await training.certificateActivityEligibilityGuardStatement(f.db, input)).run();
  f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-19' WHERE member_id='installer-member'");
  assert.equal((await training.getCertificateActivityEligibility(f.db, input)).eligible, false, 'the office exemption cannot qualify the assigned technician');
});

test('office booking retains active same-business actor checks at the atomic write', async () => {
  const f = fixture(); await approveBusiness(f); await activate(f); await pass(f); await pass(f, 'installer-member');
  f.sql.exec("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('office-member','owner','active','Office colleague','office-user','[]'),('foreign-member','another-owner','active','Other office','other-user','[]')");
  const input = { ...booking, actorMemberId: 'office-member' };
  const guard = await training.certificateActivityEligibilityGuardStatement(f.db, input);
  f.sql.exec("UPDATE trade_team_members SET status='inactive' WHERE id='office-member'");
  await assert.rejects(guard.run(), /CHECK constraint failed/i);
  for (const actorMemberId of ['office-member', 'foreign-member', 'missing-member']) {
    assert.equal((await training.getCertificateActivityEligibility(f.db, { ...input, actorMemberId })).eligible, false);
  }
});

test('a sole trader reuses one personal pass for the business and their own onsite work', async () => {
  const f = fixture(); await approveBusiness(f); await activate(f);
  f.sql.exec("DELETE FROM trade_team_members WHERE id='installer-member'");
  const input = { ...booking, assignedMemberId: 'owner-member' };
  assert.equal((await training.getCertificateActivityEligibility(f.db, input)).eligible, false);
  await pass(f);
  assert.equal((await training.getCertificateActivityEligibility(f.db, input)).eligible, true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_training_completions').get().count, 1);
  await (await training.certificateActivityEligibilityGuardStatement(f.db, input)).run();
});

test('twenty-activity atomic guard uses a bounded relation with three identity parameters', async () => {
  const { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES }=load('src/lib/australian-government-program-catalogue.ts');
  const ids=GOVERNMENT_ACTIVITY_TEMPLATES.filter(activity=>!['closed','future'].includes(activity.catalogueState) && !['closed','future'].includes(GOVERNMENT_PROGRAM_TEMPLATES.find(program=>program.programCode===activity.programCode).catalogueState) && TRAINING_MODULES.some(course=>course.activityTemplateIds.includes(activity.templateId) && course.sourceCoverage.status!=='partial')).slice(0,20).map(activity=>activity.templateId);
  assert.equal(ids.length,20);
  const predicate=await training.certificateActivityEligibilityPredicate({...booking,activityTemplateIds:ids});
  assert.equal(predicate.bindings.length,3); assert.equal((predicate.sql.match(/\?/g)||[]).length,3);
  const f=fixture(); assert.equal(await f.db.prepare(`SELECT 1 WHERE ${predicate.sql}`).bind(...predicate.bindings).first(),null);
});
test('revocation between read and booking batch atomically rolls back job creation', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f); await pass(f); await pass(f,'installer-member');
  f.sql.exec('CREATE TABLE bookings(id TEXT PRIMARY KEY)');
  const guard=await training.certificateActivityEligibilityGuardStatement(f.db,booking);
  const completion=f.sql.prepare("SELECT id FROM trade_training_completions WHERE member_id='installer-member'").get();
  await training.revokeTrainingCompletion(f.db,'reviewer',completion.id,'Competency concern');
  await assert.rejects(f.db.batch([f.db.prepare("INSERT INTO bookings VALUES('booking')"),guard]),/creditex|trade_crm_write_guard/i);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,0);
});
test('new team members can receive leads while training withdrawal still blocks bookings and business suspension blocks leads', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f); await pass(f); await pass(f,'installer-member');
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:['veu-6']})).eligible,true);
  f.sql.prepare("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('new','owner','active','New member','new','[\"heating-cooling\"]')").run();
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:['veu-6']})).eligible,true);
  f.sql.prepare("UPDATE trade_training_module_reviews SET status='withdrawn'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db,booking)).eligible,false);
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:[]})).eligible,true);
  f.sql.prepare("UPDATE creditex_business_onboarding SET status='suspended'").run();
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:[]})).eligible,false);
});
test('Activity 48 needs quiz passes for everyone and reviewed EEC/ESC credentials for the assigned installer', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f,'veu-48'); await pass(f,'owner-member','veu-48'); await pass(f,'installer-member','veu-48');
  const input={...booking,activityTemplateIds:['veu-48']}; assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,false);
  for (const member of ['installer-member']) {
    f.sql.prepare('INSERT INTO trade_team_member_files VALUES (?,?,?,?,?,?)').run(`file-${member}`,'owner',member,'active',yearLater(),'training');
    f.sql.prepare('INSERT INTO trade_training_external_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`credential-${member}`,'owner',member,'veu-48',`file-${member}`,'EEC-CII-verified','ESC-participant-verified',tomorrow(),'reviewer','Verified both registers','',new Date().toISOString());
  }
  assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,true);
  assert.equal((await training.getCertificateActivityEligibility(f.db,{...input,assignedMemberId:'owner-member'})).eligible,false,'an office owner cannot assign themselves as installer without external credentials');
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:['veu-48']})).eligible,true,'a qualified installer can service leads for a trained non-installing owner');
  f.sql.exec("DELETE FROM trade_training_module_reviews WHERE module_id='veu-48'");
  assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,false,'automatic quiz completion cannot replace Activity 48 scheme authority');
  const learning = (await training.getTrainingModulesForMember(f.db,'owner','owner-member')).find(course => course.id === 'veu-48');
  assert.equal(learning.status,'passed'); assert.equal(learning.assessmentAvailable,true,'scheme authority is separate from course access');
  await activate(f,'veu-48');
  f.sql.prepare("UPDATE trade_training_completions SET revoked_at='2026-09-18' WHERE member_id='owner-member'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,false,'office owners still need a current quiz pass');
  f.sql.prepare("UPDATE trade_training_completions SET revoked_at='' WHERE member_id='owner-member'").run();
  f.sql.prepare("UPDATE trade_team_member_files SET status='deleted' WHERE team_member_id='installer-member'").run(); assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,false);
  f.sql.prepare("UPDATE trade_team_member_files SET status='active'").run();
  f.sql.prepare("UPDATE trade_training_external_credentials SET scheme_participant_reference=''").run(); assert.equal((await training.getCertificateActivityEligibility(f.db,input)).eligible,false);
});
test('learner catalogue conceals answer keys and remains current independently of optional review metadata', async () => {
  const f=fixture(); await activate(f); await pass(f);
  const catalogue=await training.getTrainingModulesForMember(f.db,'owner','owner-member');
  assert.equal(JSON.stringify(catalogue).includes('correctOptionId'),false); assert.equal(catalogue.find(item=>item.id==='veu-6').status,'passed');
  for (const course of TRAINING_MODULES) assert.equal(catalogue.find(item=>item.id===course.id)?.programCode,course.programCode);
  assert.ok(catalogue.some(item=>item.programCode==='ACT-SHS')); assert.ok(catalogue.some(item=>item.programCode==='ACT-HES'));
  f.sql.prepare("UPDATE trade_training_module_reviews SET content_hash=?").run('b'.repeat(64));
  const outdated = (await training.getTrainingModulesForMember(f.db,'owner','owner-member')).find(item=>item.id==='veu-6');
  assert.equal(outdated.status,'passed'); assert.equal(outdated.availability,'active'); assert.equal(outdated.assessmentAvailable,true);
});

test('saved personal services immediately add and remove learner todos independently of business services', async () => {
  const f = fixture();
  f.sql.prepare("UPDATE trade_accounts SET capabilities='[]'").run();
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[]' WHERE id='installer-member'").run();
  const route = trainingRoute(f, { memberId: 'installer-member', actorUid: 'installer', isOwner: false, canManageTeam: false });
  const read = async () => (await route.GET(new Request('https://example.test/api/trade-training'))).json();
  assert.equal((await read()).modules.length, 0);
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='installer-member'").run();
  const selected = await read();
  assert.ok(selected.modules.some(module => module.id === 'veu-6'));
  assert.ok(selected.modules.every(module => module.serviceCategory === 'heating-cooling' && module.businessServiceEnabled === false));
  assert.ok(selected.modules.every(module => module.status === (module.assessmentAvailable ? 'required' : 'unavailable') && module.completion === null));
  assert.equal(selected.canTakeTraining, true); assert.equal(selected.selectedMember.isSelf, true);
  assert.deepEqual(selected.team, []);
  assert.ok(!JSON.stringify(selected).includes('correctOptionId')); assert.ok(selected.modules.every(module => !('questions' in module)));
  assert.equal((await training.getDeclaredTrainingActivities(f.db, 'owner', 'owner-member')).length, 0, 'owner training continues to follow business services');
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[\"painting\"]' WHERE id='installer-member'").run();
  const ordinary = await read();
  assert.deepEqual(ordinary.modules, []); assert.deepEqual(ordinary.unavailableActivities, []);
  assert.equal(ordinary.business.approved, false, 'an ordinary service is not an approval or training completion');
});

test('owner and authorised manager can view an active roster member without taking over their identity', async () => {
  const f = fixture();
  f.sql.prepare("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('roster-only','owner','active','New colleague','','[\"hot-water\"]')").run();
  for (const access of [{}, { memberId: 'installer-member', actorUid: 'installer', displayName: 'Manager', isOwner: false, canManageTeam: true }]) {
    const response = await trainingRoute(f, access).GET(new Request('https://example.test/api/trade-training?memberId=roster-only'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memberId, 'roster-only'); assert.equal(body.selectedMember.displayName, 'New colleague');
    assert.equal(body.selectedMember.isSelf, false); assert.equal(body.canTakeTraining, false);
    assert.equal(body.actor.memberId, access.memberId || 'owner-member');
    assert.ok(body.modules.some(module => module.id === 'sres-ashp'));
    assert.ok(body.modules.every(module => module.serviceCategory === 'hot-water' && module.businessServiceEnabled));
  }
});

test('training API identifies office-only members from personal services and keeps the owner requirement', async () => {
  const f = fixture();
  f.sql.exec("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('office-member','owner','active','Office colleague','office-user','[]')");
  const officeRoute = trainingRoute(f, { memberId: 'office-member', actorUid: 'office-user', isOwner: false, canManageTeam: false });
  const office = await (await officeRoute.GET(new Request('https://example.test/api/trade-training'))).json();
  assert.equal(office.officeOnly, true); assert.equal(office.selectedMember.officeOnly, true);
  assert.deepEqual(office.modules, []); assert.deepEqual(office.unavailableActivities, []);
  const owner = await (await trainingRoute(f).GET(new Request('https://example.test/api/trade-training'))).json();
  assert.equal(owner.officeOnly, false); assert.equal(owner.selectedMember.officeOnly, false);
  assert.ok(owner.modules.some(module => module.id === 'veu-6'));
  assert.equal(owner.team.find(member => member.memberId === 'office-member').officeOnly, true);
  assert.equal(owner.team.find(member => member.memberId === 'installer-member').officeOnly, false);
  f.sql.exec('UPDATE trade_team_members SET capabilities=\'["heating-cooling"]\' WHERE id=\'office-member\'');
  const field = await (await officeRoute.GET(new Request('https://example.test/api/trade-training'))).json();
  assert.equal(field.officeOnly, false); assert.ok(field.modules.some(module => module.id === 'veu-6'));
});

test('member projection rejects unauthorised, inactive and cross-business targets without data disclosure', async () => {
  const f = fixture();
  f.sql.prepare("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES ('foreign','other-owner','active','Private person','private-uid','[\"hot-water\"]'),('inactive','owner','suspended','Suspended person','suspended-uid','[\"hot-water\"]')").run();
  const staff = trainingRoute(f, { memberId: 'installer-member', actorUid: 'installer', isOwner: false, canManageTeam: false });
  const denied = await staff.GET(new Request('https://example.test/api/trade-training?memberId=owner-member'));
  assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'TRAINING_MEMBER_ACCESS_DENIED');
  for (const id of ['foreign', 'inactive', 'missing']) {
    const response = await trainingRoute(f).GET(new Request(`https://example.test/api/trade-training?memberId=${id}`));
    assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, code: 'TRAINING_MEMBER_NOT_FOUND' });
  }
});

test('owner and manager training POST cannot act for another member through query or body', async () => {
  const f = fixture(); await activate(f);
  for (const access of [{}, { memberId: 'installer-member', actorUid: 'installer', isOwner: false, canManageTeam: true }]) {
    const route = trainingRoute(f, access);
    const other = access.memberId ? 'owner-member' : 'installer-member';
    for (const action of ['start', 'check', 'submit']) {
      for (const query of [false, true]) {
        const response = await route.POST(new Request(`https://example.test/api/trade-training${query ? `?memberId=${other}` : ''}`, { method: 'POST', body: JSON.stringify({ action, moduleId: 'veu-6', attemptId: 'unused', ...(query ? {} : { memberId: other }) }) }));
        assert.equal(response.status, 403); assert.equal((await response.json()).code, 'TRAINING_SELF_ONLY');
      }
    }
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, 0);
  const own = await trainingRoute(f).POST(new Request('https://example.test/api/trade-training?memberId=owner-member', { method: 'POST', body: JSON.stringify({ action: 'start', memberId: 'owner-member', moduleId: 'veu-6' }) }));
  assert.equal(own.status, 200);
  const created = f.sql.prepare('SELECT member_id,actor_uid FROM trade_training_attempts').get();
  assert.equal(created.member_id, 'owner-member'); assert.equal(created.actor_uid, 'owner');
});

test('personal service allows reviewed training without enabling business booking or lead eligibility', async () => {
  const f = fixture(); await approveBusiness(f); await activate(f); await pass(f);
  f.sql.prepare("UPDATE trade_accounts SET capabilities='[]'").run();
  const learned = await pass(f, 'installer-member');
  assert.equal(learned.passed, true);
  const modules = await training.getTrainingModulesForMember(f.db, 'owner', 'installer-member');
  assert.equal(modules.find(module => module.id === 'veu-6').businessServiceEnabled, false);
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false);
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db, { ownerUid: 'owner', activityTemplateIds: ['veu-6'] })).eligible, false);
});

test('removing saved personal service before an attempt write or submission fails the atomic scope guard', async () => {
  const f = fixture(); const course = await activate(f);
  const actor = { ownerUid: 'owner', memberId: 'installer-member', actorUid: 'installer', moduleId: course.id };
  const commit = f.db.batch;
  f.db.batch = async statements => { f.sql.prepare("UPDATE trade_team_members SET capabilities='[]' WHERE id='installer-member'").run(); return commit(statements); };
  await assert.rejects(startLegacyAttempt(f.db, actor), /CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, 0);
  f.db.batch = commit;
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='installer-member'").run();
  const attempt = await startLegacyAttempt(f.db, actor);
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[]' WHERE id='installer-member'").run();
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), /CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 0);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(attempt.id).status, 'in_progress');
});

test('legacy combined service aliases project canonical training and use the same atomic assessment scope', async () => {
  const f = fixture(); await activate(f, 'veu-48');
  f.sql.prepare("UPDATE trade_accounts SET capabilities='[\"insulation-draughts\"]'").run();
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[\"insulation-draughts\"]' WHERE id='installer-member'").run();
  for (const memberId of ['owner-member', 'installer-member']) {
    const scope = await training.getMemberTrainingScope(f.db, 'owner', memberId);
    assert.deepEqual(scope.capabilities, ['insulation', 'draught-proofing']);
    assert.ok(scope.activities.some(activity => activity.templateId === 'veu-48' && activity.businessServiceEnabled));
    assert.ok(scope.activities.some(activity => activity.serviceCategory === 'draught-proofing'));
    const result = await pass(f, memberId, 'veu-48');
    assert.equal(result.passed, true);
  }
  assert.equal(f.sql.prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid='owner'").get().capabilities, '["insulation-draughts"]', 'projection does not rewrite or approve the business');
  assert.equal(f.sql.prepare("SELECT capabilities FROM trade_team_members WHERE id='installer-member'").get().capabilities, '["insulation-draughts"]');
  assert.equal((await training.getCertificateActivityEligibility(f.db, { ...booking, activityTemplateIds: ['veu-48'] })).eligible, false);
});

test('legacy bulk training rejects 96%, permits an immediate 100% retry and enables jobs without fabricated review rows', async () => {
  const f = fixture(); await approveBusiness(f);
  const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
  const first = await startLegacyAttempt(f.db, actor);
  const question = course.questions.find(question => !question.critical);
  const failed = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: first.id, answers: answerTokens(first, course, { [question.id]: question.options.find(option => option.id !== question.correctOptionId).id }) });
  assert.equal(failed.scorePercent, 96); assert.equal(failed.passed, false); assert.equal(failed.reference, '');
  assert.match(failed.meaning, /Correct the remaining answers/);
  const retry = await startLegacyAttempt(f.db, actor);
  const result = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: retry.id, answers: answerTokens(retry, course) });
  assert.equal(result.scorePercent, 100); assert.equal(result.passed, true); assert.ok(!('programmeApprovalPending' in result));
  assert.match(result.meaning, /activity learning is complete/);
  assert.doesNotMatch(result.meaning, /pending/i);
  await pass(f, 'installer-member');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_module_reviews').get().n, 0, 'autonomous training must not fabricate manual decisions');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 2);
  const projected = (await training.getTrainingModulesForMember(f.db, 'owner', 'owner-member')).find(module => module.id === course.id);
  assert.equal(projected.status, 'passed'); assert.equal(projected.availability, 'active'); assert.equal(projected.assessmentAvailable, true);
  assert.equal(projected.completion.reference, result.reference);
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, true);
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db, { ownerUid: 'owner', activityTemplateIds: ['veu-6'] })).eligible, true);
});

test('partial source coverage blocks assessment and learner projection removes internal review notes without changing source hashes', async () => {
  const f = fixture();
  const { GOVERNMENT_ACTIVITY_TEMPLATES } = load('src/lib/australian-government-program-catalogue.ts');
  const partial = TRAINING_MODULES.find(course => course.sourceCoverage.status === 'partial');
  const category = GOVERNMENT_ACTIVITY_TEMPLATES.find(activity => partial.activityTemplateIds.includes(activity.templateId)).serviceCategory;
  f.sql.prepare('UPDATE trade_accounts SET capabilities=?,service_states=?').run(JSON.stringify([category, 'heating-cooling']), '["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"]');
  const originalHashes = TRAINING_MODULES.map(training.getTrainingModuleHash);
  const projected = await training.getTrainingModulesForMember(f.db, 'owner', 'owner-member');
  assert.equal(projected.find(module => module.id === partial.id).assessmentAvailable, false);
  assert.match(projected.find(module => module.id === partial.id).assessmentUnavailableReason, /source requirements are incomplete/);
  await assert.rejects(startLegacyAttempt(f.db, { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: partial.id }), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
  const response = await trainingRoute(f).GET(new Request('https://example.test/api/trade-training'));
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('creditex-review'));
  assert.ok(!JSON.stringify(body).includes('creditex-source-review.md'));
  const result = await pass(f);
  assert.ok(result.feedback.every(item => !item.sourceIds.includes('creditex-review')));
  assert.deepEqual(TRAINING_MODULES.map(training.getTrainingModuleHash), originalHashes);
  assert.ok(TRAINING_MODULES.some(course => course.sources.some(source => source.id === 'creditex-review')), 'internal provenance remains retained server-side');
});

test('current source-backed assessments and recorded passes require the full saved question count and 100%', async () => {
  const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  assert.equal(training.isTrainingModuleReady(course), true);
  for (const change of [value => { value.questions = []; }, value => { value.passPercent = 96; }, value => { value.questions[0].options[1].id = value.questions[0].options[0].id; }, value => { value.sourceCoverage.status = 'partial'; }]) {
    const invalid = structuredClone(course); change(invalid);
    assert.equal(training.isTrainingModuleReady(invalid), false);
  }
  for (const [column, value] of [['score_percent', 96], ['critical_passed', 0], ['assessment_json', '[]'], ['member_id', 'someone-else']]) {
    const f = fixture(); await approveBusiness(f); await pass(f); await pass(f, 'installer-member');
    assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, true);
    f.sql.prepare(`UPDATE trade_training_attempts SET ${column}=? WHERE member_id='owner-member'`).run(value);
    assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false);
    const projected = (await training.getTrainingModulesForMember(f.db, 'owner', 'owner-member')).find(module => module.id === course.id);
    assert.equal(projected.status, 'required'); assert.equal(projected.completion, null);
  }
});

test('explicit withdrawal blocks assessment but optional expired or old review metadata does not disable current content', async () => {
  for (const [column, value] of [['status', 'withdrawn'], ['review_expires_on', '2000-01-01'], ['content_hash', '0'.repeat(64)], ['version', 'old-version']]) {
    const f = fixture(); const course = await activate(f);
    const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
    const attempt = await startLegacyAttempt(f.db, actor);
    f.sql.prepare(`UPDATE trade_training_module_reviews SET ${column}=?`).run(value);
    if (column === 'status') {
      await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
      await assert.rejects(startLegacyAttempt(f.db, actor), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 0);
    } else {
      const result = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) });
      assert.equal(result.passed, true);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 1);
    }
  }
  const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
  const attempt = await startLegacyAttempt(f.db, actor);
  f.sql.prepare('UPDATE trade_training_attempts SET content_hash=?').run('1'.repeat(64));
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), error => error.code === 'TRAINING_VERSION_CHANGED');
});

test('new withdrawal or changed review between read and commit rolls back pending assessment writes', async () => {
  for (const stage of ['start', 'submit']) {
    for (const reviewed of [false, true]) {
      const f = fixture(); const course = reviewed ? await activate(f) : TRAINING_MODULES.find(course => course.id === 'veu-6');
      const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
      const attempt = stage === 'submit' ? await startLegacyAttempt(f.db, actor) : null;
      const commit = f.db.batch;
      f.db.batch = async statements => {
        if (reviewed) f.sql.prepare("UPDATE trade_training_module_reviews SET updated_at=updated_at||'-changed'").run();
        else f.sql.prepare("INSERT INTO trade_training_module_reviews(module_id,version,content_hash,status,source_reviewed_on,review_expires_on,reviewed_by_uid,review_note,updated_at) VALUES (?,?,?,'withdrawn',?,?,?,'New withdrawal',?)").run(course.id, course.version, training.getTrainingModuleHash(course), today(), yearLater(), 'reviewer', new Date().toISOString());
        return commit(statements);
      };
      const operation = stage === 'start' ? startLegacyAttempt(f.db, actor) : training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) });
      await assert.rejects(operation, /CHECK constraint failed/);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 0);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, stage === 'submit' ? 1 : 0);
      if (attempt) assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(attempt.id).status, 'in_progress');
    }
  }
});

test('served jurisdictions are authoritative for projection and API scope, with address used only as a legacy fallback', async () => {
  const f = fixture();
  const { GOVERNMENT_PROGRAM_TEMPLATES } = load('src/lib/australian-government-program-catalogue.ts');
  const jurisdictions = new Map(GOVERNMENT_PROGRAM_TEMPLATES.map(program => [program.programCode, program.jurisdiction]));
  const cases = [[['VIC'], 'NSW', ['VIC']], [['NSW'], 'VIC', ['NSW']], [['NSW', 'VIC'], 'SA', ['NSW', 'VIC']], [[' vic ', 'VIC', 'invalid'], 'NSW', ['VIC']], [[], 'NSW', ['NSW']], [['invalid'], 'unknown', []]];
  for (const [saved, address, expected] of cases) {
    f.sql.prepare('UPDATE trade_accounts SET service_states=?,address_state=?').run(JSON.stringify(saved), address);
    const scope = await training.getMemberTrainingScope(f.db, 'owner', 'owner-member');
    assert.deepEqual(scope.serviceStates, expected);
    assert.ok(scope.activities.every(activity => jurisdictions.get(activity.programCode) === 'AU' || expected.includes(jurisdictions.get(activity.programCode))));
    assert.equal(scope.activities.some(activity => jurisdictions.get(activity.programCode) === 'AU'), expected.length > 0);
    assert.equal(scope.activities.some(activity => activity.programCode === 'VEU'), expected.includes('VIC'));
    assert.equal(scope.activities.some(activity => activity.programCode === 'NSW-ESS'), expected.includes('NSW'));
    const response = await trainingRoute(f).GET(new Request('https://example.test/api/trade-training'));
    assert.deepEqual((await response.json()).trainingServiceStates, expected);
  }
});

test('jurisdiction removal wins against assessment submission and blocks jobs despite a different address state', async () => {
  const f = fixture(); await approveBusiness(f); const course = await activate(f); await pass(f); await pass(f, 'installer-member');
  const actor = { ownerUid: 'owner', memberId: 'installer-member', actorUid: 'installer', moduleId: course.id };
  const attempt = await startLegacyAttempt(f.db, actor); const commit = f.db.batch;
  f.db.batch = async statements => { f.sql.prepare("UPDATE trade_accounts SET service_states='[\"NSW\"]',address_state='VIC'").run(); return commit(statements); };
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), /CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 2);
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false);
  await assert.rejects(startLegacyAttempt(f.db, actor), error => error.code === 'ACTIVITY_CAPABILITY_REQUIRED');
  f.db.batch = commit;
  f.sql.prepare("UPDATE trade_accounts SET service_states='[\"VIC\"]',address_state='NSW'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, true);
});

test('personal regions narrow multi-state business training while owners retain all business prerequisites', async () => {
  const f = fixture();
  f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC","NSW"]';
    UPDATE trade_team_members SET service_states='["VIC"]' WHERE id='installer-member';`);
  let scope = await training.getMemberTrainingScope(f.db, 'owner', 'installer-member');
  assert.deepEqual(scope.serviceStates, ['VIC']); assert.deepEqual(scope.assignedServiceStates, ['VIC']);
  assert.deepEqual(scope.businessServiceStates, ['NSW', 'VIC']);
  assert.ok(scope.activities.some(activity => activity.programCode === 'VEU'));
  assert.equal(scope.activities.some(activity => activity.programCode === 'NSW-ESS'), false);
  assert.ok(scope.assignedModuleIds.includes('sres-ashp'), 'national hot water training remains applicable');
  const ownerScope = await training.getMemberTrainingScope(f.db, 'owner', 'owner-member');
  assert.deepEqual(ownerScope.serviceStates, ['NSW', 'VIC']); assert.equal(ownerScope.assignedServiceStates, null);
  f.sql.exec(`UPDATE trade_team_members SET service_states='["NSW","VIC"]' WHERE id='installer-member'`);
  scope = await training.getMemberTrainingScope(f.db, 'owner', 'installer-member');
  assert.ok(scope.activities.some(activity => activity.programCode === 'NSW-ESS'));
  const response = await trainingRoute(f).GET(new Request('https://example.test/api/trade-training?memberId=installer-member'));
  const body = await response.json(); assert.deepEqual(body.trainingServiceStates, ['NSW', 'VIC']);
  assert.deepEqual(body.assignedServiceStates, ['NSW', 'VIC']); assert.deepEqual(body.businessServiceStates, ['NSW', 'VIC']);
  f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC"]'; UPDATE trade_team_members SET service_states='["NSW"]' WHERE id='installer-member'`);
  scope = await training.getMemberTrainingScope(f.db, 'owner', 'installer-member');
  assert.deepEqual(scope.serviceStates, []); assert.deepEqual(scope.assignedModuleIds, []);
});

test('passed technicians must still cover the activity and actual national-program job state', async () => {
  const f = fixture();
  f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC","NSW"]'`);
  await approveBusiness(f, { ...application(), doesNswWork: true, contractorLicenceDocumentId: 'nsw-licence' }); await pass(f); await pass(f, 'installer-member');
  await pass(f, 'owner-member', 'sres-ashp'); await pass(f, 'installer-member', 'sres-ashp');
  f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC","NSW"]'; UPDATE trade_team_members SET service_states='["VIC"]' WHERE id='installer-member'`);
  const national = { ...booking, activityTemplateIds: ['sres-ashp'], serviceState: 'VIC' };
  assert.equal((await training.getCertificateActivityEligibility(f.db, national)).eligible, true);
  const outside = await training.getCertificateActivityEligibility(f.db, { ...national, serviceState: 'NSW' });
  assert.equal(outside.eligible, false); assert.equal(outside.reasons[0].code, 'MEMBER_SERVICE_REGION_REQUIRED');
  const guard = await training.certificateActivityEligibilityGuardStatement(f.db, { ...booking, serviceState: 'VIC' });
  f.sql.exec(`UPDATE trade_team_members SET service_states='["NSW"]' WHERE id='installer-member'`);
  await assert.rejects(guard.run(), /CHECK constraint failed/);
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_training_completions').get().count, 4, 'changing regions retains immutable earned passes');
  f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC"]'`);
  const empty = await training.certificateActivityEligibilityPredicate({ ...national, serviceState: undefined });
  assert.equal(await f.db.prepare(`SELECT 1 WHERE ${empty.sql}`).bind(...empty.bindings).first(), null, 'national work cannot bypass an empty region intersection');
});

test('a concurrent personal region change blocks start, checked answer and submission writes', async () => {
  for (const action of ['start', 'check', 'submit']) {
    const f = fixture(); const course = TRAINING_MODULES.find(item => item.id === 'veu-6');
    f.sql.exec(`UPDATE trade_accounts SET service_states='["VIC","NSW"]'; UPDATE trade_team_members SET service_states='["VIC"]' WHERE id='installer-member'`);
    const actor = { ownerUid: 'owner', memberId: 'installer-member', actorUid: 'installer', moduleId: course.id };
    const attempt = action === 'start' ? null : await startLegacyAttempt(f.db, actor);
    const commit = f.db.batch;
    f.db.batch = async statements => { f.sql.exec(`UPDATE trade_team_members SET service_states='["NSW"]' WHERE id='installer-member'`); return commit(statements); };
    if (action === 'start') await assert.rejects(training.startTrainingAttempt(f.db, actor), /CHECK constraint failed/);
    else if (action === 'check') await assert.rejects(training.checkTrainingAnswer(f.db, { ...actor, attemptId: attempt.id, questionId: attempt.questions[0].id, answer: answerTokens(attempt, course)[attempt.questions[0].id] }), /CHECK constraint failed/);
    else await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), /CHECK constraint failed/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_training_completions').get().count, 0);
  }
});

test('booking training errors name the missing module without disguising region or onboarding restrictions', async () => {
  const f = fixture(); await approveBusiness(f);
  await assert.rejects(training.assertCertificateActivityEligibility(f.db, booking), error => error.code === 'ACTIVITY_TRAINING_REQUIRED'
    && error.message.includes('This booking can be made once the required training module is complete.')
    && error.message.includes('To be completed by: Business owner, Installer.')
    && error.trainingModules.some(module => module.id === 'veu-6' && module.title.includes('space heating')));
  const soleTrader = await training.getCertificateActivityEligibility(f.db, { ...booking, assignedMemberId: 'owner-member' });
  assert.equal(soleTrader.reasons.filter(reason => reason.moduleId === 'veu-6').length, 1);
  assert.match(soleTrader.reasons[0].message, /To be completed by: Business owner\.$/);
  await pass(f);
  await assert.rejects(training.assertCertificateActivityEligibility(f.db, booking), error => error.code === 'ACTIVITY_TRAINING_REQUIRED'
    && error.message.includes('To be completed by: Installer.') && !error.message.includes('Business owner'));
  f.sql.exec(`UPDATE trade_team_members SET service_states='["NSW"]' WHERE id='installer-member'`);
  await assert.rejects(training.assertCertificateActivityEligibility(f.db, booking), error => error.code === 'MEMBER_SERVICE_REGION_REQUIRED' && error.trainingModules.length === 0);
});

const questionnaires = load('src/lib/training-questionnaire-store.ts');
const guidedActor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: 'veu-6' };
async function publishEditedCourse(f, questionCount = 25) {
  const editable = await questionnaires.getTrainingQuestionnaire(f.db, 'veu-6');
  const course = structuredClone(editable.module);
  course.questions = course.questions.slice(0, questionCount);
  for (const item of [...course.questions, ...course.lessons]) if (!item.sourceIds.length) item.sourceIds = [course.sources[0].id];
  course.questions[0].prompt += ' Check the current form.';
  const saved = await questionnaires.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: course.id, expectedRevision: editable.revision, module: course });
  const published = await questionnaires.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: course.id, expectedRevision: saved.revision, sourcesChecked: true });
  return published.module;
}

test('guided checking saves a wrong answer, explains it, blocks skipping, and resumes the same corrected attempt', async () => {
  const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === guidedActor.moduleId);
  const attempt = await training.startTrainingAttempt(f.db, guidedActor);
  const answers = answerTokens(attempt, course); const [first, second] = attempt.questions;
  const wrong = first.options.find(option => option.id !== answers[first.id]).id;
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...guidedActor, attemptId: attempt.id, answers }), error => error.code === 'CHECK_ANSWERS_REQUIRED');
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: second.id, answer: answers[second.id] }), error => error.code === 'PREVIOUS_QUESTION_REQUIRED');
  const incorrect = await training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: wrong });
  const canonical = course.questions.find(question => question.id === first.id);
  assert.equal(incorrect.correct, false); assert.equal(incorrect.explanation, canonical.explanation);
  assert.equal(incorrect.correctAnswer, canonical.options.find(option => option.id === canonical.correctOptionId).text);
  const resumed = await training.startTrainingAttempt(f.db, guidedActor);
  assert.equal(resumed.id, attempt.id); assert.equal(resumed.answers[first.id], wrong); assert.deepEqual(resumed.feedback[first.id], incorrect);
  assert.deepEqual(Object.keys(resumed.feedback), [first.id], 'untouched questions must not reveal answers');
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: second.id, answer: answers[second.id] }), error => error.code === 'PREVIOUS_QUESTION_REQUIRED');
  const corrected = await training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: answers[first.id] });
  assert.equal(corrected.correct, true);
  assert.deepEqual(await training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: answers[first.id] }), corrected, 'retry of a checked answer is idempotent');
  await checkAll(f, guidedActor, attempt, course);
  const result = await training.submitTrainingAttempt(f.db, { ...guidedActor, attemptId: attempt.id, answers });
  assert.equal(result.scorePercent, 100); assert.equal(result.firstTryScorePercent, 96); assert.equal(result.passed, true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, 1);
  const stored = f.sql.prepare('SELECT * FROM trade_training_submissions').get(); const snapshot = JSON.parse(stored.snapshot_json);
  assert.equal(stored.owner_uid, guidedActor.ownerUid); assert.equal(stored.member_id, guidedActor.memberId);
  assert.equal(stored.score_percent, 100); assert.equal(stored.first_try_score_percent, 96);
  assert.equal(snapshot.questions.find(question => question.id === first.id).incorrectOptionIds.length, 1);
  assert.equal(snapshot.questions.find(question => question.id === first.id).prompt, canonical.prompt);
  assert.throws(() => f.sql.prepare("UPDATE trade_training_submissions SET reference='altered'").run(), /append-only/);
  assert.throws(() => f.sql.prepare('DELETE FROM trade_training_submissions').run(), /append-only/);
});

test('guided check rejects other businesses, people, sessions and question tokens without storing progress', async () => {
  const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === guidedActor.moduleId);
  const attempt = await training.startTrainingAttempt(f.db, guidedActor); const answers = answerTokens(attempt, course);
  const first = attempt.questions[0];
  for (const altered of [{ ownerUid: 'another-business' }, { memberId: 'installer-member' }, { actorUid: 'installer' }]) {
    await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, ...altered, attemptId: attempt.id, questionId: first.id, answer: answers[first.id] }), error => error.code === 'ATTEMPT_UNAVAILABLE');
  }
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: attempt.questions[1].options[0].id }), error => error.code === 'ANSWER_TOKEN_INVALID');
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: 'unknown', answer: answers[first.id] }), error => error.code === 'QUESTION_INVALID');
  assert.equal(f.sql.prepare('SELECT progress_json FROM trade_training_attempts').get().progress_json, '{}');
  f.sql.prepare("UPDATE trade_accounts SET service_states='[\"NSW\"]'").run();
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: answers[first.id] }), /CHECK constraint failed|service/i);
  assert.equal(f.sql.prepare('SELECT progress_json FROM trade_training_attempts').get().progress_json, '{}');
});

test('simultaneous completion retries return one immutable saved result and one completion', async () => {
  const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === guidedActor.moduleId);
  const attempt = await training.startTrainingAttempt(f.db, guidedActor); const answers = await checkAll(f, guidedActor, attempt, course);
  const commit = f.db.batch; const queued = []; let ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  f.db.batch = statements => new Promise((resolve, reject) => { queued.push({ statements, resolve, reject }); if (queued.length === 2) ready(); });
  const request = { ...guidedActor, attemptId: attempt.id, answers };
  const pending = Promise.all([training.submitTrainingAttempt(f.db, request), training.submitTrainingAttempt(f.db, request)]);
  await waiting; f.db.batch = commit;
  for (const item of queued) { try { item.resolve(await commit(item.statements)); } catch (error) { item.reject(error); } }
  const [first, second] = await pending;
  assert.deepEqual(second, first);
  assert.deepEqual(await training.submitTrainingAttempt(f.db, request), first, 'a lost response can be safely fetched by resubmitting');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_submissions').get().n, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_training_events WHERE event_type='training_completed'").get().n, 1);
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...request, actorUid: 'someone-else' }), error => error.code === 'ATTEMPT_UNAVAILABLE');
});

test('a published form change wins against a pending guided check or submit without awarding an old-version pass', async () => {
  for (const stage of ['check', 'submit']) {
    const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === guidedActor.moduleId);
    const attempt = await training.startTrainingAttempt(f.db, guidedActor); const answers = stage === 'submit' ? await checkAll(f, guidedActor, attempt, course) : answerTokens(attempt, course);
    const before = f.sql.prepare('SELECT progress_json FROM trade_training_attempts').get().progress_json;
    const commit = f.db.batch; let held; let ready; const waiting = new Promise(resolve => { ready = resolve; });
    f.db.batch = statements => new Promise((resolve, reject) => { held = { statements, resolve, reject }; ready(); });
    const pending = stage === 'check'
      ? training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: attempt.questions[0].id, answer: answers[attempt.questions[0].id] })
      : training.submitTrainingAttempt(f.db, { ...guidedActor, attemptId: attempt.id, answers });
    const rejected = assert.rejects(pending, /CHECK constraint failed/);
    await waiting; f.db.batch = commit; await publishEditedCourse(f);
    try { held.resolve(await commit(held.statements)); } catch (error) { held.reject(error); }
    await rejected;
    assert.equal(f.sql.prepare('SELECT progress_json FROM trade_training_attempts').get().progress_json, before);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_submissions').get().n, 0);
    await assert.rejects(training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: attempt.questions[0].id, answer: answers[attempt.questions[0].id] }), error => error.code === 'TRAINING_VERSION_CHANGED');
  }
});

test('variable-length published forms retain first-answer percentage and exact questions in the personal record', async () => {
  const f = fixture(); const course = await publishEditedCourse(f, 3);
  const attempt = await training.startTrainingAttempt(f.db, guidedActor); assert.equal(attempt.questions.length, 3);
  const answers = answerTokens(attempt, course); const first = attempt.questions[0];
  await training.checkTrainingAnswer(f.db, { ...guidedActor, attemptId: attempt.id, questionId: first.id, answer: first.options.find(option => option.id !== answers[first.id]).id });
  await checkAll(f, guidedActor, attempt, course);
  const result = await training.submitTrainingAttempt(f.db, { ...guidedActor, attemptId: attempt.id, answers });
  const stored = f.sql.prepare('SELECT first_try_score_percent,snapshot_json,result_json FROM trade_training_submissions').get();
  assert.equal(result.scorePercent, 100); assert.equal(result.firstTryScorePercent, 66);
  assert.equal(stored.first_try_score_percent, result.firstTryScorePercent);
  assert.equal(JSON.parse(stored.snapshot_json).firstTryScorePercent, result.firstTryScorePercent);
  assert.equal(JSON.parse(stored.snapshot_json).questions.length, 3);
  assert.deepEqual(JSON.parse(stored.result_json), result);
  await publishEditedCourse(f, 2);
  assert.equal(JSON.parse(f.sql.prepare('SELECT snapshot_json FROM trade_training_submissions').get().snapshot_json).questions.length, 3, 'publishing must not rewrite a submitted form');
});

test('the check API binds the authenticated person and saves only their exact question response', async () => {
  const f = fixture(); const route = trainingRoute(f); const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  const start = await route.POST(new Request('https://example.test/api/trade-training', { method: 'POST', body: JSON.stringify({ action: 'start', moduleId: course.id }) }));
  assert.equal(start.status, 200); const attempt = (await start.json()).attempt;
  const question = attempt.questions[0]; const answers = answerTokens(attempt, course);
  const response = await route.POST(new Request('https://example.test/api/trade-training', { method: 'POST', body: JSON.stringify({ action: 'check', attemptId: attempt.id, questionId: question.id, answer: answers[question.id] }) }));
  assert.equal(response.status, 200); assert.equal((await response.json()).feedback.correct, true);
  const progress = JSON.parse(f.sql.prepare('SELECT progress_json FROM trade_training_attempts').get().progress_json);
  assert.deepEqual(Object.keys(progress), [question.id]); assert.equal(progress[question.id].answer, answers[question.id]);
  const foreign = await route.POST(new Request('https://example.test/api/trade-training', { method: 'POST', headers: { Origin: 'https://untrusted.test' }, body: JSON.stringify({ action: 'check', attemptId: attempt.id, questionId: question.id, answer: answers[question.id] }) }));
  assert.equal(foreign.status, 403);
});

test('a wrong answer late in VEU 15 returns feedback, keeps earlier progress and allows correction in the same attempt', async () => {
  const f = fixture(); const route = trainingRoute(f);
  f.sql.prepare('UPDATE trade_accounts SET capabilities=?').run('["draught-proofing"]');
  const course = TRAINING_MODULES.find(course => course.id === 'veu-15');
  const post = body => route.POST(new Request('https://example.test/api/trade-training', { method: 'POST', body: JSON.stringify(body) }));
  const start = await post({ action: 'start', moduleId: course.id });
  assert.equal(start.status, 200);
  const attempt = (await start.json()).attempt; const answers = answerTokens(attempt, course);
  for (const question of attempt.questions.slice(0, 21)) {
    const response = await post({ action: 'check', attemptId: attempt.id, questionId: question.id, answer: answers[question.id] });
    assert.equal(response.status, 200); assert.equal((await response.json()).feedback.correct, true);
  }
  const question = attempt.questions[21]; const next = attempt.questions[22];
  const wrong = question.options.find(option => option.id !== answers[question.id]).id;
  const input = { action: 'check', attemptId: attempt.id, questionId: question.id, answer: wrong };
  const response = await post(input); assert.equal(response.status, 200);
  const feedback = (await response.json()).feedback;
  assert.equal(feedback.correct, false); assert.ok(feedback.explanation); assert.ok(feedback.correctAnswer);
  assert.deepEqual((await (await post(input)).json()).feedback, feedback, 'retrying a lost wrong-answer response gives the same feedback');
  const blocked = await post({ action: 'check', attemptId: attempt.id, questionId: next.id, answer: answers[next.id] });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'PREVIOUS_QUESTION_REQUIRED');
  const resumed = (await (await post({ action: 'start', moduleId: course.id })).json()).attempt;
  assert.equal(resumed.id, attempt.id); assert.equal(Object.keys(resumed.answers).length, 22);
  assert.equal(resumed.feedback[question.id].correct, false);
  const corrected = await post({ ...input, answer: answers[question.id] });
  assert.equal((await corrected.json()).feedback.correct, true);
  for (const remaining of attempt.questions.slice(22)) await post({ action: 'check', attemptId: attempt.id, questionId: remaining.id, answer: answers[remaining.id] });
  const submitted = await post({ action: 'submit', attemptId: attempt.id, answers });
  assert.equal(submitted.status, 200);
  const result = (await submitted.json()).result;
  assert.equal(result.passed, true); assert.equal(result.scorePercent, 100); assert.equal(result.firstTryScorePercent, 96);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, 1);
});

test('saved answers belong to the learner and team status never discloses another persons completed form', async () => {
  const f = fixture(); await pass(f); await pass(f, 'installer-member');
  const rows = f.sql.prepare('SELECT id,member_id FROM trade_training_submissions ORDER BY member_id').all();
  const own = rows.find(row => row.member_id === 'owner-member'); const staff = rows.find(row => row.member_id === 'installer-member');
  const ownerRoute = trainingRoute(f); const staffRoute = trainingRoute(f, { memberId: 'installer-member', actorUid: 'installer', isOwner: false, canManageTeam: true });
  const ownList = await ownerRoute.GET(new Request('https://example.test/api/trade-training'));
  const data = await ownList.json(); assert.deepEqual(data.submissions.map(row => row.id), [own.id]);
  assert.ok(data.submissions.every(row => !('snapshot' in row)));
  const status = await ownerRoute.GET(new Request('https://example.test/api/trade-training?memberId=installer-member'));
  assert.deepEqual((await status.json()).submissions, []);
  for (const [route, submissionId] of [[ownerRoute, staff.id], [staffRoute, own.id], [trainingRoute(f, { ownerUid: 'another-business' }), own.id]]) {
    const denied = await route.GET(new Request(`https://example.test/api/trade-training?submissionId=${submissionId}`));
    assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { ok: false, code: 'TRAINING_SELF_ONLY' });
  }
  const ownDetail = await ownerRoute.GET(new Request(`https://example.test/api/trade-training?submissionId=${own.id}`));
  assert.equal(ownDetail.status, 200); assert.equal((await ownDetail.json()).submission.snapshot.questions.length, 25);
});
