import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as curriculum from '../src/data/creditex-training-curriculum.ts';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
import * as onboarding from '../src/lib/creditex-onboarding-server.ts';
import * as services from '../src/lib/energy-service-catalogue.mjs';
import * as trainingSections from '../src/lib/training-service-sections.mjs';

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(dependencies[name], `Unknown dependency ${name}`); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const store = load('src/lib/training-questionnaire-store.ts', {
  'node:crypto': crypto, '../data/creditex-training-curriculum': curriculum,
  './australian-government-program-catalogue': catalogue, './creditex-onboarding-server': onboarding,
  './energy-service-catalogue.mjs': services,
  './training-service-sections.mjs': trainingSections,
});
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    CREATE TABLE trade_team_member_files(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT,category TEXT);
    INSERT INTO trade_accounts VALUES('owner','53004085616','Example Pty Ltd','["hot-water"]','["VIC"]','VIC');
    INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES('person','owner','active','Installer','actor','["hot-water"]');`);
  for (const file of ['0116_trade_crm_write_guard.sql', '0176_creditex_onboarding_training.sql', '0177_autonomous_activity_training.sql', '0178_autonomous_business_onboarding.sql', '0179_training_questionnaires.sql', '0180_team_member_service_states.sql']) sql.exec(fs.readFileSync(`drizzle/${file}`, 'utf8'));
  const db = { prepare: query => new Statement(sql, query), beforeBatch: null, batch: async statements => {
    const before = db.beforeBatch; db.beforeBatch = null; before?.();
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db };
}
function form() {
  return { title: 'Heat pump installation checks', programCode: 'VEU', activityTemplateIds: [], estimatedMinutes: 20, validityDays: 365, scope: 'Record the actual installed system.',
    sources: [{ id: 'guide', title: 'Official activity guide', url: 'https://www.esc.vic.gov.au/victorian-energy-upgrades' }],
    lessons: [{ title: 'Before you finish', body: 'Record the label and serial number of the installed system before leaving the site.', sourceIds: ['guide'] }],
    questions: [{ id: 'q1', prompt: 'Which serial number belongs in the job record?', options: [{ id: 'a', text: 'The number on the system installed at this property.' }, { id: 'b', text: 'The number from a similar system at another job.' }], correctOptionId: 'a', explanation: 'Use the actual installed system so the evidence matches this property. Another job cannot prove what you installed here.', sourceIds: ['guide'] }] };
}
const assignment = () => ({ kind: 'additional', serviceCategory: 'hot-water', jurisdictions: ['VIC'], activityLabel: 'Additional heat pump installation checks' });
const create = (f, questionnaireModule = form(), assigned = assignment()) => store.saveTrainingQuestionnaire(f.db, 'editor', { expectedRevision: 0, module: questionnaireModule, assignment: assigned });
const publish = (f, saved) => store.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: saved.revision, sourcesChecked: true });
const invalid = error => error.status === 400;
function seedAttempt(f, course, { id = 'attempt', status = 'passed', score = 100, memberId = 'person', actorUid = 'actor' } = {}) {
  f.sql.prepare(`INSERT INTO trade_training_attempts(id,owner_uid,member_id,actor_uid,module_id,version,content_hash,status,started_at,expires_at,submitted_at,assessment_json,score_percent,critical_passed,course_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'owner', memberId, actorUid, course.id, course.version, hash(course), status, new Date().toISOString(), '2099-12-31T00:00:00.000Z', new Date().toISOString(), JSON.stringify(course.questions.map(question => ({ questionId: question.id }))), score, status === 'passed' ? 1 : 0, JSON.stringify(course));
  return { attemptId: id, ownerUid: 'owner', memberId, actorUid, course, answers: Object.fromEntries(course.questions.map(question => [question.id, question.correctOptionId])), reference: 'TL-CX-EXAMPLE' };
}

test('catalogue forms remain available and editable without a database copy or internal notebook source', async () => {
  const f = fixture(); const all = await store.listTrainingQuestionnaires(f.db);
  assert.equal(all.length, curriculum.TRAINING_MODULES.length);
  const read = await store.getTrainingQuestionnaire(f.db, 'veu-6');
  assert.equal(read.revision, 0); assert.equal(read.assignment.kind, 'catalogue');
  assert.ok(read.module.sources.every(source => source.id !== 'creditex-review' && !source.url.endsWith('.md')));
  assert.deepEqual(await store.listCurrentTrainingModules(f.db), curriculum.TRAINING_MODULES);
  assert.equal(await store.loadTrainingModule(f.db, 'veu-6'), curriculum.TRAINING_MODULES.find(course => course.id === 'veu-6'));
});

