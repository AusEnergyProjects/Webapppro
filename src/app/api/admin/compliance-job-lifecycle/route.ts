import { getD1 } from "../../../../../db";
import { adminError,adminJson,requireAdminIdentity,sameOrigin } from "@/lib/admin-server";
import { resolveActiveCreditexOfficialSourceOrganisation } from "@/lib/creditex-official-source-custody-server";
import { handleLifecycleRequest,lifecycleError } from "@/app/api/creditex/job-lifecycle/_shared";
export const runtime="edge";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  let administrator;
  try{administrator=await requireAdminIdentity(request,["owner","admin","reviewer"]);}catch(error){return adminError(error);}
  try{const db=getD1(),organisationId=await resolveActiveCreditexOfficialSourceOrganisation(db);
    const query=new URL(request.url).searchParams;
    if(request.method==="GET"&&query.has("workOrderId")){
      const workOrderId=query.get("workOrderId")||"";
      if(!workOrderId||workOrderId.length>180)return adminJson({ok:false,error:"Choose a job."},400);
      const activities=await db.prepare(`SELECT intent.id intent_id,COALESCE(NULLIF(json_extract(intent.intent_snapshot,'$.activity.title'),''),intent.activity_template_id) activity_label FROM trade_work_order_compliance_intents intent
        JOIN trade_work_orders work ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid AND work.partner_type='installer'
        WHERE work.id=? AND intent.compliance_organisation_id=?
        ORDER BY CASE WHEN intent.status IN ('planned','case_linked') THEN 0 ELSE 1 END,intent.id`)
        .bind(workOrderId,organisationId).all<{intent_id:string;activity_label:string}>();
      return adminJson({ok:true,activities:activities.results.map(row=>({intentId:row.intent_id,label:row.activity_label}))});
    }
    return await handleLifecycleRequest(request,db,{kind:"admin",uid:administrator.uid,role:administrator.role,organisationId});
  }catch(error){return lifecycleError(error);}
}
export const GET=handle;
export const POST=handle;
