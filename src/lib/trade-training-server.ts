import { createHash } from 'node:crypto';
import { listCurrentTrainingModules, loadTrainingModule, listRetiredTrainingModuleIds, listTrainingAssignments, currentTrainingModuleGuard, trainingSubmissionSnapshotStatement } from './training-questionnaire-store';
import { TRAINING_MODULES, type TradeTrainingModule } from '../data/creditex-training-curriculum';
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from './australian-government-program-catalogue';
import { ENERGY_SERVICE_ID_EXPANSIONS, savedEnergyServiceIds } from './energy-service-catalogue.mjs';
import { memberServiceStateProjection, memberServiceStatesSql } from './trade-team-service-states';
import { businessApprovalSql, CreditexComplianceError, creditexWriteGuard, getCreditexBusinessStatus, isValidDate, record, textField } from './creditex-onboarding-server';

export { CreditexComplianceError } from './creditex-onboarding-server';
type Review = { module_id: string; version: string; content_hash: string; status: string; source_reviewed_on: string; review_expires_on: string; scheme_authority_reference: string; reviewed_by_uid: string; updated_at: string };
type Completion = { id: string; owner_uid: string; member_id: string; module_id: string; version: string; content_hash: string; reference: string; passed_at: string; expires_at: string; revoked_at: string };
type Attempt = { id: string; owner_uid: string; member_id: string; actor_uid: string; module_id: string; version: string; content_hash: string; status: string; started_at: string; expires_at: string; submitted_at: string; assessment_json: string; answers_json: string; progress_json: string; course_json: string };
type AnswerProgress = Record<string, { answer: string; firstAnswer: string; incorrect: string[] }>;
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
  const row = await db.prepare(`SELECT a.capabilities AS business_capabilities,${trainingServiceStatesSql('a')} AS business_states,m.service_states,m.display_name,m.member_uid,${trainingCapabilitiesSql('m', 'a')} AS training_capabilities FROM trade_accounts a JOIN trade_team_members m ON m.owner_uid=a.firebase_uid AND m.id=? AND m.status='active' WHERE a.firebase_uid=?`).bind(memberId, ownerUid).first<{ business_capabilities: string; business_states: string; service_states: string | null; display_name: string; member_uid: string; training_capabilities: string }>();
  if (!row) return null;
  const capabilities = savedEnergyServiceIds(stringList(row.training_capabilities));
  const businessCapabilities = savedEnergyServiceIds(stringList(row.business_capabilities));
  const isOwner = row.member_uid === ownerUid;
  const businessServiceStates = stringList(row.business_states);
  const { serviceStates, assignedServiceStates } = memberServiceStateProjection(row.service_states, businessServiceStates, isOwner);
  const activities = GOVERNMENT_ACTIVITY_TEMPLATES.filter(activity => {
    const program = trainingPrograms.get(activity.programCode);
    return program && serviceStates.length > 0 && capabilities.includes(activity.serviceCategory) && (program.jurisdiction === 'AU' || serviceStates.includes(program.jurisdiction));
  }).map(activity => ({ ...activity, businessServiceEnabled: businessCapabilities.includes(activity.serviceCategory) }));
  const assignments = await listTrainingAssignments(db);
  const assignedModuleIds = assignments.filter(({ assignment }) => serviceStates.length > 0 && capabilities.includes(assignment.serviceCategory) && assignment.jurisdictions.some(state => state === 'AU' || serviceStates.includes(state))).map(item => item.moduleId);
  return { memberId, displayName: row.display_name, isOwner, officeOnly: !isOwner && capabilities.length === 0, capabilities, businessCapabilities, serviceStates, assignedServiceStates, businessServiceStates, activities, assignedModuleIds };
}
export async function getDeclaredTrainingActivities(db: D1Database, ownerUid: string, memberId: string) {
  return (await getMemberTrainingScope(db, ownerUid, memberId))?.activities || [];
}
function memberActivityScopeSql() {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const expanded = `CASE saved_service.value ${Object.entries(ENERGY_SERVICE_ID_EXPANSIONS).map(([alias, categories]) => `WHEN ${literal(alias)} THEN ${literal(JSON.stringify(categories))}`).join(' ')} ELSE json_array(saved_service.value) END`;
  return `EXISTS(SELECT 1 FROM trade_team_members scoped_member JOIN trade_accounts scoped_account ON scoped_account.firebase_uid=scoped_member.owner_uid WHERE scoped_member.owner_uid=? AND scoped_member.id=? AND scoped_member.status='active' AND EXISTS(SELECT 1 FROM json_each(${trainingCapabilitiesSql('scoped_member', 'scoped_account')}) saved_service CROSS JOIN json_each(${expanded}) canonical_service WHERE canonical_service.value=?) AND EXISTS(SELECT 1 FROM json_each(${memberServiceStatesSql('scoped_member', 'scoped_account')}) WHERE ?='AU' OR value IN (SELECT value FROM json_each(?))))`;
}
function memberActivityScopeBindings(ownerUid: string, memberId: string, activity: { serviceCategory: string; programCode: string; jurisdictions?: string[] }) {
  const jurisdictions = activity.jurisdictions || [trainingPrograms.get(activity.programCode)?.jurisdiction || ''];
  return [ownerUid, memberId, activity.serviceCategory, jurisdictions.includes('AU') ? 'AU' : '', JSON.stringify(jurisdictions)];
}
async function courseScopeActivity(db: D1Database, course: TradeTrainingModule) {
  const assignment = (await listTrainingAssignments(db)).find(item => item.moduleId === course.id)?.assignment;
  if (!assignment) throw new CreditexComplianceError('ACTIVITY_CAPABILITY_REQUIRED', 'This training form has no work type or location assigned.', 409);
  return { serviceCategory: assignment.serviceCategory, programCode: course.programCode, jurisdictions: assignment.jurisdictions };
}
export type CertificateEligibilityInput = { ownerUid: string; actorMemberId: string; assignedMemberId: string; activityTemplateIds: readonly string[]; serviceState?: string };
export type CertificateEligibilityReason = { code: string; message: string; activityTemplateId?: string; memberId?: string; moduleId?: string; moduleTitle?: string; trainingHref?: string };

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
  return course.questions.length >= 1 && course.questions.length <= 60 && course.passPercent === 100 && course.questions.some(question => question.critical)
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
  const publication = currentTrainingModuleGuard(course);
  const decision = review ? {
    sql: `EXISTS(SELECT 1 FROM trade_training_module_reviews WHERE module_id=? AND version=? AND content_hash=? AND status='active' AND reviewed_by_uid=? AND source_reviewed_on=? AND review_expires_on=? AND updated_at=?)`,
    bindings: [course.id, review.version, review.content_hash, review.reviewed_by_uid, review.source_reviewed_on, review.review_expires_on, review.updated_at],
  } : { sql: 'NOT EXISTS(SELECT 1 FROM trade_training_module_reviews WHERE module_id=?)', bindings: [course.id] };
  return { sql: `(${decision.sql}) AND (${publication.sql})`, bindings: [...decision.bindings, ...publication.bindings] };
}
const learnerSourceIds = (ids: readonly string[]) => ids.filter(id => id !== 'creditex-review');
function currentCompletionSql(owner: string, member: string, course: string, version: string, hash: string) {
  return `EXISTS(SELECT 1 FROM trade_training_current_completions ttc WHERE ttc.owner_uid=${owner} AND ttc.member_id=${member} AND ttc.module_id=${course} AND ttc.version=${version} AND ttc.content_hash=${hash} AND ttc.external_required=0)`;
}
export async function certificateActivityEligibilityPredicate(input: CertificateEligibilityInput) {
  if (!input.activityTemplateIds.length) return { sql: '1=1', bindings: [] as (string | number)[] };
  const ids = [...new Set(input.activityTemplateIds)];
  if (ids.length > 20 || !input.ownerUid || !input.actorMemberId || !input.assignedMemberId) return { sql: '0=1', bindings: [] as (string | number)[] };
  const courseRows: string[] = [];
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const serviceState = input.serviceState?.trim().toUpperCase();
  if (serviceState !== undefined && !['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].includes(serviceState)) return { sql: '0=1', bindings: [] as (string | number)[] };
  for (const activityId of ids) {
    const course = TRAINING_MODULES.find(candidate => candidate.activityTemplateIds.includes(activityId));
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityId);
    const program = activity ? trainingPrograms.get(activity.programCode) : undefined;
    if (!course || !activity || !program || ['closed', 'future'].includes(activity.catalogueState) || ['closed', 'future'].includes(program.catalogueState)) return { sql: '0=1', bindings: [] as (string | number)[] };
    if (serviceState && program.jurisdiction !== 'AU' && program.jurisdiction !== serviceState) return { sql: '0=1', bindings: [] as (string | number)[] };
    courseRows.push(`(${[course.id, course.version, getTrainingModuleHash(course), activity.serviceCategory, program.jurisdiction].map(literal).join(',')},${course.id === 'veu-48' ? 1 : 0},${isTrainingModuleReady(course) ? 1 : 0})`);
  }
  // Metadata comes only from the versioned catalogue. Three bound identity values
  // keep a twenty-activity batch below D1's 100-parameter limit.
  const sql = `EXISTS(WITH training_input(owner_uid,actor_member_id,assigned_member_id) AS (VALUES (?,?,?)),
    deployed_course(module_id,version,content_hash,category,jurisdiction,external_required,source_complete) AS (VALUES ${courseRows.join(',')}),
    required_course AS (SELECT deployed.module_id,COALESCE(published.version,deployed.version) version,COALESCE(published.content_hash,deployed.content_hash) content_hash,deployed.category,deployed.jurisdiction,deployed.external_required,CASE WHEN published.module_id IS NOT NULL THEN 1 ELSE deployed.source_complete END source_complete,0 additional,
      EXISTS(SELECT 1 FROM trade_training_module_retirements retired WHERE retired.module_id=deployed.module_id) retired
      FROM deployed_course deployed LEFT JOIN trade_training_published_questionnaires published ON published.module_id=deployed.module_id
      UNION ALL
      SELECT additional.module_id,additional.version,additional.content_hash,additional.category,additional.jurisdiction,0,1,1,0
      FROM trade_training_additional_requirements additional
      WHERE EXISTS(SELECT 1 FROM deployed_course requested WHERE requested.category=additional.category
          AND (additional.jurisdiction='AU' OR additional.jurisdiction=requested.jurisdiction OR (requested.jurisdiction='AU'
            AND EXISTS(SELECT 1 FROM trade_training_served_jurisdictions served JOIN training_input ON served.owner_uid=training_input.owner_uid WHERE served.state=additional.jurisdiction${serviceState ? ` AND served.state=${literal(serviceState)}` : ''}))))),
    required_person(member_id) AS (
      SELECT assigned_member_id FROM training_input
      UNION SELECT owner_member.id FROM trade_team_members owner_member JOIN training_input ON owner_member.owner_uid=training_input.owner_uid WHERE owner_member.member_uid=training_input.owner_uid AND owner_member.status='active'
    )
    SELECT 1 FROM training_input WHERE ${businessApprovalSql('training_input.owner_uid')}
      AND EXISTS(SELECT 1 FROM trade_team_members booking_actor WHERE booking_actor.owner_uid=training_input.owner_uid AND booking_actor.id=training_input.actor_member_id AND booking_actor.status='active')
      AND EXISTS(SELECT 1 FROM trade_team_members assigned_member JOIN trade_accounts assigned_business ON assigned_business.firebase_uid=assigned_member.owner_uid
        WHERE assigned_member.id=training_input.assigned_member_id AND assigned_member.owner_uid=training_input.owner_uid AND assigned_member.status='active'
          AND EXISTS(SELECT 1 FROM json_each(${memberServiceStatesSql('assigned_member', 'assigned_business')})${serviceState ? ` WHERE value=${literal(serviceState)}` : ''}))
      AND EXISTS(SELECT 1 FROM trade_team_members owner_member WHERE owner_member.owner_uid=training_input.owner_uid AND owner_member.member_uid=training_input.owner_uid AND owner_member.status='active')
      AND NOT EXISTS(SELECT 1 FROM required_course WHERE
        (required_course.retired=0 AND required_course.source_complete=0) OR NOT EXISTS(SELECT 1 FROM trade_accounts scoped_account WHERE scoped_account.firebase_uid=training_input.owner_uid
          AND EXISTS(SELECT 1 FROM json_each(scoped_account.capabilities) WHERE value=required_course.category)
          AND (required_course.jurisdiction='AU' OR EXISTS(SELECT 1 FROM json_each(${trainingServiceStatesSql('scoped_account')}) WHERE value=required_course.jurisdiction)))
        OR EXISTS(SELECT 1 FROM required_person WHERE
          (required_course.additional=0 OR EXISTS(SELECT 1 FROM trade_team_members applicable_member JOIN trade_accounts applicable_business ON applicable_business.firebase_uid=applicable_member.owner_uid
            WHERE applicable_member.id=required_person.member_id AND applicable_member.owner_uid=training_input.owner_uid AND (applicable_member.member_uid=training_input.owner_uid OR required_course.jurisdiction='AU' OR EXISTS(SELECT 1 FROM json_each(${memberServiceStatesSql('applicable_member', 'applicable_business')}) WHERE value=required_course.jurisdiction))))
          AND (NOT EXISTS(SELECT 1 FROM trade_team_members scoped_member JOIN trade_accounts scoped_business ON scoped_business.firebase_uid=scoped_member.owner_uid WHERE scoped_member.owner_uid=training_input.owner_uid AND scoped_member.id=required_person.member_id AND scoped_member.status='active'
            AND (scoped_member.member_uid=training_input.owner_uid OR EXISTS(SELECT 1 FROM json_each(scoped_member.capabilities) WHERE value=required_course.category))
            AND EXISTS(SELECT 1 FROM json_each(${memberServiceStatesSql('scoped_member', 'scoped_business')}) WHERE required_course.jurisdiction='AU' OR value=required_course.jurisdiction))
          OR (required_course.retired=0 AND NOT ${currentCompletionSql('training_input.owner_uid', 'required_person.member_id', 'required_course.module_id', 'required_course.version', 'required_course.content_hash')})
        ))
        OR (required_course.external_required=1 AND (
          (required_course.retired=0 AND NOT EXISTS(SELECT 1 FROM trade_training_current_completions installer_pass WHERE installer_pass.owner_uid=training_input.owner_uid AND installer_pass.member_id=training_input.assigned_member_id AND installer_pass.module_id=required_course.module_id AND installer_pass.version=required_course.version AND installer_pass.content_hash=required_course.content_hash AND installer_pass.external_required=1))
          OR (required_course.retired=1 AND (
            NOT EXISTS(SELECT 1 FROM trade_training_module_reviews authority WHERE authority.module_id=required_course.module_id AND authority.status='active' AND authority.scheme_authority_reference<>'' AND authority.reviewed_by_uid<>'' AND date(authority.source_reviewed_on)<=date('now') AND date(authority.review_expires_on)>=date('now'))
            OR NOT EXISTS(SELECT 1 FROM trade_training_external_credentials credential JOIN trade_team_member_files evidence ON evidence.id=credential.document_id AND evidence.owner_uid=credential.owner_uid AND evidence.team_member_id=credential.member_id AND evidence.status='active'
              WHERE credential.owner_uid=training_input.owner_uid AND credential.member_id=training_input.assigned_member_id AND credential.module_id=required_course.module_id AND credential.revoked_at='' AND credential.reviewed_by_uid<>'' AND credential.credential_reference<>'' AND credential.scheme_participant_reference<>'' AND date(credential.expires_on)>=date('now') AND (evidence.expires_at='' OR date(evidence.expires_at)>=date('now')))
          ))))
      ))`;
  return { sql, bindings: [input.ownerUid, input.actorMemberId, input.assignedMemberId] };
}
export async function certificateActivityEligibilityGuardStatement(db: D1Database, input: CertificateEligibilityInput) {
  const predicate = await certificateActivityEligibilityPredicate(input);
  return creditexWriteGuard(db, input.ownerUid, predicate.sql, predicate.bindings);
}
export async function getCertificateActivityEligibility(db: D1Database, input: CertificateEligibilityInput): Promise<{ eligible: boolean; reasons: CertificateEligibilityReason[] }> {
  const reasons: CertificateEligibilityReason[] = [];
  if (!input.activityTemplateIds.length) return { eligible: true, reasons };
  const business = await getCreditexBusinessStatus(db, input.ownerUid);
  if (!business.approved) reasons.push({ code: 'CREDITEX_ONBOARDING_REQUIRED', message: business.blockedReasons.join(' ') });
  if (!input.actorMemberId || !input.assignedMemberId) reasons.push({ code: 'TRAINED_ASSIGNEE_REQUIRED', message: 'Choose an active team member who has passed the activity training.' });
  if (reasons.length) return { eligible: false, reasons };
  const actor = await db.prepare("SELECT id FROM trade_team_members WHERE owner_uid=? AND id=? AND status='active'").bind(input.ownerUid, input.actorMemberId).first();
  if (!actor) return { eligible: false, reasons: [{ code: 'ACTIVE_BOOKING_MEMBER_REQUIRED', message: 'The person booking must be an active member of this business.' }] };
  const assignedScope = await getMemberTrainingScope(db, input.ownerUid, input.assignedMemberId);
  const owner = await db.prepare("SELECT id FROM trade_team_members WHERE owner_uid=? AND member_uid=? AND status='active' LIMIT 1").bind(input.ownerUid, input.ownerUid).first<{ id: string }>();
  if (!owner || !assignedScope) return { eligible: false, reasons: [{ code: 'ACTIVE_TEAM_REQUIRED', message: 'Choose an active technician in a business with an active owner.' }] };
  const serviceState = input.serviceState?.trim().toUpperCase();
  if (!assignedScope.serviceStates.length || (serviceState !== undefined && !assignedScope.serviceStates.includes(serviceState))) return { eligible: false, reasons: [{ code: 'MEMBER_SERVICE_REGION_REQUIRED', message: 'Choose a technician who works in the job location. Their assigned regions must be included in the business service regions.' }] };
  const retired = await listRetiredTrainingModuleIds(db);
  for (const activityTemplateId of [...new Set(input.activityTemplateIds)]) {
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityTemplateId);
    const program = activity ? trainingPrograms.get(activity.programCode) : undefined;
    if (activity && program && (['closed', 'future'].includes(activity.catalogueState) || ['closed', 'future'].includes(program.catalogueState))) {
      reasons.push({ code: 'PROGRAMME_ACTIVITY_NOT_OPEN', message: 'This government programme or activity is closed or not yet open. Training completion does not permit booking it.', activityTemplateId }); continue;
    }
    const seedCourse = TRAINING_MODULES.find(candidate => candidate.activityTemplateIds.includes(activityTemplateId));
    const course = seedCourse && !retired.has(seedCourse.id) ? await loadTrainingModule(db, seedCourse.id) : undefined;
    if (!seedCourse) { reasons.push({ code: 'TRAINING_MODULE_UNAVAILABLE', message: 'This activity has no activity-specific training course and is unavailable for certificate jobs.', activityTemplateId }); continue; }
    if (!activity || !program || !assignedScope.businessCapabilities.includes(activity.serviceCategory) || !assignedScope.capabilities.includes(activity.serviceCategory)) {
      reasons.push({ code: 'MEMBER_CAPABILITY_REQUIRED', message: 'Enable this service for both the business and the assigned technician before booking.', activityTemplateId }); continue;
    }
    if (program.jurisdiction !== 'AU' && (!assignedScope.serviceStates.includes(program.jurisdiction) || (serviceState !== undefined && program.jurisdiction !== serviceState))) {
      reasons.push({ code: 'MEMBER_SERVICE_REGION_REQUIRED', message: `Choose a technician who works in ${program.jurisdiction} for this activity.`, activityTemplateId }); continue;
    }
    if (course) {
      const { review } = await moduleReview(db, course);
      const assessment = assessmentAvailability(course, review);
      if (!assessment.assessmentAvailable) { reasons.push({ code: 'TRAINING_CONTENT_UNAVAILABLE', message: assessment.assessmentUnavailableReason, activityTemplateId }); continue; }
    }
    const predicate = await certificateActivityEligibilityPredicate({ ...input, activityTemplateIds: [activityTemplateId] });
    if (!await db.prepare(`SELECT 1 AS eligible WHERE ${predicate.sql}`).bind(...predicate.bindings).first()) {
      const assignments = await listTrainingAssignments(db);
      const additional = assignments.filter(({ assignment }) => assignment.kind === 'additional' && assignment.serviceCategory === activity.serviceCategory
        && assignment.jurisdictions.some(state => state === 'AU' || state === program.jurisdiction || (program.jurisdiction === 'AU' && (serviceState ? state === serviceState : assignedScope.businessServiceStates.includes(state)))));
      const required = course ? [{ course, members: [...new Set([owner.id, input.assignedMemberId])] }] : [];
      for (const extra of additional) {
        const extraCourse = await loadTrainingModule(db, extra.moduleId);
        if (extraCourse) required.push({ course: extraCourse, members: [...new Set([owner.id, ...(extra.assignment.jurisdictions.some(state => state === 'AU' || assignedScope.serviceStates.includes(state)) ? [input.assignedMemberId] : [])])] });
      }
      let missingPass = false;
      let unavailableContent = false;
      for (const requirement of required) {
        const { review: requiredReview } = await moduleReview(db, requirement.course);
        const requiredAvailability = assessmentAvailability(requirement.course, requiredReview);
        if (!requiredAvailability.assessmentAvailable) {
          unavailableContent = true;
          reasons.push({ code: 'TRAINING_CONTENT_UNAVAILABLE', message: `${requirement.course.title}: ${requiredAvailability.assessmentUnavailableReason}`, activityTemplateId });
          continue;
        }
        const passes = await db.prepare('SELECT member_id FROM trade_training_current_completions WHERE owner_uid=? AND module_id=? AND version=? AND content_hash=? AND external_required=0').bind(input.ownerUid, requirement.course.id, requirement.course.version, getTrainingModuleHash(requirement.course)).all<{ member_id: string }>();
        const missingMembers = requirement.members.filter(memberId => !passes.results.some(pass => pass.member_id === memberId));
        if (!missingMembers.length) continue;
        missingPass = true;
        const people = missingMembers.map(memberId => memberId === owner.id ? 'Business owner' : assignedScope.displayName || 'Assigned technician');
        reasons.push({ code: 'ACTIVITY_TRAINING_REQUIRED', message: `This booking can be made once the required training module is complete. Required module: ${requirement.course.title}. To be completed by: ${people.join(', ')}.`, activityTemplateId, moduleId: requirement.course.id, moduleTitle: requirement.course.title, trainingHref: `/direct-trade/dashboard?workspace=training&module=${encodeURIComponent(requirement.course.id)}` });
      }
      if (!missingPass && !unavailableContent) reasons.push(seedCourse.id === 'veu-48'
        ? { code: 'EXTERNAL_INSTALLER_REQUIRED', message: 'The assigned technician needs current scheme credentials for this activity before booking.', activityTemplateId }
        : { code: 'CERTIFICATE_ELIGIBILITY_CHANGED', message: 'The current business, technician or activity requirements changed. Refresh the job details before booking.', activityTemplateId });
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
export async function assertCertificateActivityEligibility(db: D1Database, input: CertificateEligibilityInput) {
  const result = await getCertificateActivityEligibility(db, input);
  if (!result.eligible) {
    const error = new CreditexComplianceError(result.reasons[0].code, result.reasons.map(reason => reason.message).join(' '));
    error.trainingModules = [...new Map(result.reasons.filter(reason => reason.moduleId && reason.moduleTitle).map(reason => [reason.moduleId!, { id: reason.moduleId!, title: reason.moduleTitle! }])).values()];
    throw error;
  }
}
export async function getBusinessCertificateLeadEligibility(db: D1Database, input: { ownerUid: string; activityTemplateIds: readonly string[] }) {
  const business = await getCreditexBusinessStatus(db, input.ownerUid);
  const reasons: CertificateEligibilityReason[] = business.approved ? [] : [{ code: 'CREDITEX_ONBOARDING_REQUIRED', message: business.blockedReasons.join(' ') }];
  if (input.activityTemplateIds.length) {
    for (const activityTemplateId of input.activityTemplateIds) {
      const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(candidate => candidate.templateId === activityTemplateId);
      const program = activity ? trainingPrograms.get(activity.programCode) : undefined;
      if (!activity || !program) { reasons.push({ code: 'ACTIVITY_NOT_FOUND', message: 'Choose a recognised activity.', activityTemplateId }); continue; }
      const scoped = await db.prepare(`SELECT 1 FROM trade_accounts account WHERE account.firebase_uid=? AND EXISTS(SELECT 1 FROM json_each(account.capabilities) WHERE value=?) AND EXISTS(SELECT 1 FROM trade_training_served_jurisdictions served WHERE served.owner_uid=account.firebase_uid AND (?='AU' OR served.state=?)) AND EXISTS(SELECT 1 FROM trade_team_members owner WHERE owner.owner_uid=account.firebase_uid AND owner.member_uid=account.firebase_uid AND owner.status='active')`).bind(input.ownerUid, activity.serviceCategory, program.jurisdiction, program.jurisdiction).first();
      if (!scoped) reasons.push({ code: 'BUSINESS_SERVICE_SCOPE_REQUIRED', message: 'Enable this service and its region in the active business profile to receive these leads.', activityTemplateId });
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
export async function getTrainingProjectionData(db: D1Database, ownerUid: string) {
  const [reviews, completions] = await Promise.all([db.prepare('SELECT * FROM trade_training_module_reviews').all<Review>(), db.prepare(`SELECT completion.* FROM trade_training_completions completion JOIN trade_training_attempts attempt ON attempt.id=completion.attempt_id AND (attempt.owner_uid,attempt.member_id,attempt.module_id,attempt.version,attempt.content_hash)=(completion.owner_uid,completion.member_id,completion.module_id,completion.version,completion.content_hash) WHERE completion.owner_uid=? AND attempt.status='passed' AND attempt.score_percent=100 AND attempt.critical_passed=1 AND ((json_type(attempt.course_json,'$.questions')='array' AND json_array_length(attempt.course_json,'$.questions') BETWEEN 1 AND 60 AND json_array_length(attempt.assessment_json)=json_array_length(attempt.course_json,'$.questions')) OR (attempt.course_json='{}' AND json_array_length(attempt.assessment_json)=25)) AND NOT EXISTS(SELECT 1 FROM trade_training_completions newer WHERE newer.owner_uid=completion.owner_uid AND newer.member_id=completion.member_id AND newer.module_id=completion.module_id AND (newer.passed_at>completion.passed_at OR (newer.passed_at=completion.passed_at AND newer.rowid>completion.rowid)))`).bind(ownerUid).all<Completion>()]);
  const courses = await listCurrentTrainingModules(db);
  const moduleReviews = new Map(await Promise.all(courses.map(async course => [course.id, await moduleReview(db, course, reviews.results)] as const)));
  return { reviews: reviews.results, completions: completions.results, moduleReviews, courses, assignments: await listTrainingAssignments(db) };
}
export async function getTrainingModulesForMember(db: D1Database, ownerUid: string, memberId: string, cached?: Awaited<ReturnType<typeof getTrainingProjectionData>>, scope?: Awaited<ReturnType<typeof getMemberTrainingScope>>) {
  const data = cached || await getTrainingProjectionData(db, ownerUid);
  const memberScope = scope === undefined ? await getMemberTrainingScope(db, ownerUid, memberId) : scope;
  const modules = [];
  for (const course of data.courses) {
    const { availability, hash, review } = data.moduleReviews.get(course.id)!;
    const assessment = assessmentAvailability(course, review);
    const completion = data.completions.find(row => row.owner_uid === ownerUid && row.member_id === memberId && row.module_id === course.id);
    const current = Boolean(completion && completion.version === course.version && completion.content_hash === hash);
    const status = current ? completion?.revoked_at ? 'revoked' : Date.parse(completion?.expires_at || '') <= Date.now() ? 'expired' : 'passed'
      : assessment.assessmentAvailable ? 'required' : 'unavailable';
    const assignment = data.assignments.find(item => item.moduleId === course.id)?.assignment;
    const serviceCategory = assignment?.serviceCategory || '';
    modules.push({ id: course.id, version: course.version, title: course.title, programCode: course.programCode, serviceCategory, businessServiceEnabled: Boolean(memberScope?.businessCapabilities.includes(serviceCategory)), activityTemplateIds: course.activityTemplateIds, estimatedMinutes: course.estimatedMinutes, passPercent: 100, validityDays: course.validityDays, lessons: course.lessons.map(lesson => ({ ...lesson, sourceIds: learnerSourceIds(lesson.sourceIds) })), sources: course.sources.filter(source => source.id !== 'creditex-review'), availability, ...assessment, status,
      kind: assignment?.kind, jurisdictions: assignment?.jurisdictions, trainingSection: assignment?.trainingSection, completion: completion ? { id: completion.id, reference: completion.reference, passedAt: completion.passed_at, expiresAt: completion.expires_at, revokedAt: completion.revoked_at } : null });
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
  const progress: AnswerProgress = JSON.parse(attempt.progress_json || '{}');
  const feedback = Object.fromEntries(Object.entries(progress).map(([id, entry]) => [id, checkedAnswerFeedback(course, id, entry.answer, assessment)]));
  return { id: attempt.id, moduleId: course.id, version: course.version, expiresAt: attempt.expires_at, answers: Object.fromEntries(Object.entries(progress).map(([id, entry]) => [id, entry.answer])), feedback, questions: assessment.map(assigned => {
    const question = course.questions.find(item => item.id === assigned.questionId)!;
    return { id: question.id, prompt: question.prompt, options: assigned.options.map(option => ({ id: option.token, text: question.options.find(item => item.id === option.optionId)!.text })), critical: question.critical };
  }) };
}
export async function startTrainingAttempt(db: D1Database, input: { ownerUid: string; memberId: string; actorUid: string; moduleId: string }) {
  const course = await loadTrainingModule(db, input.moduleId); const { hash, review } = await moduleReview(db, course);
  const scope = await getMemberTrainingScope(db, input.ownerUid, input.memberId);
  if (!scope?.assignedModuleIds.includes(course.id)) throw new CreditexComplianceError('ACTIVITY_CAPABILITY_REQUIRED', 'Select the relevant service in your saved profile before training. Business owners train for the services saved for their business.');
  const activity = await courseScopeActivity(db, course);
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
  const attempt: Attempt = { id: crypto.randomUUID(), owner_uid: input.ownerUid, member_id: input.memberId, actor_uid: input.actorUid, module_id: course.id, version: course.version, content_hash: hash, status: 'in_progress', started_at: now, expires_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), submitted_at: '', assessment_json: JSON.stringify(assessment), answers_json: '{}', progress_json: '{}', course_json: JSON.stringify(course) };
  await db.batch([creditexWriteGuard(db, input.ownerUid, `${reviewGuard.sql} AND ${memberActivityScopeSql()} AND ${unchangedActiveAttempt} AND NOT EXISTS(SELECT 1 FROM trade_training_attempts WHERE owner_uid=? AND member_id=? AND module_id=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND version=? AND content_hash=? AND id<>?)`, [...reviewGuard.bindings, ...memberActivityScopeBindings(input.ownerUid, input.memberId, activity), ...activeAttemptBindings, input.ownerUid, input.memberId, course.id, course.version, hash, supersededAttemptId]),
    db.prepare("UPDATE trade_training_attempts SET status='expired' WHERE owner_uid=? AND member_id=? AND module_id=? AND status='in_progress'").bind(input.ownerUid, input.memberId, course.id),
    db.prepare('INSERT INTO trade_training_attempts(id,owner_uid,member_id,actor_uid,module_id,version,content_hash,status,started_at,expires_at,assessment_json,course_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(attempt.id, attempt.owner_uid, attempt.member_id, attempt.actor_uid, attempt.module_id, attempt.version, attempt.content_hash, attempt.status, attempt.started_at, attempt.expires_at, attempt.assessment_json, attempt.course_json),
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
function checkedAnswerFeedback(course: TradeTrainingModule, questionId: string, token: string, assessment: Assessment) {
  const question = course.questions.find(item => item.id === questionId);
  const option = assessment.find(item => item.questionId === questionId)?.options.find(item => item.token === token);
  if (!question || !option) throw new CreditexComplianceError('ANSWER_TOKEN_INVALID', 'Choose an answer from this question.', 400);
  return { questionId, correct: option.optionId === question.correctOptionId, explanation: question.explanation,
    correctAnswer: question.options.find(item => item.id === question.correctOptionId)!.text, sourceIds: learnerSourceIds(question.sourceIds) };
}
export async function checkTrainingAnswer(db: D1Database, input: { ownerUid: string; memberId: string; actorUid: string; attemptId: string; questionId: string; answer: string }) {
  const attempt = await db.prepare('SELECT * FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=?').bind(input.attemptId, input.ownerUid, input.memberId, input.actorUid).first<Attempt>();
  if (!attempt || attempt.status !== 'in_progress' || Date.parse(attempt.expires_at) <= Date.now()) throw new CreditexComplianceError('ATTEMPT_UNAVAILABLE', 'This attempt is complete or expired. Reopen the module to continue.', 409);
  const course = await loadTrainingModule(db, attempt.module_id);
  const { hash, review } = await moduleReview(db, course);
  if (attempt.version !== course.version || attempt.content_hash !== hash) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'This module has been updated. Open the current module before continuing.', 409);
  const access = assessmentAvailability(course, review);
  if (!access.assessmentAvailable) throw new CreditexComplianceError('TRAINING_ASSESSMENT_UNAVAILABLE', access.assessmentUnavailableReason, 409);
  const assessment: Assessment = JSON.parse(attempt.assessment_json);
  const progress: AnswerProgress = JSON.parse(attempt.progress_json || '{}');
  const index = assessment.findIndex(item => item.questionId === input.questionId);
  if (index < 0) throw new CreditexComplianceError('QUESTION_INVALID', 'This question is not in your assessment.', 400);
  if (assessment.slice(0, index).some(item => !progress[item.questionId] || !checkedAnswerFeedback(course, item.questionId, progress[item.questionId].answer, assessment).correct)) throw new CreditexComplianceError('PREVIOUS_QUESTION_REQUIRED', 'Complete the earlier questions correctly first.', 409);
  const previous = progress[input.questionId];
  if (previous && checkedAnswerFeedback(course, input.questionId, previous.answer, assessment).correct) return checkedAnswerFeedback(course, input.questionId, previous.answer, assessment);
  const feedback = checkedAnswerFeedback(course, input.questionId, input.answer, assessment);
  const canonical = assessment[index].options.find(item => item.token === input.answer)!.optionId;
  progress[input.questionId] = { answer: input.answer, firstAnswer: previous?.firstAnswer || canonical, incorrect: [...new Set([...(previous?.incorrect || []), ...(!feedback.correct ? [canonical] : [])])] };
  const activity = await courseScopeActivity(db, course);
  const guard = assessmentReviewGuard(course, review);
  await db.batch([creditexWriteGuard(db, input.ownerUid, `${guard.sql} AND ${memberActivityScopeSql()} AND EXISTS(SELECT 1 FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND progress_json=?)`, [...guard.bindings, ...memberActivityScopeBindings(input.ownerUid, input.memberId, activity), input.attemptId, input.ownerUid, input.memberId, input.actorUid, attempt.progress_json]),
    db.prepare("UPDATE trade_training_attempts SET progress_json=? WHERE id=?").bind(JSON.stringify(progress), attempt.id)]);
  return feedback;
}
export async function submitTrainingAttempt(db: D1Database, input: { ownerUid: string; memberId: string; actorUid: string; attemptId: string; answers: unknown }) {
  const attempt = await db.prepare('SELECT * FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=?').bind(input.attemptId, input.ownerUid, input.memberId, input.actorUid).first<Attempt>();
  if (attempt && ['passed', 'failed'].includes(attempt.status)) {
    const saved = await db.prepare('SELECT result_json FROM trade_training_submissions WHERE attempt_id=? AND owner_uid=? AND member_id=? AND actor_uid=?').bind(input.attemptId, input.ownerUid, input.memberId, input.actorUid).first<{ result_json: string }>();
    if (saved) return JSON.parse(saved.result_json);
  }
  if (!attempt || attempt.status !== 'in_progress' || Date.parse(attempt.expires_at) <= Date.now()) throw new CreditexComplianceError('ATTEMPT_UNAVAILABLE', 'This attempt is complete or expired. Start a new attempt.', 409);
  const course = await loadTrainingModule(db, attempt.module_id); const { hash, review } = await moduleReview(db, course);
  const activity = await courseScopeActivity(db, course);
  if (attempt.version !== course.version || attempt.content_hash !== hash) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'The training version changed. Review the current course and start again.', 409);
  const assessmentAccess = assessmentAvailability(course, review);
  if (!assessmentAccess.assessmentAvailable) throw new CreditexComplianceError('TRAINING_ASSESSMENT_UNAVAILABLE', assessmentAccess.assessmentUnavailableReason, 409);
  const reviewGuard = assessmentReviewGuard(course, review);
  const tokens = record(input.answers); const assessment: Assessment = JSON.parse(attempt.assessment_json);
  const progress: AnswerProgress = JSON.parse(attempt.progress_json || '{}');
  const answers: Record<string, string> = {};
  if (Object.keys(tokens).length !== assessment.length) throw new CreditexComplianceError('ALL_ANSWERS_REQUIRED', 'Choose one listed answer for every question.', 400);
  for (const assigned of assessment) {
    const option = assigned.options.find(item => item.token === tokens[assigned.questionId]);
    if (!option) throw new CreditexComplianceError('ANSWER_TOKEN_INVALID', 'An answer does not belong to this question and attempt. Reload the active attempt.', 400);
    answers[assigned.questionId] = option.optionId;
  }
  // Attempts started by the guided flow must check each answer in sequence.
  // Legacy open attempts can still submit their existing complete answer set.
  if (attempt.course_json !== '{}' && assessment.some(item => !progress[item.questionId] || progress[item.questionId].answer !== tokens[item.questionId] || !checkedAnswerFeedback(course, item.questionId, progress[item.questionId].answer, assessment).correct)) throw new CreditexComplianceError('CHECK_ANSWERS_REQUIRED', 'Check and correct every question before submitting. Your progress is saved.', 409);
  const result = scoreTrainingAnswers(course, answers); const now = new Date().toISOString();
  const firstTryScorePercent = Math.floor(course.questions.filter(question => (progress[question.id]?.firstAnswer || answers[question.id]) === question.correctOptionId).length * 100 / course.questions.length);
  const expiresAt = result.passed ? new Date(Date.now() + course.validityDays * 86_400_000).toISOString() : '';
  const reference = result.passed ? `TL-CX-TRAIN-${crypto.randomUUID().toUpperCase()}` : '';
  const statements = [creditexWriteGuard(db, input.ownerUid, `${reviewGuard.sql} AND EXISTS(SELECT 1 FROM trade_training_attempts WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=? AND status='in_progress' AND datetime(expires_at)>datetime('now') AND version=? AND content_hash=?) AND ${memberActivityScopeSql()}`, [...reviewGuard.bindings, input.attemptId, input.ownerUid, input.memberId, input.actorUid, course.version, hash, ...memberActivityScopeBindings(input.ownerUid, input.memberId, activity)]),
    db.prepare('UPDATE trade_training_attempts SET status=?,submitted_at=?,answers_json=?,score_percent=?,critical_passed=? WHERE id=?').bind(result.passed ? 'passed' : 'failed', now, JSON.stringify(input.answers), result.scorePercent, result.criticalPassed ? 1 : 0, input.attemptId)];
  if (result.passed) statements.push(db.prepare('INSERT INTO trade_training_completions(id,attempt_id,owner_uid,member_id,module_id,version,content_hash,reference,passed_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), input.attemptId, input.ownerUid, input.memberId, course.id, course.version, hash, reference, now, expiresAt));
  statements.push(trainingAuditStatement(db, input.actorUid, result.passed ? 'training_completed' : 'attempt_failed', { ...input, moduleId: course.id, metadata: { attemptId: input.attemptId, scorePercent: result.scorePercent, criticalPassed: result.criticalPassed, reference } }));
  const response = { ...result, firstTryScorePercent, reference, expiresAt, meaning: !result.passed ? 'Correct the remaining answers to complete your learning.' : 'Your activity learning is complete. Business setup, required licences and job records are still needed before certificate work.', feedback: course.questions.map(question => ({ questionId: question.id, prompt: question.prompt, correct: answers[question.id] === question.correctOptionId, explanation: question.explanation, sourceIds: learnerSourceIds(question.sourceIds), correctAnswer: question.options.find(option => option.id === question.correctOptionId)!.text })) };
  statements.push(trainingSubmissionSnapshotStatement(db, { ...input, course, answers, incorrectAnswers: Object.fromEntries(Object.entries(progress).map(([id, entry]) => [id, entry.incorrect])), reference, completedAt: now, result: response }));
  try { await db.batch(statements); }
  catch (error) {
    // A second submit can race the first after a lost response. Return only the
    // committed result for this exact authenticated attempt; never award twice.
    const saved = await db.prepare('SELECT result_json FROM trade_training_submissions WHERE attempt_id=? AND owner_uid=? AND member_id=? AND actor_uid=?').bind(input.attemptId, input.ownerUid, input.memberId, input.actorUid).first<{ result_json: string }>();
    if (saved) return JSON.parse(saved.result_json);
    throw error;
  }
  return response;
}
export async function reviewTrainingModule(db: D1Database, reviewerUid: string, body: Record<string, unknown>) {
  const course = await loadTrainingModule(db, textField(body.moduleId, 80), { forSchemeAuthority: true }); const hash = await getTrainingModuleHash(course); const note = textField(body.reviewNote, 2000);
  if (body.expectedVersion !== course.version || body.expectedHash !== hash) throw new CreditexComplianceError('TRAINING_VERSION_CHANGED', 'Refresh and review the exact current curriculum before making this decision.', 409);
  const expectedReviewUpdatedAt = textField(body.expectedReviewUpdatedAt, 40);
  const existingReview = await db.prepare('SELECT updated_at FROM trade_training_module_reviews WHERE module_id=?').bind(course.id).first<{ updated_at: string }>();
  if ((existingReview?.updated_at || '') !== expectedReviewUpdatedAt) throw new CreditexComplianceError('TRAINING_REVIEW_CONFLICT', 'Another reviewer changed this course. Refresh before recording a decision.', 409);
  const active = body.action === 'activate_module'; const reviewedOn = textField(body.sourceReviewedOn, 10); const expiresOn = textField(body.reviewExpiresOn, 10); const authority = textField(body.schemeAuthorityReference, 1000);
  if (active && course.sourceCoverage.status === 'partial') throw new CreditexComplianceError('CURRICULUM_SOURCES_INCOMPLETE', `The exact activity source requirements must be completed before activation: ${course.sourceCoverage.gaps.join('; ')}`, 409);
  const today = new Date().toISOString().slice(0, 10);
  if (!note || (active && (!isValidDate(reviewedOn) || reviewedOn > today || !isValidDate(expiresOn) || expiresOn < today || expiresOn < reviewedOn))) throw new CreditexComplianceError('MODULE_REVIEW_REQUIRED', 'Provide a source review date, current review expiry date and decision evidence.', 400);
  if (active && !validAssessment(course)) throw new CreditexComplianceError('CURRICULUM_INVALID', 'The course must have 1 to 60 valid questions, a key compliance question and a 100% pass threshold.', 409);
  if (active && course.id === 'veu-48' && !authority) throw new CreditexComplianceError('ACTIVITY48_AUTHORITY_REQUIRED', 'Record verified Creditex Activity 48 accreditation and the approved direct consumer contract model before activation.', 400);
  await db.batch([creditexWriteGuard(db, reviewerUid, "COALESCE((SELECT updated_at FROM trade_training_module_reviews WHERE module_id=?),'')=?", [course.id, expectedReviewUpdatedAt]), db.prepare(`INSERT INTO trade_training_module_reviews(module_id,version,content_hash,status,source_reviewed_on,review_expires_on,scheme_authority_reference,reviewed_by_uid,review_note,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(module_id) DO UPDATE SET version=excluded.version,content_hash=excluded.content_hash,status=excluded.status,source_reviewed_on=excluded.source_reviewed_on,review_expires_on=excluded.review_expires_on,scheme_authority_reference=excluded.scheme_authority_reference,reviewed_by_uid=excluded.reviewed_by_uid,review_note=excluded.review_note,updated_at=excluded.updated_at`).bind(course.id, course.version, hash, active ? 'active' : 'withdrawn', reviewedOn, expiresOn, authority, reviewerUid, note, new Date().toISOString()), trainingAuditStatement(db, reviewerUid, active ? 'module_activated' : 'module_withdrawn', { moduleId: course.id, metadata: { version: course.version, contentHash: hash, reviewNote: note, schemeAuthorityReference: authority } })]);
}
export async function listTrainingGovernanceModules(db: D1Database) {
  const reviews = await db.prepare('SELECT * FROM trade_training_module_reviews').all<Review>();
  const courses = await listCurrentTrainingModules(db); const retired = await listRetiredTrainingModuleIds(db);
  if (retired.has('veu-48')) courses.push(await loadTrainingModule(db, 'veu-48', { forSchemeAuthority: true }));
  return Promise.all(courses.map(async course => { const { review, availability, hash } = await moduleReview(db, course, reviews.results); return { ...course, retired: retired.has(course.id), contentHash: hash, availability: retired.has(course.id) ? 'retired' : availability, reviewUpdatedAt: review?.updated_at || '', reviewExpiresOn: review?.review_expires_on || '', sourceReviewedOn: review?.source_reviewed_on || '', schemeAuthorityReference: review?.scheme_authority_reference || '' }; }));
}
export async function revokeTrainingCompletion(db: D1Database, reviewerUid: string, completionId: string, reviewNote: string) {
  if (!reviewNote) throw new CreditexComplianceError('REVIEW_NOTE_REQUIRED', 'Record the reason for revocation.', 400);
  const row = await db.prepare('SELECT * FROM trade_training_completions WHERE id=?').bind(completionId).first<Completion>();
  if (!row) throw new CreditexComplianceError('COMPLETION_NOT_FOUND', 'Training completion not found.', 404);
  await db.batch([db.prepare("UPDATE trade_training_completions SET revoked_at=?,revocation_note=? WHERE owner_uid=? AND member_id=? AND module_id=? AND revoked_at=''").bind(new Date().toISOString(), reviewNote, row.owner_uid, row.member_id, row.module_id), trainingAuditStatement(db, reviewerUid, 'completion_revoked', { ownerUid: row.owner_uid, memberId: row.member_id, moduleId: row.module_id, metadata: { completionId, reviewNote } })]);
}
