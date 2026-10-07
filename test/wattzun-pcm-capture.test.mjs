import assert from "node:assert/strict";
import test from "node:test";
import { createWattzunPcmCapture, encodeWattzunPcmWav } from "../src/lib/wattzun-pcm-capture.ts";
import { createWattzunBrowserVoiceEnvironment } from "../src/lib/wattzun-voice-client.ts";
import { WattzunPcmResampler } from "../public/wattzun-pcm-resampler.js";

function pcm(values) {
  const result = new ArrayBuffer(values.length * 2), data = new DataView(result);
  values.forEach((value, index) => data.setInt16(index * 2, value, true));
  return result;
}
function globals(values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
}
async function fixture(options = {}) {
  const state = { messages: [], portClosed: 0, sourceDisconnected: 0, nodeDisconnected: 0, contextClosed: 0, nodes: [], modules: [] };
  const context = { destination: {}, audioWorklet: { async addModule(url) { state.modules.push(url); if (options.moduleError) throw new Error("module unavailable"); } }, close() { state.contextClosed++; } };
  const source = { connect(node) { assert.equal(node, state.nodes[0]); }, disconnect(node) { assert.equal(node, state.nodes[0]); state.sourceDisconnected++; } };
  const restore = globals({ AudioWorkletNode: class {
    constructor(actual, name, config) {
      assert.equal(actual, context); assert.equal(name, "wattzun-voice-capture");
      assert.equal(config.channelCount, 1); assert.equal(config.channelCountMode, "explicit");
      this.port = { onmessage: null, postMessage(message) { state.messages.push(message); }, close() { state.portClosed++; } };
      this.onprocessorerror = null; state.nodes.push(this);
    }
    connect(destination) { assert.equal(destination, context.destination); if (options.connectError) throw new Error("output failed"); }
    disconnect() { state.nodeDisconnected++; }
  } });
  try {
    const capture = await createWattzunPcmCapture(context, source), node = state.nodes[0];
    return { capture, node, state, restore, message: data => node.port.onmessage?.({ data }) };
  } catch (error) { restore(); throw Object.assign(error, { state }); }
}
function observer(recorder) {
  const events = { data: [], stopped: 0, errors: 0 };
  recorder.onData = value => events.data.push(value); recorder.onStop = () => events.stopped++; recorder.onError = () => events.errors++;
  return events;
}

