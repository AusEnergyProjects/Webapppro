import { getD1 } from '../../../../../../db';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { prepareCreditexAuditAiReview } from '@/lib/creditex-job-audit-ai-server';
import { jobAuditError, jobAuditJson, requireJobAuditActor } from '@/lib/creditex-job-audit-route-server';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const db = getD1(), actor = await requireJobAuditActor(request, db, 'audit');
    return jobAuditJson({ ok: true, review: await prepareCreditexAuditAiReview(db, actor, await readBoundedJsonRequest(request, 8 * 1024)) });
  } catch (error) {
    if (error instanceof Error && /^WORKFLOW_AI_(UNAVAILABLE|LIMIT|INPUT_LIMIT|INCOMPLETE)$/.test(error.message))
      return jobAuditJson({ ok: false, code: error.message, error: 'AI assistance is unavailable for this request. Continue with the manual audit; no audit changes were made.' }, error.message === 'WORKFLOW_AI_LIMIT' ? 429 : 503);
    return jobAuditError(error);
  }
}
