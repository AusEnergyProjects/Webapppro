import assert from "node:assert/strict";
import test from "node:test";
import { createWattzunBrowserVoiceEnvironment, WattzunVoiceCall, WattzunVoiceStartupError } from "../src/lib/wattzun-voice-client.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function replaceGlobals(values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

// Browser ports model startup, failure provenance and ownership. These fixtures
// cannot establish microphone permission or playback on a physical Android phone.
function browser(options = {}) {
  const state = { events: [], contexts: [], requested: 0, stopped: 0, timers: new Set(), utterances: 0, spoken: 0, cancelledSpeech: 0 };
  const track = { enabled: true, stop() { state.stopped++; } };
  const stream = { getTracks: () => [track] };
  class Context {
    constructor() {
      state.events.push("context");
      if (options.contextError) throw options.contextError;
      this.closed = 0;
      this.resumed = 0;
      this.state = "suspended";
      this.destination = {};
      this.audioWorklet = { addModule: async url => {
        state.events.push("worklet");
        assert.equal(url, "/wattzun-voice-worklet.js");
        if (options.workletError) throw options.workletError;
      } };
      state.contexts.push(this);
    }
    resume() {
      state.events.push("resume"); this.resumed++;
      if (options.resumeThrow) throw options.resumeThrow;
      return (options.resume?.promise || (options.resumeError ? Promise.reject(options.resumeError) : Promise.resolve())).then(() => { this.state = "running"; });
    }
    async close() { this.closed++; this.state = "closed"; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(samples) { samples.fill(0); }, disconnect() {} }; }
  }
  class CaptureNode {
    constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
    connect() {}
    disconnect() {}
  }
  const restore = replaceGlobals({
    document: options.page ?? { permissionsPolicy: { allowsFeature: () => true } },
    navigator: {
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
      mediaDevices: { getUserMedia(constraints) {
        state.events.push("microphone"); state.requested++;
        assert.equal(constraints.video, false); assert.equal(constraints.audio.echoCancellation, true);
        return options.permission?.promise || (options.microphoneError ? Promise.reject(options.microphoneError) : Promise.resolve(stream));
      } },
    },
    AudioContext: Context,
    AudioWorkletNode: CaptureNode,
    window: {
      setInterval(callback) { state.timers.add(callback); return callback; },
      clearInterval(callback) { state.timers.delete(callback); },
      speechSynthesis: { speak() { state.spoken++; }, cancel() { state.cancelledSpeech++; } },
    },
    SpeechSynthesisUtterance: class { constructor() { state.utterances++; } },
  });
  return { state, stream, track, restore, environment: createWattzunBrowserVoiceEnvironment() };
}

test("explicit document microphone policy denial reports reload without requesting the device", async () => {
  for (const policyName of ["permissionsPolicy", "featurePolicy"]) {
    const features = [], b = browser({ page: { [policyName]: { allowsFeature(feature) { features.push(feature); return false; } } } });
    try {
      await assert.rejects(b.environment.microphone(), error => {
        assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "policy");
        assert.match(error.message, /Reload TLink/); assert.doesNotMatch(error.message, /permission was denied/i); return true;
      });
      assert.deepEqual(features, ["microphone"]); assert.equal(b.state.requested, 0); assert.equal(b.state.contexts.length, 0);
      const statuses = [], call = new WattzunVoiceCall(b.environment, { status: value => statuses.push(value), submit: async () => { throw new Error("unexpected submit"); }, reply() {} });
      await call.start(); assert.equal(statuses.at(-1).state, "error"); assert.equal(statuses.at(-1).recovery, "reload");
      assert.equal(b.state.timers.size, 0); call.dispose();
    } finally { b.restore(); }
  }
});

test("audio resume and microphone request start on the same click stack before a permission result", async () => {
  const permission = deferred(), resume = deferred(), b = browser({ permission, resume });
  try {
    const opened = b.environment.microphone();
    assert.deepEqual(b.state.events, ["context", "resume", "microphone"]);
    assert.equal(b.state.requested, 1); assert.equal(b.state.contexts[0].resumed, 1);
    permission.resolve(b.stream); await tick(); assert.equal(b.state.events.includes("worklet"), false);
    resume.resolve(); const microphone = await opened; assert.equal(b.state.events.at(-1), "worklet");
    microphone.mute(true); assert.equal(b.track.enabled, false); microphone.mute(false); assert.equal(b.track.enabled, true);
    microphone.close(); microphone.close(); assert.equal(b.state.stopped, 1); assert.equal(b.state.contexts[0].closed, 1);
  } finally { b.restore(); }
});

test("absent or unreadable policy information does not manufacture a microphone denial", async () => {
  for (const page of [{}, { permissionsPolicy: { allowsFeature() { throw new Error("unsupported feature"); } } }]) {
    const b = browser({ page });
    try { const microphone = await b.environment.microphone(); assert.equal(b.state.requested, 1); microphone.close(); }
    finally { b.restore(); }
  }
});

