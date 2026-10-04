import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { tlinkPortalAvailability } from "@/lib/tlink-portal-access-server";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request) {
  try {
    const identity = await requireFirebaseIdentity(request);
    return json({ ok: true, portals: await tlinkPortalAvailability(getD1(), identity) });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to choose your TLink dashboard." }, 401);
    }
    console.error("TLink portal selection unavailable", { reference: crypto.randomUUID() });
    return json({ ok: false, code: "PORTALS_UNAVAILABLE", error: "Your dashboards could not be loaded. Try again shortly." }, 503);
  }
}
