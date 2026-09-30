"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TeamCallConnections, type CallRemote } from "@/lib/trade-team-call-client";
import { openTeamCallMedia, TeamCallRinger, teamCallCameraConstraints, teamCallMediaConstraints, teamCallMediaError, teamCallNeedsPermission, teamCallPolicyBlocked, teamCallPermissionState, teamCallPermissionSteps, type CameraFacing } from "@/lib/trade-team-call-media";
import { tradeBrowserDevice } from "@/lib/trade-device-client";
import type { TeamCall, TeamCallSignal } from "@/lib/trade-team-calls";

type Mode = "audio" | "video";
type CallResult = { ok: boolean; error?: string; code?: string; call?: TeamCall | null; calls?: TeamCall[]; memberId?: string; signals?: TeamCallSignal[]; iceServers?: RTCIceServer[] };
type CallSession = { call: TeamCall; sessionId: string; memberId: string; local: MediaStream; peers: TeamCallConnections | null; cursor: number; lastSuccess: number; startedAt: number; hadRemote: boolean };
type RetryCall = { threadId: string; mode: Mode; existing?: TeamCall };
const CallContext = createContext<{ start: (threadId: string, mode: Mode) => void; busy: boolean } | null>(null);

function CallIcon({ name }: { name: "voice" | "video" | "mic" | "mic-off" | "camera-off" | "switch" | "expand" | "minimise" | "end" }) {
  return <svg className="tlink-call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "voice" && <path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a13 13 0 0 1-6-6l2-2-2-5Z" />}
    {name === "video" && <><rect x="3" y="6" width="12" height="12" rx="3" /><path d="m15 10 6-3v10l-6-3" /></>}
    {name === "camera-off" && <><path d="M9 6h3a3 3 0 0 1 3 3v1l6-3v10l-3-1.5M15 15v.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 3 15.5v-7c0-.6.2-1.2.6-1.6M3 3l18 18" /></>}
    {(name === "mic" || name === "mic-off") && <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />{name === "mic-off" && <path d="m3 3 18 18" />}</>}
    {name === "switch" && <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>}
    {name === "expand" && <path d="M8 3H3v5m0-5 6 6m7 12h5v-5m0 5-6-6" />}
    {name === "minimise" && <path d="M3 9h6V3M9 9 3 3m18 12h-6v6m0-6 6 6" />}
    {name === "end" && <path d="M3 15v-4a16 16 0 0 1 18 0v4l-5 1v-4a13 13 0 0 0-8 0v4l-5-1Z" />}
  </svg>;
}

