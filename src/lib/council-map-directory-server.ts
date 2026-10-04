import { postcodeCoordinate } from "./postcode-distance";
import { savedEnergyServiceIds } from "./energy-service-catalogue.mjs";
import { verifiedTradeAccountPredicate } from "./trade-account-predicates";
import type { CouncilMapTrade } from "./council-map-directory";

type Row = Record<string, unknown>;

function safeWebsite(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 300 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function capabilities(value: unknown): string[] {
  try { return savedEnergyServiceIds(JSON.parse(String(value || "[]"))); }
  catch { return []; }
}

async function listingId(councilId: string, uid: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["council-business", councilId, uid])));
  return `business-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Named business visibility is council-only. No private account or customer fields cross this boundary. */
export async function councilMapDirectory(db: D1Database, councilId: string, actorUid: string) {
  const rows = await db.prepare(`SELECT a.firebase_uid,a.business_name,a.suburb,a.postcode,a.address_state,
      a.capabilities,a.business_website,COUNT(*) OVER() total_count
    FROM trade_accounts a
    JOIN council_postcodes cp ON cp.postcode=a.postcode AND cp.state=a.address_state AND cp.council_id=?
    JOIN council_organisations c ON c.id=cp.council_id AND c.state=cp.state AND c.status='active'
    WHERE a.is_synthetic=0 AND a.partner_type='installer' AND ${verifiedTradeAccountPredicate("a")}
      AND EXISTS (SELECT 1 FROM council_memberships actor WHERE actor.council_id=c.id AND actor.firebase_uid=?
        AND actor.status='active' AND actor.role IN ('owner','editor','viewer'))
    ORDER BY a.business_name COLLATE NOCASE,a.firebase_uid LIMIT 500`).bind(councilId,actorUid).all<Row>();
  const trades: CouncilMapTrade[] = await Promise.all(rows.results.map(async row => {
    const postcode = String(row.postcode);
    const coordinate = postcodeCoordinate(postcode);
    return {
      id: await listingId(councilId, String(row.firebase_uid)), name: String(row.business_name),
      suburb: String(row.suburb || ""), postcode, state: String(row.address_state),
      capabilities: capabilities(row.capabilities), website: safeWebsite(row.business_website),
      position: coordinate ? { lat: coordinate[0], lng: coordinate[1] } : null,
    };
  }));
  const total = Number(rows.results[0]?.total_count || 0);
  return { trades, coverage: {
    listedTrades: trades.length, totalMatchingListings: total, unlocatedTrades: trades.filter(trade => !trade.position).length,
    truncated: total > trades.length, limit: 500,
  } };
}
