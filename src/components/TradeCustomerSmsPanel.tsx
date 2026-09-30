"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { TradeSmsConnection } from "./TradeSmsConnectionPanel";
import { smsSegments, tradeSmsBody } from "@/lib/trade-sms";
import styles from "./TradeSms.module.css";
import { MessageTicks } from "./TradeMessageReceipt";

type SmsMessage = { id: string; requestId: string; direction: "inbound" | "outbound"; body: string; status: string; createdAt: string; workOrderId: string; senderName: string };
type Conversation = { connection: TradeSmsConnection | null; customerPhone: string; consent: "required" | "allowed" | "opted_out"; messages: SmsMessage[];
  canManageConnection: boolean; jobNumber: string; jobs: Array<{ id: string; jobNumber: string }>;
  businessName: string; partPriceMicro: number; balanceMicro: number; marketingConsent: "required" | "allowed" };
type SmsResult = Partial<Conversation> & { ok?: boolean; error?: string; message?: SmsMessage };
const statusLabels: Record<string, string> = {
  accepted: "Accepted by provider", queued: "Queued", sending: "Sending", sent: "Sent to carrier", delivered: "Delivered",
  failed: "Failed", undelivered: "Not delivered", unknown: "Delivery not confirmed", reserved: "Preparing", received: "Received", canceled: "Cancelled",
};

