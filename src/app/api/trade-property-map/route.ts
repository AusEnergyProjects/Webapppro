import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { integrationEnvironment, requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";

function propertyError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "INSTALLER_ONLY" || code === "FULL_ACCESS_REQUIRED" || code === "ACCOUNT_INACTIVE") {
    return adminJson({ ok: false, error: "Property tools are not available to this account." }, 403);
  }
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "Exact address tools are disabled for AEA protected households. Only region-level information remains available." }, 403);
  if (code === "ADDRESS_REQUIRED") return adminJson({ ok: false, error: "Add a complete street address to your direct customer record first." }, 409);
  if (code === "GOOGLE_MAPS_UNAVAILABLE") return adminJson({ ok: false, error: "Google property search needs administrator setup before it can be used." }, 503);
  if (code === "ADDRESS_NOT_FOUND") return adminJson({ ok: false, error: "Google could not match this address. Check the customer record and try again." }, 404);
  return adminJson({ ok: false, error: "The private property view could not be loaded." }, 500);
}

async function ownedPropertyJob(firebaseUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.source_type, d.customer_source,
      c.address_line_1, c.address_line_2, c.suburb, c.address_state, c.postcode
    FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<Record<string, unknown>>();
  if (!row || row.source_type !== "internal" || row.customer_source !== "trade_owned") throw new Error("DIRECT_CUSTOMER_REQUIRED");
  const address = [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode, "Australia"]
    .map((value) => cleanAdminText(value, 160)).filter(Boolean).join(", ");
  if (!cleanAdminText(row.address_line_1, 160) || !cleanAdminText(row.suburb, 100) || !cleanAdminText(row.address_state, 20)) {
    throw new Error("ADDRESS_REQUIRED");
  }
  return { row, address };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const url = new URL(request.url);
    const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    const { address } = await ownedPropertyJob(identity.uid, workOrderId);
    const saved = await getD1().prepare(`SELECT place_id, verified_at FROM trade_crm_property_views
      WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, identity.uid).first<Record<string, unknown>>();
    if (url.searchParams.get("image") !== "1") {
      return adminJson({
        ok: true, found: Boolean(saved?.place_id), address,
        placeId: saved?.place_id || "", verifiedAt: saved?.verified_at || "",
        mapsUrl: saved?.place_id
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${encodeURIComponent(String(saved.place_id))}`
          : "",
      });
    }
    const key = String(integrationEnvironment().GOOGLE_MAPS_API_KEY || "");
    if (!key) throw new Error("GOOGLE_MAPS_UNAVAILABLE");
    if (!saved?.place_id) throw new Error("ADDRESS_NOT_FOUND");
    const staticMap = new URL("https://maps.googleapis.com/maps/api/staticmap");
    staticMap.searchParams.set("center", address);
    staticMap.searchParams.set("zoom", "20");
    staticMap.searchParams.set("size", "640x360");
    staticMap.searchParams.set("scale", "2");
    staticMap.searchParams.set("maptype", "satellite");
    staticMap.searchParams.set("format", "jpg");
    staticMap.searchParams.set("key", key);
    const image = await fetch(staticMap.toString());
    if (!image.ok || !image.body) throw new Error("ADDRESS_NOT_FOUND");
    return new Response(image.body, {
      status: 200,
      headers: {
        "Content-Type": image.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return propertyError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid property request." }, 400); }
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const { address } = await ownedPropertyJob(identity.uid, workOrderId);
    const key = String(integrationEnvironment().GOOGLE_MAPS_API_KEY || "");
    if (!key) throw new Error("GOOGLE_MAPS_UNAVAILABLE");
    const geocode = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocode.searchParams.set("address", address);
    geocode.searchParams.set("components", "country:AU");
    geocode.searchParams.set("key", key);
    const response = await fetch(geocode.toString());
    const result = await response.json().catch(() => ({})) as {
      status?: string;
      results?: Array<{ place_id?: string; formatted_address?: string; geometry?: { location_type?: string } }>;
    };
    const match = result.results?.[0];
    if (!response.ok || result.status !== "OK" || !match?.place_id) throw new Error("ADDRESS_NOT_FOUND");
    const now = new Date().toISOString();
    await getD1().prepare(`INSERT INTO trade_crm_property_views
      (id, work_order_id, firebase_uid, place_id, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_order_id) DO UPDATE SET place_id = excluded.place_id,
        verified_at = excluded.verified_at, updated_at = excluded.updated_at
      WHERE firebase_uid = excluded.firebase_uid`)
      .bind(crypto.randomUUID(), workOrderId, identity.uid, cleanAdminText(match.place_id, 300), now, now).run();
    return adminJson({
      ok: true, found: true, address, matchedAddress: cleanAdminText(match.formatted_address, 300),
      placeId: match.place_id, verifiedAt: now, matchQuality: cleanAdminText(match.geometry?.location_type, 40),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${encodeURIComponent(match.place_id)}`,
    });
  } catch (error) { return propertyError(error); }
}