test('only unused never-published custom drafts can be deleted and the deletion is audited atomically', async () => {
  const f = fixture(); const saved = await create(f);
  assert.equal((await store.listTrainingQuestionnaires(f.db)).find(item => item.id === saved.module.id).canDelete, true);
  assert.deepEqual(await store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: saved.revision }), { moduleId: saved.module.id, deleted: true });
  assert.equal((await store.listTrainingQuestionnaires(f.db)).some(item => item.id === saved.module.id), false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_events').get().n, 1);
  const audit = f.sql.prepare('SELECT * FROM admin_audit_log').get();
  assert.equal(audit.action, 'training_questionnaire.draft_delete'); assert.equal(audit.admin_uid, 'editor'); assert.equal(audit.entity_id, saved.module.id);
  assert.deepEqual(JSON.parse(audit.metadata), { title: saved.module.title, revision: 1, publishedHistoryDeleted: false });
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: 1 }), error => error.code === 'QUESTIONNAIRE_NOT_FOUND');
});

test('deletion protects required catalogue modules, published versions and any learner or review history', async () => {
  const f = fixture();
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: 'veu-6', expectedRevision: 0 }), error => error.code === 'DRAFT_DELETE_BLOCKED');
  const published = await publish(f, await create(f));
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: published.module.id, expectedRevision: published.revision }), error => error.code === 'DRAFT_DELETE_BLOCKED');
  for (const history of ['attempt', 'review', 'publication']) {
    const saved = await create(f);
    if (history === 'attempt') seedAttempt(f, saved.module, { id: 'unused-attempt', status: 'in_progress', score: 0 });
    if (history === 'review') f.sql.prepare("INSERT INTO trade_training_module_reviews VALUES (?,? ,?,'withdrawn','2026-09-01','2026-12-01','','reviewer','Retained review','2026-09-21')").run(saved.module.id, saved.module.version, hash(saved.module));
    if (history === 'publication') f.sql.prepare("INSERT INTO trade_training_questionnaire_events VALUES ('old-publication',?,'editor','published',1,'{}','2026-09-21')").run(saved.module.id);
    const summary = (await store.listTrainingQuestionnaires(f.db)).find(item => item.id === saved.module.id);
    assert.equal(summary.canDelete, false, history); assert.ok(summary.deleteBlockedReason);
    await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: 1 }), error => error.code === 'DRAFT_DELETE_BLOCKED');
  }
  assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_log').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_versions').get().n, 1);
});

test('revision conflicts, concurrent history changes and audit failures cannot partially delete a draft', async () => {
  const f = fixture(); const saved = await create(f); const body = { moduleId: saved.module.id, expectedRevision: 1 };
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { ...body, expectedRevision: 0 }), error => error.code === 'REVISION_CONFLICT');
  f.db.beforeBatch = () => seedAttempt(f, saved.module, { id: 'racing-attempt', status: 'in_progress', score: 0 });
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', body), /CHECK constraint/);
  assert.ok(await store.getTrainingQuestionnaire(f.db, saved.module.id));
  const second = await create(f);
  f.sql.exec("CREATE TRIGGER reject_delete_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT,'Audit unavailable'); END");
  await assert.rejects(store.deleteTrainingQuestionnaireDraft(f.db, 'editor', { moduleId: second.module.id, expectedRevision: 1 }), /Audit unavailable/);
  assert.ok(await store.getTrainingQuestionnaire(f.db, second.module.id));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_log').get().n, 0);
});

