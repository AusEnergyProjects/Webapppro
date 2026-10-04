import { requireCouncilAccess } from "@/lib/council-access-server";
import { communityReport } from "@/lib/council-community";
import { loadCommunitySnapshot, runtimeCommunityCache } from "@/lib/council-community-server";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if ([...url.searchParams.keys()].some(key => !["councilId", "period"].includes(key) || url.searchParams.getAll(key).length > 1)) return json({ ok: false, error: "Choose a council and reporting period." }, 400);
  const period = url.searchParams.get("period") || "year";
  if (period !== "quarter" && period !== "year" && period !== "all") return json({ ok: false, error: "Choose the latest 3 months, latest 12 months or all published history." }, 400);
  const access = await requireCouncilAccess(request, url.searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  try {
    const loaded = await loadCommunitySnapshot({ cache: await runtimeCommunityCache() });
    // Source downloads can outlive a membership or postcode change. Re-read before projecting any council data.
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    const council = current.council;
    const report = communityReport(loaded.snapshot, { councilId: council.id, name: council.name, state: council.state, postcodes: council.postcodes }, period, loaded);
    return json({ ok: true, report });
  } catch {
    return json({ ok: false, error: "Community energy data is temporarily unavailable. Please try again." }, 503);
  }
}
