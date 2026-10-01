"use client";

import TradeTeamPresence from "./TradeTeamPresence";
import TradeTeamStatusDot from "./TradeTeamStatusDot";
import TradeMessageReceipt from "./TradeMessageReceipt";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { normalizeAustralianMobile } from "@/lib/service-reminder-delivery";
import TradeMessageAttachments, { TradeMessageAttachmentList } from "./TradeMessageAttachments";
import TradeTeamAvatar from "./TradeTeamAvatar";
import { TradeTeamCallButtons } from "./TradeTeamCallProvider";
import TradeNotificationSettings from "./TradeNotificationSettings";
import { useTradeMessageAlerts } from "./TradeMessageAlerts";
import TradeMessageSaveToJob from "./TradeMessageSaveToJob";
import { safeMessageLink } from "@/lib/trade-message-job-files";
import type { TradeTeamPresenceStatus } from "@/lib/trade-team-presence";
import type { TradeMessageReceipt as TeamMessageReceipt } from "@/lib/trade-message-receipts";
import type { MessageAttachment, MessageMediaAuth } from "@/lib/trade-message-media";
import styles from "./TradeMessagesWorkspace.module.css";

const TradeSmsDashboard = dynamic(() => import("./TradeSmsDashboard").then(module => module.TradeSmsDashboard), { loading: () => <p role="status">Loading SMS account...</p> });
const TradeCustomerSmsPanel = dynamic(() => import("./TradeCustomerSmsPanel").then(module => module.TradeCustomerSmsPanel), { loading: () => <p role="status">Loading customer conversation...</p> });

type Member = { id: string; name: string; isOwner?: boolean; active?: boolean; avatarRevision?: string; presence?: TradeTeamPresenceStatus | null };
type Thread = { id: string; kind: string; subject: string; latest: string; latestSender: string; unread: number; members: Member[] };
type CustomerThread = { customerId: string; name: string; workOrderId: string; jobNumber: string; latest: string; phone: string };
type QuoteQuestion = { id: string; workOrderId: string; jobNumber: string; question: string; status: string; askedAt: string };
type TeamMessage = { id: string; sequence: number; senderName: string; senderMemberId: string; mine: boolean; body: string; requestId: string; createdAt: string; attachments: MessageAttachment[]; receipt?: TeamMessageReceipt | null };
type Overview = { memberId: string; canUseSms: boolean; smsReady: boolean; smsBalanceMicro: number | null; canUseQuotes: boolean; canCreateSmsContact: boolean; canManageTeam: boolean; members: Member[]; threads: Thread[]; hasMore: boolean };
type Result = Partial<Overview> & { ok?: boolean; error?: string; id?: string; thread?: Thread; message?: TeamMessage; messages?: TeamMessage[]; hasOlder?: boolean; customerThreads?: CustomerThread[]; questions?: QuoteQuestion[] };
type RequestResult = { response: Response; result: Result };
type ApiCall = (query?: string, payload?: Record<string, unknown>, path?: string) => Promise<RequestResult>;

function threadName(thread: Thread, memberId: string) {
  return thread.kind === "group" ? thread.subject : thread.members.find(member => member.id !== memberId)?.name || "Team conversation";
}

function TeammateStatus({ thread, memberId }: { thread: Thread; memberId: string }) {
  if (thread.kind === "group") return null;
  const member = thread.members.find(person => person.id !== memberId);
  return member ? <TradeTeamStatusDot name={member.name} presence={member.presence} active={member.active} /> : null;
}

function ChatMark({ locked = false }: { locked?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={locked ? "M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3" : "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function contactInitials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?"; }

function MessageBody({ body }: { body: string }) {
  return <p>{body.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, index) => {
    const trimmed = part.replace(/[.,;!?]+$/, "");
    const href = safeMessageLink(trimmed);
    return href ? <span key={index}><a href={href} target="_blank" rel="noopener noreferrer">{trimmed}</a>{part.slice(trimmed.length)}</span> : part;
  })}</p>;
}

function useVisibleRefresh(refresh: () => Promise<void>, milliseconds = 15000) {
  useEffect(() => {
    let busy = false;
    const tick = () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true; void refresh().finally(() => { busy = false; });
    };
    const interval = window.setInterval(tick, milliseconds);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("tlink:team-presence-changed", tick);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); window.removeEventListener("tlink:team-presence-changed", tick); };
  }, [refresh, milliseconds]);
}

