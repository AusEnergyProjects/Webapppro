import { getD1 } from "../../db";
import { requireFirebaseIdentity } from "./firebase-server";
import { accountEntitlements } from "./direct-trade-entitlements-server";

export type TeamRole = "owner" | "manager" | "coordinator" | "technician";
export type TeamAccess = {
  ownerUid: string;
  actorUid: string;
  actorEmail: string;
  memberId: string;
  displayName: string;
  role: TeamRole;
  isOwner: boolean;
  businessName: string;
};

export async function ensureOwnerTeamMember(ownerUid: string, email: string, displayName: string) {
  const db = getD1();
  const existing = await db.prepare(`SELECT id FROM trade_team_members
    WHERE owner_uid = ? AND (member_uid = ? OR email = ?) ORDER BY member_uid = ? DESC LIMIT 1`)
    .bind(ownerUid, ownerUid, email, ownerUid).first<{ id: string }>();
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare(`UPDATE trade_team_members SET member_uid = ?, email = ?, display_name = ?, role = 'manager',
      status = 'active', accepted_at = CASE WHEN accepted_at = '' THEN ? ELSE accepted_at END, updated_at = ?
      WHERE id = ? AND owner_uid = ?`).bind(ownerUid, email, displayName, now, now, existing.id, ownerUid).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, member_uid, email, display_name, role, status, invited_at, accepted_at, last_active_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'manager', 'active', '', ?, ?, ?, ?)`)
    .bind(id, ownerUid, ownerUid, email, displayName, now, now, now, now).run();
  return id;
}

export async function requireInstallerTeamAccess(request: Request, requireTeamFeature = true): Promise<TeamAccess> {
  const identity = await requireFirebaseIdentity(request);
  const db = getD1();
  const owner = await db.prepare(`SELECT firebase_uid, business_name, partner_type, account_status, billing_status
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (owner) {
    if (owner.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
    if (owner.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
    const entitlements = await accountEntitlements(identity.uid, "installer", owner.billing_status);
    if (requireTeamFeature ? !entitlements.features.team_access : !entitlements.features.business_operations) {
      throw new Error(requireTeamFeature ? "TEAM_ACCESS_REQUIRED" : "FULL_ACCESS_REQUIRED");
    }
    const displayName = String(owner.business_name || "Business owner");
    const memberId = await ensureOwnerTeamMember(identity.uid, identity.email, displayName);
    return { ownerUid: identity.uid, actorUid: identity.uid, actorEmail: identity.email, memberId,
      displayName, role: "owner", isOwner: true,
      businessName: String(owner.business_name || "Installer business") };
  }
  const member = await db.prepare(`SELECT m.id, m.owner_uid, m.display_name, m.role, a.business_name,
      a.account_status, a.billing_status, a.partner_type
    FROM trade_team_members m JOIN trade_accounts a ON a.firebase_uid = m.owner_uid
    WHERE m.member_uid = ? AND m.status = 'active' ORDER BY m.accepted_at DESC LIMIT 1`)
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!member) throw new Error("TEAM_MEMBERSHIP_REQUIRED");
  if (member.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (member.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  const ownerUid = String(member.owner_uid);
  const entitlements = await accountEntitlements(ownerUid, "installer", member.billing_status);
  if (!entitlements.features.team_access) throw new Error("TEAM_ACCESS_REQUIRED");
  const role = ["manager", "coordinator", "technician"].includes(String(member.role))
    ? String(member.role) as TeamRole : "technician";
  await db.prepare("UPDATE trade_team_members SET last_active_at = ? WHERE id = ? AND member_uid = ?")
    .bind(new Date().toISOString(), member.id, identity.uid).run();
  return { ownerUid, actorUid: identity.uid, actorEmail: identity.email, memberId: String(member.id),
    displayName: String(member.display_name || identity.email), role, isOwner: false,
    businessName: String(member.business_name || "Installer business") };
}

export function canDispatch(access: TeamAccess) {
  return access.isOwner || access.role === "manager" || access.role === "coordinator";
}

export function canManageTeam(access: TeamAccess) {
  return access.isOwner;
}

export async function assignedJob(access: TeamAccess, workOrderId: string) {
  const row = await getD1().prepare(`SELECT id, source_type, source_reference, assignee_member_id, revision FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'`)
    .bind(workOrderId, access.ownerUid).first<{ id: string; source_type: string; source_reference: string; assignee_member_id: string; revision: number }>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  if (!access.isOwner && access.role === "technician" && row.assignee_member_id !== access.memberId) {
    throw new Error("JOB_NOT_ASSIGNED");
  }
  return row;
}
