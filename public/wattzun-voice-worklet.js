/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { WattzunPcmResampler } from "./wattzun-pcm-resampler.js";

const BLOCK_BYTES = 4_800;
const MAX_SAMPLES = 45 * 24_000;

class WattzunVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.closed = false;
    this.id = null;
    this.resampler = null;
    this.samples = 0;
    this.bytes = 0;
    this.block = new Uint8Array(BLOCK_BYTES);
    this.view = new DataView(this.block.buffer);
    this.append = value => {
      if (this.samples >= MAX_SAMPLES) return;
      const sample = Math.max(-32_768, Math.min(32_767, Math.round(Math.max(-1, Math.min(1, value)) * 32_768)));
      this.view.setInt16(this.bytes, sample, true);
      this.bytes += 2;
      this.samples++;
      if (this.bytes === BLOCK_BYTES) this.flush();
    };
    this.port.onmessage = event => {
      if (this.closed || !event.data || typeof event.data !== "object") return;
      const { type, id } = event.data;
      if (type === "start" && Number.isSafeInteger(id) && id > 0) {
        this.id = id;
        this.samples = 0;
        this.bytes = 0;
        this.resampler = new WattzunPcmResampler(sampleRate, this.append);
      } else if (type === "stop" && id === this.id && this.resampler) {
        this.resampler.finish();
        this.flush();
        this.id = null;
        this.resampler = null;
        this.port.postMessage({ type: "stop", id });
      } else if (type === "close") {
        this.closed = true;
        this.id = null;
        this.resampler = null;
        this.bytes = 0;
        this.port.onmessage = null;
      }
    };
  }

  flush() {
    if (!this.bytes) return;
    const samples = this.bytes === BLOCK_BYTES ? this.block.buffer : this.block.buffer.slice(0, this.bytes);
    this.port.postMessage({ type: "data", id: this.id, samples }, [samples]);
    this.block = new Uint8Array(BLOCK_BYTES);
    this.view = new DataView(this.block.buffer);
    this.bytes = 0;
  }

  process(inputs, outputs) {
    for (const channels of outputs) for (const channel of channels) channel.fill(0);
    if (this.closed) return false;
    const channels = inputs[0];
    if (!this.resampler || !channels?.length || this.samples >= MAX_SAMPLES) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let mono = 0;
      for (const channel of channels) mono += channel[frame];
      this.resampler.push(mono / channels.length);
    }
    return true;
  }
}

registerProcessor("wattzun-voice-capture", WattzunVoiceProcessor);
