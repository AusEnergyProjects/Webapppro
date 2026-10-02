import { getD1 } from '../../../../../db';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { loadCreditexAuditDashboard, loadCreditexJobAudit, saveCreditexJobAudit } from '@/lib/creditex-job-audit-server';
import { jobAuditError, jobAuditJson, requireJobAuditActor } from '@/lib/creditex-job-audit-route-server';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = getD1(), actor = await requireJobAuditActor(request, db);
    if (new URL(request.url).searchParams.get('view') === 'dashboard') return jobAuditJson({ ok: true, dashboard: await loadCreditexAuditDashboard(db, actor) });
    return jobAuditJson({ ok: true, workspace: await loadCreditexJobAudit(db, actor, new URL(request.url).searchParams.get('intentId') || '') });
  } catch (error) { return jobAuditError(error); }
}
export async function POST(request: Request) {
  try {
    const db = getD1(), actor = await requireJobAuditActor(request, db, 'audit');
    return jobAuditJson({ ok: true, workspace: await saveCreditexJobAudit(db, actor, await readBoundedJsonRequest(request, 32 * 1024)) });
  } catch (error) { return jobAuditError(error); }
}
