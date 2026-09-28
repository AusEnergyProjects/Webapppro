import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { messageRequestId, teamMessageBody, teamThreadInput } from "./trade-messages";
import { messageActorGuard as actorGuard, messageParticipantGuard as participantGuard } from "./trade-message-media-access";
import { loadMessageAttachments, messageAttachmentStatements, teamAvatarRevisions } from "./trade-message-media-server";
import { messageAttachmentIds, type MessageAttachment } from "./trade-message-media";

export type MessageActor = Pick<TeamAccess, "ownerUid" | "actorUid" | "memberId" | "displayName" | "isOwner" | "canSendSms" | "fieldSessionId"> & { canViewQuotes?: boolean; canManageTeam?: boolean };
type Thread = { id: string; kind: "dm" | "group"; subject: string; creation_hash: string };
type InternalMessage = { id: string; sequence: number; actor_member_id: string; actor_name: string; body: string; request_id: string; thread_id: string; created_at: string };

async function assertGuard(db: D1Database, guard: ReturnType<typeof actorGuard>) {
  if (!await db.prepare(`SELECT 1 allowed WHERE ${guard.sql}`).bind(...guard.values).first()) throw new Error("MESSAGE_ACCESS_REQUIRED");
}

function publicMessage(row: InternalMessage, actorMemberId: string, attachments: MessageAttachment[] = []) {
  return { id: row.id, sequence: row.sequence, senderName: row.actor_name, mine: row.actor_member_id === actorMemberId,
    senderMemberId: row.actor_member_id, body: row.body, requestId: row.request_id, createdAt: row.created_at, attachments };
}

