import { addressLocalitiesForPostcode } from "@/lib/address-localities.mjs";
import { communityReport } from "@/lib/council-community";
import { bundledCommunitySnapshot } from "@/lib/council-community-server";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/** Public aggregate evidence only. This endpoint never accesses memberships, customer records or upstream feeds. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if ([...url.searchParams.keys()].some(key => !["postcodes", "period"].includes(key) || url.searchParams.getAll(key).length > 1)) return json({ ok: false, error: "Choose Victorian postcodes and a reporting period." }, 400);
  const text = url.searchParams.get("postcodes") || "";
  const postcodes = text.split(",");
  const period = url.searchParams.get("period") || "year";
  if (text.length > 499 || postcodes.length > 100 || postcodes.some(postcode => !/^\d{4}$/.test(postcode)
    || !addressLocalitiesForPostcode(postcode)?.localities.some((locality: { state: string }) => locality.state === "VIC"))
    || (period !== "quarter" && period !== "year" && period !== "all")) return json({ ok: false, error: "Choose up to 100 recognised Victorian residential postcodes and a valid reporting period." }, 400);
  try {
    const snapshot = await bundledCommunitySnapshot();
    const report = communityReport(snapshot, { councilId: "public-demo", name: "Selected Victorian postcodes", state: "VIC", postcodes }, period,
      { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" });
    return json({ ok: true, report });
  } catch {
    return json({ ok: false, error: "The saved public energy data is temporarily unavailable." }, 503);
  }
}
