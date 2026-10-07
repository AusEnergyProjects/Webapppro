import { WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES, WATTZUN_MAX_TURN_SECONDS } from "./wattzun-portal.ts";
import type { WattzunVoiceResult } from "./wattzun-portal.ts";
import { createWattzunPcmPlayback } from "./wattzun-voice-playback.ts";
import { createWattzunPcmCapture } from "./wattzun-pcm-capture.ts";
import { teamCallPolicyBlocked } from "./trade-team-call-media.ts";
import { tradeBrowserDevice } from "./trade-device-client.ts";

export type WattzunCallState = "idle" | "permission" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "recovering" | "ended" | "error";
export type WattzunCallStatus = { state: WattzunCallState; message: string; recovery?: "reload" };
export class WattzunVoiceStartupError extends Error {
  readonly reason: "policy" | "microphone" | "audio" | "capture";
  constructor(message: string, reason: "policy" | "microphone" | "audio" | "capture") {
    super(message); this.name = "WattzunVoiceStartupError"; this.reason = reason;
  }
}
/** Only current identity/access failures end an otherwise usable call. */
export class WattzunVoiceCallError extends Error {
  readonly reason: "authentication" | "access";
  constructor(message: string, reason: "authentication" | "access") {
    super(message); this.name = "WattzunVoiceCallError"; this.reason = reason;
  }
}
export interface WattzunRecorder {
  onData: (data: Blob) => void;
  onStop: (reason?: "limit") => void;
  onError: () => void;
  start(): void;
  confirmSpeech(): void;
  stop(): void;
}
export interface WattzunMicrophone {
  recorder(): WattzunRecorder;
  level(): number;
  mute(muted: boolean): void;
  close(): void;
}
export interface WattzunPlayback {
  onEnd: () => void;
  onError: () => void;
  play(): Promise<void>;
  close(): void;
}
export interface WattzunVoiceEnvironment {
  microphone(): Promise<WattzunMicrophone>;
  playback(audio: WattzunVoiceResult["audio"]): WattzunPlayback;
  now(): number;
  repeat(callback: () => void, milliseconds: number): () => void;
}

/** A short speech turn ends on silence. Silence alone never reaches the provider. */
export class WattzunSpeechWindow {
  private speechMilliseconds = 0;
  private lastSample: number;
  private lastSpeech: number;
  private heardSpeech = false;
  private speechStarted: number | null = null;
  private readonly started: number;
  constructor(started: number) { this.started = started; this.lastSample = started; this.lastSpeech = started; }
  get hasSpeech() { return this.heardSpeech; }
  sample(level: number, now: number): "wait" | "send" | "silent" {
    const elapsed = Math.min(250, Math.max(0, now - this.lastSample));
    this.lastSample = now;
    if (level >= 0.025) {
      if (this.speechStarted === null) this.speechStarted = now - elapsed;
      this.speechMilliseconds += elapsed;
      this.lastSpeech = now;
      if (this.speechMilliseconds >= 250) this.heardSpeech = true;
    }
    else if (!this.heardSpeech && now - this.lastSpeech > 200) { this.speechMilliseconds = 0; this.speechStarted = null; }
    // Waiting does not consume a sentence's recording budget. A candidate at
    // the old idle boundary must be allowed to confirm before quiet rollover.
    if (this.heardSpeech && this.speechStarted !== null && now - this.speechStarted >= WATTZUN_MAX_TURN_SECONDS * 1000) return "send";
    if (this.speechStarted === null && now - this.started >= WATTZUN_MAX_TURN_SECONDS * 1000) return "silent";
    // Preserve a natural pause between sentences; the next clause may contain
    // the name, price or instruction that makes the task safe to complete.
    if (this.heardSpeech && now - this.lastSpeech >= 1300) return "send";
    return "wait";
  }
}

type Capture = { recorder: WattzunRecorder; chunks: Blob[]; bytes: number; submit: boolean; settled: boolean; stopSampling: () => void };
type VoiceCallbacks = {
  status: (status: WattzunCallStatus) => void;
  submit: (audio: Blob, signal: AbortSignal) => Promise<WattzunVoiceResult>;
  reply: (result: WattzunVoiceResult) => void;
  greeting?: (signal: AbortSignal) => Promise<WattzunVoiceResult["audio"]>;
};

