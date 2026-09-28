"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TeamCallConnections, type CallRemote } from "@/lib/trade-team-call-client";
import type { TeamCall, TeamCallSignal } from "@/lib/trade-team-calls";
import styles from "./TradeTeamCallProvider.module.css";

type Mode = "audio" | "video";
type CallResult = { ok: boolean; error?: string; code?: string; call?: TeamCall | null; calls?: TeamCall[]; memberId?: string; signals?: TeamCallSignal[]; iceServers?: RTCIceServer[] };
type CallSession = { call: TeamCall; sessionId: string; memberId: string; local: MediaStream; peers: TeamCallConnections | null; cursor: number; lastSuccess: number };
const CallContext = createContext<{ start: (threadId: string, mode: Mode) => void; busy: boolean } | null>(null);

export function TradeTeamCallButtons({ threadId }: { threadId: string }) {
  const calls = useContext(CallContext);
  return <div className={styles.buttons} aria-label="Team calls">
    <button type="button" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"audio")} aria-label="Start voice call"><span aria-hidden="true">☎</span> Voice call</button>
    <button type="button" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"video")} aria-label="Start video call"><span aria-hidden="true">▣</span> Video call</button>
  </div>;
}

function StreamTile({ stream, name, local = false, state = "" }: { stream: MediaStream | null; name: string; local?: boolean; state?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playBlocked,setPlayBlocked] = useState(false);
  useEffect(() => {
    const element = video.current; if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
    return () => { element.srcObject = null; };
  },[stream]);
  return <div className={styles.tile}><span className={styles.initial} aria-hidden="true">{name.slice(0,1)}</span><video ref={video} autoPlay playsInline muted={local} aria-label={local ? "Your camera preview" : `${name}'s call`} />
    <span className={styles.caption}>{name}{state && state !== "connected" ? ` · ${state === "new" ? "Connecting" : state}` : ""}</span>
    {playBlocked && <button type="button" className={styles.play} onClick={() => void video.current?.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true))}>Play audio</button>}
  </div>;
}

