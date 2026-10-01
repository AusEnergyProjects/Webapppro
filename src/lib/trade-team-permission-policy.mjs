export function canAssignWithinScope(access, fromMemberId, toMemberId) {
  if (access.isOwner) return true;
  if (!access.canAssignJobs) return false;
  if (access.crewId) return Boolean(access.crewLead && fromMemberId && toMemberId
    && access.crewMemberIds?.includes(fromMemberId) && access.crewMemberIds?.includes(toMemberId));
  if (access.jobScope === "team") return true;
  return (fromMemberId === "" && toMemberId === access.memberId)
    || fromMemberId === access.memberId;
}

export function canRescheduleWithinScope(access, currentAssigneeMemberId) {
  if (access.isOwner) return true;
  if (!access.canRescheduleJobs) return false;
  if (access.crewId) return Boolean(access.crewLead && access.crewMemberIds?.includes(currentAssigneeMemberId));
  return access.scheduleScope === "team" || currentAssigneeMemberId === access.memberId;
}
