import type { TradeTeamPresenceStatus } from "@/lib/trade-team-presence";

export default function TradeTeamStatusDot({ presence, active = true, name = "", label = false }: {
  presence?: TradeTeamPresenceStatus | null; active?: boolean; name?: string; label?: boolean;
}) {
  const status = active ? presence : null;
  const text = !active ? "Inactive" : status === "online" ? "Online" : status === "busy" ? "Busy" : status === "offline" ? "Offline" : "Status unavailable";
  const description = `${name ? `${name}: ` : ""}Call status: ${text}`;
  return <span className="tlink-team-status" role="img" aria-label={description} title={description}>
    <span className={`tlink-team-status-dot ${status || "unknown"}`} aria-hidden="true" />
    {label && <span aria-hidden="true">{text}</span>}
  </span>;
}
