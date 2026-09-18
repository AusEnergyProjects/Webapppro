import { getD1 } from '../../db';
import { requireFirebaseIdentity } from './firebase-server';
import { requireInstallerTeamAccess } from './trade-team-server';
import { requireComplianceAccess, ComplianceAccessError } from './compliance-access-server';
import { CreditexComplianceError, creditexMutationConflict } from './creditex-onboarding-server';
import { BoundedJsonRequestError } from './bounded-json-request';
import { TeamMemberFileError } from './trade-team-member-files-server';
import { isFieldSessionRequest } from './trade-field-session-server';
import { TradeAccessError } from './trade-access-server';

export function creditexJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function creditexApiError(error: unknown) {
  const conflict = creditexMutationConflict(error);
  if (conflict) return creditexJson({ ok: false, code: conflict.code, error: conflict.message }, conflict.status);
  if (error instanceof CreditexComplianceError || error instanceof ComplianceAccessError || error instanceof BoundedJsonRequestError || error instanceof TeamMemberFileError || error instanceof TradeAccessError) return creditexJson({ ok: false, code: error.code, error: error.message }, error.status);
  const message = error instanceof Error ? error.message : '';
  if (message === 'AUTH_REQUIRED') return creditexJson({ ok: false, code: 'AUTH_REQUIRED', error: 'Sign in to continue.' }, 401);
  if (message.includes('trade_crm_write_guard') || message.includes('UNIQUE constraint failed')) return creditexJson({ ok: false, code: 'REVISION_CONFLICT', error: 'The compliance record changed. Refresh and try again.' }, 409);
  if (['EMAIL_VERIFICATION_REQUIRED','ABN_REVIEW_REQUIRED','TEAM_ACCESS_RECORD_REQUIRED','FIELD_SESSION_REQUIRED','FIELD_SESSION_EXPIRED'].includes(message)) return creditexJson({ ok: false, code: message, error: 'Your verified business or team access is required.' }, 403);
  const requestId = crypto.randomUUID();
  console.error('Creditex onboarding/training request failed', { requestId, type: error instanceof Error ? error.name : 'unknown' });
  return creditexJson({ ok: false, code: 'CREDITEX_COMPLIANCE_UNAVAILABLE', error: 'Compliance records are temporarily unavailable. Certificate work remains blocked until they can be verified.', requestId }, 503);
}
export async function requireCreditexTrainingReviewer(request: Request) {
  const access = await requireComplianceAccess(request, { allowedRoles: ['admin', 'reviewer'], claimPendingInvitation: false });
  if (access.organisationCode !== 'CREDITEX-AU' || !access.governanceIdentityVerified) throw new CreditexComplianceError('CREDITEX_REVIEWER_REQUIRED', 'A verified authorised Creditex governance reviewer is required.');
  return access;
}
export async function requireCreditexOnboardingAccess(request: Request) {
  if (!isFieldSessionRequest(request)) {
    try {
      const identity = await requireFirebaseIdentity(request);
      if (!identity.emailVerified) throw new CreditexComplianceError('EMAIL_VERIFICATION_REQUIRED', 'Verify your email before providing onboarding identity information.');
      const owner = await getD1().prepare("SELECT business_name FROM trade_accounts WHERE firebase_uid=? AND partner_type='installer'").bind(identity.uid).first<{ business_name: string }>();
      if (owner) return { ownerUid: identity.uid, actorUid: identity.uid, isOwner: true, displayName: owner.business_name, memberId: '' };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'AUTH_REQUIRED') throw error;
    }
  }
  const access = await requireInstallerTeamAccess(request);
  return { ownerUid: access.ownerUid, actorUid: access.actorUid, isOwner: access.isOwner, displayName: access.displayName, memberId: access.memberId };
}
