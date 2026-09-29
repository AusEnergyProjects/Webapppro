import { receiveSmsStripeWebhook } from "@/lib/trade-sms-wallet-server";
export const runtime="edge";
export async function POST(request:Request){
  try{await receiveSmsStripeWebhook(request);return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});}
  catch(error){return new Response(null,{status:error instanceof Error&&error.message==="SMS_WEBHOOK_INVALID"?400:503,headers:{"Cache-Control":"no-store"}});}
}
