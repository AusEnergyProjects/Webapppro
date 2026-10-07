import { WATTZUN_MAX_AUDIO_BYTES } from "./wattzun-portal.ts";
import type { WattzunPlayback } from "./wattzun-voice-client.ts";

const SAMPLE_RATE = 24_000;
const STARTUP_SAMPLES = 960;
const BLOCK_SAMPLES = 4_800;

/** Plays raw signed 16-bit little-endian mono PCM on the call's unlocked context. */
export function createWattzunPcmPlayback(context: AudioContext, stream: ReadableStream<Uint8Array>): WattzunPlayback {
  const sources = new Set<AudioBufferSourceNode>();
  const samples = new Float32Array(BLOCK_SAMPLES);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let sampleCount = 0;
  let lowByte: number | null = null;
  let bytes = 0;
  let nextStart = 0;
  let started = false;
  let complete = false;
  let readFailed = false;
  let ended = false;
  let failed = false;
  let closed = false;
  let resourcesClosed = false;
  let playing: Promise<void> | null = null;
  let resolveStart: (() => void) | null = null;
  let rejectStart: ((error: Error) => void) | null = null;

  const closeResources = () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    if (reader) void reader.cancel().catch(() => {});
    else if (!complete) void stream.cancel().catch(() => {});
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    sampleCount = 0;
    lowByte = null;
  };
  const finish = () => {
    if (closed || failed || ended || !complete || sources.size) return;
    if (readFailed) {
      failed = true;
      playback.onError();
      return;
    }
    ended = true;
    playback.onEnd();
  };
  const fail = (error: unknown) => {
    if (closed || failed || ended) return;
    failed = true;
    closeResources();
    if (started) playback.onError();
    else rejectStart?.(error instanceof Error ? error : new Error("Wattzun's audio could not play."));
  };
  const flush = () => {
    if (!sampleCount) return;
    const buffer = context.createBuffer(1, sampleCount, SAMPLE_RATE);
    buffer.copyToChannel(samples.subarray(0, sampleCount), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.onended = () => {
      if (closed || failed || !sources.delete(source)) return;
      source.disconnect();
      finish();
    };
    const start = Math.max(nextStart, context.currentTime + 0.02);
    try {
      source.connect(context.destination);
      source.start(start);
    } catch (error) {
      source.onended = null;
      source.disconnect();
      throw error;
    }
    sources.add(source);
    nextStart = start + sampleCount / SAMPLE_RATE;
    sampleCount = 0;
    if (!started) {
      started = true;
      resolveStart?.();
    }
  };
  const append = (value: number) => {
    samples[sampleCount++] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
    if (sampleCount >= (started ? BLOCK_SAMPLES : STARTUP_SAMPLES)) flush();
  };
  const consume = async (activeReader: ReadableStreamDefaultReader<Uint8Array>) => {
    try {
      while (!closed && !failed) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await activeReader.read(); }
        catch (error) {
          if (closed || failed) return;
          if (!started) { fail(error); return; }
          // A lost connection cannot retract speech already received. Drain valid
          // samples before reporting the failure, without announcing a clean end.
          lowByte = null;
          flush();
          readFailed = true;
          complete = true;
          finish();
          return;
        }
        if (closed || failed) return;
        if (chunk.done) {
          if (lowByte !== null) throw new Error("Wattzun's audio ended with an incomplete sample.");
          if (!bytes) throw new Error("Wattzun returned no audio to play.");
          flush();
          complete = true;
          finish();
          return;
        }
        if (!(chunk.value instanceof Uint8Array)) throw new Error("Wattzun returned invalid audio data.");
        bytes += chunk.value.byteLength;
        if (bytes > WATTZUN_MAX_AUDIO_BYTES) throw new Error("Wattzun's audio reply was too large.");
        let offset = 0;
        if (lowByte !== null && chunk.value.byteLength) {
          append(lowByte | (chunk.value[0] << 8));
          lowByte = null;
          offset = 1;
        }
        for (; offset + 1 < chunk.value.byteLength; offset += 2) append(chunk.value[offset] | (chunk.value[offset + 1] << 8));
        if (offset < chunk.value.byteLength) lowByte = chunk.value[offset];
        // Keep small streamed chunks moving without creating a source per sample.
        if (sampleCount >= STARTUP_SAMPLES) flush();
      }
    } catch (error) { fail(error); }
    finally {
      activeReader.releaseLock();
      if (reader === activeReader) reader = null;
    }
  };
  const begin = async () => {
    try {
      if (context.state === "closed") throw new Error("The call's audio device has closed. Start the call again.");
      if (context.state !== "running") await context.resume();
      if (closed || failed) return;
      reader = stream.getReader();
      await consume(reader);
    } catch (error) { fail(error); }
  };
  const playback: WattzunPlayback = {
    onEnd: () => {},
    onError: () => {},
    play() {
      if (!playing) {
        playing = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
        if (closed) rejectStart?.(new DOMException("Audio playback was cancelled.", "AbortError"));
        else void begin();
      }
      return playing;
    },
    close() {
      if (closed) return;
      closed = true;
      closeResources();
      if (!started) rejectStart?.(new DOMException("Audio playback was cancelled.", "AbortError"));
    },
  };
  return playback;
}
