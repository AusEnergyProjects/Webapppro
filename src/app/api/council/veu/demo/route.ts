import { addressLocalitiesForPostcode } from "@/lib/address-localities.mjs";
import { councilVeuPeriod, councilVeuReport } from "@/lib/council-veu";
import { councilVeuBaseline } from "@/lib/council-veu-server";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/** Public aggregate evidence only. Demo requests cannot contact the registry or load council/customer records. */
export async function GET(request: Request) {
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if ([...url.searchParams.keys()].some(key => !["postcodes", "period"].includes(key) || url.searchParams.getAll(key).length !== 1)) return json({ ok: false, error: "Choose Victorian postcodes and a reporting period." }, 400);
  const text = url.searchParams.get("postcodes") || "", postcodes = text.split(",");
  const period = url.searchParams.get("period") || "year";
  if (text.length > 499 || postcodes.length > 100 || postcodes.some(postcode => !/^\d{4}$/.test(postcode)
    || !addressLocalitiesForPostcode(postcode)?.localities.some((locality: { state: string }) => locality.state === "VIC"))
    || (period !== "quarter" && period !== "year" && period !== "all")) return json({ ok: false, error: "Choose up to 100 recognised Victorian residential postcodes and a valid reporting period." }, 400);
  try {
    const now = Date.now(), requested = councilVeuPeriod(period, new Date(now));
    const snapshot = (await councilVeuBaseline()).filter(item => item.period.key === period && item.period.startDate === requested.startDate
      && (item.period.endDate === null || (requested.endDate !== null && item.period.endDate <= requested.endDate))
      && Date.parse(item.fetchedAt) <= now).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
    if (!snapshot) return json({ ok: false, error: "A saved public activity snapshot is not available for this reporting period." }, 503);
    const report = councilVeuReport(snapshot, { councilId: "public-demo", name: "Selected Victorian postcodes", state: "VIC", postcodes },
      { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" }, now);
    return json({ ok: true, report });
  } catch { return json({ ok: false, error: "The saved public activity data is temporarily unavailable." }, 503); }
}
