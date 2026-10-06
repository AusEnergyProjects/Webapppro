import assert from "node:assert/strict";
import test from "node:test";
import { WattzunSpeechWindow, WattzunVoiceCall } from "../src/lib/wattzun-voice-client.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Synthetic port results exercise media ownership only. They do not test a provider call.
const voiceResult = { ok: true, transcript: "Help with my next step", reply: { kind: "clarification", message: "Which task are you working on?", questions: [], links: [] }, audio: { base64: "AA==", mimeType: "audio/mpeg" } };
function harness(options = {}) {
  const state = { now: 0, level: 0, microphoneClosed: 0, microphoneMuted: false, recorderCount: 0, playbackClosed: 0, promptClosed: 0, statuses: [], submits: [], replies: [], timers: new Set(), recorders: [], players: [], prompts: [] };
  const microphone = {
    recorder() {
      state.recorderCount++;
      let stopped = false;
      const recorder = { onData() {}, onStop() {}, onError() {}, start() { if (options.recordingError) throw new Error("recorder failed"); }, stop() { if (stopped) return; stopped = true; recorder.onData(new Blob(options.emptyAudio ? [] : ["synthetic speech"], { type: "audio/webm" })); recorder.onStop(); } };
      state.recorders.push(recorder);
      return recorder;
    },
    level: () => state.level,
    mute: value => { state.microphoneMuted = value; },
    close: () => { state.microphoneClosed++; },
  };
  const environment = {
    now: () => state.now,
    repeat(callback) { state.timers.add(callback); return () => state.timers.delete(callback); },
    microphone: () => options.permission ? options.permission.promise : Promise.resolve(microphone),
    prompt(message) {
      if (!options.localPrompt) return null;
      const prompt = { message, onEnd() {}, onError() {}, play: () => options.promptError ? Promise.reject(new Error('device speech unavailable')) : Promise.resolve(), close: () => state.promptClosed++ };
      state.prompts.push(prompt); return prompt;
    },
    playback(audio) {
      const player = { audio, onEnd() {}, onError() {}, play: () => options.playbackError ? Promise.reject(new Error("playback blocked")) : options.playbackWait?.promise || Promise.resolve(), close: () => { state.playbackClosed++; } };
      state.players.push(player); return player;
    },
  };
  const call = new WattzunVoiceCall(environment, {
    status: value => state.statuses.push(value),
    submit(audio, signal) { state.submits.push({ audio, signal }); return options.request ? options.request.promise : Promise.resolve(voiceResult); },
    reply: result => { state.replies.push(result); options.onReply?.(result); },
  });
  return { call, state, microphone,
    sample(milliseconds, level = 0) { state.now += milliseconds; state.level = level; for (const callback of [...state.timers]) callback(); },
    speak() { for (let index = 0; index < 4; index++) this.sample(100, .1); this.sample(700, 0); },
    status: () => state.statuses.at(-1)?.state,
  };
}

