import { adminJson, mfaErrorResponse } from "./admin-server";
import { TradeAccessError } from "./trade-access-server";
export function managedSmsError(error:unknown) {
  const mfa=mfaErrorResponse(error);if(mfa)return mfa;
  if(error instanceof TradeAccessError)return adminJson({ok:false,error:"Your account does not have SMS access."},error.status);
  const code=error instanceof Error?error.message:"";
  if(code==="AUTH_REQUIRED")return adminJson({ok:false,error:"Sign in to continue."},401);
  if(["SMS_OWNER_REQUIRED","FULL_ACCESS_REQUIRED","ACCOUNT_INACTIVE","EMAIL_VERIFICATION_REQUIRED","ABN_REVIEW_REQUIRED","INSTALLER_ONLY"].includes(code))return adminJson({ok:false,error:"Only the verified business owner can manage SMS numbers, credit and automatic texts."},403);
  const messages:Record<string,string>={
    SMS_ADMIN_SETUP_REQUIRED:"TLink SMS is being connected. Number rental is not yet available.",SMS_BILLING_SETUP_REQUIRED:"SMS payments need the TLink Stripe connection before credit can be purchased.",
    SMS_REGISTRATION_INVALID:"Complete the business and contact details with a real Australian street address and mobile number.",
    SMS_PAYMENT_REVIEW_REQUIRED:"A disputed SMS payment needs a billing review before a number can be rented or renewed.",
    SMS_URL_APPROVAL_REQUIRED:"SMS links are awaiting ClickSend approval. Save review requests as drafts until links are enabled; service reminders without links can still be enabled.",
    SMS_RENTAL_CONFIRMATION_REQUIRED:"Review the number and monthly price, then accept the rental before continuing.",SMS_RENTAL_ALREADY_EXISTS:"Your business already has a number or an order being checked.",
    SMS_NUMBER_PRICE_CHANGED:"That number or its price has changed. Refresh the Australian number list.",SMS_CREDIT_REQUIRED:"Add enough SMS credit to cover this purchase or message.",
    SMS_TOPUP_INVALID:"Choose a $50, $100 or $200 top-up.",SMS_REQUEST_ID_REQUIRED:"Refresh before starting a new request.",SMS_REQUEST_CONFLICT:"This request was already used with different details. Refresh to check its result.",
    SMS_TOPUP_ALREADY_PAID:"This top-up is already paid. Refresh to see your credit.",SMS_PAYMENT_RECONCILIATION_REQUIRED:"This payment needs a check before it can be attempted again. Contact TLink support.",
    SMS_PAYMENT_UNCERTAIN:"The payment result is not confirmed. Check the same top-up rather than starting another one.",SMS_PAYMENT_UNAVAILABLE:"Stripe could not open checkout. Check this top-up again.",
    SMS_ACCOUNT_NOT_READY:"The SMS account is awaiting a provider or billing check.",SMS_DISCONNECT_FIRST:"Your business already has a connected number. Manage that connection first.",
    SMS_RENTAL_REQUIRED:"No active number rental was found.",SMS_CONNECTION_REQUIRED:"Set up your business SMS number before enabling automatic texts.",
    SMS_AUTOMATION_INVALID:"Check the text and timing of each automatic message.",SMS_AUTOMATION_FIELD_INVALID:"Choose message details using the insert buttons.",
    SMS_AUTOMATION_REVIEW_URL_INVALID:"Enter a valid HTTPS review link.",SMS_AUTOMATION_REVIEW_URL_REQUIRED:"Add your review link before enabling review requests.",
    SMS_REVIEW_URL_INVALID:"Enter a valid HTTPS review link.",SMS_REVIEW_URL_REQUIRED:"Add your review link before enabling review requests.",
    SMS_PROVIDER_REJECTED:"ClickSend did not accept this request. Check the account setup.",SMS_PROVIDER_OUTCOME_UNKNOWN:"ClickSend has not confirmed this request. Refresh its status before trying a new one.",
  };
  const validation=["SMS_REGISTRATION_INVALID","SMS_RENTAL_CONFIRMATION_REQUIRED","SMS_NUMBER_PRICE_CHANGED","SMS_CREDIT_REQUIRED","SMS_TOPUP_INVALID"];
  return adminJson({ok:false,error:messages[code]||"SMS could not complete this request. Refresh to check the current status.",code:messages[code]?code:"SMS_UNAVAILABLE"},validation.includes(code)?422:messages[code]?409:500);
}
export async function managedSmsBody(request:Request) {
  if(Number(request.headers.get("content-length")||0)>16000)throw new Error("SMS_REGISTRATION_INVALID");
  const raw=await request.text();if(raw.length>16000)throw new Error("SMS_REGISTRATION_INVALID");
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("SMS_REGISTRATION_INVALID");}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("SMS_REGISTRATION_INVALID");
  return value as Record<string,unknown>;
}
