import { requireCouncilAccess } from "@/lib/council-access-server";
import { councilMonthlyDemoBundle } from "@/lib/council-monthly-demo";
import { councilMonthlyFilename, councilMonthlyScopeKey } from "@/lib/council-monthly-report";
import { buildCouncilMonthlyBundle } from "@/lib/council-monthly-report-server";
import { readCouncilProfile } from "@/lib/council-profile-server";
import { loadCommunitySnapshot, runtimeCommunityCache } from "@/lib/council-community-server";

export const runtime = "edge";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization" };
const json = (error: string, status: number) => Response.json({ ok: false, error }, { status, headers });

export async function GET(request: Request) {
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json("Request origin was not accepted.", 403);
  if ([...url.searchParams.keys()].some(key => !["councilId", "demonstration"].includes(key) || url.searchParams.getAll(key).length !== 1)) return json("Choose a council report.", 400);
  const demonstration = url.searchParams.get("demonstration");
  if (url.searchParams.has("demonstration")) {
    if (demonstration !== "port-phillip" || url.searchParams.has("councilId")) return json("Choose the Port Phillip demonstration.", 400);
    try {
      const bundle = await councilMonthlyDemoBundle();
      const { createCouncilMonthlyReportPdf } = await import("@/lib/council-monthly-report-pdf");
      const bytes = await createCouncilMonthlyReportPdf(bundle);
      return new Response(Uint8Array.from(bytes).buffer, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${councilMonthlyFilename(bundle.profile, bundle.community.sourceAsOf, true)}"` } });
    } catch { return json("The demonstration PDF could not be prepared. Try again shortly.", 503); }
  }
  const access = await requireCouncilAccess(request, url.searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  try {
    const profile = await readCouncilProfile(access.db, access.council.id, access.identity.uid);
    if (!profile) return json("Council access changed. Refresh your workspace.", 403);
    const source = await loadCommunitySnapshot({ cache: await runtimeCommunityCache() });
    const { id, name, state, postcodes } = access.council;
    const bundle = await buildCouncilMonthlyBundle(access.db, { councilId: id, name, state, postcodes }, profile, source.snapshot, new Date());
    bundle.community.checkedAt = source.checkedAt; bundle.community.refreshFailed = source.refreshFailed;
    bundle.community.dataOrigin = source.dataOrigin; bundle.community.stale ||= source.refreshFailed;
    const { createCouncilMonthlyReportPdf } = await import("@/lib/council-monthly-report-pdf");
    const bytes = await createCouncilMonthlyReportPdf(bundle);
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    if (councilMonthlyScopeKey(current.council) !== councilMonthlyScopeKey(profile)) return json("The council reporting area changed. Refresh and download again.", 409);
    return new Response(Uint8Array.from(bytes).buffer, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${councilMonthlyFilename(profile, source.snapshot.sourceAsOf)}"` } });
  } catch { return json("The council PDF could not be prepared. Try again shortly.", 503); }
}
