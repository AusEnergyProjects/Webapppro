"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import type { TradeHubQuestion } from "@/lib/customer-quote-hub";
import styles from "./TradeCustomerHubPanel.module.css";
import { TradeCustomerHubAssist } from "./TradeCustomerHubAssist";

type Result = { ok?: boolean; available?: boolean; accepting?: boolean; canAsk?: boolean; questions?: TradeHubQuestion[]; error?: string;
  interested?: boolean; interestRevision?: number; canManageInterest?: boolean; workOrderId?: string; customerId?: string };
type CustomerQaTarget = { customerId: string; workOrderId: string };
type RequestKind = TradeHubQuestion["kind"];
type Scope = { workOrderId: string; matchId?: never } | { matchId: string; workOrderId?: never };
type Operation = "ask" | "interest" | `reply:${string}`;
type SharedFile = TradeHubQuestion["files"][number];
type SharedFileSelection = { file: SharedFile; question: string };
type PanelProps = Scope & { interestOnly?: boolean; onOpenQa?: (target: CustomerQaTarget) => void; disabled?: boolean; questionId?: string; navigationNonce?: number };
const requestKinds: { kind: RequestKind; label: string }[] = [
  { kind: "text", label: "Answer" }, { kind: "photo", label: "Photo" }, { kind: "document", label: "Document" },
];
const starters: { label: string; kind: RequestKind; prompt: string }[] = [
  { label: "Switchboard photo", kind: "photo", prompt: "Please share a clear photo of the switchboard." },
  { label: "Document", kind: "document", prompt: "Please upload the plans or documents for this work." },
];

export function TradeCustomerHubPanel({ workOrderId, questionId, navigationNonce }: { workOrderId: string; questionId?: string; navigationNonce?: number }) {
  const business = useTradeBusiness();
  return <Panel key={`${business?.ownerUid || ""}:${workOrderId}`} workOrderId={workOrderId} questionId={questionId} navigationNonce={navigationNonce} />;
}

export function TradeCustomerHubInterest({ matchId, onOpenQa, disabled = false }: {
  matchId: string; onOpenQa: (target: CustomerQaTarget) => void; disabled?: boolean;
}) {
  const business = useTradeBusiness();
  return <Panel key={`${business?.ownerUid || ""}:match:${matchId}`} matchId={matchId} interestOnly onOpenQa={onOpenQa} disabled={disabled} />;
}

function Panel(props: PanelProps) {
  const business = useTradeBusiness();
  const [user, setUser] = useState<User | null>(firebaseAuth.currentUser);
  useEffect(() => onIdTokenChanged(firebaseAuth, setUser), []);
  if (!user?.emailVerified) return <p className={styles.status} role="status">Sign in with your verified account to open Customer Q&amp;A.</p>;
  if (!business?.ownerUid) return <p className={styles.status} role="status">Choose your business to open Customer Q&amp;A.</p>;
  return <AuthenticatedPanel key={`${user.uid}:${business.ownerUid}`} {...props} user={user} />;
}

