import type { CouncilRole } from "./council-access-server";
import { councilConnectCursor, type CouncilConnectAction, type CouncilConnectConversation, type CouncilConnectDirectory } from "./council-connect";
import { portalIdentifier, portalText, PortalTeamError } from "./portal-team-workspace";

type Access = { councilId: string; uid: string };
type Member = { id: string; name: string; role: CouncilRole; council_id: string };
type Message = { id: string; body: string; sender_id: string; sender_name: string; recipient_id: string; created_at: string };
// Each statement independently checks authoritative membership, including reads after a write.
// Pending invitations and suspended colleagues are never valid message participants.
const members = `WITH members AS (SELECT m.id,m.council_id,m.firebase_uid,COALESCE(NULLIF(m.display_name,''),m.email) name,m.role
  FROM council_memberships m JOIN council_organisations c ON c.id=m.council_id AND c.status='active'
  WHERE m.status='active' AND m.firebase_uid IS NOT NULL AND m.firebase_uid<>'' AND m.accepted_at IS NOT NULL
  AND m.role IN ('owner','editor','viewer'))`;
const actorJoin = `JOIN members actor ON actor.council_id=? AND actor.firebase_uid=?`;
const unread = `(r.seen_message_id IS NULL OR m.created_at>r.seen_created_at OR (m.created_at=r.seen_created_at AND m.id>r.seen_message_id))`;
async function currentActor(db: D1Database, access: Access) {
  const actor = await db.prepare(`${members} SELECT * FROM members WHERE council_id=? AND firebase_uid=?`).bind(access.councilId, access.uid).first<Member>();
  if (!actor) throw new PortalTeamError(403, "Your council access changed. Reload the workspace.");
  return actor;
}

export async function councilConnectDirectory(db: D1Database, access: Access, search = ""): Promise<CouncilConnectDirectory> {
  const query = portalText(search, 100); const actor = await currentActor(db, access);
  const result = await db.prepare(`${members} SELECT person.id,person.name,person.role,
    (SELECT count(*) FROM council_team_messages m LEFT JOIN council_team_message_reads r ON r.council_id=m.council_id AND r.member_id=m.recipient_id AND r.peer_id=m.sender_id
      WHERE m.council_id=actor.council_id AND m.sender_id=person.id AND m.recipient_id=actor.id AND ${unread}) unread,
    COALESCE((SELECT m.body FROM council_team_messages m WHERE m.council_id=actor.council_id AND
      ((m.sender_id=actor.id AND m.recipient_id=person.id) OR (m.sender_id=person.id AND m.recipient_id=actor.id)) ORDER BY m.created_at DESC,m.id DESC LIMIT 1),'') lastMessage,
    COALESCE((SELECT m.created_at FROM council_team_messages m WHERE m.council_id=actor.council_id AND
      ((m.sender_id=actor.id AND m.recipient_id=person.id) OR (m.sender_id=person.id AND m.recipient_id=actor.id)) ORDER BY m.created_at DESC,m.id DESC LIMIT 1),'') lastMessageAt
    FROM members person ${actorJoin} WHERE person.council_id=actor.council_id AND person.id<>actor.id AND (?='' OR instr(lower(person.name),lower(?))>0)
    ORDER BY unread>0 DESC,lastMessageAt DESC,person.name,person.id LIMIT 101`).bind(access.councilId, access.uid, query, query).all<CouncilConnectDirectory["people"][number]>();
  const count = await db.prepare(`${members} SELECT count(*) unread FROM council_team_messages m ${actorJoin}
    JOIN members peer ON peer.id=m.sender_id AND peer.council_id=actor.council_id
    LEFT JOIN council_team_message_reads r ON r.council_id=m.council_id AND r.member_id=actor.id AND r.peer_id=peer.id
    WHERE m.council_id=actor.council_id AND m.recipient_id=actor.id AND ${unread}`).bind(access.councilId, access.uid).first<{ unread: number }>();
  await currentActor(db, access);
  return { memberId: actor.id, people: result.results.slice(0, 100), hasMore: result.results.length > 100, unread: count?.unread ?? 0 };
}

