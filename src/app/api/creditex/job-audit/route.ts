import { getD1 } from '../../../../../db';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { loadCreditexAuditDashboard, loadCreditexJobAudit, saveCreditexJobAudit, resolveCreditexJobAuditFinding } from '@/lib/creditex-job-audit-server';
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
    const input = await readBoundedJsonRequest(request, 32 * 1024);
    const resolve = input && typeof input === 'object' && 'action' in input && input.action === 'resolve_finding';
    return jobAuditJson({ ok: true, workspace: await (resolve ? resolveCreditexJobAuditFinding : saveCreditexJobAudit)(db, actor, input) });
  } catch (error) { return jobAuditError(error); }
}
