import { getD1 } from "../../../../../db";
import { adminError, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { resolveActiveCreditexOfficialSourceOrganisation } from "@/lib/creditex-official-source-custody-server";
import { handleRegistryRequest, registryError, registryJson } from "@/app/api/creditex/registry/_shared";
export const runtime="edge";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!sameOrigin(request))return registryJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const member=await requireAdminIdentity(request,["owner","admin","reviewer"]),db=getD1();
    const organisationId=await resolveActiveCreditexOfficialSourceOrganisation(db);
    return await handleRegistryRequest(request,db,{actorUid:member.uid,organisationId,actorKind:"admin"});
  } catch(error) {return registryError(error)||adminError(error);}
}
export const GET=handle;
export const POST=handle;
