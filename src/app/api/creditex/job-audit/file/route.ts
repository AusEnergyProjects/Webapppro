import { getD1 } from '../../../../../../db';
import { readCreditexJobAuditFile } from '@/lib/creditex-job-audit-server';
import { jobAuditError, requireJobAuditActor } from '@/lib/creditex-job-audit-route-server';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = getD1(), actor = await requireJobAuditActor(request, db), query = new URL(request.url).searchParams;
    const result = await readCreditexJobAuditFile(db, actor, { intentId: query.get('intentId') || '', kind: query.get('kind') || '', id: query.get('id') || '', parentId: query.get('parentId') || '' });
    return new Response(new Blob([new Uint8Array(result.bytes)], { type: result.contentType }), { headers: {
      'Content-Type': result.contentType, 'Content-Length': String(result.bytes.length),
      'Content-Disposition': `inline; filename="${result.fileName.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150)}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
    } });
  } catch (error) { return jobAuditError(error); }
}