test("a camera policy block alone does not prevent an audio-only Wattzun call", async () => {
  const features = [], b = browser({ page: { permissionsPolicy: { allowsFeature(feature) { features.push(feature); return feature !== "camera"; } } } });
  try {
    const microphone = await b.environment.microphone(); assert.deepEqual(features, ["microphone"]); microphone.close();
  } finally { b.restore(); }
});

test("actual microphone rejection identifies Chrome or Android access without claiming site permission was denied", async () => {
  for (const name of ["NotAllowedError", "SecurityError"]) {
    const b = browser({ microphoneError: new DOMException("blocked", name) });
    try {
      await assert.rejects(b.environment.microphone(), error => {
        assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "microphone");
        assert.match(error.message, /Chrome or Android/); assert.match(error.message, /Apps > Chrome > Permissions > Microphone/);
        assert.doesNotMatch(error.message, /permission was denied/i); return true;
      });
      assert.equal(b.state.contexts[0].closed, 1); assert.equal(b.state.stopped, 0);
      assert.equal(b.state.events.includes("worklet"), false);
    } finally { b.restore(); }
  }
});

test("missing or busy microphone failures retain device-specific guidance and release the audio context", async () => {
  for (const [name, message] of [["NotFoundError", /No available microphone/], ["OverconstrainedError", /No available microphone/], ["NotReadableError", /Close other apps/], ["AbortError", /Close other apps/]]) {
    const b = browser({ microphoneError: new DOMException("device unavailable", name) });
    try {
      await assert.rejects(b.environment.microphone(), error => {
        assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "microphone"); assert.match(error.message, message); return true;
      });
      assert.equal(b.state.contexts[0].closed, 1); assert.equal(b.state.stopped, 0);
    } finally { b.restore(); }
  }
});

test("audio resume rejection before a late microphone grant is handled as audio failure and cleans both resources", async () => {
  const permission = deferred(), b = browser({ permission, resumeError: new DOMException("autoplay blocked", "NotAllowedError") });
  try {
    const opened = b.environment.microphone();
    const rejected = assert.rejects(opened, error => {
      assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "audio");
      assert.match(error.message, /call audio/i); assert.doesNotMatch(error.message, /microphone access|permission was denied/i); return true;
    });
    await tick(); permission.resolve(b.stream); await rejected;
    assert.equal(b.state.stopped, 1); assert.equal(b.state.contexts[0].closed, 1); assert.equal(b.state.events.includes("worklet"), false);
  } finally { b.restore(); }
});

test("synchronous audio startup failures do not request a microphone or mislabel permission", async () => {
  for (const options of [{ contextError: new DOMException("no device", "NotAllowedError") }, { resumeThrow: new DOMException("no activation", "NotAllowedError") }]) {
    const b = browser(options);
    try {
      await assert.rejects(b.environment.microphone(), error => {
        assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "audio");
        assert.doesNotMatch(error.message, /microphone permission|microphone access/i); return true;
      });
      assert.equal(b.state.requested, 0); assert.equal(b.state.stopped, 0);
      for (const context of b.state.contexts) assert.equal(context.closed, 1);
    } finally { b.restore(); }
  }
});

test("a denied worklet module is a capture startup failure and releases granted microphone and context", async () => {
  const b = browser({ workletError: new DOMException("module blocked", "NotAllowedError") });
  try {
    await assert.rejects(b.environment.microphone(), error => {
      assert.ok(error instanceof WattzunVoiceStartupError); assert.equal(error.reason, "capture");
      assert.match(error.message, /Voice capture/); assert.doesNotMatch(error.message, /microphone permission|microphone access/i); return true;
    });
    assert.equal(b.state.requested, 1); assert.equal(b.state.stopped, 1); assert.equal(b.state.contexts[0].closed, 1);
  } finally { b.restore(); }
});

test("a failed greeting never invokes available device speech synthesis and keeps listening", async () => {
  const b = browser(), statuses = [];
  const call = new WattzunVoiceCall(b.environment, {
    status: value => statuses.push(value), greeting: async () => { throw new Error("Greeting unavailable."); },
    submit: async () => { throw new Error("unexpected submit"); }, reply() {},
  });
  try {
    assert.equal("prompt" in b.environment, false); await call.start();
    assert.equal(statuses.at(-1).state, "listening"); assert.equal(statuses.at(-1).message, "Speak, then pause. Wattzun will reply.");
    assert.ok(statuses.every(status => !status.message.includes("Greeting unavailable")));
    assert.equal(b.state.utterances, 0); assert.equal(b.state.spoken, 0); assert.equal(b.state.cancelledSpeech, 0);
    assert.equal(b.state.requested, 1); assert.equal(b.state.stopped, 0); assert.equal(b.state.timers.size, 1);
    call.dispose(); assert.equal(b.state.stopped, 1); assert.equal(b.state.timers.size, 0);
  } finally { call.dispose(); b.restore(); }
});
