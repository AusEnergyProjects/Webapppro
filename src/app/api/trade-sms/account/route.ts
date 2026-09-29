import { adminJson,sameOrigin } from "@/lib/admin-server";
import { requireTeamCommunicationIdentity } from "@/lib/trade-communications-access";
import { managedSmsAccount,rentManagedSmsNumber,syncManagedSmsAccount,cancelManagedSmsRental } from "@/lib/trade-sms-account-server";
import { startSmsTopUp } from "@/lib/trade-sms-wallet-server";
import { managedSmsBody,managedSmsError } from "@/lib/trade-sms-api";
export const runtime="edge";
export async function GET(request:Request){
  if(!sameOrigin(request))return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{return adminJson({ok:true,...await managedSmsAccount(await requireTeamCommunicationIdentity(request))});}catch(error){return managedSmsError(error);}
}
export async function POST(request:Request){
  if(!sameOrigin(request))return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{
    const actor=await requireTeamCommunicationIdentity(request);if(!actor.isOwner)throw new Error("SMS_OWNER_REQUIRED");
    const body=await managedSmsBody(request);
    if(body.action==="top_up")return adminJson({ok:true,...await startSmsTopUp(actor,body)});
    if(body.action==="rent_number")return adminJson({ok:true,...await rentManagedSmsNumber(actor,body)});
    if(body.action==="cancel_rental")return adminJson({ok:true,...await cancelManagedSmsRental(actor)});
    if(body.action==="sync"){await syncManagedSmsAccount(actor);return adminJson({ok:true});}
    return adminJson({ok:false,error:"Choose an SMS account action."},400);
  }catch(error){return managedSmsError(error);}
}
