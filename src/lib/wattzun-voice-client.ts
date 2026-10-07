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
const REQUEST_TIMEOUT_MS = 75_000;
const STREAM_IDLE_TIMEOUT_MS = 20_000;
class WattzunVoiceTransportTimeout extends Error {
  constructor() { super("The voice connection stopped responding."); }
}

function discardAudio(audio: WattzunVoiceResult["audio"]) {
  if (audio.mimeType === "audio/pcm") void audio.stream.cancel().catch(() => {});
}

/** A call can remain open all day; an individual lost network request cannot. */
function boundedRequest<T>(request: Promise<T>, controller: AbortController, discard: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true; clearTimeout(timer); controller.signal.removeEventListener("abort", aborted); return true;
    };
    const aborted = () => { if (finish()) reject(new DOMException("Call request cancelled.", "AbortError")); };
    const timer = setTimeout(() => {
      if (!finish()) return;
      reject(new WattzunVoiceTransportTimeout()); controller.abort();
    }, REQUEST_TIMEOUT_MS);
    controller.signal.addEventListener("abort", aborted, { once: true });
    if (controller.signal.aborted) aborted();
    request.then(value => { if (finish()) resolve(value); else discard(value); }, error => { if (finish()) reject(error); });
  });
}

/** End a stalled PCM read so playback can drain received speech and release the microphone. */
function boundedAudioStream(stream: ReadableStream<Uint8Array>, timedOut: () => void): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    void reader.cancel().catch(() => {}).finally(() => reader.releaseLock());
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      timer = setTimeout(() => {
        if (finished) return;
        timedOut(); controller.error(new WattzunVoiceTransportTimeout()); cancel();
      }, STREAM_IDLE_TIMEOUT_MS);
      try {
        const chunk = await reader.read();
        clearTimeout(timer);
        if (finished) return;
        if (chunk.done) { finished = true; reader.releaseLock(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) {
        if (finished) return;
        controller.error(error); cancel();
      }
    },
    cancel,
  }, { highWaterMark: 0 });
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
  get hasCandidate() { return this.speechStarted !== null; }
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

