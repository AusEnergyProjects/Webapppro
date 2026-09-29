import { getD1 } from "../../../../../db";
import { adminJson,sameOrigin } from "@/lib/admin-server";
import { requireTeamCommunicationIdentity } from "@/lib/trade-communications-access";
import { readSmsAutomationSettings,saveSmsAutomationSettings } from "@/lib/trade-sms-automation-server";
import { managedSmsBody,managedSmsError } from "@/lib/trade-sms-api";
import { parseSmsAutomationRules } from "@/lib/trade-sms-automation";
import { smsEnvironment } from "@/lib/trade-sms-environment";
export const runtime="edge";
export async function GET(request:Request){
  if(!sameOrigin(request))return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{return adminJson({ok:true,...await readSmsAutomationSettings(await requireTeamCommunicationIdentity(request),getD1()),urlsEnabled:smsEnvironment().urlsEnabled});}catch(error){return managedSmsError(error);}
}
export async function POST(request:Request){
  if(!sameOrigin(request))return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{
    const actor=await requireTeamCommunicationIdentity(request),body=await managedSmsBody(request);
    if(!actor.isOwner)throw new Error("SMS_OWNER_REQUIRED");
    const rules=parseSmsAutomationRules(body.rules),urlsEnabled=smsEnvironment().urlsEnabled;
    if(!urlsEnabled && rules.some(rule=>rule.enabled && (rule.kind==="review_request" || /(?:https?:\/\/|www\.)\S+/i.test(rule.body))))throw new Error("SMS_URL_APPROVAL_REQUIRED");
    return adminJson({ok:true,...await saveSmsAutomationSettings(actor,rules,getD1()),urlsEnabled});
  }catch(error){return managedSmsError(error);}
}
