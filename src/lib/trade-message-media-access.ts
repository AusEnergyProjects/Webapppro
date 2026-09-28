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
