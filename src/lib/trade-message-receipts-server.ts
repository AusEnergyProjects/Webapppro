import { messageParticipantGuard } from "./trade-message-media-access";
import type { MessageActor } from "./trade-messages-server";
import type { TradeMessageReceipt, TradeMessageRecipientReceipt } from "./trade-message-receipts";

export async function acknowledgeTeamMessages(db: D1Database, actor: MessageActor, threadId: string, through: unknown, read: boolean) {
  if (typeof through !== "number" || !Number.isSafeInteger(through) || through < 0) throw new Error("MESSAGE_CURSOR_INVALID");
  const guard = messageParticipantGuard(actor, threadId);
  const now = new Date().toISOString();
  const range = `? <= COALESCE((SELECT MAX(sequence) FROM trade_internal_messages WHERE thread_id=? AND owner_uid=?),0)`;
  const results = await db.batch([
    ...(!read ? [db.prepare(`UPDATE trade_message_receipts SET delivered_at=?
      WHERE owner_uid=? AND thread_id=? AND member_id=? AND ${guard.sql} AND ${range}
        AND legacy_read=0 AND delivered_at=''
        AND message_id IN (SELECT id FROM trade_internal_messages WHERE thread_id=? AND owner_uid=? AND sequence<=?)`)
      .bind(now, actor.ownerUid, threadId, actor.memberId, ...guard.values, through, threadId, actor.ownerUid,
        threadId, actor.ownerUid, through)] : []),
    // The guarded participant update proves authority in the same transaction,
    // including an empty/duplicate delivery ACK. Delivery does not change unread.
    // Read advancement captures its first timestamp in the database trigger.
    db.prepare(`UPDATE trade_message_participants SET last_read_sequence=${read ? "MAX(last_read_sequence,?)" : "last_read_sequence"}
      WHERE thread_id=? AND owner_uid=? AND member_id=? AND ${guard.sql} AND ${range}`)
      .bind(...(read ? [through] : []), threadId, actor.ownerUid, actor.memberId, ...guard.values, through, threadId, actor.ownerUid),
  ]);
  if (!results[results.length - 1].meta.changes) throw new Error("MESSAGE_ACCESS_REQUIRED");
}

type ReceiptRow = { message_id: string; member_id: string; recipient_name: string; delivered_at: string; read_at: string; legacy_read: number };

export async function loadMessageReceipts(db: D1Database, actor: MessageActor, threadId: string,
  messages: Array<{ id: string; actor_member_id: string }>): Promise<Record<string, TradeMessageReceipt>> {
  const ids = messages.filter(message => message.actor_member_id === actor.memberId).map(message => message.id);
  if (!ids.length) return {};
  const guard = messageParticipantGuard(actor, threadId);
  const rows = (await db.prepare(`SELECT receipt.message_id,receipt.member_id,receipt.recipient_name,receipt.delivered_at,receipt.read_at,receipt.legacy_read
    FROM trade_message_receipts receipt
    JOIN trade_internal_messages message ON message.id=receipt.message_id AND message.owner_uid=receipt.owner_uid AND message.thread_id=receipt.thread_id
    WHERE receipt.owner_uid=? AND receipt.thread_id=? AND message.actor_member_id=? AND message.id IN (${ids.map(() => "?").join(",")})
      AND ${guard.sql} ORDER BY receipt.recipient_name,receipt.member_id`)
    .bind(actor.ownerUid, threadId, actor.memberId, ...ids, ...guard.values).all<ReceiptRow>()).results;
  const byMessage = new Map<string, TradeMessageRecipientReceipt[]>();
  for (const row of rows) {
    const recipients = byMessage.get(row.message_id) || [];
    recipients.push({ memberId: row.member_id, name: row.recipient_name,
      status: row.legacy_read || row.read_at ? "read" : row.delivered_at ? "delivered" : "sent",
      deliveredAt: row.delivered_at || null, readAt: row.read_at || null });
    byMessage.set(row.message_id, recipients);
  }
  return Object.fromEntries(ids.map(id => {
    const recipients = byMessage.get(id) || [];
    const recipientCount = recipients.length;
    const deliveredCount = recipients.filter(person => person.status !== "sent").length;
    const readCount = recipients.filter(person => person.status === "read").length;
    const latestKnown = (key: "deliveredAt" | "readAt") => recipientCount && recipients.every(person => person[key])
      ? recipients.map(person => person[key]!).sort().at(-1)! : null;
    const receipt: TradeMessageReceipt = {
      status: recipientCount && readCount === recipientCount ? "read" : recipientCount && deliveredCount === recipientCount ? "delivered" : "sent",
      recipientCount, deliveredCount, readCount, deliveredAt: latestKnown("deliveredAt"), readAt: latestKnown("readAt"), recipients,
    };
    return [id, receipt];
  }));
}