// Focus can arrive after the keyboard has resized the viewport. Fit the editor
// directly instead of trying to reconstruct its pre-keyboard height. Keeping the
// frame until focus leaves also avoids moving the draft when the keyboard closes.
function useConversationViewport(active: boolean) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = container.current, viewport = window.visualViewport;
    if (!active || !element) return;
    const mobile = window.matchMedia('(max-width: 760px)');
    let editor: Element | null = null;
    let frame: number | undefined;
    const clear = () => {
      delete element.dataset.keyboard;
      for (const key of ['top', 'left', 'width', 'height']) element.style.removeProperty(`--message-viewport-${key}`);
    };
    const update = () => {
      frame = undefined;
      const target = document.activeElement;
      if (!element.contains(target)) editor = null;
      else if (target?.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])')) {
        editor = target.closest('[data-message-detail]') ? target : null;
      }
      if (!mobile.matches || !editor || (viewport && viewport.scale !== 1)) { clear(); return; }
      element.dataset.keyboard = 'true';
      element.style.setProperty('--message-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      element.style.setProperty('--message-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
      element.style.setProperty('--message-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
      element.style.setProperty('--message-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    };
    const schedule = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    element.addEventListener('focusin', schedule);
    element.addEventListener('focusout', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    mobile.addEventListener('change', schedule);
    schedule();
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      element.removeEventListener('focusin', schedule);
      element.removeEventListener('focusout', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mobile.removeEventListener('change', schedule);
      clear();
    };
  }, [active]);
  return container;
}

function TeamConversation({ thread, call, memberId, onRead, getAuthHeaders, canManageTeam }: {
  thread: Thread; call: ApiCall; memberId: string; onRead: () => void; getAuthHeaders: MessageMediaAuth; canManageTeam: boolean;
}) {
  const { setActiveThread } = useTradeMessageAlerts();
  useEffect(() => { setActiveThread(thread.id); return () => setActiveThread(""); }, [thread.id, setActiveThread]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canSend, setCanSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<{ body: string; requestId: string; attachmentIds: string[] } | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const initial = useRef(true), sending = useRef(false), alive = useRef(true), refreshing = useRef(false);
  const history = useRef<HTMLOListElement>(null);
  const lastRead = useRef(0), reading = useRef(false), lastDelivered = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const merge = useCallback((next: TeamMessage[]) => setMessages(current => [...new Map([...current, ...next].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence)), []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const { response, result } = await call(`threadId=${encodeURIComponent(thread.id)}`);
      if (!response.ok && [401, 403].includes(response.status) && alive.current) { setMessages([]); setCanSend(false); }
      if (!response.ok || !result.ok || !result.messages) throw new Error(result.error || "Messages could not be loaded.");
      if (!alive.current) return;
      merge(result.messages);
      if (initial.current) { setHasOlder(Boolean(result.hasOlder)); initial.current = false; }
      const through = result.messages.at(-1)?.sequence || 0;
      if (through > lastDelivered.current) {
        const delivered = await call("", { action: "delivered", threadId: thread.id, throughSequence: through });
        if (delivered.response.ok && delivered.result.ok && alive.current) lastDelivered.current = through;
      }
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "Messages could not be refreshed."); }
    finally { refreshing.current = false; if (alive.current) setLoading(false); }
  }, [call, thread.id, merge]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useVisibleRefresh(refresh, 3000);
  const latestSequence = messages.at(-1)?.sequence;
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [latestSequence]);
  useEffect(() => {
    const list = history.current;
    if (!list || !messages.length) return;
    let disposed = false;
    const markVisibleRead = () => {
      if (disposed || !alive.current || reading.current || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const obscured = Array.from(document.querySelectorAll<HTMLElement>('dialog:modal, [aria-modal="true"]'))
        .some(modal => modal.getClientRects().length > 0 && !modal.contains(list));
      if (obscured) return;
      const viewport = list.getBoundingClientRect();
      if (!viewport.width || !viewport.height || viewport.right <= 0 || viewport.left >= window.innerWidth) return;
      const bottom = Math.min(viewport.bottom, window.innerHeight), top = Math.max(0, viewport.top);
      let through = 0;
      for (const element of list.querySelectorAll<HTMLElement>("[data-message-sequence]")) {
        const bounds = element.getBoundingClientRect();
        const left = Math.max(0, viewport.left, bounds.left), right = Math.min(window.innerWidth, viewport.right, bounds.right);
        if (bounds.bottom <= top || bounds.top >= bottom || right <= left) continue;
        const visiblePoint = document.elementFromPoint((left + right) / 2, (Math.max(top, bounds.top) + Math.min(bottom, bounds.bottom)) / 2);
        if (visiblePoint && element.contains(visiblePoint)) through = Math.max(through, Number(element.dataset.messageSequence));
      }
      if (through <= lastRead.current) return;
      reading.current = true;
      void call("", { action: "read", threadId: thread.id, throughSequence: through }).then(read => {
        if (alive.current && read.response.ok && read.result.ok) { lastRead.current = Math.max(lastRead.current, through); onRead(); }
      }).catch(() => { /* The next visible refresh retries the unconfirmed acknowledgement. */ })
        .finally(() => { reading.current = false; });
    };
    const frame = window.requestAnimationFrame(markVisibleRead);
    list.addEventListener("scroll", markVisibleRead, { passive: true });
    window.addEventListener("focus", markVisibleRead);
    document.addEventListener("visibilitychange", markVisibleRead);
    return () => { disposed = true; window.cancelAnimationFrame(frame); list.removeEventListener("scroll", markVisibleRead); window.removeEventListener("focus", markVisibleRead); document.removeEventListener("visibilitychange", markVisibleRead); };
  }, [messages, call, thread.id, onRead]);

  async function older() {
    if (sending.current || !messages.length) return;
    sending.current = true; setBusy(true);
    try {
      const { response, result } = await call(`threadId=${encodeURIComponent(thread.id)}&before=${messages[0].sequence}`);
      if (!response.ok || !result.ok || !result.messages) throw new Error(result.error || "Older messages could not be loaded.");
      if (alive.current) { merge(result.messages); setHasOlder(Boolean(result.hasOlder)); }
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "Older messages could not be loaded."); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault(); if (sending.current || mediaBusy || !canSend || (!body.trim() && !attachments.length)) return;
    const submission = pending || { requestId: crypto.randomUUID(), body: body.trim(), attachmentIds: attachments.map(item => item.id) };
    sending.current = true; setBusy(true); setPending(submission); setStatus("");
    try {
      const { response, result } = await call("", { action: "send", threadId: thread.id, ...submission });
      if (!alive.current) return;
      if (response.ok && result.ok && result.message) {
        merge([result.message]); setPending(null); setBody(""); setAttachments([]); onRead();
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        setPending(null); setStatus(result.error || "The message was not accepted.");
      } else setStatus("The result is not confirmed. Check this message to retry safely.");
    } catch { if (alive.current) setStatus("The result is not confirmed. Check this message to retry safely."); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }

  return <section className={styles.conversation} aria-label="Team conversation">
    <header className={styles.conversationHeader}><div className={styles.chatTitle}><div><span className={styles.channelLabel}>Team conversation</span><h3><TeammateStatus thread={thread} memberId={memberId} /> {threadName(thread, memberId)}</h3></div><TradeTeamCallButtons threadId={thread.id} /></div><details className={styles.conversationInfo}><summary>{thread.members.length} participants · Private chat</summary><div className={styles.memberAvatars}>{thread.members.map(member => <span className={styles.participant} key={member.id}><TradeTeamAvatar memberId={member.id} name={member.name} revision={member.avatarRevision} editable={member.active !== false && (member.id === memberId || canManageTeam)} getAuthHeaders={getAuthHeaders} onChange={onRead} /><span>{member.name}<TradeTeamStatusDot name={member.name} presence={member.presence} active={member.active} label /></span></span>)}</div><small>Only people in this chat can see these messages.</small></details></header>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {hasOlder && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void older()}>Load older messages</button>}
    <ol ref={history} className={styles.messages} aria-live="polite" aria-label="Team message history">
      {loading && <li className={styles.empty}>Loading messages...</li>}
      {!loading && !messages.length && <li className={styles.empty}>Start the conversation with your team.</li>}
      {messages.map(message => <li key={message.id} data-message-sequence={message.sequence} className={message.mine ? styles.mine : styles.theirs}>{!message.mine && <strong className={styles.senderName}>{message.senderName}</strong>}<div className={styles.bubble}>{message.body && <MessageBody body={message.body} />}{message.attachments?.length > 0 && <TradeMessageAttachmentList attachments={message.attachments} getAuthHeaders={getAuthHeaders} />}</div><footer className={styles.messageMeta}><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("en-AU")}>{new Date(message.createdAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</time>{message.mine && <TradeMessageReceipt receipt={message.receipt} />}<TradeMessageSaveToJob threadId={thread.id} message={message} getAuthHeaders={getAuthHeaders} /></footer></li>)}
    </ol>
    <form className={styles.composer} onSubmit={event => void send(event)}><div className={styles.composerRow}><label><span className={styles.srOnly}>Message your team</span><textarea rows={1} maxLength={2000} value={body} disabled={busy || !canSend || Boolean(pending)} onChange={event => setBody(event.target.value)} placeholder="Message your team" /></label><button type="submit" className={pending || busy ? styles.primary : styles.sendButton} disabled={busy || mediaBusy || !canSend || (!body.trim() && !attachments.length)}>{busy ? "Sending..." : pending ? "Check this message" : <><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 11 6-6 6 6M12 5v14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg><span className={styles.srOnly}>Send</span></>}</button></div><details className={styles.attachmentTools}><summary>+ Photos & voice{attachments.length ? ` · ${attachments.length} attached` : ""}{mediaBusy ? " · Working..." : ""}</summary><TradeMessageAttachments threadId={thread.id} value={attachments} onChange={setAttachments} getAuthHeaders={getAuthHeaders} disabled={busy || !canSend || Boolean(pending)} onBusyChange={setMediaBusy} /></details></form>
  </section>;
}

export function TradeMessagesWorkspace({ user, getAuthHeaders, onOpenIntegrations, onOpenQuote, onOpenAutomations, initialThreadId = "", initialThreadRevision = 0, initialCallId = "", teamOnly = false }: {
  user?: User; getAuthHeaders?: () => Promise<Record<string, string>>; onOpenIntegrations?: () => void; onOpenQuote?: (workOrderId: string) => void; onOpenAutomations?: () => void; initialThreadId?: string; initialThreadRevision?: number; initialCallId?: string; teamOnly?: boolean;
}) {
  const fetch = useTradeBusinessFetch();
  const router = useRouter();
  const { refresh: refreshAlerts } = useTradeMessageAlerts();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mode, setMode] = useState<"team" | "customers">(teamOnly || initialThreadId ? "team" : "customers");
  const [customers, setCustomers] = useState<CustomerThread[]>([]);
  const [questions, setQuestions] = useState<QuoteQuestion[]>([]);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [customer, setCustomer] = useState<CustomerThread | null>(null);
  const conversationViewport = useConversationViewport(Boolean(mode === 'team' ? selected : customer));
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsVisited, setSmsVisited] = useState(false);
  const smsDialog = useRef<HTMLDialogElement>(null);
  const openSmsAccount = () => { setSmsVisited(true); setSmsOpen(true); };
  useEffect(() => {
    const dialog = smsDialog.current;
    if (!dialog) return;
    if (smsOpen && !dialog.open) dialog.showModal();
    else if (!smsOpen && dialog.open) dialog.close();
  }, [smsOpen, smsVisited]);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<{ members: Member[]; customers: CustomerThread[] }>({ members: [], customers: [] });
  const [contactName, setContactName] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ firstName: string; phone: string } | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<{ requestId: string; memberIds: string[]; subject: string } | null>(null);
  const createInFlight = useRef(false), alive = useRef(true);
  const activeQuery = useRef("");
  const overviewRequests = useRef(new Set<string>());
  const queryKey = `${mode}:${search}:${page}`;
  useEffect(() => { activeQuery.current = queryKey; }, [queryKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const authHeaders = useCallback(async () => {
    const auth = getAuthHeaders ? await getAuthHeaders() : user ? { Authorization: `Bearer ${await user.getIdToken()}` } : null;
    if (!auth) throw new Error("Sign in to view messages.");
    return auth;
  }, [user, getAuthHeaders]);
  const call = useCallback<ApiCall>(async (query = "", payload, path = "/api/trade-messages") => {
    const response = await fetch(`${path}${query ? `?${query}` : ""}`, { method: payload ? "POST" : "GET",
      headers: { ...await authHeaders(), ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await response.json().catch(() => ({})) as Result;
    return { response, result };
  }, [fetch, authHeaders]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const threadId = initialThreadId || query.get("threadId") || "";
    if (!threadId) return;
    let active = true;
    void call(`view=thread&threadId=${encodeURIComponent(threadId)}`).then(({response,result}) => {
      if (!response.ok || !result.thread) throw new Error(result.error || "This conversation is no longer available.");
      if (active) {
        setSelected(result.thread); setMode("team");
        const callId = initialCallId || query.get("callId");
        if (callId) window.dispatchEvent(new CustomEvent("tlink:open-team-call", {detail:{callId,threadId}}));
      }
    }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : "Conversation could not be opened."); });
    return () => { active = false; };
  }, [call, initialThreadId, initialThreadRevision, initialCallId]);

  const selectedId = selected?.id;
  const refresh = useCallback(async () => {
    if (overviewRequests.current.has(queryKey)) return;
    overviewRequests.current.add(queryKey);
    try {
      const query = `search=${encodeURIComponent(search)}&page=${page}`;
      // Load current identity and permissions even when customer SMS is the first view.
      const { response, result } = await call(mode === "team" ? query : "");
      if (!response.ok || !result.ok) throw new Error(result.error || "Conversations could not be loaded.");
      if (!alive.current || activeQuery.current !== queryKey) return;
      if (result.memberId && result.members && result.threads) {
        setOverview({ memberId: result.memberId, members: result.members, threads: result.threads, hasMore: Boolean(result.hasMore), canUseSms: Boolean(result.canUseSms), smsReady: result.smsReady === true, smsBalanceMicro: typeof result.smsBalanceMicro === "number" ? result.smsBalanceMicro : null, canUseQuotes: Boolean(result.canUseQuotes), canCreateSmsContact: Boolean(result.canCreateSmsContact), canManageTeam: Boolean(result.canManageTeam) });
        if (mode === "team") {
          setSelected(current => current ? result.threads?.find(thread => thread.id === current.id) || current : null);
          // Search and pagination must not freeze the status of an open chat.
          if (selectedId && !result.threads.some(thread => thread.id === selectedId)) {
            const detail = await call(`view=thread&threadId=${encodeURIComponent(selectedId)}`);
            const refreshedThread = detail.result.thread;
            if (!detail.response.ok || !refreshedThread) throw new Error(detail.result.error || "Conversation status could not refresh.");
            if (alive.current && activeQuery.current === queryKey) setSelected(current => current?.id === refreshedThread.id ? refreshedThread : current);
          }
        }
      }
      if (mode === "customers") {
        if (!result.canUseSms && !result.canUseQuotes) { setMode("team"); return; }
        const customerResponse = await call(`view=customers&${query}`);
        if (!customerResponse.response.ok || !customerResponse.result.ok) throw new Error(customerResponse.result.error || "Customer conversations could not be loaded.");
        if (!alive.current || activeQuery.current !== queryKey) return;
        setCustomers(customerResponse.result.customerThreads || []); setQuestions(customerResponse.result.questions || []); setHasMoreCustomers(Boolean(customerResponse.result.hasMore));
      }
    } catch (error) { if (alive.current && activeQuery.current === queryKey) setStatus(error instanceof Error ? error.message : "Conversations could not be loaded."); }
    finally { overviewRequests.current.delete(queryKey); }
  }, [call, mode, search, page, queryKey, selectedId]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), search ? 250 : 0); return () => window.clearTimeout(timer); }, [refresh, search]);
  useVisibleRefresh(refresh);
  const onRead = useCallback(() => { void refresh(); refreshAlerts(); }, [refresh, refreshAlerts]);
  useEffect(() => {
    if (!creating) return;
    let active = true, pending = false;
    const refreshContacts = () => {
      if (!active || pending || document.visibilityState !== "visible") return;
      pending = true;
      void call(`view=contacts&search=${encodeURIComponent(contactSearch)}`).then(({ response, result }) => {
        if (!response.ok || !result.ok) throw new Error(result.error || "Contacts could not be loaded.");
        if (active) setContactResults({ members: result.members || [], customers: result.customerThreads || [] });
      }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : "Contacts could not be loaded."); }).finally(() => { pending = false; });
    };
    const timer = window.setTimeout(refreshContacts, contactSearch ? 250 : 0);
    const interval = window.setInterval(refreshContacts, 15000);
    window.addEventListener("focus", refreshContacts);
    window.addEventListener("tlink:team-presence-changed", refreshContacts);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", refreshContacts); window.removeEventListener("tlink:team-presence-changed", refreshContacts); };
  }, [call, creating, contactSearch]);

  async function create(event: FormEvent) {
    event.preventDefault(); if (createInFlight.current || !members.length) return;
    const submission = pendingCreate || { requestId: crypto.randomUUID(), memberIds: members, subject };
    createInFlight.current = true; setCreateBusy(true); setPendingCreate(submission); setStatus("");
    try {
      const { response, result } = await call("", { action: "create", ...submission });
      if (response.ok && result.ok && result.thread) {
        const thread = { ...result.thread, latest: "", latestSender: "", unread: 0,
          members: (overview?.members || []).filter(member => member.id === overview?.memberId || submission.memberIds.includes(member.id)) };
        setSelected(thread); setMode("team"); setPage(1); setSearch(""); setCreating(false); setPendingCreate(null); setMembers([]); setSubject(""); void refresh();
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        setPendingCreate(null); setStatus(result.error || "The conversation could not be started.");
      } else setStatus("The result is not confirmed. Check this conversation to retry safely.");
    } catch { setStatus("The result is not confirmed. Check this conversation to retry safely."); }
    finally { createInFlight.current = false; setCreateBusy(false); }
  }

  const newContactPhone = normalizeAustralianMobile(contactSearch);
  async function createCustomer() {
    if (createInFlight.current || !overview?.canCreateSmsContact || !newContactPhone || !contactName.trim()) return;
    const submission = pendingCustomer || { firstName: contactName.trim(), phone: newContactPhone };
    createInFlight.current = true; setContactBusy(true); setPendingCustomer(submission); setStatus("");
    try {
      const { response, result } = await call("", { action: "create_customer", source: "messages", ...submission }, "/api/trade-crm");
      if (response.ok && result.ok && result.id) {
        const found = await call(`view=contacts&search=${encodeURIComponent(submission.phone)}`);
        const saved = found.result.customerThreads?.find(item => item.customerId === result.id);
        setCustomer(saved || { customerId: result.id, name: submission.firstName, phone: submission.phone, workOrderId: "", jobNumber: "", latest: "" });
        setMode("customers"); setPage(1); setSearch(""); setCreating(false); setPendingCustomer(null); setContactName(""); setMembers([]);
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        setPendingCustomer(null); setStatus(result.error || "The customer could not be saved.");
      } else setStatus("The save is not confirmed. Check this customer to retry without creating a duplicate.");
    } catch { setStatus("The save is not confirmed. Check this customer to retry without creating a duplicate."); }
    finally { createInFlight.current = false; setContactBusy(false); }
  }

  const hasMore = mode === "team" ? overview?.hasMore : hasMoreCustomers;
  const isBusinessOwner = Boolean(user && overview?.members.find(member => member.id === overview.memberId)?.isOwner);
  const closeSmsAccount = () => { setSmsOpen(false); void refresh(); };
  const balance = overview?.smsBalanceMicro;
  const balanceLabel = typeof balance === "number" ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(balance / 1_000_000) : "…";
  const openAutomationSettings = () => { closeSmsAccount(); if (onOpenAutomations) onOpenAutomations(); else router.push("/direct-trade/dashboard?workspace=email-templates"); };
  const startNewChat = () => { setCreating(true); if (!pendingCreate && !pendingCustomer) setContactSearch(""); setStatus(""); };
  const smsLocked = overview !== null && !overview.smsReady;
  const customerPrompt = <div className={styles.welcome}>
    <span className={styles.welcomeIcon}><ChatMark locked={smsLocked} /></span>
    <h3>{smsLocked ? "Your number. Your conversations." : "A conversation starts here."}</h3>
    <p>{smsLocked ? isBusinessOwner ? "Rent an Australian number to unlock customer texting. You can add credit at any time." : "Customer texting will unlock when your business owner activates a number." : "Choose a customer to pick up where you left off, or start a new conversation."}</p>
    {isBusinessOwner && smsLocked ? <button type="button" className={styles.primary} onClick={openSmsAccount}>Set up customer texting</button> : !smsLocked && <button type="button" className={styles.primary} onClick={startNewChat}>New chat</button>}
    {smsLocked && <span className={styles.welcomeNote}>Team chat is always available.</span>}
  </div>;
  return <section ref={conversationViewport} className={styles.workspace} data-channel={mode} aria-label="Connect workspace">
    <header className={styles.heading}>
      <div><h2>Connect</h2><p>{teamOnly ? "Your team, connected." : "Customer texts, team chats and calls."}</p></div>
      <div className={styles.actions}>
        {!teamOnly && (isBusinessOwner || overview?.canUseSms) && (isBusinessOwner
          ? <button type="button" className={styles.creditButton} onClick={openSmsAccount} aria-label={"SMS credit " + balanceLabel + ". Top up credit"}><span><small>Available SMS credit</small><strong>{balanceLabel}</strong></span><span className={styles.topUpLabel}>Top up <b aria-hidden="true">+</b></span></button>
          : <div className={styles.creditButton} aria-label={"Available SMS credit " + balanceLabel}><span><small>Available SMS credit</small><strong>{balanceLabel}</strong></span></div>)}
        {overview && <div className={styles.notifications}><TradeNotificationSettings key={user?.uid || overview.memberId} getAuthHeaders={authHeaders} /></div>}
        <button type="button" className={styles.composeButton} aria-label="New chat" title="New chat" disabled={createBusy || contactBusy} onClick={startNewChat}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M17 3l4 4-10 10-5 1 1-5L17 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span className={styles.srOnly}>New chat</span></button>
      </div>
    </header>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {!teamOnly && isBusinessOwner && <dialog ref={smsDialog} className={styles.accountDialog} aria-label="SMS account and credit" onCancel={closeSmsAccount} onClose={() => { if (smsOpen) closeSmsAccount(); }} onClick={event => { if (event.target === event.currentTarget) closeSmsAccount(); }}>
      <div className={styles.accountDialogHeader}><strong>SMS account</strong><button type="button" className={styles.secondary} onClick={closeSmsAccount}>Done</button></div>
      {smsVisited && <TradeSmsDashboard key={overview?.memberId} user={user} getAuthHeaders={getAuthHeaders} onOpenAutomations={openAutomationSettings} visible={smsOpen} />}
    </dialog>}
    {creating && <form className={styles.newChat} onSubmit={event => void create(event)}>
      <h3>New chat</h3><label className={styles.groupName}><span>Name or phone number</span><input type="search" value={contactSearch} disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)} onChange={event => setContactSearch(event.target.value)} placeholder={teamOnly ? "Search your team" : "Search customers and your team"} /></label>
      <fieldset disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)}><legend>Choose a teammate, or several for a group</legend><div className={styles.people}>{contactResults.members.map(member => <label key={member.id}><input type="checkbox" checked={members.includes(member.id)} onChange={event => setMembers(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><TradeTeamAvatar memberId={member.id} name={member.name} revision={member.avatarRevision} getAuthHeaders={authHeaders} /><span><TradeTeamStatusDot name={member.name} presence={member.presence} active={member.active} /> {member.name}{member.isOwner ? " · Business owner" : ""}<small className={styles.internalBadge}>Internal · Team</small></span></label>)}</div>
        {members.length > 1 && <label className={styles.groupName}><span>Group name</span><input required maxLength={80} value={subject} onChange={event => setSubject(event.target.value)} placeholder="For example: Installation crew" /></label>}</fieldset>
      {!teamOnly && contactResults.customers.length > 0 && <div className={styles.people}>{contactResults.customers.map(item => <button type="button" key={`${item.customerId}:${item.workOrderId}`} className={styles.contact} disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)} onClick={() => { setCustomer(item); setMode("customers"); setPage(1); setSearch(""); setCreating(false); setMembers([]); }}><strong>{item.name}</strong><span>{item.phone}{item.jobNumber ? ` · ${item.jobNumber}` : ""}</span><small className={styles.externalBadge}>External · Customer SMS</small></button>)}</div>}
      {contactSearch && !contactResults.members.length && !contactResults.customers.length && <p className={styles.notice}>No saved contact matches this search. Team members can message customers on jobs they are authorised to access.</p>}
      {!teamOnly && overview?.canCreateSmsContact && newContactPhone && !contactResults.customers.length && <div className={styles.newCustomer}><span className={styles.externalBadge}>External · New customer</span><label className={styles.groupName}><span>Customer name</span><input value={contactName} maxLength={80} disabled={contactBusy || Boolean(pendingCustomer)} onChange={event => setContactName(event.target.value)} placeholder="Name for this number" /></label><small>{newContactPhone}. Save the contact, then record permission before sending SMS.</small><button type="button" className={styles.primary} disabled={createBusy || contactBusy || Boolean(pendingCreate) || !contactName.trim()} onClick={() => void createCustomer()}>{contactBusy ? "Saving..." : pendingCustomer ? "Check this customer" : "Save & chat"}</button></div>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={contactBusy || Boolean(pendingCustomer) || createBusy || !members.length || (members.length > 1 && !subject.trim())}>{createBusy ? "Opening..." : pendingCreate ? "Check this conversation" : "Start chat"}</button><button type="button" className={styles.secondary} disabled={createBusy || contactBusy} onClick={() => { setCreating(false); setPendingCreate(null); setPendingCustomer(null); setContactName(""); setMembers([]); setSubject(""); }}>Cancel</button></div>
    </form>}
    <div className={styles.layout + ((mode === "team" ? selected : customer) ? " " + styles.chatOpen : "")}>
      <aside className={styles.list}>
        <div className={styles.listTools}>
          <div className={styles.tabs} aria-label="Message types">
            {!teamOnly && (overview?.canUseSms || overview?.canUseQuotes) && <button type="button" data-channel="customers" aria-pressed={mode === "customers"} onClick={() => { setMode("customers"); setPage(1); setSearch(""); }}><span aria-hidden="true" />Customers</button>}
            <button type="button" data-channel="team" aria-pressed={mode === "team"} onClick={() => { setMode("team"); setPage(1); setSearch(""); }}><span aria-hidden="true" />Team</button>
          </div>
          <label className={styles.search}><span className={styles.srOnly}>Find a conversation</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={mode === "team" ? "Search your team" : "Search customers"} /></label>
          {mode === "customers" && smsLocked && isBusinessOwner && <button type="button" className={styles.activateNumber} onClick={openSmsAccount}><ChatMark locked /><span>Rent a number to start texting</span><span aria-hidden="true">›</span></button>}
        </div>
        <div className={styles.threadList}>
          {mode === "team" ? overview?.threads.map(thread => <button type="button" key={thread.id} className={styles.thread} aria-pressed={selected?.id === thread.id} onClick={() => setSelected(thread)}>
            <span className={styles.avatar}><span>{contactInitials(threadName(thread, overview.memberId))}</span></span>
            <span className={styles.threadCopy}><strong><TeammateStatus thread={thread} memberId={overview.memberId} /> {threadName(thread, overview.memberId)}</strong><span>{thread.latest ? thread.latestSender + ": " + thread.latest : "Start a conversation"}</span><small>Team</small></span>
            {thread.unread > 0 && <span className={styles.unread}>{thread.unread}</span>}
          </button>) : <>
            {questions.map(question => <button type="button" key={question.id} className={styles.thread + " " + styles.externalThread} onClick={() => onOpenQuote ? onOpenQuote(question.workOrderId) : router.push("/direct-trade/dashboard?workspace=work&jobId=" + encodeURIComponent(question.workOrderId) + "&jobTab=quote#quote-questions")}>
              <span className={styles.avatar}><ChatMark /></span><span className={styles.threadCopy}><strong>{question.jobNumber}</strong><span>{question.question}</span><small>Quote question</small></span>{question.status === "open" && <span className={styles.unreadDot} aria-label="Open question" />}
            </button>)}
            {customers.map(item => <button type="button" key={item.customerId + ":" + item.workOrderId} className={styles.thread + " " + styles.externalThread} aria-pressed={customer?.customerId === item.customerId && customer.workOrderId === item.workOrderId} onClick={() => setCustomer(item)}>
              <span className={styles.avatar}><span>{contactInitials(item.name)}</span></span><span className={styles.threadCopy}><strong>{item.name}</strong><span>{item.latest || item.phone}</span><small>{item.jobNumber || "Customer SMS"}</small></span>
            </button>)}
          </>}
          {(mode === "team" ? overview && !overview.threads.length : !customers.length && !questions.length) && <div className={styles.emptyList}><ChatMark /><strong>{search ? "No conversations found" : mode === "team" ? "Your team chats live here" : "Your customer inbox"}</strong><p>{search ? "Try another name or number." : mode === "team" ? "Start a chat with your crew." : "Customer texts and quote questions, together."}</p></div>}
        </div>
        {(page > 1 || hasMore) && <div className={styles.pagination}><button type="button" className={styles.secondary} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className={styles.secondary} disabled={!hasMore} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        <footer className={styles.listFooter}><span className={styles.channelDot} />{mode === "team" ? "Private team messages" : overview?.smsReady ? "Two-way customer texts" : "Customer texting locked"}{!teamOnly && isBusinessOwner && <button type="button" onClick={openSmsAccount}>SMS account</button>}{teamOnly && overview && <TradeTeamPresence getAuthHeaders={authHeaders} />}</footer>
      </aside>
      <div className={styles.detail} data-message-detail>
        <button type="button" className={styles.back} aria-label="Back to conversations" onClick={() => { setSelected(null); setCustomer(null); }}>‹ <span>Connect</span></button>
        {mode === "team" ? selected && overview
          ? <TeamConversation key={selected.id} thread={selected} call={call} memberId={overview.memberId} onRead={onRead} getAuthHeaders={authHeaders} canManageTeam={overview.canManageTeam} />
          : <div className={styles.welcome}><span className={styles.welcomeIcon}><ChatMark /></span><h3>Keep your team close.</h3><p>A quick question, a photo from site, or the next job. It all starts with a message.</p><button type="button" className={styles.primary} onClick={startNewChat}>New chat</button><span className={styles.welcomeNote}>Private to the people in each conversation.</span></div>
          : customer && overview?.smsReady
            ? <div className={styles.customerConversation}><header className={styles.customerHeader}><span className={styles.avatar}><span>{contactInitials(customer.name)}</span></span><div><h3>{customer.name}</h3><p>{customer.phone}{customer.jobNumber ? " · " + customer.jobNumber : ""}</p></div><span className={styles.externalBadge}>Customer SMS</span></header><TradeCustomerSmsPanel embedded key={customer.customerId + ":" + customer.workOrderId} user={user} getAuthHeaders={getAuthHeaders} customerId={customer.customerId} workOrderId={customer.workOrderId} onOpenIntegrations={isBusinessOwner ? openSmsAccount : onOpenIntegrations} onAccountChange={onRead} /></div>
            : !overview ? <div className={styles.welcome}><p role="status">Loading your inbox...</p></div> : customerPrompt}
      </div>
    </div>
  </section>;
}
