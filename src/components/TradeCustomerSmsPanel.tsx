"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { TradeSmsConnection } from "./TradeSmsConnectionPanel";
import styles from "./TradeSms.module.css";

type SmsMessage = { id: string; requestId: string; direction: "inbound" | "outbound"; body: string; status: string; createdAt: string; workOrderId: string; senderName: string };
type Conversation = { connection: TradeSmsConnection | null; customerPhone: string; consent: "required" | "allowed" | "opted_out"; messages: SmsMessage[];
  canManageConnection: boolean; jobNumber: string; jobs: Array<{ id: string; jobNumber: string }> };
type SmsResult = Partial<Conversation> & { ok?: boolean; error?: string; message?: SmsMessage };
const statusLabels: Record<string, string> = {
  accepted: "Accepted by Twilio", queued: "Queued", sending: "Sending", sent: "Sent to carrier", delivered: "Delivered",
  failed: "Failed", undelivered: "Not delivered", unknown: "Delivery not confirmed", reserved: "Preparing", received: "Received", canceled: "Cancelled",
};

export function TradeCustomerSmsPanel({ user, customerId, workOrderId = "", getAuthHeaders, onOpenIntegrations }: {
  user?: User; customerId: string; workOrderId?: string; getAuthHeaders?: () => Promise<Record<string, string>>; onOpenIntegrations?: () => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [body, setBody] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [replyJobs, setReplyJobs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ requestId: string; body: string } | null>(null);
  const pendingRequest = useRef<{ requestId: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const loadingRequest = useRef<Promise<Conversation> | null>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const latestMessageId = conversation?.messages.at(-1)?.id;

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [latestMessageId]);

  const request = useCallback(async (payload?: Record<string, unknown>) => {
    const authHeaders = getAuthHeaders ? await getAuthHeaders() : user ? { Authorization: `Bearer ${await user.getIdToken()}` } : null;
    if (!authHeaders) throw new Error("Sign in to load job messages.");
    const response = await fetch(payload ? "/api/trade-sms" : `/api/trade-sms?customerId=${encodeURIComponent(customerId)}&workOrderId=${encodeURIComponent(workOrderId)}`, {
      method: payload ? "POST" : "GET", headers: { ...authHeaders, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify({ customerId, workOrderId, ...payload }) : undefined, cache: "no-store", signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({})) as SmsResult;
    return { response, result };
  }, [user, customerId, workOrderId, getAuthHeaders]);

  const load = useCallback(() => {
    if (loadingRequest.current) return loadingRequest.current;
    loadingRequest.current = (async () => {
      const { response, result } = await request();
      if ([401, 403].includes(response.status)) setConversation(null);
      if (!response.ok || !result.ok || !result.messages || !result.consent) throw new Error(result.error || "Messages could not be loaded.");
      return { connection: result.connection || null, customerPhone: result.customerPhone || "", consent: result.consent, messages: result.messages,
        canManageConnection: result.canManageConnection === true, jobNumber: result.jobNumber || "", jobs: result.jobs || [] };
    })().finally(() => { loadingRequest.current = null; });
    return loadingRequest.current;
  }, [request]);

  const updateConversation = useCallback((next: Conversation) => {
    setConversation(next);
    if (pendingRequest.current && next.messages.some((message) => message.requestId === pendingRequest.current?.requestId)) {
      pendingRequest.current = null; setPending(null); setBody(""); setStatus("Message found in your history. Check its delivery status below.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load().then((next) => { if (active) updateConversation(next); }).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Messages could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    function refreshOnFocus() {
      if (document.visibilityState === "visible" && !inFlight.current && !loadingRequest.current) {
        void load().then((next) => { if (active) updateConversation(next); }).catch(() => { if (active) setStatus("Messages could not be refreshed. Try Refresh."); });
      }
    }
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    const timer = window.setInterval(refreshOnFocus, 3000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refreshOnFocus); document.removeEventListener("visibilitychange", refreshOnFocus); };
  }, [load, updateConversation]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("refresh"); setStatus("");
    try { updateConversation(await load()); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Messages could not be refreshed."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy("consent"); setStatus("");
    try {
      const { response, result } = await request({ action: "consent", consentNote: consentNote.trim() });
      if (!response.ok || !result.ok) throw new Error(result.error || "Permission could not be saved.");
      updateConversation(await load()); setConsentNote(""); setStatus("Service SMS permission recorded.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Permission could not be saved."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function linkReply(messageId: string) {
    if (inFlight.current || !replyJobs[messageId]) return;
    inFlight.current = true; setBusy(messageId); setStatus("");
    try {
      const { response, result } = await request({ action: "link_reply", messageId, workOrderId: replyJobs[messageId] });
      if (!response.ok || !result.ok) throw new Error(result.error || "The reply could not be linked.");
      updateConversation(await load()); setStatus("Reply shared with the authorised team on that job.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The reply could not be linked."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !body.trim()) return;
    const submission = pending || { requestId: crypto.randomUUID(), body: body.trim() };
    pendingRequest.current = submission; setPending(submission); inFlight.current = true; setBusy("send"); setStatus("");
    try {
      const { response, result } = await request({ action: "send", ...submission });
      if (result.ok && result.message) {
        const message = result.message;
        setConversation((current) => current ? { ...current, messages: [...current.messages.filter((item) => item.id !== message.id), message] } : current);
        pendingRequest.current = null; setPending(null); setBody("");
        setStatus(message.status === "unknown" ? "Delivery is not confirmed. Check the message status before sending it again." : statusLabels[message.status] || "Message recorded. Check its delivery status.");
        void load().then(updateConversation).catch(() => { /* The acknowledged message remains visible if the refresh fails. */ });
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        pendingRequest.current = null; setPending(null); setStatus(result.error || "The message was not accepted. Check the details and try again.");
      } else {
        setStatus("The result is not confirmed. Refresh the conversation or choose Check this message to safely retry the same request.");
      }
    } catch {
      setStatus("The result is not confirmed. Refresh the conversation or choose Check this message to safely retry the same request.");
    } finally { inFlight.current = false; setBusy(""); }
  }

  return <section className={styles.panel} aria-label="Customer SMS">
    <header className={styles.heading}><div><span className={styles.eyebrow}>Shared business messages</span><h4>SMS conversation</h4>{conversation?.customerPhone && <small>{conversation.customerPhone}{conversation.jobNumber ? ` · ${conversation.jobNumber}` : ""}</small>}</div><button type="button" className={styles.secondary} disabled={Boolean(busy) || loading} onClick={() => void refresh()}>{busy === "refresh" ? "Refreshing..." : "Refresh"}</button></header>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {loading ? <p>Loading messages...</p> : conversation && <>
      {!conversation.connection ? <div className={styles.notice}><p>{conversation.canManageConnection ? "Connect your business SMS number to send messages and receive replies here." : "Ask the business owner to connect the business SMS number."}</p>{conversation.canManageConnection && onOpenIntegrations && <button type="button" className={styles.primary} onClick={onOpenIntegrations}>Set up SMS</button>}</div> : <p className={styles.hint}>From {conversation.connection.number}. The business can see and reply to these messages. {conversation.connection.usedSegments} of {conversation.connection.dailyLimit} daily SMS segments used.</p>}
      {conversation.connection && conversation.connection.status !== "connected" && <div className={styles.notice}><p>SMS routing is not confirmed. The business owner needs to reconnect the number before messages can be sent.</p>{conversation.canManageConnection && onOpenIntegrations && <button type="button" className={styles.secondary} onClick={onOpenIntegrations}>Check SMS connection</button>}</div>}
      {!conversation.customerPhone && <p className={styles.notice}>Save a valid Australian mobile number in Customer details to use SMS.</p>}
      {conversation.connection?.accountType.toLowerCase() === "trial" && <p className={styles.notice}>Twilio trial: this customer&apos;s number must be verified in your Twilio account.</p>}
      {conversation.consent === "opted_out" && <p className={styles.notice}>This customer has opted out. Messages are blocked. They can text START to your connected SMS number to resume.</p>}
      {conversation.connection?.status === "connected" && conversation.customerPhone && conversation.consent === "required" && <form className={styles.form} onSubmit={(event) => void recordConsent(event)}>
        <p>Record the customer&apos;s permission before sending service SMS. This does not give permission for marketing.</p>
        <label><span>How and when did they agree to service SMS?</span><textarea required minLength={8} maxLength={500} rows={2} value={consentNote} onChange={(event) => setConsentNote(event.target.value)} placeholder="For example: agreed by phone today to appointment updates." disabled={Boolean(busy)} /></label>
        <button type="submit" className={styles.primary} disabled={Boolean(busy) || consentNote.trim().length < 8}>{busy === "consent" ? "Saving..." : "Record permission"}</button>
      </form>}
      <ol ref={historyRef} className={styles.messages} aria-label="SMS message history">{conversation.messages.length ? conversation.messages.map((message) => <li key={message.id} className={message.direction === "outbound" ? styles.outbound : styles.inbound}>
        <div className={styles.messageMeta}><strong>{message.direction === "inbound" ? "Customer" : message.senderName || "Your business"}</strong><span>{message.direction === "inbound" ? "Received" : statusLabels[message.status] || "Status pending"}</span></div>
        <p>{message.body}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time>
        {conversation.canManageConnection && message.workOrderId && <small className={styles.jobLabel}>{conversation.jobs.find(job => job.id === message.workOrderId)?.jobNumber || "Linked job"}</small>}
        {conversation.canManageConnection && message.direction === "inbound" && !message.workOrderId && conversation.jobs.length > 0 && <div className={styles.linkReply}>
          <small>Business only. Link this reply to share it with the job&apos;s team.</small>
          <label><span>Job for this reply</span><select aria-label={`Job for reply ${message.id}`} value={replyJobs[message.id] || ""} disabled={Boolean(busy)} onChange={event => setReplyJobs(current => ({ ...current, [message.id]: event.target.value }))}><option value="">Choose job</option>{conversation.jobs.map(job => <option key={job.id} value={job.id}>{job.jobNumber}</option>)}</select></label>
          <button type="button" className={styles.secondary} disabled={Boolean(busy) || !replyJobs[message.id]} onClick={() => void linkReply(message.id)}>Link reply</button>
        </div>}
      </li>) : <li className={styles.empty}>No messages yet. Replies will appear here.</li>}</ol>
      {conversation.connection?.status === "connected" && conversation.customerPhone && conversation.consent === "allowed" && <form className={styles.form} onSubmit={(event) => void send(event)}>
        <label><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={480} rows={3} required disabled={Boolean(busy) || Boolean(pending)} placeholder="Write a service update for this customer" /></label>
        <div className={styles.composerFooter}><small>{body.length}/480 characters. Business name{workOrderId ? ", job number" : ""} and STOP instructions are added automatically. Longer messages cost more than one SMS.</small><button type="submit" className={styles.primary} disabled={Boolean(busy) || !body.trim()}>{busy === "send" ? "Checking..." : pending ? "Check this message" : "Send SMS"}</button></div>
      </form>}
    </>}
  </section>;
}
