import { adminJson, sameOrigin } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { beginTradeEmailConnection, disconnectTradeEmail, isTradeEmailProvider, testTradeEmail, tradeEmailSettings } from '@/lib/trade-email-server';
import { tradeEmailApiError, tradeEmailRequestBody, tradeEmailRequestId } from '@/lib/trade-email-api';

export const runtime = 'edge';
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    return adminJson({ ok: true, canManage: access.isOwner, ...(await tradeEmailSettings(access.ownerUid)) });
  } catch (error) { return tradeEmailApiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner) throw new Error('EMAIL_OWNER_REQUIRED');
    const body = await tradeEmailRequestBody(request);
    if (body.action === 'connect' && isTradeEmailProvider(body.provider)) {
      const result = await beginTradeEmailConnection(access.ownerUid, body.provider, new URL(request.url).origin);
      const response = adminJson({ ok: true, authorizationUrl: result.authorizationUrl });
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      response.headers.set('Set-Cookie', `tlink_email_oauth=${result.browser}; HttpOnly; SameSite=Lax; Path=/api/trade-email/callback; Max-Age=600${secure}`);
      return response;
    }
    if (body.action === 'test') {
      const result = await testTradeEmail(access.ownerUid, access.actorUid, tradeEmailRequestId(body.requestId));
      return adminJson({ ok: true, status: 'accepted', submissionId: result.providerMessageId });
    }
    throw new Error('EMAIL_INPUT_INVALID');
  } catch (error) { return tradeEmailApiError(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner) throw new Error('EMAIL_OWNER_REQUIRED');
    await disconnectTradeEmail(access.ownerUid);
    return adminJson({ ok: true });
  } catch (error) { return tradeEmailApiError(error); }
}