async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createTeamConversation(actor: MessageActor, input: { memberIds?: unknown; subject?: unknown; requestId?: unknown }, db: D1Database = getD1()) {
  const requestId = messageRequestId(input.requestId);
  const parsed = teamThreadInput(input, actor.memberId);
  const guard = actorGuard(actor);
  await assertGuard(db, guard);
  const contentHash = await hash(JSON.stringify(parsed));
  const prior = await db.prepare("SELECT * FROM trade_message_threads WHERE owner_uid = ? AND created_by_member_id = ? AND request_id = ?")
    .bind(actor.ownerUid, actor.memberId, requestId).first<Thread>();
  if (prior && prior.creation_hash !== contentHash) throw new Error("MESSAGE_REQUEST_CONFLICT");
  const placeholders = parsed.memberIds.map(() => "?").join(",");
  const membersSql = `(SELECT COUNT(*) FROM trade_team_members WHERE owner_uid = ? AND status = 'active' AND id IN (${placeholders})) = ?`;
  const membersValues = [actor.ownerUid, ...parsed.memberIds, parsed.memberIds.length];
  const id = prior?.id || `thread-${await hash(JSON.stringify(parsed.kind === "dm" ? [actor.ownerUid, parsed.dmKey] : [actor.ownerUid, actor.memberId, requestId]))}`;
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_message_threads (id, owner_uid, kind, subject, dm_key, created_by_member_id, request_id, creation_hash, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql} AND ${membersSql}`)
      .bind(id, actor.ownerUid, parsed.kind, parsed.subject, parsed.dmKey, actor.memberId, requestId, contentHash, now, now, ...guard.values, ...membersValues),
    ...parsed.memberIds.map(memberId => db.prepare(`INSERT OR IGNORE INTO trade_message_participants (thread_id, owner_uid, member_id)
      SELECT id, owner_uid, ? FROM trade_message_threads WHERE id = ? AND owner_uid = ? AND creation_hash = ? AND ${guard.sql} AND ${membersSql}`)
      .bind(memberId, id, actor.ownerUid, contentHash, ...guard.values, ...membersValues)),
  ]);
  const result = await db.prepare(`SELECT t.id, t.kind, t.subject, t.creation_hash FROM trade_message_threads t
    WHERE t.id = ? AND t.owner_uid = ? AND ${participantGuard(actor, id).sql}`)
    .bind(id, actor.ownerUid, ...participantGuard(actor, id).values).first<Thread>();
  if (!result || (!results[0].meta.changes && result.creation_hash !== contentHash)) throw new Error("MESSAGE_MEMBERS_INVALID");
  return { id: result.id, kind: result.kind, subject: result.subject };
}

export async function sendTeamMessage(actor: MessageActor, threadId: string, value: unknown, requestValue: unknown, db: D1Database = getD1(), attachmentValue: unknown = []) {
  const ids = messageAttachmentIds(attachmentValue);
  const requestId = messageRequestId(requestValue), body = teamMessageBody(value, ids.length > 0);
  const guard = participantGuard(actor, threadId);
  await assertGuard(db, guard);
  const prior = await db.prepare("SELECT * FROM trade_internal_messages WHERE owner_uid = ? AND actor_member_id = ? AND request_id = ?")
    .bind(actor.ownerUid, actor.memberId, requestId).first<InternalMessage>();
  if (prior && (prior.thread_id !== threadId || prior.body !== body)) throw new Error("MESSAGE_REQUEST_CONFLICT");
  if (prior) {
    const attachments = (await loadMessageAttachments(db, actor, threadId, [prior.id]))[prior.id] || [];
    if (JSON.stringify(attachments.map(item => item.id).sort()) !== JSON.stringify(ids)) throw new Error("MESSAGE_REQUEST_CONFLICT");
    await assertGuard(db, guard);
    return publicMessage(prior, actor.memberId, attachments);
  }
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const media = messageAttachmentStatements(db, actor, threadId, id, ids);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_internal_messages (id, owner_uid, thread_id, sequence, actor_member_id, actor_name, body, request_id, created_at)
      SELECT ?, ?, ?, COALESCE((SELECT MAX(sequence) FROM trade_internal_messages WHERE thread_id = ? AND owner_uid = ?), 0) + 1, ?, ?, ?, ?, ?
      WHERE ${guard.sql} AND ${media.guard.sql}`)
      .bind(id, actor.ownerUid, threadId, threadId, actor.ownerUid, actor.memberId, actor.displayName, body, requestId, now, ...guard.values, ...media.guard.values),
    ...media.statements,
    db.prepare(`UPDATE trade_message_threads SET updated_at = ? WHERE id = ? AND owner_uid = ? AND EXISTS (SELECT 1 FROM trade_internal_messages WHERE id = ?)`)
      .bind(now, threadId, actor.ownerUid, id),
  ]);
  const saved = await db.prepare(`SELECT * FROM trade_internal_messages WHERE owner_uid = ? AND actor_member_id = ? AND request_id = ? AND ${guard.sql}`)
    .bind(actor.ownerUid, actor.memberId, requestId, ...guard.values).first<InternalMessage>();
  if (!saved) throw new Error("MESSAGE_ACCESS_REQUIRED");
  if (saved.thread_id !== threadId || saved.body !== body) throw new Error("MESSAGE_REQUEST_CONFLICT");
  const attachments = await loadMessageAttachments(db, actor, threadId, [saved.id]);
  if (JSON.stringify((attachments[saved.id] || []).map(item => item.id).sort()) !== JSON.stringify(ids)) throw new Error("MESSAGE_REQUEST_CONFLICT");
  return publicMessage(saved, actor.memberId, attachments[saved.id] || []);
}

export async function teamConversation(actor: MessageActor, threadId: string, before = 0, db: D1Database = getD1()) {
  const guard = participantGuard(actor, threadId);
  await assertGuard(db, guard);
  if (!Number.isSafeInteger(before) || before < 0) throw new Error("MESSAGE_CURSOR_INVALID");
  const messages = (await db.prepare(`SELECT * FROM trade_internal_messages WHERE thread_id = ? AND owner_uid = ?
    ${before ? "AND sequence < ?" : ""} AND ${guard.sql} ORDER BY sequence DESC LIMIT 41`)
    .bind(threadId, actor.ownerUid, ...(before ? [before] : []), ...guard.values).all<InternalMessage>()).results;
  const hasOlder = messages.length > 40;
  const page = messages.slice(0, 40).reverse();
  const attachments = await loadMessageAttachments(db, actor, threadId, page.map(message => message.id));
  return { messages: page.map(row => publicMessage(row, actor.memberId, attachments[row.id] || [])), hasOlder };
}

