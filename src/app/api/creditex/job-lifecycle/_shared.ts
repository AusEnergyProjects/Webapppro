import { adminJson, mfaErrorResponse } from "@/lib/admin-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import { JobLifecycleError, loadJobLifecycle, mutateJobLifecycle, loadTradeJobReview, reviewTradeJob,
  dispatchJobCorrectionEmail, type JobLifecycleActor } from "@/lib/creditex-job-lifecycle-server";

export function lifecycleError(error:unknown) {
  const mfa=mfaErrorResponse(error); if(mfa) return mfa;
  if(error instanceof JobLifecycleError||error instanceof BoundedJsonRequestError||error instanceof ComplianceAccessError)
    return adminJson({ok:false,error:error.message,code:"code" in error?error.code:undefined},error.status);
  const message=error instanceof Error?error.message:"";
  if(/AUTH|ACCESS|IDENTITY|VERIFICATION|ROLE|TEAM_ACCESS|SUSPENDED|INACTIVE/.test(message))
    return adminJson({ok:false,error:"Active authorised access is required."},403);
  console.error("Job lifecycle action failed",error);
  return adminJson({ok:false,error:"The job action could not be completed. Refresh and try again."},500);
}

export async function handleLifecycleRequest(request:Request,db:D1Database,actor:JobLifecycleActor) {
  const query=new URL(request.url).searchParams;
  if(request.method==="GET") return adminJson({ok:true,state:actor.kind==="trade"
    ?await loadTradeJobReview(db,actor,query.get("workOrderId")||"")
    :await loadJobLifecycle(db,actor,query.get("intentId")||"")});
  if(request.method!=="POST") return adminJson({ok:false,error:"Method not allowed."},405);
  const value=await readBoundedJsonRequest(request);
  if(!value||typeof value!=="object"||Array.isArray(value)) return adminJson({ok:false,error:"Send a JSON object."},400);
  const input=value as Record<string,unknown>;
  if(actor.kind==="trade") {
    if(input.action==="retry_notification") {
      await loadTradeJobReview(db,actor,String(input.workOrderId||""));
      await dispatchJobCorrectionEmail(db,actor,String(input.deliveryId||""),{expectedWorkOrderId:String(input.workOrderId||"")});
      return adminJson({ok:true,state:await loadTradeJobReview(db,actor,String(input.workOrderId||""))});
    }
    return adminJson({ok:true,state:await reviewTradeJob(db,actor,input)});
  }
  return adminJson({ok:true,state:await mutateJobLifecycle(db,actor,input)});
}
