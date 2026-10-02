import { adminError, adminJson, sameOrigin } from '@/lib/admin-server';
import { ComplianceAccessError, requireComplianceAccess } from '@/lib/compliance-access-server';
import { creditexAppAccess } from '@/lib/creditex-app-access-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try { return adminJson({ ok: true, ...creditexAppAccess(await requireComplianceAccess(request)) }); }
  catch (error) {
    if (error instanceof ComplianceAccessError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
    return adminError(error);
  }
}
