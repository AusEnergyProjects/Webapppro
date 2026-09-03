import { loadGasSnapshot, runtimeGasCache } from "@/lib/gas-wholesale-server";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const snapshot = await loadGasSnapshot({ cache: await runtimeGasCache(), cacheKey: new Request(new URL("/api/wholesale-gas/cache-v1", request.url)) });
    return Response.json(snapshot, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    console.warn("Wholesale gas price feeds temporarily unavailable");
    return Response.json({ error: "We could not load the latest gas prices. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