export function TradeTeamCallButtons({ threadId }: { threadId: string }) {
  const calls = useContext(CallContext);
  return <div className="tlink-call-buttons" role="group" aria-label="Team calls">
    <button type="button" className="tlink-call-voice" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"audio")} aria-label="Start voice call"><CallIcon name="voice" /><span className="tlink-call-entry-label">Voice call</span></button>
    <button type="button" className="tlink-call-video" disabled={!calls || calls.busy} onClick={() => calls?.start(threadId,"video")} aria-label="Start video call"><CallIcon name="video" /><span className="tlink-call-entry-label">Video call</span></button>
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
  return <div className="tlink-call-tile"><span className="tlink-call-initial" aria-hidden="true">{name.slice(0,1)}</span><video className={cameraOff ? "tlink-call-hidden-video" : undefined} ref={video} autoPlay playsInline muted={local} aria-label={local ? "Your camera preview" : `${name}'s call`} />
    <span className="tlink-call-caption">{name}{state && state !== "connected" ? ` · ${state === "new" ? "Connecting" : state}` : ""}</span>
    {playBlocked && <button type="button" className="tlink-call-play" onClick={() => void video.current?.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true))}>Play audio</button>}
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
  const [permissionHelp,setPermissionHelp] = useState<{mode: Mode; denied: boolean; policyBlocked: boolean} | null>(null);
  const [hasCamera,setHasCamera] = useState(false), [multipleCameras,setMultipleCameras] = useState(false), [switchingCamera,setSwitchingCamera] = useState(false);
  const [cameraNotice,setCameraNotice] = useState("");
  const [ringReady,setRingReady] = useState(false);
  const ringer = useRef<TeamCallRinger | null>(null);
  const presenceRevision = useRef(0);
  const facing = useRef<CameraFacing>("user"), changingCamera = useRef(false);
  const session = useRef<CallSession | null>(null), media = useRef<MediaStream | null>(null), generation = useRef(0), dismissed = useRef(new Set<string>()), starting = useRef(false);
  const mediaRequest = useRef<AbortController | null>(null);
  const authentication = useRef({user,getAuthHeaders});
  useEffect(() => { authentication.current = {user,getAuthHeaders}; },[user,getAuthHeaders]);
  const available = enabled && Boolean(user || getAuthHeaders);
  useEffect(() => {
    if (!available) return;
    const audio = new TeamCallRinger(setRingReady);
    ringer.current = audio;
    const unlock = () => { void audio.unlock(); };
    const message = () => { if (!session.current && !starting.current) audio.message(); };
    const presenceChanged = (event: Event) => {
      if (!(event instanceof CustomEvent) || !["online","busy","offline"].includes(event.detail?.status)) return;
      presenceRevision.current++;
      if (event.detail.status !== "online") { setIncoming([]); audio.stop(); }
    };
    // The first ordinary interaction unlocks page audio without requesting
    // microphone access. Incoming calls still require an explicit Answer.
    window.addEventListener("pointerdown",unlock);
    window.addEventListener("keydown",unlock);
    window.addEventListener("tlink:enable-call-sound",unlock);
    window.addEventListener("tlink:message-received",message);
    window.addEventListener("tlink:team-presence-changed",presenceChanged);
    return () => {
      ringer.current = null; audio.close();
      window.removeEventListener("pointerdown",unlock);
      window.removeEventListener("keydown",unlock);
      window.removeEventListener("tlink:enable-call-sound",unlock);
      window.removeEventListener("tlink:message-received",message);
      window.removeEventListener("tlink:team-presence-changed",presenceChanged);
    };
  },[available]);
  const ringingId = !active && !busy && !retry ? incoming[0]?.id : undefined;
  useEffect(() => {
    if (!ringingId) return;
    const audio = ringer.current; audio?.start();
    return () => audio?.stop();
  },[ringingId]);
  const api = useCallback(async (query = "", body?: Record<string,unknown>): Promise<CallResult> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new Error("The call connection timed out. Check your internet connection and try again.");
    const request = async () => {
      const {user,getAuthHeaders} = authentication.current;
      const headers: Record<string,string> = getAuthHeaders ? await getAuthHeaders() : user ? {Authorization:`Bearer ${await user.getIdToken()}`} : {};
      if (controller.signal.aborted) throw timeoutError;
      const response = await fetch(`/api/trade-team-calls${query ? `?${query}` : ""}`, { method:body ? "POST" : "GET", headers:{...headers,...(body ? {"Content-Type":"application/json"} : {})}, body:body ? JSON.stringify(body) : undefined, cache:"no-store", signal:controller.signal });
      const result: CallResult = await response.json();
      if (!response.ok || !result.ok) { const error = new Error(result.error || "The call could not connect."); Object.assign(error,{code:result.code,status:response.status}); throw error; }
      return result;
    };
    try {
      return await Promise.race([request(), new Promise<never>((_,reject) => {
        timer = setTimeout(() => { reject(timeoutError); controller.abort(); },15000);
      })]);
    } finally { clearTimeout(timer); }
  },[fetch]);

  const release = useCallback((notify = true) => {
    generation.current++; starting.current = false;
    mediaRequest.current?.abort(); mediaRequest.current = null;
    const current = session.current; session.current = null;
    current?.peers?.close();
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    changingCamera.current = false;
    if (current) { dismissed.current.add(current.call.id); if (notify) void api("",{action:"leave",callId:current.call.id,sessionId:current.sessionId}).catch(() => {}); }
  },[api]);
  const stop = useCallback((message = "", notify = true) => {
    release(notify);
    setActive(null); setRemotes([]); setLocalPreview(null); setBusy(false); setMuted(false); setCameraOff(false); setNotice(message);
    setRetry(null); setPermissionHelp(null); setCameraNotice(""); setHasCamera(false); setMultipleCameras(false); setSwitchingCamera(false);
  },[release]);

  useEffect(() => {
    if (!available) return;
    return () => release();
  },[available,release]);

  const begin = useCallback(async (threadId: string, mode: Mode, existing?: TeamCall) => {
    if (!available || starting.current || session.current) return;
    starting.current = true; setBusy(true); setNotice(""); setRetry(null); setPermissionHelp(null); setMinimized(false); setOpeningMode(mode);
    const epoch = ++generation.current, sessionId = crypto.randomUUID();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Calling is not supported here. Open TLink in an up-to-date Chrome, Edge, Safari or Firefox browser using HTTPS.");
      const request = new AbortController(); mediaRequest.current = request;
      const local = await openTeamCallMedia(teamCallMediaConstraints(mode),undefined,request.signal);
      if (mediaRequest.current === request) mediaRequest.current = null;
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
      const current: CallSession = {call:result.call,memberId:result.memberId,sessionId,local,peers:null,cursor:0,lastSuccess:Date.now(),startedAt:Date.now(),hadRemote:result.call.participants.some(person => person.memberId !== result.memberId)};
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
      if (teamCallNeedsPermission(error)) {
        const failureEpoch = generation.current;
        const policyBlocked = teamCallPolicyBlocked(mode);
        setPermissionHelp({mode,denied:false,policyBlocked});
        if (policyBlocked) setNotice("Open TLink directly to allow calls. Then choose Allow when your browser asks.");
        // Read-only diagnostics run after the permission request failed. Never
        // await a permission query before a user-initiated getUserMedia call.
        else void teamCallPermissionState(mode).then(state => {
          if (generation.current !== failureEpoch || state !== "denied") return;
          setPermissionHelp({mode,denied:true,policyBlocked:false}); setNotice(teamCallMediaError(error,mode,true));
        });
      }
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
      const availabilityVersion = presenceRevision.current;
      // A notification is only a request to show the invitation. The server
      // verifies current membership and an explicit Answer requests media.
      void api(`threadId=${encodeURIComponent(threadId)}`).then(result => {
        if (disposed || session.current || starting.current || availabilityVersion !== presenceRevision.current) return;
        if (result.call?.id !== callId || result.call.status !== "active") { setNotice("This call has ended. You can call your teammate back from Messages."); return; }
        dismissed.current.delete(callId); stop("",false); setMinimized(false); setIncoming([result.call]);
      }).catch(error => { if (!disposed) setNotice(error instanceof Error ? error.message : "This call is no longer available."); });
    };
    window.addEventListener("tlink:open-team-call",openInvitation);
    return () => { disposed = true; window.removeEventListener("tlink:open-team-call",openInvitation); };
  },[available,api,stop]);

  const activeId = active?.id;
  useEffect(() => {
    if (!available) return;
    let inFlight = false, disposed = false;
    const tick = async () => {
      if (inFlight || disposed) return;
      const current = session.current;
      if (!current && starting.current) return;
      if (!navigator.onLine) { if (current) stop("Your device is offline. Reconnect to the internet, then call again."); return; }
      inFlight = true;
      let processing = false;
      try {
        if (current && current.peers) {
          const result = await api(`callId=${encodeURIComponent(current.call.id)}&sessionId=${encodeURIComponent(current.sessionId)}&after=${current.cursor}`);
          if (disposed || session.current !== current) return;
          if (!result.call || result.call.status !== "active") { stop("Call ended.",false); return; }
          const hasRemote = result.call.participants.some(person => person.memberId !== current.memberId);
          if (current.hadRemote && !hasRemote) { stop("Your teammate left the call."); return; }
          if (!hasRemote && Date.now()-current.startedAt >= 60000) { stop("No answer. You can call again or send a message."); return; }
          current.hadRemote ||= hasRemote;
          current.call = result.call; setActive(result.call); processing = true;
          await current.peers.sync(result.call.participants);
          for (const signal of result.signals || []) { await current.peers.receive(signal); current.cursor = Math.max(current.cursor,signal.sequence); }
          current.lastSuccess = Date.now();
        } else if (!current) {
          const availabilityVersion = presenceRevision.current;
          const result = await api("view=incoming");
          if (!disposed && !session.current && availabilityVersion === presenceRevision.current) setIncoming((result.calls || []).filter(call => !dismissed.current.has(call.id) && call.createdByMemberId !== result.memberId));
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
      const request = new AbortController(); mediaRequest.current = request;
      replacement = await openTeamCallMedia({audio:false,video:teamCallCameraConstraints(nextFacing)},undefined,request.signal);
      if (mediaRequest.current === request) mediaRequest.current = null;
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
  const browser = tradeBrowserDevice();
  const openDirectInNewTab = browser.embedded || typeof window !== "undefined" && window.top !== window;
  return <CallContext.Provider value={{start:(threadId,mode) => void begin(threadId,mode),busy:busy || Boolean(active)}}>{children}
    {(active || busy || invitation || notice) && <aside className={`tlink-call-dock ${minimized ? "tlink-call-minimized" : ""}`} aria-label="Internal team call">
      {active ? <><header><div><strong>{active.threadName || "Team call"}</strong><span role="status">{connected ? "Connected" : busy || remotes.length ? "Connecting..." : "Waiting for answer..."} · Internal · {hasCamera ? "Video" : "Voice"}</span></div><button type="button" onClick={() => setMinimized(value => !value)}><CallIcon name={minimized ? "expand" : "minimise"} />{minimized ? "Expand" : "Minimise"}</button></header>
        {!minimized && <div className="tlink-call-grid"><StreamTile stream={localPreview} name={muted ? "You · Muted" : "You"} local cameraOff={cameraOff || !hasCamera} />{remotes.map(peer => <StreamTile key={peer.memberId} stream={peer.stream} name={peer.name} state={peer.state} />)}</div>}
        {cameraNotice && <p role="status" className="tlink-call-help">{cameraNotice}</p>}
        <div className="tlink-call-controls"><button type="button" aria-pressed={muted} onClick={toggleMuted}><CallIcon name={muted ? "mic-off" : "mic"} />{muted ? "Unmute" : "Mute"}</button>{hasCamera && <><button type="button" disabled={switchingCamera} aria-pressed={cameraOff} onClick={toggleCamera}><CallIcon name={cameraOff ? "camera-off" : "video"} />{cameraOff ? "Camera on" : "Camera off"}</button>{multipleCameras && <button type="button" disabled={switchingCamera} onClick={() => void changeCamera(facing.current === "user" ? "environment" : "user")}><CallIcon name="switch" />{switchingCamera ? "Switching..." : "Switch camera"}</button>}</>}<button type="button" className="tlink-call-hangup" onClick={() => stop()}><CallIcon name="end" />End call</button></div>
      </> : busy ? <><strong>Opening your {openingMode === "video" ? "video" : "voice"} call</strong><p role="status">Choose Allow if your browser asks for {openingMode === "video" ? "microphone and camera" : "microphone"} access.</p><button type="button" onClick={() => stop()}>Cancel</button></>
        : notice && (retry || !invitation) ? <>
          <strong>{permissionHelp ? permissionHelp.mode === "video" ? "Microphone and camera access" : "Microphone access" : "Team call"}</strong>
          <p role="status">{notice}</p>
          {permissionHelp && !permissionHelp.policyBlocked && <details className="tlink-call-permission-help" open={permissionHelp.denied}>
            <summary>{permissionHelp.denied ? "How to allow access" : "Not seeing a permission prompt?"}</summary>
            <ol>{teamCallPermissionSteps(permissionHelp.mode,browser).map(step => <li key={step}>{step}</li>)}</ol>
          </details>}
          <div className="tlink-call-controls">
            {retry && (permissionHelp?.policyBlocked ? <a className="tlink-call-direct-link" href={`/direct-trade/messages?threadId=${encodeURIComponent(retry.threadId)}${retry.existing ? `&callId=${encodeURIComponent(retry.existing.id)}` : ""}`} target={openDirectInNewTab ? "_blank" : undefined} rel="noopener noreferrer">Open TLink calls</a>
              : <><button type="button" className="tlink-call-answer" onClick={() => void begin(retry.threadId,retry.mode,retry.existing)}>
              {permissionHelp && !permissionHelp.denied ? retry.mode === "video" ? "Allow mic & camera" : "Allow microphone" : "Try again"}
            <CallIcon name={retry.mode === "video" ? "video" : "voice"} /></button>{retry.mode === "video" && <button type="button" onClick={() => void begin(retry.threadId,"audio",retry.existing)}><CallIcon name="voice" />Use voice only</button>}</>)}
            <button type="button" onClick={() => stop()}>Close</button>
          </div>
        </> : invitation ? <><strong>{invitation.threadName || "Team call"}</strong><p role="status">Incoming {invitation.mode === "video" ? "video" : "voice"} call · Internal</p><p className="tlink-call-help">Your microphone{invitation.mode === "video" ? " and camera turn" : " turns"} on when you answer.</p>{!ringReady && <button type="button" onClick={() => void ringer.current?.unlock()}>Enable ring sound</button>}<div className="tlink-call-controls"><button type="button" className="tlink-call-answer" onClick={() => void begin(invitation.threadId,invitation.mode,invitation)}>Answer<CallIcon name={invitation.mode === "video" ? "video" : "voice"} /></button>{invitation.mode === "video" && <button type="button" onClick={() => void begin(invitation.threadId,"audio",invitation)}><CallIcon name="voice" />Voice only</button>}<button type="button" onClick={() => {dismissed.current.add(invitation.id);setIncoming(items=>items.filter(item=>item.id!==invitation.id));}}><CallIcon name="end" />Decline</button></div></> : null}
    </aside>}
  </CallContext.Provider>;
}
