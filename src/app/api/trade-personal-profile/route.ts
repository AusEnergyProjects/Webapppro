import { adminJson, mfaErrorResponse, sameOrigin } from '@/lib/admin-server';
import { TradeAccessError } from '@/lib/trade-access-server';
import { TradeBusinessContextError } from '@/lib/trade-business-context-server';
import { requireTeamCommunicationIdentity } from '@/lib/trade-communications-access';
import { readBoundedRequestText, RequestBodyTooLargeError } from '@/lib/bounded-request-body.mjs';
import { readTradePersonalProfile, updateTradePersonalProfile } from '@/lib/trade-personal-profile-server';

export const runtime = 'edge';

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, error: error.publicMessage }, error.status);
  const code = error instanceof Error ? error.message : '';
  if (code === 'AUTH_REQUIRED') return adminJson({ ok: false, error: 'Sign in to view your name.' }, 401);
  if (error instanceof TradeAccessError || ['PERSONAL_PROFILE_ACCESS_REQUIRED', 'TEAM_ACCESS_REQUIRED', 'TEAM_ACCESS_RECORD_REQUIRED', 'ABN_REVIEW_REQUIRED', 'ACCOUNT_INACTIVE', 'EMAIL_VERIFICATION_REQUIRED', 'FIELD_SESSION_REQUIRED', 'FIELD_SESSION_EXPIRED', 'FIELD_SESSION_REVOKED'].includes(code)) {
    return adminJson({ ok: false, error: 'You no longer have access to this team.' }, 403);
  }
  if (error instanceof RequestBodyTooLargeError) return adminJson({ ok: false, error: 'Use a name of up to 120 characters.' }, 413);
  if (error instanceof SyntaxError || ['PERSONAL_NAME_INVALID', 'PERSONAL_NAME_REQUIRED'].includes(code)) {
    return adminJson({ ok: false, error: code === 'PERSONAL_NAME_REQUIRED' ? 'Enter your name.' : 'Use a name of up to 120 characters on one line.' }, 400);
  }
  return adminJson({ ok: false, error: 'Your name could not be saved. Try again.' }, 503);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    return adminJson({ ok: true, ...await readTradePersonalProfile(await requireTeamCommunicationIdentity(request)) });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const actor = await requireTeamCommunicationIdentity(request);
    const body: unknown = JSON.parse(await readBoundedRequestText(request, 1024));
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('name' in body)) throw new Error('PERSONAL_NAME_INVALID');
    return adminJson({ ok: true, ...await updateTradePersonalProfile(actor, body.name) });
  } catch (error) { return failure(error); }
}
