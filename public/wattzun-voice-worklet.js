/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { WattzunPcmResampler } from "./wattzun-pcm-resampler.js";

const BLOCK_BYTES = 4_800;
const MAX_SAMPLES = 45 * 24_000;
const PRE_ROLL_SAMPLES = 24_000;

class WattzunVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.closed = false;
    this.id = null;
    this.resampler = null;
    this.samples = 0;
    this.bytes = 0;
    this.speechConfirmed = false;
    this.preRollEnabled = false;
    this.preRoll = new Int16Array(PRE_ROLL_SAMPLES);
    this.preRollHead = 0;
    this.preRollCount = 0;
    this.block = new Uint8Array(BLOCK_BYTES);
    this.view = new DataView(this.block.buffer);
    this.append = value => {
      const sample = Math.max(-32_768, Math.min(32_767, Math.round(Math.max(-1, Math.min(1, value)) * 32_768)));
      if (!this.speechConfirmed) {
        this.preRoll[this.preRollHead] = sample;
        this.preRollHead = (this.preRollHead + 1) % PRE_ROLL_SAMPLES;
        this.preRollCount = Math.min(PRE_ROLL_SAMPLES, this.preRollCount + 1);
      } else this.writeSample(sample);
    };
    this.port.onmessage = event => {
      if (this.closed || !event.data || typeof event.data !== "object") return;
      const { type, id } = event.data;
      if (type === "start" && Number.isSafeInteger(id) && id > 0) {
        this.id = id;
        this.samples = 0;
        this.bytes = 0;
        // Already-loaded clients may fetch this processor after a deployment.
        // Only the versioned capture client opts into the new stop protocol.
        this.preRollEnabled = event.data.preRoll === true;
        this.speechConfirmed = !this.preRollEnabled;
        this.preRollHead = 0;
        this.preRollCount = 0;
        this.resampler = new WattzunPcmResampler(sampleRate, this.append);
      } else if (type === "speech" && id === this.id && this.resampler && !this.speechConfirmed) {
        this.speechConfirmed = true;
        const first = (this.preRollHead - this.preRollCount + PRE_ROLL_SAMPLES) % PRE_ROLL_SAMPLES;
        for (let index = 0; index < this.preRollCount; index++) this.writeSample(this.preRoll[(first + index) % PRE_ROLL_SAMPLES]);
        this.preRollCount = 0;
      } else if (type === "stop" && id === this.id && this.resampler) {
        this.finish();
      } else if (type === "close") {
        this.closed = true;
        this.id = null;
        this.resampler = null;
        this.bytes = 0;
        this.preRollCount = 0;
        this.port.onmessage = null;
      }
    };
  }

  writeSample(sample) {
    if (this.samples >= MAX_SAMPLES) return;
    this.view.setInt16(this.bytes, sample, true);
    this.bytes += 2;
    this.samples++;
    if (this.bytes === BLOCK_BYTES) this.flush();
  }

  finish(reason) {
    const id = this.id;
    this.resampler.finish();
    this.flush();
    this.id = null;
    this.resampler = null;
    this.preRollCount = 0;
    this.port.postMessage({ type: "stop", id, ...(reason ? { reason } : {}) });
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
    if (this.preRollEnabled && this.samples === MAX_SAMPLES) this.finish("limit");
    return true;
  }
}

registerProcessor("wattzun-voice-capture", WattzunVoiceProcessor);
