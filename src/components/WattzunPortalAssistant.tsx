"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { readTradeBusinessSelection, TRADE_BUSINESS_SELECTION_CHANGED_EVENT } from "@/lib/trade-business-client";
import { wattzunPortalForPath } from "@/lib/wattzun-portal-path";
import { parseWattzunRecordLookup } from "@/lib/wattzun-records";
import { parseWattzunActionProposal, type WattzunActionReceipt, type WattzunActionProposal } from "@/lib/wattzun-actions";
import {
  WATTZUN_REALTIME_VOICE_STREAM_TYPE, wattzunSpokenReply,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurn, type WattzunTurnInput,
} from "@/lib/wattzun-portal";
import { WATTZUN_OPEN_EVENT, WATTZUN_READY_EVENT, WATTZUN_USAGE_CHANGED_EVENT, readWattzunOpenRequest, useWattzunPresentation, type WattzunOpenRequest } from "@/lib/wattzun-appearance";
import { createWattzunBrowserVoiceEnvironment, WattzunVoiceCall, type WattzunCallStatus } from "@/lib/wattzun-voice-client";
import { readWattzunVoiceStream } from "@/lib/wattzun-voice-stream";
import { wattzunConversationHistory } from "@/lib/wattzun-conversation";
import { EnergyAssistantLauncher } from "./EnergyAssistantLauncher";
import { WattzunMascot } from "./WattzunMascot";
import { WattzunRecordPicker } from "./WattzunRecordPicker";
import { WattzunActionReview } from "./WattzunActionReview";
import styles from "./WattzunPortalAssistant.module.css";

