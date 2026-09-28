"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { normalizeAustralianMobile } from "@/lib/service-reminder-delivery";
import { TradeCustomerSmsPanel } from "./TradeCustomerSmsPanel";
import TradeMessageAttachments, { TradeMessageAttachmentList } from "./TradeMessageAttachments";
import TradeTeamAvatar from "./TradeTeamAvatar";
import { TradeTeamCallButtons } from "./TradeTeamCallProvider";
import type { MessageAttachment, MessageMediaAuth } from "@/lib/trade-message-media";
import styles from "./TradeMessagesWorkspace.module.css";

type Member = { id: string; name: string; isOwner?: boolean; active?: boolean; avatarRevision?: string };
type Thread = { id: string; kind: string; subject: string; latest: string; latestSender: string; unread: number; members: Member[] };
type CustomerThread = { customerId: string; name: string; workOrderId: string; jobNumber: string; latest: string; phone: string };
type QuoteQuestion = { id: string; workOrderId: string; jobNumber: string; question: string; status: string; askedAt: string };
type TeamMessage = { id: string; sequence: number; senderName: string; senderMemberId: string; mine: boolean; body: string; requestId: string; createdAt: string; attachments: MessageAttachment[] };
type Overview = { memberId: string; canUseSms: boolean; canUseQuotes: boolean; canCreateSmsContact: boolean; canManageTeam: boolean; members: Member[]; threads: Thread[]; hasMore: boolean };
type Result = Partial<Overview> & { ok?: boolean; error?: string; id?: string; thread?: Thread; message?: TeamMessage; messages?: TeamMessage[]; hasOlder?: boolean; customerThreads?: CustomerThread[]; questions?: QuoteQuestion[] };
type RequestResult = { response: Response; result: Result };
type ApiCall = (query?: string, payload?: Record<string, unknown>, path?: string) => Promise<RequestResult>;

function threadName(thread: Thread, memberId: string) {
  return thread.kind === "group" ? thread.subject : thread.members.find(member => member.id !== memberId)?.name || "Team conversation";
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
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [refresh, milliseconds]);
}

function TeamConversation({ thread, call, memberId, onRead, getAuthHeaders, canManageTeam }: {
  thread: Thread; call: ApiCall; memberId: string; onRead: () => void; getAuthHeaders: MessageMediaAuth; canManageTeam: boolean;
}) {
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
  const lastRead = useRef(0);
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
      if (through > lastRead.current && document.visibilityState === "visible") {
        const read = await call("", { action: "read", threadId: thread.id, throughSequence: through });
        if (read.response.ok && read.result.ok && alive.current) { lastRead.current = through; onRead(); }
      }
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "Messages could not be refreshed."); }
    finally { refreshing.current = false; if (alive.current) setLoading(false); }
  }, [call, thread.id, merge, onRead]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useVisibleRefresh(refresh, 3000);
  const latestSequence = messages.at(-1)?.sequence;
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [latestSequence]);

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
    <header><span className={styles.internalBadge}>Internal · Team</span><div className={styles.chatTitle}><h3>{threadName(thread, memberId)}</h3><TradeTeamCallButtons threadId={thread.id} /></div><div className={styles.memberAvatars}>{thread.members.map(member => <TradeTeamAvatar key={member.id} memberId={member.id} name={member.name} revision={member.avatarRevision} editable={member.active !== false && (member.id === memberId || canManageTeam)} getAuthHeaders={getAuthHeaders} onChange={onRead} />)}</div><p>{thread.members.map(member => `${member.name}${member.active === false ? " (inactive)" : ""}`).join(", ")}</p><small>Only people in this chat can see these messages.</small></header>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {hasOlder && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void older()}>Load older messages</button>}
    <ol ref={history} className={styles.messages} aria-live="polite" aria-label="Team message history">
      {loading && <li className={styles.empty}>Loading messages...</li>}
      {!loading && !messages.length && <li className={styles.empty}>Start the conversation with your team.</li>}
      {messages.map(message => <li key={message.id} className={message.mine ? styles.mine : styles.theirs}><strong>{message.senderName}</strong>{message.body && <p>{message.body}</p>}{message.attachments?.length > 0 && <TradeMessageAttachmentList attachments={message.attachments} getAuthHeaders={getAuthHeaders} />}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}
    </ol>
    <form className={styles.composer} onSubmit={event => void send(event)}><label><span>Message your team</span><textarea rows={3} maxLength={2000} value={body} disabled={busy || !canSend || Boolean(pending)} onChange={event => setBody(event.target.value)} placeholder="Write a message" /></label><TradeMessageAttachments threadId={thread.id} value={attachments} onChange={setAttachments} getAuthHeaders={getAuthHeaders} disabled={busy || !canSend || Boolean(pending)} onBusyChange={setMediaBusy} /><button type="submit" className={styles.primary} disabled={busy || mediaBusy || !canSend || (!body.trim() && !attachments.length)}>{busy ? "Sending..." : pending ? "Check this message" : "Send"}</button></form>
  </section>;
}

