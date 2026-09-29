import { adminJson,sameOrigin } from "@/lib/admin-server";
import { requireTeamCommunicationIdentity } from "@/lib/trade-communications-access";
import { managedSmsNumbers } from "@/lib/trade-sms-account-server";
import { managedSmsError } from "@/lib/trade-sms-api";
export const runtime="edge";
export async function GET(request:Request){
  if(!sameOrigin(request))return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{return adminJson({ok:true,numbers:await managedSmsNumbers(await requireTeamCommunicationIdentity(request))});}catch(error){return managedSmsError(error);}
}
