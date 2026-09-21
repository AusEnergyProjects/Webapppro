import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';

const training = certificateTestDependency('trade-training-server');
const forms = certificateTestDependency('training-questionnaire-store');
const leads = certificateTestDependency('trade-certificate-leads');
class Statement {
  constructor(sql, query, values = []) { Object.assign(this, { sql, query, values }); }
  bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, this.query, values); }
  async first() { return this.sql.prepare(this.query).get(...this.values) || null; }
  async all() { return { results: this.sql.prepare(this.query).all(...this.values) }; }
  async run() { return { success: true, meta: { changes: Number(this.sql.prepare(this.query).run(...this.values).changes) } }; }
}
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync('drizzle/0004_mixed_chat.sql', 'utf8').match(/CREATE TABLE `admin_audit_log`[\s\S]*?;/)[0]);
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,abn TEXT,business_name TEXT,capabilities TEXT,service_states TEXT,address_state TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,status TEXT,display_name TEXT,member_uid TEXT,capabilities TEXT);
    INSERT INTO trade_accounts VALUES('owner','53004085616','Example Pty Ltd','["hot-water"]','["VIC"]','VIC');
    INSERT INTO trade_team_members VALUES('owner-person','owner','active','Owner','owner','["hot-water"]'),('installer','owner','active','Installer','installer','["hot-water"]');`);
  installCreditexTrainingFixture(sql);
  const db = { prepare: query => new Statement(sql, query), batch: async statements => {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db };
}
async function additional(f, { jurisdictions = ['VIC'], serviceCategory = 'hot-water', draftOnly = false } = {}) {
  const saved = await forms.saveTrainingQuestionnaire(f.db, 'editor', { expectedRevision: 0,
    module: { title: 'Additional installer checks', programCode: 'SRES', activityTemplateIds: [], estimatedMinutes: 10, validityDays: 365, scope: 'Record the installation properly.',
      sources: [{ id: 'guide', title: 'Installation evidence', url: 'https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme' }],
      lessons: [{ title: 'Check the label', body: 'Read the label on the actual installed system.', sourceIds: ['guide'] }],
      questions: [{ id: 'label', prompt: 'Which label do you photograph?', options: [{ id: 'actual', text: 'The label on the installed system.' }, { id: 'another', text: 'A label from another job.' }], correctOptionId: 'actual', explanation: 'A photograph of the actual installation connects the evidence to the system at this property.', sourceIds: ['guide'] }] },
    assignment: { kind: 'additional', serviceCategory, jurisdictions, activityLabel: 'Additional installation checks' } });
  return draftOnly ? saved : forms.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: saved.revision, sourcesChecked: true });
}
async function bookable(f, activityTemplateIds = ['veu-1']) {
  const predicate = await training.certificateActivityEligibilityPredicate({ ownerUid: 'owner', actorMemberId: 'owner-person', assignedMemberId: 'installer', activityTemplateIds });
  return Boolean(await f.db.prepare(`SELECT 1 ok WHERE ${predicate.sql}`).bind(...predicate.bindings).first());
}
const leadable = f => leads.certificateLeadEligible(f.db, 'owner', ['hot-water'], 'VIC');
const booking = { ownerUid: 'owner', actorMemberId: 'owner-person', assignedMemberId: 'installer', activityTemplateIds: ['veu-1'], serviceState: 'VIC' };
async function pass(f, course, memberId) {
  const actor = { ownerUid: 'owner', memberId, actorUid: memberId === 'owner-person' ? 'owner' : 'installer', moduleId: course.id };
  const attempt = await training.startTrainingAttempt(f.db, actor); const answers = {};
  for (const question of attempt.questions) {
    const canonical = course.questions.find(item => item.id === question.id);
    const text = canonical.options.find(option => option.id === canonical.correctOptionId).text;
    answers[question.id] = question.options.find(option => option.text === text).id;
    const feedback = await training.checkTrainingAnswer(f.db, { ...actor, attemptId: attempt.id, questionId: question.id, answer: answers[question.id] }); assert.equal(feedback.correct, true);
  }
  const result = await training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers }); assert.equal(result.passed, true);
  return result;
}

test('retired built-in learning is no longer required by booking, member scope or projections, with business and technician gates retained', async () => {
  const f = fixture();
  f.sql.exec("UPDATE trade_training_completions SET revoked_at='2026-09-21' WHERE module_id='veu-1'");
  assert.equal(await bookable(f), false);
  await forms.retireTrainingQuestionnaire(f.db, 'editor', { moduleId: 'veu-1', expectedRevision: 0 });
  assert.equal(await bookable(f), true);
  assert.deepEqual(await training.getCertificateActivityEligibility(f.db, booking), { eligible: true, reasons: [] });
  assert.equal((await training.getMemberTrainingScope(f.db, 'owner', 'installer')).assignedModuleIds.includes('veu-1'), false);
  assert.equal((await training.getTrainingModulesForMember(f.db, 'owner', 'installer')).some(module => module.id === 'veu-1'), false);
  await assert.rejects(training.startTrainingAttempt(f.db, { ownerUid: 'owner', memberId: 'installer', actorUid: 'installer', moduleId: 'veu-1' }), error => error.code === 'TRAINING_MODULE_RETIRED');
  for (const [change, undo] of [
    ["UPDATE trade_team_members SET capabilities='[]' WHERE id='installer'", "UPDATE trade_team_members SET capabilities='[\"hot-water\"]' WHERE id='installer'"],
    ["UPDATE trade_accounts SET capabilities='[]'", "UPDATE trade_accounts SET capabilities='[\"hot-water\"]'"],
    ["UPDATE trade_team_members SET service_states='[\"NSW\"]' WHERE id='installer'", "UPDATE trade_team_members SET service_states=NULL WHERE id='installer'"],
    ["UPDATE trade_team_members SET status='disabled' WHERE id='installer'", "UPDATE trade_team_members SET status='active' WHERE id='installer'"],
    ["UPDATE creditex_business_onboarding SET status='suspended'", "UPDATE creditex_business_onboarding SET status='approved'"],
  ]) {
    f.sql.exec(change); assert.equal(await bookable(f), false, change); assert.equal((await training.getCertificateActivityEligibility(f.db, booking)).eligible, false, change); f.sql.exec(undo);
  }
  assert.equal(await bookable(f), true);
  assert.equal(await bookable(f, ['invented']), false);
});

test('retirement removes published additional requirements and never hides a different active module requirement', async () => {
  const f = fixture(); const extra = await additional(f); assert.equal(await bookable(f), false);
  await forms.retireTrainingQuestionnaire(f.db, 'editor', { moduleId: 'veu-1', expectedRevision: 0 });
  assert.equal(await bookable(f), false, 'retiring built-in training does not waive active additional training');
  const blocked = await training.getCertificateActivityEligibility(f.db, booking);
  assert.deepEqual(blocked.reasons.map(reason => reason.moduleId), [extra.module.id]);
  await forms.retireTrainingQuestionnaire(f.db, 'editor', { moduleId: extra.module.id, expectedRevision: extra.revision });
  assert.equal(await bookable(f), true);
  assert.deepEqual(await training.getCertificateActivityEligibility(f.db, booking), { eligible: true, reasons: [] });
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_versions WHERE module_id=?').get(extra.module.id).n, 1);
});

test('retirement blocks in-progress answer and completion writes and atomic guards even when the old module was already read', async () => {
  const f = fixture(); const extra = await additional(f); const actor = { ownerUid: 'owner', memberId: 'installer', actorUid: 'installer', moduleId: extra.module.id };
  const attempt = await training.startTrainingAttempt(f.db, actor);
  const guard = forms.currentTrainingModuleGuard(extra.module);
  assert.ok(await f.db.prepare(`SELECT 1 ok WHERE ${guard.sql}`).bind(...guard.bindings).first());
  await forms.retireTrainingQuestionnaire(f.db, 'editor', { moduleId: extra.module.id, expectedRevision: extra.revision });
  assert.equal(await f.db.prepare(`SELECT 1 ok WHERE ${guard.sql}`).bind(...guard.bindings).first(), null);
  const question = attempt.questions[0];
  await assert.rejects(training.checkTrainingAnswer(f.db, { ...actor, attemptId: attempt.id, questionId: question.id, answer: question.options[0].id }), error => error.code === 'TRAINING_MODULE_RETIRED');
  await assert.rejects(training.submitTrainingAttempt(f.db, { ...actor, attemptId: attempt.id, answers: { [question.id]: question.options[0].id } }), error => error.code === 'TRAINING_MODULE_RETIRED');
  assert.equal(f.sql.prepare('SELECT status FROM trade_training_attempts WHERE id=?').get(attempt.id).status, 'in_progress');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_completions WHERE module_id=?').get(extra.module.id).n, 0);
});

test('a published extra form blocks certificate booking until each required person passes while leads remain available', async () => {
  const f = fixture(); assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
  const saved = await additional(f, { draftOnly: true }); assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
  const published = await forms.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: saved.revision, sourcesChecked: true });
  assert.equal(await bookable(f), false); assert.equal(await leadable(f), true);
  const blocked = await training.getCertificateActivityEligibility(f.db, { ownerUid: 'owner', actorMemberId: 'owner-person', assignedMemberId: 'installer', activityTemplateIds: ['veu-1'], serviceState: 'VIC' });
  assert.equal(blocked.eligible, false);
  assert.deepEqual(blocked.reasons.map(({ code, moduleId, moduleTitle, trainingHref }) => ({ code, moduleId, moduleTitle, trainingHref })), [{
    code: 'ACTIVITY_TRAINING_REQUIRED', moduleId: published.module.id, moduleTitle: published.module.title,
    trainingHref: `/direct-trade/dashboard?workspace=training&module=${encodeURIComponent(published.module.id)}`,
  }]);
  assert.ok(blocked.reasons[0].message.includes(published.module.title), 'the booking names the extra form that must be completed');
  await pass(f, published.module, 'owner-person'); assert.equal(await bookable(f), false); assert.equal(await leadable(f), true);
  await pass(f, published.module, 'installer'); assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
  assert.equal(await bookable(f, [published.module.id]), false, 'a custom learning form never invents a government certificate pathway');
});

test('extra training is scoped to the actual service and states, including national certificate activities', async () => {
  const f = fixture(); await additional(f, { jurisdictions: ['NSW'] }); await additional(f, { serviceCategory: 'solar' });
  assert.equal(await bookable(f), true); assert.equal(await bookable(f, ['sres-ashp']), true); assert.equal(await leadable(f), true);
  f.sql.exec("UPDATE trade_accounts SET service_states='[\"VIC\",\"NSW\"]'");
  assert.equal(await bookable(f), true, 'VIC activity does not impose a NSW-only course');
  assert.equal(await bookable(f, ['sres-ashp']), false, 'national work includes the business declared service states');
  assert.equal(await leadable(f), true, 'VIC leads do not impose NSW-only training');
  const nationwide = await additional(f, { jurisdictions: ['AU'] });
  assert.equal(await bookable(f), false); assert.equal(await leadable(f), true);
  await pass(f, nationwide.module, 'owner-person'); await pass(f, nationwide.module, 'installer');
  assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
});

test('publishing an updated extra form invalidates previous training for booking without restricting leads', async () => {
  const f = fixture(); const original = await additional(f); await pass(f, original.module, 'owner-person'); await pass(f, original.module, 'installer');
  assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
  const saved = await forms.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: original.module.id, expectedRevision: original.revision, module: { ...original.module, title: 'Updated installation checks' } });
  assert.equal(await bookable(f), true); assert.equal(await leadable(f), true, 'unpublished edits leave current eligibility alone');
  const next = await forms.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: saved.revision, sourcesChecked: true });
  assert.equal(await bookable(f), false); assert.equal(await leadable(f), true);
  await pass(f, next.module, 'owner-person'); await pass(f, next.module, 'installer');
  assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
});

test('withdrawal or personal revocation of an extra form blocks certificate booking while leads remain available', async () => {
  for (const kind of ['withdrawal', 'revocation']) {
    const f = fixture(); const published = await additional(f); await pass(f, published.module, 'owner-person'); await pass(f, published.module, 'installer');
    assert.equal(await bookable(f), true); assert.equal(await leadable(f), true);
    if (kind === 'withdrawal') await training.reviewTrainingModule(f.db, 'editor', { action: 'withdraw_module', moduleId: published.module.id, expectedVersion: published.module.version, expectedHash: training.getTrainingModuleHash(published.module), expectedReviewUpdatedAt: '', reviewNote: 'The installation rule changed.' });
    else { const completion = f.sql.prepare('SELECT id FROM trade_training_completions WHERE module_id=? AND member_id=?').get(published.module.id, 'installer'); await training.revokeTrainingCompletion(f.db, 'editor', completion.id, 'This completion was recorded for the wrong person.'); }
    assert.equal(await bookable(f), false); assert.equal(await leadable(f), true);
    const blocked = await training.getCertificateActivityEligibility(f.db, { ownerUid: 'owner', actorMemberId: 'owner-person', assignedMemberId: 'installer', activityTemplateIds: ['veu-1'], serviceState: 'VIC' });
    assert.equal(blocked.eligible, false);
    assert.deepEqual(blocked.reasons.map(reason => reason.code), [kind === 'withdrawal' ? 'TRAINING_CONTENT_UNAVAILABLE' : 'ACTIVITY_TRAINING_REQUIRED']);
    assert.ok(blocked.reasons[0].message.includes(published.module.title), 'the booking identifies the withdrawn or revoked extra form');
  }
});

test('lead scope rejects empty, scalar and object JSON without treating them as service arrays', async () => {
  const f = fixture(); const predicate = leads.certificateLeadEligibilitySql('lead.owner_uid', 'lead.categories', 'lead.state');
  for (const categories of ['', 'not-json', 'null', 'true', '1', '"hot-water"', '{}', '{"0":"hot-water"}', '[]']) {
    const qualified = await f.db.prepare(`SELECT 1 FROM (SELECT 'owner' owner_uid,? categories,'VIC' state) lead WHERE ${predicate}`).bind(categories).first();
    assert.equal(qualified, null, categories);
  }
  assert.equal(await leadable(f), true);
});