test('Other questionnaire sections persist as display metadata without changing service or state scope', async () => {
  const f = fixture();
  const saved = await create(f, form(), { ...assignment(), serviceCategory: 'other', trainingSection: 'pool-pumps' });
  assert.equal(saved.assignment.trainingSection, 'pool-pumps');
  await publish(f, saved);
  const current = (await store.listTrainingAssignments(f.db)).find(item => item.moduleId === saved.module.id);
  assert.equal(current.assignment.trainingSection, 'pool-pumps');
  assert.equal(current.assignment.serviceCategory, 'other');
  assert.deepEqual(current.assignment.jurisdictions, ['VIC']);
  assert.equal((await store.getTrainingQuestionnaire(f.db, 'veu-26')).assignment.trainingSection, 'pool-pumps');
  const legacy = await create(f, form(), { ...assignment(), serviceCategory: 'other' });
  assert.equal(legacy.assignment.trainingSection, 'other-training');
  await assert.rejects(create(f, form(), { ...assignment(), serviceCategory: 'other', trainingSection: 'invented' }), invalid);
  await assert.rejects(create(f, form(), { ...assignment(), trainingSection: 'pool-pumps' }), invalid);
});

test('saving and publishing a custom form preserves assignment, source evidence and immutable versions', async () => {
  const f = fixture(); const saved = await create(f);
  assert.equal(saved.revision, 1); assert.equal(saved.publishedVersion, ''); assert.equal(saved.assignment.kind, 'additional');
  assert.equal((await store.listCurrentTrainingModules(f.db)).length, curriculum.TRAINING_MODULES.length);
  await assert.rejects(store.loadTrainingModule(f.db, saved.module.id), error => error.code === 'TRAINING_MODULE_UNAVAILABLE');
  const published = await publish(f, saved); const original = await store.loadTrainingModule(f.db, saved.module.id);
  assert.equal(original.questions.length, 1); assert.equal(original.passPercent, 100); assert.equal(original.retakeCooldownMinutes, 0);
  assert.equal(original.sourceCoverage.status, 'source_transcribed'); assert.deepEqual(original.sources, form().sources);
  assert.equal((await store.listTrainingAssignments(f.db)).find(item => item.moduleId === original.id).assignment.jurisdictions[0], 'VIC');
  const edited = await store.saveTrainingQuestionnaire(f.db, 'editor-2', { moduleId: original.id, expectedRevision: 1, module: { ...published.module, title: 'New title' }, assignment: { ...assignment(), jurisdictions: ['NSW'] } });
  assert.equal((await store.loadTrainingModule(f.db, original.id)).title, original.title, 'drafts do not leak into learner course');
  assert.deepEqual(edited.assignment, saved.assignment, 'saved activity scope cannot be silently changed');
  const next = await publish(f, edited); assert.notEqual(next.module.version, original.version);
  assert.deepEqual(await store.loadTrainingModuleVersion(f.db, original.id, original.version, hash(original)), original);
  await assert.rejects(store.loadTrainingModuleVersion(f.db, original.id, original.version, 'a'.repeat(64)), error => error.code === 'TRAINING_VERSION_CHANGED');
  assert.equal((await store.listTrainingQuestionnaireVersions(f.db, original.id)).length, 2);
  assert.throws(() => f.sql.exec("UPDATE trade_training_questionnaire_versions SET course_json='{}'"), /append-only/);
  assert.throws(() => f.sql.exec('DELETE FROM trade_training_questionnaire_versions'), /append-only/);
  assert.throws(() => f.sql.exec('DELETE FROM trade_training_questionnaire_events'), /append-only/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_events').get().n, 4);
});

test('catalogue override only activates on publish and guards reject replaced course content', async () => {
  const f = fixture(); const original = curriculum.TRAINING_MODULES.find(course => course.id === 'veu-6');
  const current = course => { const guard = store.currentTrainingModuleGuard(course); return Boolean(f.sql.prepare(`SELECT 1 ok WHERE ${guard.sql}`).get(...guard.bindings)); };
  assert.equal(current(original), true);
  const read = await store.getTrainingQuestionnaire(f.db, original.id);
  const saved = await store.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: original.id, expectedRevision: 0, module: { ...read.module, title: 'Installer-friendly Activity 6' } });
  assert.equal(current(original), true);
  const published = await publish(f, saved);
  assert.equal(current(original), false); assert.equal(current(published.module), true);
  assert.equal(current({ ...published.module, title: 'Tampered source' }), false);
  assert.equal((await store.listCurrentTrainingModules(f.db)).length, curriculum.TRAINING_MODULES.length);
  assert.deepEqual(published.module.activityTemplateIds, original.activityTemplateIds);
});

