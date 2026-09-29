"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TeamCallConnections, type CallRemote } from "@/lib/trade-team-call-client";
import { teamCallCameraConstraints, teamCallMediaConstraints, teamCallMediaError, type CameraFacing } from "@/lib/trade-team-call-media";
import type { TeamCall, TeamCallSignal } from "@/lib/trade-team-calls";
import styles from "./TradeTeamCallProvider.module.css";

type Mode = "audio" | "video";
type CallResult = { ok: boolean; error?: string; code?: string; call?: TeamCall | null; calls?: TeamCall[]; memberId?: string; signals?: TeamCallSignal[]; iceServers?: RTCIceServer[] };
type CallSession = { call: TeamCall; sessionId: string; memberId: string; local: MediaStream; peers: TeamCallConnections | null; cursor: number; lastSuccess: number };
type RetryCall = { threadId: string; mode: Mode; existing?: TeamCall };
const CallContext = createContext<{ start: (threadId: string, mode: Mode) => void; busy: boolean } | null>(null);

export function TradeTeamCallButtons({ threadId }: { threadId: string }) {
  const calls = useContext(CallContext);
  return <div className={styles.buttons} aria-label="Team calls">
    <button type="button" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"audio")} aria-label="Start voice call"><span aria-hidden="true">☎</span> Voice call</button>
    <button type="button" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"video")} aria-label="Start video call"><span aria-hidden="true">▣</span> Video call</button>
  </div>;
}