test("WAV header describes 24kHz signed 16-bit mono and preserves little-endian PCM in order", async () => {
  const wav = encodeWattzunPcmWav([pcm([-32768, -1]), pcm([0, 32767])]);
  assert.equal(wav.type, "audio/wav"); assert.equal(wav.size, 52);
  const bytes = await wav.arrayBuffer(), data = new DataView(bytes), label = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  assert.equal(label(0), "RIFF"); assert.equal(data.getUint32(4, true), 44); assert.equal(label(8), "WAVE"); assert.equal(label(12), "fmt ");
  assert.equal(data.getUint32(16, true), 16); assert.equal(data.getUint16(20, true), 1); assert.equal(data.getUint16(22, true), 1);
  assert.equal(data.getUint32(24, true), 24000); assert.equal(data.getUint32(28, true), 48000); assert.equal(data.getUint16(32, true), 2);
  assert.equal(data.getUint16(34, true), 16); assert.equal(label(36), "data"); assert.equal(data.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map(index => data.getInt16(44 + index * 2, true)), [-32768, -1, 0, 32767]);
});
test("WAV encoding permits exactly 45 seconds and rejects empty, odd or excessive sample bytes", () => {
  assert.equal(encodeWattzunPcmWav([new ArrayBuffer(45 * 24000 * 2)]).size, 2160044);
  for (const chunks of [[], [new ArrayBuffer(0)], [new ArrayBuffer(1)], [new Uint8Array(2)], [new ArrayBuffer(2160002)]]) assert.throws(() => encodeWattzunPcmWav(chunks));
});
test("capture waits for FIFO stop acknowledgement, emits one WAV and starts another independent turn", async () => {
  const h = await fixture();
  try {
    const recorder = h.capture.recorder(), events = observer(recorder); recorder.start(); recorder.start();
    assert.deepEqual(h.state.modules, ["/wattzun-voice-worklet.js"]); assert.deepEqual(h.state.messages, [{ type: "start", id: 1 }]);
    h.message({ type: "data", id: 1, samples: pcm([100, -100]) }); recorder.stop(); recorder.stop();
    assert.equal(events.data.length, 0); assert.equal(events.stopped, 0);
    h.message({ type: "data", id: 1, samples: pcm([200]) }); h.message({ type: "stop", id: 1 });
    assert.equal(events.data.length, 1); assert.equal(events.stopped, 1); assert.equal(events.errors, 0);
    const data = new DataView(await events.data[0].arrayBuffer()); assert.equal(data.getUint32(40, true), 6);
    assert.deepEqual([0, 1, 2].map(index => data.getInt16(44 + index * 2, true)), [100, -100, 200]);
    const next = h.capture.recorder(), nextEvents = observer(next); next.start(); next.stop(); h.message({ type: "stop", id: 2 });
    assert.deepEqual(nextEvents, { data: [], stopped: 1, errors: 0 });
  } finally { h.capture.close(); h.restore(); }
});
test("replacing a stopped turn discards its late data and does not stop the new recorder", async () => {
  const h = await fixture();
  try {
    const prior = h.capture.recorder(), priorEvents = observer(prior); prior.start(); h.message({ type: "data", id: 1, samples: pcm([11]) }); prior.stop();
    const next = h.capture.recorder(), events = observer(next); next.start(); prior.stop();
    h.message({ type: "data", id: 1, samples: pcm([99]) }); h.message({ type: "stop", id: 1 });
    h.message({ type: "data", id: 2, samples: pcm([22]) }); next.stop(); h.message({ type: "stop", id: 2 });
    assert.deepEqual(priorEvents, { data: [], stopped: 0, errors: 0 }); assert.equal(events.stopped, 1); assert.equal(events.errors, 0);
    assert.equal(new DataView(await events.data[0].arrayBuffer()).getInt16(44, true), 22);
    assert.deepEqual(h.state.messages, [{ type: "start", id: 1 }, { type: "stop", id: 1 }, { type: "start", id: 2 }, { type: "stop", id: 2 }]);
  } finally { h.capture.close(); h.restore(); }
});
test("only one active turn can record and a closed capture cannot start another", async () => {
  const h = await fixture();
  try {
    h.capture.recorder().start(); const other = h.capture.recorder(); assert.throws(() => other.start(), /already active/);
    h.capture.close(); assert.throws(() => other.start(), /unavailable/);
  } finally { h.capture.close(); h.restore(); }
});
test("hang-up releases the worklet once without closing its microphone-owned context or emitting late callbacks", async () => {
  const h = await fixture();
  try {
    const recorder = h.capture.recorder(), events = observer(recorder); recorder.start(); h.message({ type: "data", id: 1, samples: pcm([1]) }); recorder.stop();
    const lateMessage = h.node.port.onmessage, lateError = h.node.onprocessorerror; h.capture.close(); h.capture.close();
    lateMessage({ data: { type: "stop", id: 1 } }); lateError(); recorder.stop();
    assert.deepEqual(events, { data: [], stopped: 0, errors: 0 }); assert.equal(h.state.portClosed, 1); assert.equal(h.state.sourceDisconnected, 1);
    assert.equal(h.state.nodeDisconnected, 1); assert.equal(h.state.contextClosed, 0); assert.equal(h.node.port.onmessage, null);
  } finally { h.restore(); }
});
test("malformed PCM, unsolicited stop and processor failure fail closed once without submitting buffered speech", async () => {
  for (const invalid of [new ArrayBuffer(0), new ArrayBuffer(1), new ArrayBuffer(4802), new Uint8Array(2), "unsolicited-stop", "processor-error"]) {
    const h = await fixture();
    try {
      const recorder = h.capture.recorder(), events = observer(recorder); recorder.start(); h.message({ type: "data", id: 1, samples: pcm([1]) });
      const lateMessage = h.node.port.onmessage, lateError = h.node.onprocessorerror;
      if (invalid === "processor-error") lateError(); else h.message({ type: invalid === "unsolicited-stop" ? "stop" : "data", id: 1, samples: invalid });
      lateError(); lateMessage({ data: { type: "stop", id: 1 } });
      assert.deepEqual(events, { data: [], stopped: 0, errors: 1 }); assert.equal(h.state.portClosed, 1); assert.throws(() => h.capture.recorder().start(), /unavailable/);
      h.capture.close(); assert.equal(h.state.portClosed, 1);
    } finally { h.restore(); }
  }
});
test("capture hard bounds accumulated data at 45 seconds including WAV framing", async () => {
  const h = await fixture();
  try {
    const recorder = h.capture.recorder(), events = observer(recorder); recorder.start();
    for (let index = 0; index < 450; index++) h.message({ type: "data", id: 1, samples: new ArrayBuffer(4800) });
    assert.equal(events.errors, 0); h.message({ type: "data", id: 1, samples: pcm([1]) });
    assert.deepEqual(events, { data: [], stopped: 0, errors: 1 });
  } finally { h.capture.close(); h.restore(); }
});
test("failed module or graph setup releases its edges and never closes the shared context", async () => {
  await assert.rejects(fixture({ moduleError: true }), error => error.message === "module unavailable" && error.state.nodes.length === 0 && error.state.contextClosed === 0);
  await assert.rejects(fixture({ connectError: true }), error => error.message === "output failed" && error.state.portClosed === 1 && error.state.sourceDisconnected === 1 && error.state.contextClosed === 0);
  const restore = globals({ AudioWorkletNode: undefined });
  try { await assert.rejects(createWattzunPcmCapture({}, {}), { name: "NotSupportedError" }); } finally { restore(); }
});
test("browser capability checks fail before requesting microphone permission on an unsupported browser", async () => {
  let requested = 0;
  const restore = globals({ AudioWorkletNode: undefined, AudioContext: class {}, navigator: { mediaDevices: { async getUserMedia() { requested++; } } } });
  try {
    await assert.rejects(createWattzunBrowserVoiceEnvironment().microphone(), /modern browser.*AudioWorklet/);
    assert.equal(requested, 0);
  } finally { restore(); }
});
test("browser capture startup failures stop granted tracks and close the microphone-owned context", async () => {
  for (const failure of ["permission", "worklet"]) {
    const state = { stopped: 0, closed: 0, resumed: 0 };
    const restore = globals({
      AudioWorkletNode: class {},
      AudioContext: class {
        constructor() { this.audioWorklet = { async addModule() { throw new Error("module unavailable"); } }; }
        async resume() { state.resumed++; }
        async close() { state.closed++; }
        createMediaStreamSource() { return { connect() {} }; }
        createAnalyser() { return {}; }
      },
      navigator: { mediaDevices: { async getUserMedia() {
        if (failure === "permission") throw new DOMException("Denied", "NotAllowedError");
        return { getTracks: () => [{ stop() { state.stopped++; } }] };
      } } },
    });
    try {
      await assert.rejects(createWattzunBrowserVoiceEnvironment().microphone(), error => {
        assert.equal(error.name, "WattzunVoiceStartupError");
        assert.equal(error.reason, failure === "permission" ? "microphone" : "capture");
        assert.match(error.message, failure === "permission" ? /browser or device blocked microphone access/ : /Voice capture could not start/);
        return true;
      });
      assert.equal(state.closed, 1); assert.equal(state.stopped, failure === "permission" ? 0 : 1); assert.equal(state.resumed, 1, "Call audio unlocks before permission resolves");
    } finally { restore(); }
  }
});

