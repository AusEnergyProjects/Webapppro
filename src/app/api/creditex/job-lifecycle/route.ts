import { getD1 } from "../../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireComplianceAccess } from "@/lib/compliance-access-server";
import { handleLifecycleRequest,lifecycleError } from "./_shared";
export const runtime="edge";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try {const db=getD1(),member=await requireComplianceAccess(request,{allowedRoles:["admin","case_manager","reviewer","auditor"]},db);
    return await handleLifecycleRequest(request,db,{kind:"compliance",uid:member.uid,organisationId:member.organisationId,role:member.role});
  }catch(error){return lifecycleError(error);}
}
export const GET=handle;
export const POST=handle;
