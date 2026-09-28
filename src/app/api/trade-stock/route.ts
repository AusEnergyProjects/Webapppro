import { adminJson, cleanAdminText, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { normaliseStockMutation, normaliseStockLocationMutation } from "@/lib/trade-stock";
import { jobStock, listStock, mutateStock, requireStockAccess, stockDetail, stockLocations, stockMembers, mutateStockLocation } from "@/lib/trade-stock-server";

export const runtime = "edge";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  const code = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
  if (code.includes("AUTH_REQUIRED")) return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["STOCK_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "PROFILE_REQUIRED"].some((token) => code.includes(token))) return adminJson({ ok: false, error: "Your account does not have access to manage this stock." }, 403);
  if (["STOCK_ITEM_NOT_FOUND", "JOB_NOT_FOUND"].some((token) => code.includes(token))) return adminJson({ ok: false, error: "Product or job not found." }, 404);
  if (code.includes("STOCK_REFRESH_REQUIRED")) return adminJson({ok:false,error:"Stock tracking was updated. Refresh this page before making another change."},409);
  if (code.includes("STOCK_STALE")) return adminJson({ ok: false, error: "Stock changed while this was open. Refresh the quantities and try again." }, 409);
  if (code.includes("STOCK_OPERATION_REUSED")) return adminJson({ ok: false, error: "That action was already saved with different details. Refresh and try again." }, 409);
  if (code.includes("STOCK_SHORTAGE")) return adminJson({ ok: false, error: "There is not enough physical stock at that location. Choose another location or receive stock there first." }, 409);
  if (code.includes("STOCK_NOT_EMPTY")) return adminJson({ ok: false, error: "Release this product's job commitments before turning tracking off. Your physical counts will be kept." }, 409);
  if (code.includes("STOCK_NOT_TRACKED")) return adminJson({ ok: false, error: "Stock tracking is off for this product. Refresh to see its current settings." }, 409);
  if (code.includes("STOCK_REQUIREMENT_UNAVAILABLE")) return adminJson({ ok: false, error: "This job's material requirements have changed. Refresh the job before allocating stock." }, 409);
  if (code.includes("STOCK_LOCATION_NOT_FOUND")) return adminJson({ok:false,error:"Stock location not found."},404);
  if (code.includes("STOCK_LOCATION_REQUIRED")) return adminJson({ok:false,error:"Choose the stock location for this quantity."},400);
  if (code.includes("trade_stock_locations.firebase_uid, trade_stock_locations.responsible_member_id")) return adminJson({ok:false,error:"That team member already has a stock location. Choose their existing location."},409);
  if (code.includes("STOCK_INVALID_MEMBER")) return adminJson({ok:false,error:"Choose an active member of your team. Main storage cannot be assigned to a person."},400);
  if (code.includes("trade_stock_locations.firebase_uid, trade_stock_locations.name")) return adminJson({ok:false,error:"A stock location already has that name."},409);
  if (code.includes("STOCK_INVALID") || error instanceof SyntaxError) return adminJson({ ok: false, error: "Enter a valid quantity and try again." }, 400);
  if (code.includes("CHECK constraint failed")) return adminJson({ ok: false, error: "The resulting stock quantity is outside the supported range." }, 400);
  return adminJson({ ok: false, error: "Stock could not be updated. Your change has not been confirmed." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const url = new URL(request.url); const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    if (workOrderId) {
      const identity = await requireInstallerOperations(request);
      return adminJson({ ok: true, job: await jobStock(identity.uid, workOrderId) });
    }
    const access = await requireInstallerTeamAccess(request); requireStockAccess(access);
    const itemId = cleanAdminText(url.searchParams.get("itemId"), 180); const canManage = access.isOwner || access.canManagePriceBook;
    return adminJson(itemId ? { ok: true, ...(await stockDetail(access.ownerUid, itemId)), canManage } : { ok: true, items: await listStock(access.ownerUid), locations:await stockLocations(access.ownerUid), members:await stockMembers(access.ownerUid), canManage });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const body = await request.json();
    if (body?.action === "create_location" || body?.action === "rename_location") {
      const input = normaliseStockLocationMutation(body); const access = await requireInstallerTeamAccess(request); requireStockAccess(access,true);
      const location = await mutateStockLocation(access.ownerUid,access.actorUid,input);
      return adminJson({ok:true,location,locations:await stockLocations(access.ownerUid),members:await stockMembers(access.ownerUid)});
    }
    const input = normaliseStockMutation(body);
    if (input.action === "reserve" || input.action === "release") {
      const identity = await requireInstallerOperations(request);
      await mutateStock(identity.uid, identity.uid, input);
      return adminJson({ ok: true, job: await jobStock(identity.uid, input.workOrderId!) });
    }
    const access = await requireInstallerTeamAccess(request); requireStockAccess(access, true);
    await mutateStock(access.ownerUid, access.actorUid, input);
    return adminJson({ ok: true, ...(await stockDetail(access.ownerUid, input.itemId)), canManage: true });
  } catch (error) { return failure(error); }
}
