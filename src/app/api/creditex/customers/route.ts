import { getD1 } from '../../../../../db';
import { requireJobAuditActor, jobAuditJson, jobAuditError } from '@/lib/creditex-job-audit-route-server';
import { loadCreditexCustomer, loadCreditexCustomers } from '@/lib/creditex-customer-directory-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = getD1(), actor = await requireJobAuditActor(request, db, 'customers');
    const params = new URL(request.url).searchParams, id = params.get('id');
    return jobAuditJson({ ok: true, ...(id ? await loadCreditexCustomer(db, actor, id, params) : await loadCreditexCustomers(db, actor, params)) });
  } catch (error) { return jobAuditError(error); }
}
