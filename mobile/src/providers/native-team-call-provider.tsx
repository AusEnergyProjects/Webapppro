import * as Crypto from 'expo-crypto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import softRingtone from '../../assets/sounds/tlink-call-soft.wav';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, AppState, DeviceEventEmitter, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { mediaDevices, RTCView, type MediaStream } from 'react-native-webrtc';

import { TEAM_CALL_RING_SECONDS, type TeamCall, type TeamCallSignal } from '../../../src/lib/trade-team-calls';
import { FieldButton } from '@/components/field-button';
import { ApiError, createTeamCallRequest } from '@/lib/api';
import { notificationsMuted } from '@/lib/device';
import { teamNotificationTarget } from '@/lib/team-messages';
import { NativeTeamCallConnections, type NativeCallRemote, type NativeIceServer } from '@/lib/native-team-call-client';
import { acquireNativeCallMedia, nativeCallError, releaseNativeCallMedia, type NativeCallMode } from '@/lib/native-team-call-media';
import { answerSystemCall, connectSystemCall, currentSystemCall, endSystemCall, markSystemCallConnecting, nativeSystemCallsAvailable, setSystemCallSpeaker, showSystemCall, startSystemCall, subscribeSystemCalls, type SystemCall } from '@/lib/native-system-calls';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

type Invitation = { threadId: string; callId: string };
type CallValue = {
  start: (threadId: string, mode: NativeCallMode) => Promise<void>;
  openInvitation: (target: Invitation) => Promise<void>;
  busy: boolean;
  presented: boolean;
};
type CallResult = {
  ok: boolean; call?: TeamCall | null; calls?: TeamCall[]; memberId?: string;
  ownerUid?: string;
  signals?: TeamCallSignal[]; iceServers?: NativeIceServer[];
};
type Session = {
  call: TeamCall; sessionId: string; memberId: string; local: MediaStream;
  peers: NativeTeamCallConnections | null; cursor: number; lastSuccess: number;
  hadRemote: boolean; connected: boolean;
};
type Retry = { threadId: string; mode: NativeCallMode; existing?: TeamCall };
const Calls = createContext<CallValue | null>(null);
const validId = (value: string) => /^[a-zA-Z0-9_-]{8,120}$/.test(value);
const ringingUntil = (call: TeamCall) => Math.min(Date.parse(call.expiresAt), Date.parse(call.createdAt) + TEAM_CALL_RING_SECONDS * 1000);
const callerName = (call: TeamCall) => call.participants.find(person => person.memberId === call.createdByMemberId)?.name || call.threadName;
type Principal = { ownerId: string; memberId: string; localOwnerKey: string };
type AnswerAuthorization = { answerToken: string; callId: string; threadId: string; ownerUid?: string; memberId?: string };

export function useNativeTeamCalls() {
  const calls = useContext(Calls);
  if (!calls) throw new Error('Native team calls must be inside NativeTeamCallProvider.');
  return calls;
}

export function NativeTeamCallProvider({ children }: { children: ReactNode }) {
  const { user, access, loading } = useApp();
  const enabled = Boolean(user) && access.status === 'approved' && !loading;
  // A PushKit answer can precede workspace restoration. Keep that call alive
  // while the matching principal unlocks; explicit identity changes end it.
  return <NativeTeamCallSession enabled={enabled} principal={user}>{children}</NativeTeamCallSession>;
}