test('editing wording preserves retained source provenance but changing a source URL drops the old evidence hash', () => {
  const original = { ...form(), id: 'original', version: 'v1', sources: [{ ...form().sources[0], version: 'Specification 25', citation: 'Section 6.1', retainedSha256: 'a'.repeat(64), retainedObservedOn: '2026-09-19', reviewedAt: '2026-09-19' }] };
  const changedQuestion = { ...original, questions: [{ ...original.questions[0], prompt: 'Which label should you photograph?' }], sources: [{ ...original.sources[0], retainedSha256: 'forged-value' }] };
  const saved = store.validateQuestionnaireModule(changedQuestion, original, 'original');
  assert.deepEqual(saved.sources[0], original.sources[0]);
  const changedSource = store.validateQuestionnaireModule({ ...changedQuestion, sources: [{ ...changedQuestion.sources[0], url: 'https://www.esc.vic.gov.au/changed-source' }] }, original, 'original');
  assert.equal(changedSource.sources[0].retainedSha256, undefined); assert.equal(changedSource.sources[0].citation, undefined); assert.equal(changedSource.sources[0].retainedObservedOn, undefined);
});

test('editable forms accept one to sixty questions and reject oversized forms', async () => {
  const f = fixture(); const questionnaireModule = form(); questionnaireModule.questions = Array.from({ length: 60 }, (_, index) => ({ ...questionnaireModule.questions[0], id: `q${index}` }));
  const saved = await publish(f, await create(f, questionnaireModule)); assert.equal(saved.module.questions.length, 60);
  questionnaireModule.questions.push({ ...questionnaireModule.questions[0], id: 'q60' }); await assert.rejects(create(f, questionnaireModule), invalid);
});

test('unfinished but well-formed draft content saves and cannot publish', async () => {
  const f = fixture(); const questionnaireModule = form(); questionnaireModule.questions[0].prompt = ''; questionnaireModule.questions[0].explanation = ''; questionnaireModule.questions[0].options.forEach(option => { option.text = ''; }); questionnaireModule.lessons[0].body = ''; questionnaireModule.sources[0].url = ''; questionnaireModule.sources[0].title = '';
  const saved = await create(f, questionnaireModule); assert.equal(saved.module.questions[0].prompt, '');
  await assert.rejects(publish(f, saved), invalid);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_versions').get().n, 0);
});

test('draft validation rejects malformed types, duplicate answers, wrong keys and unsafe sources', async () => {
  const f = fixture();
  const changes = [
    questionnaireModule => { questionnaireModule.questions = false; }, questionnaireModule => { questionnaireModule.lessons = {}; }, questionnaireModule => { questionnaireModule.sources = false; },
    questionnaireModule => { questionnaireModule.estimatedMinutes = true; }, questionnaireModule => { questionnaireModule.validityDays = '365'; }, questionnaireModule => { questionnaireModule.estimatedMinutes = 0; },
    questionnaireModule => { questionnaireModule.questions[0].correctOptionId = 'missing'; }, questionnaireModule => { questionnaireModule.questions[0].options[1].id = 'a'; },
    questionnaireModule => { questionnaireModule.questions[0].options[1].text = questionnaireModule.questions[0].options[0].text.toUpperCase(); },
    questionnaireModule => { questionnaireModule.questions[0].sourceIds = ['missing']; }, questionnaireModule => { questionnaireModule.questions[0].prompt = 12; },
    questionnaireModule => { questionnaireModule.sources[0].url = 'javascript:alert(1)'; }, questionnaireModule => { questionnaireModule.sources[0].url = 'https://example.test/note.md'; },
    questionnaireModule => { questionnaireModule.sources[0].url = '/creditex-resources/notes.md'; }, questionnaireModule => { questionnaireModule.sources[0].url = 'https://user:password@example.test'; },
    questionnaireModule => { questionnaireModule.title = 'bad\u0000title'; },
  ];
  for (const change of changes) { const questionnaireModule = form(); change(questionnaireModule); await assert.rejects(create(f, questionnaireModule), invalid); }
  for (const expectedRevision of [null, false, '', '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(store.saveTrainingQuestionnaire(f.db, 'editor', { expectedRevision, module: form(), assignment: assignment() }), invalid);
  for (const moduleId of [null, false, {}, 42]) await assert.rejects(store.saveTrainingQuestionnaire(f.db, 'editor', { moduleId, expectedRevision: 0, module: form(), assignment: assignment() }), invalid);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaires').get().n, 0);
});

test('publication requires referenced sources and explicitly checked publication intent', async () => {
  const f = fixture(); const questionnaireModule = form(); questionnaireModule.questions[0].sourceIds = []; questionnaireModule.lessons[0].sourceIds = []; questionnaireModule.sources = [];
  const saved = await create(f, questionnaireModule); await assert.rejects(publish(f, saved), invalid);
  await assert.rejects(store.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: 1, sourcesChecked: 'true' }), invalid);
  const normal = await create(f);
  await assert.rejects(store.publishTrainingQuestionnaire(f.db, 'editor', { moduleId: normal.module.id, expectedRevision: '1', sourcesChecked: true }), invalid);
});

