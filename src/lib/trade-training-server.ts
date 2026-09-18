import { createHash } from 'node:crypto';
import { TRAINING_MODULES, type TradeTrainingModule } from '../data/creditex-training-curriculum';
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from './australian-government-program-catalogue';
import { ENERGY_SERVICE_ID_EXPANSIONS, savedEnergyServiceIds } from './energy-service-catalogue.mjs';
import { businessApprovalSql, CreditexComplianceError, creditexWriteGuard, getCreditexBusinessStatus, isValidDate, record, textField } from './creditex-onboarding-server';

export { CreditexComplianceError } from './creditex-onboarding-server';
type Review = { module_id: string; version: string; content_hash: string; status: string; source_reviewed_on: string; review_expires_on: string; scheme_authority_reference: string; reviewed_by_uid: string; updated_at: string };
type Completion = { id: string; owner_uid: string; member_id: string; module_id: string; version: string; content_hash: string; reference: string; passed_at: string; expires_at: string; revoked_at: string };
type Attempt = { id: string; owner_uid: string; member_id: string; actor_uid: string; module_id: string; version: string; content_hash: string; status: string; started_at: string; expires_at: string; submitted_at: string; assessment_json: string };
type Assessment = { questionId: string; options: { token: string; optionId: string }[] }[];
const trainingPrograms = new Map(GOVERNMENT_PROGRAM_TEMPLATES.map(program => [program.programCode, program]));
function stringList(value: string) {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
function trainingCapabilitiesSql(member: string, account: string) {
  // Studying follows the person's saved services. Booking and lead predicates
  // independently continue to require the business's enabled service scope.
  return `CASE WHEN ${member}.member_uid=${member}.owner_uid THEN ${account}.capabilities ELSE ${member}.capabilities END`;
}
function trainingServiceStatesSql(account: string) {
  return `(SELECT json_group_array(state) FROM trade_training_served_jurisdictions WHERE owner_uid=${account}.firebase_uid)`;
}
export async function getMemberTrainingScope(db: D1Database, ownerUid: string, memberId: string) {
  const row = await db.prepare(`SELECT a.capabilities AS business_capabilities,${trainingServiceStatesSql('a')} AS training_states,m.display_name,m.member_uid,${trainingCapabilitiesSql('m', 'a')} AS training_capabilities FROM trade_accounts a JOIN trade_team_members m ON m.owner_uid=a.firebase_uid AND m.id=? AND m.status='active' WHERE a.firebase_uid=?`).bind(memberId, ownerUid).first<{ business_capabilities: string; training_states: string; display_name: string; member_uid: string; training_capabilities: string }>();
  if (!row) return null;
  const capabilities = savedEnergyServiceIds(stringList(row.training_capabilities));
  const businessCapabilities = savedEnergyServiceIds(stringList(row.business_capabilities));
  const serviceStates = stringList(row.training_states);
  const activities = GOVERNMENT_ACTIVITY_TEMPLATES.filter(activity => {
    const program = trainingPrograms.get(activity.programCode);
    return program && capabilities.includes(activity.serviceCategory) && (program.jurisdiction === 'AU' || serviceStates.includes(program.jurisdiction));
  }).map(activity => ({ ...activity, businessServiceEnabled: businessCapabilities.includes(activity.serviceCategory) }));
  return { memberId, displayName: row.display_name, isOwner: row.member_uid === ownerUid, capabilities, businessCapabilities, serviceStates, activities };
}
export async function getDeclaredTrainingActivities(db: D1Database, ownerUid: string, memberId: string) {
  return (await getMemberTrainingScope(db, ownerUid, memberId))?.activities || [];
}
function memberActivityScopeSql() {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const expanded = `CASE saved_service.value ${Object.entries(ENERGY_SERVICE_ID_EXPANSIONS).map(([alias, categories]) => `WHEN ${literal(alias)} THEN ${literal(JSON.stringify(categories))}`).join(' ')} ELSE json_array(saved_service.value) END`;
  return `EXISTS(SELECT 1 FROM trade_team_members scoped_member JOIN trade_accounts scoped_account ON scoped_account.firebase_uid=scoped_member.owner_uid WHERE scoped_member.owner_uid=? AND scoped_member.id=? AND scoped_member.status='active' AND EXISTS(SELECT 1 FROM json_each(${trainingCapabilitiesSql('scoped_member', 'scoped_account')}) saved_service CROSS JOIN json_each(${expanded}) canonical_service WHERE canonical_service.value=?)) AND EXISTS(SELECT 1 FROM trade_accounts scoped_jurisdiction WHERE scoped_jurisdiction.firebase_uid=? AND (?='AU' OR EXISTS(SELECT 1 FROM json_each(${trainingServiceStatesSql('scoped_jurisdiction')}) WHERE value=?)))`;
}
function memberActivityScopeBindings(ownerUid: string, memberId: string, activity: { serviceCategory: string; programCode: string }) {
  const jurisdiction = trainingPrograms.get(activity.programCode)?.jurisdiction || '';
  return [ownerUid, memberId, activity.serviceCategory, ownerUid, jurisdiction, jurisdiction];
}
export type CertificateEligibilityInput = { ownerUid: string; actorMemberId: string; assignedMemberId: string; activityTemplateIds: readonly string[] };
export type CertificateEligibilityReason = { code: string; message: string; activityTemplateId?: string; memberId?: string };

export function getTrainingModuleHash(course: TradeTrainingModule) {
  return createHash('sha256').update(JSON.stringify(course)).digest('hex');
}
export function findTrainingModule(moduleId: string) {
  const course = TRAINING_MODULES.find(candidate => candidate.id === moduleId);
  if (!course) throw new CreditexComplianceError('TRAINING_MODULE_UNAVAILABLE', 'No activity-specific training course is available for this activity.', 409);
  return course;
}
export function trainingAuditStatement(db: D1Database, actorUid: string, eventType: string, input: { ownerUid?: string; memberId?: string; moduleId?: string; metadata?: Record<string, unknown> }) {
  return db.prepare('INSERT INTO trade_training_events (id,owner_uid,member_id,actor_uid,module_id,event_type,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), input.ownerUid || '', input.memberId || '', actorUid, input.moduleId || '', eventType, JSON.stringify(input.metadata || {}), new Date().toISOString());
}
async function moduleReview(db: D1Database, course: TradeTrainingModule, cached?: Review[]) {
  const review = cached ? cached.find(row => row.module_id === course.id) || null : await db.prepare('SELECT * FROM trade_training_module_reviews WHERE module_id=?').bind(course.id).first<Review>();
  const hash = await getTrainingModuleHash(course);
  const availability = review?.status === 'withdrawn' ? 'withdrawn' : isTrainingModuleReady(course) ? 'active' : 'unavailable';
  return { review, hash, availability };
}
function validAssessment(course: TradeTrainingModule) {
  return course.questions.length === 25 && course.passPercent === 100 && course.questions.some(question => question.critical)
    && new Set(course.questions.map(question => question.id)).size === course.questions.length
    && course.questions.every(question => question.options.length >= 2
      && new Set(question.options.map(option => option.id)).size === question.options.length
      && question.options.some(option => option.id === question.correctOptionId));
}
export function isTrainingModuleReady(course: TradeTrainingModule) {
  return course.sourceCoverage.status === 'source_transcribed' && validAssessment(course);
}
function assessmentAvailability(course: TradeTrainingModule, review: Review | null) {
  const reason = course.sourceCoverage.status !== 'source_transcribed' ? `This activity's source requirements are incomplete: ${course.sourceCoverage.gaps.join('; ')}`
    : !validAssessment(course) ? 'The current assessment needs correction before it can be taken.'
      : review?.status === 'withdrawn' ? 'This course has been withdrawn. Assessment is unavailable while the withdrawal remains in effect.' : '';
  return { assessmentAvailable: !reason, assessmentUnavailableReason: reason };
}
function assessmentReviewGuard(course: TradeTrainingModule, review: Review | null) {
  // Courses activate from current source content. Governance is optional, but
  // a concurrent safety withdrawal or changed decision invalidates this write.
  return review ? {
    sql: `EXISTS(SELECT 1 FROM trade_training_module_reviews WHERE module_id=? AND version=? AND content_hash=? AND status='active' AND reviewed_by_uid=? AND source_reviewed_on=? AND review_expires_on=? AND updated_at=?)`,
    bindings: [course.id, review.version, review.content_hash, review.reviewed_by_uid, review.source_reviewed_on, review.review_expires_on, review.updated_at],
  } : { sql: 'NOT EXISTS(SELECT 1 FROM trade_training_module_reviews WHERE module_id=?)', bindings: [course.id] };
}
const learnerSourceIds = (ids: readonly string[]) => ids.filter(id => id !== 'creditex-review');
function currentCompletionSql(owner: string, member: string, course: string, version: string, hash: string) {
  return `EXISTS(SELECT 1 FROM trade_training_current_completions ttc WHERE ttc.owner_uid=${owner} AND ttc.member_id=${member} AND ttc.module_id=${course} AND ttc.version=${version} AND ttc.content_hash=${hash} AND ttc.external_required=0)`;
}
function currentExternalCredentialSql(owner: string, member: string) {
  return `EXISTS(SELECT 1 FROM trade_training_external_credentials tec JOIN trade_team_member_files credential_file ON credential_file.id=tec.document_id AND credential_file.owner_uid=tec.owner_uid AND credential_file.team_member_id=tec.member_id AND credential_file.status='active' AND (credential_file.expires_at='' OR date(credential_file.expires_at)>=date('now')) WHERE tec.owner_uid=${owner} AND tec.member_id=${member} AND tec.module_id='veu-48' AND tec.revoked_at='' AND tec.reviewed_by_uid<>'' AND tec.credential_reference<>'' AND tec.scheme_participant_reference<>'' AND date(tec.expires_on)>=date('now'))`;
}
export async function certificateActivityEligibilityPredicate(input: CertificateEligibilityInput) {
  if (!input.activityTemplateIds.length) return { sql: '1=1', bindings: [] as (string | number)[] };
  const ids = [...new Set(input.activityTemplateIds)];
  if (ids.length > 20 || !input.ownerUid || !input.actorMemberId || !input.assignedMemberId) return { sql: '0=1', bindings: [] as (string | number)[] };
  const courseRows: string[] = [];
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  for (const activityId of ids) {
    const course = TRAINING_MODULES.find(candidate => candidate.activityTemplateIds.includes(activityId));
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityId);
    const program = activity ? trainingPrograms.get(activity.programCode) : undefined;
    if (!course || !activity || !program || !isTrainingModuleReady(course) || ['closed', 'future'].includes(activity.catalogueState) || ['closed', 'future'].includes(program.catalogueState)) return { sql: '0=1', bindings: [] as (string | number)[] };
    courseRows.push(`(${[course.id, course.version, getTrainingModuleHash(course), activity.serviceCategory, program.jurisdiction].map(literal).join(',')},${course.id === 'veu-48' ? 1 : 0})`);
  }
  // Metadata comes only from the versioned catalogue. Three bound identity values
  // keep a twenty-activity batch below D1's 100-parameter limit.
  const sql = `EXISTS(WITH training_input(owner_uid,actor_member_id,assigned_member_id) AS (VALUES (?,?,?)),
    required_course(module_id,version,content_hash,category,jurisdiction,external_required) AS (VALUES ${courseRows.join(',')}),
    required_person(member_id) AS (
      SELECT actor_member_id FROM training_input UNION SELECT assigned_member_id FROM training_input
      UNION SELECT owner_member.id FROM trade_team_members owner_member JOIN training_input ON owner_member.owner_uid=training_input.owner_uid WHERE owner_member.member_uid=training_input.owner_uid AND owner_member.status='active'
    )
    SELECT 1 FROM training_input WHERE ${businessApprovalSql('training_input.owner_uid')}
      AND EXISTS(SELECT 1 FROM trade_team_members owner_member WHERE owner_member.owner_uid=training_input.owner_uid AND owner_member.member_uid=training_input.owner_uid AND owner_member.status='active')
      AND NOT EXISTS(SELECT 1 FROM required_course WHERE
        NOT EXISTS(SELECT 1 FROM trade_accounts scoped_account WHERE scoped_account.firebase_uid=training_input.owner_uid
          AND EXISTS(SELECT 1 FROM json_each(scoped_account.capabilities) WHERE value=required_course.category)
          AND (required_course.jurisdiction='AU' OR EXISTS(SELECT 1 FROM json_each(${trainingServiceStatesSql('scoped_account')}) WHERE value=required_course.jurisdiction)))
        OR EXISTS(SELECT 1 FROM required_person WHERE
          NOT EXISTS(SELECT 1 FROM trade_team_members scoped_member WHERE scoped_member.owner_uid=training_input.owner_uid AND scoped_member.id=required_person.member_id AND scoped_member.status='active'
            AND (scoped_member.member_uid=training_input.owner_uid OR EXISTS(SELECT 1 FROM json_each(scoped_member.capabilities) WHERE value=required_course.category)))
          OR NOT ${currentCompletionSql('training_input.owner_uid', 'required_person.member_id', 'required_course.module_id', 'required_course.version', 'required_course.content_hash')}
        )
        OR (required_course.external_required=1 AND NOT EXISTS(SELECT 1 FROM trade_training_current_completions installer_pass WHERE installer_pass.owner_uid=training_input.owner_uid AND installer_pass.member_id=training_input.assigned_member_id AND installer_pass.module_id=required_course.module_id AND installer_pass.version=required_course.version AND installer_pass.content_hash=required_course.content_hash AND installer_pass.external_required=1))
      ))`;
  return { sql, bindings: [input.ownerUid, input.actorMemberId, input.assignedMemberId] };
}
export async function certificateActivityEligibilityGuardStatement(db: D1Database, input: CertificateEligibilityInput) {
  const predicate = await certificateActivityEligibilityPredicate(input);
  return creditexWriteGuard(db, input.ownerUid, predicate.sql, predicate.bindings);
}
export async function getCertificateActivityEligibility(db: D1Database, input: CertificateEligibilityInput) {
  const reasons: CertificateEligibilityReason[] = [];
  if (!input.activityTemplateIds.length) return { eligible: true, reasons };
  const business = await getCreditexBusinessStatus(db, input.ownerUid);
  if (!business.approved) reasons.push({ code: 'CREDITEX_ONBOARDING_REQUIRED', message: business.blockedReasons.join(' ') });
  if (!input.actorMemberId || !input.assignedMemberId) reasons.push({ code: 'TRAINED_ASSIGNEE_REQUIRED', message: 'Choose an active team member who has passed the activity training.' });
  for (const activityTemplateId of [...new Set(input.activityTemplateIds)]) {
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityTemplateId);
    const program = activity ? trainingPrograms.get(activity.programCode) : undefined;
    if (activity && program && (['closed', 'future'].includes(activity.catalogueState) || ['closed', 'future'].includes(program.catalogueState))) {
      reasons.push({ code: 'PROGRAMME_ACTIVITY_NOT_OPEN', message: 'This government programme or activity is closed or not yet open. Training completion does not permit booking it.', activityTemplateId }); continue;
    }
    const course = TRAINING_MODULES.find(candidate => candidate.activityTemplateIds.includes(activityTemplateId));
    if (!course) { reasons.push({ code: 'TRAINING_MODULE_UNAVAILABLE', message: 'This activity has no activity-specific training course and is unavailable for certificate jobs.', activityTemplateId }); continue; }
    const { review } = await moduleReview(db, course);
    const assessment = assessmentAvailability(course, review);
    if (!assessment.assessmentAvailable) reasons.push({ code: 'TRAINING_CONTENT_UNAVAILABLE', message: assessment.assessmentUnavailableReason, activityTemplateId });
    const predicate = await certificateActivityEligibilityPredicate({ ...input, activityTemplateIds: [activityTemplateId] });
    if (!await db.prepare(`SELECT 1 AS eligible WHERE ${predicate.sql}`).bind(...predicate.bindings).first()) reasons.push({ code: 'ACTIVITY_TRAINING_REQUIRED', message: `The business owner, booking person and assigned installer each require a current ${course.title} completion within their declared service scope. The assigned installer also needs any required reviewed external credentials.`, activityTemplateId });
  }
  return { eligible: reasons.length === 0, reasons };
}
export async function assertCertificateActivityEligibility(db: D1Database, input: CertificateEligibilityInput) {
  const result = await getCertificateActivityEligibility(db, input);
  if (!result.eligible) throw new CreditexComplianceError(result.reasons[0].code, result.reasons.map(reason => reason.message).join(' '));
}
export async function getBusinessCertificateLeadEligibility(db: D1Database, input: { ownerUid: string; activityTemplateIds: readonly string[] }) {
  const business = await getCreditexBusinessStatus(db, input.ownerUid);
  const reasons: CertificateEligibilityReason[] = business.approved ? [] : [{ code: 'CREDITEX_ONBOARDING_REQUIRED', message: business.blockedReasons.join(' ') }];
  if (input.activityTemplateIds.length) {
    for (const activityTemplateId of input.activityTemplateIds) {
      const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityTemplateId);
      const members = await db.prepare("SELECT id FROM trade_team_members WHERE owner_uid=? AND status='active' AND (member_uid=owner_uid OR EXISTS(SELECT 1 FROM json_each(capabilities) WHERE value=?))").bind(input.ownerUid, activity?.serviceCategory || '').all<{ id: string }>();
      if (!members.results.length) reasons.push({ code: 'ACTIVE_TEAM_REQUIRED', message: 'The business needs an active trained team.' });
      const externalInstaller = activityTemplateId === 'veu-48' ? await db.prepare(`SELECT member.id FROM trade_team_members member WHERE member.owner_uid=? AND member.status='active' AND (member.member_uid=member.owner_uid OR EXISTS(SELECT 1 FROM json_each(member.capabilities) WHERE value='insulation')) AND ${currentExternalCredentialSql('member.owner_uid', 'member.id')} LIMIT 1`).bind(input.ownerUid).first<{ id: string }>() : null;
      if (activityTemplateId === 'veu-48' && !externalInstaller) reasons.push({ code: 'EXTERNAL_INSTALLER_REQUIRED', message: 'Activity 48 leads require an active installer with reviewed EEC certification and ESC registration.' });
      for (const member of members.results) {
        const result = await getCertificateActivityEligibility(db, { ...input, activityTemplateIds: [activityTemplateId], actorMemberId: member.id, assignedMemberId: externalInstaller?.id || member.id }); reasons.push(...result.reasons);
      }
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
export async function getTrainingProjectionData(db: D1Database, ownerUid: string) {
  const [reviews, completions] = await Promise.all([db.prepare('SELECT * FROM trade_training_module_reviews').all<Review>(), db.prepare(`SELECT completion.* FROM trade_training_completions completion JOIN trade_training_attempts attempt ON attempt.id=completion.attempt_id AND (attempt.owner_uid,attempt.member_id,attempt.module_id,attempt.version,attempt.content_hash)=(completion.owner_uid,completion.member_id,completion.module_id,completion.version,completion.content_hash) WHERE completion.owner_uid=? AND attempt.status='passed' AND attempt.score_percent=100 AND attempt.critical_passed=1 AND json_array_length(attempt.assessment_json)=25 AND NOT EXISTS(SELECT 1 FROM trade_training_completions newer WHERE newer.owner_uid=completion.owner_uid AND newer.member_id=completion.member_id AND newer.module_id=completion.module_id AND (newer.passed_at>completion.passed_at OR (newer.passed_at=completion.passed_at AND newer.rowid>completion.rowid)))`).bind(ownerUid).all<Completion>()]);
  const moduleReviews = new Map(await Promise.all(TRAINING_MODULES.map(async course => [course.id, await moduleReview(db, course, reviews.results)] as const)));
  return { reviews: reviews.results, completions: completions.results, moduleReviews };
}
export async function getTrainingModulesForMember(db: D1Database, ownerUid: string, memberId: string, cached?: Awaited<ReturnType<typeof getTrainingProjectionData>>, scope?: Awaited<ReturnType<typeof getMemberTrainingScope>>) {
  const data = cached || await getTrainingProjectionData(db, ownerUid);
  const memberScope = scope === undefined ? await getMemberTrainingScope(db, ownerUid, memberId) : scope;
  const modules = [];
  for (const course of TRAINING_MODULES) {
    const { availability, hash, review } = data.moduleReviews.get(course.id)!;
    const assessment = assessmentAvailability(course, review);
    const completion = data.completions.find(row => row.owner_uid === ownerUid && row.member_id === memberId && row.module_id === course.id);
    const current = Boolean(completion && completion.version === course.version && completion.content_hash === hash);
    const status = current ? completion?.revoked_at ? 'revoked' : Date.parse(completion?.expires_at || '') <= Date.now() ? 'expired' : 'passed'
      : assessment.assessmentAvailable ? 'required' : 'unavailable';
    const serviceCategory = GOVERNMENT_ACTIVITY_TEMPLATES.find(activity => course.activityTemplateIds.includes(activity.templateId))?.serviceCategory || '';
    modules.push({ id: course.id, version: course.version, title: course.title, programCode: course.programCode, serviceCategory, businessServiceEnabled: Boolean(memberScope?.businessCapabilities.includes(serviceCategory)), activityTemplateIds: course.activityTemplateIds, estimatedMinutes: course.estimatedMinutes, passPercent: 100, validityDays: course.validityDays, lessons: course.lessons.map(lesson => ({ ...lesson, sourceIds: learnerSourceIds(lesson.sourceIds) })), sources: course.sources.filter(source => source.id !== 'creditex-review'), availability, ...assessment, status,
      completion: completion ? { id: completion.id, reference: completion.reference, passedAt: completion.passed_at, expiresAt: completion.expires_at, revokedAt: completion.revoked_at } : null });
  }
  return modules;
}
function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    const index = Math.floor(random[0] / 4_294_967_296 * (i + 1));
    [result[i], result[index]] = [result[index], result[i]];
  }
  return result;
}
function publicAttempt(attempt: Attempt, course: TradeTrainingModule) {
  const assessment: Assessment = JSON.parse(attempt.assessment_json);
  return { id: attempt.id, moduleId: course.id, version: course.version, expiresAt: attempt.expires_at, questions: assessment.map(assigned => {
    const question = course.questions.find(item => item.id === assigned.questionId)!;
    return { id: question.id, prompt: question.prompt, options: assigned.options.map(option => ({ id: option.token, text: question.options.find(item => item.id === option.optionId)!.text })), critical: question.critical };
  }) };
}
export async function startTrainingAttempt(db: D1Database, input: { ownerUid: string; memberId: string; actorUid: string; moduleId: string }) {
  const course = findTrainingModule(input.moduleId); const { hash, review } = await moduleReview(db, course);
  const declared = await getDeclaredTrainingActivities(db, input.ownerUid, input.memberId);
  if (!declared.some(activity => course.activityTemplateIds.includes(activity.templateId))) throw new CreditexComplianceError('ACTIVITY_CAPABILITY_REQUIRED', 'Select the relevant service in your saved profile before training. Business owners train for the services saved for their business.');
  const activity = declared.find(candidate => course.activityTemplateIds.includes(candidate.templateId))!;
  const assessmentAccess = assessmentAvailability(course, review);
  if (!assessmentAccess.assessmentAvailable) throw new CreditexComplianceError('TRAINING_ASSESSMENT_UNAVAILABLE', assessmentAccess.assessmentUnavailableReason, 409);
  const reviewGuard = assessmentReviewGuard(course, review);
  const now = new Date().toISOString();
  const attempts = await db.prepare('SELECT * FROM trade_training_attempts WHERE owner_uid=? AND member_id=? AND module_id=? ORDER BY started_at DESC LIMIT 10').bind(input.ownerUid, input.memberId, course.id).all<Attempt>();
  const active = attempts.results.find(attempt => attempt.status === 'in_progress' && attempt.expires_at > now && attempt.version === course.version && attempt.content_hash === hash);
  if (active?.actor_uid === input.actorUid) return publicAttempt(active, course);
  // Web and PIN sessions identify the same authenticated member with different actors.
  // Replace that member's observed attempt atomically; never transfer its answer tokens.
  const supersededAttemptId = active?.id || '';
  const unchangedActiveAttempt = active
    ? "EXISTS(SELECT 1 FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND module_id=? AND actor_uid=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND version=? AND content_hash=?)"
    : '1=1';
  const activeAttemptBindings = active ? [active.id, input.ownerUid, input.memberId, course.id, active.actor_uid, course.version, hash] : [];
  const assessment: Assessment = shuffled(course.questions).map(question => ({ questionId: question.id, options: shuffled(question.options).map(option => ({ token: crypto.randomUUID(), optionId: option.id })) }));
  const attempt: Attempt = { id: crypto.randomUUID(), owner_uid: input.ownerUid, member_id: input.memberId, actor_uid: input.actorUid, module_id: course.id, version: course.version, content_hash: hash, status: 'in_progress', started_at: now, expires_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), submitted_at: '', assessment_json: JSON.stringify(assessment) };
  await db.batch([creditexWriteGuard(db, input.ownerUid, `${reviewGuard.sql} AND ${memberActivityScopeSql()} AND ${unchangedActiveAttempt} AND NOT EXISTS(SELECT 1 FROM trade_training_attempts WHERE owner_uid=? AND member_id=? AND module_id=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND version=? AND content_hash=? AND id<>?)`, [...reviewGuard.bindings, ...memberActivityScopeBindings(input.ownerUid, input.memberId, activity), ...activeAttemptBindings, input.ownerUid, input.memberId, course.id, course.version, hash, supersededAttemptId]),
    db.prepare("UPDATE trade_training_attempts SET status='expired' WHERE owner_uid=? AND member_id=? AND module_id=? AND status='in_progress'").bind(input.ownerUid, input.memberId, course.id),
    db.prepare('INSERT INTO trade_training_attempts(id,owner_uid,member_id,actor_uid,module_id,version,content_hash,status,started_at,expires_at,assessment_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(attempt.id, attempt.owner_uid, attempt.member_id, attempt.actor_uid, attempt.module_id, attempt.version, attempt.content_hash, attempt.status, attempt.started_at, attempt.expires_at, attempt.assessment_json),
    trainingAuditStatement(db, input.actorUid, 'attempt_started', { ...input, metadata: { attemptId: attempt.id, version: course.version, contentHash: hash, supersededAttemptId } })]);
  return publicAttempt(attempt, course);
}
export function scoreTrainingAnswers(course: TradeTrainingModule, value: unknown) {
  const answers = record(value);
  if (Object.keys(answers).length !== course.questions.length || course.questions.some(question => !question.options.some(option => option.id === answers[question.id]))) throw new CreditexComplianceError('ALL_ANSWERS_REQUIRED', 'Choose one listed answer for every question.', 400);
  const correct = course.questions.filter(question => question.correctOptionId === answers[question.id]);
  const scorePercent = Math.floor(correct.length * 100 / course.questions.length);
  const criticalPassed = course.questions.filter(question => question.critical).every(question => question.correctOptionId === answers[question.id]);
  return { scorePercent, criticalPassed, passed: correct.length === course.questions.length && criticalPassed };
}
export async function submitTrainingAttempt(db: D1Database, input: { ownerUid: string; memberId: string; actorUid: string; attemptId: string; answers: unknown }) {
  const attempt = await db.prepare('SELECT * FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=?').bind(input.attemptId, input.ownerUid, input.memberId, input.actorUid).first<Attempt>();
  if (!attempt || attempt.status !== 'in_progress' || Date.parse(attempt.expires_at) <= Date.now()) throw new CreditexComplianceError('ATTEMPT_UNAVAILABLE', 'This attempt is complete or expired. Start a new attempt.', 409);
  const course = findTrainingModule(attempt.module_id); const { hash, review } = await moduleReview(db, course);
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => course.activityTemplateIds.includes(candidate.templateId))!;
  if (attempt.version !== course.version || attempt.content_hash !== hash) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'The training version changed. Review the current course and start again.', 409);
  const assessmentAccess = assessmentAvailability(course, review);
  if (!assessmentAccess.assessmentAvailable) throw new CreditexComplianceError('TRAINING_ASSESSMENT_UNAVAILABLE', assessmentAccess.assessmentUnavailableReason, 409);
  const reviewGuard = assessmentReviewGuard(course, review);
  const tokens = record(input.answers); const assessment: Assessment = JSON.parse(attempt.assessment_json);
  const answers: Record<string, string> = {};
  if (Object.keys(tokens).length !== assessment.length) throw new CreditexComplianceError('ALL_ANSWERS_REQUIRED', 'Choose one listed answer for every question.', 400);
  for (const assigned of assessment) {
    const option = assigned.options.find(item => item.token === tokens[assigned.questionId]);
    if (!option) throw new CreditexComplianceError('ANSWER_TOKEN_INVALID', 'An answer does not belong to this question and attempt. Reload the active attempt.', 400);
    answers[assigned.questionId] = option.optionId;
  }
  const result = scoreTrainingAnswers(course, answers); const now = new Date().toISOString();
  const expiresAt = result.passed ? new Date(Date.now() + course.validityDays * 86_400_000).toISOString() : '';
  const reference = result.passed ? `TL-CX-TRAIN-${crypto.randomUUID().toUpperCase()}` : '';
  const statements = [creditexWriteGuard(db, input.ownerUid, `${reviewGuard.sql} AND EXISTS(SELECT 1 FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND version=? AND content_hash=?) AND ${memberActivityScopeSql()}`, [...reviewGuard.bindings, input.attemptId, input.ownerUid, input.memberId, input.actorUid, course.version, hash, ...memberActivityScopeBindings(input.ownerUid, input.memberId, activity)]),
    db.prepare('UPDATE trade_training_attempts SET status=?,submitted_at=?,answers_json=?,score_percent=?,critical_passed=? WHERE id=?').bind(result.passed ? 'passed' : 'failed', now, JSON.stringify(input.answers), result.scorePercent, result.criticalPassed ? 1 : 0, input.attemptId)];
  if (result.passed) statements.push(db.prepare('INSERT INTO trade_training_completions(id,attempt_id,owner_uid,member_id,module_id,version,content_hash,reference,passed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), input.attemptId, input.ownerUid, input.memberId, course.id, course.version, hash, reference, now, expiresAt));
  statements.push(trainingAuditStatement(db, input.actorUid, result.passed ? 'training_completed' : 'attempt_failed', { ...input, moduleId: course.id, metadata: { attemptId: input.attemptId, scorePercent: result.scorePercent, criticalPassed: result.criticalPassed, reference } }));
  await db.batch(statements); return { ...result, reference, expiresAt, meaning: !result.passed ? 'Assessment not passed. Every answer must be correct; review the feedback and try again.' : 'TLink learning completion. Government-programme jobs still require current business onboarding, applicable credentials and activity eligibility. This is not government accreditation or a trade licence.', feedback: course.questions.map(question => ({ questionId: question.id, prompt: question.prompt, correct: answers[question.id] === question.correctOptionId, explanation: question.explanation, sourceIds: learnerSourceIds(question.sourceIds), correctAnswer: question.options.find(option => option.id === question.correctOptionId)!.text })) };
}
export async function reviewTrainingModule(db: D1Database, reviewerUid: string, body: Record<string, unknown>) {
  const course = findTrainingModule(textField(body.moduleId, 80)); const hash = await getTrainingModuleHash(course); const note = textField(body.reviewNote, 2000);
  if (body.expectedVersion !== course.version || body.expectedHash !== hash) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'Refresh and review the exact current curriculum before making this decision.', 409);
  const expectedReviewUpdatedAt = textField(body.expectedReviewUpdatedAt, 40);
  const existingReview = await db.prepare('SELECT updated_at FROM trade_training_module_reviews WHERE module_id=?').bind(course.id).first<{ updated_at: string }>();
  if ((existingReview?.updated_at || '') !== expectedReviewUpdatedAt) throw new CreditexComplianceError('TRAINING_REVIEW_CONFLICT', 'Another reviewer changed this course. Refresh before recording a decision.', 409);
  const active = body.action === 'activate_module'; const reviewedOn = textField(body.sourceReviewedOn, 10); const expiresOn = textField(body.reviewExpiresOn, 10); const authority = textField(body.schemeAuthorityReference, 1000);
  if (active && course.sourceCoverage.status === 'partial') throw new CreditexComplianceError('CURRICULUM_SOURCES_INCOMPLETE', `The exact activity source requirements must be completed before activation: ${course.sourceCoverage.gaps.join('; ')}`, 409);
  const today = new Date().toISOString().slice(0, 10);
  if (!note || (active && (!isValidDate(reviewedOn) || reviewedOn > today || !isValidDate(expiresOn) || expiresOn < today || expiresOn < reviewedOn))) throw new CreditexComplianceError('MODULE_REVIEW_REQUIRED', 'Provide a source review date, current review expiry date and decision evidence.', 400);
  if (active && !validAssessment(course)) throw new CreditexComplianceError('CURRICULUM_INVALID', 'The course must have 25 valid questions, critical questions and a 100% pass threshold.', 409);
  if (active && course.id === 'veu-48' && !authority) throw new CreditexComplianceError('ACTIVITY48_AUTHORITY_REQUIRED', 'Record verified Creditex Activity 48 accreditation and the approved direct consumer contract model before activation.', 400);
  await db.batch([creditexWriteGuard(db, reviewerUid, "COALESCE((SELECT updated_at FROM trade_training_module_reviews WHERE module_id=?),'')=?", [course.id, expectedReviewUpdatedAt]), db.prepare(`INSERT INTO trade_training_module_reviews(module_id,version,content_hash,status,source_reviewed_on,review_expires_on,scheme_authority_reference,reviewed_by_uid,review_note,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(module_id) DO UPDATE SET version=excluded.version,content_hash=excluded.content_hash,status=excluded.status,source_reviewed_on=excluded.source_reviewed_on,review_expires_on=excluded.review_expires_on,scheme_authority_reference=excluded.scheme_authority_reference,reviewed_by_uid=excluded.reviewed_by_uid,review_note=excluded.review_note,updated_at=excluded.updated_at`).bind(course.id, course.version, hash, active ? 'active' : 'withdrawn', reviewedOn, expiresOn, authority, reviewerUid, note, new Date().toISOString()), trainingAuditStatement(db, reviewerUid, active ? 'module_activated' : 'module_withdrawn', { moduleId: course.id, metadata: { version: course.version, contentHash: hash, reviewNote: note, schemeAuthorityReference: authority } })]);
}
export async function listTrainingGovernanceModules(db: D1Database) {
  const reviews = await db.prepare('SELECT * FROM trade_training_module_reviews').all<Review>();
  return Promise.all(TRAINING_MODULES.map(async course => { const { review, availability, hash } = await moduleReview(db, course, reviews.results); return { ...course, contentHash: hash, availability, reviewUpdatedAt: review?.updated_at || '', reviewExpiresOn: review?.review_expires_on || '', sourceReviewedOn: review?.source_reviewed_on || '', schemeAuthorityReference: review?.scheme_authority_reference || '' }; }));
}
export async function revokeTrainingCompletion(db: D1Database, reviewerUid: string, completionId: string, reviewNote: string) {
  if (!reviewNote) throw new CreditexComplianceError('REVIEW_NOTE_REQUIRED', 'Record the reason for revocation.', 400);
  const row = await db.prepare('SELECT * FROM trade_training_completions WHERE id=?').bind(completionId).first<Completion>();
  if (!row) throw new CreditexComplianceError('COMPLETION_NOT_FOUND', 'Training completion not found.', 404);
  await db.batch([db.prepare("UPDATE trade_training_completions SET revoked_at=?,revocation_note=? WHERE owner_uid=? AND member_id=? AND module_id=? AND revoked_at=''").bind(new Date().toISOString(), reviewNote, row.owner_uid, row.member_id, row.module_id), trainingAuditStatement(db, reviewerUid, 'completion_revoked', { ownerUid: row.owner_uid, memberId: row.member_id, moduleId: row.module_id, metadata: { completionId, reviewNote } })]);
}
