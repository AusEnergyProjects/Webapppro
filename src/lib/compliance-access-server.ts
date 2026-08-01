import { getD1 } from "../../db";
import {
  requireFirebaseIdentity,
  type FirebaseIdentity,
} from "./firebase-server";

export const COMPLIANCE_ROLES = [
  "admin",
  "case_manager",
  "reviewer",
  "auditor",
] as const;

export type ComplianceRole = typeof COMPLIANCE_ROLES[number];

export type ComplianceAccessOptions = {
  allowedRoles?: readonly ComplianceRole[];
  organisationId?: string;
};

export type ComplianceMembershipRecord = {
  membershipId: string;
  organisationId: string;
  organisationCode: string;
  organisationLegalName: string;
  organisationTradingName: string;
  organisationStatus: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  role: string;
  membershipStatus: string;
  lastLoginAt: string;
};

export type ComplianceIdentity = FirebaseIdentity & {
  membershipId: string;
  organisationId: string;
  organisationCode: string;
  organisationLegalName: string;
  organisationTradingName: string;
  displayName: string;
  role: ComplianceRole;
};

export class ComplianceAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isComplianceRole(value: unknown): value is ComplianceRole {
  return COMPLIANCE_ROLES.includes(value as ComplianceRole);
}

export function assertActiveComplianceMembership(
  identity: FirebaseIdentity,
  membership: ComplianceMembershipRecord | null,
  allowedRoles: readonly ComplianceRole[] = COMPLIANCE_ROLES,
): ComplianceIdentity {
  if (!identity.emailVerified) {
    throw new ComplianceAccessError(
      "EMAIL_VERIFICATION_REQUIRED",
      403,
      "Verify the account email before using compliance operations.",
    );
  }
  if (!membership) {
    throw new ComplianceAccessError(
      "COMPLIANCE_ACCESS_REQUIRED",
      403,
      "This account does not have compliance organisation access.",
    );
  }
  if (
    membership.firebaseUid !== identity.uid
    || normalEmail(membership.email) !== normalEmail(identity.email)
  ) {
    throw new ComplianceAccessError(
      "COMPLIANCE_IDENTITY_MISMATCH",
      403,
      "The verified identity does not match this compliance membership.",
    );
  }
  if (membership.organisationStatus !== "active") {
    throw new ComplianceAccessError(
      "COMPLIANCE_ORGANISATION_INACTIVE",
      403,
      "This compliance organisation is not active.",
    );
  }
  if (membership.membershipStatus !== "active") {
    throw new ComplianceAccessError(
      "COMPLIANCE_MEMBERSHIP_INACTIVE",
      403,
      "This compliance membership is not active.",
    );
  }
  if (
    !isComplianceRole(membership.role)
    || !allowedRoles.includes(membership.role)
  ) {
    throw new ComplianceAccessError(
      "COMPLIANCE_ROLE_REQUIRED",
      403,
      "This compliance role does not permit that operation.",
    );
  }
  return {
    ...identity,
    membershipId: membership.membershipId,
    organisationId: membership.organisationId,
    organisationCode: membership.organisationCode,
    organisationLegalName: membership.organisationLegalName,
    organisationTradingName: membership.organisationTradingName,
    displayName: membership.displayName,
    role: membership.role,
  };
}

function membershipProjection(row: Record<string, unknown>): ComplianceMembershipRecord {
  return {
    membershipId: String(row.membership_id),
    organisationId: String(row.organisation_id),
    organisationCode: String(row.organisation_code),
    organisationLegalName: String(row.organisation_legal_name),
    organisationTradingName: String(row.organisation_trading_name || ""),
    organisationStatus: String(row.organisation_status),
    firebaseUid: String(row.firebase_uid),
    email: normalEmail(row.email),
    displayName: String(row.display_name || ""),
    role: String(row.role),
    membershipStatus: String(row.membership_status),
    lastLoginAt: String(row.last_login_at || ""),
  };
}

type PendingComplianceInvitation = {
  id: string;
  organisation_id: string;
  email: string;
  display_name: string;
  role: string;
  invited_by_uid: string;
  expires_at: string;
};

