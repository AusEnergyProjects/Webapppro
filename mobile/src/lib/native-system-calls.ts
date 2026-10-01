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
const diagnosticStages = ['native_start', 'configuration_changed', 'push_received', 'push_rejected',
  'call_reported', 'call_report_failed', 'duplicate_reported', 'duplicate_report_failed'] as const;
const diagnosticRejections = ['disabled', 'invalid_call_id', 'invalid_thread_id', 'invalid_mode', 'invalid_expiry', 'expired'] as const;
const diagnosticAppStates = ['active', 'inactive', 'background', 'unknown'] as const;
const diagnosticErrorDomains = ['callkit_incoming', 'other'] as const;
export type NativeCallDiagnostic = {
  timestamp: string;
  stage: typeof diagnosticStages[number];
  localEnabled: boolean;
  appState: typeof diagnosticAppStates[number];
  managedCallCount: number;
  managedConnectedCount: number;
  systemCallCount: number;
  systemConnectedCount: number;
  rejectionReason?: typeof diagnosticRejections[number];
  errorDomain?: typeof diagnosticErrorDomains[number];
  errorCode?: number;
};
type NativeCallsModule = {
  configure: (enabled: boolean, preserveActiveCalls: boolean) => Promise<void>;
  registration: () => Promise<{ voipPushToken: string; nativeCallCapable: boolean }>;
  diagnostics?: () => Promise<unknown>;
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

function diagnosticChoice<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return choices.find(choice => choice === value);
}
function diagnosticRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function diagnosticCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 32;
}
/** Optional and read-only: older binaries and Android have no iOS snapshot. */
export async function getNativeCallDiagnostics(): Promise<NativeCallDiagnostic[]> {
  if (!native?.diagnostics) return [];
  let snapshot: unknown;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    snapshot = await Promise.race([
      native.diagnostics(),
      new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 250); }),
    ]);
  } catch { return []; }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
  if (!Array.isArray(snapshot)) return [];
  const now = Date.now();
  const events: NativeCallDiagnostic[] = [];
  for (const entry of snapshot.slice(-12)) {
    if (!diagnosticRecord(entry) || typeof entry.timestamp !== 'string' || entry.timestamp.length > 40
      || typeof entry.localEnabled !== 'boolean') continue;
    const at = Date.parse(entry.timestamp);
    const stage = diagnosticChoice(entry.stage, diagnosticStages);
    const appState = diagnosticChoice(entry.appState, diagnosticAppStates);
    if (!stage || !appState || !Number.isFinite(at) || at > now || now - at > 24 * 60 * 60 * 1000
      || !diagnosticCount(entry.managedCallCount) || !diagnosticCount(entry.managedConnectedCount)
      || !diagnosticCount(entry.systemCallCount) || !diagnosticCount(entry.systemConnectedCount)
      || entry.managedConnectedCount > entry.managedCallCount || entry.systemConnectedCount > entry.systemCallCount) continue;
    const rejectionReason = diagnosticChoice(entry.rejectionReason, diagnosticRejections);
    const errorDomain = diagnosticChoice(entry.errorDomain, diagnosticErrorDomains);
    const failure = stage === 'call_report_failed' || stage === 'duplicate_report_failed';
    if (stage === 'push_rejected' && !rejectionReason) continue;
    if (failure && (!errorDomain || typeof entry.errorCode !== 'number'
      || !Number.isInteger(entry.errorCode) || entry.errorCode < -1 || entry.errorCode > 100)) continue;
    // Construct the result explicitly. Native payloads and unknown properties
    // must never be copied into a device registration or a diagnostic log.
    const event: NativeCallDiagnostic = {
      timestamp: new Date(at).toISOString(), stage, localEnabled: entry.localEnabled, appState,
      managedCallCount: entry.managedCallCount, managedConnectedCount: entry.managedConnectedCount,
      systemCallCount: entry.systemCallCount, systemConnectedCount: entry.systemConnectedCount,
    };
    if (stage === 'push_rejected') event.rejectionReason = rejectionReason;
    if (failure && typeof entry.errorCode === 'number') { event.errorDomain = errorDomain; event.errorCode = entry.errorCode; }
    events.push(event);
  }
  return events;
}

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

// Native code retains lock-screen answers while JS starts. A scoped invitation
// can authorise its call before workspace restoration; deferred events stay queued.
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
