import { getD1 } from "../../../../db";
import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
import { getCustomerProjectEvidenceBucket } from "@/lib/customer-project-evidence-bucket";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { TradeAccessError } from "@/lib/trade-access-server";
import { listSavedMessageJobFiles, MessageJobFileError, saveMessageToJob, searchMessageSaveJobs } from "@/lib/trade-message-job-files-server";

export const runtime = "edge";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof MessageJobFileError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof RequestBodyTooLargeError) return adminJson({ ok: false, error: "This request is too large." }, 413);
  if (error instanceof TradeAccessError) return adminJson({ ok: false, error: "Your business access was not accepted." }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to save job files." }, 401);
  if (["TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "Active team access is required." }, 403);
  }
  return adminJson({ ok: false, error: "The chat files could not be loaded or saved. Try again." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireTeamCommunicationAccess(request), query = new URL(request.url).searchParams;
    if (query.has("workOrderId")) return adminJson({ ok: true, files: await listSavedMessageJobFiles(getD1(), actor, query.get("workOrderId")) });
    return adminJson({ ok: true, jobs: await searchMessageSaveJobs(getD1(), actor, {
      threadId: query.get("threadId"), messageId: query.get("messageId"), search: query.get("search"),
    }) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireTeamCommunicationAccess(request);
    let value: unknown;
    try { value = JSON.parse(await readBoundedRequestText(request, 2048)); }
    catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw error;
      throw new MessageJobFileError(400, "Send a valid save request.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !("threadId" in value) || !("messageId" in value) || !("workOrderId" in value)) {
      throw new MessageJobFileError(400, "Choose a message and job.");
    }
    const result = await saveMessageToJob(getD1(), getCustomerProjectEvidenceBucket(), actor,
      { threadId: value.threadId, messageId: value.messageId, workOrderId: value.workOrderId });
    return adminJson({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
