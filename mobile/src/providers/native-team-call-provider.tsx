import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaDevices, RTCView, type MediaStream } from 'react-native-webrtc';

import type { TeamCall, TeamCallSignal } from '../../../src/lib/trade-team-calls';
import { FieldButton } from '@/components/field-button';
import { ApiError, apiRequest } from '@/lib/api';
import { NativeTeamCallConnections, type NativeCallRemote, type NativeIceServer } from '@/lib/native-team-call-client';
import { acquireNativeCallMedia, nativeCallError, releaseNativeCallMedia, type NativeCallMode } from '@/lib/native-team-call-media';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

type Invitation = { threadId: string; callId: string };
type CallValue = {
  start: (threadId: string, mode: NativeCallMode) => Promise<void>;
  openInvitation: (target: Invitation) => Promise<void>;
  busy: boolean;
};
type CallResult = {
  ok: boolean; call?: TeamCall | null; calls?: TeamCall[]; memberId?: string;
  signals?: TeamCallSignal[]; iceServers?: NativeIceServer[];
};
type Session = {
  call: TeamCall; sessionId: string; memberId: string; local: MediaStream;
  peers: NativeTeamCallConnections | null; cursor: number; lastSuccess: number;
};
type Retry = { threadId: string; mode: NativeCallMode; existing?: TeamCall };
const Calls = createContext<CallValue | null>(null);
const validId = (value: string) => /^[a-zA-Z0-9_-]{8,120}$/.test(value);

export function useNativeTeamCalls() {
  const calls = useContext(Calls);
  if (!calls) throw new Error('Native team calls must be inside NativeTeamCallProvider.');
  return calls;
}

export function NativeTeamCallProvider({ children }: { children: ReactNode }) {
  const { user, access, loading } = useApp();
  const enabled = Boolean(user) && access.status === 'approved' && !loading;
  // Remounting on principal/access changes closes all media before another
  // account can see or participate in the preceding account's call.
  return <NativeTeamCallSession key={`${user?.localOwnerKey || 'signed-out'}:${enabled}`} enabled={enabled}>{children}</NativeTeamCallSession>;
}

