export function memberLifecycleDecision(access, target) {
  if (!access?.isOwner && !access?.canManageTeam) return { allowed: false, reason: "manage_team_required" };
  if (target?.memberUid && target.memberUid === access.ownerUid) return { allowed: false, reason: "owner_protected" };
  if (target?.memberId === access.memberId || (target?.memberUid && target.memberUid === access.actorUid)) {
    return { allowed: false, reason: "self_protected" };
  }
  return { allowed: true, reason: "allowed" };
}
