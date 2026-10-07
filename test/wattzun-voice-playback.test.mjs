import assert from "node:assert/strict";
import test from "node:test";
import { createWattzunPcmPlayback } from "../src/lib/wattzun-voice-playback.ts";
import { createWattzunBrowserVoiceEnvironment, WattzunVoiceCall } from "../src/lib/wattzun-voice-client.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function pcm(values) {
  const bytes = new Uint8Array(values.length * 2);
  const data = new DataView(bytes.buffer);
  values.forEach((value, index) => data.setInt16(index * 2, value, true));
  return bytes;
}
function context() {
  const value = {
    currentTime: 0, state: "running", destination: {}, sources: [], closed: 0, resumed: 0,
    async resume() { this.resumed++; this.state = "running"; },
    async close() { this.closed++; this.state = "closed"; },
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1); assert.equal(sampleRate, 24_000);
      const data = new Float32Array(length);
      return { data, duration: length / sampleRate, copyToChannel(samples, channel) { assert.equal(channel, 0); data.set(samples); } };
    },
    createBufferSource() {
      const source = {
        buffer: null, onended: null, startTime: null, stopped: 0, disconnected: 0,
        connect(destination) { assert.equal(destination, value.destination); },
        start(time) { this.startTime = time; value.sources.push(this); },
        stop() { this.stopped++; }, disconnect() { this.disconnected++; },
        end() { value.currentTime = this.startTime + this.buffer.duration; this.onended?.(); },
      };
      return source;
    },
  };
  return value;
}
function stream() {
  let controller;
  const state = { cancelled: 0 };
  const input = new ReadableStream({ start(value) { controller = value; }, cancel() { state.cancelled++; } });
  return { input, state, controller };
}
function observe(playback) {
  const events = { ended: 0, errors: 0 };
  playback.onEnd = () => { events.ended++; }; playback.onError = () => { events.errors++; };
  return events;
}

test("PCM plays its first 24kHz mono samples before EOF and ends after the last scheduled node", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const values = [-32768, -1, 0, 32767, ...Array(956).fill(1000)];
  const playing = player.play(); audio.controller.enqueue(pcm(values)); await playing;
  assert.equal(audio.input.locked, true, "The network stream remains open while audio starts");
  assert.equal(device.sources.length, 1); assert.equal(device.sources[0].startTime, .02);
  assert.deepEqual([...device.sources[0].buffer.data.subarray(0, 4)], [-1, -1 / 32768, 0, 32767 / 32768]);
  audio.controller.enqueue(pcm(Array(3600).fill(-1000))); await tick();
  assert.equal(device.sources.length, 2);
  assert.equal(device.sources[1].startTime, device.sources[0].startTime + device.sources[0].buffer.duration);
  audio.controller.close(); await tick();
  assert.equal(audio.input.locked, false); assert.equal(events.ended, 0);
  device.sources[0].end(); assert.equal(events.ended, 0);
  device.sources[1].end(); assert.equal(events.ended, 1); assert.equal(events.errors, 0);
  player.close(); assert.equal(device.closed, 0, "Playback never closes the microphone-owned context");
});

test("PCM preserves a signed sample split across network chunks and a short final block", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const values = [0x1234, -32768, 32767, ...Array(958).fill(-2048)], bytes = pcm(values);
  const playing = player.play();
  audio.controller.enqueue(bytes.subarray(0, 1)); audio.controller.enqueue(bytes.subarray(1, 1801)); audio.controller.enqueue(bytes.subarray(1801));
  await playing; assert.equal(device.sources.length, 1);
  audio.controller.close(); await tick(); assert.equal(device.sources.length, 2);
  assert.deepEqual(device.sources.flatMap(source => [...source.buffer.data]), values.map(value => value / 32768));
  device.sources.forEach(source => source.end()); assert.equal(events.ended, 1); player.close();
});

test("a reply shorter than the startup window plays after clean EOF and waits for its source to finish", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm([1, -1])); audio.controller.close(); await playing; await tick();
  assert.equal(device.sources[0].buffer.data.length, 2); assert.equal(events.ended, 0);
  device.sources[0].end(); assert.equal(events.ended, 1); player.close();
});

