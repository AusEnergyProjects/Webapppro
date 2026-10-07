import { requireCouncilAccess } from "@/lib/council-access-server";
import { councilConnectDirectory, councilConnectMessages, changeCouncilConnect } from "@/lib/council-connect-server";
import { COUNCIL_CONNECT_MAX_BODY_BYTES, parseCouncilConnectAction } from "@/lib/council-connect";
import { PortalTeamError } from "@/lib/portal-team-workspace";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });
async function handle(request: Request, write: boolean) {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  if ((write || origin) && origin !== url.origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request, url.searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  const actor = { councilId: access.council.id, uid: access.identity.uid };
  try {
    if (!write) {
      const peer = url.searchParams.get("peerId");
      return peer ? json({ ok: true, conversation: await councilConnectMessages(access.db, actor, peer, url.searchParams.get("before") || "") })
        : json({ ok: true, directory: await councilConnectDirectory(access.db, actor, url.searchParams.get("search") || "") });
    }
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the message action as JSON." }, 415);
    let raw: unknown;
    try { raw = JSON.parse(await readBoundedRequestText(request, COUNCIL_CONNECT_MAX_BODY_BYTES)); }
    catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; throw new PortalTeamError(400, "Send valid message action JSON."); }
    return json({ ok: true, ...await changeCouncilConnect(access.db, actor, parseCouncilConnectAction(raw)) });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ ok: false, error: "The message is too large." }, 413);
    if (error instanceof PortalTeamError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Council messages are temporarily unavailable. Your draft is still here. Try again." }, 503);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
