import { getD1 } from '../../../../../db';
import { adminJson, mfaErrorResponse, sameOrigin } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { TradeBusinessContextError } from '@/lib/trade-business-context-server';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { createBusinessFormAiDraft, parseBusinessFormAiInput } from '@/lib/trade-business-form-ai-server';

export const runtime = 'edge';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const input = parseBusinessFormAiInput(await readBoundedJsonRequest(request, 12_000));
    const draft = await createBusinessFormAiDraft(getD1(), access, input);
    const current = await requireInstallerTeamAccess(request);
    if (current.ownerUid !== access.ownerUid || current.actorUid !== access.actorUid || current.memberId !== access.memberId
      || (!current.isOwner && !current.canManageForms)) throw new Error('FORM_AUTHOR_REQUIRED');
    return adminJson({ ok: true, ...draft });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
    if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
    const code = error instanceof Error ? error.message : '';
    if (code === 'AUTH_REQUIRED') return adminJson({ ok: false, error: 'Sign in to continue.' }, 401);
    if (code === 'FORM_AI_INPUT') return adminJson({ ok: false, error: 'Describe the form purpose in up to 2,000 characters and choose a work category.' }, 400);
    if (code === 'WORKFLOW_AI_LIMIT') return adminJson({ ok: false, error: 'Wattzun has reached its usage limit. Create the form manually or try again later.' }, 429);
    if (code === 'WORKFLOW_AI_SOURCE_CHANGED') return adminJson({ ok: false, error: 'Your authoring access changed. Reopen Forms before drafting again.' }, 409);
    if (['FORM_AUTHOR_REQUIRED', 'TEAM_ACCESS_REQUIRED', 'TEAM_ACCESS_RECORD_REQUIRED', 'ABN_REVIEW_REQUIRED', 'EMAIL_VERIFICATION_REQUIRED', 'FIELD_ACCESS_REQUIRED', 'FULL_ACCESS_REQUIRED'].includes(code)) return adminJson({ ok: false, error: 'Active Create and edit business forms access is required.' }, 403);
    return adminJson({ ok: false, error: 'Wattzun could not prepare a complete draft. Your forms are unchanged. Create the form manually or try again later.' }, 503);
  }
}
