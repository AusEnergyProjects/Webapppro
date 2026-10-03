import { getD1 } from "../../../../../../../db";
import { authoriseCustomerHub, hubAuthorityScope, type HubAuthority } from "@/lib/customer-hub-links";
import { hubError, hubJson, hubParticipantJoins } from "@/lib/customer-quote-hub-server";
import { customerHubBusinessProfile, fetchCustomerHubBusinessRating } from "@/lib/customer-hub-business-profile";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const limiterOptions = { env: process.env, getDatabase: getD1, limit: 40, windowMs: 60_000 };
const limiter = createSharedLeadRateLimiter(limiterOptions);

async function currentBusiness(db: D1Database, hub: HubAuthority, id: string) {
  const scope = hubAuthorityScope(hub);
  const row = await db.prepare(`SELECT match.id business_id,trade.business_name,trade.business_website,trade.google_business_profile_url,
    trade.suburb,trade.address_state,trade.postcode ${hubParticipantJoins}
    AND match.id=? AND match.opportunity_id=? AND hub.id=? AND ${scope.sql}`)
    .bind(id, hub.opportunity_id, hub.id, ...scope.values).first<Record<string, unknown>>();
  if (!row) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return row;
}

export async function GET(_request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await context.params;
    if (!id || id.length > 120) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
    const db = getD1(), hub = await authoriseCustomerHub(db, token), row = await currentBusiness(db, hub, id);
    const limit = await limiter.check(`customer-hub-business-rating:${hub.id}`);
    if (limit.unavailable || !limit.allowed) {
      const response = hubJson({ ok: false, error: "Google ratings are temporarily unavailable. Use the business profile link." }, limit.unavailable ? 503 : 429);
      response.headers.set("Retry-After", String(limit.retryAfterSeconds || 60));
      return response;
    }
    const business = customerHubBusinessProfile(row);
    const rating = await fetchCustomerHubBusinessRating(business, {
      suburb: typeof row.suburb === "string" ? row.suburb : "",
      addressState: typeof row.address_state === "string" ? row.address_state : "",
      postcode: typeof row.postcode === "string" ? row.postcode : "",
    });
    const current = await currentBusiness(db, await authoriseCustomerHub(db, token), id);
    // A changed profile must not display the former listing's rating.
    return hubJson({ ok: true, business: customerHubBusinessProfile(current),
      rating: JSON.stringify(current) === JSON.stringify(row) ? rating : { status: "unavailable" } });
  } catch (error) { return hubError(error); }
}
