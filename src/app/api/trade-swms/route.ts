import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { assignedJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { loadSwms, saveSwms, startSwms, SwmsError, swmsPdfRecord } from "@/lib/trade-swms-server";

export const runtime = "edge";
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof SwmsError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, error: error.status === 413 ? "This SWMS is too large. Reduce the text or redraw the signature." : error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to use the job SWMS." }, 401);
  if (error instanceof TradeAccessError || ["TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED", "FIELD_SESSION_REQUIRED", "FIELD_SESSION_EXPIRED", "FIELD_SESSION_REVOKED", "JOB_NOT_ASSIGNED"].includes(code)) return adminJson({ ok: false, error: "You do not have current access to this job's SWMS." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job not found." }, 404);
  return adminJson({ ok: false, error: "The SWMS could not be loaded or saved. Please try again." }, 503);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), params = new URL(request.url).searchParams;
    const workOrderId = cleanAdminText(params.get("workOrderId"), 180);
    await assignedJob(access, workOrderId);
    if (params.get("download") === "1") {
      const saved = await swmsPdfRecord(getD1(), access, workOrderId);
      const [{ renderSwmsPdf }, { loadCustomerPlanPdfFonts }] = await Promise.all([import("@/lib/trade-swms-pdf"), import("@/lib/customer-plan-pdf-fonts")]);
      const bytes = await renderSwmsPdf(saved.record, saved.template, saved.sha256, await loadCustomerPlanPdfFonts());
      const name = `SWMS-${saved.record.context.workNumber || saved.record.id}.pdf`.replace(/[\r\n"\\/]/g, "_");
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return adminJson(await loadSwms(getD1(), access, workOrderId));
  } catch (error) { return failure(error); }
}
async function mutate(request: Request, start: boolean) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), body = await readBoundedJsonRequest(request, 1_200_000);
    if (!isObject(body)) throw new SwmsError("Send valid SWMS details.", 400);
    const input = body;
    const workOrderId = cleanAdminText(input.workOrderId, 180);
    await assignedJob(access, workOrderId);
    if (start) {
      if (input.action !== "start") throw new SwmsError("Choose the default job SWMS.", 400);
      return adminJson(await startSwms(getD1(), access, workOrderId, input.expectedJobRevision));
    }
    return adminJson(await saveSwms(getD1(), access, { ...input, workOrderId }));
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => mutate(request, true);
export const PATCH = (request: Request) => mutate(request, false);
