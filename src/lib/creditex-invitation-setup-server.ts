import { isComplianceRole } from "./compliance-access-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";

export type CreditexInvitationSetup = {
  email: string;
  displayName: string;
  workspaceName: string;
  expiresAt: string;
};

type InvitationRow = {
  email: string;
  display_name: string;
  role: string;
  expires_at: string;
  trading_name: string;
  legal_name: string;
};

const RANDOM_INVITATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An opaque invitation reference can prefill setup, but cannot authenticate or grant access. */
export async function loadCreditexInvitationSetup(database: D1Database, invitationId: unknown): Promise<CreditexInvitationSetup | null> {
  // Exclude predictable legacy seeded IDs from this public lookup.
  if (typeof invitationId !== "string" || !RANDOM_INVITATION_ID.test(invitationId)) return null;
  const now = new Date().toISOString();
  const invitation = await database.prepare(`SELECT invitation.email, invitation.display_name, invitation.role, invitation.expires_at,
      organisation.trading_name, organisation.legal_name
    FROM compliance_invitations invitation
    JOIN compliance_organisations organisation ON organisation.id = invitation.organisation_id
    WHERE invitation.id = ? AND invitation.status = 'pending'
      AND invitation.claimed_by_uid = '' AND invitation.claimed_at = '' AND invitation.expires_at > ?
      AND organisation.status = 'active' AND organisation.organisation_code = ?`)
    .bind(invitationId.toLowerCase(), now, CREDITEX_PARTNER_ORGANISATION_CODE).first<InvitationRow>();
  if (!invitation || !isComplianceRole(invitation.role) || !Number.isFinite(Date.parse(invitation.expires_at))
    || Date.parse(invitation.expires_at) <= Date.now()) return null;
  return {
    email: invitation.email,
    displayName: invitation.display_name,
    workspaceName: invitation.trading_name || invitation.legal_name,
    expiresAt: invitation.expires_at,
  };
}