type Message = WattzunTurn & { id: string; reply?: WattzunReply; reviewDraft?: WattzunActionProposal; requestSummary?: string };
const portalNames: Record<WattzunPortal, string> = { trade: "TLink", council: "Council", creditex: "Creditex" };
const callLabels: Record<WattzunCallStatus["state"], string> = {
  idle: "Ready to call", permission: "Microphone permission", connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Wattzun is speaking", muted: "Microphone muted", confirming: "Continue this call?", ended: "Call ended", error: "Call could not continue",
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isReply(value: unknown): value is WattzunReply {
  if (record(value) && value.action !== undefined && value.action !== null) {
    try { parseWattzunActionProposal(value.action); } catch { return false; }
  }
  if (record(value) && value.lookup !== undefined && value.lookup !== null) {
    try { parseWattzunRecordLookup(value.lookup); } catch { return false; }
  }
  return record(value) && (value.kind === "answer" || value.kind === "clarification") && typeof value.message === "string"
    && Array.isArray(value.questions) && value.questions.every(question => typeof question === "string")
    && Array.isArray(value.links) && value.links.every(link => record(link) && typeof link.label === "string" && typeof link.href === "string" && /^\/(?!\/)/.test(link.href));
}
function workspaceHref(href: string, scope: WattzunScope, actorUid: string, pathname: string): string {
  if (scope.portal !== "trade" || !/^\/direct-trade\/(dashboard|team)(?=[?#]|$)/.test(href)) return href;
  const workspacePath = /^\/direct-trade\/(dashboard|team)\/?$/.test(pathname) ? pathname.replace(/\/$/, "") : actorUid === scope.scopeId ? "/direct-trade/dashboard" : "/direct-trade/team";
  return href.replace(/^\/direct-trade\/(dashboard|team)/, workspacePath);
}
async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(payload) || payload.ok !== true) {
    throw new Error(record(payload) && typeof payload.error === "string" ? payload.error : "Wattzun could not complete that request. Try again.");
  }
  return payload;
}
export function WattzunPortalAssistant({ portal }: { portal: WattzunPortal }) {
  const [user, setUser] = useState<User | null>(null);
  const currentActor = useRef<User | null>(null);
  const selectedBusiness = useRef<string | null>(null);
  const [scopes, setScopes] = useState<WattzunScope[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [open, setOpen] = useState(false);
  const [openRequest, setOpenRequest] = useState<(WattzunOpenRequest & { id: string }) | null>(null);
  const scope = scopes.find(candidate => candidate.scopeId === scopeId);
  const appearance = useWattzunPresentation(user && scope ? { userUid: user.uid, portal, scopeId: scope.scopeId } : null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => { setOpen(false); setOpenRequest(null); }, []);
  const expand = useCallback(() => { setOpenRequest(null); setOpen(true); }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, authenticated => {
    currentActor.current = authenticated?.emailVerified ? authenticated : null;
    selectedBusiness.current = null;
    setUser(currentActor.current);
    setScopes([]); setScopeId(""); setOpen(false); setOpenRequest(null);
  }), []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const payload = await responsePayload(await fetch(`/api/wattzun/portal?portal=${portal}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }));
        if (controller.signal.aborted || currentActor.current?.uid !== user.uid || !Array.isArray(payload.scopes)) return;
        const authorizedScopes = payload.scopes.filter((scope): scope is WattzunScope => record(scope) && scope.portal === portal && typeof scope.scopeId === "string" && typeof scope.label === "string"
          && (scope.personalName === undefined || typeof scope.personalName === "string"));
        setScopes(authorizedScopes);
        const saved = portal === "trade" ? selectedBusiness.current ?? readTradeBusinessSelection(user.uid) : "";
        setScopeId(authorizedScopes.find(scope => scope.scopeId === saved)?.scopeId || (selectedBusiness.current === null && authorizedScopes.length === 1 ? authorizedScopes[0].scopeId : ""));
      } catch { if (!controller.signal.aborted) setScopes([]); }
    })();
    return () => controller.abort();
  }, [user, portal]);

  useEffect(() => {
    if (!user || !scopes.length) return;
    const openAssistant = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request = readWattzunOpenRequest(event.detail);
      if (!request || currentActor.current?.uid !== user.uid || request.userUid !== user.uid || request.portal !== portal || (request.scopeId && !scopes.some(candidate => candidate.scopeId === request.scopeId))) return;
      if (request.scopeId) setScopeId(request.scopeId);
      setOpenRequest({ ...request, id: crypto.randomUUID() }); setOpen(true);
      if (typeof event.detail.acknowledge === "function") event.detail.acknowledge();
    };
    window.addEventListener(WATTZUN_OPEN_EVENT, openAssistant);
    window.dispatchEvent(new CustomEvent(WATTZUN_READY_EVENT, { detail: { portal } }));
    return () => window.removeEventListener(WATTZUN_OPEN_EVENT, openAssistant);
  }, [user, scopes, portal]);

  useEffect(() => {
    if (!user || portal !== "trade") return;
    const changeBusiness = (event: Event) => {
      if (!(event instanceof CustomEvent) || !record(event.detail) || event.detail.uid !== currentActor.current?.uid || event.detail.uid !== user.uid || typeof event.detail.ownerUid !== "string") return;
      selectedBusiness.current = event.detail.ownerUid;
      const nextScopeId = scopes.find(candidate => candidate.scopeId === event.detail.ownerUid)?.scopeId || "";
      if (nextScopeId === scopeId) return;
      setScopeId(nextScopeId); setOpen(false); setOpenRequest(null);
    };
    window.addEventListener(TRADE_BUSINESS_SELECTION_CHANGED_EVENT, changeBusiness);
    return () => window.removeEventListener(TRADE_BUSINESS_SELECTION_CHANGED_EVENT, changeBusiness);
  }, [user, portal, scopes, scopeId]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, a[href]") || []).filter(control => control.getClientRects().length > 0);
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open, dismiss]);

  if (!user || !scopes.length) return null;
  return <>
    <EnergyAssistantLauncher hat={appearance.hat} onPreload={() => {}} onOpen={expand} />
    <div className={open ? styles.backdrop : undefined} onClick={event => { if (open && event.target === event.currentTarget) dismiss(); }}>
      <div className={open ? styles.dialog : styles.docked} role={open ? "dialog" : undefined} aria-modal={open ? "true" : undefined} aria-labelledby={open ? "wattzun-portal-title" : undefined} ref={dialog}>
        <header className={styles.header} hidden={!open}>
          <WattzunMascot hat={appearance.hat} />
          <div><h2 id="wattzun-portal-title">Wattzun</h2><p>Your {portalNames[portal]} assistant</p></div>
          <button className={styles.close} type="button" aria-label="Minimise Wattzun" title="Minimise and keep working" ref={closeButton} onClick={dismiss}>−</button>
        </header>
        {scopes.length > 1 && <label className={styles.workspace} hidden={!open}>Workspace<select aria-label="Workspace" value={scopeId} onChange={event => { setScopeId(event.target.value); if (scope) setOpenRequest(null); }}><option value="">Choose a workspace</option>{scopes.map(choice => <option key={choice.scopeId} value={choice.scopeId}>{choice.label}</option>)}</select></label>}
        {scope ? <WattzunConversation key={`${user.uid}:${portal}:${scope.scopeId}`} user={user} scope={scope} openRequest={openRequest} expanded={open} onExpand={expand} onMinimise={dismiss} /> : <p className={styles.empty} hidden={!open}>Choose the workspace you want Wattzun to help with.</p>}
      </div>
    </div>
  </>;
}

function WattzunConversation({ user, scope, openRequest, expanded = true, onExpand, onMinimise }: { user: User; scope: WattzunScope; openRequest?: (WattzunOpenRequest & { id: string }) | null; expanded?: boolean; onExpand?: () => void; onMinimise?: () => void }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const presentation = useWattzunPresentation({ userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId });
  const preferencesRef = useRef({ speed: presentation.speed });
  const [callStatus, setCallStatus] = useState<WattzunCallStatus>({ state: "idle", message: "" });
  const [muted, setMuted] = useState(false);
  const voiceCall = useRef<WattzunVoiceCall | null>(null);
  const textRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const handledRequest = useRef("");
  const callActive = !["idle", "ended", "error"].includes(callStatus.state);

  useEffect(() => { messagesRef.current = messages; scrollEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages]);
  useEffect(() => { preferencesRef.current = { speed: presentation.speed }; }, [presentation.speed]);
  useEffect(() => {
    active.current = true;
    const leave = () => voiceCall.current?.dispose();
    window.addEventListener("pagehide", leave);
    return () => {
      active.current = false;
      textRequest.current?.abort();
      voiceCall.current?.dispose();
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  const append = useCallback((turns: Message[]) => {
    messagesRef.current = [...messagesRef.current, ...turns];
    setMessages(messagesRef.current);
  }, []);
  const navigate = useCallback((href: string) => {
    const destination = workspaceHref(href, scope, user.uid, pathname);
    if (!/^\/(?!\/)/.test(destination)) return;
    const target = new URL(destination, window.location.origin);
    if (target.origin !== window.location.origin || wattzunPortalForPath(target.pathname) !== scope.portal) return;
    if (target.pathname === window.location.pathname) {
      window.history.pushState(window.history.state, "", `${target.pathname}${target.search}${target.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else router.push(destination, { scroll: false });
    onMinimise?.();
  }, [scope, user.uid, pathname, router, onMinimise]);
  const dismissAction = useCallback((messageId: string) => {
    if (!active.current) return;
    messagesRef.current = messagesRef.current.map(message => message.id === messageId && message.reply ? { ...message, reply: { ...message.reply, action: null } } : message);
    setMessages(messagesRef.current);
  }, []);
  const actionCreated = useCallback((messageId: string, receipt: WattzunActionReceipt) => {
    if (!active.current) return;
    dismissAction(messageId);
    const message = receipt.kind === "quote_draft" ? "Your quote draft has been saved in TLink. Open it to review the details." : "The customer has been created in TLink. Open the saved record to review the details.";
    append([{ id: crypto.randomUUID(), role: "assistant", content: message, reply: { kind: "answer", message, questions: [], links: [{ label: receipt.label, href: receipt.href }] } }]);
  }, [append, dismissAction]);
  const requestInput = useCallback((message: string): WattzunTurnInput => ({
    portal: scope.portal, scopeId: scope.scopeId, requestId: crypto.randomUUID(), message,
    history: wattzunConversationHistory(messagesRef.current), preferences: { ...preferencesRef.current },
  }), [scope]);
  async function sendText() {
    const message = draft.trim();
    if (!message || busy || textRequest.current || callActive) return;
    const controller = new AbortController();
    textRequest.current = controller;
    setBusy(true); setError("");
    try {
      const input = requestInput(message);
      const token = await user.getIdToken();
      if (!active.current || controller.signal.aborted) return;
      const payload = await responsePayload(await fetch("/api/wattzun/portal", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal,
      }));
      if (!active.current || controller.signal.aborted) return;
      if (!isReply(payload.reply)) throw new Error("Wattzun returned an unreadable answer. Try again.");
      append([{ id: input.requestId, role: "user", content: message }, { id: `${input.requestId}:reply`, role: "assistant", content: wattzunSpokenReply(payload.reply), reply: payload.reply }]);
      window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT, { detail: { userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId } }));
      setDraft("");
    } catch (requestError) {
      if (active.current && !controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "That question could not be sent. Try again.");
    } finally { if (textRequest.current === controller) { textRequest.current = null; if (active.current) setBusy(false); } }
  }
  const startCall = useCallback(() => {
    if (busy || callActive) return;
    voiceCall.current?.dispose();
    setMuted(false); setError("");
    const call = new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(), {
      status: status => { if (active.current && voiceCall.current === call) setCallStatus(status); },
      async greeting(signal) {
        const token = await user.getIdToken();
        if (signal.aborted) throw new Error("Call ended.");
        const result = await readWattzunVoiceStream(await fetch("/api/wattzun/greeting", { method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ portal: scope.portal, scopeId: scope.scopeId, requestId: crypto.randomUUID(),
            name: scope.personalName || "", preferences: { ...preferencesRef.current } }), signal }), signal, isReply);
        return result.audio;
      },
      async submit(audio, signal) {
        const input = requestInput("");
        const token = await user.getIdToken();
        if (signal.aborted) throw new Error("Call ended.");
        const form = new FormData();
        form.append("request", JSON.stringify(input));
        form.append("audio", audio, "question.wav");
        return readWattzunVoiceStream(await fetch("/api/wattzun/voice", { method: "POST",
          headers: { Authorization: `Bearer ${token}`, Accept: WATTZUN_REALTIME_VOICE_STREAM_TYPE }, body: form, signal }), signal, isReply);
      },
      reply: result => {
        if (!active.current || voiceCall.current !== call) return;
        const id = crypto.randomUUID();
        const turns: Message[] = [{ id: `${id}:reply`, role: "assistant", content: wattzunSpokenReply(result.reply), reply: result.reply,
          ...(result.reply.action ? { reviewDraft: result.reply.action } : {}),
          ...(result.requestSummary ? { requestSummary: result.requestSummary } : {}) }];
        if (result.transcript.trim()) turns.unshift({ id, role: "user", content: result.transcript });
        append(turns);
        if (result.reply.action || result.reply.lookup) onExpand?.();
        window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT, { detail: { userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId } }));
      },
    });
    voiceCall.current = call;
    void call.start();
  }, [busy, callActive, requestInput, user, scope, append, onExpand]);

  useEffect(() => {
    if (!openRequest || !presentation.ready || handledRequest.current === openRequest.id) return;
    const frame = window.requestAnimationFrame(() => {
      if (!active.current || handledRequest.current === openRequest.id) return;
      handledRequest.current = openRequest.id;
      if (openRequest.mode === "call") startCall();
      else { if (openRequest.initialMessage !== undefined) setDraft(openRequest.initialMessage); composer.current?.focus(); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRequest, presentation.ready, startCall]);

  const hangUp = () => { voiceCall.current?.hangUp(); setMuted(false); };
  return <>
    {!expanded && callActive && <div className={`${styles.dockedCall} ${styles.dialog}`} role="region" aria-label="Wattzun call">
      <span role="status"><span className={`${styles.activity} ${callStatus.state === "listening" ? styles.listening : ""}`} />{callLabels[callStatus.state]}</span>
      <button type="button" onClick={onExpand}>Open Wattzun</button>
      {callStatus.state === "confirming" && <button type="button" onClick={() => voiceCall.current?.continueCall()}>Continue call</button>}
      <button className={styles.hangUp} type="button" onClick={hangUp}>Hang up</button>
    </div>}
    <div className={styles.conversation} hidden={!expanded}>
    <div className={styles.tools}>
      {!callActive ? <button className={styles.callButton} type="button" disabled={busy} onClick={startCall}><PhoneIcon />Call Wattzun</button> : <span className={styles.callBadge} role="status"><span className={`${styles.activity} ${callStatus.state === "listening" ? styles.listening : ""}`} />{callLabels[callStatus.state]}</span>}
      <details className={styles.settings}>
        <summary>Speech speed</summary>
        <div className={styles.settingsPanel}>
          <label>Speaking speed<select aria-label="Speaking speed" value={presentation.speed} onChange={event => { const speed = Number(event.target.value); if (speed === 0.85 || speed === 1 || speed === 1.15) presentation.setSpeed(speed); }}><option value={0.85}>Slower</option><option value={1}>Normal</option><option value={1.15}>Quicker</option></select></label>
          <p>Speed changes apply from your next question.</p>
        </div>
      </details>
    </div>
    <p className={styles.disclosure}>Wattzun uses an AI-generated voice. Calling shares your spoken questions with our AI provider. Minimise to keep working while your call stays connected. Hang up to stop your microphone.</p>
    {callActive && <div className={styles.callControls}>
      <button type="button" disabled={callStatus.state === "permission" || callStatus.state === "connecting"} aria-pressed={muted} onClick={() => { voiceCall.current?.toggleMute(); setMuted(current => !current); }}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
      {callStatus.state === "speaking" && <button type="button" onClick={() => voiceCall.current?.interrupt()}>Stop speaking</button>}
      <button className={styles.hangUp} type="button" onClick={hangUp}>Hang up</button>
    </div>}
    {callStatus.message && <p className={callStatus.state === "error" ? styles.error : styles.callHint} role={callStatus.state === "error" ? "alert" : "status"}>{callStatus.message}</p>}
    {callStatus.state === "confirming" && <div className={styles.idleConfirmation} role="group" aria-label="Call check-in"><p>{muted ? 'Unmute to respond, or choose Continue call.' : 'Speak to continue, or choose Continue call.'} This brief check-in uses your device voice when available.</p><div><button type="button" onClick={() => voiceCall.current?.continueCall()}>Continue call</button><button type="button" onClick={() => { voiceCall.current?.hangUp(); setMuted(false); }}>End call</button></div></div>}
    <div className={styles.messages} role="log" aria-live="polite" aria-label="Conversation with Wattzun">
      {!messages.length && <div className={styles.welcome}><h3>What can I help you with?</h3><p>Tell me what you want to get done. If I need more detail, I will ask.</p><div>{["What can you help me with?", "Help me find the next step"].map(example => <button key={example} type="button" disabled={callActive || busy} onClick={() => setDraft(example)}>{example}</button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}><strong>{message.role === "user" ? "You" : "Wattzun"}</strong><p>{message.reply ? message.reply.message : message.content}</p>{message.reply && message.reply.questions.length > 0 && <ol>{message.reply.questions.map((question, index) => <li key={index}>{question}</li>)}</ol>}{message.reply && message.reply.links.length > 0 && <div className={styles.links}>{message.reply.links.map(link => wattzunPortalForPath(link.href.split(/[?#]/)[0]) === scope.portal
        ? <Link key={link.href} href={workspaceHref(link.href, scope, user.uid, pathname)} prefetch={false} onNavigate={event => { event.preventDefault(); navigate(link.href); }}>{link.label} <span aria-hidden="true">↗</span></Link>
        : <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span aria-hidden="true">↗</span></a>)}</div>}
        {scope.portal === "trade" && message.reply?.lookup && <WattzunRecordPicker user={user} scope={scope} lookup={message.reply.lookup} onNavigate={navigate} />}
        {scope.portal === "trade" && message.reply?.action && <WattzunActionReview proposal={message.reply.action} user={user} scopeId={scope.scopeId} onCreated={receipt => actionCreated(message.id, receipt)} onCancel={() => dismissAction(message.id)} onNavigate={navigate} />}
      </article>)}
      {busy && <p className={styles.callHint} role="status">Wattzun is thinking...</p>}
      <div ref={scrollEnd} />
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void sendText(); }}>
      <label className={styles.srOnly} htmlFor="wattzun-portal-message">Message Wattzun</label>
      <textarea ref={composer} id="wattzun-portal-message" rows={2} maxLength={4000} value={draft} disabled={busy || callActive} placeholder={callActive ? "Hang up to continue in chat" : "Ask a question or describe your task..."} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(); } }} />
      <button type="submit" disabled={busy || callActive || !draft.trim()}>{busy ? "Sending..." : "Send"}</button>
    </form>
    <p className={styles.footer}>Workspace: {scope.label}. Check important details before acting.</p>
  </div></>;
}

function PhoneIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z" /></svg>; }
