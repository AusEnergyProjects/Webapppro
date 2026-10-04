import type { FirebaseIdentity } from "./firebase-server";
import { ADMIN_ROLES } from "./admin-server";
import { isComplianceRole } from "./compliance-access-server";
import { isCouncilRole } from "./council-access-server";
import { verifiedTradeAccountPredicate } from "./trade-account-predicates";
import { MYOB_MFA_REQUIRED_SQL } from "./trade-mfa-server";
import { hasMyobIntegrationData } from "./myob-security-audit";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";
import { TLINK_PORTALS, type TlinkPortalAvailability, type TlinkPortalStatus } from "./tlink-portals";

type TradeChoice = { owner_uid: string };
type AdminRow = { firebase_uid: string; role: string; status: string };
type ComplianceRow = { email: string; role: string; status: string; organisation_status: string; organisation_code: string };

/** Navigation hints only. Each destination still enforces its existing access gate.
 * Deliberately avoids access helpers that claim invitations, update last-login state,
 * create schema guards or write security audit events merely to render navigation.
 */
export async function tlinkPortalAvailability(db: D1Database, identity: FirebaseIdentity): Promise<TlinkPortalAvailability[]> {
  const [tradeChoices, ownTrade, admin, compliance, council] = await Promise.all([
    db.prepare(`SELECT owner.firebase_uid AS owner_uid FROM trade_accounts owner
      WHERE owner.firebase_uid = ? AND ${verifiedTradeAccountPredicate("owner")}
      UNION ALL
      SELECT owner.firebase_uid AS owner_uid FROM trade_team_members member
      JOIN trade_accounts owner ON owner.firebase_uid = member.owner_uid
      WHERE member.member_uid = ? AND member.status = 'active' AND member.owner_uid <> ?
        AND owner.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("owner")}`)
      .bind(identity.uid, identity.uid, identity.uid).all<TradeChoice>(),
    db.prepare("SELECT account_status FROM trade_accounts WHERE firebase_uid = ?")
      .bind(identity.uid).first<{ account_status: string }>(),
    db.prepare(`SELECT firebase_uid, role, status FROM admin_users
      WHERE firebase_uid = ? OR (? = 1 AND email = ?) LIMIT 1`)
      .bind(identity.uid, Number(identity.emailVerified), identity.email).first<AdminRow>(),
    db.prepare(`SELECT member.email, member.role, member.status, organisation.status AS organisation_status,
        organisation.organisation_code FROM compliance_users member
      JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
      WHERE member.firebase_uid = ? ORDER BY member.created_at, member.id LIMIT 2`)
      .bind(identity.uid).all<ComplianceRow>(),
    db.prepare(`SELECT member.role, member.firebase_uid FROM council_memberships member
      JOIN council_organisations council ON council.id = member.council_id
      WHERE member.status = 'active' AND council.status = 'active'
        AND (member.firebase_uid = ? OR (? = 1 AND member.firebase_uid IS NULL AND member.email = ?
          AND NOT EXISTS (SELECT 1 FROM council_memberships bound
            WHERE bound.council_id = member.council_id AND bound.firebase_uid = ?)))`)
      .bind(identity.uid, Number(identity.emailVerified), identity.email, identity.uid)
      .all<{ role: string; firebase_uid: string | null }>(),
  ]);

  const statuses: Record<TlinkPortalAvailability["id"], TlinkPortalStatus> = {
    trade: ownTrade && ownTrade.account_status !== "active" ? "no_access" : "setup",
    admin: "no_access", creditex: "no_access", council: "no_access",
  };
  const hasMfa = identity.secondFactor === "totp" || identity.secondFactor === "phone";
  const gated = (mfa: boolean, status: TlinkPortalStatus = "ready"): TlinkPortalStatus =>
    !identity.emailVerified ? "verify_email" : mfa && !hasMfa ? "verify_mfa" : status;

  if (tradeChoices.results.length) {
    // Duplicate active memberships also fail the authoritative business selector.
    const owners = new Set(tradeChoices.results.map(item => item.owner_uid));
    if (owners.size !== tradeChoices.results.length) statuses.trade = "no_access";
    else if (!identity.emailVerified) statuses.trade = "verify_email";
    else {
      const mfa = hasMfa ? [] : await Promise.all([...owners].map(ownerUid =>
        db.prepare(MYOB_MFA_REQUIRED_SQL).bind(ownerUid, ownerUid).first()));
      statuses.trade = gated(mfa.length > 0 && mfa.every(Boolean));
    }
  } else if (statuses.trade === "setup" && !identity.emailVerified) statuses.trade = "verify_email";

  const adminAllowed = Boolean(admin && admin.status === "active"
    && ADMIN_ROLES.some(role => role === admin.role)
    && (admin.firebase_uid === identity.uid || admin.firebase_uid.startsWith("pending:")));
  const member = compliance.results.length === 1 ? compliance.results[0] : null;
  const complianceAllowed = Boolean(member && member.email.trim().toLowerCase() === identity.email
    && member.status === "active" && member.organisation_status === "active"
    && member.organisation_code === CREDITEX_PARTNER_ORGANISATION_CODE && isComplianceRole(member.role));
  let complianceInvitation = false;
  if (!compliance.results.length && identity.emailVerified) {
    const invitations = await db.prepare(`SELECT invitation.role, organisation.organisation_code
      FROM compliance_invitations invitation JOIN compliance_organisations organisation
        ON organisation.id = invitation.organisation_id
      WHERE invitation.email = ? COLLATE NOCASE AND invitation.status = 'pending'
        AND invitation.expires_at > ? AND organisation.status = 'active'
      ORDER BY invitation.created_at, invitation.id LIMIT 2`)
      .bind(identity.email, new Date().toISOString()).all<{ role: string; organisation_code: string }>();
    complianceInvitation = invitations.results.length === 1
      && invitations.results[0].organisation_code === CREDITEX_PARTNER_ORGANISATION_CODE
      && isComplianceRole(invitations.results[0].role);
  }
  const sharedMfa = !hasMfa && (adminAllowed || complianceAllowed || complianceInvitation)
    ? await hasMyobIntegrationData(db) : false;
  if (adminAllowed) statuses.admin = gated(sharedMfa);
  if (complianceAllowed || complianceInvitation) statuses.creditex = gated(sharedMfa, complianceInvitation ? "invitation" : "ready");

  const memberships = council.results.filter(item => isCouncilRole(item.role));
  if (memberships.length) statuses.council = gated(false,
    memberships.some(item => item.firebase_uid === identity.uid) ? "ready" : "invitation");
  else if (adminAllowed && (admin?.role === "owner" || admin?.role === "admin")) {
    // Existing council entry provides the owner/admin provisioning workflow.
    statuses.council = gated(sharedMfa, "setup");
  }

  return TLINK_PORTALS.map(({ id }) => ({ id, status: statuses[id], available: statuses[id] !== "no_access" }));
}
