type CrewAccess = {
  isOwner: boolean; memberId: string; scheduleScope: string;
  crewId?: string; crewLead?: boolean; crewMemberIds?: readonly string[];
};

/** Only server-authenticated access objects may supply crew membership. */
export function canAccessCrewMember(access: Pick<CrewAccess, "isOwner" | "crewId" | "crewMemberIds">, memberId: string) {
  return access.isOwner || !access.crewId || Boolean(memberId && access.crewMemberIds?.includes(memberId));
}

export function crewScheduleMemberIds(access: CrewAccess): readonly string[] | null {
  if (access.isOwner) return null;
  if (access.crewId) return access.crewMemberIds?.length ? access.crewMemberIds : [access.memberId];
  return access.scheduleScope === "team" ? null : [access.memberId];
}

/** Recheck authenticated crew authority inside the same transaction as a mutation. */
export function crewMutationGuard(access: CrewAccess & { ownerUid: string }, memberIds: readonly string[]) {
  if (access.isOwner || !access.crewId) return { sql: "1 = 1", bindings: [] as (string | number)[] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM trade_crews mutation_crew
      JOIN trade_crew_members actor_membership ON actor_membership.owner_uid = mutation_crew.owner_uid
        AND actor_membership.crew_id = mutation_crew.id
      JOIN trade_team_members mutation_actor ON mutation_actor.owner_uid = mutation_crew.owner_uid
        AND mutation_actor.id = actor_membership.member_id AND mutation_actor.status = 'active'
      WHERE mutation_crew.id = ? AND mutation_crew.owner_uid = ?
        AND mutation_actor.id = ? AND mutation_crew.lead_member_id = mutation_actor.id AND ? = 1
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) requested_member
          WHERE NOT EXISTS (
            SELECT 1 FROM trade_crew_members target_membership
            JOIN trade_team_members mutation_target ON mutation_target.id = target_membership.member_id
              AND mutation_target.owner_uid = target_membership.owner_uid AND mutation_target.status = 'active'
            WHERE target_membership.member_id = requested_member.value
              AND target_membership.owner_uid = mutation_crew.owner_uid AND target_membership.crew_id = mutation_crew.id
          )
        )
    )`,
    bindings: [access.crewId, access.ownerUid, access.memberId, access.crewLead ? 1 : 0,
      JSON.stringify([...new Set(memberIds)])],
  };
}
