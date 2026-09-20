"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { Call, TelnyxRTC } from "@telnyx/webrtc";
import {
  auditCallIsActive,
  CREDITEX_AUDIT_CALL_LIMITS,
  type CreditexAuditCall,
  type CreditexAuditCallsResponse,
  type CreditexAuditCallPrepareResponse,
} from "@/lib/creditex-audit-calls";
import styles from "./CreditexAuditCallPanel.module.css";

type Phase = "idle" | "microphone" | "connecting" | "connected" | "cancelling" | "end_failed";
const callLabels: Record<CreditexAuditCall["status"], string> = {
  prepared: "Ready to connect", dialing: "Calling customer", ringing: "Ringing",
  awaiting_consent: "Waiting for customer consent", in_progress: "Call in progress",
  completed: "Call ended", declined: "Consent not given", cancelled: "Cancelled",
  expired: "Connection expired", failed: "Call failed", busy: "Customer busy", no_answer: "No answer",
};
const recordingLabels: Record<CreditexAuditCall["recordingStatus"], string> = {
  none: "No recording", starting: "Starting recording", recording: "Recording",
  pending: "Preparing recording", saving: "Saving recording", saved: "Recording saved",
  failed: "Recording not saved", unknown: "Recording not confirmed",
};

async function requestJson<T>(user: User, path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "The call service could not be reached. Refresh to check the latest status.");
  return result;
}

function microphoneError(error: unknown) {
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) return "Microphone access is blocked. Allow this website to use your microphone in the browser address bar, then try again.";
  if (error instanceof Error && (error.name === "NotFoundError" || error.name === "DevicesNotFoundError")) return "No microphone was found. Connect your headset or microphone, then try again.";
  if (error instanceof Error && error.name === "NotReadableError") return "Your microphone could not be opened. Check your headset and close any application using it exclusively.";
  return error instanceof Error ? error.message : "The call could not start. Check your headset and connection, then try again.";
}

function microphonePolicyBlocked(page: Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean } }) {
  return page.permissionsPolicy?.allowsFeature("microphone") === false;
}

function disconnectHeadset(client: TelnyxRTC | null, call: Call | null) {
  client?.off("telnyx.ready"); client?.off("telnyx.error"); client?.off("telnyx.notification"); client?.off("telnyx.socket.close");
  call?.localStream?.getTracks().forEach((track) => track.stop());
  if (call) void call.hangup().catch(() => {});
  if (client) void client.disconnect().catch(() => {});
}

type AuditCallTarget = { caseId: string; jobIntentId?: never } | { jobIntentId: string; caseId?: never };