test("empty and odd-byte PCM reject startup without announcing successful playback", async () => {
  for (const [bytes, message] of [[new Uint8Array(), /no audio/], [new Uint8Array([1]), /incomplete sample/]]) {
    const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
    const rejected = assert.rejects(player.play(), message); audio.controller.enqueue(bytes); audio.controller.close(); await rejected; await tick();
    assert.equal(device.sources.length, 0); assert.deepEqual(events, { ended: 0, errors: 0 }); assert.equal(audio.input.locked, false); player.close();
  }
});

test("truncated PCM after startup stops scheduled audio and reports one later playback error", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm(Array(960).fill(1))); await playing;
  const lateEnd = device.sources[0].onended;
  audio.controller.enqueue(new Uint8Array([255])); audio.controller.close(); await tick();
  assert.deepEqual(events, { ended: 0, errors: 1 }); assert.equal(device.sources[0].stopped, 1);
  lateEnd(); player.close(); player.close(); assert.deepEqual(events, { ended: 0, errors: 1 }); assert.equal(device.closed, 0);
});

test("stream failures reject before startup without reporting playback", async () => {
  const earlyAudio = stream(), early = createWattzunPcmPlayback(context(), earlyAudio.input), earlyEvents = observe(early);
  const rejected = assert.rejects(early.play(), /network failed/); earlyAudio.controller.error(new Error("network failed")); await rejected;
  assert.deepEqual(earlyEvents, { ended: 0, errors: 0 }); early.close();
});

test("a late network failure drains scheduled and buffered complete samples before one error", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm(Array(960).fill(1))); await playing;
  const buffered = [1234, -4321, ...Array(398).fill(1000)];
  audio.controller.enqueue(pcm(buffered)); audio.controller.enqueue(new Uint8Array([255])); await tick();
  assert.equal(device.sources.length, 1, "The short final block has not yet been scheduled");
  audio.controller.error(new Error("network failed")); await tick();
  assert.equal(device.sources.length, 2); assert.deepEqual(events, { ended: 0, errors: 0 });
  assert.deepEqual([...device.sources[1].buffer.data], buffered.map(value => value / 32768));
  assert.ok(device.sources.every(source => source.stopped === 0)); assert.equal(audio.input.locked, false);
  const lateEnds = device.sources.map(source => source.onended);
  device.sources[0].end(); assert.deepEqual(events, { ended: 0, errors: 0 });
  device.sources[1].end(); assert.deepEqual(events, { ended: 0, errors: 1 });
  lateEnds.forEach(end => end()); player.close(); player.close();
  assert.deepEqual(events, { ended: 0, errors: 1 }); assert.equal(device.closed, 0);
});

test("closing while a failed stream drains stops audio immediately and ignores late ends", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm(Array(6000).fill(1))); await playing; await tick();
  audio.controller.error(new Error("network failed")); await tick();
  assert.equal(device.sources.length, 3); assert.deepEqual(events, { ended: 0, errors: 0 });
  const lateEnds = device.sources.map(source => source.onended);
  player.close(); player.close(); await tick();
  assert.ok(device.sources.every(source => source.stopped === 1 && source.disconnected === 1));
  lateEnds.forEach(end => end()); assert.deepEqual(events, { ended: 0, errors: 0 }); assert.equal(device.closed, 0);
});

test("the two-megabyte limit is cumulative and cancels a live reply before decoding excess bytes", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm(Array(960).fill(1))); await playing;
  audio.controller.enqueue(new Uint8Array(2_000_000 - 1920 + 1)); await tick();
  assert.deepEqual(events, { ended: 0, errors: 1 }); assert.equal(device.sources.length, 1, "Excess data creates no extra buffers");
  assert.equal(device.sources[0].stopped, 1); assert.equal(audio.state.cancelled, 1); player.close();
  const oversized = stream(), neverStarted = createWattzunPcmPlayback(context(), oversized.input);
  const rejected = assert.rejects(neverStarted.play(), /too large/); oversized.controller.enqueue(new Uint8Array(2_000_001)); await rejected; neverStarted.close();
});

test("closing pending startup cancels its reader once and rejects play without late events", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(), rejected = assert.rejects(playing, { name: "AbortError" }); await tick();
  assert.equal(audio.input.locked, true); player.close(); player.close(); await rejected; await tick();
  assert.equal(player.play(), playing); assert.equal(audio.state.cancelled, 1); assert.equal(audio.input.locked, false);
  assert.deepEqual(events, { ended: 0, errors: 0 }); assert.equal(device.closed, 0);
});

