import { getD1 } from "../../../../db";
import { adminJson,sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { handleLifecycleRequest,lifecycleError } from "@/app/api/creditex/job-lifecycle/_shared";
export const runtime="edge";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try{const access=await requireInstallerTeamAccess(request);
    return await handleLifecycleRequest(request,getD1(),{kind:"trade",uid:access.actorUid,access});
  }catch(error){return lifecycleError(error);}
}
export const GET=handle;
export const POST=handle;
