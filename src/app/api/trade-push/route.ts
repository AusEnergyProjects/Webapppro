import { adminJson, mfaErrorResponse, sameOrigin } from '@/lib/admin-server';
import { TradeAccessError } from '@/lib/trade-access-server';
import { requireTeamCommunicationAccess } from '@/lib/trade-communications-access';
import { readBoundedRequestText, RequestBodyTooLargeError } from '@/lib/bounded-request-body.mjs';
import { pushRecord } from '@/lib/trade-push';
import { subscribeTradePush, tradeNativePushSettings, tradePushSettings, unsubscribeTradePush, updateTradePush } from '@/lib/trade-push-server';

export const runtime = 'edge';
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  const code = error instanceof Error ? error.message : '';
  if (error instanceof TradeAccessError) return adminJson({ok:false,error:'You do not have access to team notifications.'},error.status);
  if (code === 'AUTH_REQUIRED') return adminJson({ok:false,error:'Sign in to enable notifications.',code},401);
  if (['PUSH_ACCESS_REQUIRED','TEAM_ACCESS_REQUIRED','TEAM_ACCESS_RECORD_REQUIRED','ABN_REVIEW_REQUIRED','ACCOUNT_INACTIVE','EMAIL_VERIFICATION_REQUIRED','INSTALLER_ONLY','PROFILE_REQUIRED','FULL_ACCESS_REQUIRED','FIELD_SESSION_REQUIRED','FIELD_SESSION_EXPIRED','FIELD_SESSION_REVOKED'].includes(code))
    return adminJson({ok:false,error:'Sign in again to manage your notifications.',code:'PUSH_ACCESS_REQUIRED'},403);
  if (error instanceof RequestBodyTooLargeError) return adminJson({ok:false,error:'Notification settings were too large.',code:'PUSH_INPUT_INVALID'},413);
  if (error instanceof SyntaxError || ['PUSH_INPUT_INVALID','PUSH_ENDPOINT_INVALID'].includes(code)) return adminJson({ok:false,error:'This browser could not register notifications. Try Chrome, Firefox or Safari.',code:'PUSH_INPUT_INVALID'},400);
  if (code === 'PUSH_DEVICE_CONFLICT') return adminJson({ok:false,error:'This browser is already linked to another sign-in, or you have five devices enabled. Turn off notifications on an old device and try again.',code},409);
  return adminJson({ok:false,error:'Notifications are temporarily unavailable. Your messages and calls still work while TLink is open.',code:'PUSH_UNAVAILABLE'},503);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:'Request origin was not accepted.'},403);
  try {
    const actor = await requireTeamCommunicationAccess(request), params = new URL(request.url).searchParams;
    return adminJson({ok:true,...(params.has('deviceId') ? await tradeNativePushSettings(actor,params.get('deviceId'))
      : await tradePushSettings(actor,params.get('subscriptionId') || undefined))});
  }
  catch(error) { return failure(error); }
}

async function change(request: Request, action:'subscribe'|'preferences'|'unsubscribe') {
  if (!sameOrigin(request)) return adminJson({ok:false,error:'Request origin was not accepted.'},403);
  try {
    const actor = await requireTeamCommunicationAccess(request), body = pushRecord(JSON.parse(await readBoundedRequestText(request,6000)));
    if (action === 'subscribe') return adminJson({ok:true,subscription:await subscribeTradePush(actor,body)});
    if (action === 'preferences') return adminJson({ok:true,subscription:await updateTradePush(actor,body)});
    await unsubscribeTradePush(actor,body.subscriptionId);
    return adminJson({ok:true});
  } catch(error) { return failure(error); }
}
export const POST = (request: Request) => change(request,'subscribe');
export const PATCH = (request: Request) => change(request,'preferences');
export const DELETE = (request: Request) => change(request,'unsubscribe');