test("speech detection ignores a short click and sends sustained speech after silence", () => {
  const detector = new WattzunSpeechWindow(0);
  assert.equal(detector.sample(.08, 100), "wait");
  assert.equal(detector.sample(0, 2000), "wait");
  assert.equal(detector.sample(0, 45000), "silent");
  const speech = new WattzunSpeechWindow(0);
  for (let time = 100; time <= 300; time += 100) assert.equal(speech.sample(.06, time), "wait");
  assert.equal(speech.sample(0, 999), "wait");
  assert.equal(speech.sample(0, 1000), "send");
});
test("speech continuing inside the 700ms pause window resets the end boundary", () => {
  const speech = new WattzunSpeechWindow(0);
  for (let time = 100; time <= 300; time += 100) speech.sample(.06, time);
  assert.equal(speech.sample(0, 900), "wait");
  assert.equal(speech.sample(.06, 950), "wait");
  assert.equal(speech.sample(0, 1649), "wait");
  assert.equal(speech.sample(0, 1650), "send");
});
test("separated short clicks never accumulate into a spoken question", () => {
  const detector = new WattzunSpeechWindow(0);
  assert.equal(detector.sample(.08, 100), "wait");
  assert.equal(detector.sample(0, 400), "wait");
  assert.equal(detector.sample(.08, 500), "wait");
  assert.equal(detector.sample(0, 800), "wait");
  assert.equal(detector.hasSpeech, false);
  assert.equal(detector.sample(0, 45000), "silent");
});
test("a 45-second silent turn never submits and begins a fresh bounded recording", async () => {
  const h = harness(); await h.call.start(); h.sample(45000, 0);
  assert.equal(h.state.submits.length, 0); assert.equal(h.state.recorderCount, 2); assert.equal(h.status(), "listening");
  h.call.dispose(); assert.equal(h.state.timers.size, 0);
});
test("empty media does not submit even when speech was detected", async () => {
  const h = harness({ emptyAudio: true }); await h.call.start(); h.speak();
  assert.equal(h.state.submits.length, 0); assert.equal(h.status(), "listening"); h.call.dispose();
});
test("a late microphone grant after hang-up releases it and never records", async () => {
  const permission = deferred(); const h = harness({ permission }); const started = h.call.start();
  assert.equal(h.status(), "permission"); h.call.hangUp(); permission.resolve(h.microphone); await started;
  assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.recorderCount, 0); assert.equal(h.status(), "ended");
});
test("permission denial is reported without opening a recorder or requesting AI", async () => {
  const permission = deferred(); const h = harness({ permission }); const started = h.call.start(); permission.reject(new Error("Microphone permission was denied.")); await started;
  assert.equal(h.status(), "error"); assert.match(h.state.statuses.at(-1).message, /permission/); assert.equal(h.state.submits.length, 0);
});
test("recorder errors close the microphone and cancel sampling", async () => {
  const h = harness(); await h.call.start(); h.state.recorders[0].onError();
  assert.equal(h.status(), "error"); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0); assert.equal(h.state.submits.length, 0);
});
test("oversized media stops the call without sending it", async () => {
  const h = harness(); await h.call.start(); h.state.recorders[0].onData(new Blob([new Uint8Array(2_000_001)]));
  assert.equal(h.status(), "error"); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.submits.length, 0);
});
test("a speech turn submits once and hang-up prevents a late answer from appearing", async () => {
  const request = deferred(); const h = harness({ request }); await h.call.start(); h.speak(); h.sample(5000);
  assert.equal(h.state.submits.length, 1); assert.equal(h.status(), "thinking"); assert.equal(h.state.microphoneMuted, true);
  h.call.hangUp(); assert.equal(h.state.submits[0].signal.aborted, true); request.resolve(voiceResult); await tick();
  assert.equal(h.state.replies.length, 0); assert.equal(h.state.players.length, 0); assert.equal(h.status(), "ended");
});
test("speaking can be interrupted and immediately returns to listening", async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), "speaking"); assert.equal(h.state.replies.length, 1); h.call.interrupt();
  assert.equal(h.status(), "listening"); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.microphoneMuted, false);
  h.call.dispose(); assert.equal(h.state.microphoneClosed, 1);
});
test("interrupting pending browser playback cannot fail the resumed call", async () => {
  const playbackWait = deferred(); const h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick(); h.call.interrupt();
  playbackWait.reject(new Error("interrupted")); await tick(); assert.equal(h.status(), "listening"); h.call.dispose();
});
test("a streamed reply stays thinking until first playback starts, then becomes speaking", async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), "thinking"); assert.equal(h.state.players.length, 1); assert.equal(h.state.microphoneMuted, true);
  playbackWait.resolve(); await tick(); assert.equal(h.status(), "speaking"); h.call.dispose();
});
test("a late successful playback start cannot replace listening after an interrupt", async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), "thinking"); h.call.interrupt(); assert.equal(h.status(), "listening");
  playbackWait.resolve(); await tick(); assert.equal(h.status(), "listening"); assert.equal(h.state.playbackClosed, 1); h.call.dispose();
});
test("an authoritative playback end before startup settles cannot switch listening back to speaking", async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  h.state.players[0].onEnd(); assert.equal(h.status(), "listening"); playbackWait.resolve(); await tick();
  assert.equal(h.status(), "listening"); h.state.players[0].onError(); assert.equal(h.status(), "listening"); h.call.dispose();
});
test("hang-up during startup prevents late speaking status and releases playback once", async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  h.call.hangUp(); playbackWait.resolve(); await tick(); assert.equal(h.status(), "ended");
  h.state.players[0].onEnd(); h.state.players[0].onError(); assert.equal(h.status(), "ended");
  assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.microphoneClosed, 1);
});
test("a later streaming error keeps the chat reply and cannot revive the call through a stale end", async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick();
  h.state.players[0].onError(); assert.equal(h.status(), "error"); assert.equal(h.state.replies.length, 1);
  h.state.players[0].onEnd(); assert.equal(h.status(), "error"); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.microphoneClosed, 1);
});
test("an unused PCM stream is cancelled when a reply arrives after hang-up or while muted", async () => {
  for (const finish of ["hang-up", "mute"]) {
    let cancelled = 0;
    const audio = { mimeType: "audio/pcm", stream: new ReadableStream({ cancel() { cancelled++; } }) };
    const request = deferred(), h = harness({ request }); await h.call.start(); h.speak();
    if (finish === "hang-up") h.call.hangUp(); else h.call.toggleMute();
    request.resolve({ ...voiceResult, audio }); await tick();
    assert.equal(cancelled, 1); assert.equal(h.state.players.length, 0); assert.equal(h.status(), finish === "hang-up" ? "ended" : "muted"); h.call.dispose();
  }
});
test("a reply callback that changes the active call cannot leak the returned PCM stream", async () => {
  let cancelled = 0;
  const audio = { mimeType: "audio/pcm", stream: new ReadableStream({ cancel() { cancelled++; } }) };
  const request = deferred(), options = { request }, h = harness(options); options.onReply = () => h.call.hangUp();
  await h.call.start(); h.speak(); request.resolve({ ...voiceResult, audio }); await tick();
  assert.equal(h.status(), "ended"); assert.equal(h.state.players.length, 0); assert.equal(cancelled, 1);
});
test("mute discards captured speech and cannot produce a provider request", async () => {
  const h = harness(); await h.call.start(); h.sample(300, .1); h.call.toggleMute(); h.sample(45000, .1);
  assert.equal(h.status(), "muted"); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.submits.length, 0); assert.equal(h.state.timers.size, 1);
  h.call.toggleMute(); assert.equal(h.status(), "listening"); assert.equal(h.state.microphoneMuted, false); h.call.dispose();
});
test("muting during speaking remains muted when playback ends", async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick(); h.call.toggleMute(); h.state.players[0].onEnd();
  assert.equal(h.status(), "muted"); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.recorders.length, 1); h.call.dispose();
});
test("playback failures keep the chat reply but release microphone and audio", async () => {
  const h = harness({ playbackError: true }); await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), "error"); assert.equal(h.state.replies.length, 1); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.timers.size, 0);
});
test("a repeated start cannot request permission or start another recorder", async () => {
  const h = harness(); await h.call.start(); await h.call.start(); assert.equal(h.state.recorderCount, 1); h.call.dispose();
});

