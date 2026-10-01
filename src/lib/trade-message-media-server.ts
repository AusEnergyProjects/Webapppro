import type { TeamAccess } from "./trade-team-server";
import { messageActorGuard, messageParticipantGuard, messageMemberVisibilityGuard } from "./trade-message-media-access";
import { inspectMessageMedia, messageAttachmentIds, type MessageAttachment } from "./trade-message-media";

type Actor = Pick<TeamAccess, "ownerUid" | "actorUid" | "memberId" | "fieldSessionId">;
type AvatarActor = Actor & Pick<TeamAccess, "isOwner" | "canManageTeam">;
export type MessageMediaBucket = {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit } | null>;
  delete(key: string): Promise<void>;
};
type MediaRow = { id: string; kind: "image" | "audio"; content_type: string; size_bytes: number; object_key: string; purpose: string; member_id: string; thread_id: string; state: string; message_id: string };
const projection = (row: MediaRow): MessageAttachment => ({ id: row.id, kind: row.kind, contentType: row.content_type, sizeBytes: row.size_bytes });

function avatarGuard(actor: AvatarActor, memberId: string, write: boolean) {
  const guard = messageActorGuard(actor);
  const visibility = messageMemberVisibilityGuard(actor, "avatar_member.id", "conversation");
  return { sql: `${guard.sql} AND EXISTS (SELECT 1 FROM trade_team_members avatar_member WHERE avatar_member.id = ? AND avatar_member.owner_uid = ? AND avatar_member.status = 'active' ${write ? "" : `AND ${visibility.sql}`})
    ${write && memberId !== actor.memberId ? `AND EXISTS (SELECT 1 FROM trade_team_members avatar_editor WHERE avatar_editor.id = ? AND avatar_editor.owner_uid = ? AND (avatar_editor.member_uid = avatar_editor.owner_uid OR avatar_editor.can_manage_team = 1))` : ""}`,
  values: [...guard.values, memberId, actor.ownerUid, ...(write ? [] : visibility.values), ...(write && memberId !== actor.memberId ? [actor.memberId, actor.ownerUid] : [])] };
}

export function messageAttachmentStatements(db: D1Database, actor: Actor, threadId: string, messageId: string, value: unknown) {
  const ids = messageAttachmentIds(value), access = messageParticipantGuard(actor, threadId), now = new Date().toISOString();
  const marks = ids.map(() => "?").join(",");
  const guard = { sql: `${access.sql} AND NOT EXISTS (SELECT 1 FROM trade_message_media old_attachment WHERE old_attachment.owner_uid = ? AND old_attachment.message_id = ? AND old_attachment.state = 'attached' ${ids.length ? `AND old_attachment.id NOT IN (${marks})` : ""})
    ${ids.length ? `AND (SELECT COUNT(*) FROM trade_message_media attachment WHERE attachment.id IN (${marks}) AND attachment.owner_uid = ? AND attachment.uploader_member_id = ? AND attachment.thread_id = ? AND attachment.purpose = 'message'
      AND ((attachment.state = 'pending' AND attachment.expires_at > ?) OR (attachment.state = 'attached' AND attachment.message_id = ?))) = ?` : ""}`,
  values: [...access.values, actor.ownerUid, messageId, ...ids, ...(ids.length ? [...ids, actor.ownerUid, actor.memberId, threadId, now, messageId, ids.length] : [])] };
  const statements = ids.length ? [db.prepare(`UPDATE trade_message_media SET state = 'attached', message_id = ?, expires_at = ''
    WHERE id IN (${marks}) AND owner_uid = ? AND uploader_member_id = ? AND thread_id = ? AND state = 'pending' AND expires_at > ?
    AND ${guard.sql} AND EXISTS (SELECT 1 FROM trade_internal_messages media_message WHERE media_message.id = ? AND media_message.owner_uid = ? AND media_message.thread_id = ? AND media_message.actor_member_id = ?)`)
    .bind(messageId, ...ids, actor.ownerUid, actor.memberId, threadId, now, ...guard.values, messageId, actor.ownerUid, threadId, actor.memberId)] : [];
  return { ids, guard, statements };
}