type Capture = { recorder: WattzunRecorder; window: WattzunSpeechWindow; thinking: boolean; chunks: Blob[]; bytes: number; submit: boolean; settled: boolean; stopSampling: () => void };
type VoiceCallbacks = {
  status: (status: WattzunCallStatus) => void;
  submit: (audio: Blob, signal: AbortSignal) => Promise<WattzunVoiceResult>;
  reply: (result: WattzunVoiceResult) => void;
  played?: (audio: WattzunVoiceResult["audio"]) => void;
  greeting?: (signal: AbortSignal) => Promise<WattzunVoiceResult["audio"]>;
  /** Read an existing pending receipt only. Never resubmit the user's audio or action. */
  reconcile?: (signal: AbortSignal) => Promise<WattzunVoiceResult | null>;
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
  private replyIncomplete = false;
  private followOnAudio: Blob | null = null;
  private followOnReady: (() => void) | null = null;
  private stopMemoryDrain: (() => void) | null = null;
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
    this.replyIncomplete = false;
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
    const greeting = greetingCallback && pending ? boundedRequest((async () => greetingCallback(pending.signal))(), pending, discardAudio).then(audio => {
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
      if (!this.active || generation !== this.generation) return;
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
  private recover(replyIncomplete = false) {
    if (!this.active || !this.microphone) return;
    if (replyIncomplete) this.replyIncomplete = true;
    this.pending?.abort(); this.pending = null;
    const playback = this.playback; this.playback = null; playback?.close();
    this.followOnAudio = null;
    this.discardCapture();
    this.microphone.mute(true);
    if (this.muted) { this.update("muted"); return; }
    const generation = this.generation;
    this.update("recovering", this.replyIncomplete ? "No spoken reply was completed. Your call is still connected and listening." : "");
    if (this.active && generation === this.generation) this.listen();
  }
  private discardCapture() {
    const capture = this.capture;
    this.capture = null;
    if (capture) {
      capture.settled = true;
      capture.chunks = [];
      capture.stopSampling();
      capture.recorder.stop();
    }
    const ready = this.followOnReady; this.followOnReady = null; ready?.();
  }
  private listen(thinking = false) {
    if (!this.active || !this.microphone || this.muted) return;
    try {
      this.microphone.mute(false);
      const recorder = this.microphone.recorder();
      const window = new WattzunSpeechWindow(this.environment.now());
      const capture: Capture = { recorder, window, thinking, chunks: [], bytes: 0, submit: false, settled: false, stopSampling: () => {} };
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
          if (thinking) {
            // Keep one complete follow-on turn, bounded by the existing 45-second
            // recorder. Its preceding action must finish before this can submit.
            this.followOnAudio = audio;
            this.microphone?.mute(true);
            const ready = this.followOnReady; this.followOnReady = null; ready?.();
          } else void this.send(audio);
        } else {
          capture.chunks = [];
          const ready = this.followOnReady; this.followOnReady = null;
          if (ready) ready(); else this.listen(thinking);
        }
      };
      recorder.start();
      capture.stopSampling = this.environment.repeat(() => {
        if (this.capture !== capture || capture.settled) return;
        const level = this.microphone?.level() || 0;
        const decision = window.sample(level, this.environment.now());
        if (window.hasSpeech) recorder.confirmSpeech();
        if (decision === "wait" && !(thinking && this.followOnReady && !window.hasCandidate)) return;
        capture.stopSampling();
        capture.submit = decision === "send";
        recorder.stop();
      }, 100);
      if (thinking) return;
      if (this.replyIncomplete) {
        if (this.state !== "recovering") this.update("recovering", "No spoken reply was completed. Your call is still connected and listening.");
      } else this.update("listening", "Speak, then pause. Wattzun will reply.");
    } catch { this.fail("This browser could not record audio. Try an updated browser with microphone access."); }
  }
  private async send(audio: Blob) {
    await this.requestReply(signal => this.callbacks.submit(audio, signal));
  }
  private async takeFollowOn(): Promise<Blob | null> {
    const capture = this.capture;
    if (!this.followOnAudio && capture?.thinking && (capture.window.hasCandidate || (this.microphone?.level() || 0) >= 0.025)) {
      await new Promise<void>(resolve => { this.followOnReady = resolve; });
    }
    this.discardCapture();
    const audio = this.followOnAudio; this.followOnAudio = null;
    return audio;
  }
  private retainUnspokenInput(result: WattzunVoiceResult) {
    this.stopMemoryDrain?.();
    const audio = result.audio;
    if (audio.mimeType !== "audio/pcm" || !result.inputTranscript || result.transcript.trim()) { discardAudio(audio); return; }
    // The final transport frame may contain literal input that arrived after
    // the reply header. Keep that memory without playing or waiting for speech.
    const reader = audio.stream.getReader();
    let stopped = false, bytes = 0;
    const stop = () => {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      if (this.stopMemoryDrain === stop) this.stopMemoryDrain = null;
      void reader.cancel().catch(() => {});
    };
    const timer = setTimeout(stop, STREAM_IDLE_TIMEOUT_MS);
    this.stopMemoryDrain = stop;
    void (async () => {
      try {
        while (!stopped) {
          const chunk = await reader.read();
          if (stopped || chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > WATTZUN_MAX_AUDIO_BYTES) break;
        }
      } catch { /* A missing transcript leaves the existing request summary intact. */ }
      finally { stop(); reader.releaseLock(); }
    })();
  }
  /** Run a user-requested guide step through the same call, microphone and playback lifecycle. */
  async requestReply(request: (signal: AbortSignal) => Promise<WattzunVoiceResult>): Promise<boolean> {
    return this.performReply(request, true);
  }
  private async performReply(request: (signal: AbortSignal) => Promise<WattzunVoiceResult | null>, allowReconciliation: boolean, preserveFollowOn = false): Promise<boolean> {
    if (!this.active || !this.microphone || this.muted || this.pending) return false;
    if (!preserveFollowOn) { this.followOnAudio = null; this.discardCapture(); }
    const previousPlayback = this.playback;
    this.playback = null;
    previousPlayback?.close();
    const generation = this.generation;
    const pending = new AbortController();
    let unplayedAudio: WattzunVoiceResult["audio"] | null = null;
    this.pending = pending;
    this.microphone?.mute(true);
    this.replyIncomplete = false;
    this.update("thinking");
    if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
    if (!this.followOnAudio && !this.capture && !this.muted) this.listen(true);
    else if (this.capture && !this.muted) this.microphone?.mute(false);
    if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
    try {
      const result = await boundedRequest(request(pending.signal), pending, value => { if (value) discardAudio(value.audio); });
      if (!result) { this.recover(true); return true; }
      unplayedAudio = result.audio;
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      this.callbacks.reply(result);
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      const followOn = await this.takeFollowOn();
      if (!this.active || generation !== this.generation || pending.signal.aborted) return true;
      this.pending = null;
      if (this.muted) { this.update("muted"); return true; }
      if (followOn) {
        this.retainUnspokenInput(result);
        unplayedAudio = null;
        await this.performReply(signal => this.callbacks.submit(followOn, signal), true);
        return true;
      }
      this.microphone?.mute(true);
      unplayedAudio = null;
      await this.playAudio(result.audio, generation, allowReconciliation);
    } catch (error) {
      if (!this.active || generation !== this.generation) return true;
      if (error instanceof WattzunVoiceTransportTimeout) {
        if (this.pending === pending) this.pending = null;
        await this.reconcileTurn(generation, allowReconciliation);
        return true;
      }
      if (pending.signal.aborted) return true;
      const message = error instanceof Error ? error.message : "The voice reply could not be completed. Try again.";
      if (error instanceof WattzunVoiceCallError) this.fail(message);
      else {
        if (this.pending === pending) this.pending = null;
        await this.reconcileTurn(generation, allowReconciliation);
      }
    } finally {
      if (unplayedAudio?.mimeType === "audio/pcm") void unplayedAudio.stream.cancel().catch(() => {});
      if (this.pending === pending) this.pending = null;
    }
    return true;
  }
  private async reconcileTurn(generation: number, allowed: boolean) {
    if (!this.active || generation !== this.generation) return;
    const reconcile = this.callbacks.reconcile;
    if (allowed && reconcile && !this.muted) await this.performReply(reconcile, false, true);
    else this.recover(true);
  }
  private async playAudio(audio: WattzunVoiceResult["audio"], generation: number, allowReconciliation = false) {
    let unplayed = true;
    let streamTimedOut = false;
    const playable = audio.mimeType === "audio/pcm" ? { ...audio, stream: boundedAudioStream(audio.stream, () => { streamTimedOut = true; }) } : audio;
    try {
      const playback = this.environment.playback(playable);
      unplayed = false;
      this.playback = playback;
      playback.onEnd = () => {
        if (this.playback !== playback || !this.active || generation !== this.generation) return;
        playback.close();
        this.playback = null;
        this.callbacks.played?.(audio);
        if (!this.active || generation !== this.generation) return;
        if (this.muted) this.update("muted"); else this.listen();
      };
      playback.onError = () => {
        if (this.playback !== playback || !this.active || generation !== this.generation) return;
        if (streamTimedOut) void this.reconcileTurn(generation, allowReconciliation); else this.recover(true);
      };
      await playback.play().catch(error => { if (this.playback === playback) throw error; });
      if (this.playback === playback && this.active && generation === this.generation) this.update("speaking");
    } catch {
      if (this.active && generation === this.generation) {
        if (streamTimedOut) await this.reconcileTurn(generation, allowReconciliation); else this.recover(true);
      }
    } finally {
      if (unplayed) discardAudio(playable);
    }
  }
  toggleMute() {
    if (!this.active || !this.microphone) return;
    this.muted = !this.muted;
    this.microphone.mute(true);
    if (this.muted) {
      this.stopMemoryDrain?.();
      this.followOnAudio = null;
      this.discardCapture();
      if (this.state === "listening" || this.state === "recovering") this.update("muted");
    } else if (!this.playback && !this.capture && !this.followOnAudio) this.listen(Boolean(this.pending));
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
    this.stopMemoryDrain?.();
    this.followOnAudio = null;
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