test('new activities require real programme/service/state scope and cannot rebind existing activities', async () => {
  const f = fixture();
  for (const changed of [{ ...assignment(), jurisdictions: ['NSW'] }, { ...assignment(), jurisdictions: [] }, { ...assignment(), serviceCategory: 'invented' }, { ...assignment(), jurisdictions: ['AU', 'VIC'] }]) await assert.rejects(create(f, form(), changed), invalid);
  const questionnaireModule = form(); questionnaireModule.programCode = 'INVENTED'; await assert.rejects(create(f, questionnaireModule), invalid);
  const read = await store.getTrainingQuestionnaire(f.db, 'veu-6');
  await assert.rejects(store.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: 'veu-6', expectedRevision: 0, module: { ...read.module, activityTemplateIds: ['veu-48'] } }), invalid);
});

test('optimistic save and publish races roll back every draft/version/audit write', async () => {
  const f = fixture(); const saved = await create(f);
  await assert.rejects(store.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: 0, module: saved.module }), error => error.code === 'REVISION_CONFLICT');
  f.db.beforeBatch = () => f.sql.exec('UPDATE trade_training_questionnaires SET revision=2');
  await assert.rejects(store.saveTrainingQuestionnaire(f.db, 'other-editor', { moduleId: saved.module.id, expectedRevision: 1, module: { ...saved.module, title: 'Lost racing update' } }), /CHECK constraint/);
  assert.equal(f.sql.prepare('SELECT updated_by_uid FROM trade_training_questionnaires').get().updated_by_uid, 'editor');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_events').get().n, 1);
  f.db.beforeBatch = () => f.sql.exec('UPDATE trade_training_questionnaires SET revision=3');
  await assert.rejects(publish(f, { ...saved, revision: 2 }), /CHECK constraint/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaire_versions').get().n, 0);
  const published = await publish(f, { ...saved, revision: 3 });
  await assert.rejects(publish(f, published), error => error.code === 'QUESTIONNAIRE_ALREADY_PUBLISHED');
});

test('completed form snapshots preserve exact answers, corrections and source version per person', async () => {
  const f = fixture(); const questionnaireModule = form(); questionnaireModule.questions = Array.from({ length: 3 }, (_, index) => ({ ...questionnaireModule.questions[0], id: `q${index + 1}` }));
  const saved = await publish(f, await create(f, questionnaireModule)); const input = seedAttempt(f, saved.module); input.incorrectAnswers = { q1: ['b', 'b'] };
  await store.trainingSubmissionSnapshotStatement(f.db, input).run();
  const detail = await store.getTrainingSubmission(f.db, 'attempt');
  assert.equal(detail.ownerUid, 'owner'); assert.equal(detail.memberId, 'person'); assert.equal(detail.displayName, 'Installer');
  assert.equal(detail.scorePercent, 100); assert.equal(detail.firstTryScorePercent, 66); assert.deepEqual(detail.snapshot.questions[0].incorrectOptionIds, ['b']);
  assert.deepEqual(detail.snapshot.sources, questionnaireModule.sources); assert.equal(detail.version, saved.module.version);
  const edited = await store.saveTrainingQuestionnaire(f.db, 'editor', { moduleId: saved.module.id, expectedRevision: 1, module: { ...saved.module, title: 'Changed later' } }); await publish(f, edited);
  assert.equal((await store.getTrainingSubmission(f.db, 'attempt')).snapshot.title, questionnaireModule.title);
  assert.equal((await store.listTrainingSubmissions(f.db, { ownerUid: 'other' })).length, 0);
  assert.equal((await store.listTrainingSubmissions(f.db, { ownerUid: 'owner', memberId: 'person' })).length, 1);
  assert.throws(() => f.sql.exec("UPDATE trade_training_submissions SET snapshot_json='{}'"), /append-only/);
  assert.throws(() => f.sql.exec('DELETE FROM trade_training_submissions'), /append-only/);
});

