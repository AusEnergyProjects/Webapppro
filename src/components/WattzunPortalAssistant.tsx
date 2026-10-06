"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { readTradeBusinessSelection } from "@/lib/trade-business-client";
import {
  WATTZUN_MAX_HISTORY_TURNS, WATTZUN_MAX_HISTORY_CHARACTERS, wattzunSpokenReply,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurn, type WattzunTurnInput,
} from "@/lib/wattzun-portal";
import { WATTZUN_OPEN_EVENT, WATTZUN_READY_EVENT, WATTZUN_USAGE_CHANGED_EVENT, readWattzunOpenRequest, useWattzunPresentation, type WattzunOpenRequest } from "@/lib/wattzun-appearance";
import { createWattzunBrowserVoiceEnvironment, WattzunVoiceCall, type WattzunCallStatus } from "@/lib/wattzun-voice-client";
import { EnergyAssistantLauncher } from "./EnergyAssistantLauncher";
import { WattzunMascot } from "./WattzunMascot";
import styles from "./WattzunPortalAssistant.module.css";

type Message = WattzunTurn & { id: string; reply?: WattzunReply };
const portalNames: Record<WattzunPortal, string> = { trade: "TLink", council: "Council", creditex: "Creditex" };
const callLabels: Record<WattzunCallStatus["state"], string> = {
  idle: "Ready to call", permission: "Microphone permission", connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Wattzun is speaking", muted: "Microphone muted", confirming: "Continue this call?", ended: "Call ended", error: "Call could not continue",
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isReply(value: unknown): value is WattzunReply {
  return record(value) && (value.kind === "answer" || value.kind === "clarification") && typeof value.message === "string"
    && Array.isArray(value.questions) && value.questions.every(question => typeof question === "string")
    && Array.isArray(value.links) && value.links.every(link => record(link) && typeof link.label === "string" && typeof link.href === "string" && /^\/(?!\/)/.test(link.href));
}
async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(payload) || payload.ok !== true) {
    throw new Error(record(payload) && typeof payload.error === "string" ? payload.error : "Wattzun could not complete that request. Try again.");
  }
  return payload;
}
function conversationHistory(messages: Message[]): WattzunTurn[] {
  const history = messages.slice(-WATTZUN_MAX_HISTORY_TURNS).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
  while (JSON.stringify(history).length > WATTZUN_MAX_HISTORY_CHARACTERS) history.shift();
  return history;
}