test("closing a playing stream cancels pending network reads and scheduled nodes without late events", async () => {
  const device = context(), audio = stream(), player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const playing = player.play(); audio.controller.enqueue(pcm(Array(6000).fill(1))); await playing; await tick();
  const lateEnds = device.sources.map(source => source.onended); player.close(); player.close(); await tick();
  assert.equal(audio.state.cancelled, 1); assert.equal(audio.input.locked, false);
  assert.ok(device.sources.every(source => source.stopped === 1 && source.disconnected === 1));
  lateEnds.forEach(end => end()); assert.deepEqual(events, { ended: 0, errors: 0 }); assert.equal(device.closed, 0);
});

test("closing during context resume prevents a late start and never closes the shared context", async () => {
  const device = context(), resumed = deferred(), audio = stream(); device.state = "suspended"; device.resume = () => resumed.promise;
  const player = createWattzunPcmPlayback(device, audio.input), events = observe(player);
  const rejected = assert.rejects(player.play(), { name: "AbortError" }); player.close(); await rejected;
  resumed.resolve(); await tick(); assert.equal(device.sources.length, 0); assert.equal(audio.state.cancelled, 1); assert.equal(device.closed, 0);
  assert.deepEqual(events, { ended: 0, errors: 0 });
});

function globals(values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } };
}
function microphoneContext() {
  const device = context(); device.state = "suspended";
  device.audioWorklet = { async addModule(url) { assert.equal(url, '/wattzun-voice-worklet.js?capture=2'); } };
  device.createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  device.createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData(samples) { samples.fill(0); }, disconnect() {} });
  return device;
}
const media = () => ({ getTracks: () => [{ enabled: true, stop() {} }] });
class CaptureNode {
  constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
  connect() {} disconnect() {}
}

test("the call greeting streams through its resumed microphone context before EOF and starts capture only after audio ends", async () => {
  const device = microphoneContext(), audio = stream(), commands = [], timers = new Set(), statuses = [];
  const restore = globals({
    AudioContext: class { constructor() { return device; } },
    AudioWorkletNode: class extends CaptureNode { constructor() { super(); this.port.postMessage = command => commands.push(command); } },
    navigator: { mediaDevices: { getUserMedia: async () => media() } },
    window: { setInterval(callback) { timers.add(callback); return callback; }, clearInterval(callback) { timers.delete(callback); } },
  });
  const call = new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(), {
    greeting: async () => ({ mimeType: "audio/pcm", stream: audio.input }),
    status: value => statuses.push(value.state),
    submit: async () => { throw new Error("Greeting must never submit a user turn"); },
    reply: () => { throw new Error("Greeting must never create a chat reply"); },
  });
  try {
    const started = call.start(); await tick(); assert.equal(statuses.at(-1), "connecting"); assert.equal(device.resumed, 1);
    assert.equal(commands.length, 0); audio.controller.enqueue(pcm(Array(960).fill(1000))); await started;
    assert.equal(statuses.at(-1), "speaking"); assert.equal(audio.input.locked, true); assert.equal(device.sources.length, 1);
    assert.equal(commands.length, 0, "No worklet recording overlaps the greeting");
    audio.controller.close(); await tick(); assert.equal(statuses.at(-1), "speaking"); device.sources[0].end();
    assert.equal(statuses.at(-1), "listening"); assert.deepEqual(commands, [{ type: "start", id: 1, preRoll: true }]); assert.equal(device.closed, 0);
    call.hangUp(); assert.equal(device.closed, 1); assert.equal(timers.size, 0);
  } finally { call.dispose(); restore(); }
});

