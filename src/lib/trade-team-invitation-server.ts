import { getD1 } from "../../db";
import type { FirebaseIdentity } from "./firebase-server";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { requireTradeMyobSecondFactor } from "./trade-mfa-server";

export class TradeTeamInvitationError extends Error {
  constructor(readonly code: string, readonly status: number, readonly publicMessage: string) {
    super(code);
  }
}

export async function tradeTeamInviteTokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

type Invitation = {
  id: string; team_member_id: string; owner_uid: string; expires_at: string; consumed_at: string;
  email: string; display_name: string; member_uid: string; status: string; business_name: string;
  owner_eligible: number;
};

function invalidInvitation(): never {
  throw new TradeTeamInvitationError("INVITATION_INVALID", 410,
    "This invitation is no longer available. Ask your business to send a new invitation.");
}

async function invitationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) invalidInvitation();
  return getD1().prepare(`SELECT i.id, i.team_member_id, i.owner_uid, i.expires_at, i.consumed_at,
      m.email, m.display_name, m.member_uid, m.status, owner.business_name,
      CASE WHEN owner.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("owner")}
        THEN 1 ELSE 0 END owner_eligible
    FROM trade_team_invites i
    JOIN trade_team_members m ON m.id = i.team_member_id AND m.owner_uid = i.owner_uid
    JOIN trade_accounts owner ON owner.firebase_uid = i.owner_uid
    WHERE i.token_hash = ?`).bind(await tradeTeamInviteTokenHash(token)).first<Invitation>();
}

function isBoundIdentity(invite: Invitation, identity?: FirebaseIdentity) {
  return Boolean(identity && invite.member_uid === identity.uid
    && invite.email.toLowerCase() === identity.email.toLowerCase());
}

export async function inspectTradeTeamInvitation(token: string, identity?: FirebaseIdentity) {
  const invite = await invitationByToken(token);
  if (!invite || invite.status !== "active" || !invite.owner_eligible) invalidInvitation();
  // Only its already-bound account can reopen a used link, including recovery from older signup failures.
  if ((invite.consumed_at || invite.expires_at <= new Date().toISOString() || invite.member_uid)
    && !isBoundIdentity(invite, identity)) invalidInvitation();
  return { email: invite.email, displayName: invite.display_name,
    businessName: invite.business_name, expiresAt: invite.expires_at };
}

export async function acceptTradeTeamInvitation(token: string, identity: FirebaseIdentity) {
  // The employer can see the invitation link. It is not proof of mailbox ownership.
  if (!identity.emailVerified) throw new TradeTeamInvitationError("EMAIL_VERIFICATION_REQUIRED", 403,
    "Open the verification email to finish setting up your login.");
  const invite = await invitationByToken(token);
  if (!invite || invite.status !== "active") invalidInvitation();
  if (invite.email.toLowerCase() !== identity.email.toLowerCase()) {
    throw new TradeTeamInvitationError("INVITATION_EMAIL_MISMATCH", 403,
      "Use the email address this invitation was sent to.");
  }
  if (!invite.owner_eligible) throw new TradeTeamInvitationError("ABN_REVIEW_REQUIRED", 403,
    "This business needs its account access restored before you can join.");
  await requireTradeMyobSecondFactor(identity, invite.owner_uid);
  if (isBoundIdentity(invite, identity)) return;
  const now = new Date().toISOString();
  if (invite.member_uid || invite.consumed_at || invite.expires_at <= now) invalidInvitation();
  const db = getD1();
  const ownedBusiness = await db.prepare("SELECT firebase_uid FROM trade_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first();
  if (ownedBusiness) throw new TradeTeamInvitationError("INVITATION_TEAM_CONFLICT", 409,
    "This login is a business owner account. Use a separate team login for this invitation.");
  const existing = await db.prepare(`SELECT id FROM trade_team_members
    WHERE member_uid = ? AND status = 'active' AND id <> ? LIMIT 1`)
    .bind(identity.uid, invite.team_member_id).first();
  if (existing) throw new TradeTeamInvitationError("INVITATION_TEAM_CONFLICT", 409,
    "This login already belongs to another installer team. Ask the business to check your invitation.");
  const accepted = await db.batch([
    db.prepare(`UPDATE trade_team_members SET member_uid = ?, accepted_at = ?, last_active_at = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND member_uid = '' AND status = 'active' AND lower(email) = ?
        AND NOT EXISTS (SELECT 1 FROM trade_accounts owned_business WHERE owned_business.firebase_uid = ?)
        AND EXISTS (SELECT 1 FROM trade_accounts owner WHERE owner.firebase_uid = trade_team_members.owner_uid
          AND owner.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("owner")})
        AND NOT EXISTS (SELECT 1 FROM trade_team_members other
          WHERE other.member_uid = ? AND other.status = 'active' AND other.id <> trade_team_members.id)
        AND EXISTS (SELECT 1 FROM trade_team_invites active_invite
          WHERE active_invite.id = ? AND active_invite.team_member_id = trade_team_members.id
            AND active_invite.owner_uid = trade_team_members.owner_uid
            AND active_invite.consumed_at = '' AND active_invite.expires_at > ?)`)
      .bind(identity.uid, now, now, now, invite.team_member_id, invite.owner_uid,
        identity.email.toLowerCase(), identity.uid, identity.uid, invite.id, now),
    db.prepare(`UPDATE trade_team_invites SET consumed_at = ?
      WHERE id = ? AND consumed_at = '' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM trade_team_members member
          WHERE member.id = trade_team_invites.team_member_id AND member.owner_uid = trade_team_invites.owner_uid
            AND member.member_uid = ? AND member.accepted_at = ? AND member.status = 'active'
            AND lower(member.email) = ?)`)
      .bind(now, invite.id, now, identity.uid, now, identity.email.toLowerCase()),
  ]);
  if (!accepted[0]?.meta.changes || !accepted[1]?.meta.changes) {
    throw new TradeTeamInvitationError("INVITATION_CONFLICT", 409,
      "This invitation changed. Reopen the latest invitation email and try again.");
  }
}
