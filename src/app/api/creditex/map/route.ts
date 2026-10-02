import { getD1 } from '../../../../../db';
import { requireJobAuditActor, jobAuditJson, jobAuditError } from '@/lib/creditex-job-audit-route-server';
import { creditexMapDataset } from '@/lib/creditex-customer-directory-server';
import { loadTradeMapDataset, TradeMapInputError } from '@/lib/trade-map-dataset-server';
import { tlinkMapConfiguration } from '@/lib/trade-map-configuration';
import { gnafDirectoryStatus, getGnafDirectory } from '@/lib/gnaf-directory-server';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const db = getD1(), url = new URL(request.url);
    const actor = await requireJobAuditActor(request, db, url.searchParams.get('resource') === 'jobs' ? 'jobs' : 'customers');
    if (url.searchParams.get('mode') === 'config') return jobAuditJson({ ok: true, ...tlinkMapConfiguration(process.env), gnaf: await gnafDirectoryStatus() });
    return jobAuditJson({ ok: true, ...await loadTradeMapDataset(db, actor.uid, creditexMapDataset(actor, url.searchParams), url) });
  } catch (error) {
    if (error instanceof TradeMapInputError) return jobAuditJson({ ok: false, error: error.message }, 400);
    return jobAuditError(error);
  }
}
export async function POST(request: Request) {
  try {
    const db = getD1(), url = new URL(request.url);
    await requireJobAuditActor(request, db, url.searchParams.get('resource') === 'jobs' ? 'jobs' : 'customers');
    const body: unknown = await readBoundedJsonRequest(request, 8192);
    if (!body || typeof body !== 'object' || !('address' in body) || typeof body.address !== 'string' || body.address.length > 1000) return jobAuditJson({ ok: false, error: 'Enter a full street address.' }, 400);
    const directory = await getGnafDirectory();
    const [result] = await directory.resolve([body.address]);
    return jobAuditJson({ ok: true, result: result.status === 'located' ? { status: result.status, position: result.position, approximate: result.approximate } : result });
  } catch (error) { return jobAuditError(error); }
}
