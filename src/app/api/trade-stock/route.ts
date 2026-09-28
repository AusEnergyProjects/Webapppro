import { adminJson, cleanAdminText, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { normaliseStockMutation } from "@/lib/trade-stock";
import { jobStock, listStock, mutateStock, requireStockAccess, stockDetail } from "@/lib/trade-stock-server";

export const runtime = "edge";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  const code = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
  if (code.includes("AUTH_REQUIRED")) return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["STOCK_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "PROFILE_REQUIRED"].some((token) => code.includes(token))) return adminJson({ ok: false, error: "Your account does not have access to manage this stock." }, 403);
  if (["STOCK_ITEM_NOT_FOUND", "JOB_NOT_FOUND"].some((token) => code.includes(token))) return adminJson({ ok: false, error: "Product or job not found." }, 404);
  if (code.includes("STOCK_STALE")) return adminJson({ ok: false, error: "Stock changed while this was open. Refresh the quantities and try again." }, 409);
  if (code.includes("STOCK_OPERATION_REUSED")) return adminJson({ ok: false, error: "That action was already saved with different details. Refresh and try again." }, 409);
  if (code.includes("STOCK_SHORTAGE")) return adminJson({ ok: false, error: "There is not enough available stock. Receive stock or release another job's allocation first." }, 409);
  if (code.includes("STOCK_NOT_EMPTY")) return adminJson({ ok: false, error: "Release allocated stock and record a zero stocktake before turning tracking off." }, 409);
  if (code.includes("STOCK_NOT_TRACKED")) return adminJson({ ok: false, error: "Stock tracking is off for this product. Refresh to see its current settings." }, 409);
  if (code.includes("STOCK_REQUIREMENT_UNAVAILABLE")) return adminJson({ ok: false, error: "This job's material requirements have changed. Refresh the job before allocating stock." }, 409);
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
    return adminJson(itemId ? { ok: true, ...(await stockDetail(access.ownerUid, itemId)), canManage } : { ok: true, items: await listStock(access.ownerUid), canManage });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const input = normaliseStockMutation(await request.json());
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
