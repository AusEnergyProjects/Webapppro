import { getD1 } from '../../../../db';
import { sameOrigin } from '@/lib/admin-server';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { creditexApiError, creditexJson } from '@/lib/creditex-onboarding-api';
import { CreditexComplianceError, getCreditexBusinessStatus, record, textField } from '@/lib/creditex-onboarding-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { getMemberTrainingScope, getTrainingModulesForMember, getTrainingProjectionData, startTrainingAttempt, submitTrainingAttempt } from '@/lib/trade-training-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const access = await requireInstallerTeamAccess(request); const db = getD1();
    const memberId = textField(new URL(request.url).searchParams.get('memberId'), 80) || access.memberId;
    if (memberId !== access.memberId && !access.isOwner && !access.canManageTeam) throw new CreditexComplianceError('TRAINING_MEMBER_ACCESS_DENIED', 'Only a business owner or team manager can view another member’s training.', 403);
    const scope = await getMemberTrainingScope(db, access.ownerUid, memberId);
    if (!scope) throw new CreditexComplianceError('TRAINING_MEMBER_NOT_FOUND', 'An active team member was not found.', 404);
    const [business, data] = await Promise.all([getCreditexBusinessStatus(db, access.ownerUid), getTrainingProjectionData(db, access.ownerUid)]);
    const declared = scope.activities;
    const modules = (await getTrainingModulesForMember(db, access.ownerUid, memberId, data, scope)).filter(module => module.activityTemplateIds.some(id => declared.some(activity => activity.templateId === id)));
    const unavailableActivities = declared.filter(activity => !modules.some(module => module.activityTemplateIds.includes(activity.templateId))).map(activity => ({ id: activity.templateId, title: activity.title, programCode: activity.programCode, serviceCategory: activity.serviceCategory, businessServiceEnabled: activity.businessServiceEnabled, status: 'unavailable', message: 'No reviewed activity-specific curriculum is available. Certificate jobs for this activity remain blocked.' }));
    const team = [];
    if (access.isOwner || access.canManageTeam) {
      const members = await db.prepare("SELECT id,display_name FROM trade_team_members WHERE owner_uid=? AND status='active' ORDER BY display_name LIMIT 100").bind(access.ownerUid).all<{ id: string; display_name: string }>();
      for (const member of members.results) {
        const memberScope = member.id === memberId ? scope : await getMemberTrainingScope(db, access.ownerUid, member.id);
        if (!memberScope) continue;
        team.push({ memberId: member.id, displayName: member.display_name, modules: (await getTrainingModulesForMember(db, access.ownerUid, member.id, data, memberScope)).filter(module => module.activityTemplateIds.some(id => memberScope.activities.some(activity => activity.templateId === id))).map(module => ({ id: module.id, title: module.title, serviceCategory: module.serviceCategory, businessServiceEnabled: module.businessServiceEnabled, status: module.status, reference: module.completion?.reference || '', expiresAt: module.completion?.expiresAt || '' })) });
      }
    }
    return creditexJson({ ok: true, business, memberId, actor: { isOwner: access.isOwner, displayName: access.displayName, memberId: access.memberId }, selectedMember: { memberId, displayName: scope.displayName, isOwner: scope.isOwner, isSelf: memberId === access.memberId }, canTakeTraining: memberId === access.memberId, modules, unavailableActivities, team });
  } catch (error) { return creditexApiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return creditexJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const db = getD1(); const body = record(await readBoundedJsonRequest(request));
    const targets = [new URL(request.url).searchParams.get('memberId'), body.memberId].filter(value => value !== undefined && value !== null && value !== '');
    if (targets.some(value => value !== access.memberId)) throw new CreditexComplianceError('TRAINING_SELF_ONLY', 'Each person must complete their own training while signed in as themselves.', 403);
    const actor = { ownerUid: access.ownerUid, memberId: access.memberId, actorUid: access.actorUid };
    if (body.action === 'start') return creditexJson({ ok: true, attempt: await startTrainingAttempt(db, { ...actor, moduleId: textField(body.moduleId, 80) }) });
    if (body.action === 'submit') return creditexJson({ ok: true, result: await submitTrainingAttempt(db, { ...actor, attemptId: textField(body.attemptId, 80), answers: body.answers }) });
    throw new CreditexComplianceError('ACTION_INVALID', 'Choose a supported training action.', 400);
  } catch (error) { return creditexApiError(error); }
}
