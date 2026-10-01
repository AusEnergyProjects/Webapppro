import { requireOptionalNativeModule } from 'expo';

export type SystemCall = {
  callId: string; threadId: string; mode: 'audio' | 'video'; expiresAt: string;
  callerName?: string;
  /** Short-lived permission for this invitation only, never workspace access. */
  answerToken?: string;
};
export type SystemCallEvent = SystemCall & {
  id: string;
  type: 'incoming' | 'answer' | 'end' | 'mute' | 'heartbeat';
  muted?: boolean;
};
export type AndroidCallNotificationStatus = {
  notificationsAllowed: boolean;
  channelImportance: number;
  channelSoundEnabled: boolean;
  fullScreenAllowed: boolean;
};
export type AndroidCallSettingsTarget = 'app' | 'channel' | 'fullScreen';
type NativeCallsModule = {
  configure: (enabled: boolean, preserveActiveCalls: boolean) => Promise<void>;
  registration: () => Promise<{ voipPushToken: string; nativeCallCapable: boolean }>;
  drainEvents: () => Promise<SystemCallEvent[]>;
  acknowledgeEvents?: (ids: string[]) => Promise<void>;
  incoming: (call: SystemCall) => Promise<void>;
  answer: (callId: string) => Promise<void>;
  outgoing: (call: SystemCall) => Promise<void>;
  connecting?: (callId: string) => Promise<void>;
  connected: (callId: string) => Promise<void>;
  end: (callId: string) => Promise<void>;
  speaker: (enabled: boolean) => Promise<void>;
  callNotificationStatus?: () => Promise<AndroidCallNotificationStatus>;
  openCallNotificationSettings?: (target: AndroidCallSettingsTarget) => Promise<void>;
  addListener: (name: 'callEvent' | 'tokenChanged', listener: () => void) => { remove: () => void };
};
const native = requireOptionalNativeModule<NativeCallsModule>('TLinkCalls');
export const nativeSystemCallsAvailable = Boolean(native);

// Optional Android methods keep earlier binaries and iOS compatible. Reading
// settings must never enable calls or request notification permission.
export async function getAndroidCallNotificationStatus(): Promise<AndroidCallNotificationStatus | null> {
  return native?.callNotificationStatus ? native.callNotificationStatus() : null;
}
export async function openAndroidCallNotificationSettings(target: AndroidCallSettingsTarget): Promise<boolean> {
  if (!native?.openCallNotificationSettings) return false;
  await native.openCallNotificationSettings(target);
  return true;
}

export async function getNativeCallRegistration(configure = true) {
  if (!native) return { voipPushToken: '', nativeCallCapable: false };
  if (configure) await native.configure(true, false);
  return native.registration();
}
export async function disableNativeCalls(preserveActiveCalls = false) { await native?.configure(false, preserveActiveCalls); }
export function subscribeNativeCallToken(listener: () => void) {
  const subscription = native?.addListener('tokenChanged', listener);
  return () => subscription?.remove();
}
export async function showSystemCall(call: SystemCall) { await native?.incoming(call); }
export async function answerSystemCall(callId: string) { await native?.answer(callId); }
export async function startSystemCall(call: SystemCall) { await native?.outgoing(call); }
/** Call only after the authenticated server confirms a remote participant joined. */
export async function markSystemCallConnecting(callId: string) { await native?.connecting?.(callId); }
export async function connectSystemCall(callId: string) { await native?.connected(callId); }
export async function endSystemCall(callId: string) { await native?.end(callId); }
export async function setSystemCallSpeaker(enabled: boolean) { await native?.speaker(enabled); }

// Native events are drained only after authentication is restored. Native code
// retains lock-screen answers while JS starts; an event never supplies access.
export function subscribeSystemCalls(receive: (event: SystemCallEvent) => Promise<void | false>) {
  if (!native) return () => undefined;
  let closed = false;
  let draining = false;
  let requested = false;
  const delivering = new Set<string>();
  const drain = async () => {
    requested = true;
    if (draining) return;
    draining = true;
    try {
      while (!closed && requested) {
        requested = false;
        const events = await native.drainEvents();
        const ended = new Set(events.filter(event => event.type === 'end').map(event => event.callId));
        for (const event of events) {
          if (closed) return;
          if (event.type !== 'end' && ended.has(event.callId)) {
            await native.acknowledgeEvents?.([event.id]);
            continue;
          }
          if (delivering.has(event.id)) continue;
          delivering.add(event.id);
          // End must interrupt a pending permission/authentication wait, rather
          // than waiting for Answer to finish and briefly opening stale media.
          void receive(event).then(async handled => {
            if (!closed && handled !== false) await native.acknowledgeEvents?.([event.id]);
          }).catch(() => undefined).finally(() => { delivering.delete(event.id); });
        }
      }
    } finally { draining = false; }
  };
  const subscription = native.addListener('callEvent', () => { void drain().catch(() => undefined); });
  void drain().catch(() => undefined);
  return () => { closed = true; subscription.remove(); };
}

export function currentSystemCall(event: SystemCallEvent, now = Date.now()): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.callId)
    && /^[a-zA-Z0-9_-]{8,120}$/.test(event.threadId)
    && (event.mode === 'audio' || event.mode === 'video')
    && Number.isFinite(Date.parse(event.expiresAt)) && Date.parse(event.expiresAt) > now;
}
