import type { TradeBrowserDevice } from "./trade-device-client";

export type TeamCallMode = "audio" | "video";
export type CameraFacing = "user" | "environment";

// Browsers may leave getUserMedia pending when a permission prompt is ignored.
// A late permission grant must never leave the microphone running after timeout.
export async function openTeamCallMedia(constraints: MediaStreamConstraints, request = (value: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(value), signal?: AbortSignal): Promise<MediaStream> {
  if (signal?.aborted) throw new DOMException("The call was cancelled.", "AbortError");
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  // Request synchronously on the click stack, before permission inspection,
  // device enumeration, authentication or any server work.
  const media = request(constraints).then(stream => {
    if (expired) { stream.getTracks().forEach(track => track.stop()); throw new Error("The call was cancelled."); }
    return stream;
  });
  try {
    return await Promise.race([media, new Promise<never>((_, reject) => {
      abort = () => { expired = true; reject(new DOMException("The call was cancelled.", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      timer = setTimeout(() => {
        expired = true;
        const error = new Error("Microphone or camera access was not completed. Choose Allow when your browser asks, then try again.");
        error.name = "TeamCallMediaPermissionTimeout";
        reject(error);
      }, 30000);
    })]);
  } finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}

// Ringing uses the current page's audio permission. It never requests a
// microphone and cannot bypass a browser or phone's background audio policy.
export class TeamCallRinger {
  private context: AudioContext | null = null;
  private interval?: ReturnType<typeof setInterval>;
  private ringing = false;
  private mode: 'incoming' | 'outgoing' = 'incoming';
  private closed = false;
  private resuming: Promise<void> | null = null;
  private tones = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private readonly changed: (ready: boolean) => void;
  private readonly createContext: () => AudioContext;
  constructor(changed: (ready: boolean) => void, createContext = () => new AudioContext()) {
    this.changed = changed; this.createContext = createContext;
  }

  async unlock() {
    if (this.closed) return false;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.context.onstatechange = () => { if (!this.closed) this.changed(this.context?.state === "running"); };
      }
      const wasRunning = this.context.state === "running";
      const beganResume = !wasRunning && !this.resuming;
      if (beganResume) this.resuming = this.context.resume().finally(() => { this.resuming = null; });
      if (this.resuming) await this.resuming;
      if (this.closed) return false;
      const ready = this.context.state === "running";
      this.changed(ready);
      if (ready && this.ringing && beganResume) this.pulse();
      return ready;
    } catch { if (!this.closed) this.changed(false); return false; }
  }

  private pulse() {
    if (!this.ringing) return;
    const outgoing = this.mode === 'outgoing';
    this.tone(0, 0.38, outgoing ? 425 : 440, outgoing ? 0.07 : 0.1);
    this.tone(0.58, 0.38, outgoing ? 425 : 554.37, outgoing ? 0.07 : 0.1);
  }

  private tone(delay: number, duration: number, frequency: number, volume: number) {
    const context = this.context;
    if (this.closed || context?.state !== "running") return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    const tone = { oscillator, gain }, start = context.currentTime + delay;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.04);
    gain.gain.setValueAtTime(volume, start + duration / 2);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    oscillator.connect(gain); gain.connect(context.destination); this.tones.add(tone);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.tones.delete(tone); };
    oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  message() {
    if (!this.ringing) this.tone(0, 0.18, 660, 0.025);
  }

  start(mode: 'incoming' | 'outgoing' = 'incoming') {
    if (this.closed || this.ringing && this.mode === mode) return;
    this.stop(); this.mode = mode;
    this.ringing = true; this.pulse();
    this.interval = setInterval(() => this.pulse(), 4000);
  }

  stop() {
    this.ringing = false; clearInterval(this.interval);
    for (const { oscillator, gain } of this.tones) { oscillator.onended = null; oscillator.stop(); oscillator.disconnect(); gain.disconnect(); }
    this.tones.clear();
  }

  close() {
    this.closed = true; this.stop();
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
  }
}

export function teamCallMediaConstraints(mode: TeamCallMode): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true },
    video: mode === "video" ? { ...teamCallCameraConstraints(), facingMode: { ideal: "user" } } : false,
  };
}

export function teamCallCameraConstraints(facing?: CameraFacing): MediaTrackConstraints {
  return {
    width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 },
    ...(facing ? { facingMode: { exact: facing } } : {}),
  };
}

