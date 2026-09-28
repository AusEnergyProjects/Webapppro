import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { tradeEmailApiError, tradeEmailRequestBody } from "@/lib/trade-email-api";
import { tradeEmailSettings } from "@/lib/trade-email-server";
import { followUpServices } from "@/lib/trade-follow-ups-runtime";
import { followUpConfiguration, followUpHistory, saveFollowUpTemplate, deleteFollowUpTemplate, saveFollowUpSettings,
  previewFollowUp, queueManualFollowUp, deliverFollowUp } from "@/lib/trade-follow-ups-server";

export const runtime="edge";
function errorResponse(error:unknown) {
  const code=error instanceof Error?error.message:"";
  const messages:Record<string,string>={FOLLOW_UP_TEMPLATE_INVALID:"Enter a template name, subject and message.",FOLLOW_UP_FIELD_INVALID:"Choose a supported automatic field.",
    FOLLOW_UP_SETTINGS_INVALID:"Choose the reminder timing and a saved template.",FOLLOW_UP_TEMPLATE_UNAVAILABLE:"Choose an available template with the matching reminder type.",
    FOLLOW_UP_TEMPLATE_IN_USE:"Switch off the reminder or choose another template before deleting this one.",FOLLOW_UP_TEMPLATE_LIMIT:"You can save up to 50 templates.",
    FOLLOW_UP_OPTED_OUT:"This customer has opted out of email.",FOLLOW_UP_FIELD_MISSING:"This job is missing details needed by the template. Choose another template or update the job.",
    FOLLOW_UP_CONTEXT_CHANGED:"The job, appointment or invoice has changed. Close this message and preview it again.",
    FOLLOW_UP_OWNER_REQUIRED:"Only the business owner can change templates and automatic reminder settings."};
  return messages[code]?adminJson({ok:false,status:"failed",error:messages[code]},code==="FOLLOW_UP_OWNER_REQUIRED"?403:409):tradeEmailApiError(error);
}
export async function GET(request:Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const access=await requireInstallerTeamAccess(request),db=getD1(),workOrderId=new URL(request.url).searchParams.get("workOrderId") || "";
    if (workOrderId) await followUpServices(db).recipient(access,workOrderId);
    const [config,email,history]=await Promise.all([followUpConfiguration(db,access.ownerUid),tradeEmailSettings(access.ownerUid),
      access.isOwner?followUpHistory(db,access.ownerUid,workOrderId):Promise.resolve([])]);
    return adminJson({ok:true,templates:config.templates,settings:config.settings,canManage:access.isOwner,connection:email.connection,history});
  } catch(error) { return errorResponse(error); }
}
export async function POST(request:Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const access=await requireInstallerTeamAccess(request),input=await tradeEmailRequestBody(request),db=getD1(),services=followUpServices(db);
    if (["save_template","delete_template","save_settings"].includes(String(input.action))) {
      if (!access.isOwner) throw new Error("FOLLOW_UP_OWNER_REQUIRED");
      if (input.action==="save_template") await saveFollowUpTemplate(db,access.ownerUid,input.template);
      if (input.action==="delete_template") await deleteFollowUpTemplate(db,access.ownerUid,String(input.id || ""));
      if (input.action==="save_settings") {
        const value=input.settings;
        if (value && typeof value==="object" && (("invoiceEnabled" in value && value.invoiceEnabled) || ("appointmentEnabled" in value && value.appointmentEnabled))) {
          const email=await tradeEmailSettings(access.ownerUid);
          if (email.connection?.status!=="connected") throw new Error("EMAIL_CONNECTION_REQUIRED");
        }
        await saveFollowUpSettings(db,access.ownerUid,value);
      }
      return adminJson({ok:true});
    }
    if (input.action==="preview") {
      const draft=await previewFollowUp(db,services,access,String(input.workOrderId || ""),String(input.templateId || ""));
      return adminJson({ok:true,recipient:draft.recipient,recipientName:draft.recipientName,subject:draft.subject,body:draft.body,contextHash:draft.contextHash,missing:draft.missing});
    }
    if (input.action==="send") {
      const id=await queueManualFollowUp(db,services,access,input),status=await deliverFollowUp(db,services,id,access);
      return adminJson({ok:status==="accepted",status:status==="cancelled"?"failed":status,
        ...(status==="accepted"?{}:{error:status==="cancelled"?"The job changed or email permission ended. Preview the message again.":status==="uncertain"?"Check Sent mail before sending another copy.":"Email was not sent. Check your email connection and try again shortly."})},status==="accepted"?200:409);
    }
    throw new Error("EMAIL_INPUT_INVALID");
  } catch(error) {return errorResponse(error);}
}
