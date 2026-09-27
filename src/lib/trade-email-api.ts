import { adminJson, mfaErrorResponse } from './admin-server';
import { TradeAccessError } from './trade-access-server';
import { BoundedJsonRequestError, readBoundedJsonRequest } from './bounded-json-request';
import { ReminderProviderDeliveryError } from './service-reminder-delivery';

export async function tradeEmailRequestBody(request: Request) {
  const body = await readBoundedJsonRequest(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('EMAIL_INPUT_INVALID');
  return body as Record<string, unknown>;
}
export function tradeEmailRequestId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) throw new Error('EMAIL_INPUT_INVALID');
  return value;
}
export function tradeEmailApiError(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof ReminderProviderDeliveryError) return adminJson({ ok: false,
    status: error.outcome === 'indeterminate' ? 'uncertain' : 'failed',
    error: error.outcome === 'indeterminate'
      ? 'Sending could not be confirmed. Check the business mailbox before sending another copy.'
      : 'The email provider did not accept this message. Check the connection in Business settings and try again.' }, error.outcome === 'indeterminate' ? 409 : 502);
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, [number, string]> = {
    AUTH_REQUIRED: [401, 'Sign in to continue.'], EMAIL_OWNER_REQUIRED: [403, 'Only the business owner can manage the email connection.'],
    EMAIL_ACCESS_REQUIRED: [403, 'You do not have permission to email this customer.'],
    EMAIL_RECIPIENT_UNAVAILABLE: [404, 'This customer email is no longer available. Refresh the customer or lead.'],
    EMAIL_INPUT_INVALID: [400, 'Enter a valid subject and message.'], EMAIL_REQUEST_CONFLICT: [409, 'This send request has changed. Start a new message.'],
    EMAIL_SETUP_UNAVAILABLE: [503, 'This email connection is not available yet.'],
    EMAIL_CONNECTION_REQUIRED: [409, 'Ask the business owner to connect an email account in Business settings.'],
    EMAIL_RECONNECT_REQUIRED: [409, 'Reconnect the business email in Business settings before sending.'],
    EMAIL_RETRY_LATER: [429, 'Please wait a minute before trying this message again.'],
    EMAIL_REFRESH_BUSY: [409, 'The email connection is refreshing. Try again shortly.'],
    EMAIL_PREFLIGHT_FAILED: [503, 'The email connection could not be refreshed. Nothing was sent. Try again shortly.'],
    EMAIL_CONNECTION_CHANGED: [409, 'The sending account has changed. Review the previous message before starting a new send.'],
    TEAM_ACCESS_RECORD_REQUIRED: [403, 'Your team access is not active.'], EMAIL_VERIFICATION_REQUIRED: [403, 'Verify your account email first.'],
    ABN_REVIEW_REQUIRED: [403, 'Complete business verification before sending customer emails.'],
  };
  const match = messages[code];
  return adminJson({ ok: false, ...(match ? { status: 'failed' } : {}), error: match?.[1] || 'The email request could not be completed. Try again shortly.' }, match?.[0] || 500);
}
