import type { TeamAccess } from "./trade-team-server";
import type { CustomerProjectEvidenceBucket } from "./customer-project-evidence-bucket";
import { messageActorGuard, messageParticipantGuard } from "./trade-message-media-access";
import { messageLinks, savedMessageSource, type SavedMessageJobFile, type SavedMessageSource } from "./trade-message-job-files";

type Bucket = Pick<CustomerProjectEvidenceBucket, "get" | "put" | "delete">;
type Message = { id: string; body: string; actor_member_id: string; actor_name: string; created_at: string; thread_name: string };
type Media = { id: string; kind: "image" | "audio"; content_type: string; size_bytes: number; object_key: string };
type Job = { id: string; work_number: string; revision: number; assignee_member_id: string };

export class MessageJobFileError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(value)) throw new MessageJobFileError(400, "Choose a message and job.");
  return value;
}

function jobGuard(actor: TeamAccess, write: boolean) {
  const active = messageActorGuard(actor);
  // Match assignedJob's owner/business/assignment scope and check current permissions at every write.
  return { sql: `${active.sql} AND work.firebase_uid = ? AND work.partner_type = 'installer' AND work.work_type = 'job'
    AND work.record_status = 'active' AND EXISTS (SELECT 1 FROM trade_team_members saver
      WHERE saver.id = ? AND saver.owner_uid = work.firebase_uid
      AND (saver.member_uid = saver.owner_uid OR (saver.can_view_field_evidence = 1 ${write ? "AND saver.can_manage_field_evidence = 1" : ""}))
      AND (saver.member_uid = saver.owner_uid OR saver.job_scope = 'team' OR work.assignee_member_id = saver.id))`,
  values: [...active.values, actor.ownerUid, actor.memberId] };
}

async function jobAccess(db: D1Database, actor: TeamAccess, id: string, write: boolean) {
  const guard = jobGuard(actor, write);
  const job = await db.prepare(`SELECT work.id, work.work_number, work.revision, work.assignee_member_id
    FROM trade_work_orders work WHERE work.id = ? AND ${guard.sql}`).bind(id, ...guard.values).first<Job>();
  if (!job) throw new MessageJobFileError(403, "You do not have access to save or view files for this job.");
  return job;
}

async function messageAccess(db: D1Database, actor: TeamAccess, threadId: string, messageId: string) {
  const guard = messageParticipantGuard(actor, threadId);
  const row = await db.prepare(`SELECT message.id, message.body, message.actor_member_id, message.actor_name, message.created_at,
    CASE WHEN thread.subject <> '' THEN thread.subject ELSE 'Team conversation' END thread_name
    FROM trade_internal_messages message JOIN trade_message_threads thread ON thread.id = message.thread_id AND thread.owner_uid = message.owner_uid
    WHERE message.id = ? AND message.thread_id = ? AND message.owner_uid = ? AND ${guard.sql}`)
    .bind(messageId, threadId, actor.ownerUid, ...guard.values).first<Message>();
  if (!row) throw new MessageJobFileError(403, "You do not have access to this message.");
  return row;
}

export async function searchMessageSaveJobs(db: D1Database, actor: TeamAccess, input: { threadId: unknown; messageId: unknown; search: unknown }) {
  await messageAccess(db, actor, identifier(input.threadId), identifier(input.messageId));
  if (!actor.canManageFieldEvidence || !actor.canViewFieldEvidence) throw new MessageJobFileError(403, "Your access does not allow saving job files.");
  const term = typeof input.search === "string" ? input.search.trim().slice(0, 80) : "";
  if (!term) return [];
  const guard = jobGuard(actor, true);
  const rows = await db.prepare(`SELECT work.id, work.work_number FROM trade_work_orders work
    WHERE ${guard.sql} AND work.work_number LIKE ? ESCAPE '!' ORDER BY work.work_number LIMIT 20`)
    .bind(...guard.values, `%${term.replace(/[!%_]/g, value => `!${value}`)}%`).all<Job>();
  return rows.results.map(row => ({ id: row.id, jobNumber: row.work_number }));
}