test('silence rotates bounded turns, checks in at 90 seconds and ends only after 30 seconds without a response', async () => {
  const h = harness(); await h.call.start(); h.sample(45000); assert.equal(h.state.recorderCount, 2);
  h.sample(44999); assert.equal(h.status(), 'listening'); h.sample(1); assert.equal(h.status(), 'confirming');
  assert.match(h.state.statuses.at(-1).message, /Would you like to continue/); assert.equal(h.state.submits.length, 0);
  h.sample(29999); assert.equal(h.status(), 'confirming'); h.sample(1);
  assert.equal(h.status(), 'ended'); assert.equal(h.state.statuses.at(-1).message, 'Call ended after no response.');
  assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0); assert.equal(h.state.submits.length, 0);
});

test('the local check-in is never recorded and its playback time is outside the response deadline', async () => {
  const h = harness({ localPrompt: true }); await h.call.start(); h.sample(90000);
  const recorderCount = h.state.recorderCount; assert.equal(h.status(), 'confirming'); assert.equal(h.state.microphoneMuted, true);
  assert.equal(h.state.prompts[0].message, 'Would you like to continue this call?');
  h.sample(5000, .3); assert.equal(h.state.recorderCount, recorderCount); assert.equal(h.state.submits.length, 0);
  h.state.prompts[0].onEnd(); assert.equal(h.state.promptClosed, 1); assert.equal(h.state.microphoneMuted, false);
  h.sample(29999); assert.equal(h.status(), 'confirming'); h.sample(1); assert.equal(h.status(), 'ended');
});

