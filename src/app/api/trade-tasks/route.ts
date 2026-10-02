import { adminJson, mfaErrorResponse, sameOrigin } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { BusinessTaskError } from '@/lib/trade-business-tasks';
import { listBusinessTasks, saveBusinessTask, taskPeople } from '@/lib/trade-business-tasks-server';
import { TradeBusinessContextError } from '@/lib/trade-business-context-server';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof BusinessTaskError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
  if (error instanceof SyntaxError) return adminJson({ ok: false, error: 'Check the task details.' }, 400);
  if (error instanceof Error && /^(AUTH_REQUIRED|EMAIL_VERIFICATION_REQUIRED|TEAM_ACCESS_RECORD_REQUIRED|ABN_REVIEW_REQUIRED)$/.test(error.message)) return adminJson({ ok: false, error: 'Task access could not be verified.' }, error.message === 'AUTH_REQUIRED' ? 401 : 403);
  return adminJson({ ok: false, error: 'The task request could not be completed.' }, 500);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const params = new URL(request.url).searchParams;
    const result = params.get('mode') === 'people' ? await taskPeople(access, params.get('q') || '')
      : await listBusinessTasks(access, { view: params.get('view') || undefined, status: params.get('status') || undefined, page: params.get('page') || undefined });
    return adminJson({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BusinessTaskError(400, 'Check the task details.');
    return adminJson({ ok: true, task: await saveBusinessTask(access, body as Record<string, unknown>) });
  } catch (error) { return failure(error); }
}