export async function councilConnectMessages(db: D1Database, access: Access, peerId: string, before = ""): Promise<CouncilConnectConversation> {
  const actor = await currentActor(db, access); const peer = portalIdentifier(peerId); const cursor = councilConnectCursor(before);
  const participant = await db.prepare(`${members} SELECT person.id FROM members person ${actorJoin}
    WHERE person.id=? AND person.council_id=actor.council_id AND person.id<>actor.id`).bind(access.councilId, access.uid, peer).first();
  if (!participant) throw new PortalTeamError(404, "This colleague is no longer available in your council team.");
  const result = await db.prepare(`${members} SELECT m.* FROM council_team_messages m ${actorJoin}
    JOIN members peer ON peer.id=? AND peer.council_id=actor.council_id
    WHERE m.council_id=actor.council_id AND ((m.sender_id=actor.id AND m.recipient_id=peer.id) OR (m.sender_id=peer.id AND m.recipient_id=actor.id))
    AND (?='' OR m.created_at<? OR (m.created_at=? AND m.id<?)) ORDER BY m.created_at DESC,m.id DESC LIMIT 51`)
    .bind(access.councilId, access.uid, peer, cursor.createdAt, cursor.createdAt, cursor.createdAt, cursor.id).all<Message>();
  await currentActor(db, access);
  const selected = result.results.slice(0, 50); const oldest = selected.at(-1);
  return { memberId: actor.id, peerId: peer, hasMore: result.results.length > 50, before: oldest ? `${oldest.created_at}|${oldest.id}` : "",
    messages: selected.reverse().map(row => ({ id: row.id, senderId: row.sender_id, senderName: row.sender_name, body: row.body, createdAt: row.created_at })) };
}

export async function changeCouncilConnect(db: D1Database, access: Access, action: CouncilConnectAction) {
  const actor = await currentActor(db, access); const now = new Date().toISOString();
  if (action.action === "read") {
    const result = await db.prepare(`${members} INSERT INTO council_team_message_reads(council_id,member_id,peer_id,seen_message_id,seen_created_at,updated_at)
      SELECT actor.council_id,actor.id,peer.id,m.id,m.created_at,? FROM council_team_messages m ${actorJoin}
      JOIN members peer ON peer.id=? AND peer.council_id=actor.council_id
      WHERE m.id=? AND m.council_id=actor.council_id AND m.sender_id=peer.id AND m.recipient_id=actor.id
      ON CONFLICT(council_id,member_id,peer_id) DO UPDATE SET seen_message_id=excluded.seen_message_id,seen_created_at=excluded.seen_created_at,updated_at=excluded.updated_at
      WHERE excluded.seen_created_at>council_team_message_reads.seen_created_at OR (excluded.seen_created_at=council_team_message_reads.seen_created_at AND excluded.seen_message_id>=council_team_message_reads.seen_message_id)`)
      .bind(now, access.councilId, access.uid, action.peerId, action.messageId).run();
    await currentActor(db, access);
    if (!result.meta.changes) {
      const previous = await db.prepare(`${members} SELECT r.seen_message_id FROM council_team_message_reads r ${actorJoin}
        JOIN members peer ON peer.id=? AND peer.council_id=actor.council_id JOIN council_team_messages m ON m.id=? AND m.council_id=actor.council_id
        WHERE r.council_id=actor.council_id AND r.member_id=actor.id AND r.peer_id=peer.id AND m.sender_id=peer.id AND m.recipient_id=actor.id`)
        .bind(access.councilId, access.uid, action.peerId, action.messageId).first();
      if (!previous) throw new PortalTeamError(404, "This conversation is no longer available.");
    }
    return { id: action.messageId };
  }
  if (action.recipientId === actor.id) throw new PortalTeamError(400, "Choose a colleague to message.");
  await db.prepare(`${members} INSERT INTO council_team_messages(id,council_id,sender_id,recipient_id,sender_name,body,created_at)
    SELECT ?,actor.council_id,actor.id,person.id,actor.name,?,? FROM members person ${actorJoin}
    WHERE person.id=? AND person.council_id=actor.council_id AND person.id<>actor.id ON CONFLICT(id) DO NOTHING`)
    .bind(action.id, action.body, now, access.councilId, access.uid, action.recipientId).run();
  const message = await db.prepare(`${members} SELECT m.* FROM council_team_messages m ${actorJoin}
    JOIN members peer ON peer.id=m.recipient_id AND peer.council_id=actor.council_id
    WHERE m.id=? AND m.council_id=actor.council_id AND m.sender_id=actor.id`).bind(access.councilId, access.uid, action.id).first<Message>();
  if (!message) throw new PortalTeamError(403, "Your council access or the recipient changed. Refresh before sending.");
  if (message.body !== action.body || message.recipient_id !== action.recipientId) throw new PortalTeamError(409, "This message was already sent with different details. Refresh the conversation.");
  return { id: message.id, createdAt: message.created_at };
}