function NativeTeamCallSession({ children, enabled, principal = null }: { children: ReactNode; enabled: boolean; principal?: Principal | null }) {
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
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const mounted = useRef(true);
  const appState = useRef(AppState.currentState);
  const foreground = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const starting = useRef(false);
  const joiningCall = useRef<string | null>(null);
  const answerLookup = useRef<string | null>(null);
  const joinedPending = useRef<{ callId: string; sessionId: string } | null>(null);
  const answerAuthorization = useRef<AnswerAuthorization | null>(null);
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const session = useRef<Session | null>(null);
  const media = useRef<MediaStream | null>(null);
  const mediaRequest = useRef<AbortController | null>(null);
  const tickRef = useRef<() => Promise<void>>(async () => undefined);
  const audioStarted = useRef(false);
  const ringbackStarted = useRef(false);
  const ringDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setupDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requests = useRef(new Set<AbortController>());
  const callRequests = useRef<{ controller: AbortController; request: ReturnType<typeof createTeamCallRequest> } | null>(null);
  const dismissed = useRef(new Set<string>());
  const availableForCalls = useRef(true);
  const cameraChanging = useRef(false);
  const ringtone = useAudioPlayer(softRingtone);
  const ringtoneRef = useRef(ringtone);
  const incomingRef = useRef<TeamCall | null>(null);
  const ringtoneMode = useRef<Promise<void> | null>(null);
  useEffect(() => { ringtoneRef.current = ringtone; }, [ringtone]);
  useEffect(() => { incomingRef.current = incoming[0] || null; }, [incoming]);

  const api = useCallback(async (query = '', body?: Record<string, unknown>) => {
    if (!mounted.current) throw new Error('This call session has closed.');
    const controller = new AbortController();
    requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      if (!callRequests.current) {
        const lifetime = new AbortController();
        callRequests.current = { controller: lifetime, request: createTeamCallRequest(lifetime.signal, answerAuthorization.current || undefined) };
      }
      const result = await callRequests.current.request<CallResult>(query, {
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
    const pendingCallId = joiningCall.current || answerLookup.current;
    joiningCall.current = null;
    answerLookup.current = null;
    cameraChanging.current = false;
    mediaRequest.current?.abort(); mediaRequest.current = null;
    // expo-audio releases the player itself during unmount, before this cleanup.
    if (mounted.current && !nativeSystemCallsAvailable) ringtone.pause();
    if (ringDeadline.current) clearTimeout(ringDeadline.current);
    ringDeadline.current = null;
    if (setupDeadline.current) clearTimeout(setupDeadline.current);
    setupDeadline.current = null;
    if (ringbackStarted.current) { InCallManager.stopRingback(); ringbackStarted.current = false; }
    const current = session.current;
    const pendingJoined = joinedPending.current;
    joinedPending.current = null;
    session.current = null;
    current?.peers?.close();
    releaseNativeCallMedia(media.current);
    media.current = null;
    if (audioStarted.current) { InCallManager.stop(); audioStarted.current = false; }
    let leaving: Promise<unknown> | null = null;
    if (current) {
      void endSystemCall(current.call.id).catch(() => undefined);
      dismissed.current.add(current.call.id);
      if (notify && mounted.current) leaving = api('', { action: 'leave', callId: current.call.id, sessionId: current.sessionId }).catch(() => {
        // Media is already stopped. The server's 45-second heartbeat lease
        // removes disconnected participants even when this request cannot send.
      });
    } else if (pendingCallId) {
      dismissed.current.add(pendingCallId);
      void endSystemCall(pendingCallId).catch(() => undefined);
      if (pendingJoined && notify && mounted.current) leaving = api('', { action: 'leave', callId: pendingJoined.callId, sessionId: pendingJoined.sessionId }).catch(() => undefined);
    }
    // Leave above captures the existing request synchronously; invalidate the
    // capability after it settles so another call cannot reuse the invitation.
    if (answerAuthorization.current) {
      const previous = callRequests.current;
      answerAuthorization.current = null;
      callRequests.current = null;
      if (leaving) void leaving.finally(() => previous?.controller.abort());
      else previous?.controller.abort();
    }
  }, [api, ringtone]);

  const stop = useCallback((message = '', notify = true) => {
    release(notify);
    if (!mounted.current) return;
    setActive(null); setLocal(null); setRemotes([]); setOpening(false);
    setMuted(false); setCameraOff(false); setNotice(message); setRetry(null);
    setShowSettings(false); setSwitchingCamera(false); setCanSwitchCamera(false); setMinimized(false);
  }, [release]);

  const previousPrincipal = useRef(principal);
  useEffect(() => {
    const previous = previousPrincipal.current;
    previousPrincipal.current = principal;
    const capability = answerAuthorization.current;
    const changed = previous && (!principal || previous.ownerId !== principal.ownerId || previous.memberId !== principal.memberId);
    const wrongRestoration = principal && capability?.ownerUid && (principal.ownerId !== capability.ownerUid || principal.memberId !== capability.memberId);
    if (changed || wrongRestoration) {
      callRequests.current?.controller.abort(); callRequests.current = null;
      stop('', false); answerAuthorization.current = null;
      setIncoming([]); dismissed.current.clear(); availableForCalls.current = true;
    }
  }, [principal, stop]);
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('tlink:call-identity-invalidated', () => {
      callRequests.current?.controller.abort(); callRequests.current = null;
      stop('', false); answerAuthorization.current = null;
      setIncoming([]); dismissed.current.clear(); availableForCalls.current = true;
    });
    return () => subscription.remove();
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    const pendingRequests = requests.current;
    return () => {
      mounted.current = false;
      // Do not send using a new identity during sign-out/account switching.
      release(false);
      callRequests.current?.controller.abort();
      callRequests.current = null;
      pendingRequests.forEach(controller => controller.abort());
      pendingRequests.clear();
    };
  }, [release]);

  const begin = useCallback(async (threadId: string, nextMode: NativeCallMode, existing?: TeamCall, systemAnswer = false) => {
    if ((!enabled && !(systemAnswer && answerAuthorization.current)) || (!foreground.current && !systemAnswer) || starting.current || session.current) return;
    if (!validId(threadId)) { setNotice('Open the conversation again before calling.'); return; }
    starting.current = true;
    joiningCall.current = existing?.id || null;
    const epoch = ++generation.current;
    const isCurrent = () => mounted.current && (foreground.current || systemAnswer || nativeSystemCallsAvailable) && generation.current === epoch;
    const sessionId = Crypto.randomUUID();
    setOpening(true); setMode(nextMode); setNotice(''); setRetry(null); setShowSettings(false); setMinimized(false);
    // Permissions and HTTP requests already have shorter individual limits.
    // Also bound native bridge/setup waits so a stalled operation cannot leave
    // an uncancellable opening session after returning from the lock screen.
    setupDeadline.current = setTimeout(() => {
      if (isCurrent() && starting.current) stop('Call setup took too long. Open TLink and try again.');
    }, 60_000);
    try {
      // Expo's pause deactivates the shared AVAudioSession asynchronously.
      // Never let the unused legacy player interrupt CallKit-owned audio.
      if (!nativeSystemCallsAvailable) ringtone.pause();
      if (ringtoneMode.current) await ringtoneMode.current;
      if (!isCurrent()) return;
      // Accept an authenticated incoming call before opening device media. This
      // stops the caller's ringback and releases CallKit's pending Answer before
      // WebRTC needs its audio session, including a locked cold start.
      let joined: CallResult | null = null;
      if (existing) {
        joined = await api('', { action: 'join', callId: existing.id, sessionId });
        if (!joined.call || !joined.memberId) throw new Error('The call did not start. Try again.');
        if (!isCurrent()) {
          if (mounted.current) void api('', { action: 'leave', callId: existing.id, sessionId }).catch(() => undefined);
          return;
        }
        joinedPending.current = { callId: existing.id, sessionId };
        if (Platform.OS === 'ios' && nativeSystemCallsAvailable) {
          await showSystemCall({ callId: existing.id, threadId, mode: nextMode, expiresAt: joined.call.expiresAt, callerName: callerName(joined.call) });
          await answerSystemCall(existing.id);
          if (!isCurrent()) return;
        }
      }
      // This function is reached only through Start, Answer, or Retry. Neither
      // notification handling nor foreground polling acquires device media.
      const request = new AbortController(); mediaRequest.current = request;
      const stream = await acquireNativeCallMedia(nextMode, isCurrent, request.signal);
      if (mediaRequest.current === request) mediaRequest.current = null;
      if (!stream) {
        if (isCurrent()) throw new Error('The microphone could not open. Try the call again.');
        return;
      }
      media.current = stream;
      if (appState.current !== 'active') {
        stream.getVideoTracks().forEach(track => { track.enabled = false; });
        setCameraOff(true);
      }
      setLocal(stream); setFrontCamera(true);
      // CallKit owns iOS audio activation. InCallManager would deactivate or
      // reconfigure that same session and leave answered calls without audio.
      if (!nativeSystemCallsAvailable || Platform.OS !== 'ios') {
        InCallManager.start({ media: nextMode, auto: true });
        audioStarted.current = true;
        InCallManager.setKeepScreenOn(true);
      }
      setSpeaker(nextMode === 'video');
      if (nextMode === 'video') void mediaDevices.enumerateDevices().then(devices => {
        if (isCurrent() && Array.isArray(devices)) setCanSwitchCamera(devices.filter(device => device && typeof device === 'object' && 'kind' in device && device.kind === 'videoinput').length > 1);
      }).catch(() => { /* The main call remains available without a second camera. */ });
      const result = joined || await api('', { action: 'start', threadId, mode: nextMode, sessionId, requestId: Crypto.randomUUID() });
      if (!result.call || !result.memberId) throw new Error('The call did not start. Try again.');
      if (!isCurrent()) {
        if (mounted.current) void api('', { action: 'leave', callId: result.call.id, sessionId }).catch(() => undefined);
        return;
      }
      const current: Session = { call: result.call, memberId: result.memberId, sessionId, local: stream, peers: null, cursor: 0, lastSuccess: Date.now(), hadRemote: result.call.participants.some(person => person.memberId !== result.memberId), connected: false };
      session.current = current;
      joinedPending.current = null;
      setActive(current.call); setIncoming(items => items.filter(item => item.id !== current.call.id));
      const systemCall: SystemCall = { callId: current.call.id, threadId, mode: nextMode,
        callerName: existing ? callerName(current.call) : current.call.threadName,
        expiresAt: existing ? current.call.expiresAt : new Date(ringingUntil(current.call)).toISOString() };
      if (existing && !(Platform.OS === 'ios' && nativeSystemCallsAvailable)) {
        await showSystemCall(systemCall);
        await answerSystemCall(current.call.id);
      } else if (!existing) await startSystemCall(systemCall);
      if (!isCurrent()) return;
      if (current.hadRemote) {
        await markSystemCallConnecting(current.call.id);
        if (!isCurrent()) return;
      }
      if (!existing && !current.hadRemote) {
        ringDeadline.current = setTimeout(() => {
          if (session.current !== current || current.hadRemote || current.connected) return;
          if (ringbackStarted.current) { InCallManager.stopRingback(); ringbackStarted.current = false; }
          // A teammate can answer between our latest poll and this deadline.
          // The server decides whether it was answered; native audio stops
          // ringing now and allows a bounded final status confirmation.
          void tickRef.current();
        }, Math.max(0, ringingUntil(current.call) - Date.now()));
        // New native builds own ringback inside the same audio session as the
        // system call. Older builds use their existing InCallManager session.
        if (!nativeSystemCallsAvailable) { InCallManager.startRingback('_DEFAULT_'); ringbackStarted.current = true; }
      }
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
        changed: peers => {
          if (session.current !== current) return;
          setRemotes(peers);
          if (!current.connected && peers.some(peer => peer.state === 'connected')) {
            current.connected = true;
            if (ringDeadline.current) clearTimeout(ringDeadline.current);
            ringDeadline.current = null;
            if (ringbackStarted.current) { InCallManager.stopRingback(); ringbackStarted.current = false; }
            void connectSystemCall(current.call.id).catch(() => {
              if (session.current === current) stop('Your phone could not activate the call. Open TLink and retry.');
            });
          }
        },
        failed: message => { if (session.current === current) stop(message); },
      });
      await current.peers.sync(current.call.participants);
      if (isCurrent()) { starting.current = false; setOpening(false); void tickRef.current(); }
    } catch (error) {
      if (!isCurrent()) return;
      const detail = nativeCallError(error, nextMode);
      stop(detail.message);
      if (existing) void endSystemCall(existing.id).catch(() => undefined);
      setShowSettings(detail.settings);
      if (error instanceof ApiError && error.code === 'CALL_ALREADY_ACTIVE') {
        try {
          const result = await api(`threadId=${encodeURIComponent(threadId)}`);
          if (mounted.current && !session.current && !starting.current && result.call?.status === 'active') {
            dismissed.current.delete(result.call.id); setIncoming([result.call]); setNotice('');
          }
        } catch { /* Preserve the useful original failure. */ }
      } else setRetry({ threadId, mode: nextMode, existing });
    } finally {
      if (generation.current === epoch) {
        if (setupDeadline.current) clearTimeout(setupDeadline.current);
        setupDeadline.current = null;
      }
    }
  }, [enabled, api, stop, ringtone]);

  useEffect(() => {
    return subscribeSystemCalls(async event => {
      if (!mounted.current) return;
      if (event.type === 'heartbeat') { await tickRef.current(); return; }
      if (event.type === 'end') {
        dismissed.current.add(event.callId);
        setIncoming(items => items.filter(item => item.id !== event.callId));
        if (session.current?.call.id === event.callId || joiningCall.current === event.callId || answerLookup.current === event.callId) stop();
        return;
      }
      if (event.type === 'mute') {
        if (session.current?.call.id === event.callId && typeof event.muted === 'boolean') {
          media.current?.getAudioTracks().forEach(track => { track.enabled = !event.muted; });
          setMuted(event.muted);
        }
        return;
      }
      if (!currentSystemCall(event) || dismissed.current.has(event.callId)) {
        await endSystemCall(event.callId); return;
      }
      if (session.current?.call.id === event.callId || starting.current || answerLookup.current) return;
      if (!enabled && !(event.type === 'answer' && event.answerToken)) return false;
      if (event.type === 'incoming' && !foreground.current) return;
      if (event.type === 'answer') {
        answerLookup.current = event.callId;
        // Invalidate any slower foreground invitation lookup before switching
        // from workspace auth to the narrowly scoped push capability.
        generation.current++;
        if (event.answerToken) {
          callRequests.current?.controller.abort(); callRequests.current = null;
          answerAuthorization.current = { answerToken: event.answerToken, callId: event.callId, threadId: event.threadId };
        }
      }
      const epoch = generation.current;
      try {
        // A system Answer is explicit consent, but push data never authenticates
        // the caller or bypasses current business, membership, or call expiry.
        const result = await api('view=incoming');
        if (!mounted.current || epoch !== generation.current || session.current || starting.current || dismissed.current.has(event.callId)) return;
        const invitation = result.calls?.find(call => call.id === event.callId && call.threadId === event.threadId && call.status === 'active');
        if (!invitation) throw new Error('This call is no longer available.');
        const capability = answerAuthorization.current;
        if (capability) {
          const signedIn = principalRef.current;
          if (!result.ownerUid || !result.memberId || (signedIn && (signedIn.ownerId !== result.ownerUid || signedIn.memberId !== result.memberId))) {
            throw new Error('This call belongs to a different account.');
          }
          capability.ownerUid = result.ownerUid; capability.memberId = result.memberId;
        }
        if (event.type === 'answer') await begin(invitation.threadId, appState.current === 'active' ? invitation.mode : 'audio', invitation, true);
        else { setIncoming([invitation]); setNotice(''); }
      } catch {
        if (!mounted.current || epoch !== generation.current) return;
        await endSystemCall(event.callId);
        if (mounted.current && epoch === generation.current) stop('The call could not connect. Please call your teammate again.');
      } finally { if (answerLookup.current === event.callId) answerLookup.current = null; }
    });
  }, [api, begin, enabled, stop]);

  const openInvitation = useCallback(async ({ threadId, callId }: Invitation) => {
    if (!enabled || !validId(threadId) || !validId(callId)) return;
    if (session.current?.call.id === callId) { setMinimized(false); return; }
    if (session.current || starting.current || !availableForCalls.current) return;
    const epoch = generation.current;
    try {
      const result = await api('view=incoming');
      if (!mounted.current || epoch !== generation.current || session.current || starting.current || !availableForCalls.current) return;
      const invitation = result.calls?.find(call => call.id === callId && call.threadId === threadId && call.status === 'active');
      if (!invitation) {
        setNotice('This call is no longer available. Check your call status or call your teammate from Messages.'); return;
      }
      dismissed.current.delete(callId);
      setIncoming([invitation]); setNotice(''); setRetry(null); setMinimized(false);
    } catch (error) {
      if (mounted.current && epoch === generation.current) setNotice(error instanceof Error ? error.message : 'This call is no longer available.');
    }
  }, [api, enabled]);

  const activeId = active?.id;
  const pollInterval = activeId ? remotes.length > 0 && remotes.every(peer => peer.state === 'connected') ? 1500 : 300 : 5000;
  const incomingId = incoming[0]?.id;
  const incomingAnswered = incoming[0]?.hasBeenAnswered;
  useEffect(() => {
    if (!enabled || !incomingId || activeId || opening || !foreground.current) return;
    const invitation = incomingRef.current;
    if (!invitation) return;
    // A running group call can still be joined after its invitation stopped
    // ringing. Its connected lifetime is authoritative, not the ring window.
    if (invitation.hasBeenAnswered && ringingUntil(invitation) <= Date.now()) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (session.current?.call.id === invitation.id || joiningCall.current === invitation.id) return;
      cancelled = true;
      if (!nativeSystemCallsAvailable) ringtone.pause();
      if (!invitation.hasBeenAnswered) {
        dismissed.current.add(invitation.id);
        setIncoming(items => items.filter(item => item.id !== invitation.id));
      }
      void endSystemCall(invitation.id).catch(() => undefined);
    }, Math.max(0, ringingUntil(invitation) - Date.now()));
    const cleanup = () => { cancelled = true; clearTimeout(timeout); if (mounted.current && !nativeSystemCallsAvailable) ringtone.pause(); };
    if (nativeSystemCallsAvailable) {
      void (async () => {
        if (await notificationsMuted() || cancelled || !foreground.current || session.current || starting.current) return;
        await showSystemCall({ callId: invitation.id, threadId: invitation.threadId, mode: invitation.mode,
          callerName: callerName(invitation),
          expiresAt: new Date(ringingUntil(invitation)).toISOString() });
      })().catch(() => {
        if (mounted.current) setNotice('Your phone could not display the incoming call. Open Messages to call your teammate back.');
      });
      return cleanup;
    }
    const epoch = generation.current;
    void (async () => {
      if (await notificationsMuted() || cancelled || !foreground.current || generation.current !== epoch) return;
      const ready = setAudioModeAsync({allowsRecording:false,playsInSilentMode:false,shouldPlayInBackground:false,interruptionMode:'mixWithOthers'});
      ringtoneMode.current = ready.catch(() => undefined);
      await ready;
      if (cancelled || !mounted.current || !foreground.current || generation.current !== epoch || session.current || starting.current) return;
      const player = ringtoneRef.current;
      await player.seekTo(0);
      if (cancelled || !foreground.current || generation.current !== epoch) return;
      player.loop = true;
      player.volume = 0.6;
      player.play();
    })().catch(() => { /* The visible Answer/Decline invitation remains usable if device audio is unavailable. */ });
    return cleanup;
  }, [activeId, enabled, incomingId, incomingAnswered, opening, ringtone]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const tick = async () => {
      if (disposed || inFlight || (!enabled && !session.current) || (!foreground.current && !(nativeSystemCallsAvailable && session.current))) return;
      const current = session.current;
      if (starting.current || (current && !current.peers)) return;
      inFlight = true;
      let processing = false;
      let confirmDeadline = false;
      try {
        if (current?.peers) {
          const requestedAt = Date.now();
          const result = await api(`callId=${encodeURIComponent(current.call.id)}&sessionId=${encodeURIComponent(current.sessionId)}&after=${current.cursor}`);
          if (disposed || session.current !== current) return;
          if (!result.call || result.call.status !== 'active') { stop('Call ended.', false); return; }
          const hasRemote = result.call.participants.some(person => person.memberId !== current.memberId);
          if ((current.hadRemote || result.call.hasBeenAnswered) && !hasRemote) { stop('Your teammate left the call.'); return; }
          if (!hasRemote && !current.connected && Date.now() >= ringingUntil(current.call)) {
            // A response sampled before the deadline cannot prove nobody
            // answered afterwards. Reconcile once with a fresh server read.
            if (requestedAt < ringingUntil(current.call)) { confirmDeadline = true; return; }
            stop('No answer. You can call again or send a message.'); return;
          }
          const newlyAnswered = hasRemote && !current.hadRemote;
          current.hadRemote ||= hasRemote;
          if (hasRemote && ringDeadline.current) { clearTimeout(ringDeadline.current); ringDeadline.current = null; }
          processing = true;
          if (newlyAnswered) {
            if (ringbackStarted.current) { InCallManager.stopRingback(); ringbackStarted.current = false; }
            await markSystemCallConnecting(current.call.id);
            if (disposed || session.current !== current) return;
          }
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
          if (!disposed && foreground.current && !session.current && !starting.current && availableForCalls.current) {
            setIncoming((result.calls || []).filter(call => !dismissed.current.has(call.id)));
          }
        }
      } catch (error) {
        if (disposed || !current || session.current !== current) return;
        const unansweredExpired = !current.hadRemote && !current.connected && Date.now() >= ringingUntil(current.call);
        if (processing || unansweredExpired || (error instanceof ApiError && [401, 403, 409].includes(error.status)) || Date.now() - current.lastSuccess > 15_000) {
          stop(processing ? 'The media connection failed. Call again when connected.' : error instanceof Error ? error.message : 'Connection lost. Try again when online.');
        }
      } finally { inFlight = false; if (confirmDeadline) void tick(); }
    };
    const listener = AppState.addEventListener('change', state => {
      const previousState = appState.current;
      appState.current = state;
      setAppActive(state === 'active');
      if (state === 'active' && previousState !== 'active' && (session.current || starting.current)) setMinimized(false);
      // An iOS permission dialog briefly produces inactive, not background.
      // Native audio ownership keeps an answered call alive. Camera capture
      // stops when hidden and requires an explicit Camera on after returning.
      if (state !== 'active' && nativeSystemCallsAvailable && (session.current || starting.current)) {
        media.current?.getVideoTracks().forEach(track => { track.enabled = false; });
        setCameraOff(true);
      }
      if (state === 'background') {
        foreground.current = false;
        if (!nativeSystemCallsAvailable && (session.current || starting.current)) stop('Keep TLink open during calls until the latest app update is installed.');
        setIncoming([]);
      } else if (state === 'active') { foreground.current = true; void tick(); }
    });
    tickRef.current = tick;
    const notification = Notifications.addNotificationReceivedListener(value => {
      if (teamNotificationTarget(value.request.content.data)) void tick();
    });
    const presence = DeviceEventEmitter.addListener('tlink:team-presence-changed', value => {
      if (value?.status === 'busy' || value?.status === 'offline') {
        availableForCalls.current = false;
        if (!nativeSystemCallsAvailable) ringtone.pause();
        setIncoming([]);
      } else if (value?.status === 'online') { availableForCalls.current = true; void tick(); }
    });
    void tick();
    return () => { disposed = true; tickRef.current = async () => undefined; listener.remove(); notification.remove(); presence.remove(); };
  }, [enabled, api, stop, activeId, ringtone]);
  useEffect(() => {
    if (!enabled && !activeId) return;
    // Keep the same in-flight guard when negotiation changes the cadence.
    const interval = setInterval(() => void tickRef.current(), pollInterval);
    return () => clearInterval(interval);
  }, [enabled, pollInterval]);

  const switchCamera = async () => {
    const current = session.current;
    const track = current?.local.getVideoTracks()[0];
    if (!current || !track || cameraChanging.current || appState.current !== 'active') return;
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
    if (appState.current !== 'active') return;
    media.current?.getVideoTracks().forEach(track => { track.enabled = cameraOff; });
    setCameraOff(!cameraOff);
  };
  const invitation = incoming[0];
  const hasCamera = Boolean(local?.getVideoTracks().length);
  const connected = remotes.some(peer => peer.state === 'connected');
  const visible = Boolean(active || opening || invitation || notice);
  const showCallView = appActive && visible && !minimized;
  useEffect(() => {
    // The window overlay does not present a new controller, so explicitly
    // resign the previous input without changing its saved or unsent text.
    if (showCallView) Keyboard.dismiss();
  }, [showCallView]);
  const closeNotice = () => { setNotice(''); setRetry(null); setShowSettings(false); };
  const decline = (call: TeamCall) => {
    dismissed.current.add(call.id);
    void endSystemCall(call.id).catch(() => undefined);
    setIncoming(items => items.filter(item => item.id !== call.id));
    closeNotice();
  };
  const closeCallView = () => {
    if (active) setMinimized(true);
    else if (opening) stop();
    else if (invitation) decline(invitation);
    else closeNotice();
  };
  return <Calls.Provider value={{ start: (threadId, nextMode) => begin(threadId, nextMode), openInvitation, busy: opening || Boolean(active), presented: showCallView }}>
    <View style={styles.root}>
    <View style={styles.root} pointerEvents={showCallView ? 'none' : 'auto'} accessibilityElementsHidden={showCallView} importantForAccessibility={showCallView ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {appActive && (active || opening) && minimized && <Pressable accessibilityRole="button" accessibilityLabel="Return to team call" onPress={() => setMinimized(false)} style={styles.returnToCall}>
      <MaterialCommunityIcons name="phone-outline" size={24} color={colours.forest} />
      <Text style={styles.returnText}>Return to {active?.threadName || 'team call'}</Text>
      <MaterialCommunityIcons name="chevron-up" size={24} color={colours.forest} />
    </Pressable>}
    {/* Mount only while active. iOS uses a window view, avoiding a UIKit modal
        transaction while CallKit is activating or another sheet is open. */}
    {showCallView && <CallPresentation onRequestClose={closeCallView}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}><View style={styles.headerText}><Text style={styles.eyebrow}>TLINK TEAM CALL</Text><Text style={styles.title}>{active?.threadName || invitation?.threadName || 'Team call'}</Text>
          <Text style={styles.subtitle}>{active ? `${connected ? 'Connected' : opening || remotes.length ? 'Connecting...' : 'Ringing...'} · ${hasCamera ? 'Video' : 'Voice'}` : 'Private to your team'}</Text></View>
          {active && <CallControl compact icon="arrow-collapse-down" label="Minimise" onPress={() => setMinimized(true)} />}
        </View>
        {active ? <>
          <View style={styles.callCanvas}>
            <ScrollView style={styles.remoteScroll} contentContainerStyle={styles.tiles}>
              {remotes.map(peer => <CallTile key={peer.memberId} stream={peer.stream} name={peer.name} status={peer.state === 'connected' ? '' : peer.state === 'new' ? 'Connecting' : peer.state} />)}
              {!remotes.length && <View style={styles.waiting}><Text style={styles.waitingText}>Calling your team...</Text><Text style={styles.subtitle}>Waiting for someone to answer.</Text></View>}
            </ScrollView>
            <View style={styles.selfPreview} pointerEvents="none">
              <CallTile stream={local} name={muted ? 'You · Muted' : 'You'} local cameraOff={cameraOff || !hasCamera} mirror={frontCamera} />
            </View>
          </View>
          {notice ? <Text accessibilityRole="alert" style={styles.help}>{notice}</Text> : null}
          <View style={styles.controls}><View style={styles.controlGrid}>
            <CallControl compact icon={muted ? 'microphone-off' : 'microphone-outline'} label={muted ? 'Unmute' : 'Mute'} selected={muted} onPress={toggleMute} />
            <CallControl compact icon={speaker ? 'volume-high' : 'volume-medium'} label={speaker ? 'Speaker off' : 'Speaker on'} selected={speaker} onPress={() => {
              if (nativeSystemCallsAvailable && Platform.OS === 'ios') void setSystemCallSpeaker(!speaker).then(() => setSpeaker(!speaker)).catch(() => setNotice('The audio output could not change. Try your phone call controls.'));
              else { InCallManager.setForceSpeakerphoneOn(!speaker); setSpeaker(!speaker); }
            }} />
            {hasCamera && <><CallControl compact icon={cameraOff ? 'video-off-outline' : 'video-outline'} label={cameraOff ? 'Camera on' : 'Camera off'} selected={!cameraOff} onPress={toggleCamera} />
              {canSwitchCamera && <CallControl compact icon="camera-flip-outline" label={switchingCamera ? 'Switching...' : 'Switch camera'} disabled={switchingCamera} onPress={() => void switchCamera()} />}</>}
          </View><CallControl icon="phone-hangup-outline" label="End call" onPress={() => stop()} /></View>
        </> : opening ? <ScrollView contentContainerStyle={styles.body}><ActivityIndicator color={colours.green} size="large" /><Text style={styles.bodyTitle}>Opening your {mode === 'video' ? 'video' : 'voice'} call</Text><Text style={styles.help}>Allow microphone{mode === 'video' ? ' and camera' : ''} access if your device asks.</Text><FieldButton variant="secondary" onPress={() => stop()}>Cancel</FieldButton></ScrollView>
          : notice ? <ScrollView contentContainerStyle={styles.body}><Text accessibilityRole="alert" style={styles.help}>{notice}</Text>
            {retry && <FieldButton onPress={() => void begin(retry.threadId, retry.mode, retry.existing)}>Retry</FieldButton>}
            {retry?.mode === 'video' && <FieldButton variant="secondary" onPress={() => void begin(retry.threadId, 'audio', retry.existing)}>Use voice only</FieldButton>}
            {showSettings && <FieldButton variant="secondary" onPress={() => void Linking.openSettings().catch(() => setNotice('Open your device Settings, choose TLink, then allow microphone and camera.'))}>Open device settings</FieldButton>}
            <FieldButton variant="quiet" onPress={closeNotice}>Close</FieldButton>
          </ScrollView> : invitation ? <ScrollView contentContainerStyle={styles.body}><View style={styles.avatar}><Text style={styles.initial}>{invitation.threadName.slice(0, 1).toUpperCase() || 'T'}</Text></View><Text style={styles.bodyTitle}>{invitation.hasBeenAnswered ? 'Join team' : 'Incoming'} {invitation.mode === 'video' ? 'video' : 'voice'} call</Text><Text style={styles.help}>Your microphone{invitation.mode === 'video' ? ' and camera turn' : ' turns'} on when you {invitation.hasBeenAnswered ? 'join' : 'answer'}.</Text>
            <CallControl primary icon={invitation.mode === 'video' ? 'video-outline' : 'phone-outline'} label={invitation.hasBeenAnswered ? 'Join call' : 'Answer'} onPress={() => void begin(invitation.threadId, invitation.mode, invitation)} />
            {invitation.mode === 'video' && <CallControl icon="phone-outline" label={invitation.hasBeenAnswered ? 'Join with voice only' : 'Answer with voice only'} onPress={() => void begin(invitation.threadId, 'audio', invitation)} />}
            <CallControl icon="phone-hangup-outline" label="Decline" onPress={() => decline(invitation)} />
          </ScrollView> : null}
      </SafeAreaView>
    </CallPresentation>}
    </View>
  </Calls.Provider>;
}

