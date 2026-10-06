import { WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_TURN_SECONDS } from "./wattzun-portal.ts";
import type { WattzunVoiceResult } from "./wattzun-portal.ts";

export type WattzunCallState = "idle" | "permission" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "confirming" | "ended" | "error";
export type WattzunCallStatus = { state: WattzunCallState; message: string };
export interface WattzunRecorder {
  onData: (data: Blob) => void;
  onStop: () => void;
  onError: () => void;
  start(): void;
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
  prompt?(message: string): WattzunPlayback | null;
  now(): number;
  repeat(callback: () => void, milliseconds: number): () => void;
}

/** A short speech turn ends on silence. Silence alone never reaches the provider. */
export class WattzunSpeechWindow {
  private speechMilliseconds = 0;
  private lastSample: number;
  private lastSpeech: number;
  private heardSpeech = false;
  private readonly started: number;
  constructor(started: number) { this.started = started; this.lastSample = started; this.lastSpeech = started; }
  get hasSpeech() { return this.heardSpeech; }
  sample(level: number, now: number): "wait" | "send" | "silent" {
    const elapsed = Math.min(250, Math.max(0, now - this.lastSample));
    this.lastSample = now;
    if (level >= 0.025) {
      this.speechMilliseconds += elapsed;
      this.lastSpeech = now;
      if (this.speechMilliseconds >= 250) this.heardSpeech = true;
    }
    else if (!this.heardSpeech && now - this.lastSpeech > 200) this.speechMilliseconds = 0;
    if (now - this.started >= WATTZUN_MAX_TURN_SECONDS * 1000) return this.heardSpeech ? "send" : "silent";
    if (this.heardSpeech && now - this.lastSpeech >= 1200) return "send";
    return "wait";
  }
}

