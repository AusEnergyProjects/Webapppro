import { requireCouncilAccess } from "@/lib/council-access-server";
import { changeCouncilTeam, readCouncilTeam } from "@/lib/council-team-server";
import { COUNCIL_TEAM_MAX_BODY_BYTES, CouncilTeamInputError, parseCouncilTeamAction } from "@/lib/council-team";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });

async function handle(request: Request, write: boolean) {
  const origin = request.headers.get("origin");
  if ((write || origin) && origin !== new URL(request.url).origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request, new URL(request.url).searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  if (write && access.council.role !== "owner") return json({ ok: false, error: "Only a council owner can manage the team." }, 403);
  try {
    if (!write) {
      const team = await readCouncilTeam(access.db, access.council.id, access.identity.uid);
      return team ? json({ ok: true, team }) : json({ ok: false, error: "Your council access has changed. Reload the workspace." }, 403);
    }
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the team action as JSON." }, 415);
    let raw: unknown;
    try { raw = JSON.parse(await readBoundedRequestText(request, COUNCIL_TEAM_MAX_BODY_BYTES)); }
    catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; throw new CouncilTeamInputError("Send valid team action JSON."); }
    const result = await changeCouncilTeam(access.db, access.council.id, access.identity.uid, parseCouncilTeamAction(raw));
    return result.ok ? json(result) : json({ ok: false, error: result.error }, result.status);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ ok: false, error: "The team action is too large." }, 413);
    if (error instanceof CouncilTeamInputError) return json({ ok: false, error: error.message }, 400);
    return json({ ok: false, error: "The council team could not be loaded or updated. Please try again." }, 503);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