function CallPresentation({ children, onRequestClose }: { children: ReactNode; onRequestClose: () => void }) {
  if (Platform.OS === 'ios') return <FullWindowOverlay>
    <View style={styles.callOverlay} accessibilityViewIsModal>{children}</View>
  </FullWindowOverlay>;
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onRequestClose}>{children}</Modal>;
}

function CallControl({ icon, label, onPress, compact = false, primary = false, selected, disabled = false }: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void;
  compact?: boolean; primary?: boolean; selected?: boolean; disabled?: boolean;
}) {
  const highlighted = primary || selected;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [compact ? styles.compactControl : styles.callAction, !compact && primary && styles.primaryAction, pressed && styles.pressed, disabled && styles.disabled]}>
    <View style={compact ? [styles.controlIcon, highlighted && styles.selectedIcon] : undefined}>
      <MaterialCommunityIcons accessible={false} name={icon} size={compact ? 27 : 24} color={highlighted ? colours.forest : colours.green} />
    </View>
    <Text style={[compact ? styles.controlLabel : styles.actionLabel, primary && styles.primaryLabel]}>{label}</Text>
  </Pressable>;
}

function CallTile({ stream, name, status = '', local = false, cameraOff = false, mirror = false }: {
  stream: MediaStream | null; name: string; status?: string; local?: boolean; cameraOff?: boolean; mirror?: boolean;
}) {
  const hasVideo = Boolean(stream?.getVideoTracks().length) && !cameraOff;
  return <View style={[styles.tile, local && styles.localTile]} accessibilityLabel={`${name}${status ? `, ${status}` : ''}`}>
    <View style={[styles.avatar, local && styles.previewAvatar]}><Text style={[styles.initial, local && styles.previewInitial]}>{name.slice(0, 1).toUpperCase()}</Text></View>
    {stream && hasVideo && <RTCView style={StyleSheet.absoluteFill} streamURL={stream.toURL()} objectFit="cover" mirror={local && mirror} zOrder={local ? 1 : 0} />}
    <View style={[styles.caption, local && styles.previewCaption]}><Text numberOfLines={local ? 1 : 2} style={[styles.captionText, local && styles.previewName]}>{name}{status ? ` · ${status}` : ''}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  callOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 20, backgroundColor: colours.cream },
  safe: { flex: 1, backgroundColor: colours.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colours.line },
  headerText: { flex: 1, gap: 5 },
  eyebrow: { color: colours.green, fontSize: 11, letterSpacing: 1.3, fontWeight: '800' },
  title: { color: colours.ink, fontSize: 23, fontWeight: '700' },
  subtitle: { color: colours.muted, fontSize: 14, lineHeight: 21 },
  body: { flexGrow: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  bodyTitle: { color: colours.ink, fontSize: 23, fontWeight: '700', textAlign: 'center' },
  help: { color: colours.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', paddingHorizontal: spacing.md },
  callCanvas: { flex: 1, minHeight: 160, position: 'relative' },
  remoteScroll: { flex: 1 },
  tiles: { padding: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  tile: { minHeight: 210, flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colours.surfaceRaised, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colours.line },
  selfPreview: { position: 'absolute', right: spacing.md, top: spacing.md, width: 104, height: 144, zIndex: 2 },
  localTile: { minHeight: 0, height: '100%', borderRadius: radius.sm, borderColor: colours.muted },
  previewAvatar: { width: 42, height: 42, borderRadius: 21 },
  previewInitial: { fontSize: 20 },
  previewCaption: { padding: spacing.xs },
  previewName: { fontSize: 11 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colours.mintStrong, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  initial: { color: colours.green, fontSize: 34, fontWeight: '700' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#06131fcc', padding: spacing.sm },
  captionText: { color: colours.ink, fontSize: 14, fontWeight: '600' },
  waiting: { flex: 1, minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  waitingText: { color: colours.ink, fontSize: 20, fontWeight: '600' },
  controls: { gap: spacing.md, padding: spacing.md, backgroundColor: colours.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colours.line },
  controlGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  compactControl: { minWidth: 76, flexShrink: 1, flexBasis: '28%', alignItems: 'center', gap: 8, paddingVertical: 4 },
  controlIcon: { minHeight: 56, minWidth: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.mintStrong, borderWidth: 1, borderColor: colours.line },
  selectedIcon: { backgroundColor: colours.green, borderColor: colours.green },
  controlLabel: { color: colours.ink, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  callAction: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, backgroundColor: colours.forest, borderWidth: 1, borderColor: colours.line },
  primaryAction: { backgroundColor: colours.green, borderColor: colours.green },
  actionLabel: { flexShrink: 1, color: colours.ink, fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  primaryLabel: { color: colours.forest }, pressed: { opacity: 0.7 }, disabled: { opacity: 0.4 },
  returnToCall: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: 92, backgroundColor: colours.green, borderRadius: 25, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: spacing.sm, zIndex: 90, elevation: 8 },
  returnText: { flex: 1, color: colours.forest, fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
