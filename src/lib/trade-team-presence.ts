export type TradeTeamPresenceStatus = "online" | "busy" | "offline";
export type TradeTeamPresence = { status: TradeTeamPresenceStatus; updatedAt: string };

export function tradeTeamPresenceStatus(value: unknown): TradeTeamPresenceStatus {
  if (value !== "online" && value !== "busy" && value !== "offline") throw new Error("PRESENCE_INPUT_INVALID");
  return value;
}

// Expressions are supplied by server code, never request input. Placeholders
// can be used with separately bound IDs; identifiers refer to the outer query.
function presenceReference(value: string): string {
  if (!/^(?:\?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)$/.test(value)) throw new Error("PRESENCE_REFERENCE_INVALID");
  return value;
}

export function tradeTeamPresenceStatusSql(memberSql: string, ownerSql: string): string {
  return `COALESCE((SELECT presence.status FROM trade_team_presence presence WHERE presence.member_id=${presenceReference(memberSql)} AND presence.owner_uid=${presenceReference(ownerSql)}),'online')`;
}

export function tradeTeamCallAvailabilitySql(memberSql: string, ownerSql: string): string {
  return `NOT EXISTS (SELECT 1 FROM trade_team_presence presence WHERE presence.member_id=${presenceReference(memberSql)} AND presence.owner_uid=${presenceReference(ownerSql)} AND presence.status IN ('busy','offline'))`;
}