function AuthenticatedPanel({ user, workOrderId, matchId, interestOnly = false, onOpenQa, disabled = false, questionId, navigationNonce }: PanelProps & { user: User }) {
  const businessRequest = useTradeBusinessFetch();
  const [data, setData] = useState<Result | null>(null);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<RequestKind>("text");
  const [busy, setBusy] = useState<"" | Operation>("");
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SharedFileSelection | null>(null);
  const generation = useRef(0), active = useRef(true), acting = useRef(false);
  const cancellation = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const questionElements = useRef<Record<string, HTMLDetailsElement | null>>({});
  const appliedQuestion = useRef("");
  const endpoint = `/api/trade-customer-hub?${matchId ? `matchId=${encodeURIComponent(matchId)}` : `workOrderId=${encodeURIComponent(workOrderId || "")}`}`;
  const questions = data?.questions || [];
  const duplicate = prompt.trim() ? questions.find(question => question.prompt.trim().toLowerCase() === prompt.trim().toLowerCase()) : undefined;
  const canWrite = Boolean(data?.interested && data.accepting && data.canAsk);
  useEffect(() => {
    const target = questionId && data?.questions?.some(question => question.id === questionId) ? questionElements.current[questionId] : null;
    const key = `${navigationNonce}:${questionId}`;
    if (!target || appliedQuestion.current === key) return;
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.querySelector("summary")?.focus({ preventScroll: true });
    appliedQuestion.current = key;
  }, [data, questionId, navigationNonce]);
  const isCurrent = useCallback(() => active.current && firebaseAuth.currentUser?.uid === user.uid && firebaseAuth.currentUser.emailVerified, [user.uid]);
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const currentUser = firebaseAuth.currentUser, controller = cancellation.current;
    if (!currentUser || !isCurrent() || !controller || controller.signal.aborted) throw new Error("Sign in again to open Customer Q&A.");
    const token = await currentUser.getIdToken();
    if (!token || !isCurrent() || controller.signal.aborted) throw new Error("Your account changed. Reopen Customer Q&A.");
    const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${token}`);
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    const response = await businessRequest(path, { ...init, headers, signal });
    if (!isCurrent() || signal.aborted) throw new Error("Your account changed. Reopen Customer Q&A.");
    return response;
  }, [businessRequest, isCurrent]);

  const load = useCallback(async () => {
    if (acting.current) return;
    const current = ++generation.current;
    try {
      const response = await request(endpoint, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!isCurrent() || current !== generation.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "Shared requests could not be opened.");
      setData(result);
      setPreview(current => current && result.questions?.some(question => question.files.some(file => file.id === current.file.id)) ? current : null);
    } catch (error) {
      if (!isCurrent() || current !== generation.current) return;
      setData(null); setMessage(error instanceof Error ? error.message : "Shared requests could not be opened.");
    }
  }, [request, endpoint, isCurrent]);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController(); cancellation.current = controller;
    const refresh = () => void load();
    refresh(); window.addEventListener("focus", refresh);
    return () => { active.current = false; controller.abort(); window.removeEventListener("focus", refresh); };
  }, [load]);

  function begin(operation: Operation) {
    if (!isCurrent() || acting.current) return false;
    acting.current = true; ++generation.current; setBusy(operation); setMessage("");
    return true;
  }
  function finish() {
    acting.current = false;
    if (isCurrent()) { setBusy(""); void load(); }
  }
  async function save(method: "POST" | "PATCH", body: object) {
    const response = await request("/api/trade-customer-hub", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as Result;
    if (!response.ok || !result.ok) {
      if (isCurrent() && [401, 403, 404].includes(response.status)) setData(null);
      throw new Error(result.error || "The request could not be shared.");
    }
    if (isCurrent()) setData(result);
    return result;
  }
  function openQa(result: Result) {
    if (!isCurrent()) return;
    if (!result.customerId || !result.workOrderId) throw new Error("Customer Q&A could not be opened. Try Interested again to reopen the same customer safely.");
    onOpenQa?.({ customerId: result.customerId, workOrderId: result.workOrderId });
  }
  async function toggleInterest() {
    if (disabled || !data?.canManageInterest || !Number.isSafeInteger(data.interestRevision) || !begin("interest")) return;
    try {
      const result = await save("PATCH", { ...(matchId ? { matchId } : { workOrderId }), interested: !data.interested, revision: data.interestRevision });
      if (isCurrent() && interestOnly && result.interested) openQa(result);
      if (isCurrent()) setMessage(data.interested ? "Customer updates are off. Existing quotes and records are unchanged." : "You're interested. Customer Q&A updates will appear in your notifications.");
    } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "Could not change interest."); }
    finally { finish(); }
  }
  async function ask() {
    if (!canWrite || duplicate || prompt.trim().length < 5 || !begin("ask")) return;
    try {
      await save("POST", { workOrderId: data?.workOrderId || workOrderId, prompt: prompt.trim(), kind });
      if (!isCurrent()) return;
      setPrompt(""); setMessage("Request added to the customer's project.");
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "Could not add request.");
    } finally { finish(); }
  }
  async function reply(questionId: string) {
    const body = (replies[questionId] || "").trim();
    if (!canWrite || !body || !begin(`reply:${questionId}`)) return;
    try {
      await save("POST", { workOrderId: data?.workOrderId || workOrderId, action: "reply", questionId, body });
      if (!isCurrent()) return;
      setReplies(current => { const next = { ...current }; delete next[questionId]; return next; });
      setMessage("Reply shared with the customer and participating businesses.");
    } catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "Could not share reply."); }
    finally { finish(); }
  }
  const closePreview = useCallback(() => setPreview(null), []);

  if (!data?.available) return interestOnly ? <div className={styles.panel}><p className={styles.status} role="status">{message || (data ? "Customer Q&A is unavailable for this lead." : "Loading lead interest...")}</p>
    {(message || data) && <button type="button" onClick={() => void load()}>Retry</button>}</div> : message ? <p className={styles.status} role="status">{message}</p> : null;
  return <section className={styles.panel} aria-label="Shared customer requests" aria-busy={Boolean(busy)}>
    {interestOnly ? <div className={styles.interest}><div><strong>Interested in this job?</strong><small>{data.interested ? "Updates are on. Click Interested to open Customer Q&A." : "Interested adds the customer, turns on updates and opens Customer Q&A."}</small></div>
      <div className={styles.leadInterest} role="group" aria-label="Lead interest">
        <button type="button" aria-pressed={!data.interested} disabled={disabled || Boolean(busy) || !data.canManageInterest || !data.interested} onClick={() => void toggleInterest()}>Not interested</button>
        <button type="button" aria-pressed={Boolean(data.interested)} className={styles.primary} disabled={disabled || Boolean(busy) || !data.canManageInterest}
          onClick={() => { if (!data.interested) void toggleInterest(); else { try { openQa(data); } catch (error) { setMessage(error instanceof Error ? error.message : "Customer Q&A could not be opened."); } } }}>{busy === "interest" ? "Saving..." : "Interested"}</button>
      </div></div> : <div className={styles.interest}><div><strong>Customer Q&amp;A updates</strong><small>{data.interested ? "Receive updates for this customer's shared questions and files." : "Choose Interested to receive updates and join the conversation."}</small></div>
      <button type="button" role="switch" aria-label="Interested in customer updates" aria-checked={Boolean(data.interested)} disabled={Boolean(busy) || !data.canManageInterest}
        onClick={() => void toggleInterest()}>{busy === "interest" ? "Saving…" : data.interested ? "Interested" : "Not interested"}</button></div>}
    {!interestOnly && <><header className={styles.heading}><h4>Ask customer</h4><p>Answers and files are shared with invited businesses. Quote pricing stays private.</p></header>
    {!data.accepting ? <p className={styles.status} role="status">The customer has closed quotes and questions. Existing records remain available.</p>
      : data.canAsk ? <div className={styles.composer}>
        <div className={styles.kinds} role="group" aria-label="Request type">{requestKinds.map(option => <button key={option.kind} type="button"
          aria-pressed={kind === option.kind} disabled={Boolean(busy) || !data.interested} onClick={() => setKind(option.kind)}>{option.label}</button>)}</div>
        <div className={styles.starters} role="group" aria-label="Quick request starters"><span>Start with</span>{starters.map(starter => <button key={starter.label} type="button" disabled={Boolean(busy) || !data.interested}
          onClick={() => { setKind(starter.kind); setPrompt(starter.prompt); setMessage(""); input.current?.focus(); }}>{starter.label}</button>)}</div>
        <label className={styles.prompt}>What do you need?<textarea ref={input} maxLength={500} rows={2} disabled={Boolean(busy) || !data.interested} value={prompt}
          onChange={event => setPrompt(event.target.value)} placeholder="Type a question or choose a starter above." /></label>
        {duplicate && <p className={styles.duplicate} role="status">This request is already shared. Its {duplicate.answer || duplicate.files.length ? "answer or files" : "status"} is shown below.</p>}
        <div className={styles.actions}><small>The customer sees this in their private project.</small><button type="button" className={styles.primary}
          disabled={Boolean(busy) || !canWrite || prompt.trim().length < 5 || Boolean(duplicate)} onClick={() => void ask()}>{busy === "ask" ? "Adding…" : "Ask customer"}</button></div>
      </div> : <p className={styles.status}>{data.interested ? "You can view shared requests. Quote management permission is needed to ask a question." : "Turn on Interested to ask questions and reply."}</p>}
    {data.interested && data.canAsk && workOrderId && <TradeCustomerHubAssist workOrderId={workOrderId} questions={questions} onOpenQuestion={id => { const element = questionElements.current[id]; if (element) { element.open = true; element.scrollIntoView({ behavior: "smooth", block: "center" }); element.querySelector("summary")?.focus({ preventScroll: true }); } }} />}
    {questions.length > 0 && <div className={styles.history}><h5>Customer answers &amp; uploads <span>{questions.length}</span></h5><p className={styles.historyHelp}>Replies and uploaded files appear below the question they answer.</p>{questions.map(question => <details className={styles.question} key={question.id} ref={element => { questionElements.current[question.id] = element; }} open={questionId === question.id || duplicate?.id === question.id || question.files.length > 0 || undefined}>
      <summary><strong>{question.prompt}</strong><span>{question.files.length ? `${question.files.length} customer ${question.files.length === 1 ? "file" : "files"}` : question.answer || question.replies.length ? "Replied" : question.authorType === "customer" ? "Customer question" : "Awaiting reply"}</span></summary>
      <div className={styles.answer}><small>{question.authorType === "customer" ? "Asked by customer" : "Shared business question"}</small>{question.answer && <p>{question.answer}</p>}
        {question.replies.map(item => <div className={styles.reply} key={item.id}><small>{item.authorType === "customer" ? "Customer" : "Business"}</small><p>{item.body}</p></div>)}
        {question.files.length > 0 && <section className={styles.uploads} aria-label="Customer uploads"><strong>Customer uploads</strong><p>Shared here for quoting. Select a file to preview it.</p><div className={styles.files}>{question.files.map(file => <button key={file.id} type="button" className={styles.fileCard} disabled={Boolean(busy)} aria-label={`${file.type === "application/pdf" ? "View PDF" : "View photo"}: ${file.name}`} onClick={() => setPreview({ file, question: question.prompt })}>
          <span className={styles.fileKind} aria-hidden="true">{file.type === "application/pdf" ? "PDF" : "Photo"}</span><span><strong>{file.type === "application/pdf" ? "View PDF" : "View photo"}</strong><small>{file.name}</small></span><span aria-hidden="true">↗</span>
        </button>)}</div></section>}
        {canWrite && <div className={styles.replyComposer}><label>Reply<textarea rows={2} maxLength={2000} value={replies[question.id] || ""} disabled={Boolean(busy)}
          onChange={event => setReplies(current => ({ ...current, [question.id]: event.target.value }))} /></label><button type="button" disabled={Boolean(busy) || !(replies[question.id] || "").trim()}
          onClick={() => void reply(question.id)}>{busy === `reply:${question.id}` ? "Sharing…" : "Share reply"}</button></div>}
      </div>
    </details>)}</div>}</>}
    {message && <p className={styles.status} role="status">{message}</p>}
    {preview && <SharedFilePreview key={preview.file.id} selection={preview} endpoint={endpoint} request={request} isCurrent={isCurrent} onClose={closePreview} />}
  </section>;
}

function SharedFilePreview({ selection: { file, question }, endpoint, request, isCurrent, onClose }: {
  selection: SharedFileSelection; endpoint: string; request: (path: string, init?: RequestInit) => Promise<Response>;
  isCurrent: () => boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const pdf = file.type === "application/pdf";
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => {
      element?.close(); document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    const current = () => !controller.signal.aborted && isCurrent();
    void (async () => {
      try {
        const response = await request(`${endpoint}&fileId=${encodeURIComponent(file.id)}`, { cache: "no-store", signal: controller.signal });
        if (!current()) return;
        if (!response.ok) throw new Error("This shared file is no longer available. Close the preview and refresh Customer Q&A.");
        const blob = await response.blob();
        if (!current()) return;
        if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(blob.type) || blob.type !== file.type) throw new Error("This file could not be safely previewed.");
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : "The preview could not be opened."); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [endpoint, file.id, file.type, isCurrent, request]);
  return <dialog ref={dialog} className={styles.preview} aria-label={pdf ? "Customer PDF preview" : "Customer photo preview"}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.previewLayout}><header><div><span>Customer upload</span><h2>{pdf ? "Document preview" : "Photo preview"}</h2><p>{question}</p></div><button type="button" onClick={onClose} aria-label="Close file preview" autoFocus>Close</button></header>
      <div className={styles.previewContent} aria-busy={!url && !error}>
        {!url && !error && <p role="status">Opening customer {pdf ? "document" : "photo"}...</p>}
        {error && <p role="alert">{error}</p>}
        {/* Chrome blocks its native PDF viewer in sandboxed iframes. Only an authenticated,
            exact application/pdf blob is allowed here; HTML and SVG are never embedded. */}
        {url && (pdf ? <iframe title={`Customer document: ${file.name}`} src={url} referrerPolicy="no-referrer" />
          // Authenticated local object URL, revoked when this preview closes.
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={url} alt={`Customer photo for: ${question}`} onError={() => setError("This photo could not be displayed. You can download the file below.")} />)}
      </div><footer><small>{file.name}</small>{url && <a href={url} download={file.name} onClick={event => { if (!isCurrent()) { event.preventDefault(); onClose(); } }}>Download</a>}</footer>
    </div>
  </dialog>;
}