function resample(input, inputRate, blockSize = input.length) {
  const result = [], resampler = new WattzunPcmResampler(inputRate, value => result.push(value));
  for (let offset = 0; offset < input.length; offset += blockSize) for (const sample of input.subarray(offset, offset + blockSize)) resampler.push(sample);
  resampler.finish(); resampler.finish(); return result;
}
const sine = (rate, frequency, seconds = 1) => Float32Array.from({ length: rate * seconds }, (_, index) => .6 * Math.sin(2 * Math.PI * frequency * index / rate));
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
test("resampling retains phase over render blocks and one second becomes exactly 24000 samples at device rates", () => {
  for (const rate of [8000, 16000, 24000, 44100, 48000, 96000, 192000]) {
    const input = sine(rate, 440), whole = resample(input, rate), blocks = resample(input, rate, 128);
    assert.equal(whole.length, 24000, String(rate)); assert.deepEqual(blocks, whole);
    assert.ok(rms(whole.slice(100)) > .35 && rms(whole.slice(100)) < .45, "Speech-band signal survives resampling");
    assert.ok(whole.every(Number.isFinite));
  }
});
test("downsampling attenuates frequencies above the output Nyquist limit instead of aliasing them into speech", () => {
  const speech = resample(sine(48000, 1000), 48000), high = resample(sine(48000, 18000), 48000);
  assert.ok(rms(speech.slice(100)) > .4); assert.ok(rms(high.slice(100)) < .015);
});
test("same-rate PCM retains exact samples and invalid sample rates or non-finite input fail", () => {
  const input = new Float32Array([-1, -.5, 0, .5, 1]); assert.deepEqual(resample(input, 24000), [...input]);
  for (const rate of [0, 7999, 192001, NaN, Infinity]) assert.throws(() => new WattzunPcmResampler(rate, () => {}));
  const sampler = new WattzunPcmResampler(24000, () => {}); assert.throws(() => sampler.push(NaN)); sampler.finish(); assert.throws(() => sampler.push(1));
});

