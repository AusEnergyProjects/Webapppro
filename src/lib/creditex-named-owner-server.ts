import type { ComplianceIdentity } from "./compliance-access-server";
import { CREDITEX_NAMED_OWNER_EMAIL, CREDITEX_NAMED_OWNER_NAME } from "./creditex-field-master-access.ts";

const BOOTSTRAP_INVITATION_ID = "invite_creditex_aea_info";
const CONFIRMATION_EVENT = "membership.named_owner_confirmed";

type OwnerCandidate = { membership_id: string; admin_id: string; display_name: string; confirmation_count: number };
type OwnerIdentity = Pick<ComplianceIdentity, "uid" | "email" | "emailVerified" | "membershipId" | "organisationId" | "organisationCode" | "role">;

export class CreditexNamedOwnerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: 403 | 409 = 403) {
    super(message);
    this.status = status;
    this.code = status === 409 ? "CREDITEX_NAMED_OWNER_CONFLICT" : "CREDITEX_NAMED_OWNER_REQUIRED";
  }
}

// Both capability reads and activation require the same existing owner and
// original bootstrap claim. An email address or editable display name alone
// never grants this exception to the shared-mailbox policy.
const candidateQuery = `SELECT member.id membership_id, owner.id admin_id, member.display_name,
    (SELECT COUNT(*) FROM compliance_audit_events event
      WHERE event.organisation_id = member.organisation_id
        AND event.actor_uid = member.firebase_uid
        AND event.actor_type = 'compliance' AND event.event_type = ?
        AND event.target_type = 'compliance_user' AND event.target_id = member.id
        AND json_extract(event.metadata, '$.adminId') = owner.id
        AND json_extract(event.metadata, '$.displayName') = ?
        AND json_extract(event.metadata, '$.bootstrapInvitationId') = ?) confirmation_count
  FROM compliance_users member
  JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
  JOIN admin_users owner ON owner.firebase_uid = member.firebase_uid
    AND owner.email = member.email COLLATE NOCASE AND owner.role = 'owner' AND owner.status = 'active'
  JOIN compliance_invitations invitation ON invitation.id = ?
    AND invitation.organisation_id = member.organisation_id
    AND invitation.email = member.email COLLATE NOCASE
    AND invitation.status = 'claimed' AND invitation.claimed_by_uid = member.firebase_uid
    AND invitation.role = 'admin' AND invitation.invited_by_uid = 'platform:creditex-partnership'
  WHERE member.id = ? AND member.organisation_id = ? AND member.firebase_uid = ?
    AND member.email = ? COLLATE NOCASE AND member.role = 'admin' AND member.status = 'active'
    AND organisation.organisation_code = 'CREDITEX-AU' AND organisation.status = 'active'`;

async function ownerCandidate(database: D1Database, identity: OwnerIdentity) {
  if (!identity.emailVerified || identity.email.trim().toLowerCase() !== CREDITEX_NAMED_OWNER_EMAIL
    || identity.organisationCode !== "CREDITEX-AU" || identity.role !== "admin") return null;
  return database.prepare(candidateQuery).bind(
    CONFIRMATION_EVENT, CREDITEX_NAMED_OWNER_NAME, BOOTSTRAP_INVITATION_ID, BOOTSTRAP_INVITATION_ID,
    identity.membershipId, identity.organisationId, identity.uid, CREDITEX_NAMED_OWNER_EMAIL,
  ).first<OwnerCandidate>();
}

export async function creditexNamedOwnerCapabilities(database: D1Database, identity: OwnerIdentity) {
  const candidate = await ownerCandidate(database, identity);
  return {
    canConfirmNamedOwner: Boolean(candidate && Number(candidate.confirmation_count) === 0),
    namedOwnerConfirmed: Boolean(candidate && Number(candidate.confirmation_count) === 1 && candidate.display_name === CREDITEX_NAMED_OWNER_NAME),
  };
}

export async function confirmCreditexNamedOwner(database: D1Database, identity: OwnerIdentity) {
  const candidate = await ownerCandidate(database, identity);
  if (!candidate) throw new CreditexNamedOwnerError("This action requires the existing verified AEA owner and Creditex bootstrap membership.");
  const confirmed = () => ({ displayName: CREDITEX_NAMED_OWNER_NAME, role: "admin" as const, namedOwnerConfirmed: true as const });
  if (Number(candidate.confirmation_count) === 1 && candidate.display_name === CREDITEX_NAMED_OWNER_NAME) return { ...confirmed(), reused: true };
  if (Number(candidate.confirmation_count) !== 0) throw new CreditexNamedOwnerError("The named owner record needs an access review before it can be confirmed again.");
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  // Recheck all authority in the write itself. The changes() guard makes the
  // display-name update and its immutable audit receipt one atomic operation.
  try {
    await database.batch([
      database.prepare(`UPDATE compliance_users SET display_name = ?, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM (${candidateQuery}) candidate
          WHERE candidate.membership_id = compliance_users.id AND candidate.confirmation_count = 0)`)
        .bind(CREDITEX_NAMED_OWNER_NAME, now, candidate.membership_id,
          CONFIRMATION_EVENT, CREDITEX_NAMED_OWNER_NAME, BOOTSTRAP_INVITATION_ID, BOOTSTRAP_INVITATION_ID,
          identity.membershipId, identity.organisationId, identity.uid, CREDITEX_NAMED_OWNER_EMAIL),
      database.prepare(`INSERT INTO compliance_write_guards (id, organisation_id, operation_id, step_number, verified, created_at)
        VALUES (?, ?, ?, 1, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
        .bind(crypto.randomUUID(), identity.organisationId, auditId, now),
      database.prepare(`INSERT INTO compliance_audit_events
        (id, organisation_id, actor_type, actor_uid, event_type, target_type, target_id, summary, metadata, created_at)
        VALUES (?, ?, 'compliance', ?, ?, 'compliance_user', ?, ?, ?, ?)`)
        .bind(auditId, identity.organisationId, identity.uid, CONFIRMATION_EVENT, candidate.membership_id,
          "The existing AEA owner confirmed their Creditex administrator identity as James Morris.",
          JSON.stringify({ adminId: candidate.admin_id, displayName: CREDITEX_NAMED_OWNER_NAME,
            previousDisplayName: candidate.display_name, bootstrapInvitationId: BOOTSTRAP_INVITATION_ID,
            governanceIdentityChanged: false }), now),
    ]);
  } catch (error) {
    if (error instanceof Error && /compliance_write_guards|CHECK constraint failed: verified/.test(error.message)) {
      if ((await creditexNamedOwnerCapabilities(database, identity)).namedOwnerConfirmed) return { ...confirmed(), reused: true };
      throw new CreditexNamedOwnerError("Owner access changed before confirmation completed. Refresh and try again.", 409);
    }
    throw error;
  }
  return { ...confirmed(), reused: false };
}
