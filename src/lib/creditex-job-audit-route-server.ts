import { adminError, mfaErrorResponse, requireAdminIdentity, sameOrigin } from './admin-server';
import { ComplianceAccessError, requireComplianceAccess } from './compliance-access-server';
import { resolveActiveCreditexOfficialSourceOrganisation } from './creditex-official-source-custody-server';
import { CREDITEX_PARTNER_ORGANISATION_CODE } from './trade-compliance-intent';
import { BoundedJsonRequestError } from './bounded-json-request';
import { JobLifecycleError } from './creditex-job-lifecycle-server';
import { CreditexJobAuditError, type CreditexJobAuditActor } from './creditex-job-audit-server';
export function jobAuditJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function jobAuditError(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof CreditexJobAuditError || error instanceof ComplianceAccessError || error instanceof JobLifecycleError || error instanceof BoundedJsonRequestError) return jobAuditJson({ ok: false, code: error.code, error: error.message }, error.status);
  if (error instanceof Error && /^(AUTH_REQUIRED|EMAIL_VERIFICATION_REQUIRED|ADMIN_SUSPENDED|ROLE_REQUIRED|ADMIN_REQUIRED)$/.test(error.message)) return adminError(error);
  return jobAuditJson({ ok: false, code: 'AUDIT_UNAVAILABLE', error: 'The private job audit could not be loaded or saved. No changes were confirmed. Refresh and try again.' }, 503);
}
export async function requireJobAuditActor(request: Request, db: D1Database): Promise<CreditexJobAuditActor> {
  if (!sameOrigin(request)) throw new CreditexJobAuditError('ORIGIN_REJECTED', 'Request origin was not accepted.', 403);
  const mode = new URL(request.url).searchParams.get('actorMode') || 'compliance';
  if (mode === 'admin') {
    const admin = await requireAdminIdentity(request, ['owner', 'admin', 'reviewer']);
    return { kind: 'admin', uid: admin.uid, memberId: admin.adminId, name: admin.displayName, role: admin.role, organisationId: await resolveActiveCreditexOfficialSourceOrganisation(db) };
  }
  if (mode !== 'compliance') throw new CreditexJobAuditError('AUDIT_ACTOR_MODE', 'Choose a valid audit workspace.', 400);
  const member = await requireComplianceAccess(request, { allowedRoles: ['admin','case_manager','reviewer','auditor'] }, db);
  if (member.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) throw new CreditexJobAuditError('CREDITEX_ACCESS_REQUIRED', 'Creditex access is required.', 403);
  return { kind: 'compliance', uid: member.uid, memberId: member.membershipId, name: member.displayName, role: member.role, organisationId: member.organisationId };
}
