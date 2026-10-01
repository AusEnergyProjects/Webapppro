import type { TeamAccess } from "./trade-team-server";

type Actor = Pick<TeamAccess, "memberId" | "ownerUid" | "actorUid" | "fieldSessionId">;

export function messageActorGuard(actor: Actor) {
  const values = [actor.memberId, actor.ownerUid, ...(actor.fieldSessionId ? [actor.fieldSessionId, new Date().toISOString()] : [actor.actorUid])];
  const sql = `EXISTS (SELECT 1 FROM trade_team_members message_actor WHERE message_actor.id = ? AND message_actor.owner_uid = ?
    AND message_actor.status = 'active' AND ${actor.fieldSessionId ? `EXISTS (SELECT 1 FROM trade_field_sessions message_session
      WHERE message_session.id = ? AND message_session.owner_uid = message_actor.owner_uid AND message_session.team_member_id = message_actor.id
        AND message_session.status = 'active' AND message_session.expires_at > ?)` : "message_actor.member_uid = ?"})`;
  return { sql, values };
}

export function messageParticipantGuard(actor: Actor, threadId: string) {
  const guard = messageActorGuard(actor);
  return { sql: `${guard.sql} AND EXISTS (SELECT 1 FROM trade_message_participants message_participant
    WHERE message_participant.thread_id = ? AND message_participant.owner_uid = ? AND message_participant.member_id = ?)`,
  values: [...guard.values, threadId, actor.ownerUid, actor.memberId] };
}

// Query current membership for discovery and new recipients. Existing joined
// conversations keep their own membership boundary when a person changes crew.
export function messageMemberVisibilityGuard(actor: Actor, memberExpression: string, purpose: "directory" | "conversation" | "new") {
  const sharedConversation = `EXISTS (SELECT 1 FROM trade_message_participants own_conversation
    JOIN trade_message_participants known_person ON known_person.thread_id=own_conversation.thread_id AND known_person.owner_uid=own_conversation.owner_uid
    WHERE own_conversation.owner_uid=? AND own_conversation.member_id=? AND known_person.member_id=${memberExpression})`;
  const existing = purpose === "new" ? "" : purpose === "conversation" ? ` OR ${sharedConversation}`
    : ` OR (EXISTS (SELECT 1 FROM trade_team_members business_owner WHERE business_owner.id=${memberExpression}
        AND business_owner.owner_uid=? AND business_owner.member_uid=business_owner.owner_uid) AND ${sharedConversation})`;
  return { sql: `(NOT EXISTS (SELECT 1 FROM trade_crew_members restriction WHERE restriction.owner_uid=? AND restriction.member_id=?)
    OR EXISTS (SELECT 1 FROM trade_crew_members own_crew
      JOIN trade_crews crew ON crew.id=own_crew.crew_id AND crew.owner_uid=own_crew.owner_uid
      JOIN trade_crew_members colleague ON colleague.crew_id=crew.id AND colleague.owner_uid=crew.owner_uid
      WHERE own_crew.owner_uid=? AND own_crew.member_id=? AND colleague.member_id=${memberExpression})${existing})`,
    values: [actor.ownerUid, actor.memberId, actor.ownerUid, actor.memberId,
      ...(purpose === "directory" ? [actor.ownerUid] : []), ...(purpose === "new" ? [] : [actor.ownerUid, actor.memberId])] };
}