test('Continue call resets the idle window, preserves mute choice and cancels a local prompt', async () => {
  const h = harness({ localPrompt: true }); await h.call.start(); h.sample(90000); h.call.continueCall();
  assert.equal(h.status(), 'listening'); assert.equal(h.state.promptClosed, 1); h.sample(89999); assert.equal(h.status(), 'listening'); h.call.dispose();
  const muted = harness(); await muted.call.start(); muted.call.toggleMute(); muted.sample(90000); assert.equal(muted.status(), 'muted');
  muted.sample(90000); assert.equal(muted.status(), 'confirming'); muted.call.continueCall(); assert.equal(muted.status(), 'muted'); assert.equal(muted.state.microphoneMuted, true);
  muted.call.dispose(); assert.equal(muted.state.timers.size, 0);
});

test('real speech answers a check-in and restarts activity without a synthetic provider request', async () => {
  const h = harness(); await h.call.start(); h.sample(90000); h.speak(); await tick();
  assert.equal(h.state.submits.length, 1); assert.equal(h.status(), 'speaking'); h.state.players[0].onEnd();
  h.sample(89999); assert.equal(h.status(), 'listening'); h.call.dispose();
});

test('a just-started utterance at the response deadline is allowed to complete', async () => {
  const h = harness(); await h.call.start(); h.sample(90000); h.sample(29900); h.sample(100, .1);
  assert.equal(h.status(), 'confirming'); h.sample(100, .1); h.sample(100, .1); h.sample(700); await tick();
  assert.equal(h.state.submits.length, 1); assert.equal(h.status(), 'speaking'); h.call.dispose();
});

test('long active calls have no total duration cap and provider work or answer playback cannot idle-end', async () => {
  const h = harness(); await h.call.start();
  for (let turn = 0; turn < 20; turn++) { h.sample(60000); h.speak(); await tick(); h.state.players.at(-1).onEnd(); assert.equal(h.status(), 'listening'); }
  assert.ok(h.state.now > 1200000); assert.equal(h.state.submits.length, 20); h.call.dispose();
  const request = deferred(), waiting = harness({ request }); await waiting.call.start(); waiting.speak(); waiting.sample(600000); assert.equal(waiting.status(), 'thinking');
  request.resolve(voiceResult); await tick(); waiting.sample(600000); assert.equal(waiting.status(), 'speaking'); waiting.state.players[0].onEnd();
  waiting.sample(89999); assert.equal(waiting.status(), 'listening'); waiting.call.dispose();
});

test('device prompt errors fall back to visible confirmation and hanging up cleans all prompt timers and media', async () => {
  const h = harness({ localPrompt: true, promptError: true }); await h.call.start(); h.sample(90000); await tick();
  assert.equal(h.status(), 'confirming'); assert.equal(h.state.microphoneMuted, false); assert.equal(h.state.submits.length, 0); h.call.hangUp();
  assert.equal(h.state.promptClosed, 1); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0);
  const playing = harness({ localPrompt: true }); await playing.call.start(); playing.sample(90000); playing.call.dispose();
  assert.equal(playing.state.promptClosed, 1); assert.equal(playing.state.microphoneClosed, 1); assert.equal(playing.state.timers.size, 0);
});