/** Owns one call's media and cancellation. The UI supplies the authorised request. */
export class WattzunVoiceCall {
  private generation = 0;
  private active = false;
  private state: WattzunCallState = "idle";
  private microphone: WattzunMicrophone | null = null;
  private capture: Capture | null = null;
  private playback: WattzunPlayback | null = null;
  private pending: AbortController | null = null;
  private muted = false;
  private readonly environment: WattzunVoiceEnvironment;
  private readonly callbacks: VoiceCallbacks;
  constructor(environment: WattzunVoiceEnvironment, callbacks: VoiceCallbacks) { this.environment = environment; this.callbacks = callbacks; }
  private update(state: WattzunCallState, message = "", recovery?: "reload") {
    this.state = state;
    this.callbacks.status({ state, message, ...(recovery ? { recovery } : {}) });
  }
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.muted = false;
    const generation = ++this.generation;
    this.update("permission", "Allow your microphone to speak to Wattzun.");
    if (!this.active || generation !== this.generation) return;
    const greetingCallback = this.callbacks.greeting;
    const pending = greetingCallback ? new AbortController() : null;
    let greetingAudio: WattzunVoiceResult["audio"] | null = null;
    const discardGreeting = () => {
      const audio = greetingAudio;
      greetingAudio = null;
      if (audio?.mimeType === "audio/pcm") void audio.stream.cancel().catch(() => {});
    };
    if (pending) {
      this.pending = pending;
      pending.signal.addEventListener("abort", discardGreeting, { once: true });
    }
    const greeting = greetingCallback && pending ? (async () => greetingCallback(pending.signal))().then(audio => {
      if (!this.active || generation !== this.generation || pending.signal.aborted) {
        if (audio.mimeType === "audio/pcm") void audio.stream.cancel().catch(() => {});
        return null;
      }
      greetingAudio = audio;
      return audio;
    }, error => {
      if (this.active && generation === this.generation && !pending.signal.aborted) {
        if (error instanceof WattzunVoiceCallError) this.fail(error.message);
      }
      return null;
    }) : null;
    try {
      const microphone = await this.environment.microphone();
      // Permission dialogs may resolve after the user closed or changed workspaces.
      if (!this.active || generation !== this.generation) { microphone.close(); return; }
      this.microphone = microphone;
      this.update("connecting");
      if (!this.active || generation !== this.generation) return;
      if (!greeting) { this.listen(); return; }
      microphone.mute(true);
      const audio = await greeting;
      if (!this.active || generation !== this.generation || pending?.signal.aborted) return;
      if (this.pending === pending) this.pending = null;
      if (!audio) {
        this.recover();
        return;
      }
      if (this.muted) { this.update("muted"); return; }
      greetingAudio = null;
      await this.playAudio(audio, generation);
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "Your microphone could not be opened.";
      this.fail(message, error instanceof WattzunVoiceStartupError && error.reason === "policy" ? "reload" : undefined);
    } finally {
      pending?.signal.removeEventListener("abort", discardGreeting);
      discardGreeting();
      if (this.pending === pending) this.pending = null;
    }
  }
  private recover() {
    if (!this.active || !this.microphone) return;
    this.pending?.abort(); this.pending = null;
    const playback = this.playback; this.playback = null; playback?.close();
    this.discardCapture();
    this.microphone.mute(true);
    if (this.muted) { this.update("muted"); return; }
    const generation = this.generation;
    this.update("recovering");
    if (this.active && generation === this.generation) this.listen();
  }
  private discardCapture() {
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    capture.settled = true;
    capture.chunks = [];
    capture.stopSampling();
    capture.recorder.stop();
  }
  private listen() {
    if (!this.active || !this.microphone || this.muted) return;
    try {
      this.microphone.mute(false);
      const recorder = this.microphone.recorder();
      const capture: Capture = { recorder, chunks: [], bytes: 0, submit: false, settled: false, stopSampling: () => {} };
      const window = new WattzunSpeechWindow(this.environment.now());
      this.capture = capture;
      recorder.onData = (chunk) => {
        if (this.capture !== capture || capture.settled || !chunk.size) return;
        capture.bytes += chunk.size;
        const limit = chunk.type === "audio/wav" ? WATTZUN_MAX_WAV_AUDIO_BYTES : WATTZUN_MAX_AUDIO_BYTES;
        if (capture.bytes > limit) {
          this.recover();
          return;
        }
        capture.chunks.push(chunk);
      };
      recorder.onError = () => { if (this.capture === capture) this.fail("Recording stopped unexpectedly. Check your microphone and call again."); };
      recorder.onStop = (reason) => {
        if (this.capture !== capture || capture.settled) return;
        capture.settled = true;
        capture.stopSampling();
        this.capture = null;
        if ((capture.submit || reason === "limit" && window.hasSpeech) && capture.bytes) {
          const audio = new Blob(capture.chunks, { type: capture.chunks[0]?.type || "audio/webm" });
          capture.chunks = [];
          void this.send(audio);
        } else {
          capture.chunks = [];
          this.listen();
        }
      };
      recorder.start();
      capture.stopSampling = this.environment.repeat(() => {
        if (this.capture !== capture || capture.settled) return;
        const level = this.microphone?.level() || 0;
        const decision = window.sample(level, this.environment.now());
        if (window.hasSpeech) recorder.confirmSpeech();
        if (decision === "wait") return;
        capture.stopSampling();
        capture.submit = decision === "send";
        recorder.stop();
      }, 100);
      this.update("listening", "Speak, then pause. Wattzun will reply.");
    } catch { this.fail("This browser could not record audio. Try an updated browser with microphone access."); }
  }
  private async send(audio: Blob) {
    await this.requestReply(signal => this.callbacks.submit(audio, signal));
  }
  /** Run a user-requested guide step through the same call, microphone and playback lifecycle. */
  async requestReply(request: (signal: AbortSignal) => Promise<WattzunVoiceResult>): Promise<boolean> {
    if (!this.active || !this.microphone || this.muted || this.pending) return false;
    this.discardCapture();
    const previousPlayback = this.playback;
    this.playback = null;
    previousPlayback?.close();
    const generation = this.generation;
    const pending = new AbortController();
    let unplayedAudio: WattzunVoiceResult["audio"] | null = null;
    this.pending = pending;
    this.microphone?.mute(true);
    this.update("thinking");
    try {
      const result = await request(pending.signal);
      unplayedAudio = result.audio;
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      this.pending = null;
      this.callbacks.reply(result);
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      if (this.muted) { this.update("muted"); return true; }
      unplayedAudio = null;
      await this.playAudio(result.audio, generation);
    } catch (error) {
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      const message = error instanceof Error ? error.message : "The voice reply could not be completed. Try again.";
      if (error instanceof WattzunVoiceCallError) this.fail(message); else this.recover();
    } finally {
      if (unplayedAudio?.mimeType === "audio/pcm") void unplayedAudio.stream.cancel().catch(() => {});
      if (this.pending === pending) this.pending = null;
    }
    return true;
  }
  private async playAudio(audio: WattzunVoiceResult["audio"], generation: number) {
    let unplayed = true;
    try {
      const playback = this.environment.playback(audio);
      unplayed = false;
      this.playback = playback;
      playback.onEnd = () => {
        if (this.playback !== playback || !this.active || generation !== this.generation) return;
        playback.close();
        this.playback = null;
        if (this.muted) this.update("muted"); else this.listen();
      };
      playback.onError = () => { if (this.playback === playback && this.active && generation === this.generation) this.recover(); };
      await playback.play().catch(error => { if (this.playback === playback) throw error; });
      if (this.playback === playback && this.active && generation === this.generation) this.update("speaking");
    } catch { if (this.active && generation === this.generation) this.recover(); } finally {
      if (unplayed && audio.mimeType === "audio/pcm") void audio.stream.cancel().catch(() => {});
    }
  }
  toggleMute() {
    if (!this.active || !this.microphone) return;
    this.muted = !this.muted;
    this.microphone.mute(true);
    if (this.muted) {
      this.discardCapture();
      if (this.state === "listening" || this.state === "recovering") this.update("muted");
    } else if (!this.pending && !this.playback) this.listen();
  }
  interrupt() {
    if (!this.active) return;
    if (!this.playback) return;
    this.playback.close();
    this.playback = null;
    if (this.muted) this.update("muted"); else this.listen();
  }
  hangUp() { if (!this.active) return; this.cleanup(); this.update("ended", "Call ended. You can continue in chat."); }
  private fail(message: string, recovery?: "reload") { this.cleanup(); this.update("error", message, recovery); }
  private cleanup() {
    this.active = false;
    ++this.generation;
    this.discardCapture();
    this.pending?.abort();
    this.pending = null;
    this.playback?.close();
    this.playback = null;
    this.microphone?.close();
    this.microphone = null;
    this.muted = false;
  }
  dispose() { this.cleanup(); }
}

