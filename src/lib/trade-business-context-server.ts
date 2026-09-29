import { getD1 } from "../../db";
import type { FirebaseIdentity } from "./firebase-server";
import { ensureCreditexSchemaGuards } from "./creditex-schema-guards";
import { ensureTlinkSchemaGuards } from "./tlink-schema-guards";
import { verifiedTradeAccountPredicate } from "./trade-access-server";

export type TradeBusinessChoice = {
  ownerUid: string;
  businessName: string;
  role: "owner" | "member";
  memberId: string;
  displayName: string;
};

export class TradeBusinessContextError extends Error {
  constructor(readonly code: string, readonly status: number, readonly publicMessage: string) {
    super(code);
  }
}

export function requestedTradeBusiness(request: Request): string | null {
  const selected = request.headers.get("X-TLink-Business");
  if (selected === null) return null;
  if (!selected || selected.length > 128 || /[\u0000-\u0020\u007f,]/.test(selected)) {
    throw new TradeBusinessContextError("BUSINESS_ACCESS_REQUIRED", 403,
      "Choose a business you have access to.");
  }
  return selected;
}

export async function listTradeBusinesses(identity: FirebaseIdentity): Promise<TradeBusinessChoice[]> {
  if (!identity.emailVerified) throw new TradeBusinessContextError("EMAIL_VERIFICATION_REQUIRED", 403,
    "Confirm your email address before opening your businesses.");
  const db = getD1();
  await ensureCreditexSchemaGuards(db);
  await ensureTlinkSchemaGuards(db);
  const { results } = await db.prepare(`
    SELECT owner.firebase_uid AS ownerUid, owner.business_name AS businessName, 'owner' AS role,
      COALESCE((SELECT own_member.id FROM trade_team_members own_member
        WHERE own_member.owner_uid = owner.firebase_uid AND own_member.member_uid = owner.firebase_uid
        ORDER BY own_member.id LIMIT 1), '') AS memberId,
      owner.business_name AS displayName
    FROM trade_accounts owner
    WHERE owner.firebase_uid = ? AND owner.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("owner")}
    UNION ALL
    SELECT owner.firebase_uid AS ownerUid, owner.business_name AS businessName, 'member' AS role,
      member.id AS memberId, member.display_name AS displayName
    FROM trade_team_members member JOIN trade_accounts owner ON owner.firebase_uid = member.owner_uid
    WHERE member.member_uid = ? AND member.status = 'active' AND member.owner_uid <> ?
      AND owner.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("owner")}
  `).bind(identity.uid, identity.uid, identity.uid).all<TradeBusinessChoice>();
  // A duplicate active member within one business is ambiguous, never a reason to pick broader permissions.
  const businesses = results || [];
  const owners = new Set<string>();
  for (const business of businesses) {
    if (owners.has(business.ownerUid)) throw new TradeBusinessContextError("BUSINESS_ACCESS_REQUIRED", 403,
      "Your team access needs checking. Ask the business administrator to review your membership.");
    owners.add(business.ownerUid);
  }
  return businesses.sort((left, right) => Number(right.role === "owner") - Number(left.role === "owner")
    || left.businessName.localeCompare(right.businessName) || left.ownerUid.localeCompare(right.ownerUid));
}

export async function selectTradeBusiness(request: Request, identity: FirebaseIdentity): Promise<TradeBusinessChoice> {
  const requested = requestedTradeBusiness(request);
  const businesses = await listTradeBusinesses(identity);
  if (requested !== null) {
    const selected = businesses.find(business => business.ownerUid === requested);
    if (!selected) throw new TradeBusinessContextError("BUSINESS_ACCESS_REQUIRED", 403,
      "You no longer have access to this business. Choose another business.");
    return selected;
  }
  if (businesses.length > 1) throw new TradeBusinessContextError("BUSINESS_SELECTION_REQUIRED", 409,
    "Choose which business you want to open.");
  if (!businesses.length) throw new TradeBusinessContextError("TEAM_ACCESS_RECORD_REQUIRED", 403,
    "No active business access was found for this login.");
  return businesses[0];
}
