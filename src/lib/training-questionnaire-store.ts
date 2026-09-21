import { createHash } from 'node:crypto';
import { TRAINING_MODULES, type TradeTrainingModule } from '../data/creditex-training-curriculum';
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from './australian-government-program-catalogue';
import { ENERGY_SERVICE_CATALOGUE } from './energy-service-catalogue.mjs';
import { OTHER_TRAINING_SECTIONS, trainingServiceSection } from './training-service-sections.mjs';
import { CreditexComplianceError, creditexWriteGuard, record } from './creditex-onboarding-server';

export type TrainingAssignment = { kind: 'catalogue' | 'additional'; serviceCategory: string; trainingSection?: string; jurisdictions: string[]; activityLabel: string };
export type TrainingQuestionnaire = { module: TradeTrainingModule; assignment: TrainingAssignment; revision: number; hasDraft: boolean; publishedVersion: string; publishedAt: string; updatedAt: string };
export type TrainingQuestionnaireSummary = { id: string; title: string; programCode: string; questionCount: number; revision: number; publishedVersion: string; hasDraft: boolean; assignment: TrainingAssignment; canDelete: boolean; deleteBlockedReason: string };
export type TrainingQuestionnaireVersion = { version: string; contentHash: string; publishedAt: string; publishedByUid: string };
export type TrainingSubmissionSummary = { id: string; ownerUid: string; memberId: string; displayName: string; businessName: string; moduleId: string; version: string; scorePercent: number; firstTryScorePercent: number; completedAt: string; reference: string };
export type TrainingSubmissionPerson = { ownerUid: string; memberId: string; displayName: string; businessName: string; submissionCount: number };
export type TrainingSubmissionSnapshot = { title: string; programCode: string; questions: { id: string; prompt: string; options: { id: string; text: string }[]; selectedOptionId: string; correctOptionId: string; incorrectOptionIds: string[]; explanation: string; sourceIds: string[] }[]; sources: TradeTrainingModule['sources']; firstTryScorePercent: number; scorePercent: number; reference: string };
export type TrainingSubmissionDetail = TrainingSubmissionSummary & { snapshot: TrainingSubmissionSnapshot };
type QuestionnaireRow = { module_id: string; revision: number; draft_json: string; assignment_json: string; published_version: string; published_at: string; updated_at: string; published_revision: number; has_history?: number };
type VersionRow = { module_id: string; version: string; content_hash: string; course_json: string; assignment_json: string };
const states = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
const hash = (course: TradeTrainingModule) => createHash('sha256').update(JSON.stringify(course)).digest('hex');
const invalid = (message: string): never => { throw new CreditexComplianceError('QUESTIONNAIRE_INVALID', message, 400); };
function requiredText(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return invalid(`${label} is required and must be no more than ${maximum} characters.`);
  return value.trim();
}
function draftText(value: unknown, label: string, maximum: number, publish: boolean) {
  if (publish) return requiredText(value, label, maximum);
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return invalid(`${label} must be text of no more than ${maximum} characters.`);
  return value.trim();
}
function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid('The form revision is required. Refresh and try again.');
  return value;
}
function idText(value: unknown, label: string) {
  const id = requiredText(value, label, 100); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) return invalid(`${label} must use letters, numbers, dots, dashes or underscores.`); return id;
}
function list(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid(`${label} must be a list of no more than ${maximum} items.`); return value;
}
function uniqueIds<T extends { id: string }>(items: T[], label: string) { if (new Set(items.map(item => item.id)).size !== items.length) invalid(`${label} must have different IDs.`); return items; }
function sourceIds(value: unknown, available: Set<string>) {
  const ids = list(value, 'Source references', 100).map(id => idText(id, 'Source reference')).filter(id => id !== 'creditex-review');
  if (ids.some(id => !available.has(id))) invalid('A question or lesson refers to a source that is not in this form.'); return [...new Set(ids)];
}
export function questionnaireAssignment(course: TradeTrainingModule): TrainingAssignment {
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(item => course.activityTemplateIds.includes(item.templateId));
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find(item => item.programCode === course.programCode);
  const serviceCategory = activity?.serviceCategory || 'other';
  return { kind: 'catalogue', serviceCategory, ...(serviceCategory === 'other' ? { trainingSection: trainingServiceSection({ ...course, serviceCategory }).trainingSection } : {}), jurisdictions: [program?.jurisdiction || 'AU'], activityLabel: activity?.title || course.title };
}
function cleanAdditionalAssignment(value: unknown, programCode: string): TrainingAssignment {
  const input = record(value); const program = GOVERNMENT_PROGRAM_TEMPLATES.find(item => item.programCode === programCode);
  if (!program) return invalid('Choose an existing government programme.');
  const serviceCategory = requiredText(input.serviceCategory, 'Service', 80);
  if (!ENERGY_SERVICE_CATALOGUE.some(service => service.id === serviceCategory)) return invalid('Choose a service from the service list.');
  const trainingSection = input.trainingSection === undefined || input.trainingSection === '' ? 'other-training' : requiredText(input.trainingSection, 'Training section', 80);
  if (!OTHER_TRAINING_SECTIONS.some(section => section.id === trainingSection) || (serviceCategory !== 'other' && input.trainingSection)) return invalid('Choose a valid training section for this service.');
  const jurisdictions = [...new Set(list(input.jurisdictions, 'Service states', 8).map(state => requiredText(state, 'State', 3)))];
  if (!jurisdictions.length || jurisdictions.some(state => state !== 'AU' && !states.has(state)) || (jurisdictions.includes('AU') && jurisdictions.length !== 1)) return invalid('Choose the states where this training applies, or Australia for a national programme.');
  if (program.jurisdiction !== 'AU' && (jurisdictions.length !== 1 || jurisdictions[0] !== program.jurisdiction)) return invalid(`This programme applies in ${program.jurisdiction}.`);
  return { kind: 'additional', serviceCategory, ...(serviceCategory === 'other' ? { trainingSection } : {}), jurisdictions, activityLabel: requiredText(input.activityLabel, 'Activity name', 240) };
}
/** Only authorised editor input reaches here. Binding fields come from the catalogue or the stored assignment. */
export function validateQuestionnaireModule(value: unknown, original: TradeTrainingModule | null, moduleId: string, publish = false): TradeTrainingModule {
  const input = record(value); const programCode = original?.programCode || requiredText(input.programCode, 'Programme', 40);
  if (!GOVERNMENT_PROGRAM_TEMPLATES.some(program => program.programCode === programCode)) invalid('Choose an existing government programme.');
  if (original && (input.programCode !== original.programCode || JSON.stringify(input.activityTemplateIds) !== JSON.stringify(original.activityTemplateIds))) invalid('The existing programme and activity binding cannot be changed. Create a separate activity instead.');
  const sources = uniqueIds(list(input.sources ?? [], 'Sources', 100).filter(value => record(value).id !== 'creditex-review').map(value => {
    const source = record(value); const url = draftText(source.url, 'Source URL', 2000, publish);
    if (url.startsWith('/creditex-resources/')) { if (!/^\/creditex-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(url)) invalid('Local sources must link to a supplied PDF.'); }
    else if (url) { let parsed: URL; try { parsed = new URL(url); } catch { return invalid('Use a full HTTPS source URL.'); } if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /\.md(?:$|[?#])/i.test(url)) invalid('Use a public HTTPS learning source, not an internal note.'); }
    const sourceId = idText(source.id, 'Source ID');
    // Preserve retained provenance only while its exact source identity is unchanged.
    const retainedSource = original?.sources.find(item => item.id === sourceId && item.url === url);
    return { ...retainedSource, id: sourceId, title: draftText(source.title, 'Source title', 500, publish), url,
      ...(typeof source.reviewedAt === 'string' && source.reviewedAt ? { reviewedAt: requiredText(source.reviewedAt, 'Source reviewed date', 40) } : {}) };
  }), 'Sources');
  const sourceSet = new Set(sources.map(source => source.id));
  const lessons = list(input.lessons ?? [], 'Lessons', 40).map(value => { const lesson = record(value); return { title: draftText(lesson.title, 'Lesson title', 240, publish), body: draftText(lesson.body, 'Lesson text', 16000, publish), sourceIds: sourceIds(lesson.sourceIds ?? [], sourceSet) }; });
  const questions = uniqueIds(list(input.questions ?? [], 'Questions', 60).map(value => {
    const question = record(value); const options = uniqueIds(list(question.options, 'Answers', 6).map(value => { const option = record(value); return { id: idText(option.id, 'Answer ID'), text: draftText(option.text, 'Answer text', 2000, publish) }; }), 'Answers');
    const writtenOptions = options.filter(option => option.text);
    if (options.length < 2 || new Set(writtenOptions.map(option => option.text.toLocaleLowerCase())).size !== writtenOptions.length) invalid('Each question needs two to six different answers.');
    const correctOptionId = idText(question.correctOptionId, 'Correct answer'); if (!options.some(option => option.id === correctOptionId)) invalid('Select the correct answer for every question.');
    return { id: idText(question.id, 'Question ID'), prompt: draftText(question.prompt, 'Question text', 2000, publish), options, correctOptionId, critical: true, explanation: draftText(question.explanation, 'Answer explanation', 8000, publish), sourceIds: sourceIds(question.sourceIds ?? [], sourceSet) };
  }), 'Questions');
  if (publish && (!questions.length || !lessons.length || !sources.length)) invalid('Add at least one lesson, one source and one question before publishing.');
  const estimatedMinutes = input.estimatedMinutes === undefined ? 30 : input.estimatedMinutes; const validityDays = input.validityDays === undefined ? 365 : input.validityDays;
  if (typeof estimatedMinutes !== 'number' || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 180 || typeof validityDays !== 'number' || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 730) return invalid('Use 1 to 180 minutes and a training validity of 1 to 730 days.');
  return { id: moduleId, programCode, version: original?.version || 'draft', title: requiredText(input.title, 'Form title', 240), activityTemplateIds: original?.activityTemplateIds || [], estimatedMinutes, passPercent: 100, validityDays, retakeCooldownMinutes: 0,
    reviewStatus: publish ? 'published' : 'incomplete', scope: requiredText(input.scope || input.title, 'Activity scope', 4000), sourceCoverage: publish ? { status: 'source_transcribed', gaps: [] } : { status: 'partial', gaps: ['Draft not yet published.'] }, questions, sources, lessons };
}
function editableModule(course: TradeTrainingModule) {
  const sources = course.sources.filter(source => source.id !== 'creditex-review' && !/\.md(?:$|[?#])/i.test(source.url));
  const visibleIds = new Set(sources.map(source => source.id));
  return { ...course, sources, lessons: course.lessons.map(lesson => ({ ...lesson, sourceIds: lesson.sourceIds.filter(id => visibleIds.has(id)) })), questions: course.questions.map(question => ({ ...question, sourceIds: question.sourceIds.filter(id => visibleIds.has(id)) })) };
}
function rowQuestionnaire(row: QuestionnaireRow): TrainingQuestionnaire { return { module: JSON.parse(row.draft_json), assignment: JSON.parse(row.assignment_json), revision: row.revision, hasDraft: row.revision !== row.published_revision, publishedVersion: row.published_version, publishedAt: row.published_at, updatedAt: row.updated_at }; }
export async function listRetiredTrainingModuleIds(db: D1Database) {
  return new Set((await db.prepare('SELECT module_id FROM trade_training_module_retirements').all<{ module_id: string }>()).results.map(row => row.module_id));
}
async function assertTrainingModuleActive(db: D1Database, moduleId: string) {
  if (await db.prepare('SELECT 1 FROM trade_training_module_retirements WHERE module_id=?').bind(moduleId).first()) throw new CreditexComplianceError('TRAINING_MODULE_RETIRED', 'This training module has been deleted from the active library. Its saved learning history is retained.', 409);
}
const trainingHistoryPredicate = `EXISTS(SELECT 1 FROM trade_training_questionnaire_versions v WHERE v.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_attempts a WHERE a.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_completions c WHERE c.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_submissions s WHERE s.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_module_reviews r WHERE r.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_external_credentials e WHERE e.module_id=q.module_id)
  OR EXISTS(SELECT 1 FROM trade_training_questionnaire_events event WHERE event.module_id=q.module_id AND event.event_type='published')`;
function draftDeleteBlockedReason(moduleId: string, row?: QuestionnaireRow) {
  if (TRAINING_MODULES.some(course => course.id === moduleId)) return 'Required activity training cannot be deleted.';
  if (!row || !moduleId.startsWith('custom-') || JSON.parse(row.assignment_json).kind !== 'additional') return 'Only additional custom drafts can be deleted.';
  if (row.published_version || row.published_revision || row.published_at) return 'Published training is retained with its compliance history.';
  if (row.has_history) return 'Training with learner, review or publication history is retained.';
  return '';
}
export async function getTrainingQuestionnaire(db: D1Database, moduleId: string): Promise<TrainingQuestionnaire> {
  await assertTrainingModuleActive(db, moduleId);
  const row = await db.prepare('SELECT * FROM trade_training_questionnaires WHERE module_id=?').bind(moduleId).first<QuestionnaireRow>(); if (row) return rowQuestionnaire(row);
  const course = TRAINING_MODULES.find(course => course.id === moduleId); if (!course) throw new CreditexComplianceError('QUESTIONNAIRE_NOT_FOUND', 'Training form not found.', 404);
  return { module: editableModule(course), assignment: questionnaireAssignment(course), revision: 0, hasDraft: false, publishedVersion: course.version, publishedAt: '', updatedAt: '' };
}
export async function listTrainingQuestionnaires(db: D1Database): Promise<TrainingQuestionnaireSummary[]> {
  const retired = await listRetiredTrainingModuleIds(db);
  const rows = await db.prepare('SELECT * FROM trade_training_questionnaires').all<QuestionnaireRow>(); const map = new Map(rows.results.map(row => [row.module_id, row]));
  const ids = [...TRAINING_MODULES.map(course => course.id), ...rows.results.filter(row => !TRAINING_MODULES.some(course => course.id === row.module_id)).map(row => row.module_id)];
  return ids.filter(id => !retired.has(id)).map(id => { const row = map.get(id); const course = row ? JSON.parse(row.draft_json) as TradeTrainingModule : TRAINING_MODULES.find(course => course.id === id)!; return { id, title: course.title, programCode: course.programCode, questionCount: course.questions.length, revision: row?.revision || 0, publishedVersion: row?.published_version || (row ? '' : course.version), hasDraft: row ? row.revision !== row.published_revision : false, assignment: row ? JSON.parse(row.assignment_json) as TrainingAssignment : questionnaireAssignment(course), canDelete: true, deleteBlockedReason: '' }; });
}
export async function retireTrainingQuestionnaire(db: D1Database, actorUid: string, body: Record<string, unknown>) {
  const moduleId = idText(body.moduleId, 'Form ID'); const expected = revision(body.expectedRevision);
  const retired = await db.prepare('SELECT revision FROM trade_training_module_retirements WHERE module_id=?').bind(moduleId).first<{ revision: number }>();
  const result = { moduleId, deleted: true, retired: true, requirementsRemoved: true, historyPreserved: true };
  if (retired) {
    if (retired.revision !== expected) throw new CreditexComplianceError('REVISION_CONFLICT', 'This module was deleted at a different revision. Refresh the training list.', 409);
    return result;
  }
  const questionnaire = await getTrainingQuestionnaire(db, moduleId);
  if (questionnaire.revision !== expected) throw new CreditexComplianceError('REVISION_CONFLICT', 'Someone else edited this form. Reload it before deleting.', 409);
  const now = new Date().toISOString();
  await db.batch([
    creditexWriteGuard(db, actorUid, 'COALESCE((SELECT revision FROM trade_training_questionnaires WHERE module_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements WHERE module_id=?)', [moduleId, expected, moduleId]),
    db.prepare('INSERT INTO trade_training_module_retirements(module_id,revision,course_json,assignment_json,retired_by_uid,retired_at) VALUES (?,?,?,?,?,?)').bind(moduleId, expected, JSON.stringify(questionnaire.module), JSON.stringify(questionnaire.assignment), actorUid, now),
    db.prepare('INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), actorUid, 'training_questionnaire.retire', 'training_questionnaire', moduleId, 'Removed training from the active library and current job requirements; retained learning history.', JSON.stringify({ title: questionnaire.module.title, revision: expected, requirementsRemoved: true, historyPreserved: true }), now),
  ]);
  return result;
}
export async function deleteTrainingQuestionnaireDraft(db: D1Database, actorUid: string, body: Record<string, unknown>) {
  const moduleId = idText(body.moduleId, 'Form ID'); const expected = revision(body.expectedRevision);
  await assertTrainingModuleActive(db, moduleId);
  if (TRAINING_MODULES.some(course => course.id === moduleId)) throw new CreditexComplianceError('DRAFT_DELETE_BLOCKED', 'Required activity training cannot be deleted.', 409);
  const row = await db.prepare(`SELECT q.*, CASE WHEN (${trainingHistoryPredicate}) THEN 1 ELSE 0 END has_history FROM trade_training_questionnaires q WHERE q.module_id=?`).bind(moduleId).first<QuestionnaireRow>();
  if (!row) throw new CreditexComplianceError('QUESTIONNAIRE_NOT_FOUND', 'Training draft not found. Refresh the list.', 404);
  if (row.revision !== expected) throw new CreditexComplianceError('REVISION_CONFLICT', 'Someone else edited this form. Reload it before deleting.', 409);
  const reason = draftDeleteBlockedReason(moduleId, row);
  if (reason) throw new CreditexComplianceError('DRAFT_DELETE_BLOCKED', reason, 409);
  const course = JSON.parse(row.draft_json) as TradeTrainingModule;
  await db.batch([
    creditexWriteGuard(db, actorUid, `EXISTS(SELECT 1 FROM trade_training_questionnaires q WHERE q.module_id=? AND q.revision=? AND q.published_version='' AND q.published_revision=0 AND q.published_at='' AND json_extract(q.assignment_json,'$.kind')='additional' AND NOT (${trainingHistoryPredicate}) AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements retired WHERE retired.module_id=q.module_id))`, [moduleId, expected]),
    db.prepare('DELETE FROM trade_training_questionnaires WHERE module_id=? AND revision=?').bind(moduleId, expected),
    db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), actorUid, 'training_questionnaire.draft_delete', 'training_questionnaire', moduleId, 'Deleted an unused, never-published custom training draft.', JSON.stringify({ title: course.title, revision: expected, publishedHistoryDeleted: false }), new Date().toISOString()),
  ]);
  return { moduleId, deleted: true };
}
export async function listCurrentTrainingModules(db: D1Database): Promise<TradeTrainingModule[]> {
  const retired = await listRetiredTrainingModuleIds(db);
  const rows = await db.prepare('SELECT v.* FROM trade_training_questionnaire_versions v JOIN trade_training_questionnaires q ON q.module_id=v.module_id AND q.published_version=v.version').all<VersionRow>(); const overrides = new Map(rows.results.map(row => [row.module_id, JSON.parse(row.course_json) as TradeTrainingModule]));
  return [...TRAINING_MODULES.map(course => overrides.get(course.id) || course), ...[...overrides.values()].filter(course => !TRAINING_MODULES.some(staticCourse => staticCourse.id === course.id))].filter(course => !retired.has(course.id));
}
export async function loadTrainingModule(db: D1Database, moduleId: string, options: { forSchemeAuthority?: boolean } = {}) {
  // Activity 48 scheme authority remains independently renewable after its quiz
  // is retired. Learner and editor callers never opt into this governance read.
  if (!options.forSchemeAuthority || moduleId !== 'veu-48') await assertTrainingModuleActive(db, moduleId);
  const row = await db.prepare('SELECT v.* FROM trade_training_questionnaire_versions v JOIN trade_training_questionnaires q ON q.module_id=v.module_id AND q.published_version=v.version WHERE v.module_id=?').bind(moduleId).first<VersionRow>();
  const course = row ? JSON.parse(row.course_json) as TradeTrainingModule : TRAINING_MODULES.find(course => course.id === moduleId);
  if (!course) throw new CreditexComplianceError('TRAINING_MODULE_UNAVAILABLE', 'This activity has no published training form.', 409); return course;
}
export async function loadTrainingModuleVersion(db: D1Database, moduleId: string, version: string, contentHash: string) {
  const row = await db.prepare('SELECT * FROM trade_training_questionnaire_versions WHERE module_id=? AND version=? AND content_hash=?').bind(moduleId, version, contentHash).first<VersionRow>();
  const course = row ? JSON.parse(row.course_json) as TradeTrainingModule : TRAINING_MODULES.find(course => course.id === moduleId && course.version === version && hash(course) === contentHash);
  if (!course) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'This assessment version is no longer available. Start the current form.', 409); return course;
}
export function currentTrainingModuleGuard(course: TradeTrainingModule) {
  return { sql: `(EXISTS(SELECT 1 FROM trade_training_questionnaires q JOIN trade_training_questionnaire_versions v ON v.module_id=q.module_id AND v.version=q.published_version WHERE q.module_id=? AND v.version=? AND v.content_hash=?) OR (?=1 AND NOT EXISTS(SELECT 1 FROM trade_training_questionnaires WHERE module_id=? AND published_version<>''))) AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements WHERE module_id=?)`, bindings: [course.id, course.version, hash(course), TRAINING_MODULES.some(staticCourse => staticCourse.id === course.id && hash(staticCourse) === hash(course)) ? 1 : 0, course.id, course.id] };
}
export async function listTrainingAssignments(db: D1Database) {
  const retired = await listRetiredTrainingModuleIds(db);
  const rows = await db.prepare('SELECT v.* FROM trade_training_questionnaire_versions v JOIN trade_training_questionnaires q ON q.module_id=v.module_id AND q.published_version=v.version').all<VersionRow>(); const overrides = new Map(rows.results.map(row => [row.module_id, JSON.parse(row.assignment_json) as TrainingAssignment]));
  return [...TRAINING_MODULES.map(course => ({ moduleId: course.id, assignment: overrides.get(course.id) || questionnaireAssignment(course) })), ...rows.results.filter(row => !TRAINING_MODULES.some(course => course.id === row.module_id)).map(row => ({ moduleId: row.module_id, assignment: JSON.parse(row.assignment_json) as TrainingAssignment }))].filter(item => !retired.has(item.moduleId));
}
function audit(db: D1Database, actorUid: string, moduleId: string, action: string, revision: number, metadata: object = {}) { return db.prepare('INSERT INTO trade_training_questionnaire_events(id,module_id,actor_uid,event_type,revision,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), moduleId, actorUid, action, revision, JSON.stringify(metadata), new Date().toISOString()); }
export async function saveTrainingQuestionnaire(db: D1Database, actorUid: string, body: Record<string, unknown>) {
  const moduleId = body.moduleId === undefined || body.moduleId === '' ? `custom-${crypto.randomUUID()}` : idText(body.moduleId, 'Form ID'); const expected = revision(body.expectedRevision);
  await assertTrainingModuleActive(db, moduleId);
  const staticCourse = TRAINING_MODULES.find(course => course.id === moduleId) || null;
  const existing = await db.prepare('SELECT * FROM trade_training_questionnaires WHERE module_id=?').bind(moduleId).first<QuestionnaireRow>();
  if (body.moduleId && !existing && !staticCourse) throw new CreditexComplianceError('QUESTIONNAIRE_NOT_FOUND', 'Training form not found.', 404);
  if ((existing?.revision || 0) !== expected) throw new CreditexComplianceError('REVISION_CONFLICT', 'Someone else edited this form. Reload it before saving.', 409);
  const original: TradeTrainingModule | null = existing ? JSON.parse(existing.draft_json) : staticCourse;
  const course = validateQuestionnaireModule(body.module, original, moduleId);
  const assignment = staticCourse ? questionnaireAssignment(staticCourse) : existing ? JSON.parse(existing.assignment_json) as TrainingAssignment : cleanAdditionalAssignment(body.assignment, course.programCode);
  const now = new Date().toISOString(); const nextRevision = expected + 1;
  await db.batch([creditexWriteGuard(db, actorUid, 'COALESCE((SELECT revision FROM trade_training_questionnaires WHERE module_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements WHERE module_id=?)', [moduleId, expected, moduleId]),
    db.prepare(`INSERT INTO trade_training_questionnaires(module_id,revision,draft_json,assignment_json,published_version,published_revision,published_at,updated_at,updated_by_uid) VALUES (?,?,?,?,'',0,'',?,?) ON CONFLICT(module_id) DO UPDATE SET revision=excluded.revision,draft_json=excluded.draft_json,updated_at=excluded.updated_at,updated_by_uid=excluded.updated_by_uid`).bind(moduleId, nextRevision, JSON.stringify(course), JSON.stringify(assignment), now, actorUid), audit(db, actorUid, moduleId, 'draft_saved', nextRevision)]);
  return getTrainingQuestionnaire(db, moduleId);
}
export async function publishTrainingQuestionnaire(db: D1Database, actorUid: string, body: Record<string, unknown>) {
  if (body.sourcesChecked !== true) invalid('Check the lesson, correct answers and sources before publishing.');
  const moduleId = idText(body.moduleId, 'Form ID'); const expected = revision(body.expectedRevision); const row = await db.prepare('SELECT * FROM trade_training_questionnaires WHERE module_id=?').bind(moduleId).first<QuestionnaireRow>();
  await assertTrainingModuleActive(db, moduleId);
  if (!row || row.revision !== expected) throw new CreditexComplianceError('REVISION_CONFLICT', 'Save the form and reload its current revision before publishing.', 409);
  if (row.published_revision === row.revision) throw new CreditexComplianceError('QUESTIONNAIRE_ALREADY_PUBLISHED', 'This saved form is already published.', 409);
  const draft: TradeTrainingModule = JSON.parse(row.draft_json); const course = validateQuestionnaireModule(draft, draft, moduleId, true); course.version = `authored-${row.revision}-${crypto.randomUUID()}`;
  const contentHash = hash(course); const now = new Date().toISOString();
  await db.batch([creditexWriteGuard(db, actorUid, 'EXISTS(SELECT 1 FROM trade_training_questionnaires WHERE module_id=? AND revision=? AND published_revision<>revision) AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements WHERE module_id=?)', [moduleId, expected, moduleId]),
    db.prepare('INSERT INTO trade_training_questionnaire_versions(module_id,version,content_hash,course_json,assignment_json,published_by_uid,published_at) VALUES (?,?,?,?,?,?,?)').bind(moduleId, course.version, contentHash, JSON.stringify(course), row.assignment_json, actorUid, now),
    db.prepare('UPDATE trade_training_questionnaires SET published_version=?,published_revision=revision,published_at=?,draft_json=?,updated_at=?,updated_by_uid=? WHERE module_id=?').bind(course.version, now, JSON.stringify(course), now, actorUid, moduleId), audit(db, actorUid, moduleId, 'published', row.revision, { version: course.version, contentHash })]);
  return getTrainingQuestionnaire(db, moduleId);
}
export async function listTrainingQuestionnaireVersions(db: D1Database, moduleId: string) { return (await db.prepare('SELECT version,content_hash AS contentHash,published_at AS publishedAt,published_by_uid AS publishedByUid FROM trade_training_questionnaire_versions WHERE module_id=? ORDER BY published_at DESC LIMIT 100').bind(moduleId).all<TrainingQuestionnaireVersion>()).results; }
export function trainingSubmissionSnapshotStatement(db: D1Database, input: { attemptId: string; ownerUid: string; memberId: string; actorUid: string; course: TradeTrainingModule; answers: Record<string, string>; incorrectAnswers?: Record<string, string[]>; reference: string; completedAt?: string; result?: Record<string, unknown> }) {
  const { course } = input; const visibleCourse = editableModule(course);
  const questions = visibleCourse.questions.map(question => ({ id: question.id, prompt: question.prompt, options: question.options, selectedOptionId: input.answers[question.id] || '', correctOptionId: question.correctOptionId, incorrectOptionIds: [...new Set(input.incorrectAnswers?.[question.id] || [])], explanation: question.explanation, sourceIds: question.sourceIds }));
  if (!questions.length || questions.some(question => !question.options.some(option => option.id === question.selectedOptionId) || question.incorrectOptionIds.some(id => !question.options.some(option => option.id === id) || id === question.correctOptionId))) invalid('The saved submission must use answers from this exact form.');
  const scorePercent = Math.floor(100 * questions.filter(question => question.selectedOptionId === question.correctOptionId).length / questions.length);
  const firstTryScorePercent = Math.floor(100 * questions.filter(question => question.selectedOptionId === question.correctOptionId && !question.incorrectOptionIds.length).length / questions.length);
  const snapshot: TrainingSubmissionSnapshot = { title: course.title, programCode: course.programCode, questions, sources: visibleCourse.sources, scorePercent, firstTryScorePercent, reference: input.reference };
  return db.prepare('INSERT INTO trade_training_submissions(id,attempt_id,owner_uid,member_id,actor_uid,module_id,version,content_hash,score_percent,first_try_score_percent,reference,completed_at,snapshot_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(input.attemptId, input.attemptId, input.ownerUid, input.memberId, input.actorUid, course.id, course.version, hash(course), scorePercent, firstTryScorePercent, input.reference, input.completedAt || new Date().toISOString(), JSON.stringify(snapshot), JSON.stringify(input.result || {}));
}
export async function listTrainingSubmissionPeople(db: D1Database): Promise<TrainingSubmissionPerson[]> {
  return (await db.prepare(`SELECT s.owner_uid AS ownerUid,s.member_id AS memberId,COALESCE(m.display_name,'Former team member') AS displayName,COALESCE(a.business_name,'') AS businessName,COUNT(*) AS submissionCount
    FROM trade_training_submissions s LEFT JOIN trade_team_members m ON m.id=s.member_id AND m.owner_uid=s.owner_uid LEFT JOIN trade_accounts a ON a.firebase_uid=s.owner_uid
    GROUP BY s.owner_uid,s.member_id ORDER BY businessName COLLATE NOCASE,displayName COLLATE NOCASE,s.owner_uid,s.member_id LIMIT 1000`).all<TrainingSubmissionPerson>()).results;
}
export async function listTrainingSubmissions(db: D1Database, filter: { moduleId?: string; ownerUid?: string; memberId?: string; beforeCompletedAt?: string; beforeId?: string } = {}): Promise<TrainingSubmissionSummary[]> {
  const where: string[] = []; const values: string[] = []; for (const [column, value] of [['module_id', filter.moduleId], ['owner_uid', filter.ownerUid], ['member_id', filter.memberId]]) if (value) { where.push(`s.${column}=?`); values.push(value); }
  if (filter.beforeCompletedAt || filter.beforeId) {
    if (!filter.beforeCompletedAt || !filter.beforeId || !Number.isFinite(Date.parse(filter.beforeCompletedAt))) return invalid('The previous submission page is invalid. Reload the profile.');
    where.push('(s.completed_at<? OR (s.completed_at=? AND s.id<?))'); values.push(filter.beforeCompletedAt, filter.beforeCompletedAt, filter.beforeId);
  }
  return (await db.prepare(`SELECT s.id,s.owner_uid AS ownerUid,s.member_id AS memberId,COALESCE(m.display_name,'Former team member') AS displayName,COALESCE(a.business_name,'') AS businessName,s.module_id AS moduleId,s.version,s.score_percent AS scorePercent,s.first_try_score_percent AS firstTryScorePercent,s.completed_at AS completedAt,s.reference FROM trade_training_submissions s LEFT JOIN trade_team_members m ON m.id=s.member_id AND m.owner_uid=s.owner_uid LEFT JOIN trade_accounts a ON a.firebase_uid=s.owner_uid ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.completed_at DESC,s.id DESC LIMIT 200`).bind(...values).all<TrainingSubmissionSummary>()).results;
}
export async function getTrainingSubmission(db: D1Database, id: string): Promise<TrainingSubmissionDetail> {
  const row = await db.prepare(`SELECT s.id,s.owner_uid AS ownerUid,s.member_id AS memberId,COALESCE(m.display_name,'Former team member') AS displayName,COALESCE(a.business_name,'') AS businessName,s.module_id AS moduleId,s.version,s.score_percent AS scorePercent,s.first_try_score_percent AS firstTryScorePercent,s.completed_at AS completedAt,s.reference,s.snapshot_json FROM trade_training_submissions s LEFT JOIN trade_team_members m ON m.id=s.member_id AND m.owner_uid=s.owner_uid LEFT JOIN trade_accounts a ON a.firebase_uid=s.owner_uid WHERE s.id=?`).bind(id).first<TrainingSubmissionSummary & { snapshot_json: string }>();
  if (!row) throw new CreditexComplianceError('SUBMISSION_NOT_FOUND', 'Saved training form not found.', 404); const { snapshot_json, ...summary } = row; return { ...summary, snapshot: JSON.parse(snapshot_json) };
}