export function TradeCustomerSmsPanel({ user, customerId, workOrderId = "", getAuthHeaders, onOpenIntegrations, onAccountChange, embedded = false }: {
  user?: User; customerId: string; workOrderId?: string; getAuthHeaders?: () => Promise<Record<string, string>>; onOpenIntegrations?: () => void; onAccountChange?: () => void; embedded?: boolean;
}) {
  const fetch = useTradeBusinessFetch();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [body, setBody] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [marketingNote, setMarketingNote] = useState("");
  const [purpose, setPurpose] = useState<"service" | "marketing">("service");
  const [replyJobs, setReplyJobs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ requestId: string; body: string; purpose: "service" | "marketing" } | null>(null);
  const pendingRequest = useRef<{ requestId: string; body: string; purpose: "service" | "marketing" } | null>(null);
  const inFlight = useRef(false);
  const loadingRequest = useRef<Promise<Conversation> | null>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const latestMessageId = conversation?.messages.at(-1)?.id;
  const managed = conversation?.connection?.provider === "clicksend";
  let outgoingBody = "";
  if (body.trim()) {
    try { outgoingBody = tradeSmsBody(body, conversation?.businessName || "Your trade business") + (conversation?.jobNumber ? `\nJob ${conversation.jobNumber}` : ""); }
    catch { /* Invalid message characters are blocked before sending. */ }
  }
  const parts = outgoingBody ? smsSegments(outgoingBody) : 0;
  const costMicro = parts * (conversation?.partPriceMicro || 0);
  const insufficientCredit = Boolean(managed && conversation && conversation.balanceMicro < costMicro);
  const price = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(costMicro / 1_000_000);

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
  }, [fetch, user, customerId, workOrderId, getAuthHeaders]);

  const load = useCallback(() => {
    if (loadingRequest.current) return loadingRequest.current;
    loadingRequest.current = (async (): Promise<Conversation> => {
      const { response, result } = await request();
      if ([401, 403].includes(response.status)) setConversation(null);
      if (!response.ok || !result.ok || !result.messages || !result.consent) throw new Error(result.error || "Messages could not be loaded.");
      return { connection: result.connection || null, customerPhone: result.customerPhone || "", consent: result.consent, messages: result.messages,
        canManageConnection: result.canManageConnection === true, jobNumber: result.jobNumber || "", jobs: result.jobs || [],
        businessName: result.businessName || "", partPriceMicro: result.partPriceMicro || 0, balanceMicro: result.balanceMicro || 0, marketingConsent: result.marketingConsent === "allowed" ? "allowed" : "required" };
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

  async function recordMarketingConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy("marketing_consent"); setStatus("");
    try {
      const { response, result } = await request({ action: "marketing_consent", consentNote: marketingNote.trim() });
      if (!response.ok || !result.ok) throw new Error(result.error || "Review and feedback permission could not be saved.");
      updateConversation(await load()); setMarketingNote(""); setStatus("Review and feedback SMS permission recorded.");
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
    if (inFlight.current || !body.trim() || (!pending && (!outgoingBody || insufficientCredit || (purpose === "marketing" && conversation?.marketingConsent !== "allowed")))) return;
    const submission = pending || { requestId: crypto.randomUUID(), body: body.trim(), purpose };
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
    } finally { inFlight.current = false; setBusy(""); onAccountChange?.(); }
  }

  return <section className={`${styles.panel} ${styles.customerConversation}${embedded ? ` ${styles.embeddedConversation}` : ""}`} aria-label="Customer SMS">
    <div className={styles.conversationContext}>
    <header className={styles.conversationHeading}>
      {!embedded && <><span className={styles.conversationIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" fill="currentColor" /><path d="M7 10h8M7 14h5" stroke="var(--trade-surface, #fff)" strokeWidth="1.7" strokeLinecap="round" /></svg></span>
      <div className={styles.conversationIdentity}><h4>SMS conversation</h4><small>{conversation?.customerPhone || "Customer texting"}{conversation?.jobNumber ? ` · ${conversation.jobNumber}` : ""}</small></div></>}
      <button type="button" className={`${styles.secondary} ${styles.refreshConversation}`} disabled={Boolean(busy) || loading} onClick={() => void refresh()}>{busy === "refresh" ? "Refreshing..." : "Refresh"}</button>
    </header>
    {status && <p className={`${styles.notice} ${styles.conversationNotice}`} role="status">{status}</p>}
    {loading ? <p className={styles.conversationLoading}>Loading messages...</p> : conversation && <>
      {!conversation.connection ? <div className={`${styles.notice} ${styles.setupTexting}`}><strong>Set up customer texting</strong><p>{conversation.canManageConnection ? "Rent an Australian business number to send texts and receive replies here. You can add credit before renting your number." : "Ask the business owner to connect the business SMS number."}</p>{conversation.canManageConnection && onOpenIntegrations && <button type="button" className={styles.primary} onClick={onOpenIntegrations}>Set up SMS</button>}</div> : <details className={styles.conversationDetails}><summary><span className={styles.connectionDot} data-connected={conversation.connection.status === "connected"} />From {conversation.connection.number}<span className={styles.detailsLabel}>Details</span></summary><p>The business can see and reply to these messages. {conversation.connection.usedSegments} of {conversation.connection.dailyLimit} daily SMS segments used.</p></details>}
      {conversation.connection && conversation.connection.status !== "connected" && <div className={styles.notice}><p>SMS routing is not confirmed. The business owner needs to reconnect the number before messages can be sent.</p>{conversation.canManageConnection && onOpenIntegrations && <button type="button" className={styles.secondary} onClick={onOpenIntegrations}>Check SMS connection</button>}</div>}
      {!conversation.customerPhone && <p className={styles.notice}>Save a valid Australian mobile number in Customer details to use SMS.</p>}
      {conversation.connection?.accountType.toLowerCase() === "trial" && <p className={styles.notice}>Twilio trial: this customer&apos;s number must be verified in your Twilio account.</p>}
      {conversation.consent === "opted_out" && <p className={styles.notice}>This customer has opted out. Messages are blocked. They can text START to your connected SMS number to resume.</p>}
      {conversation.connection?.status === "connected" && conversation.customerPhone && conversation.consent === "required" && <form className={`${styles.form} ${styles.consentCard}`} onSubmit={(event) => void recordConsent(event)}>
        <p>Record the customer&apos;s permission before sending service SMS. This does not give permission for marketing.</p>
        <label><span>How and when did they agree to service SMS?</span><textarea required minLength={8} maxLength={500} rows={2} value={consentNote} onChange={(event) => setConsentNote(event.target.value)} placeholder="For example: agreed by phone today to appointment updates." disabled={Boolean(busy)} /></label>
        <button type="submit" className={styles.primary} disabled={Boolean(busy) || consentNote.trim().length < 8}>{busy === "consent" ? "Saving..." : "Record permission"}</button>
      </form>}
      {managed && conversation.connection?.status === "connected" && conversation.customerPhone && conversation.consent === "allowed" && conversation.marketingConsent !== "allowed" && <details className={styles.permission}>
        <summary>Permission for review and feedback texts</summary>
        <form className={styles.form} onSubmit={event => void recordMarketingConsent(event)}>
          <p>Service updates do not give permission for review requests or marketing. Record the customer&apos;s separate agreement before sending those texts.</p>
          <label><span>How and when did they agree to review and feedback SMS?</span><textarea required minLength={8} maxLength={500} rows={2} value={marketingNote} disabled={Boolean(busy) || Boolean(pending)} onChange={event => setMarketingNote(event.target.value)} placeholder="For example: agreed to a review request in the booking form today." /></label>
          <button type="submit" className={styles.secondary} disabled={Boolean(busy) || Boolean(pending) || marketingNote.trim().length < 8}>{busy === "marketing_consent" ? "Saving..." : "Record review permission"}</button>
        </form>
      </details>}
    </>}
    </div>
    {!loading && conversation && <>
      <ol ref={historyRef} className={`${styles.messages} ${styles.conversationHistory}`} aria-label="SMS message history">{conversation.messages.length ? conversation.messages.map((message) => <li key={message.id} className={message.direction === "outbound" ? styles.outbound : styles.inbound}>
        <div className={styles.bubbleSender}>{message.direction === "inbound" ? "Customer" : message.senderName || "Your business"}</div>
        <p className={styles.messageBubble}>{message.body}</p>
        <div className={styles.bubbleReceipt}><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time><span data-attention={["unknown", "failed", "undelivered"].includes(message.status)}>{message.direction === "outbound" && (message.status === "sent" || message.status === "delivered") && <MessageTicks status={message.status} />}{message.direction === "inbound" ? "Received" : statusLabels[message.status] || "Status pending"}</span>{conversation.canManageConnection && message.workOrderId && <span>{conversation.jobs.find(job => job.id === message.workOrderId)?.jobNumber || "Linked job"}</span>}</div>
        {conversation.canManageConnection && message.direction === "inbound" && !message.workOrderId && conversation.jobs.length > 0 && <details className={styles.replyDetails}><summary>Link reply to a job</summary><div className={styles.linkReply}>
          <small>Business only. Link this reply to share it with the job&apos;s team.</small>
          <label><span>Job for this reply</span><select aria-label={`Job for reply ${message.id}`} value={replyJobs[message.id] || ""} disabled={Boolean(busy)} onChange={event => setReplyJobs(current => ({ ...current, [message.id]: event.target.value }))}><option value="">Choose job</option>{conversation.jobs.map(job => <option key={job.id} value={job.id}>{job.jobNumber}</option>)}</select></label>
          <button type="button" className={styles.secondary} disabled={Boolean(busy) || !replyJobs[message.id]} onClick={() => void linkReply(message.id)}>Link reply</button>
        </div></details>}
      </li>) : <li className={styles.empty}><span className={styles.emptyMessageIcon} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M26 15.5A10.5 10.5 0 0 1 15.5 26H8l-5 3V15.5a11.5 11.5 0 1 1 23 0Z" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="20" cy="15" r="1.2" fill="currentColor" /></svg></span><strong>Your conversation starts here</strong><span>No messages yet. Replies will appear here.</span></li>}</ol>
      {conversation.connection?.status === "connected" && conversation.customerPhone && conversation.consent === "allowed" && <form className={`${styles.form} ${styles.textComposer}`} onSubmit={(event) => void send(event)}>
        {managed && <div className={styles.composerToolbar}><label><span className={styles.visuallyHidden}>Message purpose</span><select aria-label="Message purpose" value={purpose} disabled={Boolean(busy) || Boolean(pending)} onChange={event => setPurpose(event.target.value === "marketing" ? "marketing" : "service")}><option value="service">Service update</option><option value="marketing" disabled={conversation.marketingConsent !== "allowed"}>Review or feedback request{conversation.marketingConsent !== "allowed" ? " (permission needed)" : ""}</option></select></label><small>SMS</small></div>}
        <div className={styles.composerInput}><label><span className={styles.visuallyHidden}>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={480} rows={2} required disabled={Boolean(busy) || Boolean(pending)} placeholder="Text message" /></label><button type="submit" className={`${styles.primary} ${styles.sendText}`} disabled={Boolean(busy) || !body.trim() || (!pending && (!outgoingBody || insufficientCredit || (purpose === "marketing" && conversation.marketingConsent !== "allowed")))}>{busy === "send" ? "Checking..." : pending ? "Check this message" : "Send SMS"}</button></div>
        {managed && <div className={styles.messagePrice} aria-live="polite"><span>{parts} SMS {parts === 1 ? "part" : "parts"} · {price} including GST</span><small>9¢ + GST per part</small></div>}
        {insufficientCredit && !pending && <p className={styles.notice}>There is not enough SMS credit for this message. Ask the business owner to top up.</p>}
        {body.trim() && !outgoingBody && <p className={styles.notice}>Remove unsupported control characters before sending.</p>}
        <div className={styles.composerNote}><details><summary>Business name and STOP added automatically</summary><small>Business name{workOrderId ? ", job number" : ""} and STOP instructions are added automatically. Longer messages and emoji can use more than one SMS part.</small></details><small>{body.length}/480</small></div>
      </form>}
    </>}
  </section>;
}
