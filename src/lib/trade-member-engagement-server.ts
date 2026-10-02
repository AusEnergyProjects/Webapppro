import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { decryptProtectedPayload, encryptProtectedPayload } from "./trade-integration-crypto";
import { emptyMemberEngagement, MemberEngagementError, parseMemberEngagement, type MemberEngagementBusiness } from "./trade-member-engagement";

type Row = { encrypted_payload: string; revision: number; updated_at: string };
const ownerExists = `EXISTS (SELECT 1 FROM trade_team_members actor WHERE actor.owner_uid=? AND actor.id=?
  AND actor.member_uid=actor.owner_uid AND actor.member_uid=? AND actor.status='active')`;

export function assertEngagementOwner(access: TeamAccess) {
  if (!access.isOwner || access.actorUid !== access.ownerUid) throw new MemberEngagementError(403, "Only the business owner can open private pay and onboarding records.");
}
async function ownedMember(access: TeamAccess, memberId: string, db: D1Database) {
  assertEngagementOwner(access);
  if (!memberId || memberId.length > 180) throw new MemberEngagementError(400, "Choose a team member.");
  const member = await db.prepare(`SELECT member.status,account.business_name,account.abn,account.address_line_1,account.suburb,account.address_state,account.postcode
    FROM trade_team_members member JOIN trade_accounts account ON account.firebase_uid=member.owner_uid
    WHERE member.owner_uid=? AND member.id=? AND member.status<>'removed' AND ${ownerExists}`)
    .bind(access.ownerUid, memberId, access.ownerUid, access.memberId, access.actorUid).first<{ status: string; business_name: string; abn: string; address_line_1: string; suburb: string; address_state: string; postcode: string }>();
  if (!member) throw new MemberEngagementError(404, "This team member is not available in your business.");
  const business: MemberEngagementBusiness = { businessName: member.business_name, abn: member.abn,
    address: [member.address_line_1, member.suburb, member.address_state, member.postcode].filter(Boolean).join(', ') };
  return { status: member.status, business };
}
async function details(access: TeamAccess, memberId: string, row: Row | null) {
  if (!row) return { details: { ...emptyMemberEngagement }, revision: 0, updatedAt: "" };
  const payload = await decryptProtectedPayload(row.encrypted_payload);
  if (payload.purpose !== "trade-member-engagement-v1" || payload.ownerUid !== access.ownerUid || payload.memberId !== memberId) throw new MemberEngagementError(500, "The private record could not be opened safely.");
  return { details: parseMemberEngagement(payload.details), revision: row.revision, updatedAt: row.updated_at };
}
export async function readMemberEngagement(access: TeamAccess, memberId: string, db: D1Database = getD1()) {
  const member = await ownedMember(access, memberId, db);
  const row = await db.prepare(`SELECT engagement.encrypted_payload,engagement.revision,engagement.updated_at
    FROM trade_team_members member LEFT JOIN trade_member_engagement engagement ON engagement.owner_uid=member.owner_uid AND engagement.member_id=member.id
    WHERE member.owner_uid=? AND member.id=? AND member.status<>'removed' AND ${ownerExists}`)
    .bind(access.ownerUid, memberId, access.ownerUid, access.memberId, access.actorUid).first<Row>();
  if (!row) throw new MemberEngagementError(404, "This team member is not available in your business.");
  const result = await details(access, memberId, row.encrypted_payload ? row : null);
  await db.prepare(`INSERT INTO trade_team_member_events(id,owner_uid,team_member_id,actor_uid,entity_type,entity_id,event_type,metadata,created_at)
    VALUES(?,?,?,?,'engagement',?,'engagement.viewed','{}',?)`)
    .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, memberId, new Date().toISOString()).run();
  return { memberId, business: member.business, readOnly: member.status === "archived", ...result };
}
export async function saveMemberEngagement(access: TeamAccess, input: Record<string, unknown>, db: D1Database = getD1()) {
  assertEngagementOwner(access);
  const memberId = typeof input.memberId === "string" ? input.memberId : "";
  const member = await ownedMember(access, memberId, db);
  if (member.status === "archived") throw new MemberEngagementError(409, "Archived member records are read-only.");
  const expectedRevision = input.revision;
  if (!Number.isSafeInteger(expectedRevision) || typeof expectedRevision !== "number" || expectedRevision < 0) throw new MemberEngagementError(400, "Refresh the private record before saving.");
  const value = parseMemberEngagement(input.details);
  const encrypted = await encryptProtectedPayload({ purpose: "trade-member-engagement-v1", ownerUid: access.ownerUid, memberId, details: value });
  const now = new Date().toISOString(); const mutationId = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`INSERT INTO trade_member_engagement(owner_uid,member_id,encrypted_payload,revision,last_mutation_id,updated_by_uid,created_at,updated_at)
      SELECT ?,?,?,1,?,?,?,? WHERE (?=0 OR EXISTS (SELECT 1 FROM trade_member_engagement WHERE owner_uid=? AND member_id=?))
        AND EXISTS (SELECT 1 FROM trade_team_members member WHERE member.owner_uid=? AND member.id=? AND member.status NOT IN ('archived','removed'))
        AND ${ownerExists}
      ON CONFLICT(owner_uid,member_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,
        revision=trade_member_engagement.revision+1,last_mutation_id=excluded.last_mutation_id,
        updated_by_uid=excluded.updated_by_uid,updated_at=excluded.updated_at WHERE trade_member_engagement.revision=?`)
      .bind(access.ownerUid, memberId, encrypted, mutationId, access.actorUid, now, now, expectedRevision,
        access.ownerUid, memberId, access.ownerUid, memberId, access.ownerUid, access.memberId, access.actorUid, expectedRevision),
    db.prepare(`INSERT INTO trade_team_member_events(id,owner_uid,team_member_id,actor_uid,entity_type,entity_id,event_type,metadata,created_at)
      SELECT ?,?,?,?,'engagement',?,'engagement.saved',?,? WHERE EXISTS (SELECT 1 FROM trade_member_engagement WHERE owner_uid=? AND member_id=? AND last_mutation_id=?)`)
      .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, memberId, JSON.stringify({ revision: expectedRevision + 1 }), now, access.ownerUid, memberId, mutationId),
  ]);
  if (Number(result[0]?.meta.changes || 0) !== 1) throw new MemberEngagementError(409, "This record or team access changed. Refresh the private record and try again.");
  return { memberId, business: member.business, details: value, revision: expectedRevision + 1, updatedAt: now, readOnly: false };
}