function NativeTeamCallSession({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [active, setActive] = useState<TeamCall | null>(null);
  const [incoming, setIncoming] = useState<TeamCall[]>([]);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<NativeCallMode>('audio');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<NativeCallRemote[]>([]);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [frontCamera, setFrontCamera] = useState(true);
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const mounted = useRef(true);
  const foreground = useRef(AppState.currentState !== 'background');
  const generation = useRef(0);
  const starting = useRef(false);
  const session = useRef<Session | null>(null);
  const media = useRef<MediaStream | null>(null);
  const audioStarted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const dismissed = useRef(new Set<string>());
  const cameraChanging = useRef(false);

  const api = useCallback(async (query = '', body?: Record<string, unknown>) => {
    if (!mounted.current) throw new Error('This call session has closed.');
    const controller = new AbortController();
    requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await apiRequest<CallResult>(`/api/trade-team-calls${query ? `?${query}` : ''}`, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!result.ok) throw new Error('The call could not connect. Try again.');
      return result;
    } finally {
      clearTimeout(timeout);
      requests.current.delete(controller);
    }
  }, []);

  const release = useCallback((notify = true) => {
    generation.current++;
    starting.current = false;
    cameraChanging.current = false;
    const current = session.current;
    session.current = null;
    current?.peers?.close();
    releaseNativeCallMedia(media.current);
    media.current = null;
    if (audioStarted.current) { InCallManager.stop(); audioStarted.current = false; }
    if (current) {
      dismissed.current.add(current.call.id);
      if (notify && mounted.current) void api('', { action: 'leave', callId: current.call.id, sessionId: current.sessionId }).catch(() => {
        // Media is already stopped. The server's 45-second heartbeat lease
        // removes disconnected participants even when this request cannot send.
      });
    }
  }, [api]);

  const stop = useCallback((message = '', notify = true) => {
    release(notify);
    if (!mounted.current) return;
    setActive(null); setLocal(null); setRemotes([]); setOpening(false);
    setMuted(false); setCameraOff(false); setNotice(message); setRetry(null);
    setShowSettings(false); setSwitchingCamera(false); setCanSwitchCamera(false); setMinimized(false);
  }, [release]);

  useEffect(() => {
    mounted.current = true;
    const pendingRequests = requests.current;
    return () => {
      mounted.current = false;
      // Do not send using a new identity during sign-out/account switching.
      release(false);
      pendingRequests.forEach(controller => controller.abort());
      pendingRequests.clear();
    };
  }, [release]);

  const begin = useCallback(async (threadId: string, nextMode: NativeCallMode, existing?: TeamCall) => {
    if (!enabled || !foreground.current || starting.current || session.current) return;
    if (!validId(threadId)) { setNotice('Open the conversation again before calling.'); return; }
    starting.current = true;
    const epoch = ++generation.current;
    const isCurrent = () => mounted.current && foreground.current && generation.current === epoch;
    const sessionId = Crypto.randomUUID();
    setOpening(true); setMode(nextMode); setNotice(''); setRetry(null); setShowSettings(false); setMinimized(false);
    try {
      // This function is reached only through Start, Answer, or Retry. Neither
      // notification handling nor foreground polling acquires device media.
      const stream = await acquireNativeCallMedia(nextMode, isCurrent);
      if (!stream) return;
      media.current = stream;
      setLocal(stream); setFrontCamera(true);
      InCallManager.start({ media: nextMode, auto: true });
      audioStarted.current = true;
      InCallManager.setKeepScreenOn(true);
      setSpeaker(nextMode === 'video');
      if (nextMode === 'video') void mediaDevices.enumerateDevices().then(devices => {
        if (isCurrent() && Array.isArray(devices)) setCanSwitchCamera(devices.filter(device => device && typeof device === 'object' && 'kind' in device && device.kind === 'videoinput').length > 1);
      }).catch(() => { /* The main call remains available without a second camera. */ });
      const result = await api('', existing ? { action: 'join', callId: existing.id, sessionId }
        : { action: 'start', threadId, mode: nextMode, sessionId, requestId: Crypto.randomUUID() });
      if (!result.call || !result.memberId) throw new Error('The call did not start. Try again.');
      if (!isCurrent()) {
        if (mounted.current) void api('', { action: 'leave', callId: result.call.id, sessionId }).catch(() => undefined);
        return;
      }
      const current: Session = { call: result.call, memberId: result.memberId, sessionId, local: stream, peers: null, cursor: 0, lastSuccess: Date.now() };
      session.current = current;
      setActive(current.call); setIncoming(items => items.filter(item => item.id !== current.call.id));
      const ice = await api('', { action: 'ice', callId: current.call.id, sessionId });
      if (!isCurrent() || session.current !== current) return;
      if (!ice.iceServers?.length) throw new Error('The call connection service is unavailable. Try again shortly.');
      current.peers = new NativeTeamCallConnections({
        memberId: current.memberId, sessionId, local: stream, iceServers: ice.iceServers,
        send: async (target, type, payload) => {
          if (session.current !== current) return;
          await api('', { action: 'signal', callId: current.call.id, sessionId,
            toMemberId: target.memberId, toSessionId: target.sessionId, requestId: Crypto.randomUUID(), type, payload });
        },
        changed: peers => { if (session.current === current) setRemotes(peers); },
        failed: message => { if (session.current === current) stop(message); },
      });
      await current.peers.sync(current.call.participants);
      if (isCurrent()) { starting.current = false; setOpening(false); }
    } catch (error) {
      if (!isCurrent()) return;
      const detail = nativeCallError(error, nextMode);
      stop(detail.message);
      setShowSettings(detail.settings);
      if (error instanceof ApiError && error.code === 'CALL_ALREADY_ACTIVE') {
        try {
          const result = await api(`threadId=${encodeURIComponent(threadId)}`);
          if (mounted.current && !session.current && !starting.current && result.call?.status === 'active') {
            dismissed.current.delete(result.call.id); setIncoming([result.call]); setNotice('');
          }
        } catch { /* Preserve the useful original failure. */ }
      } else setRetry({ threadId, mode: nextMode, existing });
    }
  }, [enabled, api, stop]);

  const openInvitation = useCallback(async ({ threadId, callId }: Invitation) => {
    if (!enabled || !validId(threadId) || !validId(callId)) return;
    if (session.current?.call.id === callId) { setMinimized(false); return; }
    if (session.current || starting.current) return;
    const epoch = generation.current;
    try {
      const result = await api(`threadId=${encodeURIComponent(threadId)}`);
      if (!mounted.current || epoch !== generation.current || session.current || starting.current) return;
      if (result.call?.id !== callId || result.call.status !== 'active') {
        setNotice('This call has ended. Call your teammate back from Messages.'); return;
      }
      dismissed.current.delete(callId);
      setIncoming([result.call]); setNotice(''); setRetry(null); setMinimized(false);
    } catch (error) {
      if (mounted.current && epoch === generation.current) setNotice(error instanceof Error ? error.message : 'This call is no longer available.');
    }
  }, [api, enabled]);

  const activeId = active?.id;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    const tick = async () => {
      if (disposed || inFlight || !foreground.current) return;
      const current = session.current;
      if (starting.current || (current && !current.peers)) return;
      inFlight = true;
      let processing = false;
      try {
        if (current?.peers) {
          const result = await api(`callId=${encodeURIComponent(current.call.id)}&sessionId=${encodeURIComponent(current.sessionId)}&after=${current.cursor}`);
          if (disposed || !foreground.current || session.current !== current) return;
          if (!result.call || result.call.status !== 'active') { stop('Call ended.', false); return; }
          processing = true;
          current.call = result.call;
          setActive(result.call);
          await current.peers.sync(result.call.participants);
          for (const signal of result.signals || []) {
            if (session.current !== current) return;
            await current.peers.receive(signal);
            current.cursor = Math.max(current.cursor, signal.sequence);
          }
          current.lastSuccess = Date.now();
        } else {
          const result = await api('view=incoming');
          if (!disposed && foreground.current && !session.current && !starting.current) {
            setIncoming((result.calls || []).filter(call => !dismissed.current.has(call.id)));
          }
        }
      } catch (error) {
        if (disposed || !current || session.current !== current) return;
        if (processing || (error instanceof ApiError && [401, 403, 409].includes(error.status)) || Date.now() - current.lastSuccess > 15_000) {
          stop(processing ? 'The media connection failed. Call again when connected.' : error instanceof Error ? error.message : 'Connection lost. Try again when online.');
        }
      } finally { inFlight = false; }
    };
    const listener = AppState.addEventListener('change', state => {
      // An iOS permission dialog briefly produces inactive, not background.
      // Real backgrounding closes media; resuming never silently reopens it.
      if (state === 'background') {
        foreground.current = false;
        if (session.current || starting.current) stop('Call ended when TLink moved to the background. Keep TLink open during calls.');
        setIncoming([]);
      } else if (state === 'active') { foreground.current = true; void tick(); }
    });
    void tick();
    const interval = setInterval(() => void tick(), activeId ? 1500 : 5000);
    return () => { disposed = true; clearInterval(interval); listener.remove(); };
  }, [enabled, api, stop, activeId]);

  const switchCamera = async () => {
    const current = session.current;
    const track = current?.local.getVideoTracks()[0];
    if (!current || !track || cameraChanging.current) return;
    cameraChanging.current = true; setSwitchingCamera(true); setNotice('');
    try {
      const next = frontCamera ? 'environment' : 'user';
      await track.applyConstraints({ facingMode: next, width: 640, height: 480, frameRate: 24 });
      if (session.current === current) setFrontCamera(next === 'user');
    } catch {
      if (session.current === current) setNotice('The camera could not switch. Your call is still connected.');
    } finally {
      cameraChanging.current = false;
      if (session.current === current) setSwitchingCamera(false);
    }
  };
  const toggleMute = () => {
    media.current?.getAudioTracks().forEach(track => { track.enabled = muted; });
    setMuted(!muted);
  };
  const toggleCamera = () => {
    media.current?.getVideoTracks().forEach(track => { track.enabled = cameraOff; });
    setCameraOff(!cameraOff);
  };
  const invitation = incoming[0];
  const hasCamera = Boolean(local?.getVideoTracks().length);
  const connected = remotes.some(peer => peer.state === 'connected');
  const visible = Boolean(active || opening || invitation || notice);
  const closeNotice = () => { setNotice(''); setRetry(null); setShowSettings(false); };
  return <Calls.Provider value={{ start: (threadId, nextMode) => begin(threadId, nextMode), openInvitation, busy: opening || Boolean(active) }}>
    {children}
    {active && minimized && <Pressable accessibilityRole="button" accessibilityLabel="Return to team call" onPress={() => setMinimized(false)} style={styles.returnToCall}>
      <Text style={styles.returnText}>Return to {active.threadName || 'team call'}</Text>
    </Pressable>}
    <Modal visible={visible && !minimized} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => active ? setMinimized(true) : opening ? stop() : invitation ? (() => { dismissed.current.add(invitation.id); setIncoming(items => items.filter(item => item.id !== invitation.id)); closeNotice(); })() : closeNotice()}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}><View style={styles.headerText}><Text style={styles.eyebrow}>TLINK TEAM CALL</Text><Text style={styles.title}>{active?.threadName || invitation?.threadName || 'Team call'}</Text>
          <Text style={styles.subtitle}>{active ? `${connected ? 'Connected' : opening || remotes.length ? 'Connecting...' : 'Ringing...'} · ${hasCamera ? 'Video' : 'Voice'}` : 'Private to your team'}</Text></View>
          {active && <FieldButton variant="quiet" onPress={() => setMinimized(true)}>Minimise</FieldButton>}
        </View>
        {active ? <>
          <ScrollView contentContainerStyle={styles.tiles}>
            {remotes.map(peer => <CallTile key={peer.memberId} stream={peer.stream} name={peer.name} status={peer.state === 'connected' ? '' : peer.state === 'new' ? 'Connecting' : peer.state} />)}
            {!remotes.length && <View style={styles.waiting}><Text style={styles.waitingText}>Calling your team...</Text><Text style={styles.subtitle}>Keep TLink open during your call.</Text></View>}
            <CallTile stream={local} name={muted ? 'You · Muted' : 'You'} local cameraOff={cameraOff || !hasCamera} mirror={frontCamera} />
          </ScrollView>
          {notice ? <Text accessibilityRole="alert" style={styles.help}>{notice}</Text> : null}
          <View style={styles.controls}>
            <FieldButton style={styles.control} variant="secondary" onPress={toggleMute}>{muted ? 'Unmute' : 'Mute'}</FieldButton>
            <FieldButton style={styles.control} variant="secondary" onPress={() => { InCallManager.setForceSpeakerphoneOn(!speaker); setSpeaker(!speaker); }}>{speaker ? 'Speaker off' : 'Speaker on'}</FieldButton>
            {hasCamera && <><FieldButton style={styles.control} variant="secondary" onPress={toggleCamera}>{cameraOff ? 'Camera on' : 'Camera off'}</FieldButton>
              {canSwitchCamera && <FieldButton style={styles.control} variant="secondary" disabled={switchingCamera} onPress={() => void switchCamera()}>{switchingCamera ? 'Switching...' : 'Switch camera'}</FieldButton>}</>}
            <FieldButton style={styles.hangup} variant="danger" onPress={() => stop()}>Hang up</FieldButton>
          </View>
        </> : opening ? <View style={styles.body}><ActivityIndicator color={colours.green} size="large" /><Text style={styles.bodyTitle}>Opening your {mode === 'video' ? 'video' : 'voice'} call</Text><Text style={styles.help}>Allow microphone{mode === 'video' ? ' and camera' : ''} access if your device asks.</Text><FieldButton variant="secondary" onPress={() => stop()}>Cancel</FieldButton></View>
          : notice ? <View style={styles.body}><Text accessibilityRole="alert" style={styles.help}>{notice}</Text>
            {retry && <FieldButton onPress={() => void begin(retry.threadId, retry.mode, retry.existing)}>Retry</FieldButton>}
            {retry?.mode === 'video' && <FieldButton variant="secondary" onPress={() => void begin(retry.threadId, 'audio', retry.existing)}>Use voice only</FieldButton>}
            {showSettings && <FieldButton variant="secondary" onPress={() => void Linking.openSettings().catch(() => setNotice('Open your device Settings, choose TLink, then allow microphone and camera.'))}>Open device settings</FieldButton>}
            <FieldButton variant="quiet" onPress={closeNotice}>Close</FieldButton>
          </View> : invitation ? <View style={styles.body}><View style={styles.avatar}><Text style={styles.initial}>{invitation.threadName.slice(0, 1).toUpperCase() || 'T'}</Text></View><Text style={styles.bodyTitle}>Incoming {invitation.mode === 'video' ? 'video' : 'voice'} call</Text><Text style={styles.help}>Your microphone{invitation.mode === 'video' ? ' and camera turn' : ' turns'} on when you answer.</Text>
            <FieldButton onPress={() => void begin(invitation.threadId, invitation.mode, invitation)}>Answer</FieldButton>
            {invitation.mode === 'video' && <FieldButton variant="secondary" onPress={() => void begin(invitation.threadId, 'audio', invitation)}>Answer with voice only</FieldButton>}
            <FieldButton variant="danger" onPress={() => { dismissed.current.add(invitation.id); setIncoming(items => items.filter(item => item.id !== invitation.id)); }}>Decline</FieldButton>
          </View> : null}
      </SafeAreaView>
    </Modal>
  </Calls.Provider>;
}

