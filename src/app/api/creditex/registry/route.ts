import { getD1 } from "../../../../../db";
import { sameOrigin } from "@/lib/admin-server";
import { requireComplianceAccess } from "@/lib/compliance-access-server";
import { handleRegistryRequest, registryError, registryJson } from "./_shared";
export const runtime="edge";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!sameOrigin(request))return registryJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const db=getD1(),member=await requireComplianceAccess(request,{allowedRoles:["admin","case_manager","reviewer","auditor"]},db);
    return await handleRegistryRequest(request,db,{actorUid:member.uid,organisationId:member.organisationId,actorKind:"compliance"});
  } catch(error) {
    return registryError(error)||registryJson({ok:false,error:"Registry operations are unavailable. Refresh and try again."},500);
  }
}
export const GET=handle;
export const POST=handle;