export function WattzunPortalAssistant({ portal }: { portal: WattzunPortal }) {
  const [user, setUser] = useState<User | null>(null);
  const currentActor = useRef<User | null>(null);
  const [scopes, setScopes] = useState<WattzunScope[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [open, setOpen] = useState(false);
  const [openRequest, setOpenRequest] = useState<(WattzunOpenRequest & { id: string }) | null>(null);
  const scope = scopes.find(candidate => candidate.scopeId === scopeId);
  const appearance = useWattzunPresentation(user && scope ? { userUid: user.uid, portal, scopeId: scope.scopeId } : null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => { setOpen(false); setOpenRequest(null); }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, authenticated => {
    currentActor.current = authenticated?.emailVerified ? authenticated : null;
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
        const authorizedScopes = payload.scopes.filter((scope): scope is WattzunScope => record(scope) && scope.portal === portal && typeof scope.scopeId === "string" && typeof scope.label === "string");
        setScopes(authorizedScopes);
        const saved = portal === "trade" ? readTradeBusinessSelection(user.uid) : "";
        setScopeId(authorizedScopes.find(scope => scope.scopeId === saved)?.scopeId || (authorizedScopes.length === 1 ? authorizedScopes[0].scopeId : ""));
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
    <EnergyAssistantLauncher hat={appearance.hat} onPreload={() => {}} onOpen={() => { setOpenRequest(null); setOpen(true); }} />
    {open && <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="wattzun-portal-title" ref={dialog}>
        <header className={styles.header}>
          <WattzunMascot hat={appearance.hat} />
          <div><h2 id="wattzun-portal-title">Wattzun</h2><p>Your {portalNames[portal]} assistant</p></div>
          <button className={styles.close} type="button" aria-label="Close Wattzun" ref={closeButton} onClick={dismiss}>×</button>
        </header>
        {scopes.length > 1 && <label className={styles.workspace}>Workspace<select aria-label="Workspace" value={scopeId} onChange={event => { setScopeId(event.target.value); if (scope) setOpenRequest(null); }}><option value="">Choose a workspace</option>{scopes.map(choice => <option key={choice.scopeId} value={choice.scopeId}>{choice.label}</option>)}</select></label>}
        {scope ? <WattzunConversation key={`${user.uid}:${portal}:${scope.scopeId}`} user={user} scope={scope} openRequest={openRequest} /> : <p className={styles.empty}>Choose the workspace you want Wattzun to help with.</p>}
      </div>
    </div>}
  </>;
}

function WattzunConversation({ user, scope, openRequest }: { user: User; scope: WattzunScope; openRequest?: (WattzunOpenRequest & { id: string }) | null }) {
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
    const background = () => { if (document.hidden) { voiceCall.current?.hangUp(); setMuted(false); } };
    const leave = () => voiceCall.current?.dispose();
    document.addEventListener("visibilitychange", background);
    window.addEventListener("pagehide", leave);
    return () => {
      active.current = false;
      textRequest.current?.abort();
      voiceCall.current?.dispose();
      document.removeEventListener("visibilitychange", background);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  const append = useCallback((turns: Message[]) => {
    messagesRef.current = [...messagesRef.current, ...turns];
    setMessages(messagesRef.current);
  }, []);
  const requestInput = useCallback((message: string): WattzunTurnInput => ({
    portal: scope.portal, scopeId: scope.scopeId, requestId: crypto.randomUUID(), message,
    history: conversationHistory(messagesRef.current), preferences: { ...preferencesRef.current },
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
      async submit(audio, signal) {
        const input = requestInput("");
        const token = await user.getIdToken();
        if (signal.aborted) throw new Error("Call ended.");
        const form = new FormData();
        form.append("request", JSON.stringify(input));
        form.append("audio", audio, audio.type.includes("mp4") ? "question.m4a" : "question.webm");
        const payload = await responsePayload(await fetch("/api/wattzun/voice", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal }));
        if (typeof payload.transcript !== "string" || !isReply(payload.reply) || !record(payload.audio) || typeof payload.audio.base64 !== "string" || payload.audio.mimeType !== "audio/mpeg") {
          throw new Error("Wattzun returned an unreadable voice reply. Try again.");
        }
        return { ok: true, transcript: payload.transcript, reply: payload.reply, audio: { base64: payload.audio.base64, mimeType: "audio/mpeg" } };
      },
      reply: result => {
        if (!active.current || voiceCall.current !== call) return;
        const id = crypto.randomUUID();
        append([{ id, role: "user", content: result.transcript }, { id: `${id}:reply`, role: "assistant", content: wattzunSpokenReply(result.reply), reply: result.reply }]);
        window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT, { detail: { userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId } }));
      },
    });
    voiceCall.current = call;
    void call.start();
  }, [busy, callActive, requestInput, user, scope, append]);

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

  return <div className={styles.conversation}>
    <div className={styles.tools}>
      {!callActive ? <button className={styles.callButton} type="button" disabled={busy} onClick={startCall}><PhoneIcon />Call Wattzun</button> : <span className={styles.callBadge} role="status"><span className={`${styles.activity} ${callStatus.state === "listening" ? styles.listening : ""}`} />{callLabels[callStatus.state]}</span>}
      <details className={styles.settings}>
        <summary>Speech speed</summary>
        <div className={styles.settingsPanel}>
          <label>Speaking speed<select aria-label="Speaking speed" value={presentation.speed} onChange={event => { const speed = Number(event.target.value); if (speed === 0.85 || speed === 1 || speed === 1.15) presentation.setSpeed(speed); }}><option value={0.85}>Slower</option><option value={1}>Normal</option><option value={1.15}>Quicker</option></select></label>
          <p>Warm and conversational, with a little humour. Speed changes apply from your next question.</p>
        </div>
      </details>
    </div>
    <p className={styles.disclosure}>Wattzun uses an AI-generated voice. Calling shares your spoken questions with our AI provider. Your microphone is used only while this call is open.</p>
    {callActive && <div className={styles.callControls}>
      <button type="button" disabled={callStatus.state === "permission" || callStatus.state === "connecting"} aria-pressed={muted} onClick={() => { voiceCall.current?.toggleMute(); setMuted(current => !current); }}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
      {callStatus.state === "speaking" && <button type="button" onClick={() => voiceCall.current?.interrupt()}>Stop speaking</button>}
      <button className={styles.hangUp} type="button" onClick={() => { voiceCall.current?.hangUp(); setMuted(false); }}>Hang up</button>
    </div>}
    {callStatus.message && <p className={callStatus.state === "error" ? styles.error : styles.callHint} role={callStatus.state === "error" ? "alert" : "status"}>{callStatus.message}</p>}
    {callStatus.state === "confirming" && <div className={styles.idleConfirmation} role="group" aria-label="Call check-in"><p>{muted ? 'Unmute to respond, or choose Continue call.' : 'Speak to continue, or choose Continue call.'} This brief check-in uses your device voice when available.</p><div><button type="button" onClick={() => voiceCall.current?.continueCall()}>Continue call</button><button type="button" onClick={() => { voiceCall.current?.hangUp(); setMuted(false); }}>End call</button></div></div>}
    <div className={styles.messages} role="log" aria-live="polite" aria-label="Conversation with Wattzun">
      {!messages.length && <div className={styles.welcome}><h3>What can I help you with?</h3><p>Tell me what you want to get done. If I need more detail, I will ask.</p><div>{["What can you help me with?", "Help me find the next step"].map(example => <button key={example} type="button" disabled={callActive || busy} onClick={() => setDraft(example)}>{example}</button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}><strong>{message.role === "user" ? "You" : "Wattzun"}</strong><p>{message.reply ? message.reply.message : message.content}</p>{message.reply && message.reply.questions.length > 0 && <ol>{message.reply.questions.map((question, index) => <li key={index}>{question}</li>)}</ol>}{message.reply && message.reply.links.length > 0 && <div className={styles.links}>{message.reply.links.map(link => <a key={link.href} href={link.href}>{link.label} <span aria-hidden="true">↗</span></a>)}</div>}</article>)}
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
  </div>;
}

function PhoneIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z" /></svg>; }
