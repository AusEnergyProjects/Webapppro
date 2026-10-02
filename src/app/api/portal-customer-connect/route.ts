import { getD1 } from "../../../../db";
import { requireJobAuditActor, jobAuditJson, jobAuditError } from "@/lib/creditex-job-audit-route-server";
import { loadPortalConnectCustomers } from "@/lib/portal-customer-connect-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getD1();
    const actor = await requireJobAuditActor(request, db, 'customers');
    return jobAuditJson({ ok: true, ...await loadPortalConnectCustomers(db, actor, new URL(request.url).searchParams) });
  } catch (error) { return jobAuditError(error); }
}