let workletSequence = 0;
async function workletFixture(rate = 24000) {
  let Processor;
  const restore = globals({ sampleRate: rate, AudioWorkletProcessor: class {
    constructor() { this.messages = []; this.port = { onmessage: null, postMessage: (message, transfer) => { if (message.type === "data") assert.equal(transfer[0], message.samples); this.messages.push(message); } }; }
  }, registerProcessor(name, processor) { assert.equal(name, "wattzun-voice-capture"); Processor = processor; } });
  try {
    await import(`../public/wattzun-voice-worklet.js?fixture=${++workletSequence}`);
    const processor = new Processor(); return { processor, restore, command: data => processor.port.onmessage?.({ data }) };
  } catch (error) { restore(); throw error; }
}
function samplesFrom(messages) { return messages.filter(message => message.type === "data").flatMap(message => { const data = new DataView(message.samples); return Array.from({ length: data.byteLength / 2 }, (_, index) => data.getInt16(index * 2, true)); }); }
test("the actual worklet mixes mono, clips signed PCM and silences output before sending data then stop", async () => {
  const h = await workletFixture();
  try {
    const output = new Float32Array([1, 1, 1, 1, 1]); h.processor.process([[new Float32Array(5)]], [[output]]);
    assert.deepEqual([...output], [0, 0, 0, 0, 0]); assert.equal(h.processor.messages.length, 0);
    h.command({ type: "start", id: 1 }); h.processor.process([[new Float32Array([-2, -1, 0, .5, 2]), new Float32Array([-2, 1, 0, .5, 2])]], [[output]]);
    h.command({ type: "stop", id: 999 }); assert.equal(h.processor.messages.length, 0); h.command({ type: "stop", id: 1 });
    assert.deepEqual(samplesFrom(h.processor.messages), [-32768, 0, 0, 16384, 32767]);
    assert.deepEqual(h.processor.messages.map(message => [message.type, message.id]), [["data", 1], ["stop", 1]]);
    assert.deepEqual([...output], [0, 0, 0, 0, 0]); h.command({ type: "close" }); assert.equal(h.processor.process([], [[output]]), false);
  } finally { h.restore(); }
});
test("the worklet flushes bounded 100ms blocks and a partial tail with a fresh phase per turn", async () => {
  const h = await workletFixture(48000);
  try {
    const input = sine(48000, 440, .25); h.command({ type: "start", id: 1 });
    for (let index = 0; index < input.length; index += 128) h.processor.process([[input.subarray(index, index + 128)]], [[new Float32Array(128)]]);
    assert.deepEqual(h.processor.messages.map(message => message.samples.byteLength), [4800, 4800]); h.command({ type: "stop", id: 1 });
    const first = samplesFrom(h.processor.messages); assert.equal(first.length, 6000);
    assert.deepEqual(h.processor.messages.filter(message => message.type === "data").map(message => message.samples.byteLength), [4800, 4800, 2400]);
    h.processor.messages = []; h.command({ type: "start", id: 2 }); h.processor.process([[input]], [[new Float32Array(input.length)]]); h.command({ type: "stop", id: 2 });
    assert.deepEqual(samplesFrom(h.processor.messages), first); assert.ok(h.processor.messages.every(message => message.id === 2));
  } finally { h.restore(); }
});
test("worklet caps a long turn at exactly 45 seconds and close discards an unfinished tail", async () => {
  const h = await workletFixture();
  try {
    h.command({ type: "start", id: 1 }); const block = new Float32Array(24000).fill(.25);
    for (let second = 0; second < 46; second++) h.processor.process([[block]], [[new Float32Array(24000)]]);
    h.command({ type: "stop", id: 1 }); assert.equal(samplesFrom(h.processor.messages).length, 45 * 24000);
    assert.equal(h.processor.messages.filter(message => message.type === "data").length, 450);
    h.processor.messages = []; h.command({ type: "start", id: 2 }); h.processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
    h.command({ type: "close" }); assert.equal(h.processor.messages.length, 0); assert.equal(h.processor.port.onmessage, null);
  } finally { h.restore(); }
});
