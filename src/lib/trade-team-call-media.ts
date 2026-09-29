export type TeamCallMode = "audio" | "video";
export type CameraFacing = "user" | "environment";

// Browsers may leave getUserMedia pending when a permission prompt is ignored.
// A late permission grant must never leave the microphone running after timeout.
export async function openTeamCallMedia(constraints: MediaStreamConstraints, request = (value: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(value)): Promise<MediaStream> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const media = request(constraints).then(stream => {
    if (expired) { stream.getTracks().forEach(track => track.stop()); throw new Error("The call was cancelled."); }
    return stream;
  });
  try {
    return await Promise.race([media, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error("Microphone or camera access was not completed. Allow access in your browser, then try again."));
      }, 30000);
    })]);
  } finally { clearTimeout(timer); }
}

// Ringing uses the current page's audio permission. It never requests a
// microphone and cannot bypass a browser or phone's background audio policy.
export class TeamCallRinger {
  private context: AudioContext | null = null;
  private interval?: ReturnType<typeof setInterval>;
  private ringing = false;
  private closed = false;
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
      if (this.context.state !== "running") await this.context.resume();
      if (this.closed) return false;
      const ready = this.context.state === "running";
      this.changed(ready);
      if (ready && this.ringing) this.pulse();
      return ready;
    } catch { if (!this.closed) this.changed(false); return false; }
  }

  private pulse() {
    if (!this.ringing) return;
    this.tone(0, 0.38, 440, 0.045);
    this.tone(0.45, 0.38, 554.37, 0.045);
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

  start() {
    if (this.ringing || this.closed) return;
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

export function teamCallMediaError(error: unknown, mode: TeamCallMode): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  const devices = mode === "video" ? "microphone and camera" : "microphone";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Your ${devices} permission is blocked. In Safari, open the page menu beside the address bar, then Website Settings and allow ${devices} access. In Chrome or Edge, use the site controls beside the address bar. Also check browser permissions in device settings, then retry. If you opened TLink inside an email app, open this page in Safari or Chrome first.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return mode === "video" ? "A microphone or camera is unavailable. Connect your devices and retry, or use voice only." : "No microphone was found. Connect a microphone or headset and retry.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `Your ${devices} could not open. Close other apps using them, then retry.`;
  }
  return error instanceof Error ? error.message : "The call could not start. Check your connection and retry.";
}