export async function readTeamConversation(actor: MessageActor, threadId: string, through: unknown, db: D1Database = getD1()) {
  if (typeof through !== "number" || !Number.isSafeInteger(through) || through < 0) throw new Error("MESSAGE_CURSOR_INVALID");
  const guard = participantGuard(actor, threadId);
  const result = await db.prepare(`UPDATE trade_message_participants SET last_read_sequence = MAX(last_read_sequence, ?)
    WHERE thread_id = ? AND owner_uid = ? AND member_id = ? AND ? <= COALESCE((SELECT MAX(sequence) FROM trade_internal_messages WHERE thread_id = ? AND owner_uid = ?), 0)
      AND ${guard.sql}`).bind(through, threadId, actor.ownerUid, actor.memberId, through, threadId, actor.ownerUid, ...guard.values).run();
  if (!result.meta.changes) throw new Error("MESSAGE_ACCESS_REQUIRED");
}

export async function messagesWorkspace(actor: MessageActor, search = "", page = 1, db: D1Database = getD1(), targetThreadId = "") {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error("MESSAGE_CURSOR_INVALID");
  const guard = actorGuard(actor);
  await assertGuard(db, guard);
  if (targetThreadId) await assertGuard(db, participantGuard(actor, targetThreadId));
  const term = `%${search.trim().slice(0, 100).replace(/[!%_]/g, character => `!${character}`)}%`;
  const members = (await db.prepare(`SELECT id, display_name, member_uid FROM trade_team_members WHERE owner_uid = ? AND status = 'active' AND ${guard.sql} ORDER BY display_name LIMIT 250`)
    .bind(actor.ownerUid, ...guard.values).all<{ id: string; display_name: string; member_uid: string }>()).results;
  const threads = (await db.prepare(`SELECT t.id, t.kind, t.subject,
    (SELECT m.body FROM trade_internal_messages m WHERE m.thread_id=t.id AND m.owner_uid=t.owner_uid ORDER BY sequence DESC LIMIT 1) latest,
    (SELECT m.actor_name FROM trade_internal_messages m WHERE m.thread_id=t.id AND m.owner_uid=t.owner_uid ORDER BY sequence DESC LIMIT 1) latest_sender,
    (SELECT COUNT(*) FROM trade_internal_messages m WHERE m.thread_id=t.id AND m.owner_uid=t.owner_uid AND m.sequence>p.last_read_sequence AND m.actor_member_id<>?) unread,
    (SELECT json_group_array(json_object('id', other.id, 'name', other.display_name, 'active', other.status='active')) FROM trade_message_participants tp
      JOIN trade_team_members other ON other.id=tp.member_id AND other.owner_uid=tp.owner_uid WHERE tp.thread_id=t.id AND tp.owner_uid=t.owner_uid) members
    FROM trade_message_threads t JOIN trade_message_participants p ON p.thread_id=t.id AND p.owner_uid=t.owner_uid AND p.member_id=?
    WHERE t.owner_uid=? AND ${guard.sql} ${targetThreadId ? "AND t.id=?" : ""} AND (t.subject LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM trade_message_participants tp
      JOIN trade_team_members person ON person.id=tp.member_id AND person.owner_uid=tp.owner_uid WHERE tp.thread_id=t.id AND tp.owner_uid=t.owner_uid AND person.display_name LIKE ? ESCAPE '!'))
    ORDER BY t.updated_at DESC,t.id DESC LIMIT 51 OFFSET ?`)
    .bind(actor.memberId, actor.memberId, actor.ownerUid, ...guard.values, ...(targetThreadId ? [targetThreadId] : []), term, term, (page - 1) * 50)
    .all<{ id: string; kind: string; subject: string; latest: string; latest_sender: string; unread: number; members: string }>()).results;
  const avatars = await teamAvatarRevisions(db, actor);
  return { memberId: actor.memberId, canUseSms: actor.isOwner || Boolean(actor.canSendSms), canUseQuotes: actor.isOwner || Boolean(actor.canViewQuotes), canCreateSmsContact: actor.isOwner, canManageTeam: actor.isOwner || Boolean(actor.canManageTeam),
    members: members.map(member => ({ id: member.id, name: member.display_name, isOwner: member.member_uid === actor.ownerUid, avatarRevision: avatars[member.id] || "" })),
    threads: threads.slice(0, 50).map(thread => ({ id: thread.id, kind: thread.kind, subject: thread.subject, latest: thread.latest || "", latestSender: thread.latest_sender || "",
      unread: Number(thread.unread), members: (JSON.parse(thread.members) as Array<{ id: string; name: string; active: boolean }>).map(member => ({ ...member, active: Boolean(member.active), avatarRevision: avatars[member.id] || "" })) })), hasMore: threads.length > 50 };
}