export function TradeMessagesWorkspace({ user, getAuthHeaders, onOpenIntegrations, onOpenQuote }: {
  user?: User; getAuthHeaders?: () => Promise<Record<string, string>>; onOpenIntegrations?: () => void; onOpenQuote?: (workOrderId: string) => void;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mode, setMode] = useState<"team" | "customers">("team");
  const [customers, setCustomers] = useState<CustomerThread[]>([]);
  const [questions, setQuestions] = useState<QuoteQuestion[]>([]);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [customer, setCustomer] = useState<CustomerThread | null>(null);
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
  }, [authHeaders]);

  const refresh = useCallback(async () => {
    if (overviewRequests.current.has(queryKey)) return;
    overviewRequests.current.add(queryKey);
    try {
      const query = `search=${encodeURIComponent(search)}&page=${page}`;
      const { response, result } = await call(mode === "customers" ? `view=customers&${query}` : query);
      if (!response.ok || !result.ok) throw new Error(result.error || "Conversations could not be loaded.");
      if (!alive.current || activeQuery.current !== queryKey) return;
      if (mode === "team" && result.memberId && result.members && result.threads) {
        setOverview({ memberId: result.memberId, members: result.members, threads: result.threads, hasMore: Boolean(result.hasMore), canUseSms: Boolean(result.canUseSms), canUseQuotes: Boolean(result.canUseQuotes), canCreateSmsContact: Boolean(result.canCreateSmsContact), canManageTeam: Boolean(result.canManageTeam) });
        setSelected(current => current ? result.threads?.find(thread => thread.id === current.id) || current : null);
      } else if (mode === "customers") {
        setCustomers(result.customerThreads || []); setQuestions(result.questions || []); setHasMoreCustomers(Boolean(result.hasMore));
      }
    } catch (error) { if (alive.current && activeQuery.current === queryKey) setStatus(error instanceof Error ? error.message : "Conversations could not be loaded."); }
    finally { overviewRequests.current.delete(queryKey); }
  }, [call, mode, search, page, queryKey]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), search ? 250 : 0); return () => window.clearTimeout(timer); }, [refresh, search]);
  useVisibleRefresh(refresh);
  const onRead = useCallback(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!creating) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void call(`view=contacts&search=${encodeURIComponent(contactSearch)}`).then(({ response, result }) => {
        if (!response.ok || !result.ok) throw new Error(result.error || "Contacts could not be loaded.");
        if (active) setContactResults({ members: result.members || [], customers: result.customerThreads || [] });
      }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : "Contacts could not be loaded."); });
    }, contactSearch ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
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
  return <section className={styles.workspace} aria-label="Messages workspace">
    <header className={styles.heading}><div><h2>Messages</h2><p>Your customers and team, in one place.</p></div><div className={styles.actions}>{overview && <TradeTeamAvatar memberId={overview.memberId} name={overview.members.find(member => member.id === overview.memberId)?.name || "Your profile"} revision={overview.members.find(member => member.id === overview.memberId)?.avatarRevision} editable getAuthHeaders={authHeaders} onChange={onRead} />}<button type="button" className={styles.primary} disabled={createBusy || contactBusy} onClick={() => { setCreating(true); if (!pendingCreate && !pendingCustomer) setContactSearch(""); setStatus(""); }}>New chat</button></div></header>
    <div className={styles.tabs} aria-label="Message types"><button type="button" aria-pressed={mode === "team"} onClick={() => { setMode("team"); setPage(1); setSearch(""); }}>Team</button>{(overview?.canUseSms || overview?.canUseQuotes) && <button type="button" aria-pressed={mode === "customers"} onClick={() => { setMode("customers"); setPage(1); setSearch(""); }}>Customers</button>}</div>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {creating && <form className={styles.newChat} onSubmit={event => void create(event)}>
      <h3>New chat</h3><label className={styles.groupName}><span>Name or phone number</span><input type="search" value={contactSearch} disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)} onChange={event => setContactSearch(event.target.value)} placeholder="Search customers and your team" /></label>
      <fieldset disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)}><legend>Choose a teammate, or several for a group</legend><div className={styles.people}>{contactResults.members.map(member => <label key={member.id}><input type="checkbox" checked={members.includes(member.id)} onChange={event => setMembers(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><TradeTeamAvatar memberId={member.id} name={member.name} revision={member.avatarRevision} getAuthHeaders={authHeaders} /><span>{member.name}{member.isOwner ? " · Business owner" : ""}<small className={styles.internalBadge}>Internal · Team</small></span></label>)}</div>
        {members.length > 1 && <label className={styles.groupName}><span>Group name</span><input required maxLength={80} value={subject} onChange={event => setSubject(event.target.value)} placeholder="For example: Installation crew" /></label>}</fieldset>
      {contactResults.customers.length > 0 && <div className={styles.people}>{contactResults.customers.map(item => <button type="button" key={`${item.customerId}:${item.workOrderId}`} className={styles.contact} disabled={createBusy || contactBusy || Boolean(pendingCreate) || Boolean(pendingCustomer)} onClick={() => { setCustomer(item); setMode("customers"); setPage(1); setSearch(""); setCreating(false); setMembers([]); }}><strong>{item.name}</strong><span>{item.phone}{item.jobNumber ? ` · ${item.jobNumber}` : ""}</span><small className={styles.externalBadge}>External · Customer SMS</small></button>)}</div>}
      {contactSearch && !contactResults.members.length && !contactResults.customers.length && <p className={styles.notice}>No saved contact matches this search. Team members can message customers on jobs they are authorised to access.</p>}
      {overview?.canCreateSmsContact && newContactPhone && !contactResults.customers.length && <div className={styles.newCustomer}><span className={styles.externalBadge}>External · New customer</span><label className={styles.groupName}><span>Customer name</span><input value={contactName} maxLength={80} disabled={contactBusy || Boolean(pendingCustomer)} onChange={event => setContactName(event.target.value)} placeholder="Name for this number" /></label><small>{newContactPhone}. Save the contact, then record permission before sending SMS.</small><button type="button" className={styles.primary} disabled={createBusy || contactBusy || Boolean(pendingCreate) || !contactName.trim()} onClick={() => void createCustomer()}>{contactBusy ? "Saving..." : pendingCustomer ? "Check this customer" : "Save & chat"}</button></div>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={contactBusy || Boolean(pendingCustomer) || createBusy || !members.length || (members.length > 1 && !subject.trim())}>{createBusy ? "Opening..." : pendingCreate ? "Check this conversation" : "Start chat"}</button><button type="button" className={styles.secondary} disabled={createBusy || contactBusy} onClick={() => { setCreating(false); setPendingCreate(null); setPendingCustomer(null); setContactName(""); setMembers([]); setSubject(""); }}>Cancel</button></div>
    </form>}
    <div className={styles.layout}><aside className={styles.list}><label className={styles.search}><span>Find a conversation</span><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={mode === "team" ? "Person or group name" : "Customer or job number"} /></label>
      {mode === "team" ? overview?.threads.map(thread => <button type="button" key={thread.id} className={styles.thread} aria-pressed={selected?.id === thread.id} onClick={() => setSelected(thread)}><span className={styles.threadHeading}>{thread.members.filter(member => member.id !== overview.memberId).slice(0, 1).map(member => <TradeTeamAvatar key={member.id} memberId={member.id} name={member.name} revision={member.avatarRevision} getAuthHeaders={authHeaders} />)}<strong>{threadName(thread, overview.memberId)}{thread.unread > 0 && <span className={styles.unread}>{thread.unread}</span>}</strong></span><small className={styles.internalBadge}>Internal · Team</small><span>{thread.latest ? `${thread.latestSender}: ${thread.latest}` : "No messages yet"}</span></button>) : <>{questions.map(question => <button type="button" key={question.id} className={`${styles.thread} ${styles.externalThread}`} onClick={() => onOpenQuote ? onOpenQuote(question.workOrderId) : router.push(`/direct-trade/dashboard?workspace=work&jobId=${encodeURIComponent(question.workOrderId)}&jobTab=quote#quote-questions`)}><strong>{question.jobNumber}{question.status === "open" && <span className={styles.unread}>Question</span>}</strong><small className={styles.externalBadge}>External · Quote question</small><span>{question.question}</span><small>{question.status === "open" ? "Open question" : "View question and reply"}</small></button>)}{customers.map(item => <button type="button" key={`${item.customerId}:${item.workOrderId}`} className={`${styles.thread} ${styles.externalThread}`} aria-pressed={customer?.customerId === item.customerId && customer.workOrderId === item.workOrderId} onClick={() => setCustomer(item)}><strong>{item.name}</strong><small className={styles.externalBadge}>External · Customer SMS</small><small>{item.jobNumber || item.phone}</small><span>{item.latest || "Start a service SMS conversation"}</span></button>)}</>}
      {(mode === "team" ? overview && !overview.threads.length : !customers.length && !questions.length) && <p className={styles.empty}>{mode === "team" ? "No chats here yet. Start a chat above." : "No matching customer conversations. Quote questions appear here. SMS needs a saved mobile number and SMS access."}</p>}
      {(page > 1 || hasMore) && <div className={styles.pagination}><button type="button" className={styles.secondary} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className={styles.secondary} disabled={!hasMore} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    </aside><div className={styles.detail}>{mode === "team" ? selected && overview ? <TeamConversation key={selected.id} thread={selected} call={call} memberId={overview.memberId} onRead={onRead} getAuthHeaders={authHeaders} canManageTeam={overview.canManageTeam} /> : <div className={styles.welcome}><h3>Keep the team in the loop</h3><p>Select a chat or start one with a teammate. Only the people in that chat can read and reply.</p></div> : customer ? <div><span className={styles.externalBadge}>External · Customer SMS</span><h3 className={styles.customerName}>{customer.name}</h3><TradeCustomerSmsPanel key={`${customer.customerId}:${customer.workOrderId}`} user={user} getAuthHeaders={getAuthHeaders} customerId={customer.customerId} workOrderId={customer.workOrderId} onOpenIntegrations={onOpenIntegrations} /></div> : <div className={styles.welcome}><h3>Shared customer conversations</h3><p>Open a quote question to respond, or select a customer for SMS. Quote questions use the customer&apos;s secure quote link and need no email mailbox connection.</p></div>}</div></div>
  </section>;
}