export function CreditexAuditCallPanel({ user, caseId, jobIntentId }: { user: User } & AuditCallTarget) {
  const [data, setData] = useState<CreditexAuditCallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState("");
  const [recordingBusy, setRecordingBusy] = useState("");
  const [playback, setPlayback] = useState<{ id: string; url: string } | null>(null);
  const generation = useRef(0);
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callRef = useRef<Call | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const cancelReadyRef = useRef<(() => void) | null>(null);
  const intentRef = useRef("");
  const requestIdRef = useRef("");
  const startingRef = useRef(false);
  const cancelledRef = useRef(false);
  const endingRef = useRef(false);
  const refreshingRef = useRef(false);
  const playbackRef = useRef("");
  const playbackRequest = useRef(0);
  const pollDeadline = useRef(0);

  const load = useCallback(() => requestJson<CreditexAuditCallsResponse>(user, `/api/creditex/audit-calls?${caseId ? `caseId=${encodeURIComponent(caseId)}` : `jobIntentId=${encodeURIComponent(jobIntentId || "")}`}`), [user, caseId, jobIntentId]);
  const cancelIntent = useCallback((callId: string) => requestJson(user, "/api/creditex/audit-calls", { action: "cancel", ...(caseId ? { caseId } : { jobIntentId }), callId }), [user, caseId, jobIntentId]);

  useEffect(() => {
    const current = ++generation.current;
    void load().then((result) => { if (generation.current === current) setData(result); })
      .catch((error) => { if (generation.current === current) setNotice(error instanceof Error ? error.message : "Calls could not be loaded."); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => {
      generation.current = current + 1;
      const call = callRef.current; const client = clientRef.current; const intent = intentRef.current;
      callRef.current = null; clientRef.current = null; intentRef.current = "";
      cancelReadyRef.current?.(); cancelReadyRef.current = null; disconnectHeadset(client, call);
      if (intent) void cancelIntent(intent).catch(() => { /* Provider duration limits bound an unreachable active call. */ });
      if (playbackRef.current) URL.revokeObjectURL(playbackRef.current);
      playbackRef.current = "";
    };
  }, [load, cancelIntent]);

  const needsUpdates = phase !== "idle" || Boolean(data?.calls.some((call) => auditCallIsActive(call.status) || ["starting", "recording", "pending", "saving"].includes(call.recordingStatus)));
  useEffect(() => {
    if (!needsUpdates) return;
    const current = generation.current;
    if (pollDeadline.current < Date.now()) pollDeadline.current = Date.now() + 40 * 60 * 1000;
    let failures = 0;
    const timer = window.setInterval(() => {
      if (Date.now() > pollDeadline.current) { window.clearInterval(timer); setNotice("Automatic updates have paused. Refresh to check the latest call and recording status."); return; }
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      void load().then((result) => { if (generation.current === current) { setData(result); failures = 0; } })
        .catch(() => { if (++failures >= 3 && generation.current === current) { window.clearInterval(timer); setNotice("Call updates could not be loaded. Refresh when your connection is back. Recording storage continues on the server."); } })
        .finally(() => { refreshingRef.current = false; });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, needsUpdates]);

  async function refresh() {
    if (refreshingRef.current) return;
    const current = generation.current; refreshingRef.current = true; setRefreshing(true);
    try { const result = await load(); if (generation.current === current) { setData(result); setNotice(""); } }
    catch (error) { if (generation.current === current) setNotice(error instanceof Error ? error.message : "Calls could not be refreshed."); }
    finally { refreshingRef.current = false; if (generation.current === current) setRefreshing(false); }
  }

  async function startCall() {
    if (startingRef.current || !data?.canCall || !data.configured || !data.customerPhone || data.calls.some((call) => auditCallIsActive(call.status))) return;
    startingRef.current = true; cancelledRef.current = false; endingRef.current = false; const current = generation.current;
    setPhase("microphone"); setNotice(""); setMuted(false);
    let preparedId = "";
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("PC calling needs a supported browser with microphone access on this secure website. Open it in current Chrome or Edge on your PC.");
      if (microphonePolicyBlocked(document)) throw new Error("Reload this Creditex page to enable microphone access, then try Call customer again.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (generation.current !== current || cancelledRef.current) return;
      const { TelnyxRTC: VoiceClient } = await import("@telnyx/webrtc");
      if (generation.current !== current || cancelledRef.current) return;
      if (!window.RTCPeerConnection) throw new Error("This browser cannot make headset calls. Open TLink in current Chrome or Edge on your PC.");
      setPhase("connecting");
      requestIdRef.current ||= crypto.randomUUID();
      const prepared = await requestJson<CreditexAuditCallPrepareResponse>(user, "/api/creditex/audit-calls", { action: "prepare", ...(caseId ? { caseId } : { jobIntentId }), requestId: requestIdRef.current });
      preparedId = prepared.callId; requestIdRef.current = "";
      if (generation.current !== current || cancelledRef.current) { await cancelIntent(preparedId); return; }
      if (!preparedId || !prepared.token || !Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= Date.now()) throw new Error("The call connection expired. Refresh and start a new call.");
      if (typeof prepared.destinationNumber !== "string" || !prepared.destinationNumber || !Array.isArray(prepared.customHeaders) || !prepared.customHeaders.length) throw new Error("The secure call destination was not returned. Refresh and try again.");
      const customHeaders: { name: string; value: string }[] = [];
      for (const header of prepared.customHeaders) {
        if (!header || typeof header !== "object" || typeof header.name !== "string" || typeof header.value !== "string") throw new Error("The secure call destination was not returned. Refresh and try again.");
        customHeaders.push({ name: header.name, value: header.value });
      }
      intentRef.current = preparedId; setActiveId(preparedId); pollDeadline.current = Date.now() + 40 * 60 * 1000;
      const client = new VoiceClient({ login_token: prepared.token, debug: false, enableCallRecording: false, hangupOnBeforeUnload: true });
      clientRef.current = client;
      const finish = (message = "Call ended. Recording status will update below.") => {
        if (generation.current !== current || clientRef.current !== client) return;
        const call = callRef.current; callRef.current = null; clientRef.current = null; intentRef.current = "";
        cancelReadyRef.current?.(); cancelReadyRef.current = null; disconnectHeadset(client, call);
        startingRef.current = false; setPhase("idle"); setMuted(false); setNotice(message);
        void load().then((result) => { if (generation.current === current) setData(result); }).catch(() => { /* Polling or Refresh can recover the call record. */ });
      };
      client.on("telnyx.error", () => { finish("The headset connection was interrupted. Check the call status before starting another call."); void cancelIntent(preparedId).catch(() => {}); });
      client.on("telnyx.socket.close", () => { finish("The headset connection closed. Check the call status before starting another call."); void cancelIntent(preparedId).catch(() => {}); });
      client.on("telnyx.notification", (event) => {
        if (generation.current !== current || clientRef.current !== client || event.type !== "callUpdate" || !event.call) return;
        const call = event.call;
        if (call.id !== preparedId && call.recoveredCallId !== preparedId) return;
        callRef.current = call;
        if (["hangup", "destroy", "purge"].includes(call.state)) finish();
        else if (["active", "early"].includes(call.state)) { setPhase("connected"); setMuted(call.isAudioMuted); }
        else if (call.state === "recovering") setNotice("The headset connection is reconnecting. Recording status is shown below.");
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("The headset connection timed out. Check your connection and try again.")), 25000);
        const ready = () => { window.clearTimeout(timeout); cancelReadyRef.current = null; client.off("telnyx.ready", ready); resolve(); };
        cancelReadyRef.current = () => { window.clearTimeout(timeout); reject(new Error("The headset connection was cancelled.")); };
        client.on("telnyx.ready", ready);
        void client.connect().catch((error: unknown) => { window.clearTimeout(timeout); reject(error); });
      });
      if (generation.current !== current || cancelledRef.current || clientRef.current !== client) { disconnectHeadset(client, null); await cancelIntent(preparedId); return; }
      callRef.current = client.newCall({ id: preparedId, destinationNumber: prepared.destinationNumber, customHeaders, audio: true, video: false, remoteElement: remoteAudioRef.current || undefined });
      void load().then((result) => { if (generation.current === current) setData(result); }).catch(() => {});
    } catch (error) {
      if (preparedId) void cancelIntent(preparedId).catch(() => {});
      if (generation.current === current && !endingRef.current) {
        cancelReadyRef.current?.(); cancelReadyRef.current = null; disconnectHeadset(clientRef.current, callRef.current);
        callRef.current = null; clientRef.current = null; intentRef.current = "";
        startingRef.current = false; setPhase("idle"); setNotice(microphoneError(error));
      }
    } finally {
      if (generation.current === current && cancelledRef.current && !endingRef.current) { startingRef.current = false; setPhase("idle"); setNotice("Call connection cancelled."); }
    }
  }

  async function endCall() {
    const current = generation.current;
    const intent = intentRef.current;
    const call = callRef.current;
    if (!intent) {
      cancelledRef.current = true;
      cancelReadyRef.current?.(); cancelReadyRef.current = null; disconnectHeadset(clientRef.current, null); clientRef.current = null; intentRef.current = "";
      setPhase("cancelling"); setNotice("Cancelling the connection. If a microphone prompt is open, close it to finish.");
      return;
    }
    endingRef.current = true; cancelledRef.current = true;
    const client = clientRef.current; callRef.current = null; clientRef.current = null;
    cancelReadyRef.current?.(); cancelReadyRef.current = null; disconnectHeadset(client, call);
    setPhase("cancelling"); setMuted(false);
    try {
      await cancelIntent(intent);
      if (generation.current !== current) return;
      intentRef.current = ""; startingRef.current = false; setPhase("idle");
      setNotice("Call ended. Recording status will update below.");
      void load().then((result) => { if (generation.current === current) setData(result); }).catch(() => { /* Refresh can recover the final status. */ });
    } catch {
      if (generation.current === current) {
        setPhase("end_failed");
        setNotice("Your microphone is disconnected, but the customer call ending has not been confirmed. Retry ending the call.");
      }
    }
  }

  function toggleMute() {
    const call = callRef.current;
    if (!call) return;
    if (call.isAudioMuted) call.unmuteAudio(); else call.muteAudio();
    setMuted(call.isAudioMuted);
  }

  async function retryRecording(callId: string) {
    if (recordingBusy) return;
    const current = generation.current; setRecordingBusy(callId); setNotice("");
    try {
      await requestJson(user, "/api/creditex/audit-calls", { action: "retry_recording", ...(caseId ? { caseId } : { jobIntentId }), callId });
      const result = await load(); if (generation.current === current) { setData(result); setNotice("Recording storage checked. Its latest status is shown below."); }
    } catch (error) { if (generation.current === current) setNotice(error instanceof Error ? error.message : "The recording could not be saved. Try again later."); }
    finally { if (generation.current === current) setRecordingBusy(""); }
  }

  function closePlayback() {
    playbackRequest.current++;
    if (playbackRef.current) URL.revokeObjectURL(playbackRef.current);
    playbackRef.current = ""; setPlayback(null);
  }

  async function playRecording(callId: string) {
    if (recordingBusy) return;
    closePlayback(); const current = generation.current; const request = ++playbackRequest.current;
    setRecordingBusy(callId); setNotice("");
    try {
      const response = await fetch(`/api/creditex/audit-calls/${encodeURIComponent(callId)}/audio`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || "The recording could not be opened. Refresh your case access and try again."); }
      if (response.headers.get("Content-Type")?.split(";")[0] !== "audio/mpeg" || Number(response.headers.get("Content-Length")) > CREDITEX_AUDIT_CALL_LIMITS.maximumRecordingBytes) throw new Error("The recording response was not a supported audio file.");
      const blob = await response.blob();
      if (!blob.size || blob.size > CREDITEX_AUDIT_CALL_LIMITS.maximumRecordingBytes) throw new Error("The recording file was empty or too large to play here.");
      if (generation.current !== current || playbackRequest.current !== request) return;
      const url = URL.createObjectURL(blob); playbackRef.current = url; setPlayback({ id: callId, url });
    } catch (error) { if (generation.current === current && playbackRequest.current === request) setNotice(error instanceof Error ? error.message : "The recording could not be opened."); }
    finally { if (generation.current === current && playbackRequest.current === request) setRecordingBusy(""); }
  }

  const active = data?.calls.find((call) => call.id === activeId);
  const liveLabel = phase === "end_failed" ? "Call ending not confirmed" : phase === "cancelling" ? "Ending connection" : phase === "microphone" ? "Checking your microphone" : phase === "connecting" ? "Connecting your headset" : active ? callLabels[active.status] : "Headset connected. Waiting for customer";
  const canStart = !loading && Boolean(data?.configured && data.canCall && data.customerPhone) && !data?.calls.some((call) => auditCallIsActive(call.status)) && phase === "idle";
  return <section className={styles.panel} aria-label="Customer audit calls">
    <audio ref={remoteAudioRef} autoPlay playsInline aria-label="Live customer audit call" />
    <header className={styles.heading}><div><span className={styles.eyebrow}>PC headset</span><h4>Customer audit calls</h4><p>Call this customer and keep the recording with their audit.</p></div><button type="button" className={styles.secondary} disabled={loading || refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing..." : "Refresh"}</button></header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p className={styles.muted}>Checking calling access...</p> : data && <>
      <div className={styles.callRow}><div><strong>{data.customerPhone || "No customer phone number"}</strong><p className={styles.muted}>Use your PC microphone or headset. Allow microphone access when your browser asks.</p></div>{phase === "idle" && <button type="button" className={styles.primary} disabled={!canStart} onClick={() => void startCall()}>Call customer</button>}</div>
      {(!data.configured || !data.canCall || !data.customerPhone) && <p className={styles.notice}>{data.unavailableReason || (!data.customerPhone ? "A valid customer phone number must be saved on this case before calling." : !data.configured ? "Creditex calling setup is not complete. Calls will be available here once it is connected." : "Calling is not currently available for this case. Refresh to check your access and any active call.")}</p>}
      <p className={styles.explainer}>The customer hears a recording notice and presses 1 to agree before you are connected. Recording then starts automatically and is saved privately with this audit after the call. If they do not agree, the call ends without recording.</p>
      {phase !== "idle" && <div className={styles.live} aria-live="polite"><div><strong>{liveLabel}</strong><span>{active ? recordingLabels[active.recordingStatus] : "Recording has not been confirmed"}</span></div><div className={styles.controls}>{phase === "connected" && <button type="button" className={styles.secondary} aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute microphone" : "Mute microphone"}</button>}<button type="button" className={styles.end} disabled={phase === "cancelling"} onClick={() => void endCall()}>{phase === "microphone" ? "Cancel" : phase === "end_failed" ? "Retry end call" : "End call"}</button></div></div>}
      <div className={styles.historyHeading}><h5>Call history</h5><span>Private to authorised Creditex staff</span></div>
      {data.calls.length ? <ol className={styles.history}>{data.calls.map((call) => <li key={call.id}>
        <div className={styles.recordHeading}><strong>{callLabels[call.status]}</strong><span className={call.recordingStatus === "saved" ? styles.saved : styles.recordingStatus}>{recordingLabels[call.recordingStatus]}</span></div>
        <p className={styles.muted}><time dateTime={call.createdAt}>{new Date(call.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time>{call.startedByName ? ` · ${call.startedByName}` : ""}{call.durationSeconds > 0 ? ` · ${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : ""}</p>
        {call.error && <p className={styles.callError}>{call.error}</p>}
        {call.recordingStatus === "unknown" && <p className={styles.muted}>A recording could not be confirmed. This is not a saved audit recording.</p>}
        {call.recordingStatus === "saved" && (playback?.id === call.id ? <div className={styles.playback}><audio controls autoPlay preload="metadata" src={playback.url} aria-label="Private audit call recording" /><button type="button" className={styles.secondary} onClick={closePlayback}>Close recording</button></div> : <button type="button" className={styles.secondary} disabled={Boolean(recordingBusy)} onClick={() => void playRecording(call.id)}>{recordingBusy === call.id ? "Opening recording..." : "Play recording"}</button>)}
        {call.recordingStatus === "failed" && <button type="button" className={styles.secondary} disabled={Boolean(recordingBusy)} onClick={() => void retryRecording(call.id)}>{recordingBusy === call.id ? "Checking storage..." : "Retry saving recording"}</button>}
      </li>)}</ol> : <p className={styles.empty}>No calls for this audit yet.</p>}
    </>}
  </section>;
}
