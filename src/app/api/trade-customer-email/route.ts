import { adminJson, sameOrigin } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { tradeEmailApiError, tradeEmailRequestBody, tradeEmailRequestId } from '@/lib/trade-email-api';
import { resolveTradeEmailRecipient, tradeEmailTarget } from '@/lib/trade-email-recipient-server';
import { sendTradeCustomerEmail } from '@/lib/trade-email-server';

export const runtime = 'edge';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const input = await tradeEmailRequestBody(request);
    const target = tradeEmailTarget(input);
    const requestId = tradeEmailRequestId(input.requestId);
    if (typeof input.subject !== 'string' || typeof input.body !== 'string') throw new Error('EMAIL_INPUT_INVALID');
    const subject = input.subject.trim(); const body = input.body.trim();
    if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject) || !body || body.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new Error('EMAIL_INPUT_INVALID');
    const recipient = await resolveTradeEmailRecipient(access, target);
    const result = await sendTradeCustomerEmail(access.ownerUid, access.actorUid, { channel: 'email', recipient, subject, body,
      idempotencyKey: `customer-email:${requestId}`, callbackUrl: '', messageType: 'trade_customer_email' }, { requireConnection: true,
      beforeSend: async () => { if (await resolveTradeEmailRecipient(access, target) !== recipient) throw new Error('EMAIL_RECIPIENT_UNAVAILABLE'); } });
    return adminJson({ ok: true, status: 'accepted', submissionId: result.providerMessageId });
  } catch (error) { return tradeEmailApiError(error); }
}
