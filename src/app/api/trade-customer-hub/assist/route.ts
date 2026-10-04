import { getD1 } from "../../../../../db";
import { sameOrigin, mfaErrorResponse } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { hubJson } from "@/lib/customer-quote-hub-server";
import { createTradeHubAssist } from "@/lib/trade-customer-hub-assist-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return hubJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const body = await readBoundedJsonRequest(request, 8 * 1024);
    if (!body || typeof body !== "object" || !("workOrderId" in body) || typeof body.workOrderId !== "string" || !body.workOrderId.trim() || body.workOrderId.length > 180
      || !("requestId" in body) || typeof body.requestId !== "string" || !/^[a-zA-Z0-9:_-]{16,80}$/.test(body.requestId)) return hubJson({ ok: false, error: "Reopen this job and try again." }, 400);
    const draft = await createTradeHubAssist(getD1(), access, body.workOrderId, body.requestId);
    const current = await requireInstallerTeamAccess(request);
    if (current.ownerUid !== access.ownerUid || current.actorUid !== access.actorUid || !current.canViewQuotes || !current.canManageQuotes) throw new Error("WORKFLOW_AI_FORBIDDEN");
    return hubJson({ ok: true, ...draft });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    if (error instanceof BoundedJsonRequestError) return hubJson({ ok: false, code: error.code,
      error: error.code === "REQUEST_TOO_LARGE" ? "The request is too large. Reopen this job and try again." : error.message }, error.status);
    const code = error instanceof Error ? error.message : "";
    if (code === "WORKFLOW_AI_SOURCE_CHANGED") return hubJson({ ok: false, error: "The job or conversation changed. Refresh Customer Q&A and generate a new brief." }, 409);
    if (code === "WORKFLOW_AI_LIMIT") return hubJson({ ok: false, error: "AI assistance has reached its usage limit. Try again later." }, 429);
    if (code === "WORKFLOW_AI_INPUT_LIMIT") return hubJson({ ok: false, error: "This conversation is too long for a single brief. Review the questions directly." }, 413);
    if (code === "WORKFLOW_AI_FORBIDDEN" || code.startsWith("CUSTOMER_HUB_") || !code.startsWith("WORKFLOW_AI_")) return hubJson({ ok: false, error: "This job's AI brief is unavailable for your current access. Reopen Customer Q&A." }, 403);
    return hubJson({ ok: false, error: "A complete brief could not be generated. Your job and questions are unchanged. Try again later." }, 503);
  }
}
