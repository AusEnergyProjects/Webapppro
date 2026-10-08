import { requireCouncilAccess } from "@/lib/council-access-server";
import { readCouncilMonthlySettings,saveCouncilMonthlySettings,readCouncilMonthlyReportPdf } from "@/lib/council-monthly-report-server";
import { parseCouncilMonthlySettings } from "@/lib/council-monthly-report";
import { readBoundedJsonRequest,BoundedJsonRequestError } from "@/lib/bounded-json-request";
import { getCustomerProjectEvidenceBucket } from "@/lib/customer-project-evidence-bucket";

export const runtime="edge";
const headers={ "Cache-Control":"private, no-store",Vary:"Authorization","X-Content-Type-Options":"nosniff" };
const json=(body:object,status=200)=>Response.json(body,{status,headers});
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>!["councilId","download"].includes(key)))return json({ok:false,error:"Choose a council workspace."},400);
  const access=await requireCouncilAccess(request,params.get("councilId")||undefined);
  if(!access.ok)return access.response;
  try {
    if(params.has("download")) {
      const reportId=params.get("download")||"";
      if(reportId!=="latest" && !/^[a-f0-9-]{36}$/.test(reportId))return json({ok:false,error:"Choose a saved monthly report."},400);
      const retained=await readCouncilMonthlyReportPdf(access.db,access.council.id,access.identity.uid,getCustomerProjectEvidenceBucket(),reportId==="latest"?undefined:reportId);
      if(!retained)return json({ok:false,error:"No completed monthly report is available for your current reporting area."},404);
      return new Response(Uint8Array.from(retained.bytes).buffer,{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${retained.filename}"`}});
    }
    const settings=await readCouncilMonthlySettings(access.db,access.council.id,access.identity.uid);
    if(!settings)return json({ok:false,error:"Your council access changed. Reload to continue."},403);
    return json({ok:true,settings});
  }catch{return json({ok:false,error:"Monthly reports are temporarily unavailable. Try again shortly."},503);}
}
export async function PATCH(request:Request) {
  if(request.headers.get("origin")!==new URL(request.url).origin)return json({ok:false,error:"Request origin was not accepted."},403);
  const access=await requireCouncilAccess(request,new URL(request.url).searchParams.get("councilId")||undefined);
  if(!access.ok)return access.response;
  if(access.council.role==="viewer")return json({ok:false,error:"A council owner or editor can set monthly report delivery."},403);
  if((request.headers.get("content-type")||"").split(";",1)[0].trim().toLowerCase()!=="application/json")return json({ok:false,error:"Send report settings as JSON."},415);
  let input;
  try { input=parseCouncilMonthlySettings(await readBoundedJsonRequest(request,4096)); }
  catch(error){return json({ok:false,error:error instanceof BoundedJsonRequestError?error.message:error instanceof Error?error.message:"Check your monthly report settings."},error instanceof BoundedJsonRequestError?error.status:400);}
  try {
    const settings=await saveCouncilMonthlySettings(access.db,access.council.id,access.identity.uid,input);
    if(!settings)return json({ok:false,error:"Your council access changed. Reload to continue."},403);
    return json({ok:true,settings});
  }catch{return json({ok:false,error:"Your monthly report settings could not be saved. Try again shortly."},503);}
}