export async function claimPendingComplianceInvitation(
  identity: FirebaseIdentity,
  database: D1Database,
  organisationId = "",
) {
  if (!identity.emailVerified) return false;
  const now = new Date().toISOString();
  const organisationFilter = organisationId
    ? " AND invitation.organisation_id = ?"
    : "";
  const statement = database.prepare(`SELECT
      invitation.id,
      invitation.organisation_id,
      invitation.email,
      invitation.display_name,
      invitation.role,
      invitation.invited_by_uid,
      invitation.expires_at
    FROM compliance_invitations invitation
    JOIN compliance_organisations organisation
      ON organisation.id = invitation.organisation_id
    WHERE invitation.email = ? COLLATE NOCASE
      AND invitation.status = 'pending'
      AND invitation.expires_at > ?
      AND organisation.status = 'active'${organisationFilter}
    ORDER BY invitation.created_at, invitation.id
    LIMIT 2`);
  const invited = organisationId
    ? await statement.bind(
      normalEmail(identity.email),
      now,
      organisationId,
    ).all<PendingComplianceInvitation>()
    : await statement.bind(
      normalEmail(identity.email),
      now,
    ).all<PendingComplianceInvitation>();
  if (invited.results.length > 1) {
    throw new ComplianceAccessError(
      "COMPLIANCE_ORGANISATION_REQUIRED",
      409,
      "Choose the compliance organisation before accepting an invitation.",
    );
  }
  const invitation = invited.results[0];
  if (!invitation || !isComplianceRole(invitation.role)) return false;

  const membershipId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO compliance_users (
        id, organisation_id, firebase_uid, email, display_name, role, status,
        created_by_uid, last_login_at, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_invitations
        WHERE id = ? AND status = 'pending' AND expires_at > ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM compliance_users
        WHERE organisation_id = ?
          AND (firebase_uid = ? OR email = ? COLLATE NOCASE)
      )`).bind(
      membershipId,
      invitation.organisation_id,
      identity.uid,
      normalEmail(identity.email),
      invitation.display_name,
      invitation.role,
      invitation.invited_by_uid || "platform:invitation",
      now,
      now,
      now,
      invitation.id,
      now,
      invitation.organisation_id,
      identity.uid,
      normalEmail(identity.email),
    ),
    database.prepare(`UPDATE compliance_invitations
      SET status = 'claimed', claimed_by_uid = ?, claimed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM compliance_users
          WHERE organisation_id = ?
            AND firebase_uid = ?
            AND email = ? COLLATE NOCASE
            AND status = 'active'
        )`).bind(
      identity.uid,
      now,
      now,
      invitation.id,
      invitation.organisation_id,
      identity.uid,
      normalEmail(identity.email),
    ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      )
      SELECT ?, ?, 'compliance', ?, 'membership.invitation_claimed',
        'compliance_user', member.id,
        'Verified invited identity claimed Creditex compliance access.',
        json_object('invitationId', ?, 'role', ?), ?
      FROM compliance_users member
      WHERE member.organisation_id = ?
        AND member.firebase_uid = ?
        AND member.email = ? COLLATE NOCASE
        AND NOT EXISTS (
          SELECT 1 FROM compliance_audit_events
          WHERE event_type = 'membership.invitation_claimed'
            AND target_type = 'compliance_user'
            AND target_id = member.id
        )`).bind(
      auditId,
      invitation.organisation_id,
      identity.uid,
      invitation.id,
      invitation.role,
      now,
      invitation.organisation_id,
      identity.uid,
      normalEmail(identity.email),
    ),
  ]);
  return true;
}

export async function requireComplianceIdentity(
  identity: FirebaseIdentity,
  options: ComplianceAccessOptions = {},
  database?: D1Database,
): Promise<ComplianceIdentity> {
  if (!identity.emailVerified) {
    return assertActiveComplianceMembership(
      identity,
      null,
      options.allowedRoles,
    );
  }
  const db = database || getD1();
  const organisationId = String(options.organisationId || "").trim();
  const organisationFilter = organisationId
    ? " AND member.organisation_id = ?"
    : "";
  const statement = db.prepare(`SELECT
      member.id membership_id,
      member.organisation_id,
      member.firebase_uid,
      member.email,
      member.display_name,
      member.role,
      member.status membership_status,
      member.last_login_at,
      organisation.organisation_code,
      organisation.legal_name organisation_legal_name,
      organisation.trading_name organisation_trading_name,
      organisation.status organisation_status
    FROM compliance_users member
    JOIN compliance_organisations organisation
      ON organisation.id = member.organisation_id
    WHERE member.firebase_uid = ?${organisationFilter}
    ORDER BY member.created_at, member.id
    LIMIT 2`);
  const memberships = async () => organisationId
    ? statement.bind(identity.uid, organisationId).all<Record<string, unknown>>()
    : statement.bind(identity.uid).all<Record<string, unknown>>();
  let rows = await memberships();
  if (!organisationId && rows.results.length > 1) {
    throw new ComplianceAccessError(
      "COMPLIANCE_ORGANISATION_REQUIRED",
      409,
      "Choose the compliance organisation for this operation.",
    );
  }
  if (rows.results.length === 0) {
    await claimPendingComplianceInvitation(identity, db, organisationId);
    rows = await memberships();
  }
  const membership = rows.results[0]
    ? membershipProjection(rows.results[0])
    : null;
  const access = assertActiveComplianceMembership(
    identity,
    membership,
    options.allowedRoles,
  );
  const lastLoginAt = Date.parse(membership?.lastLoginAt || "");
  if (
    !Number.isFinite(lastLoginAt)
    || Date.now() - lastLoginAt > 15 * 60 * 1000
  ) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE compliance_users
      SET last_login_at = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND firebase_uid = ?`)
      .bind(
        now,
        now,
        access.membershipId,
        access.organisationId,
        access.uid,
      )
      .run();
  }
  return access;
}

export async function requireComplianceAccess(
  request: Request,
  options: ComplianceAccessOptions = {},
  database?: D1Database,
) {
  const identity = await requireFirebaseIdentity(request);
  return requireComplianceIdentity(
    identity,
    options,
    database,
  );
}
