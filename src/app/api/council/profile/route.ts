import { requireCouncilAccess } from "@/lib/council-access-server";
import { COUNCIL_PROFILE_MAX_BODY_BYTES, CouncilProfileInputError, parseCouncilProfileInput } from "@/lib/council-profile";
import { readCouncilProfile, saveCouncilProfile } from "@/lib/council-profile-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });

async function handle(request: Request, write: boolean) {
  const origin = request.headers.get("origin");
  if ((write || origin) && origin !== new URL(request.url).origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request, new URL(request.url).searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  if (write && access.council.role === "viewer") return json({ ok: false, error: "An owner or editor can change the council profile." }, 403);
  try {
    if (write && (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the council profile as JSON." }, 415);
    let input;
    if (write) {
      let raw: unknown;
      let text: string;
      try { text = await readBoundedRequestText(request, COUNCIL_PROFILE_MAX_BODY_BYTES); }
      catch (error) {
        if (error instanceof RequestBodyTooLargeError) throw error;
        throw new CouncilProfileInputError("Send valid UTF-8 council profile JSON.");
      }
      try { raw = JSON.parse(text); } catch { throw new CouncilProfileInputError("Send valid council profile JSON."); }
      input = parseCouncilProfileInput(raw, access.council.state);
    }
    const profile = input
      ? await saveCouncilProfile(access.db, access.council.id, access.identity.uid, access.council.state, input)
      : await readCouncilProfile(access.db, access.council.id, access.identity.uid);
    if (!profile) return json({ ok: false, error: "Your council access has changed. Reload the workspace to continue." }, 403);
    return json({ ok: true, profile });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ ok: false, error: "Council profile settings are too large. Use a logo up to 256 KiB." }, 413);
    if (error instanceof CouncilProfileInputError) return json({ ok: false, error: error.message }, 400);
    return json({ ok: false, error: "The council profile could not be loaded or saved. Please try again." }, 503);
  }
}
export const GET = (request: Request) => handle(request, false);
export const PATCH = (request: Request) => handle(request, true);