export function createWattzunBrowserVoiceEnvironment(): WattzunVoiceEnvironment {
  let playbackContext: AudioContext | null = null;
  let microphoneGeneration = 0;
  return {
    now: () => performance.now(),
    repeat(callback, milliseconds) { const timer = window.setInterval(callback, milliseconds); return () => window.clearInterval(timer); },
    async microphone() {
      if (teamCallPolicyBlocked("audio")) {
        throw new WattzunVoiceStartupError("This page carried over the public site's microphone block. Reload TLink to enable calling, then press Call Wattzun again.", "policy");
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined" || typeof AudioContext === "undefined") {
        throw new Error("Voice calls need a modern browser with microphone and AudioWorklet support on a secure connection.");
      }
      const generation = ++microphoneGeneration;
      let audioContext: AudioContext | null = null;
      let stream: MediaStream | null = null;
      let stage: "microphone" | "audio" | "capture" = "audio";
      try {
        audioContext = new AudioContext();
        // Unlock audio on the Call click stack, before a microphone dialog can
        // consume the browser's user activation. Handle rejection immediately.
        const resumed = audioContext.resume().then(() => null, () => new WattzunVoiceStartupError("Your browser could not start call audio. Tap Call Wattzun again with this page open in the foreground.", "audio"));
        stage = "microphone";
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        stage = "audio";
        const audioFailure = await resumed;
        if (audioFailure) throw audioFailure;
        stage = "capture";
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const capture = await createWattzunPcmCapture(audioContext, source);
        if (generation === microphoneGeneration) playbackContext = audioContext;
        const media = stream;
        const context = audioContext;
        let closed = false;
        return {
          recorder: () => capture.recorder(),
          level() { analyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length); },
          mute(muted) { for (const track of media.getTracks()) track.enabled = !muted; },
          close() {
            if (closed) return;
            closed = true;
            if (playbackContext === context) playbackContext = null;
            capture.close();
            for (const track of media.getTracks()) track.stop(); source.disconnect(); analyser.disconnect(); void context.close().catch(() => {});
          },
        };
      } catch (error) {
        if (playbackContext === audioContext) playbackContext = null;
        stream?.getTracks().forEach(track => track.stop());
        void audioContext?.close().catch(() => {});
        if (error instanceof WattzunVoiceStartupError) throw error;
        if (stage === "audio") throw new WattzunVoiceStartupError("Call audio could not start. Keep this page open and tap Call Wattzun again.", stage);
        if (stage === "capture") throw new WattzunVoiceStartupError("Voice capture could not start. Reload TLink and try again in an up-to-date browser.", stage);
        const name = error instanceof Error ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          const device = tradeBrowserDevice();
          throw new WattzunVoiceStartupError(device.platform === "android" && device.browser === "chrome"
            ? "Chrome or Android blocked microphone access. If this site's microphone is already allowed, check Android Settings > Apps > Chrome > Permissions > Microphone, then call again."
            : "Your browser or device blocked microphone access. Allow this site and your browser in microphone settings, then call again.", stage);
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") throw new WattzunVoiceStartupError("No available microphone was found. Check your microphone or headset, then call again.", stage);
        if (name === "NotReadableError" || name === "AbortError") throw new WattzunVoiceStartupError("Your microphone could not open. Close other apps using it, then call again.", stage);
        throw new WattzunVoiceStartupError("Your microphone could not be opened. Check that it is available and call again.", stage);
      }
    },
    playback(result) {
      if (result.mimeType === "audio/pcm") {
        if (!playbackContext) throw new Error("The call's audio device is unavailable. Start the call again.");
        return createWattzunPcmPlayback(playbackContext, result.stream);
      }
      const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const audio = new Audio(url);
      let closed = false;
      const playback: WattzunPlayback = {
        onEnd: () => {}, onError: () => {}, play: () => closed ? Promise.reject(new DOMException("Audio playback was cancelled.", "AbortError")) : audio.play(),
        close() { if (closed) return; closed = true; audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); },
      };
      audio.onended = () => { if (!closed) playback.onEnd(); };
      audio.onerror = () => { if (!closed) playback.onError(); };
      return playback;
    },
  };
}
