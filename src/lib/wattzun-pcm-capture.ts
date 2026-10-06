import { WATTZUN_MAX_WAV_AUDIO_BYTES } from "./wattzun-portal.ts";
import type { WattzunRecorder } from "./wattzun-voice-client.ts";

const WAV_HEADER_BYTES = 44;
const BLOCK_BYTES = 4_800;

export function encodeWattzunPcmWav(chunks: readonly ArrayBuffer[]): Blob {
  const bytes = chunks.reduce((total, chunk) => {
    if (!(chunk instanceof ArrayBuffer) || !chunk.byteLength || chunk.byteLength % 2) throw new Error("Invalid microphone PCM data.");
    return total + chunk.byteLength;
  }, 0);
  if (!bytes || bytes + WAV_HEADER_BYTES > WATTZUN_MAX_WAV_AUDIO_BYTES) throw new Error("Microphone recording exceeds the voice turn limit.");
  const header = new ArrayBuffer(WAV_HEADER_BYTES);
  const data = new DataView(header);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) data.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); data.setUint32(4, bytes + 36, true); text(8, "WAVE"); text(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, 24_000, true); data.setUint32(28, 48_000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  text(36, "data"); data.setUint32(40, bytes, true);
  return new Blob([header, ...chunks], { type: "audio/wav" });
}

type Recording = { id: number; port: WattzunRecorder; chunks: ArrayBuffer[]; bytes: number; stopping: boolean };

/** A single same-origin worklet owns bounded turn capture on the microphone context. */
export async function createWattzunPcmCapture(context: AudioContext, source: AudioNode) {
  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") throw new DOMException("Native voice capture requires AudioWorklet support.", "NotSupportedError");
  await context.audioWorklet.addModule("/wattzun-voice-worklet.js");
  const node = new AudioWorkletNode(context, "wattzun-voice-capture", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit",
  });
  let sourceConnected = false;
  let outputConnected = false;
  let recording: Recording | null = null;
  let sequence = 0;
  let closed = false;
  let broken = false;
  const release = () => {
    node.onprocessorerror = null;
    node.port.onmessage = null;
    node.port.postMessage({ type: "close" });
    node.port.close();
    if (sourceConnected) { source.disconnect(node); sourceConnected = false; }
    if (outputConnected) { node.disconnect(); outputConnected = false; }
  };
  const fail = () => {
    if (closed || broken) return;
    broken = true;
    const active = recording;
    recording = null;
    if (active) { active.chunks = []; active.bytes = 0; }
    release();
    active?.port.onError();
  };
  node.onprocessorerror = fail;
  node.port.onmessage = event => {
    const active = recording;
    if (closed || broken || !active || !event.data || typeof event.data !== "object" || event.data.id !== active.id) return;
    if (event.data.type === "data") {
      const chunk: unknown = event.data.samples;
      if (!(chunk instanceof ArrayBuffer) || !chunk.byteLength || chunk.byteLength > BLOCK_BYTES || chunk.byteLength % 2
        || active.bytes + chunk.byteLength + WAV_HEADER_BYTES > WATTZUN_MAX_WAV_AUDIO_BYTES) { fail(); return; }
      active.chunks.push(chunk);
      active.bytes += chunk.byteLength;
    } else if (event.data.type === "stop" && active.stopping) {
      recording = null;
      const chunks = active.chunks;
      active.chunks = [];
      active.bytes = 0;
      if (chunks.length) active.port.onData(encodeWattzunPcmWav(chunks));
      if (!closed && !broken) active.port.onStop();
    } else fail();
  };
  try {
    source.connect(node); sourceConnected = true;
    node.connect(context.destination); outputConnected = true;
  } catch (error) { release(); throw error; }
  return {
    recorder(): WattzunRecorder {
      let started = false;
      let stopped = false;
      const id = ++sequence;
      const port: WattzunRecorder = {
        onData: () => {}, onStop: () => {}, onError: () => {},
        start() {
          if (closed || broken) throw new Error("The microphone audio processor is unavailable.");
          if (started) return;
          if (recording && !recording.stopping) throw new Error("A microphone recording is already active.");
          started = true;
          if (recording) { recording.chunks = []; recording.bytes = 0; }
          recording = { id, port, chunks: [], bytes: 0, stopping: false };
          node.port.postMessage({ type: "start", id });
        },
        stop() {
          if (!started || stopped || closed || broken) return;
          stopped = true;
          if (recording?.id !== id) return;
          recording.stopping = true;
          node.port.postMessage({ type: "stop", id });
        },
      };
      return port;
    },
    close() {
      if (closed) return;
      closed = true;
      if (recording) { recording.chunks = []; recording.bytes = 0; recording = null; }
      if (!broken) release();
    },
  };
}