function StreamTile({ stream, name, local = false, state = "", cameraOff = false }: { stream: MediaStream | null; name: string; local?: boolean; state?: string; cameraOff?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playBlocked,setPlayBlocked] = useState(false);
  useEffect(() => {
    const element = video.current; if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
    return () => { element.srcObject = null; };
  },[stream]);
  return <div className={styles.tile}><span className={styles.initial} aria-hidden="true">{name.slice(0,1)}</span><video className={cameraOff ? styles.hiddenVideo : undefined} ref={video} autoPlay playsInline muted={local} aria-label={local ? "Your camera preview" : `${name}'s call`} />
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
  const fetch = useTradeBusinessFetch();
  const [active,setActive] = useState<TeamCall | null>(null), [incoming,setIncoming] = useState<TeamCall[]>([]), [busy,setBusy] = useState(false);
  const [localPreview,setLocalPreview] = useState<MediaStream | null>(null);
  const [notice,setNotice] = useState(""), [remotes,setRemotes] = useState<CallRemote[]>([]), [muted,setMuted] = useState(false), [cameraOff,setCameraOff] = useState(false), [minimized,setMinimized] = useState(false);
  const [retry,setRetry] = useState<RetryCall | null>(null), [openingMode,setOpeningMode] = useState<Mode>("audio");
  const [hasCamera,setHasCamera] = useState(false), [multipleCameras,setMultipleCameras] = useState(false), [switchingCamera,setSwitchingCamera] = useState(false);
  const [cameraNotice,setCameraNotice] = useState("");
  const facing = useRef<CameraFacing>("user"), changingCamera = useRef(false);
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
  },[fetch]);

  const release = useCallback((notify = true) => {
    generation.current++; starting.current = false;
    const current = session.current; session.current = null;
    current?.peers?.close();
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    changingCamera.current = false;
    if (current) { dismissed.current.add(current.call.id); if (notify) void api("",{action:"leave",callId:current.call.id,sessionId:current.sessionId}).catch(() => {}); }
  },[api]);
  const stop = useCallback((message = "", notify = true) => {
    release(notify);
    setActive(null); setRemotes([]); setLocalPreview(null); setBusy(false); setMuted(false); setCameraOff(false); setNotice(message);
    setRetry(null); setCameraNotice(""); setHasCamera(false); setMultipleCameras(false); setSwitchingCamera(false);
  },[release]);

  useEffect(() => {
    if (!available) return;
    return () => release();
  },[available,release]);

  const begin = useCallback(async (threadId: string, mode: Mode, existing?: TeamCall) => {
    if (!available || starting.current || session.current) return;
    starting.current = true; setBusy(true); setNotice(""); setRetry(null); setMinimized(false); setOpeningMode(mode);
    const epoch = ++generation.current, sessionId = crypto.randomUUID();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Calling is not supported here. Open TLink in an up-to-date Chrome, Edge, Safari or Firefox browser using HTTPS.");
      const local = await navigator.mediaDevices.getUserMedia(teamCallMediaConstraints(mode));
      if (generation.current !== epoch) { local.getTracks().forEach(track => track.stop()); return; }
      media.current = local; setLocalPreview(local); setHasCamera(local.getVideoTracks().length > 0);
      facing.current = local.getVideoTracks()[0]?.getSettings().facingMode === "environment" ? "environment" : "user";
      // Device enumeration follows the user's media permission, never precedes it.
      if (mode === "video" && navigator.mediaDevices.enumerateDevices) void navigator.mediaDevices.enumerateDevices().then(devices => {
        if (generation.current === epoch) setMultipleCameras(Boolean(local.getVideoTracks()[0]?.getSettings().facingMode) && devices.filter(device => device.kind === "videoinput").length > 1);
      }).catch(() => { /* Camera switching is optional when device discovery is unavailable. */ });
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
      stop(teamCallMediaError(error,mode));
      if (code !== "CALL_ALREADY_ACTIVE") setRetry({threadId,mode,existing});
      if (code === "CALL_ALREADY_ACTIVE") { try { const result = await api(`threadId=${encodeURIComponent(threadId)}`); if(result.call?.status === "active") { dismissed.current.delete(result.call.id); setIncoming([result.call]); } } catch { /* Original failure remains visible. */ } }
    }
  },[available,api,stop]);

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    const openInvitation = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
      const {callId,threadId} = event.detail;
      if (typeof callId !== "string" || typeof threadId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(callId) || !/^[a-zA-Z0-9_-]{8,120}$/.test(threadId)) return;
      if (session.current?.call.id === callId) { setMinimized(false); return; }
      if (session.current || starting.current) return;
      // A notification is only a request to show the invitation. The server
      // verifies current membership and an explicit Answer requests media.
      void api(`threadId=${encodeURIComponent(threadId)}`).then(result => {
        if (disposed || session.current || starting.current) return;
        if (result.call?.id !== callId || result.call.status !== "active") { setNotice("This call has ended. You can call your teammate back from Messages."); return; }
        dismissed.current.delete(callId); setNotice(""); setRetry(null); setMinimized(false); setIncoming([result.call]);
      }).catch(error => { if (!disposed) setNotice(error instanceof Error ? error.message : "This call is no longer available."); });
    };
    window.addEventListener("tlink:open-team-call",openInvitation);
    return () => { disposed = true; window.removeEventListener("tlink:open-team-call",openInvitation); };
  },[available,api]);

  const activeId = active?.id;
  useEffect(() => {
    if (!available) return;
    let inFlight = false, disposed = false;
    const tick = async () => {
      if (inFlight || disposed) return;
      const current = session.current;
      if (!current && starting.current) return;
      if (!navigator.onLine) return;
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
    const resume = () => { if (document.visibilityState === "visible") void tick(); };
    void tick(); const interval = window.setInterval(() => void tick(), activeId ? 1500 : 5000);
    window.addEventListener("focus",resume); window.addEventListener("online",resume); document.addEventListener("visibilitychange",resume);
    return () => { disposed = true; window.clearInterval(interval); window.removeEventListener("focus",resume); window.removeEventListener("online",resume); document.removeEventListener("visibilitychange",resume); };
  // The call ID changes only on start/end; peer and heartbeat updates do not restart polling.
  },[available,api,stop,activeId]);

  const toggleMuted = () => { const next=!muted; media.current?.getAudioTracks().forEach(track => {track.enabled=!next;}); setMuted(next); };
  const changeCamera = async (nextFacing: CameraFacing) => {
    const current = session.current;
    if (!current?.peers || changingCamera.current) return;
    changingCamera.current = true; setSwitchingCamera(true); setCameraNotice("");
    const old = current.local.getVideoTracks()[0];
    // Phones often cannot open their front and back cameras simultaneously.
    // Only the camera stops; the microphone and peer connection stay active.
    old?.stop();
    let replacement: MediaStream | null = null;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({audio:false,video:teamCallCameraConstraints(nextFacing)});
      const track = replacement.getVideoTracks()[0];
      if (!track) throw new Error("The camera did not open.");
      if (session.current !== current) { replacement.getTracks().forEach(item => item.stop()); return; }
      track.enabled = true;
      await current.peers.replaceVideoTrack(track);
      if (session.current !== current) { replacement.getTracks().forEach(item => item.stop()); return; }
      facing.current = nextFacing; setCameraOff(false); setLocalPreview(new MediaStream(current.local.getTracks()));
    } catch (error) {
      replacement?.getTracks().forEach(track => track.stop());
      if (session.current === current) {
        setCameraOff(true);
        setCameraNotice(`${teamCallMediaError(error,"video")} Your voice call is still connected. Use Camera on to retry your previous camera.`);
      }
    } finally {
      if (session.current === current) { changingCamera.current = false; setSwitchingCamera(false); }
    }
  };
  const toggleCamera = () => {
    const track = media.current?.getVideoTracks()[0];
    if (cameraOff && track?.readyState === "ended") { void changeCamera(facing.current); return; }
    const next = !cameraOff; media.current?.getVideoTracks().forEach(item => {item.enabled = !next;}); setCameraOff(next);
  };
  const connected = remotes.some(peer => peer.state === "connected");
  const invitation = incoming[0];
  return <CallContext.Provider value={{start:(threadId,mode) => void begin(threadId,mode),busy:busy || Boolean(active)}}>{children}
    {(active || busy || invitation || notice) && <aside className={`${styles.dock} ${minimized ? styles.minimized : ""}`} aria-label="Internal team call">
      {active ? <><header><div><strong>{active.threadName || "Team call"}</strong><span role="status">{connected ? "Connected" : busy || remotes.length ? "Connecting..." : "Ringing..."} · Internal · {hasCamera ? "Video" : "Voice"}</span></div><button type="button" onClick={() => setMinimized(value => !value)}>{minimized ? "Expand" : "Minimise"}</button></header>
        {!minimized && <div className={styles.grid}><StreamTile stream={localPreview} name={muted ? "You · Muted" : "You"} local cameraOff={cameraOff || !hasCamera} />{remotes.map(peer => <StreamTile key={peer.memberId} stream={peer.stream} name={peer.name} state={peer.state} />)}</div>}
        {cameraNotice && <p role="status" className={styles.help}>{cameraNotice}</p>}
        <div className={styles.controls}><button type="button" aria-pressed={muted} onClick={toggleMuted}>{muted ? "Unmute" : "Mute"}</button>{hasCamera && <><button type="button" disabled={switchingCamera} aria-pressed={cameraOff} onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>{multipleCameras && <button type="button" disabled={switchingCamera} onClick={() => void changeCamera(facing.current === "user" ? "environment" : "user")}>{switchingCamera ? "Switching..." : "Switch camera"}</button>}</>}<button type="button" className={styles.hangup} onClick={() => stop()}>Hang up</button></div>
      </> : busy ? <><strong>Opening your {openingMode === "video" ? "video" : "voice"} call</strong><p role="status">Allow {openingMode === "video" ? "microphone and camera" : "microphone"} access if your device asks.</p><button type="button" onClick={() => stop()}>Cancel</button></> : notice && (retry || !invitation) ? <><strong>Team call</strong><p role="status">{notice}</p><div className={styles.controls}>{retry && <><button type="button" className={styles.answer} onClick={() => void begin(retry.threadId,retry.mode,retry.existing)}>Retry</button>{retry.mode === "video" && <button type="button" onClick={() => void begin(retry.threadId,"audio",retry.existing)}>Use voice only</button>}</>}<button type="button" onClick={() => {setNotice("");setRetry(null);}}>Close</button></div></> : invitation ? <><strong>{invitation.threadName || "Team call"}</strong><p role="status">Incoming {invitation.mode === "video" ? "video" : "voice"} call · Internal</p><p className={styles.help}>Your microphone{invitation.mode === "video" ? " and camera turn" : " turns"} on when you answer.</p><div className={styles.controls}><button type="button" className={styles.answer} onClick={() => void begin(invitation.threadId,invitation.mode,invitation)}>Answer</button>{invitation.mode === "video" && <button type="button" onClick={() => void begin(invitation.threadId,"audio",invitation)}>Voice only</button>}<button type="button" onClick={() => {dismissed.current.add(invitation.id);setIncoming(items=>items.filter(item=>item.id!==invitation.id));}}>Decline</button></div></> : null}
    </aside>}
  </CallContext.Provider>;
}
