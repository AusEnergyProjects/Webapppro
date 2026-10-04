import { requireCouncilAccess } from "@/lib/council-access-server";
import { loadCouncilReport } from "@/lib/council-reporting-server";
import type { CouncilPeriodKey } from "@/lib/council-reporting";
import { loadCouncilEnquiries } from "@/lib/council-enquiries-server";

export const runtime = "edge";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const access = await requireCouncilAccess(request, params.get("councilId") || undefined);
  if (!access.ok) return access.response;
  const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
  const period = params.get("period") || "year";
  if (period !== "quarter" && period !== "year" && period !== "all") return Response.json({ ok: false, error: "Choose this quarter, this year or all time." }, { status: 400, headers });
  // Never accept postcode, activity or custom date predicates from a browser.
  if ([...params.keys()].some((key) => !["councilId", "period"].includes(key))) return Response.json({ ok: false, error: "Reports use the council's full approved area and fixed reporting periods." }, { status: 400, headers });
  try {
    const input = { councilId: access.council.id, name: access.council.name, state: access.council.state, postcodes: access.council.postcodes, period: period as CouncilPeriodKey };
    const [report,enquiries] = await Promise.all([loadCouncilReport(access.db,input),loadCouncilEnquiries(access.db,input)]);
    const current = await requireCouncilAccess(request,access.council.id);
    if (!current.ok) return current.response;
    if (current.council.postcodes.join(',')!==input.postcodes.join(',')) return Response.json({ok:false,error:"Your reporting area changed. Refresh the report."},{status:409,headers});
    report.enquiries=enquiries;
    return Response.json({ ok: true, report }, { headers });
  } catch {
    return Response.json({ ok: false, error: "The council report could not be loaded. Please try again." }, { status: 503, headers });
  }
}
