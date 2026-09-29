type Json = Record<string, unknown>;
export function stripeObject(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SMS_PAYMENT_RESPONSE_INVALID");
  return value as Json;
}
async function stripeRequest(key: string, path: string, data: URLSearchParams | undefined, requestId: string, fetchImpl: typeof fetch) {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) throw new Error("SMS_BILLING_SETUP_REQUIRED");
  let response: Response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {method:data ? "POST" : "GET",redirect:"manual",signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${key}`,"Stripe-Version":"2025-06-30.basil",...(data ? {"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":requestId} : {})},body:data});
  } catch { throw new Error("SMS_PAYMENT_UNCERTAIN"); }
  if (!response.ok) throw new Error(response.status >= 500 ? "SMS_PAYMENT_UNCERTAIN" : "SMS_PAYMENT_UNAVAILABLE");
  try { return stripeObject(await response.json()); } catch { throw new Error("SMS_PAYMENT_UNCERTAIN"); }
}
export async function createSmsCheckout(key: string, input: {id:string;ownerUid:string;amountCents:number;origin:string}, fetchImpl:typeof fetch=fetch) {
  const data = new URLSearchParams({mode:"payment","payment_method_types[0]":"card",currency:"aud",
    "line_items[0][price_data][currency]":"aud","line_items[0][price_data][unit_amount]":String(input.amountCents),
    "line_items[0][price_data][product_data][name]":"TLink SMS credit","line_items[0][quantity]":"1",
    "metadata[tlink_sms_topup_id]":input.id,"metadata[tlink_owner_uid]":input.ownerUid,
    "payment_intent_data[metadata][tlink_sms_topup_id]":input.id,"payment_intent_data[metadata][tlink_owner_uid]":input.ownerUid,
    client_reference_id:input.id,success_url:`${input.origin}/direct-trade/dashboard?workspace=messages&sms=credit`,
    cancel_url:`${input.origin}/direct-trade/dashboard?workspace=messages&sms=cancelled`});
  const result = await stripeRequest(key,"checkout/sessions",data,`tlink-sms-topup-${input.id}`,fetchImpl);
  if (typeof result.id !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(result.id) || typeof result.url !== "string") throw new Error("SMS_PAYMENT_UNCERTAIN");
  const url = new URL(result.url);
  if (url.origin !== "https://checkout.stripe.com" || url.username || url.password) throw new Error("SMS_PAYMENT_UNCERTAIN");
  return {sessionId:result.id,checkoutUrl:result.url};
}
export async function retrieveSmsCheckout(key:string, sessionId:string,fetchImpl:typeof fetch=fetch) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("SMS_PAYMENT_RESPONSE_INVALID");
  return stripeRequest(key,`checkout/sessions/${encodeURIComponent(sessionId)}`,undefined,"",fetchImpl);
}
export async function retrieveSmsPaymentIntent(key:string, id:string,fetchImpl:typeof fetch=fetch) {
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Error("SMS_PAYMENT_RESPONSE_INVALID");
  return stripeRequest(key,`payment_intents/${encodeURIComponent(id)}`,undefined,"",fetchImpl);
}
export async function verifySmsStripeEvent(raw:string,signature:string,secret:string,now=Date.now()) {
  if (!secret || raw.length > 150000 || signature.length > 2000) throw new Error("SMS_WEBHOOK_INVALID");
  const fields = signature.split(",").map(item=>item.split("="));
  const timestamp = fields.find(([key])=>key==="t")?.[1] || "";
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error("SMS_WEBHOOK_INVALID");
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const message = new TextEncoder().encode(`${timestamp}.${raw}`);
  let valid=false;
  for (const [name,value] of fields) {
    if (name !== "v1" || !/^[a-f0-9]{64}$/i.test(value || "")) continue;
    const bytes=Uint8Array.from(value.match(/../g)!.map(item=>parseInt(item,16)));
    if (await crypto.subtle.verify("HMAC",key,bytes,message)) valid=true;
  }
  if (!valid) throw new Error("SMS_WEBHOOK_INVALID");
  try { return stripeObject(JSON.parse(raw)); } catch { throw new Error("SMS_WEBHOOK_INVALID"); }
}