type Capture = { recorder: WattzunRecorder; chunks: Blob[]; bytes: number; submit: boolean; settled: boolean; stopSampling: () => void };
type VoiceCallbacks = {
  status: (status: WattzunCallStatus) => void;
  submit: (audio: Blob, signal: AbortSignal) => Promise<WattzunVoiceResult>;
  reply: (result: WattzunVoiceResult) => void;
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
  private lastInteraction = 0;
  private lastSound = -Infinity;
  private confirmationStarted: number | null = null;
  private promptStarted = 0;
  private promptPlayback: WattzunPlayback | null = null;
  private stopIdleWatch: (() => void) | null = null;
  private readonly environment: WattzunVoiceEnvironment;
  private readonly callbacks: VoiceCallbacks;
  constructor(environment: WattzunVoiceEnvironment, callbacks: VoiceCallbacks) { this.environment = environment; this.callbacks = callbacks; }
  private update(state: WattzunCallState, message = "") {
    this.state = state;
    this.callbacks.status({ state, message });
  }
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.muted = false;
    const generation = ++this.generation;
    this.update("permission", "Allow your microphone to speak to Wattzun.");
    try {
      const microphone = await this.environment.microphone();
      // Permission dialogs may resolve after the user closed or changed workspaces.
      if (!this.active || generation !== this.generation) { microphone.close(); return; }
      this.microphone = microphone;
      this.update("connecting");
      this.lastInteraction = this.environment.now();
      this.stopIdleWatch = this.environment.repeat(() => this.checkIdle(), 1000);
      this.listen();
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "Your microphone could not be opened.";
      this.fail(message);
    }
  }
  private checkIdle() {
    if (!this.active || this.pending || this.playback) return;
    const now = this.environment.now();
    if (this.promptPlayback) {
      if (now - this.promptStarted >= 8000) this.finishPrompt();
      return;
    }
    // Give a newly started utterance time to pass sustained-speech detection.
    if (!this.muted && this.capture && (this.microphone?.level() || 0) >= .025) this.lastSound = now;
    if (!this.muted && now - this.lastSound < 1000) return;
    if (this.confirmationStarted !== null) {
      if (now - this.confirmationStarted >= 30000) { this.cleanup(); this.update("ended", "Call ended after no response."); }
      return;
    }
    if ((this.state === "listening" || this.state === "muted") && now - this.lastInteraction >= (this.muted ? 180000 : 90000)) this.askToContinue();
  }
  private askToContinue() {
    this.discardCapture();
    this.microphone?.mute(true);
    this.update("confirming", "Would you like to continue this call?");
    const prompt = this.environment.prompt?.("Would you like to continue this call?") || null;
    if (!prompt) { this.finishPrompt(); return; }
    this.promptPlayback = prompt;
    this.promptStarted = this.environment.now();
    prompt.onEnd = () => { if (this.promptPlayback === prompt) this.finishPrompt(); };
    prompt.onError = () => { if (this.promptPlayback === prompt) this.finishPrompt(); };
    void prompt.play().catch(() => { if (this.promptPlayback === prompt) this.finishPrompt(); });
  }
  private finishPrompt() {
    this.promptPlayback?.close(); this.promptPlayback = null;
    if (!this.active) return;
    this.confirmationStarted = this.environment.now();
    if (this.muted) this.update("confirming", "Would you like to continue this call? Your microphone is muted. Unmute or choose Continue call.");
    else this.listen("Would you like to continue this call? Speak or choose Continue call.", false);
  }
  continueCall() {
    if (!this.active || this.state !== "confirming") return;
    this.promptPlayback?.close(); this.promptPlayback = null;
    this.confirmationStarted = null; this.lastInteraction = this.environment.now();
    this.discardCapture();
    if (this.muted) this.update("muted", "Call continued. Your microphone is still muted.");
    else this.listen();
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
  private listen(message = "", resetIdle = true) {
    if (!this.active || !this.microphone || this.muted) return;
    if (resetIdle) { this.lastInteraction = this.environment.now(); this.confirmationStarted = null; }
    try {
      this.microphone.mute(false);
      const recorder = this.microphone.recorder();
      const capture: Capture = { recorder, chunks: [], bytes: 0, submit: false, settled: false, stopSampling: () => {} };
      const window = new WattzunSpeechWindow(this.environment.now());
      this.capture = capture;
      recorder.onData = (chunk) => {
        if (this.capture !== capture || capture.settled || !chunk.size) return;
        capture.bytes += chunk.size;
        if (capture.bytes > WATTZUN_MAX_AUDIO_BYTES) { this.fail("That voice turn was too large. Start a new call and use shorter questions."); return; }
        capture.chunks.push(chunk);
      };
      recorder.onError = () => { if (this.capture === capture) this.fail("Recording stopped unexpectedly. Check your microphone and call again."); };
      recorder.onStop = () => {
        if (this.capture !== capture || capture.settled) return;
        capture.settled = true;
        capture.stopSampling();
        this.capture = null;
        if (capture.submit && capture.bytes) {
          const audio = new Blob(capture.chunks, { type: capture.chunks[0]?.type || "audio/webm" });
          capture.chunks = [];
          void this.send(audio);
        } else {
          capture.chunks = [];
          this.listen("I did not hear a question. Speak when you are ready.", false);
        }
      };
      recorder.start();
      capture.stopSampling = this.environment.repeat(() => {
        if (this.capture !== capture || capture.settled) return;
        const level = this.microphone?.level() || 0;
        if (level >= .025) this.lastSound = this.environment.now();
        const decision = window.sample(level, this.environment.now());
        if (window.hasSpeech && level >= .025) {
          this.lastInteraction = this.environment.now();
          if (this.confirmationStarted !== null) { this.confirmationStarted = null; this.update("listening", "Speak, then pause. Wattzun will reply."); }
        }
        if (decision === "wait") return;
        capture.stopSampling();
        capture.submit = decision === "send";
        recorder.stop();
      }, 100);
      this.update(this.confirmationStarted !== null ? "confirming" : "listening", message || "Speak, then pause. Wattzun will reply.");
    } catch { this.fail("This browser could not record audio. Try an updated browser with microphone access."); }
  }
  private async send(audio: Blob) {
    if (!this.active || this.muted || this.pending) return;
    const generation = this.generation;
    const pending = new AbortController();
    this.pending = pending;
    this.microphone?.mute(true);
    this.update("thinking");
    try {
      const result = await this.callbacks.submit(audio, pending.signal);
      if (!this.active || generation !== this.generation || pending.signal.aborted) return;
      this.pending = null;
      this.callbacks.reply(result);
      if (this.muted) { this.lastInteraction = this.environment.now(); this.update("muted"); return; }
      const playback = this.environment.playback(result.audio);
      this.playback = playback;
      const finish = () => {
        if (this.playback !== playback || !this.active || generation !== this.generation) return;
        playback.close();
        this.playback = null;
        if (this.muted) { this.lastInteraction = this.environment.now(); this.update("muted"); } else this.listen();
      };
      playback.onEnd = finish;
      playback.onError = () => { if (this.playback === playback) this.fail("Wattzun replied in chat, but the audio could not play. Start the call again."); };
      this.update("speaking");
      await playback.play().catch(error => { if (this.playback === playback) throw error; });
    } catch (error) {
      if (!this.active || generation !== this.generation || pending.signal.aborted) return;
      const message = error instanceof Error ? error.message : "The voice reply could not be completed. Try again.";
      this.fail(message);
    } finally { if (this.pending === pending) this.pending = null; }
  }
  toggleMute() {
    if (!this.active || !this.microphone) return;
    this.promptPlayback?.close(); this.promptPlayback = null;
    this.confirmationStarted = null; this.lastInteraction = this.environment.now();
    this.muted = !this.muted;
    this.microphone.mute(true);
    if (this.muted) {
      this.discardCapture();
      if (this.state === "listening" || this.state === "confirming") this.update("muted");
    } else if (!this.pending && !this.playback) this.listen();
  }
  interrupt() {
    if (!this.active || !this.playback) return;
    this.playback.close();
    this.playback = null;
    if (this.muted) { this.lastInteraction = this.environment.now(); this.update("muted"); } else this.listen();
  }
  hangUp() { if (!this.active) return; this.cleanup(); this.update("ended", "Call ended. You can continue in chat."); }
  private fail(message: string) { this.cleanup(); this.update("error", message); }
  private cleanup() {
    this.active = false;
    ++this.generation;
    this.stopIdleWatch?.(); this.stopIdleWatch = null;
    this.promptPlayback?.close(); this.promptPlayback = null;
    this.confirmationStarted = null;
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
  return {
    now: () => performance.now(),
    repeat(callback, milliseconds) { const timer = window.setInterval(callback, milliseconds); return () => window.clearInterval(timer); },
    prompt(message) {
      if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return null;
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-AU";
      const prompt: WattzunPlayback = {
        onEnd: () => {}, onError: () => {},
        async play() { window.speechSynthesis.speak(utterance); },
        close() { utterance.onend = null; utterance.onerror = null; window.speechSynthesis.cancel(); },
      };
      utterance.onend = () => prompt.onEnd(); utterance.onerror = () => prompt.onError();
      return prompt;
    },
    async microphone() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
        throw new Error("Voice calls need a browser with microphone recording support on a secure connection.");
      }
      const audioContext = new AudioContext();
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        await audioContext.resume();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
        const media = stream;
        return {
          recorder() {
            const recorder = new MediaRecorder(media, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
            const port: WattzunRecorder = {
              onData: () => {}, onStop: () => {}, onError: () => {},
              start: () => recorder.start(1000),
              stop: () => { if (recorder.state !== "inactive") recorder.stop(); },
            };
            recorder.ondataavailable = event => port.onData(event.data);
            recorder.onstop = () => port.onStop();
            recorder.onerror = () => port.onError();
            return port;
          },
          level() { analyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length); },
          mute(muted) { for (const track of media.getTracks()) track.enabled = !muted; },
          close() { for (const track of media.getTracks()) track.stop(); source.disconnect(); analyser.disconnect(); void audioContext.close().catch(() => {}); },
        };
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        void audioContext.close().catch(() => {});
        if (error instanceof Error && error.name === "NotAllowedError") throw new Error("Microphone permission was denied. Allow microphone access in your browser, then call again.");
        if (error instanceof Error && error.name === "NotFoundError") throw new Error("No microphone was found. Connect one, then call again.");
        throw new Error("Your microphone could not be opened. Check that it is available and call again.");
      }
    },
    playback(result) {
      const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const audio = new Audio(url);
      const playback: WattzunPlayback = {
        onEnd: () => {}, onError: () => {}, play: () => audio.play(),
        close() { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); },
      };
      audio.onended = () => playback.onEnd();
      audio.onerror = () => playback.onError();
      return playback;
    },
  };
}
