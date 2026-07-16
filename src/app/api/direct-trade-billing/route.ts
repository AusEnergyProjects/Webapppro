import { stripeBillingPortalUrl, stripeCheckoutBase } from "@/lib/commercial-config";

export const runtime = "edge";

function unavailable() {
  return Response.json(
    { ok: false, error: "Membership billing is temporarily unavailable. Please contact TLink support." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const action = requestUrl.searchParams.get("action");
  try {
    if (action === "portal") return Response.redirect(stripeBillingPortalUrl(), 302);
    if (action !== "checkout") return Response.json({ ok: false, error: "Unknown billing action." }, { status: 400 });

    const partnerType = requestUrl.searchParams.get("partnerType");
    const cadence = requestUrl.searchParams.get("cadence");
    if ((partnerType !== "installer" && partnerType !== "supplier") || (cadence !== "monthly" && cadence !== "annual")) {
      return Response.json({ ok: false, error: "Choose a valid membership plan." }, { status: 400 });
    }
    const checkout = stripeCheckoutBase(partnerType, cadence);
    const firebaseUid = String(requestUrl.searchParams.get("uid") || "").trim().slice(0, 180);
    const email = String(requestUrl.searchParams.get("email") || "").trim().slice(0, 254);
    if (firebaseUid) checkout.searchParams.set("client_reference_id", firebaseUid);
    if (email) checkout.searchParams.set("prefilled_email", email);
    return Response.redirect(checkout, 302);
  } catch {
    return unavailable();
  }
}
