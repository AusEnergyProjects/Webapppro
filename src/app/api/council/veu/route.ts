import { requireCouncilAccess } from "@/lib/council-access-server";
import { councilVeuReport } from "@/lib/council-veu";
import { loadCouncilVeuSnapshot, runtimeCouncilVeuCache } from "@/lib/council-veu-server";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if ([...url.searchParams.keys()].some(key => !["councilId", "period"].includes(key) || url.searchParams.getAll(key).length !== 1)) return json({ ok: false, error: "Choose a council and reporting period." }, 400);
  const period = url.searchParams.get("period") || "year";
  if (period !== "quarter" && period !== "year" && period !== "all") return json({ ok: false, error: "Choose this quarter, this year or all published history." }, 400);
  const access = await requireCouncilAccess(request, url.searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  if (access.council.state !== "VIC") return json({ ok: false, error: "Victorian Energy Upgrades reporting is available for Victorian councils." }, 400);
  if (!access.council.postcodes.length) return json({ ok: false, error: "Add reporting postcodes before loading community VEU activity." }, 400);
  try {
    const loaded = await loadCouncilVeuSnapshot(access.council.postcodes, period, { cache: await runtimeCouncilVeuCache() });
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    if (current.council.state !== "VIC" || JSON.stringify([...current.council.postcodes].sort()) !== JSON.stringify([...access.council.postcodes].sort())) return json({ ok: false, error: "Your council reporting area changed. Refresh this view to load its current community activity." }, 409);
    const { id, name, state, postcodes } = current.council;
    const report = councilVeuReport(loaded.snapshot, { councilId: id, name, state, postcodes }, loaded);
    return json({ ok: true, report });
  } catch { return json({ ok: false, error: "Community VEU activity is temporarily unavailable. Please try again." }, 503); }
}