export function teamCallNeedsPermission(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "TeamCallMediaPermissionTimeout";
}

// Browsers apply this policy to the document, even after client-side navigation.
// Treat only an explicit capability denial as evidence of an inherited block.
export function teamCallPolicyBlocked(mode: TeamCallMode, page: unknown = typeof document === "undefined" ? undefined : document): boolean {
  if (!page || typeof page !== "object") return false;
  const current = "permissionsPolicy" in page ? page.permissionsPolicy : undefined;
  const policy = current ?? ("featurePolicy" in page ? page.featurePolicy : undefined);
  if (!policy || typeof policy !== "object" || !("allowsFeature" in policy) || typeof policy.allowsFeature !== "function") return false;
  try { return policy.allowsFeature("microphone") === false || mode === "video" && policy.allowsFeature("camera") === false; }
  catch { return false; }
}

export async function teamCallPermissionState(mode: TeamCallMode, permissions = typeof navigator === "undefined" ? undefined : navigator.permissions): Promise<PermissionState | "unknown"> {
  if (!permissions?.query) return "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const names: PermissionName[] = mode === "video" ? ["microphone", "camera"] : ["microphone"];
  const queries = Promise.all(names.map(async name => {
    try { return (await permissions.query({ name })).state; }
    catch { return "unknown" as const; } // Not every browser supports media permission queries.
  })).then(states => states.includes("denied") ? "denied" as const : states.every(state => state === "granted") ? "granted" as const : states.includes("prompt") ? "prompt" as const : "unknown" as const);
  try {
    return await Promise.race([queries, new Promise<"unknown"> (resolve => { timer = setTimeout(() => resolve("unknown"), 500); })]);
  } finally { clearTimeout(timer); }
}

export function teamCallPermissionSteps(mode: TeamCallMode, device: TradeBrowserDevice): string[] {
  const settings = mode === "video" ? "Microphone and Camera" : "Microphone";
  if (device.embedded) return ["Open this TLink page in your phone's browser from the app menu.", "Try the call again and choose Allow when asked."];
  if (device.platform === "ios") {
    const phone = device.device === "ipad" ? "iPad" : "iPhone";
    if (device.browser === "safari") return [
      `In Safari, open the page menu, then Website Settings. Set ${settings} to Allow for TLink.`,
      `If it is still blocked, check ${phone} Settings > Apps > Safari > ${settings}. Return here and try again.`,
    ];
    const browser = device.browser === "chrome" ? "Chrome" : device.browser === "edge" ? "Edge" : device.browser === "firefox" ? "Firefox" : "your browser";
    return [
      `Open ${phone} Settings > Apps > ${browser} and turn on ${settings}.`,
      device.browser === "chrome" ? `Return to Chrome. If a ${mode === "video" ? "microphone or camera" : "microphone"} icon appears beside the address bar, tap it and allow access. Then try again.`
        : `Return to ${browser}, try again and choose Allow when asked.`,
    ];
  }
  if (device.platform === "android" && device.browser === "chrome") return [
    `In Chrome, open the three-dot menu > Settings > Site settings > ${settings}. Allow TLink.`,
    `If access is off for Chrome, open Android Settings > Apps > Chrome > Permissions. Enable ${settings}, then try again.`,
  ];
  if (device.browser === "safari") return [`In Safari, open Settings for This Website and allow ${settings}. Then try again.`];
  return [`Open the site controls beside this page's address and allow ${settings} for TLink. Then try again.`,
    `If access is off for your browser, allow ${settings} in your device's privacy settings.`];
}

export function teamCallMediaError(error: unknown, mode: TeamCallMode, denied = false): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  const devices = mode === "video" ? "microphone and camera" : "microphone";
  if (teamCallNeedsPermission(error)) {
    return denied ? `Your browser reports ${devices} access is blocked. Allow it in settings, then try again.`
      : `TLink needs ${devices} access for this call. Choose Allow when your browser asks.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return mode === "video" ? "A microphone or camera is unavailable. Connect your devices and retry, or use voice only." : "No microphone was found. Connect a microphone or headset and retry.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `Your ${devices} could not open. Close other apps using them, then retry.`;
  }
  return error instanceof Error ? error.message : "The call could not start. Check your connection and retry.";
}