export async function loadMessageAttachments(db: D1Database, actor: Actor, threadId: string, messageIds: string[]) {
  const result: Record<string, MessageAttachment[]> = {};
  if (!messageIds.length) return result;
  if (messageIds.length > 40) throw new Error("MESSAGE_ATTACHMENTS_INVALID");
  const guard = messageParticipantGuard(actor, threadId);
  const rows = await db.prepare(`SELECT media.* FROM trade_message_media media JOIN trade_internal_messages message
    ON message.id = media.message_id AND message.owner_uid = media.owner_uid AND message.thread_id = media.thread_id
    WHERE media.owner_uid = ? AND media.thread_id = ? AND media.state = 'attached' AND media.message_id IN (${messageIds.map(() => "?").join(",")}) AND ${guard.sql}
    ORDER BY media.created_at, media.id`).bind(actor.ownerUid, threadId, ...messageIds, ...guard.values).all<MediaRow>();
  for (const row of rows.results) (result[row.message_id] ||= []).push(projection(row));
  return result;
}

export async function uploadMessageMedia(db: D1Database, bucket: MessageMediaBucket, actor: AvatarActor,
  input: { purpose: "message" | "avatar"; threadId: string; memberId: string; bytes: Uint8Array; contentType: string }) {
  const isAvatar = input.purpose === "avatar";
  if (isAvatar ? !input.memberId || input.threadId : !input.threadId || input.memberId) throw new Error("MESSAGE_MEDIA_TARGET");
  const access = isAvatar ? avatarGuard(actor, input.memberId, true) : messageParticipantGuard(actor, input.threadId);
  if (!await db.prepare(`SELECT 1 allowed WHERE ${access.sql}`).bind(...access.values).first()) throw new Error("MESSAGE_ACCESS_REQUIRED");
  const checked = inspectMessageMedia(input.bytes, input.contentType, isAvatar);
  const id = crypto.randomUUID(), now = new Date().toISOString(), expires = isAvatar ? "" : new Date(Date.now() + 86400000).toISOString();
  const key = `trade-message-media/${actor.ownerUid}/${id}`;
  const bytes = new Uint8Array(checked.bytes.byteLength); bytes.set(checked.bytes);
  await bucket.put(key, bytes.buffer, { httpMetadata: { contentType: checked.contentType } });
  try {
    const statements: D1PreparedStatement[] = [];
    if (isAvatar) statements.push(db.prepare(`UPDATE trade_message_media SET state = 'retired' WHERE owner_uid = ? AND member_id = ? AND purpose = 'avatar' AND state = 'active' AND ${access.sql}`)
      .bind(actor.ownerUid, input.memberId, ...access.values));
    statements.push(db.prepare(`INSERT INTO trade_message_media (id, owner_uid, uploader_member_id, purpose, kind, thread_id, member_id, object_key, content_type, size_bytes, state, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${access.sql}
      ${isAvatar ? "" : "AND (SELECT COUNT(*) FROM trade_message_media WHERE owner_uid = ? AND uploader_member_id = ? AND state = 'pending' AND expires_at > ?) < 20"}`)
      .bind(id, actor.ownerUid, actor.memberId, input.purpose, checked.kind, input.threadId, input.memberId, key, checked.contentType, bytes.byteLength, isAvatar ? "active" : "pending", now, expires,
        ...access.values, ...(isAvatar ? [] : [actor.ownerUid, actor.memberId, now])));
    const saved = await db.batch(statements);
    if (!saved[saved.length - 1].meta.changes) throw new Error("MESSAGE_MEDIA_UPLOAD_DENIED");
  } catch (error) { await bucket.delete(key); throw error; }
  // Superseded avatar bytes and abandoned uploads are no longer retrievable.
  // Bound cleanup keeps ordinary uploads small without creating a scheduler.
  const obsolete = await db.prepare(`SELECT id, object_key FROM trade_message_media WHERE owner_uid = ?
    AND ((state = 'retired' AND purpose = 'avatar' AND member_id = ?) OR (state = 'pending' AND uploader_member_id = ? AND expires_at <= ?)) LIMIT 20`)
    .bind(actor.ownerUid, input.memberId, actor.memberId, now).all<{ id: string; object_key: string }>();
  for (const row of obsolete.results) {
    await bucket.delete(row.object_key);
    await db.prepare("DELETE FROM trade_message_media WHERE id = ? AND owner_uid = ? AND (state = 'retired' OR (state = 'pending' AND expires_at <= ?))").bind(row.id, actor.ownerUid, now).run();
  }
  return { id, kind: checked.kind, contentType: checked.contentType, sizeBytes: bytes.byteLength };
}