type ProviderProps = {
  user?: User | null; getAuthHeaders?: () => Promise<Record<string,string>>; enabled?: boolean; children: ReactNode;
};
export function TradeTeamCallProvider(props: ProviderProps) {
  return <TradeTeamCallSession key={`${props.user?.uid || "session"}:${props.enabled !== false}`} {...props} />;
}
function TradeTeamCallSession({ user, getAuthHeaders, enabled = true, children }: ProviderProps) {
  const [active,setActive] = useState<TeamCall | null>(null), [incoming,setIncoming] = useState<TeamCall[]>([]), [busy,setBusy] = useState(false);
  const [localPreview,setLocalPreview] = useState<MediaStream | null>(null);
  const [notice,setNotice] = useState(""), [remotes,setRemotes] = useState<CallRemote[]>([]), [muted,setMuted] = useState(false), [cameraOff,setCameraOff] = useState(false), [minimized,setMinimized] = useState(false);
  const session = useRef<CallSession | null>(null), media = useRef<MediaStream | null>(null), generation = useRef(0), dismissed = useRef(new Set<string>()), starting = useRef(false);
  const authentication = useRef({user,getAuthHeaders});
  useEffect(() => { authentication.current = {user,getAuthHeaders}; },[user,getAuthHeaders]);
  const available = enabled && Boolean(user || getAuthHeaders);
  const api = useCallback(async (query = "", body?: Record<string,unknown>): Promise<CallResult> => {
    const {user,getAuthHeaders} = authentication.current;
    const headers: Record<string,string> = getAuthHeaders ? await getAuthHeaders() : user ? {Authorization:`Bearer ${await user.getIdToken()}`} : {};
    const response = await fetch(`/api/trade-team-calls${query ? `?${query}` : ""}`, { method:body ? "POST" : "GET", headers:{...headers,...(body ? {"Content-Type":"application/json"} : {})}, body:body ? JSON.stringify(body) : undefined, cache:"no-store", signal:AbortSignal.timeout(12000) });
    const result: CallResult = await response.json();
    if (!response.ok || !result.ok) { const error = new Error(result.error || "The call could not connect."); Object.assign(error,{code:result.code,status:response.status}); throw error; }
    return result;
  },[]);

  const release = useCallback((notify = true) => {
    generation.current++; starting.current = false;
    const current = session.current; session.current = null;
    current?.peers?.close();
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    if (current) { dismissed.current.add(current.call.id); if (notify) void api("",{action:"leave",callId:current.call.id,sessionId:current.sessionId}).catch(() => {}); }
  },[api]);
  const stop = useCallback((message = "", notify = true) => {
    release(notify);
    setActive(null); setRemotes([]); setLocalPreview(null); setBusy(false); setMuted(false); setCameraOff(false); setNotice(message);
  },[release]);

  useEffect(() => {
    if (!available) return;
    return () => release();
  },[available,release]);

  const begin = useCallback(async (threadId: string, mode: Mode, existing?: TeamCall) => {
    if (!available || starting.current || session.current) return;
    starting.current = true; setBusy(true); setNotice(""); setMinimized(false);
    const epoch = ++generation.current, sessionId = crypto.randomUUID();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Calling needs a browser with microphone and camera support.");
      const local = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:mode === "video" ? {width:{ideal:640},height:{ideal:360},frameRate:{ideal:20,max:24}} : false});
      if (generation.current !== epoch) { local.getTracks().forEach(track => track.stop()); return; }
      media.current = local; setLocalPreview(local);
      const result = await api("",existing ? {action:"join",callId:existing.id,sessionId} : {action:"start",threadId,mode,sessionId,requestId:crypto.randomUUID()});
      if (!result.call || !result.memberId) throw new Error("The call could not start.");
      if (generation.current !== epoch) { local.getTracks().forEach(track => track.stop()); void api("",{action:"leave",callId:result.call.id,sessionId}).catch(() => {}); return; }
      const current: CallSession = {call:result.call,memberId:result.memberId,sessionId,local,peers:null,cursor:0,lastSuccess:Date.now()};
      session.current = current; setActive(result.call); setIncoming(items => items.filter(item => item.id !== result.call?.id));
      const ice = await api("",{action:"ice",callId:current.call.id,sessionId});
      if (session.current !== current || !ice.iceServers?.length) { if (session.current === current) throw new Error("The call relay is unavailable. Try again shortly."); return; }
      current.peers = new TeamCallConnections({memberId:current.memberId,sessionId,local,iceServers:ice.iceServers,
        send:async (target,type,payload) => { await api("",{action:"signal",callId:current.call.id,sessionId,toMemberId:target.memberId,toSessionId:target.sessionId,requestId:crypto.randomUUID(),type,payload}); },
        changed:setRemotes, failed:message => { if (session.current === current) stop(message); }});
      await current.peers.sync(current.call.participants);
      if (session.current === current) { starting.current = false; setBusy(false); }
    } catch (error) {
      if (generation.current !== epoch) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      stop(error instanceof DOMException && ["NotAllowedError","NotFoundError","NotReadableError"].includes(error.name)
        ? "Allow your microphone and camera in browser settings, then try again." : error instanceof Error ? error.message : "The call could not start.");
      if (code === "CALL_ALREADY_ACTIVE") { try { const result = await api(`threadId=${encodeURIComponent(threadId)}`); if(result.call?.status === "active") { dismissed.current.delete(result.call.id); setIncoming([result.call]); } } catch { /* Original failure remains visible. */ } }
    }
  },[available,api,stop]);

  const activeId = active?.id;
  useEffect(() => {
    if (!available) return;
    let inFlight = false, disposed = false;
    const tick = async () => {
      if (inFlight || disposed) return;
      const current = session.current;
      if (!current && (document.visibilityState !== "visible" || starting.current)) return;
      inFlight = true;
      let processing = false;
      try {
        if (current && current.peers) {
          const result = await api(`callId=${encodeURIComponent(current.call.id)}&sessionId=${encodeURIComponent(current.sessionId)}&after=${current.cursor}`);
          if (disposed || session.current !== current) return;
          if (!result.call || result.call.status !== "active") { stop("Call ended.",false); return; }
          current.call = result.call; setActive(result.call); processing = true;
          await current.peers.sync(result.call.participants);
          for (const signal of result.signals || []) { await current.peers.receive(signal); current.cursor = Math.max(current.cursor,signal.sequence); }
          current.lastSuccess = Date.now();
        } else if (!current) {
          const result = await api("view=incoming");
          if (!disposed && !session.current) setIncoming((result.calls || []).filter(call => !dismissed.current.has(call.id)));
        }
      } catch (error) {
        if (disposed || !current || session.current !== current) return;
        const status = error && typeof error === "object" && "status" in error ? error.status : 0;
        if (processing || status === 401 || status === 403 || status === 409 || Date.now()-current.lastSuccess > 15000) stop(processing ? "The media connection failed. Hang up and call again." : error instanceof Error ? error.message : "Connection lost. Call again when you are back online.");
      } finally { inFlight = false; }
    };
    void tick(); const interval = window.setInterval(() => void tick(), activeId ? 1500 : 5000);
    return () => { disposed = true; window.clearInterval(interval); };
  // The call ID changes only on start/end; peer and heartbeat updates do not restart polling.
  },[available,api,stop,activeId]);

  const toggleMuted = () => { const next=!muted; media.current?.getAudioTracks().forEach(track => {track.enabled=!next;}); setMuted(next); };
  const toggleCamera = () => { const next=!cameraOff; media.current?.getVideoTracks().forEach(track => {track.enabled=!next;}); setCameraOff(next); };
  const connected = remotes.some(peer => peer.state === "connected");
  const invitation = incoming[0];
  return <CallContext.Provider value={{start:(threadId,mode) => void begin(threadId,mode),busy:busy || Boolean(active)}}>{children}
    {(active || busy || invitation || notice) && <aside className={`${styles.dock} ${minimized ? styles.minimized : ""}`} aria-label="Internal team call">
      {active ? <><header><div><strong>{active.threadName || "Team call"}</strong><span>{connected ? "Connected" : remotes.length ? "Connecting..." : "Calling team..."} · Internal · {active.mode === "video" ? "Video" : "Voice"}</span></div><button type="button" onClick={() => setMinimized(value => !value)}>{minimized ? "Expand" : "Minimise"}</button></header>
        {!minimized && <div className={styles.grid}><StreamTile stream={localPreview} name={muted ? "You · Muted" : "You"} local />{remotes.map(peer => <StreamTile key={peer.memberId} stream={peer.stream} name={peer.name} state={peer.state} />)}</div>}
        <div className={styles.controls}><button type="button" aria-pressed={muted} onClick={toggleMuted}>{muted ? "Unmute" : "Mute"}</button>{active.mode === "video" && <button type="button" aria-pressed={cameraOff} onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>}<button type="button" className={styles.hangup} onClick={() => stop()}>Hang up</button></div>
      </> : busy ? <><p role="status">Opening your call...</p><button type="button" onClick={() => stop()}>Cancel</button></> : invitation ? <><strong>{invitation.threadName || "Team call"}</strong><p>Incoming {invitation.mode === "video" ? "video" : "voice"} call · Internal</p><div className={styles.controls}><button type="button" className={styles.answer} onClick={() => void begin(invitation.threadId,invitation.mode,invitation)}>Answer</button><button type="button" onClick={() => {dismissed.current.add(invitation.id);setIncoming(items=>items.filter(item=>item.id!==invitation.id));}}>Decline</button></div></> : <><p role="status">{notice}</p><button type="button" onClick={() => setNotice("")}>Close</button></>}
    </aside>}
  </CallContext.Provider>;
}
