import { loadNemSnapshot, runtimeMarketCache } from "@/lib/nem-wholesale-server";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const snapshot = await loadNemSnapshot({ cache: await runtimeMarketCache(), cacheKey: new Request(new URL("/api/wholesale-electricity/cache-v1", request.url)) });
    return Response.json(snapshot, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60", "X-Content-Type-Options": "nosniff" } });
  } catch {
    console.warn("AEMO wholesale price feed temporarily unavailable");
    return Response.json({ error: "We could not load the latest readings. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