function CallTile({ stream, name, status = '', local = false, cameraOff = false, mirror = false }: {
  stream: MediaStream | null; name: string; status?: string; local?: boolean; cameraOff?: boolean; mirror?: boolean;
}) {
  const hasVideo = Boolean(stream?.getVideoTracks().length) && !cameraOff;
  return <View style={[styles.tile, local && styles.localTile]} accessibilityLabel={`${name}${status ? `, ${status}` : ''}`}>
    <View style={styles.avatar}><Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text></View>
    {stream && hasVideo && <RTCView style={StyleSheet.absoluteFill} streamURL={stream.toURL()} objectFit="cover" mirror={local && mirror} />}
    <View style={styles.caption}><Text style={styles.captionText}>{name}{status ? ` · ${status}` : ''}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colours.line },
  headerText: { flex: 1, gap: 5 },
  eyebrow: { color: colours.green, fontSize: 11, letterSpacing: 1.3, fontWeight: '800' },
  title: { color: colours.ink, fontSize: 23, fontWeight: '700' },
  subtitle: { color: colours.muted, fontSize: 14, lineHeight: 21 },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  bodyTitle: { color: colours.ink, fontSize: 23, fontWeight: '700', textAlign: 'center' },
  help: { color: colours.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', paddingHorizontal: spacing.md },
  tiles: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  tile: { minHeight: 210, flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colours.surfaceRaised, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colours.line },
  localTile: { minHeight: 150, maxHeight: 220 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colours.mintStrong, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  initial: { color: colours.green, fontSize: 34, fontWeight: '700' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#06131fcc', padding: spacing.sm },
  captionText: { color: colours.ink, fontSize: 14, fontWeight: '600' },
  waiting: { flex: 1, minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  waitingText: { color: colours.ink, fontSize: 20, fontWeight: '600' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colours.line },
  control: { flexGrow: 1, flexBasis: '45%' },
  hangup: { flexGrow: 1, flexBasis: '100%' },
  returnToCall: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: 92, backgroundColor: colours.green, borderRadius: radius.md, minHeight: 50, justifyContent: 'center', padding: spacing.sm, elevation: 8 },
  returnText: { color: colours.forest, fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