export async function customerMessageThreads(actor: MessageActor, search = "", page = 1, db: D1Database = getD1()) {
  if (!actor.isOwner && !actor.canSendSms && !actor.canViewQuotes) throw new Error("MESSAGE_SMS_ACCESS_REQUIRED");
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error("MESSAGE_CURSOR_INVALID");
  const guard = actorGuard(actor);
  await assertGuard(db, guard);
  const term = `%${search.trim().slice(0, 100).replace(/[!%_]/g, character => `!${character}`)}%`;
  const digits = /^[+\d().\s-]+$/.test(search) ? search.replace(/\D/g, "") : "";
  const phoneTerm = digits.length >= 3 ? `%${digits.startsWith("04") ? "614" + digits.slice(2) : digits}%` : term;
  const label = "COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), NULLIF(c.business_name, ''), 'Customer')";
  const rows = actor.isOwner || actor.canSendSms ? (await db.prepare(`SELECT c.id customer_id, ${label} name, c.phone,
    ${actor.isOwner ? "'' work_order_id, '' work_number" : "w.id work_order_id, w.work_number"},
    (SELECT body FROM trade_sms_messages sms WHERE sms.firebase_uid=c.firebase_uid AND sms.customer_id=c.id
      ${actor.isOwner ? "" : "AND sms.work_order_id=w.id"} ORDER BY sms.created_at DESC,sms.id DESC LIMIT 1) latest,
    (SELECT MAX(created_at) FROM trade_sms_messages sms WHERE sms.firebase_uid=c.firebase_uid AND sms.customer_id=c.id
      ${actor.isOwner ? "" : "AND sms.work_order_id=w.id"}) latest_at
    FROM trade_crm_customers c ${actor.isOwner ? "" : `JOIN trade_crm_job_details d ON d.crm_customer_id=c.id AND d.firebase_uid=c.firebase_uid
      JOIN trade_work_orders w ON w.id=d.work_order_id AND w.firebase_uid=d.firebase_uid
      JOIN trade_team_members staff ON staff.id=? AND staff.owner_uid=c.firebase_uid AND staff.status='active' AND staff.can_send_sms=1
        AND (staff.job_scope='team' OR w.assignee_member_id=staff.id)`}
    WHERE c.firebase_uid=? AND c.record_status='active' AND trim(c.phone)<>'' AND ${guard.sql}
      ${actor.isOwner ? "" : "AND w.partner_type='installer' AND w.record_status='active' AND w.source_type<>'opportunity' AND d.customer_source<>'platform_private'"}
      AND (${label} LIKE ? ESCAPE '!' OR c.business_name LIKE ? ESCAPE '!' OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE WHEN substr(c.phone,1,2)='04' THEN '614'||substr(c.phone,3) ELSE c.phone END,' ',''),'-',''),'(',''),')',''),'+','') LIKE ? ESCAPE '!' ${actor.isOwner ? "" : "OR w.work_number LIKE ? ESCAPE '!'"})
    ORDER BY latest_at DESC,name,c.id ${actor.isOwner ? "" : ",w.id"} LIMIT 51 OFFSET ?`)
    .bind(...(actor.isOwner ? [] : [actor.memberId]), actor.ownerUid, ...guard.values, term, term, phoneTerm, ...(actor.isOwner ? [] : [term]), (page - 1) * 50)
    .all<{ customer_id: string; name: string; phone: string; work_order_id: string; work_number: string; latest: string }>()).results : [];
  const questions = actor.isOwner || actor.canViewQuotes ? (await db.prepare(`SELECT q.id,q.work_order_id,w.work_number,q.question,q.status,q.asked_at
    FROM trade_crm_quote_questions q JOIN trade_work_orders w ON w.id=q.work_order_id AND w.firebase_uid=q.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    ${actor.isOwner ? "" : "JOIN trade_team_members staff ON staff.id=? AND staff.owner_uid=w.firebase_uid AND staff.status='active' AND staff.can_view_quotes=1 AND (staff.job_scope='team' OR w.assignee_member_id=staff.id)"}
    WHERE q.firebase_uid=? AND w.record_status='active' AND w.partner_type='installer' AND w.source_type<>'opportunity' AND d.customer_source<>'platform_private'
      AND ${guard.sql} AND (w.work_number LIKE ? ESCAPE '!' OR q.question LIKE ? ESCAPE '!')
    ORDER BY q.status='open' DESC,q.asked_at DESC,q.id DESC LIMIT 50 OFFSET ?`)
    .bind(...(actor.isOwner ? [] : [actor.memberId]), actor.ownerUid, ...guard.values, term, term, (page - 1) * 50)
    .all<{ id: string; work_order_id: string; work_number: string; question: string; status: string; asked_at: string }>()).results : [];
  return { customerThreads: rows.slice(0, 50).map(row => ({ customerId: row.customer_id, name: row.name, workOrderId: row.work_order_id, jobNumber: row.work_number,
    latest: row.latest || "", phone: row.phone })), hasMore: rows.length > 50 || questions.length === 50,
    questions: questions.map(row => ({ id: row.id, workOrderId: row.work_order_id, jobNumber: row.work_number, question: row.question, status: row.status, askedAt: row.asked_at })) };
}