export async function listSavedMessageJobFiles(db: D1Database, actor: TeamAccess, workOrderId: unknown): Promise<SavedMessageJobFile[]> {
  const id = identifier(workOrderId);
  await jobAccess(db, actor, id, false);
  const guard = jobGuard(actor, false);
  const rows = await db.prepare(`SELECT media.id, media.file_name, media.content_type, media.size_bytes, media.evidence_envelope
    FROM trade_crm_job_media media JOIN trade_work_orders work ON work.id = media.work_order_id AND work.firebase_uid = media.firebase_uid
    WHERE work.id = ? AND media.source = 'team_chat' AND ${guard.sql} ORDER BY media.created_at DESC, media.id LIMIT 500`)
    .bind(id, ...guard.values).all<{ id: string; file_name: string; content_type: string; size_bytes: number; evidence_envelope: string }>();
  return rows.results.map(row => ({ id: row.id, fileName: row.file_name, contentType: row.content_type,
    sizeBytes: row.size_bytes, source: savedMessageSource(row.evidence_envelope) }));
}

async function digest(value: Uint8Array) {
  const exact = new Uint8Array(value.byteLength); exact.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", exact.buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function saveMessageToJob(db: D1Database, bucket: Bucket, actor: TeamAccess,
  input: { threadId: unknown; messageId: unknown; workOrderId: unknown }) {
  const threadId = identifier(input.threadId), messageId = identifier(input.messageId), workOrderId = identifier(input.workOrderId);
  if (!actor.canManageFieldEvidence || !actor.canViewFieldEvidence) throw new MessageJobFileError(403, "Your access does not allow saving job files.");
  const message = await messageAccess(db, actor, threadId, messageId);
  await jobAccess(db, actor, workOrderId, true);
  const attachments = (await db.prepare(`SELECT id, kind, content_type, size_bytes, object_key FROM trade_message_media
    WHERE owner_uid = ? AND thread_id = ? AND message_id = ? AND purpose = 'message' AND state = 'attached' ORDER BY id LIMIT 4`)
    .bind(actor.ownerUid, threadId, messageId).all<Media>()).results;
  const items = [...messageLinks(message.body).map(url => ({ key: url, url, media: null })),
    ...attachments.map(media => ({ key: media.id, url: "", media }))];
  if (!items.length) throw new MessageJobFileError(400, "This message has no links or attachments to save.");
  let saved = 0;
  for (const item of items) {
    const id = `chat-${await digest(new TextEncoder().encode(JSON.stringify([actor.ownerUid, workOrderId, messageId, item.key])))}`;
    if (await db.prepare("SELECT id FROM trade_crm_job_media WHERE id = ? AND firebase_uid = ? AND work_order_id = ?")
      .bind(id, actor.ownerUid, workOrderId).first()) continue;
    const now = new Date().toISOString();
    const source: SavedMessageSource = { source: "team_chat", threadId, threadName: message.thread_name, messageId,
      senderMemberId: message.actor_member_id, senderName: message.actor_name, messageCreatedAt: message.created_at,
      savedByMemberId: actor.memberId, savedByUid: actor.actorUid, savedByName: actor.displayName, savedAt: now,
      itemKind: item.media?.kind || "link", sourceAttachmentId: item.media?.id || "", url: item.url };
    let bytes: Uint8Array;
    if (item.media) {
      const original = await bucket.get(item.media.object_key);
      if (!original) throw new MessageJobFileError(409, "An attachment is no longer available. Refresh the chat.");
      bytes = new Uint8Array(await original.arrayBuffer());
      if (bytes.byteLength !== item.media.size_bytes || bytes.byteLength > 5 * 1024 * 1024) throw new MessageJobFileError(409, "The attachment could not be verified.");
    } else {
      bytes = new TextEncoder().encode(`${item.url}\n\nShared by: ${source.senderName}\nChat: ${source.threadName}\nMessage: ${messageId}\nSent: ${source.messageCreatedAt}\nSaved by: ${source.savedByName}\nSaved: ${now}\n`);
    }
    const type = item.media?.content_type || "text/plain";
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "text/plain": "txt" })[type];
    if (!extension) throw new MessageJobFileError(409, "This attachment type cannot be saved.");
    const name = `chat-${source.itemKind}-${id.slice(-10)}.${extension}`;
    const objectKey = `crm-job-media/${actor.ownerUid}/${workOrderId}/${crypto.randomUUID()}`;
    const exact = new Uint8Array(bytes.byteLength); exact.set(bytes);
    await bucket.put(objectKey, exact.buffer, { httpMetadata: { contentType: type } });
    try {
      const job = await jobAccess(db, actor, workOrderId, true);
      const participant = messageParticipantGuard(actor, threadId), destination = jobGuard(actor, true);
      const mediaGuard = item.media ? "AND EXISTS (SELECT 1 FROM trade_message_media WHERE id = ? AND owner_uid = ? AND message_id = ? AND state = 'attached')" : "";
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO trade_crm_job_media
          (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption, source, evidence_envelope, original_sha256, created_at, updated_at)
          SELECT ?, work.id, work.firebase_uid, 'document', ?, ?, ?, ?, ?, 'team_chat', ?, ?, ?, ? FROM trade_work_orders work
          WHERE work.id = ? AND work.revision = ? AND ${destination.sql} AND ${participant.sql}
          AND EXISTS (SELECT 1 FROM trade_internal_messages WHERE id = ? AND owner_uid = ? AND thread_id = ?) ${mediaGuard}`)
          .bind(id, name, type, bytes.byteLength, objectKey, `Saved from chat: ${source.senderName}`.slice(0, 300), JSON.stringify(source), await digest(bytes), now, now,
            workOrderId, job.revision, ...destination.values, ...participant.values, messageId, actor.ownerUid, threadId,
            ...(item.media ? [item.media.id, actor.ownerUid, messageId] : [])),
        db.prepare(`INSERT OR IGNORE INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, work_order_id, firebase_uid, 'chat_file_saved', ?, ? FROM trade_crm_job_media WHERE id = ? AND object_key = ?`)
          .bind(id, `Chat ${source.itemKind} saved by ${actor.displayName}.`, now, id, objectKey),
        db.prepare(`UPDATE trade_work_orders SET revision = revision + 1, updated_at = ? WHERE id = ? AND firebase_uid = ?
          AND EXISTS (SELECT 1 FROM trade_crm_job_media WHERE id = ? AND object_key = ?)`)
          .bind(now, workOrderId, actor.ownerUid, id, objectKey),
        db.prepare(`INSERT INTO trade_team_sync_changes (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
          SELECT firebase_uid, '', 'job', id, 'upsert', revision, ? FROM trade_work_orders WHERE id = ? AND firebase_uid = ?
          AND EXISTS (SELECT 1 FROM trade_crm_job_media WHERE id = ? AND object_key = ?)`)
          .bind(now, workOrderId, actor.ownerUid, id, objectKey),
        db.prepare(`INSERT INTO trade_team_sync_changes (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
          SELECT firebase_uid, assignee_member_id, 'job', id, 'upsert', revision, ? FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND assignee_member_id <> ''
          AND EXISTS (SELECT 1 FROM trade_crm_job_media WHERE id = ? AND object_key = ?)`)
          .bind(now, workOrderId, actor.ownerUid, id, objectKey),
      ]);
      const retained = await db.prepare("SELECT object_key FROM trade_crm_job_media WHERE id = ? AND firebase_uid = ? AND work_order_id = ?")
        .bind(id, actor.ownerUid, workOrderId).first<{ object_key: string }>();
      if (retained?.object_key !== objectKey) await bucket.delete(objectKey);
      if (!retained) throw new MessageJobFileError(409, "Job access or details changed. Refresh and try again.");
      if (retained.object_key === objectKey) saved++;
    } catch (error) {
      // A failed acknowledgement may have committed. Never remove the retained copy.
      const retained = await db.prepare("SELECT object_key FROM trade_crm_job_media WHERE id = ? AND firebase_uid = ? AND work_order_id = ?")
        .bind(id, actor.ownerUid, workOrderId).first<{ object_key: string }>();
      if (retained?.object_key !== objectKey) await bucket.delete(objectKey);
      throw error;
    }
  }
  await messageAccess(db, actor, threadId, messageId);
  const job = await jobAccess(db, actor, workOrderId, true);
  return { saved, total: items.length, jobNumber: job.work_number };
}