test("a call keeps speaking through a late audio stream failure then quietly resumes the same microphone", async () => {
  const device = microphoneContext(), audio = stream(), commands = [], timers = new Set(), statuses = [], browserSpeech = [];
  const restore = globals({
    AudioContext: class { constructor() { return device; } },
    AudioWorkletNode: class extends CaptureNode { constructor() { super(); this.port.postMessage = command => commands.push(command); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    navigator: { mediaDevices: { getUserMedia: async () => media() } },
    window: {
      setInterval(callback) { timers.add(callback); return callback; }, clearInterval(callback) { timers.delete(callback); },
      speechSynthesis: { getVoices: () => [], speak(utterance) { browserSpeech.push(utterance); }, cancel() {} },
    },
  });
  const call = new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(), {
    greeting: async () => ({ mimeType: "audio/pcm", stream: audio.input }),
    status: value => statuses.push(value),
    submit: async () => { throw new Error("Greeting must never submit a user turn"); },
    reply: () => { throw new Error("Greeting must never create a chat reply"); },
  });
  try {
    const started = call.start(); await tick();
    audio.controller.enqueue(pcm(Array(1000).fill(1000))); await started;
    assert.equal(statuses.at(-1).state, "speaking"); assert.equal(commands.length, 0);
    audio.controller.error(new Error("network failed")); await tick();
    assert.equal(device.sources.length, 2); assert.equal(statuses.at(-1).state, "speaking");
    assert.equal(commands.length, 0); assert.equal(browserSpeech.length, 0);
    device.sources[0].end(); assert.equal(statuses.at(-1).state, "speaking");
    device.sources[1].end();
    assert.equal(statuses.at(-1).state, "listening"); assert.equal(statuses.at(-1).message, "Speak, then pause. Wattzun will reply.");
    assert.deepEqual(commands, [{ type: "start", id: 1, preRoll: true }]); assert.equal(browserSpeech.length, 0); assert.equal(device.closed, 0);
    call.hangUp(); assert.equal(device.closed, 1); assert.equal(timers.size, 0);
  } finally { call.dispose(); restore(); }
});

test("browser PCM playback reuses the microphone context resumed during Call and leaves ownership with the microphone", async () => {
  const devices = [];
  const restore = globals({
    AudioContext: class { constructor() { const device = microphoneContext(); devices.push(device); return device; } },
    AudioWorkletNode: CaptureNode,
    navigator: { mediaDevices: { getUserMedia: async () => media() } },
  });
  try {
    const environment = createWattzunBrowserVoiceEnvironment(), microphone = await environment.microphone();
    assert.equal(devices.length, 1); assert.equal(devices[0].resumed, 1);
    const audio = stream(), player = environment.playback({ mimeType: "audio/pcm", stream: audio.input });
    const playing = player.play(); audio.controller.enqueue(pcm(Array(960).fill(1))); await playing;
    assert.equal(devices.length, 1); assert.equal(devices[0].sources.length, 1); assert.equal(devices[0].resumed, 1);
    player.close(); await tick(); assert.equal(devices[0].closed, 0); microphone.close(); assert.equal(devices[0].closed, 1);
  } finally { restore(); }
});

test("a late microphone permission grant cannot replace the newer call's playback context", async () => {
  const devices = [], permissions = [deferred(), deferred()]; let requested = 0;
  const restore = globals({
    AudioContext: class { constructor() { const device = microphoneContext(); devices.push(device); return device; } },
    AudioWorkletNode: CaptureNode,
    navigator: { mediaDevices: { getUserMedia: () => permissions[requested++].promise } },
  });
  try {
    const environment = createWattzunBrowserVoiceEnvironment(), earlier = environment.microphone(), later = environment.microphone();
    permissions[1].resolve(media()); const current = await later;
    permissions[0].resolve(media()); const stale = await earlier; stale.close();
    const audio = stream(), player = environment.playback({ mimeType: "audio/pcm", stream: audio.input });
    const playing = player.play(); audio.controller.enqueue(pcm(Array(960).fill(1))); await playing;
    assert.equal(devices[0].sources.length, 0); assert.equal(devices[1].sources.length, 1); player.close(); current.close();
  } finally { restore(); }
});

test("legacy MP3 playback remains supported and closes idempotently without late events", async () => {
  const audios = [], revoked = [];
  const restore = globals({ Audio: class { constructor(url) { this.url = url; this.onended = null; this.onerror = null; this.paused = 0; audios.push(this); } play() { return Promise.resolve(); } pause() { this.paused++; } removeAttribute() {} load() {} } });
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:synthetic-wattzun"; URL.revokeObjectURL = value => revoked.push(value);
  try {
    const player = createWattzunBrowserVoiceEnvironment().playback({ mimeType: "audio/mpeg", base64: "AA==" }), events = observe(player);
    await player.play(); const lateEnd = audios[0].onended, lateError = audios[0].onerror;
    player.close(); player.close(); lateEnd(); lateError();
    assert.equal(audios[0].paused, 1); assert.deepEqual(revoked, ["blob:synthetic-wattzun"]); assert.deepEqual(events, { ended: 0, errors: 0 });
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; restore(); }
});