export async function searchMessageContacts(actor: MessageActor, search: string, db: D1Database = getD1()) {
  const guard = actorGuard(actor); await assertGuard(db, guard);
  const value = search.trim().slice(0, 100);
  const term = `%${value.replace(/[!%_]/g, character => `!${character}`)}%`;
  const digits = /^[+\d().\s-]+$/.test(value) ? value.replace(/\D/g, "") : "";
  const phoneTerm = digits.length >= 3 ? `%${digits.startsWith("04") ? "614" + digits.slice(2) : digits}%` : term;
  const people = (await db.prepare(`SELECT id,display_name,member_uid FROM trade_team_members WHERE owner_uid=? AND status='active' AND id<>?
    AND ${guard.sql} AND (display_name LIKE ? ESCAPE '!' OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE WHEN substr(phone,1,2)='04' THEN '614'||substr(phone,3) ELSE phone END,' ',''),'-',''),'(',''),')',''),'+','') LIKE ? ESCAPE '!')
    ORDER BY display_name,id LIMIT 50`).bind(actor.ownerUid, actor.memberId, ...guard.values, term, phoneTerm)
    .all<{ id: string; display_name: string; member_uid: string }>()).results;
  const customers = actor.isOwner || actor.canSendSms ? await customerMessageThreads(actor, value, 1, db) : { customerThreads: [] };
  const avatars = await teamAvatarRevisions(db, actor);
  return { members: people.map(person => ({ id: person.id, name: person.display_name, isOwner: person.member_uid === actor.ownerUid, avatarRevision: avatars[person.id] || "" })), customerThreads: customers.customerThreads };
}