test('snapshot guards reject cross-person/version/content and unfinished attempts', async () => {
  for (const change of [input => { input.ownerUid = 'other'; }, input => { input.memberId = 'other'; }, input => { input.actorUid = 'other'; }, input => { input.course = { ...input.course, version: 'other' }; }, input => { input.course = { ...input.course, title: 'Changed source' }; }]) {
    const f = fixture(); const published = await publish(f, await create(f)); const input = seedAttempt(f, published.module); change(input);
    await assert.rejects(store.trainingSubmissionSnapshotStatement(f.db, input).run(), /completed personal attempt/);
  }
  const f = fixture(); const published = await publish(f, await create(f)); const input = seedAttempt(f, published.module, { status: 'in_progress', score: 0 });
  await assert.rejects(store.trainingSubmissionSnapshotStatement(f.db, input).run(), /completed personal attempt/);
  assert.throws(() => store.trainingSubmissionSnapshotStatement(f.db, { ...input, answers: { q1: 'not-an-answer' } }), invalid);
  assert.throws(() => store.trainingSubmissionSnapshotStatement(f.db, { ...input, incorrectAnswers: { q1: ['a'] } }), invalid);
});

function route(f, { adminError = null, reviewerError = null } = {}) {
  const calls = { admin: 0, reviewer: 0 };
  const handlers = load('src/app/api/creditex-training-questionnaires/route.ts', {
    '../../../../db': { getD1: () => f.db },
    '@/lib/admin-server': { sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin, requireAdminIdentity: async (_request, roles) => { calls.admin++; assert.deepEqual(roles, ['owner', 'admin', 'reviewer']); if (adminError) throw adminError; return { uid: 'aea-editor' }; } },
    '@/lib/bounded-json-request': { readBoundedJsonRequest: request => request.json() },
    '@/lib/creditex-onboarding-api': { requireCreditexTrainingReviewer: async () => { calls.reviewer++; if (reviewerError) throw reviewerError; return { uid: 'creditex-editor' }; }, creditexJson: (body, status = 200) => Response.json(body, { status }), creditexApiError: error => Response.json({ ok: false, code: error.code || error.message }, { status: error.message === 'AUTH_REQUIRED' ? 401 : error.status || 503 }) },
    '@/lib/creditex-onboarding-server': onboarding, '@/lib/australian-government-program-catalogue': catalogue, '@/lib/energy-service-catalogue.mjs': services, '@/lib/training-questionnaire-store': store,
  });
  return { ...handlers, calls };
}
const post = (body, origin = 'https://example.test') => new Request('https://example.test/api/creditex-training-questionnaires', { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) });

test('AEA editors and independently authorised Creditex reviewers can save through the same endpoint', async () => {
  for (const adminError of [null, new Error('ADMIN_REQUIRED'), new Error('ROLE_REQUIRED')]) {
    const f = fixture(); const api = route(f, { adminError }); const response = await api.POST(post({ action: 'save_draft', expectedRevision: 0, module: form(), assignment: assignment() }));
    assert.equal(response.status, 200); assert.equal(api.calls.reviewer, adminError ? 1 : 0);
    assert.equal(f.sql.prepare('SELECT updated_by_uid FROM trade_training_questionnaires').get().updated_by_uid, adminError ? 'creditex-editor' : 'aea-editor');
  }
});

test('delete action keeps the existing editor and origin boundary and records the actual authorised actor', async () => {
  for (const adminError of [null, new Error('ADMIN_REQUIRED')]) {
    const f = fixture(); const saved = await create(f); const api = route(f, { adminError });
    const body = { action: 'delete_draft', moduleId: saved.module.id, expectedRevision: saved.revision };
    assert.equal((await api.POST(post(body, 'https://other.test'))).status, 403);
    assert.ok(await store.getTrainingQuestionnaire(f.db, saved.module.id));
    const denied = route(f, { adminError: new Error('ADMIN_SUSPENDED') });
    assert.equal((await denied.POST(post(body))).status, 403);
    const unauthorised = route(f, { adminError: new Error('ADMIN_REQUIRED'), reviewerError: new onboarding.CreditexComplianceError('CREDITEX_REVIEWER_REQUIRED', 'Denied', 403) });
    assert.equal((await unauthorised.POST(post(body))).status, 403);
    assert.ok(await store.getTrainingQuestionnaire(f.db, saved.module.id));
    const response = await api.POST(post(body)); assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, true);
    assert.equal(f.sql.prepare('SELECT admin_uid FROM admin_audit_log').get().admin_uid, adminError ? 'creditex-editor' : 'aea-editor');
  }
});

