import { getD1 } from "../../db";
import type { MessageActor } from "./trade-messages-server";
import { messageActorGuard } from "./trade-message-media-access";
import { tradeTeamPresenceStatus, tradeTeamPresenceStatusSql, type TradeTeamPresence } from "./trade-team-presence";

export async function readTradeTeamPresence(actor: MessageActor, db: D1Database = getD1()): Promise<TradeTeamPresence> {
  const guard = messageActorGuard(actor);
  const row = await db.prepare(`SELECT ${tradeTeamPresenceStatusSql("member.id","member.owner_uid")} status,
    COALESCE((SELECT updated_at FROM trade_team_presence WHERE member_id=member.id AND owner_uid=member.owner_uid),'') updated_at
    FROM trade_team_members member WHERE member.id=? AND member.owner_uid=? AND ${guard.sql}`)
    .bind(actor.memberId,actor.ownerUid,...guard.values).first<{status:unknown;updated_at:string}>();
  if (!row) throw new Error("PRESENCE_ACCESS_REQUIRED");
  return {status:tradeTeamPresenceStatus(row.status),updatedAt:row.updated_at};
}

export async function updateTradeTeamPresence(actor: MessageActor, value: unknown, db: D1Database = getD1()): Promise<TradeTeamPresence> {
  const status = tradeTeamPresenceStatus(value), guard = messageActorGuard(actor);
  // The authenticated member is the only possible target. Repeating the same
  // setting is idempotent and does not change its timestamp.
  await db.prepare(`INSERT INTO trade_team_presence(owner_uid,member_id,status,updated_at)
    SELECT ?,?,?,? WHERE ${guard.sql}
    ON CONFLICT(owner_uid,member_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at
    WHERE trade_team_presence.status<>excluded.status AND ${guard.sql}`)
    .bind(actor.ownerUid,actor.memberId,status,new Date().toISOString(),...guard.values,...guard.values).run();
  return readTradeTeamPresence(actor,db);
}
