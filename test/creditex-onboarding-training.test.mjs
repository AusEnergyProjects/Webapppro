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
    INSERT INTO trade_team_members VALUES ('owner-member','owner','active','Owner','owner','[]'),('installer-member','owner','active','Installer','installer','["heating-cooling","insulation","hot-water"]');`);
  sql.exec(fs.readFileSync('drizzle/0116_trade_crm_write_guard.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0176_creditex_onboarding_training.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0177_autonomous_activity_training.sql', 'utf8'));
  sql.exec(fs.readFileSync('drizzle/0178_autonomous_business_onboarding.sql', 'utf8'));
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
async function approveBusiness(f) {
  seedDocuments(f.sql);
  await onboarding.saveCreditexApplication(f.db,'owner','owner',0,application());
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
async function pass(f, memberId='owner-member', moduleId='veu-6') {
  const course = TRAINING_MODULES.find(item => item.id === moduleId);
  const actor = {ownerUid:'owner',memberId,actorUid:memberId,moduleId};
  const attempt = await training.startTrainingAttempt(f.db,actor);
  return training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:answerTokens(attempt,course)});
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
  const attempt = await training.startTrainingAttempt(f.db,{ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id});
  assert.equal(attempt.questions.length, 25);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_module_reviews').get().n, 0);
  await assert.rejects(training.reviewTrainingModule(f.db,'reviewer',{action:'activate_module',moduleId:course.id,expectedVersion:course.version,expectedHash:'wrong'}),error=>error.code==='TRAINING_VERSION_CHANGED');
  await activate(f);
  await assert.rejects(training.reviewTrainingModule(f.db,'reviewer',{action:'withdraw_module',moduleId:course.id,expectedVersion:course.version,expectedHash:training.getTrainingModuleHash(course),expectedReviewUpdatedAt:'',reviewNote:'Old tab'}),error=>error.code==='TRAINING_REVIEW_CONFLICT');
});
test('attempt projection conceals answer keys, persists opaque options, rejects cross-attempt/person/question tokens and replay', async () => {
  const f=fixture(); const course=await activate(f);
  const actor={ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id};
  const attempt=await training.startTrainingAttempt(f.db,actor);
  assert.equal(attempt.questions.length,25); assert.equal(JSON.stringify(attempt).includes('correctOptionId'),false); assert.equal(JSON.stringify(attempt).includes('explanation'),false);
  assert.ok(attempt.questions.every(question=>question.options.every(option=>/^[0-9a-f-]{36}$/.test(option.id))));
  assert.deepEqual(await training.startTrainingAttempt(f.db,actor),attempt);
  const answers=answerTokens(attempt,course);
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,memberId:'installer-member',attemptId:attempt.id,answers}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:{...answers,[attempt.questions[0].id]:attempt.questions[1].options[0].id}}),error=>error.code==='ANSWER_TOKEN_INVALID');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:Object.fromEntries(course.questions.map(q=>[q.id,q.correctOptionId]))}),error=>error.code==='ANSWER_TOKEN_INVALID');
  const passed=await training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers});
  assert.equal(passed.passed,true); assert.equal(passed.scorePercent,100); assert.equal(passed.feedback.length,25); assert.match(passed.reference,/^TL-CX-TRAIN-/);
  await assert.rejects(training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers}),error=>error.code==='ATTEMPT_UNAVAILABLE');
});
test('every question must be correct and unlimited immediate retakes remain available', async () => {
  const f=fixture(); const course=await activate(f); const critical=course.questions.find(q=>q.critical);
  const actor={ownerUid:'owner',memberId:'owner-member',actorUid:'owner-member',moduleId:course.id}; const attempt=await training.startTrainingAttempt(f.db,actor);
  const wrong=critical.options.find(option=>option.id!==critical.correctOptionId).id;
  const result=await training.submitTrainingAttempt(f.db,{...actor,attemptId:attempt.id,answers:answerTokens(attempt,course,{[critical.id]:wrong})});
  assert.equal(result.scorePercent,96); assert.equal(result.criticalPassed,false); assert.equal(result.passed,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_completions').get().n,0);
  for (let i=0;i<5;i++) {
    const retake=await training.startTrainingAttempt(f.db,actor);
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
  const original=await training.startTrainingAttempt(f.db,web);
  const other=await training.startTrainingAttempt(f.db,{...web,memberId:'owner-member',actorUid:'owner'});
  await assert.rejects(training.startTrainingAttempt(f.db,{...pin,ownerUid:'another-business'}),error=>error.code==='ACTIVITY_CAPABILITY_REQUIRED');
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'in_progress');
  const replacement=await training.startTrainingAttempt(f.db,pin);
  assert.notEqual(replacement.id,original.id);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'expired');
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(other.id).status,'in_progress');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...web,attemptId:original.id,answers:answerTokens(original,course)}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...web,attemptId:replacement.id,answers:answerTokens(replacement,course)}),error=>error.code==='ATTEMPT_UNAVAILABLE');
  await assert.rejects(training.submitTrainingAttempt(f.db,{...pin,attemptId:replacement.id,answers:answerTokens(original,course)}),error=>error.code==='ANSWER_TOKEN_INVALID');
  const returnedToWeb=await training.startTrainingAttempt(f.db,web);
  assert.notEqual(returnedToWeb.id,replacement.id);
  assert.deepEqual(await training.startTrainingAttempt(f.db,web),returnedToWeb);
  assert.equal((await training.submitTrainingAttempt(f.db,{...web,attemptId:returnedToWeb.id,answers:answerTokens(returnedToWeb,course)})).passed,true);
  const event=f.sql.prepare("SELECT metadata_json FROM trade_training_events WHERE event_type='attempt_started' AND actor_uid='installer' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(event.metadata_json).supersededAttemptId,replacement.id);
});

test('concurrent handoffs replace only the observed attempt and create one active assessment', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await training.startTrainingAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); const queued=[];
  f.db.batch=statements=>new Promise((resolve,reject)=>{queued.push({statements,resolve,reject});if(queued.length===2)ready();});
  const outcomes=Promise.allSettled([training.startTrainingAttempt(f.db,pin),training.startTrainingAttempt(f.db,pin)]);
  await waiting; f.db.batch=commit;
  for(const request of queued) { try { request.resolve(await commit(request.statements)); } catch(error) { request.reject(error); } }
  const results=await outcomes; assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.match(results.find(result=>result.status==='rejected').reason.message,/CHECK constraint failed/i);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM trade_training_attempts WHERE member_id='installer-member' AND status='in_progress'").get().n,1);
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(original.id).status,'expired');
  assert.deepEqual(await training.startTrainingAttempt(f.db,pin),results.find(result=>result.status==='fulfilled').value);
});

test('a handoff winning the commit race rejects the original already-read submission without creating completion', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await training.startTrainingAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); let held;
  f.db.batch=statements=>new Promise((resolve,reject)=>{held={statements,resolve,reject};ready();});
  const pending=training.submitTrainingAttempt(f.db,{...web,attemptId:original.id,answers:answerTokens(original,course)});
  const rejected=assert.rejects(pending,/CHECK constraint failed/i);
  await waiting; f.db.batch=commit; const replacement=await training.startTrainingAttempt(f.db,pin);
  try { held.resolve(await commit(held.statements)); } catch(error) { held.reject(error); }
  await rejected;
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM trade_training_completions').get().n,0);
  assert.equal((await training.submitTrainingAttempt(f.db,{...pin,attemptId:replacement.id,answers:answerTokens(replacement,course)})).passed,true);
});

test('an original submission winning the commit race preserves its pass and rejects the stale handoff', async () => {
  const f=fixture(); const course=await activate(f);
  const web={ownerUid:'owner',memberId:'installer-member',actorUid:'installer',moduleId:course.id};
  const pin={...web,actorUid:'field-member:installer-member'};
  const original=await training.startTrainingAttempt(f.db,web); const commit=f.db.batch;
  let ready; const waiting=new Promise(resolve=>{ready=resolve;}); let held;
  f.db.batch=statements=>new Promise((resolve,reject)=>{held={statements,resolve,reject};ready();});
  const pending=training.startTrainingAttempt(f.db,pin); const rejected=assert.rejects(pending,/CHECK constraint failed/i);
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
test('new team members block certificate leads and suspended/expired/withdrawn evidence blocks existing passes', async () => {
  const f=fixture(); await approveBusiness(f); await activate(f); await pass(f); await pass(f,'installer-member');
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:['veu-6']})).eligible,true);
  f.sql.prepare("INSERT INTO trade_team_members VALUES ('new','owner','active','New member','new','[\"heating-cooling\"]')").run();
  assert.equal((await training.getBusinessCertificateLeadEligibility(f.db,{ownerUid:'owner',activityTemplateIds:['veu-6']})).eligible,false);
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
  f.sql.prepare("INSERT INTO trade_team_members VALUES ('roster-only','owner','active','New colleague','','[\"hot-water\"]')").run();
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

test('member projection rejects unauthorised, inactive and cross-business targets without data disclosure', async () => {
  const f = fixture();
  f.sql.prepare("INSERT INTO trade_team_members VALUES ('foreign','other-owner','active','Private person','private-uid','[\"hot-water\"]'),('inactive','owner','suspended','Suspended person','suspended-uid','[\"hot-water\"]')").run();
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
    for (const action of ['start', 'submit']) {
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
  await assert.rejects(training.startTrainingAttempt(f.db, actor), /CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_attempts').get().n, 0);
  f.db.batch = commit;
  f.sql.prepare("UPDATE trade_team_members SET capabilities='[\"heating-cooling\"]' WHERE id='installer-member'").run();
  const attempt = await training.startTrainingAttempt(f.db, actor);
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

test('autonomous training rejects 96%, permits an immediate 100% retry and enables jobs without fabricated review rows', async () => {
  const f = fixture(); await approveBusiness(f);
  const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
  const first = await training.startTrainingAttempt(f.db, actor);
  const question = course.questions.find(question => !question.critical);
  const failed = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: first.id, answers: answerTokens(first, course, { [question.id]: question.options.find(option => option.id !== question.correctOptionId).id }) });
  assert.equal(failed.scorePercent, 96); assert.equal(failed.passed, false); assert.equal(failed.reference, '');
  assert.match(failed.meaning, /not passed/);
  const retry = await training.startTrainingAttempt(f.db, actor);
  const result = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: retry.id, answers: answerTokens(retry, course) });
  assert.equal(result.scorePercent, 100); assert.equal(result.passed, true); assert.ok(!('programmeApprovalPending' in result));
  assert.match(result.meaning, /TLink learning completion/);
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
  await assert.rejects(training.startTrainingAttempt(f.db, { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: partial.id }), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
  const response = await trainingRoute(f).GET(new Request('https://example.test/api/trade-training'));
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('creditex-review'));
  assert.ok(!JSON.stringify(body).includes('creditex-source-review.md'));
  const result = await pass(f);
  assert.ok(result.feedback.every(item => !item.sourceIds.includes('creditex-review')));
  assert.deepEqual(TRAINING_MODULES.map(training.getTrainingModuleHash), originalHashes);
  assert.ok(TRAINING_MODULES.some(course => course.sources.some(source => source.id === 'creditex-review')), 'internal provenance remains retained server-side');
});

test('current source-backed assessments and recorded passes require an exact valid 25-question 100% result', async () => {
  const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  assert.equal(training.isTrainingModuleReady(course), true);
  for (const change of [value => { value.questions.pop(); }, value => { value.passPercent = 96; }, value => { value.questions[0].options[1].id = value.questions[0].options[0].id; }, value => { value.sourceCoverage.status = 'partial'; }]) {
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
    const attempt = await training.startTrainingAttempt(f.db, actor);
    f.sql.prepare(`UPDATE trade_training_module_reviews SET ${column}=?`).run(value);
    if (column === 'status') {
      await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
      await assert.rejects(training.startTrainingAttempt(f.db, actor), error => error.code === 'TRAINING_ASSESSMENT_UNAVAILABLE');
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 0);
    } else {
      const result = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) });
      assert.equal(result.passed, true);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 1);
    }
  }
  const f = fixture(); const course = TRAINING_MODULES.find(course => course.id === 'veu-6');
  const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
  const attempt = await training.startTrainingAttempt(f.db, actor);
  f.sql.prepare('UPDATE trade_training_attempts SET content_hash=?').run('1'.repeat(64));
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), error => error.code === 'TRAINING_VERSION_CHANGED');
});

test('new withdrawal or changed review between read and commit rolls back pending assessment writes', async () => {
  for (const stage of ['start', 'submit']) {
    for (const reviewed of [false, true]) {
      const f = fixture(); const course = reviewed ? await activate(f) : TRAINING_MODULES.find(course => course.id === 'veu-6');
      const actor = { ownerUid: 'owner', memberId: 'owner-member', actorUid: 'owner', moduleId: course.id };
      const attempt = stage === 'submit' ? await training.startTrainingAttempt(f.db, actor) : null;
      const commit = f.db.batch;
      f.db.batch = async statements => {
        if (reviewed) f.sql.prepare("UPDATE trade_training_module_reviews SET updated_at=updated_at||'-changed'").run();
        else f.sql.prepare("INSERT INTO trade_training_module_reviews(module_id,version,content_hash,status,source_reviewed_on,review_expires_on,reviewed_by_uid,review_note,updated_at) VALUES (?,?,?,'withdrawn',?,?,?,'New withdrawal',?)").run(course.id, course.version, training.getTrainingModuleHash(course), today(), yearLater(), 'reviewer', new Date().toISOString());
        return commit(statements);
      };
      const operation = stage === 'start' ? training.startTrainingAttempt(f.db, actor) : training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) });
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
    assert.ok(scope.activities.some(activity => jurisdictions.get(activity.programCode) === 'AU'));
    assert.equal(scope.activities.some(activity => activity.programCode === 'VEU'), expected.includes('VIC'));
    assert.equal(scope.activities.some(activity => activity.programCode === 'NSW-ESS'), expected.includes('NSW'));
    const response = await trainingRoute(f).GET(new Request('https://example.test/api/trade-training'));
    assert.deepEqual((await response.json()).trainingServiceStates, expected);
  }
});

test('jurisdiction removal wins against assessment submission and blocks jobs despite a different address state', async () => {
  const f = fixture(); await approveBusiness(f); const course = await activate(f); await pass(f); await pass(f, 'installer-member');
  const actor = { ownerUid: 'owner', memberId: 'installer-member', actorUid: 'installer', moduleId: course.id };
  const attempt = await training.startTrainingAttempt(f.db, actor); const commit = f.db.batch;
  f.db.batch = async statements => { f.sql.prepare("UPDATE trade_accounts SET service_states='[\"NSW\"]',address_state='VIC'").run(); return commit(statements); };
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: answerTokens(attempt, course) }), /CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_training_completions').get().n, 2);
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false);
  await assert.rejects(training.startTrainingAttempt(f.db, actor), error => error.code === 'ACTIVITY_CAPABILITY_REQUIRED');
  f.db.batch = commit;
  f.sql.prepare("UPDATE trade_accounts SET service_states='[\"VIC\"]',address_state='NSW'").run();
  assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, true);
});
