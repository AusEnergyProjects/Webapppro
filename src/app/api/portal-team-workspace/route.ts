import { adminError, adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { PortalTeamError, portalWorkspace } from "@/lib/portal-team-workspace";
import { portalMessages, portalPeople, portalTasks, requirePortalTeamAccess, savePortalTask, sendPortalMessage } from "@/lib/portal-team-workspace-server";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof PortalTeamError || error instanceof BoundedJsonRequestError || error instanceof ComplianceAccessError) {
    return adminJson({ ok: false, error: error.message, ...(error instanceof ComplianceAccessError ? { code: error.code } : {}) }, error.status);
  }
  if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Check the request details." }, 400);
  return adminError(error);
}
function isInput(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const access = await requirePortalTeamAccess(request, portalWorkspace(params.get("workspace")));
    const mode = params.get("mode");
    if (mode === "people") return adminJson({ ok: true, ...await portalPeople(access, params.get("q") || "") });
    if (mode === "messages") return adminJson({ ok: true, ...await portalMessages(access, params.get("peer") || "", params.get("before") || "") });
    if (mode === "tasks") return adminJson({ ok: true, ...await portalTasks(access, { view: params.get("view") || undefined, status: params.get("status") || undefined, page: params.get("page") || undefined }) });
    throw new PortalTeamError(400, "Choose messages, tasks or team members.");
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const access = await requirePortalTeamAccess(request, portalWorkspace(params.get("workspace")));
    const body = await readBoundedJsonRequest(request);
    if (!isInput(body)) throw new PortalTeamError(400, "Check the request details.");
    const input = body;
    if (input.action === "send_message") return adminJson({ ok: true, message: await sendPortalMessage(access, input) });
    return adminJson({ ok: true, task: await savePortalTask(access, input) });
  } catch (error) { return failure(error); }
}
