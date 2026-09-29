import { receiveClickSendWebhook } from "@/lib/trade-sms-server";
export const runtime="edge";
export async function POST(request:Request,context:{params:Promise<{connectionId:string}>}){
  try{await receiveClickSendWebhook(request,(await context.params).connectionId);return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});}
  catch(error){return new Response(null,{status:error instanceof Error&&error.message==="SMS_WEBHOOK_INVALID"?403:503,headers:{"Cache-Control":"no-store"}});}
}