test('editor endpoint rejects cross-origin, unauthenticated, suspended, unverified and unauthorised access', async () => {
  const f = fixture(); const crossOrigin = route(f); assert.equal((await crossOrigin.POST(post({}, 'https://other.test'))).status, 403); assert.equal(crossOrigin.calls.admin, 0);
  for (const message of ['AUTH_REQUIRED', 'ADMIN_SUSPENDED', 'EMAIL_VERIFICATION_REQUIRED']) {
    const api = route(f, { adminError: new Error(message) }); const response = await api.GET(new Request('https://example.test/api/creditex-training-questionnaires?view=submissions'));
    assert.equal(response.status, message === 'AUTH_REQUIRED' ? 401 : 403); assert.equal(api.calls.reviewer, 0, 'security failures must not fall back to another role');
  }
  const api = route(f, { adminError: new Error('ADMIN_REQUIRED'), reviewerError: new onboarding.CreditexComplianceError('CREDITEX_REVIEWER_REQUIRED', 'Denied', 403) });
  assert.equal((await api.GET(new Request('https://example.test/api/creditex-training-questionnaires'))).status, 403);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM trade_training_questionnaires').get().n, 0);
});

test('authorised form and submission reads return private no-mutation records', async () => {
  const f = fixture(); const published = await publish(f, await create(f)); const input = seedAttempt(f, published.module); await store.trainingSubmissionSnapshotStatement(f.db, input).run(); const api = route(f);
  const selected = await (await api.GET(new Request(`https://example.test/api/creditex-training-questionnaires?moduleId=${published.module.id}`))).json();
  assert.equal(selected.questionnaire.module.id, published.module.id); assert.equal(selected.versions.length, 1); assert.equal(selected.submissions.length, 1);
  const submission = await (await api.GET(new Request('https://example.test/api/creditex-training-questionnaires?submissionId=attempt'))).json(); assert.equal(submission.submission.snapshot.questions[0].selectedOptionId, 'a');
});

test('people index and person filters retain older compliance profiles after two hundred newer submissions', async () => {
  const f = fixture(); const published = await publish(f, await create(f));
  f.sql.exec("INSERT INTO trade_team_members(id,owner_uid,status,display_name,member_uid,capabilities) VALUES('earlier-person','owner','active','Earlier installer','earlier-actor','[]')");
  await store.trainingSubmissionSnapshotStatement(f.db, { ...seedAttempt(f, published.module, { id: 'earlier-attempt', memberId: 'earlier-person', actorUid: 'earlier-actor' }), completedAt: '2026-01-01T00:00:00.000Z' }).run();
  for (let index = 0; index < 201; index++) await store.trainingSubmissionSnapshotStatement(f.db, { ...seedAttempt(f, published.module, { id: `new-${String(index).padStart(3, '0')}` }), completedAt: '2026-02-01T00:00:00.000Z' }).run();
  const people = await store.listTrainingSubmissionPeople(f.db); assert.equal(people.length, 2); assert.equal(people.find(person => person.memberId === 'earlier-person').submissionCount, 1);
  const first = await store.listTrainingSubmissions(f.db); assert.equal(first.length, 200); assert.ok(first.every(record => record.memberId !== 'earlier-person'));
  const filtered = await store.listTrainingSubmissions(f.db, { ownerUid: 'owner', memberId: 'earlier-person' }); assert.equal(filtered[0].id, 'earlier-attempt');
  const last = first.at(-1); const next = await store.listTrainingSubmissions(f.db, { beforeCompletedAt: last.completedAt, beforeId: last.id }); assert.equal(next.length, 2); assert.ok(next.some(record => record.memberId === 'earlier-person'));
  const response = await (await route(f).GET(new Request('https://example.test/api/creditex-training-questionnaires?view=submissions&ownerUid=owner&memberId=earlier-person'))).json();
  assert.equal(response.people.length, 2); assert.equal(response.submissions[0].id, 'earlier-attempt'); assert.equal(response.nextCursor, null);
});
