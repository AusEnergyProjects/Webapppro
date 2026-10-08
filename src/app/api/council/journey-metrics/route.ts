import { requireCouncilAccess } from "@/lib/council-access-server";
import { councilJourneyScopeKey } from "@/lib/council-journey-metrics";
import { councilJourneyContextKey, loadCouncilJourneyMetrics, readCouncilJourneyContext } from "@/lib/council-journey-metrics-server";

export const runtime = "edge";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const json = (body: object, status = 200) => Response.json(body, { status, headers: privateHeaders });
function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
const changed = () => json({ ok: false, code: "COUNCIL_JOURNEY_CHANGED", error: "Your council page or reporting area changed. Refresh these counters." }, 409);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Open these counters from your council workspace." }, 403);
  const ids = url.searchParams.getAll("councilId");
  if ([...url.searchParams.keys()].some(key => key !== "councilId") || ids.length !== 1
    || !ids[0] || ids[0] !== ids[0].trim() || ids[0].length > 128) {
    return json({ ok: false, error: "Choose one council workspace to load its counters." }, 400);
  }
  const access = await requireCouncilAccess(request, ids[0]);
  if (!access.ok) return privateResponse(access.response);
  try {
    const context = await readCouncilJourneyContext(access.db, access.council.id, access.identity.uid);
    if (!context) return json({ ok: false, error: "Your council access has changed. Sign in again." }, 403);
    if (context.state !== access.council.state || context.postcodes.join(",") !== [...access.council.postcodes].sort().join(",")) return changed();
    const metrics = await loadCouncilJourneyMetrics(access.db, context);
    const scopeKey = await councilJourneyScopeKey(context);
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return privateResponse(current.response);
    if (current.identity.uid !== access.identity.uid || current.council.id !== context.councilId
      || current.council.state !== context.state || [...current.council.postcodes].sort().join(",") !== context.postcodes.join(",")) return changed();
    const finalContext = await readCouncilJourneyContext(current.db, current.council.id, current.identity.uid);
    if (!finalContext) return json({ ok: false, error: "Your council access has changed. Sign in again." }, 403);
    if (councilJourneyContextKey(finalContext) !== councilJourneyContextKey(context)) return changed();
    return json({ ok: true, metrics, scopeKey });
  } catch {
    return json({ ok: false, error: "Council page counters are temporarily unavailable. Try refreshing shortly." }, 503);
  }
}
