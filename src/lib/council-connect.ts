import type { CouncilRole } from "./council-access-server";
import { portalIdentifier, portalRequestId, portalText, PortalTeamError } from "./portal-team-workspace";

export type CouncilConnectPerson = { id: string; name: string; role: CouncilRole; unread: number; lastMessage: string; lastMessageAt: string };
export type CouncilConnectDirectory = { memberId: string; people: CouncilConnectPerson[]; hasMore: boolean; unread: number };
export type CouncilConnectMessage = { id: string; senderId: string; senderName: string; body: string; createdAt: string };
export type CouncilConnectConversation = { memberId: string; peerId: string; messages: CouncilConnectMessage[]; before: string; hasMore: boolean };
export type CouncilConnectAction = { action: "send"; id: string; recipientId: string; body: string } | { action: "read"; peerId: string; messageId: string };
export const COUNCIL_CONNECT_MAX_BODY_BYTES = 20000;

export function parseCouncilConnectAction(value: unknown): CouncilConnectAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PortalTeamError(400, "Send a valid message action.");
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const allowed = raw.action === "send" ? ["action", "id", "recipientId", "body"] : ["action", "peerId", "messageId"];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new PortalTeamError(400, "The message action contains unsupported fields.");
  if (raw.action === "send") {
    const body = portalText(raw.body, 4000, true);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new PortalTeamError(400, "Remove unsupported characters from your message.");
    return { action: "send", id: portalRequestId(raw.id), recipientId: portalIdentifier(raw.recipientId), body };
  }
  if (raw.action === "read") return { action: "read", peerId: portalIdentifier(raw.peerId), messageId: portalRequestId(raw.messageId) };
  throw new PortalTeamError(400, "Choose a supported message action.");
}

export function councilConnectCursor(value: string) {
  if (!value) return { createdAt: "", id: "" };
  const [createdAt, id, extra] = value.split("|");
  if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new PortalTeamError(400, "Refresh the conversation to load its history.");
  }
  return { createdAt, id: portalRequestId(id) };
}

export function mergeCouncilConnectMessages(previous: CouncilConnectMessage[], incoming: CouncilConnectMessage[]) {
  const messages = new Map(previous.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