export async function readMessageMedia(db: D1Database, actor: AvatarActor, input: { id?: string; avatarMemberId?: string; revision?: string }) {
  if (input.avatarMemberId) {
    const guard = avatarGuard(actor, input.avatarMemberId, false);
    return db.prepare(`SELECT * FROM trade_message_media WHERE owner_uid = ? AND member_id = ? AND purpose = 'avatar' AND state = 'active'
      ${input.revision ? "AND id = ?" : ""} AND ${guard.sql}`).bind(actor.ownerUid, input.avatarMemberId, ...(input.revision ? [input.revision] : []), ...guard.values).first<MediaRow>();
  }
  if (!input.id) return null;
  const row = await db.prepare("SELECT * FROM trade_message_media WHERE id = ? AND owner_uid = ? AND purpose = 'message'").bind(input.id, actor.ownerUid).first<MediaRow>();
  if (!row) return null;
  const guard = messageParticipantGuard(actor, row.thread_id);
  return db.prepare(`SELECT media.* FROM trade_message_media media WHERE media.id = ? AND media.owner_uid = ? AND ${guard.sql}
    AND ((media.state = 'pending' AND media.uploader_member_id = ? AND media.expires_at > ?) OR (media.state = 'attached' AND EXISTS
      (SELECT 1 FROM trade_internal_messages message WHERE message.id = media.message_id AND message.owner_uid = media.owner_uid AND message.thread_id = media.thread_id)))`)
    .bind(input.id, actor.ownerUid, ...guard.values, actor.memberId, new Date().toISOString()).first<MediaRow>();
}

export async function deleteMessageMedia(db: D1Database, bucket: MessageMediaBucket, actor: AvatarActor, id: string) {
  const row = await db.prepare("SELECT * FROM trade_message_media WHERE id = ? AND owner_uid = ?").bind(id, actor.ownerUid).first<MediaRow>();
  if (!row) throw new Error("MESSAGE_MEDIA_NOT_FOUND");
  const guard = row.purpose === "avatar" ? avatarGuard(actor, row.member_id, true) : messageParticipantGuard(actor, row.thread_id);
  const result = await db.prepare(`DELETE FROM trade_message_media WHERE id = ? AND owner_uid = ? AND ${guard.sql}
    AND (purpose = 'avatar' OR (state = 'pending' AND uploader_member_id = ?))`).bind(id, actor.ownerUid, ...guard.values, actor.memberId).run();
  if (!result.meta.changes) throw new Error("MESSAGE_ACCESS_REQUIRED");
  await bucket.delete(row.object_key);
}

export async function teamAvatarRevisions(db: D1Database, actor: Actor) {
  const guard = messageActorGuard(actor);
  const visibility = messageMemberVisibilityGuard(actor, "member.id", "conversation");
  const rows = await db.prepare(`SELECT media.member_id, media.id FROM trade_message_media media JOIN trade_team_members member
    ON member.id = media.member_id AND member.owner_uid = media.owner_uid AND member.status = 'active'
    WHERE media.owner_uid = ? AND media.purpose = 'avatar' AND media.state = 'active' AND ${guard.sql} AND ${visibility.sql}`).bind(actor.ownerUid, ...guard.values, ...visibility.values).all<{ member_id: string; id: string }>();
  return Object.fromEntries(rows.results.map(row => [row.member_id, row.id]));
}
