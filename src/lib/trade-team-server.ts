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
    return { ownerUid: identity.uid, actorUid: identity.uid, actorEmail: identity.email, memberId: "",
      displayName: String(owner.business_name || "Business owner"), role: "owner", isOwner: true,
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
