import { getD1 } from '../../../../db';
import { sameOrigin, mfaErrorResponse } from '@/lib/admin-server';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { FormComplianceError, cleanComplianceContext, cleanComplianceQueueQuery, cleanComplianceReviewInput, cleanComplianceTemplateInput,
  complianceFormKey, complianceKeys, complianceObject, type FormComplianceScope } from '@/lib/form-compliance';
import type { FormComplianceActor } from '@/lib/form-compliance-server';

export const runtime = 'edge';
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function query(request: Request): { scope: FormComplianceScope; params: URLSearchParams } {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new FormComplianceError('COMPLIANCE_INPUT', 'Send each query field once.');
  const scope = params.get('scope');
  if (scope !== 'business' && scope !== 'creditex') throw new FormComplianceError('COMPLIANCE_INPUT', 'Choose a valid compliance workspace.');
  const actorMode = params.get('actorMode');
  if (actorMode && (scope !== 'creditex' || !['admin', 'compliance'].includes(actorMode))) throw new FormComplianceError('COMPLIANCE_INPUT', 'Choose a valid compliance actor.');
  return { scope, params };
}
async function actor(request: Request, scope: FormComplianceScope, template: boolean): Promise<FormComplianceActor> {
  if (scope === 'business') {
    const { requireInstallerTeamAccess } = await import('@/lib/trade-team-server');
    return { scope, access: await requireInstallerTeamAccess(request) };
  }
  const { requireJobAuditActor } = await import('@/lib/creditex-job-audit-route-server');
  return { scope, access: await requireJobAuditActor(request, getD1(), template ? 'forms' : 'jobs') };
}
function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof FormComplianceError || error instanceof BoundedJsonRequestError) return json({ ok: false, code: error.code, error: error.message }, error.status);
  // Existing access services retain their precise 4xx outcomes without exposing provider details.
  if (error && typeof error === 'object' && 'status' in error && 'code' in error && 'message' in error
    && typeof error.status === 'number' && error.status >= 400 && error.status < 500 && typeof error.code === 'string' && typeof error.message === 'string') {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : '';
  if (message === 'AUTH_REQUIRED') return json({ ok: false, code: 'AUTH_REQUIRED', error: 'Sign in to continue.' }, 401);
  if (/^(JOB_NOT_FOUND|JOB_FORM_NOT_FOUND)$/.test(message)) return json({ ok: false, code: 'COMPLIANCE_FORM_NOT_FOUND', error: 'This form is unavailable.' }, 404);
  if (/^(TEAM_ACCESS_REQUIRED|TEAM_ACCESS_RECORD_REQUIRED|ABN_REVIEW_REQUIRED|EMAIL_VERIFICATION_REQUIRED|FIELD_ACCESS_REQUIRED|FULL_ACCESS_REQUIRED|FIELD_EVIDENCE_VIEW_REQUIRED|JOB_NOT_ASSIGNED|ADMIN_SUSPENDED|ROLE_REQUIRED|ADMIN_REQUIRED)$/.test(message)) {
    return json({ ok: false, code: 'COMPLIANCE_ACCESS', error: 'Active authorised workspace access is required.' }, 403);
  }
  return json({ ok: false, code: 'COMPLIANCE_UNAVAILABLE', error: 'The compliance record could not be loaded or saved. No change was confirmed. Refresh and try again.' }, 503);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: 'ORIGIN_REJECTED', error: 'Request origin was not accepted.' }, 403);
  try {
    const { scope, params } = query(request), raw = Object.fromEntries(params);
    let mode: 'template' | 'queue' | 'review';
    if (params.has('formKey')) { complianceKeys(raw, ['scope', 'actorMode', 'formKey']); complianceFormKey(params.get('formKey'), scope); mode = 'template'; }
    else if (params.has('view')) {
      complianceKeys(raw, ['scope', 'view', 'q', 'cursor']);
      if (scope !== 'business' || params.get('view') !== 'queue') throw new FormComplianceError('COMPLIANCE_INPUT', 'Choose a valid compliance queue.');
      cleanComplianceQueueQuery(params.get('q') || '', params.get('cursor') || '');
      mode = 'queue';
    } else { complianceKeys(raw, scope === 'business' ? ['scope', 'workOrderId', 'formId'] : ['scope', 'actorMode', 'intentId', 'recordId', 'recordKind']); cleanComplianceContext(raw); mode = 'review'; }
    const access = await actor(request, scope, mode === 'template');
    const service = await import('@/lib/form-compliance-server');
    if (mode === 'template') return json({ ok: true, ...await service.loadFormComplianceTemplate(getD1(), access, String(params.get('formKey'))) });
    if (mode === 'queue') return json({ ok: true, ...await service.loadFormComplianceQueue(getD1(), access, cleanComplianceQueueQuery(params.get('q') || '', params.get('cursor') || '')) });
    return json({ ok: true, workspace: await service.loadFormComplianceWorkspace(getD1(), access, cleanComplianceContext(raw)) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: 'ORIGIN_REJECTED', error: 'Request origin was not accepted.' }, 403);
  try {
    const { scope, params } = query(request), raw = complianceObject(await readBoundedJsonRequest(request, 150_000));
    complianceKeys(Object.fromEntries(params), ['scope', 'actorMode', ...(raw.action === 'save_template' ? ['formKey'] : scope === 'business' ? ['workOrderId', 'formId'] : ['intentId', 'recordId', 'recordKind'])]);
    if (raw.scope !== undefined && raw.scope !== scope) throw new FormComplianceError('COMPLIANCE_INPUT', 'The request belongs to a different workspace.');
    // Context may be repeated in the query for the editor URL, but must match the body exactly.
    for (const key of ['formKey', 'workOrderId', 'formId', 'intentId', 'recordId', 'recordKind']) if (params.has(key) && params.get(key) !== raw[key]) {
      throw new FormComplianceError('COMPLIANCE_INPUT', 'The form selection changed. Reload before saving.');
    }
    const value = { ...raw, scope }, input = raw.action === 'save_template' ? cleanComplianceTemplateInput(value) : cleanComplianceReviewInput(value);
    const access = await actor(request, scope, input.action === 'save_template');
    const service = await import('@/lib/form-compliance-server');
    if (input.action === 'save_template') return json({ ok: true, ...await service.saveFormComplianceTemplate(getD1(), access, input) });
    return json({ ok: true, workspace: await service.saveFormComplianceReview(getD1(), access, input) });
  } catch (error) { return errorResponse(error); }
}
