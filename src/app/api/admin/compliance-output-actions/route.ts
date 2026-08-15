import { getD1 } from "../../../../../db";
import {
  adminError,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import {
  resolveActiveCreditexOfficialSourceOrganisation,
} from "@/lib/creditex-official-source-custody-server";
import {
  handleCreditexOutputActionRequest,
  outputActionError,
  outputActionJson,
} from "@/app/api/creditex/output-actions/_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!sameOrigin(request)) {
    return outputActionJson({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const administrator = await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
    ]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    return handleCreditexOutputActionRequest(request, database, {
      actorUid: administrator.uid,
      organisationId,
      actorKind: "admin",
    });
  } catch (error) {
    try {
      return outputActionError(error);
    } catch (unexpected) {
      return adminError(unexpected);
    }
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
