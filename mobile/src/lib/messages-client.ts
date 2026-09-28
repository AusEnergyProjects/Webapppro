import { randomUUID } from 'expo-crypto';

import { ApiError, apiRequest } from '@/lib/api';

export type MessageMember = { id: string; name: string; active?: boolean; isOwner?: boolean; avatarRevision?: string };
export type TeamThread = { id: string; kind: string; subject: string; latest: string; latestSender: string; unread: number; members: MessageMember[] };
export type CustomerThread = { customerId: string; name: string; workOrderId: string; jobNumber: string; latest: string; phone: string };
export type MessageAttachment = { id: string; kind: 'image' | 'audio'; contentType: string; sizeBytes: number };
export type TeamMessage = { id: string; sequence: number; senderName: string; senderMemberId: string; mine: boolean; body: string; requestId: string; createdAt: string; attachments: MessageAttachment[] };
export type SmsMessage = { id: string; requestId: string; direction: 'inbound' | 'outbound'; body: string; status: string; createdAt: string; workOrderId: string; senderName: string };
export type MessageOverview = { memberId: string; canUseSms: boolean; canUseQuotes: boolean; canCreateSmsContact: boolean; canManageTeam: boolean; members: MessageMember[]; threads: TeamThread[]; hasMore: boolean };
export type MessageContacts = { members: MessageMember[]; customerThreads: CustomerThread[] };
export type SmsConversation = { connection: { number: string; status: string; accountType: string; usedSegments: number; dailyLimit: number } | null; customerPhone: string; consent: 'required' | 'allowed' | 'opted_out'; messages: SmsMessage[]; canManageConnection: boolean; jobNumber: string; jobs: { id: string; jobNumber: string }[] };
export type MessageSelection = { kind: 'team'; thread: TeamThread } | { kind: 'customer'; customer: CustomerThread };
export type PendingMessage = { requestId: string; body: string; attachmentIds: string[] };
export type MessageDraft = { body: string; attachments: MessageAttachment[]; pending: PendingMessage | null };

export function emptyMessageDraft(): MessageDraft { return { body: '', attachments: [], pending: null }; }
export function selectionKey(selection: MessageSelection) {
  return selection.kind === 'team' ? `team:${selection.thread.id}` : `customer:${selection.customer.customerId}:${selection.customer.workOrderId}`;
}
export function teamThreadName(thread: TeamThread, memberId: string) {
  return thread.kind === 'group' ? thread.subject : thread.members.find(member => member.id !== memberId)?.name || 'Team chat';
}
export function mergeTeamMessages(previous: TeamMessage[], incoming: TeamMessage[]) {
  return [...new Map([...previous, ...incoming].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
}
export function pendingMessage(draft: MessageDraft): PendingMessage {
  return draft.pending || { requestId: randomUUID(), body: draft.body.trim(), attachmentIds: draft.attachments.map(item => item.id).sort() };
}
export function definitiveMessageFailure(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
}
export function smsSendBlock(conversation: SmsConversation | null): string {
  if (!conversation) return 'Loading messages...';
  if (!conversation.connection) return 'Your business owner needs to connect the shared SMS number in business settings.';
  if (conversation.connection.status !== 'connected') return 'Your business owner needs to check the SMS connection.';
  if (!conversation.customerPhone) return 'This customer needs a valid Australian mobile number.';
  if (conversation.consent === 'opted_out') return 'This customer opted out. They can text START to your business number to resume.';
  if (conversation.consent !== 'allowed') return 'Record the customer’s permission for service texts below.';
  return '';
}
export const smsStatusLabels: Record<string, string> = { accepted: 'Accepted by provider', queued: 'Queued', sending: 'Sending', sent: 'Sent to carrier', delivered: 'Delivered', failed: 'Failed', undelivered: 'Not delivered', unknown: 'Delivery not confirmed', reserved: 'Preparing', received: 'Received', canceled: 'Cancelled' };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await apiRequest<T & { ok: boolean }>(path, init);
  if (!result.ok) throw new Error('Messages could not be loaded. Try again.');
  return result;
}
export function messagesOverview(search: string, page = 1, signal?: AbortSignal) {
  return request<MessageOverview>(`/api/trade-messages?search=${encodeURIComponent(search)}&page=${page}`, { signal });
}
export function customerThreads(search: string, page = 1, signal?: AbortSignal) {
  return request<{ customerThreads: CustomerThread[]; hasMore: boolean }>(`/api/trade-messages?view=customers&search=${encodeURIComponent(search)}&page=${page}`, { signal });
}
export function messageContacts(search: string, signal?: AbortSignal) {
  return request<MessageContacts>(`/api/trade-messages?view=contacts&search=${encodeURIComponent(search)}`, { signal });
}
export function messageThread(threadId: string, signal?: AbortSignal) {
  return request<{ thread: TeamThread }>(`/api/trade-messages?view=thread&threadId=${encodeURIComponent(threadId)}`, { signal });
}
export function teamHistory(threadId: string, before = 0, signal?: AbortSignal) {
  return request<{ messages: TeamMessage[]; hasOlder: boolean }>(`/api/trade-messages?threadId=${encodeURIComponent(threadId)}&before=${before}`, { signal });
}
export function teamAction<T>(body: Record<string, unknown>, signal?: AbortSignal) {
  return request<T>('/api/trade-messages', { method: 'POST', body: JSON.stringify(body), signal });
}
export function smsHistory(customer: CustomerThread, signal?: AbortSignal) {
  return request<SmsConversation>(`/api/trade-sms?customerId=${encodeURIComponent(customer.customerId)}&workOrderId=${encodeURIComponent(customer.workOrderId)}`, { signal });
}
export function smsAction<T>(customer: CustomerThread, body: Record<string, unknown>, signal?: AbortSignal) {
  return request<T>('/api/trade-sms', { method: 'POST', body: JSON.stringify({ ...body, customerId: customer.customerId, workOrderId: customer.workOrderId }), signal });
}
export function nativeMessageUploadPart(file: Blob & { bytes(): Promise<Uint8Array<ArrayBuffer>> }, name: string, type: string) {
  // Expo fetch consumes bytes() directly. Avoid RN Blob construction (including File.slice),
  // and supply audio/mp4 explicitly because devices disagree on the .m4a MIME type.
  return { size: file.size, type, name, bytes: () => file.bytes(), arrayBuffer: () => file.arrayBuffer(), text: () => file.text(), stream: () => file.stream(), slice: (start?: number, end?: number, contentType?: string) => file.slice(start, end, contentType) } satisfies Blob & { name: string };
}
export async function uploadMessageAttachment(threadId: string, file: Blob, fileName: string, signal?: AbortSignal) {
  const form = new FormData();
  form.append('purpose', 'message'); form.append('threadId', threadId); form.append('file', file, fileName);
  return request<{ attachment: MessageAttachment }>('/api/trade-message-media', { method: 'POST', body: form, signal });
}
