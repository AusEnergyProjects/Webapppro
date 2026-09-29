import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
import { waitUntil } from "cloudflare:workers";
import { notifyTeamMessage } from "@/lib/trade-push-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { createTeamConversation, customerMessageThreads, messagesWorkspace, readTeamConversation, searchMessageContacts, sendTeamMessage, teamConversation, unreadTeamMessages } from "@/lib/trade-messages-server";

export const runtime = "edge";

function messageError(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof RequestBodyTooLargeError) return adminJson({ok:false,error:"This message is too large."},413);
  const code = error instanceof Error ? error.message : "";
  if (error instanceof TradeAccessError || ["MESSAGE_ACCESS_REQUIRED", "MESSAGE_SMS_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "You do not have access to this conversation." }, 403);
  }
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to view messages." }, 401);
  const errors: Record<string, string> = {
    MESSAGE_INVALID: "Write a message up to 2,000 characters, or add a photo or voice note.",
    MESSAGE_ATTACHMENTS_INVALID: "Choose up to four uploaded photos or voice notes.",
    MESSAGE_REQUEST_INVALID: "Refresh messages before sending.",
    MESSAGE_REQUEST_CONFLICT: "That request was already used for a different message. Refresh the conversation.",
    MESSAGE_MEMBERS_INVALID: "Choose active people from your business, up to 24 teammates.",
    MESSAGE_SUBJECT_INVALID: "Give your group a name of up to 80 characters.",
    MESSAGE_CURSOR_INVALID: "Refresh the conversation to load messages.",
  };
  return adminJson({ ok: false, error: errors[code] || "Messages could not be loaded. Try again." }, errors[code] ? 409 : 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireTeamCommunicationAccess(request);
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "unread") return adminJson({ ok: true, ...await unreadTeamMessages(actor) });
    const threadId = params.get("threadId");
    if (threadId && params.get("view") === "thread") {
      const workspace = await messagesWorkspace(actor, "", 1, undefined, threadId);
      return adminJson({ok:true,thread:workspace.threads[0]});
    }
    if (threadId) return adminJson({ ok: true, ...await teamConversation(actor, threadId, Number(params.get("before") || 0)) });
    if (params.get("view") === "contacts") return adminJson({ ok: true, ...await searchMessageContacts(actor, params.get("search") || "") });
    if (params.get("view") === "customers") return adminJson({ ok: true, ...await customerMessageThreads(actor, params.get("search") || "", Number(params.get("page") || 1)) });
    return adminJson({ ok: true, ...await messagesWorkspace(actor, params.get("search") || "", Number(params.get("page") || 1)) });
  } catch (error) { return messageError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const actor = await requireTeamCommunicationAccess(request);
    const raw = await readBoundedRequestText(request,12000);
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MESSAGE_INVALID");
      body = value as Record<string, unknown>;
    } catch { throw new Error("MESSAGE_INVALID"); }
    if (body.action === "create") return adminJson({ ok: true, thread: await createTeamConversation(actor, body) });
    if (body.action === "send") {
      const threadId = String(body.threadId || "");
      const message = await sendTeamMessage(actor, threadId, body.body, body.requestId, undefined, body.attachmentIds);
      waitUntil(notifyTeamMessage(actor, threadId, message.id));
      return adminJson({ ok: true, message });
    }
    if (body.action === "read") {
      await readTeamConversation(actor, String(body.threadId || ""), body.throughSequence);
      return adminJson({ ok: true });
    }
    return adminJson({ ok: false, error: "Choose a message action." }, 400);
  } catch (error) { return messageError(error); }
}
