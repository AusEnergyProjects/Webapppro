import { requireCouncilAccess } from "@/lib/council-access-server";
import { councilMapDirectory } from "@/lib/council-map-directory-server";
import { tradeMapConfiguration } from "@/lib/trade-map-configuration";

export const runtime = "edge";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request, new URL(request.url).searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  try {
    const directory = await councilMapDirectory(access.db, access.council.id, access.identity.uid);
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    if (current.council.state !== access.council.state || current.council.postcodes.join(",") !== access.council.postcodes.join(",")) {
      return json({ ok: false, error: "Your reporting area changed. Refresh the council map." }, 409);
    }
    return json({ ok: true, ...tradeMapConfiguration(process.env), ...directory });
  } catch {
    return json({ ok: false, error: "The council map is temporarily unavailable. Please try again." }, 503);
  }
}
