import assert from "node:assert/strict";
import test from "node:test";
import { WattzunSpeechWindow, WattzunVoiceCall, WattzunVoiceCallError } from "../src/lib/wattzun-voice-client.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Synthetic port results exercise media ownership only. They do not test a provider call.
const voiceResult = { ok: true, transcript: "Help with my next step", reply: { kind: "clarification", message: "Which task are you working on?", questions: [], links: [] }, audio: { base64: "AA==", mimeType: "audio/mpeg" } };

test('heard input and a reply header arrive before spoken delivery; only a current complete playback is delivered', async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick();
  assert.equal(h.state.replies.length, 1); assert.equal(h.state.played.length, 0);
  const failed = h.state.players[0]; failed.onError();
  assert.equal(h.status(), 'recovering'); assert.equal(h.state.played.length, 0);
  assert.equal(h.state.timers.size, 1); assert.equal(h.state.microphoneMuted, false);
  h.sample(45000); assert.equal(h.status(), 'recovering'); assert.equal(h.state.submits.length, 1);
  h.speak(); await tick(); assert.equal(h.status(), 'speaking');
  failed.onEnd(); assert.equal(h.state.played.length, 0);
  const delivered = h.state.players[1]; delivered.onEnd(); delivered.onEnd();
  assert.deepEqual(h.state.played, [voiceResult.audio]); assert.equal(h.status(), 'listening');
  assert.equal(h.state.microphoneRequested, 1); h.call.dispose();
});
test('interrupted or cancelled playback never becomes delivered reasoning history', async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick();
  const interrupted = h.state.players[0]; h.call.interrupt(); interrupted.onEnd();
  assert.equal(h.state.played.length, 0); h.speak(); await tick();
  const cancelled = h.state.players[1]; h.call.hangUp(); cancelled.onEnd();
  assert.equal(h.state.played.length, 0); assert.equal(h.status(), 'ended');
});
test('a delivered callback that closes the call cannot restart capture', async () => {
  const options = {}, h = harness(options); options.onPlayed = () => h.call.hangUp();
  await h.call.start(); h.speak(); await tick(); h.state.players[0].onEnd();
  assert.equal(h.status(), 'ended'); assert.equal(h.state.recorderCount, 1);
  assert.equal(h.state.timers.size, 0); assert.equal(h.state.microphoneClosed, 1);
});

test('a requested guide step uses the active microphone and resumes listening after its question', async () => {
  const h = harness(); await h.call.start();
  assert.equal(await h.call.requestReply(async () => voiceResult), true);
  assert.equal(h.status(), 'speaking'); assert.equal(h.state.microphoneRequested, 1);
  assert.equal(h.state.submits.length, 0); assert.equal(h.state.replies.length, 1);
  assert.equal(h.state.timers.size, 0);
  h.state.players[0].onEnd(); assert.equal(h.status(), 'listening');
  assert.equal(h.state.microphoneRequested, 1); assert.equal(h.state.timers.size, 1);
  h.call.dispose();
});

test('guide controls cannot duplicate an in-flight answer or run with a muted or ended call', async () => {
  const request = deferred(), h = harness({ request }); await h.call.start(); h.speak();
  let invoked = 0;
  const control = async () => { invoked++; return voiceResult; };
  assert.equal(await h.call.requestReply(control), false);
  request.resolve(voiceResult); await tick(); h.state.players[0].onEnd();
  h.call.toggleMute(); assert.equal(await h.call.requestReply(control), false);
  h.call.hangUp(); assert.equal(await h.call.requestReply(control), false);
  assert.equal(invoked, 0); assert.equal(h.state.submits.length, 1);
});

test('repeating a guided question stops old playback without submitting captured audio', async () => {
  const h = harness(); await h.call.start();
  await h.call.requestReply(async () => voiceResult);
  const oldPlayer = h.state.players[0];
  await h.call.requestReply(async () => voiceResult);
  assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.players.length, 2);
  oldPlayer.onEnd(); assert.equal(h.status(), 'speaking');
  assert.equal(h.state.submits.length, 0); assert.equal(h.state.timers.size, 0);
  h.state.players[1].onEnd(); assert.equal(h.status(), 'listening'); h.call.dispose();
});

test('hang-up aborts a requested guide step and discards its late private audio', async () => {
  const h = harness(), pending = deferred(), pcm = greetingPcm(); await h.call.start();
  let signal;
  const step = h.call.requestReply(current => { signal = current; return pending.promise; });
  h.call.hangUp(); assert.equal(signal.aborted, true);
  pending.resolve({ ...voiceResult, audio: pcm.audio }); await step; await tick();
  assert.equal(pcm.state.cancelled, 1); assert.equal(h.state.replies.length, 0);
  assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneClosed, 1);
  assert.equal(h.status(), 'ended');
});

function harness(options = {}) {
  const state = { now: 0, level: 0, microphoneRequested: 0, microphoneClosed: 0, microphoneMuted: false, recorderCount: 0, playbackClosed: 0, statuses: [], submits: [], replies: [], played: [], greetings: [], timers: new Set(), recorders: [], players: [] };
  const microphone = {
    recorder() {
      state.recorderCount++;
      let stopped = false;
      const recorder = { confirmations: 0, onData() {}, onStop() {}, onError() {}, start() { if (options.recordingError) throw new Error("recorder failed"); }, confirmSpeech() { this.confirmations++; }, stop() { if (stopped) return; stopped = true; recorder.onData(options.audio || new Blob(options.emptyAudio ? [] : ["synthetic speech"], { type: "audio/webm" })); recorder.onStop(); } };
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
    microphone: () => { state.microphoneRequested++; return options.permission ? options.permission.promise : Promise.resolve(microphone); },
    playback(audio) {
      if (options.playbackFactoryError) throw new Error("audio device unavailable");
      const player = { audio, onEnd() {}, onError() {}, play: () => options.playbackError ? Promise.reject(new Error("playback blocked")) : options.playbackWait?.promise || Promise.resolve(), close: () => { state.playbackClosed++; } };
      state.players.push(player); return player;
    },
  };
  const callbacks = {
    status: value => { state.statuses.push(value); options.onStatus?.(value); },
    submit(audio, signal) { state.submits.push({ audio, signal }); return options.submit ? options.submit(audio, signal, state.submits.length) : options.request ? options.request.promise : Promise.resolve(voiceResult); },
    reply: result => { state.replies.push(result); options.onReply?.(result); },
    played: audio => { state.played.push(audio); options.onPlayed?.(audio); },
  };
  if (options.greeting) callbacks.greeting = signal => { state.greetings.push({ signal }); return typeof options.greeting === "function" ? options.greeting(signal) : options.greeting.promise; };
  const call = new WattzunVoiceCall(environment, callbacks);
  return { call, state, microphone,
    sample(milliseconds, level = 0) { state.now += milliseconds; state.level = level; for (const callback of [...state.timers]) callback(); },
    speak() { for (let index = 0; index < 4; index++) this.sample(100, .1); this.sample(1300, 0); },
    status: () => state.statuses.at(-1)?.state,
  };
}

function greetingPcm() {
  const state = { cancelled: 0 }, audio = { mimeType: "audio/pcm", stream: new ReadableStream({ cancel() { state.cancelled++; } }) };
  return { state, audio };
}
test("greeting and microphone opening run concurrently, play without a chat turn, then begin listening", async () => {
  const permission = deferred(), greeting = deferred(), pcm = greetingPcm(), h = harness({ permission, greeting });
  const started = h.call.start(); assert.equal(h.state.greetings.length, 1); assert.equal(h.state.microphoneRequested, 1);
  greeting.resolve(pcm.audio); await tick(); assert.equal(h.status(), "permission"); assert.equal(h.state.players.length, 0);
  permission.resolve(h.microphone); await started; assert.equal(h.status(), "speaking"); assert.equal(h.state.microphoneMuted, true);
  assert.equal(h.state.recorderCount, 0); assert.equal(h.state.players[0].audio, pcm.audio); assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.submits.length, 0); assert.equal(h.state.replies.length, 0);
  h.sample(180000, .2); assert.equal(h.status(), "speaking"); assert.equal(h.state.submits.length, 0);
  h.state.players[0].onEnd(); assert.equal(h.status(), "listening"); assert.equal(h.state.recorderCount, 1); assert.equal(h.state.microphoneMuted, false);
  await h.call.start(); assert.equal(h.state.greetings.length, 1); h.sample(89999); assert.equal(h.status(), "listening"); h.call.dispose();
});
test("a ready microphone stays connecting and never records while greeting audio is pending", async () => {
  const greeting = deferred(), h = harness({ greeting }), started = h.call.start(); await tick();
  assert.equal(h.status(), "connecting"); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.recorderCount, 0);
  h.speak(); h.sample(180000); assert.equal(h.status(), "connecting"); assert.equal(h.state.submits.length, 0);
  greeting.resolve(voiceResult.audio); await started; assert.equal(h.status(), "speaking"); h.call.dispose();
});
test("hang-up aborts a pending greeting and releases a late microphone and unused PCM audio", async () => {
  const permission = deferred(), greeting = deferred(), pcm = greetingPcm(), h = harness({ permission, greeting }), started = h.call.start();
  h.call.hangUp(); assert.equal(h.state.greetings[0].signal.aborted, true);
  greeting.resolve(pcm.audio); await tick(); assert.equal(pcm.state.cancelled, 1);
  permission.resolve(h.microphone); await started; assert.equal(h.status(), "ended"); assert.equal(h.state.microphoneClosed, 1);
  assert.equal(h.state.players.length, 0); assert.equal(h.state.recorderCount, 0); assert.equal(h.state.timers.size, 0);
});
test("hang-up cancels greeting PCM already received while microphone permission is still pending", async () => {
  const permission = deferred(), greeting = deferred(), pcm = greetingPcm(), h = harness({ permission, greeting }), started = h.call.start();
  greeting.resolve(pcm.audio); await tick(); h.call.hangUp(); await tick(); assert.equal(pcm.state.cancelled, 1);
  permission.resolve(h.microphone); await started; assert.equal(pcm.state.cancelled, 1); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.status(), "ended");
});
test("microphone denial aborts the greeting and discards audio received before permission failed", async () => {
  const permission = deferred(), greeting = deferred(), pcm = greetingPcm(), h = harness({ permission, greeting }), started = h.call.start();
  greeting.resolve(pcm.audio); await tick(); permission.reject(new Error("Microphone permission was denied.")); await started; await tick();
  assert.equal(h.status(), "error"); assert.match(h.state.statuses.at(-1).message, /permission/); assert.equal(h.state.greetings[0].signal.aborted, true);
  assert.equal(pcm.state.cancelled, 1); assert.equal(h.state.players.length, 0); assert.equal(h.state.submits.length, 0);
});
test("a recoverable greeting rejection waits for microphone permission and then keeps the call listening", async () => {
  const permission = deferred(), greeting = deferred(), h = harness({ permission, greeting }), started = h.call.start();
  greeting.reject(new Error("Greeting temporarily unavailable.")); await tick(); assert.equal(h.status(), "permission");
  assert.equal(h.state.greetings[0].signal.aborted, false); permission.resolve(h.microphone); await started;
  assert.equal(h.status(), "listening"); assert.equal(h.state.statuses.at(-1).message, "Speak, then pause. Wattzun will reply.");
  assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.players.length, 0); assert.equal(h.state.recorderCount, 1); h.call.dispose();
});
test("a synchronously throwing greeting callback is handled without an unhandled request rejection", async () => {
  const h = harness({ greeting: () => { throw new Error("unavailable"); } }); await h.call.start();
  assert.equal(h.status(), "listening"); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.players.length, 0); assert.equal(h.state.timers.size, 1); h.call.dispose();
});
test("greeting playback failure preserves the microphone and resumes listening without a submit or chat reply", async () => {
  const greeting = deferred(), h = harness({ greeting, playbackError: true }), started = h.call.start(); greeting.resolve(voiceResult.audio); await started;
  assert.equal(h.status(), "recovering"); assert.equal(h.state.statuses.at(-1).message, "No spoken reply was completed. Your call is still connected and listening.");
  assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.recorderCount, 1);
  assert.equal(h.state.submits.length, 0); assert.equal(h.state.replies.length, 0); assert.equal(h.state.timers.size, 1); h.call.dispose();
});
test("an unavailable playback device releases unused PCM for both greeting and answer audio", async () => {
  for (const isGreeting of [true, false]) {
    const pcm = greetingPcm(), request = deferred(), options = { playbackFactoryError: true, ...(isGreeting ? { greeting: request } : { request }) }, h = harness(options);
    const started = h.call.start();
    if (isGreeting) { request.resolve(pcm.audio); await started; }
    else { await started; h.speak(); request.resolve({ ...voiceResult, audio: pcm.audio }); await tick(); }
    await tick(); assert.equal(h.status(), "recovering"); assert.equal(pcm.state.cancelled, 1); assert.equal(h.state.players.length, 0);
    assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.statuses.at(-1).message, "No spoken reply was completed. Your call is still connected and listening."); h.call.dispose();
  }
});
test("a later greeting stream error cannot revive listening through a stale playback end", async () => {
  const greeting = deferred(), h = harness({ greeting }), started = h.call.start(); greeting.resolve(voiceResult.audio); await started;
  const player = h.state.players[0]; player.onError(); player.onEnd();
  assert.equal(h.status(), "recovering"); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.recorderCount, 1); h.call.dispose();
});
test("interrupting greeting startup starts listening and ignores a late playback resolve or rejection", async () => {
  for (const reject of [false, true]) {
    const greeting = deferred(), playbackWait = deferred(), h = harness({ greeting, playbackWait }), started = h.call.start(); greeting.resolve(voiceResult.audio); await tick();
    assert.equal(h.status(), "connecting"); h.call.interrupt(); assert.equal(h.status(), "listening"); assert.equal(h.state.recorderCount, 1);
    if (reject) playbackWait.reject(new Error("interrupted")); else playbackWait.resolve();
    await started; assert.equal(h.status(), "listening"); h.state.players[0].onEnd(); h.state.players[0].onError();
    assert.equal(h.state.recorderCount, 1); assert.equal(h.state.playbackClosed, 1); h.call.dispose();
  }
});
test("greeting ending before startup settles begins capture once and cannot return to speaking", async () => {
  const greeting = deferred(), playbackWait = deferred(), h = harness({ greeting, playbackWait }), started = h.call.start(); greeting.resolve(voiceResult.audio); await tick();
  h.state.players[0].onEnd(); assert.equal(h.status(), "listening"); playbackWait.resolve(); await started;
  assert.equal(h.status(), "listening"); assert.equal(h.state.recorderCount, 1); assert.equal(h.state.playbackClosed, 1); h.call.dispose();
});
test("muting while greeting is pending discards audio and waits for explicit unmute before capturing", async () => {
  const greeting = deferred(), pcm = greetingPcm(), h = harness({ greeting }), started = h.call.start(); await tick(); h.call.toggleMute();
  greeting.resolve(pcm.audio); await started; await tick(); assert.equal(h.status(), "muted"); assert.equal(pcm.state.cancelled, 1);
  assert.equal(h.state.players.length, 0); assert.equal(h.state.recorderCount, 0); assert.equal(h.state.microphoneMuted, true);
  h.call.toggleMute(); assert.equal(h.status(), "listening"); assert.equal(h.state.recorderCount, 1); h.call.dispose();
});
test("muting during the greeting preserves the choice at greeting end and Stop speaking", async () => {
  for (const interrupt of [false, true]) {
    const greeting = deferred(), h = harness({ greeting }), started = h.call.start(); greeting.resolve(voiceResult.audio); await started; h.call.toggleMute();
    if (interrupt) h.call.interrupt(); else h.state.players[0].onEnd();
    assert.equal(h.status(), "muted"); assert.equal(h.state.recorderCount, 0); assert.equal(h.state.microphoneMuted, true);
    h.call.toggleMute(); assert.equal(h.status(), "listening"); assert.equal(h.state.recorderCount, 1); h.call.dispose();
  }
});
test("hang-up during greeting startup prevents all late events from changing the ended call", async () => {
  const greeting = deferred(), playbackWait = deferred(), h = harness({ greeting, playbackWait }), started = h.call.start(); greeting.resolve(voiceResult.audio); await tick();
  h.call.hangUp(); playbackWait.resolve(); await started; h.state.players[0].onEnd(); h.state.players[0].onError();
  assert.equal(h.status(), "ended"); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.microphoneClosed, 1);
  assert.equal(h.state.recorderCount, 0); assert.equal(h.state.timers.size, 0);
});
test("a workspace cancellation from connection status releases the microphone and leaves no idle timer", async () => {
  const greeting = deferred(), options = { greeting }, h = harness(options); options.onStatus = value => { if (value.state === "connecting") h.call.dispose(); };
  const started = h.call.start(); await started; const pcm = greetingPcm(); greeting.resolve(pcm.audio); await tick();
  assert.equal(h.state.greetings[0].signal.aborted, true); assert.equal(pcm.state.cancelled, 1); assert.equal(h.state.microphoneClosed, 1);
  assert.equal(h.state.timers.size, 0); assert.equal(h.state.players.length, 0); assert.equal(h.state.recorderCount, 0);
});

test("speech detection ignores a short click and sends sustained speech after silence", () => {
  const detector = new WattzunSpeechWindow(0);
  assert.equal(detector.sample(.08, 100), "wait");
  assert.equal(detector.sample(0, 2000), "wait");
  assert.equal(detector.sample(0, 45000), "silent");
  const speech = new WattzunSpeechWindow(0);
  for (let time = 100; time <= 300; time += 100) assert.equal(speech.sample(.06, time), "wait");
  assert.equal(speech.sample(0, 1599), "wait");
  assert.equal(speech.sample(0, 1600), "send");
});
test("a natural 1100ms sentence pause preserves the next clause and resets the end boundary", () => {
  const speech = new WattzunSpeechWindow(0);
  for (let time = 100; time <= 300; time += 100) speech.sample(.06, time);
  assert.equal(speech.sample(0, 1000), "wait");
  assert.equal(speech.sample(0, 1400), "wait");
  assert.equal(speech.sample(.06, 1450), "wait");
  assert.equal(speech.sample(0, 2749), "wait");
  assert.equal(speech.sample(0, 2750), "send");
});

test("idle time never cuts a ten-second sentence and a candidate can cross the old idle deadline", () => {
  for (const onset of [42400, 44900]) {
    const speech = new WattzunSpeechWindow(0);
    for (let time=100;time<onset;time+=100) assert.equal(speech.sample(0,time),"wait");
    for (let time=onset;time<=onset+10000;time+=100) assert.equal(speech.sample(.1,time),"wait",`${onset}: ${time}`);
    assert.equal(speech.sample(0,onset+11299),"wait");assert.equal(speech.sample(0,onset+11300),"send");
  }
});

test("a brief sound near idle rollover stays unconfirmed and does not submit",async()=>{
  const h=harness();await h.call.start();h.sample(44800,0);h.sample(100,.1);h.sample(100,0);
  assert.equal(h.state.submits.length,0);assert.equal(h.state.recorderCount,1);
  h.sample(200,0);assert.equal(h.state.submits.length,0);assert.equal(h.state.recorders[0].confirmations,0);assert.equal(h.state.recorderCount,2);h.call.dispose();
});

test("the recorder's bounded limit submits confirmed speech once and stale limits cannot submit after mute or hangup",async()=>{
  const h=harness();await h.call.start();for(let i=0;i<3;i++)h.sample(100,.1);
  const recorder=h.state.recorders[0];assert.ok(recorder.confirmations>0);
  recorder.onData(new Blob(["bounded audio"]));recorder.onStop("limit");recorder.onStop("limit");await tick();
  assert.equal(h.state.submits.length,1);h.call.dispose();
  for(const action of ["toggleMute","hangUp"]){const f=harness();await f.call.start();for(let i=0;i<3;i++)f.sample(100,.1);const old=f.state.recorders[0];f.call[action]();old.onData(new Blob(["late bounded audio"]));old.onStop("limit");assert.equal(f.state.submits.length,0);f.call.dispose();}
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
test("fatal recorder setup errors close the microphone and leave no playback", async () => {
  const h = harness({ recordingError: true }); await h.call.start();
  assert.equal(h.status(), 'error'); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.submits.length, 0);
});
test("oversized media discards the capture and resumes listening without sending or closing the call", async () => {
  const h = harness(); await h.call.start(); h.state.recorders[0].onData(new Blob([new Uint8Array(2_000_001)]));
  assert.equal(h.status(), "listening"); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.submits.length, 0);
  assert.equal(h.state.recorderCount, 2); assert.equal(h.state.statuses.at(-1).message, "Speak, then pause. Wattzun will reply."); h.call.dispose();
});
test("native WAV permits a complete 45-second PCM turn while retaining the old non-WAV bound", async () => {
  const audio = new Blob([new Uint8Array(45 * 24_000 * 2 + 44)], { type: "audio/wav" });
  const h = harness({ audio }); await h.call.start(); h.speak(); await tick();
  assert.equal(h.state.submits.length, 1); assert.equal(h.state.submits[0].audio.size, audio.size);
  assert.equal(h.state.submits[0].audio.type, "audio/wav"); h.call.dispose();
  const tooLarge = harness({ audio: new Blob([new Uint8Array(audio.size + 2)], { type: "audio/wav" }) });
  await tooLarge.call.start(); tooLarge.speak(); await tick(); assert.equal(tooLarge.status(), "listening");
  assert.equal(tooLarge.state.submits.length, 0); assert.equal(tooLarge.state.microphoneClosed, 0); tooLarge.call.dispose();
});
test("an oversized first turn recovers quietly and the next turn succeeds with the same microphone", async () => {
  for (const [size, type] of [[2_000_001, 'audio/webm'], [45 * 24_000 * 2 + 46, 'audio/wav']]) {
    const h = harness(); await h.call.start();
    const rejectedCapture = h.state.recorders[0];
    rejectedCapture.onData(new Blob([new Uint8Array(size)], { type }));
    assert.equal(h.status(), 'listening'); assert.equal(h.state.submits.length, 0); assert.equal(h.state.microphoneClosed, 0);
    assert.equal(h.state.players.length, 0); assert.equal(h.state.recorderCount, 2); assert.equal(h.state.timers.size, 1);
    assert.equal(h.state.statuses.at(-1).message, "Speak, then pause. Wattzun will reply.");
    rejectedCapture.onStop(); rejectedCapture.onError();
    assert.equal(h.state.recorderCount, 2); assert.equal(h.status(), 'listening');
    h.speak(); await tick(); assert.equal(h.status(), 'speaking');
    assert.equal(h.state.submits.length, 1); assert.equal(h.state.replies.length, 1); assert.equal(h.state.microphoneRequested, 1);
    assert.equal(h.state.microphoneClosed, 0); h.call.dispose(); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0);
  }
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
test("a later streaming error retains its header and marks the spoken reply incomplete despite a stale playback end", async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick();
  h.state.players[0].onError(); assert.equal(h.status(), "recovering"); assert.equal(h.state.replies.length, 1);
  h.state.players[0].onEnd(); assert.equal(h.status(), "recovering"); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.microphoneClosed, 0);
  assert.equal(h.state.recorderCount, 2); h.call.dispose();
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
  assert.equal(h.status(), "muted"); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.submits.length, 0); assert.equal(h.state.timers.size, 0);
  h.call.toggleMute(); assert.equal(h.status(), "listening"); assert.equal(h.state.microphoneMuted, false); h.call.dispose();
});
test("muting during speaking remains muted when playback ends", async () => {
  const h = harness(); await h.call.start(); h.speak(); await tick(); h.call.toggleMute(); h.state.players[0].onEnd();
  assert.equal(h.status(), "muted"); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.recorders.length, 1); h.call.dispose();
});
test("playback failures retain their header and microphone without claiming spoken delivery", async () => {
  const h = harness({ playbackError: true }); await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), "recovering"); assert.equal(h.state.replies.length, 1); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.playbackClosed, 1); assert.equal(h.state.timers.size, 1); h.call.dispose();
});
test("a repeated start cannot request permission or start another recorder", async () => {
  const h = harness(); await h.call.start(); await h.call.start(); assert.equal(h.state.recorderCount, 1); h.call.dispose();
});

test('over eight hours of silence or mute keeps the call open without notices or provider requests', async () => {
  for (const muted of [false, true]) {
    const h = harness({}); await h.call.start(); if (muted) h.call.toggleMute();
    for (let interval = 0; interval < 650; interval++) h.sample(45000);
    assert.ok(h.state.now > 8 * 60 * 60 * 1000);
    assert.equal(h.status(), muted ? 'muted' : 'listening'); assert.equal(h.state.microphoneClosed, 0);
    assert.equal(h.state.submits.length, 0); assert.equal(h.state.microphoneRequested, 1);
    assert.equal(h.state.recorderCount, muted ? 1 : 651); assert.equal(h.state.timers.size, muted ? 0 : 1);
    h.call.hangUp(); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0);
  }
});

test('long active calls, provider work and playback have no idle or total duration cap', async () => {
  const h = harness(); await h.call.start();
  for (let turn = 0; turn < 20; turn++) { h.sample(60000); h.speak(); await tick(); h.state.players.at(-1).onEnd(); assert.equal(h.status(), 'listening'); }
  assert.ok(h.state.now > 1200000); assert.equal(h.state.submits.length, 20); h.call.dispose();
  const request = deferred(), waiting = harness({ request }); await waiting.call.start(); waiting.speak(); waiting.sample(600000); assert.equal(waiting.status(), 'thinking');
  request.resolve(voiceResult); await tick(); waiting.sample(600000); assert.equal(waiting.status(), 'speaking'); waiting.state.players[0].onEnd();
  waiting.sample(9 * 60 * 60 * 1000); assert.equal(waiting.status(), 'listening'); waiting.call.dispose();
});

test('a failed first turn preserves the call and a new spoken turn can succeed without resending or reopening media', async () => {
  const h = harness({ submit: (_audio, _signal, attempt) => attempt === 1 ? Promise.reject(new Error('Reply temporarily unavailable.')) : Promise.resolve(voiceResult) });
  await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), 'recovering'); assert.equal(h.state.statuses.at(-1).message, "No spoken reply was completed. Your call is still connected and listening.");
  assert.equal(h.state.submits.length, 1); assert.equal(h.state.replies.length, 0); assert.equal(h.state.microphoneClosed, 0);
  h.sample(600000); assert.equal(h.state.submits.length, 1);
  h.speak(); await tick(); assert.equal(h.status(), 'speaking'); assert.equal(h.state.submits.length, 2);
  assert.equal(h.state.replies.length, 1); assert.equal(h.state.replies[0], voiceResult);
  assert.equal(h.state.microphoneRequested, 1); assert.equal(h.state.microphoneClosed, 0); h.call.dispose();
});

test('failed replies recover without creating playback and a valid next turn succeeds on the same microphone', async () => {
  const h = harness({ submit: (_audio, _signal, attempt) => attempt === 1 ? Promise.reject(new Error('private-failure-detail')) : Promise.resolve(voiceResult) });
  await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), 'recovering'); assert.equal(h.state.statuses.at(-1).message, "No spoken reply was completed. Your call is still connected and listening.");
  assert.ok(h.state.statuses.every(status => !status.message.includes("private-failure-detail")));
  assert.ok(h.state.statuses.filter(status => status.state === "recovering").every(status => status.message === "No spoken reply was completed. Your call is still connected and listening."));
  assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneMuted, false); assert.equal(h.state.microphoneRequested, 1);
  assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.recorderCount, 2); assert.equal(h.state.timers.size, 1);
  h.speak(); await tick(); assert.equal(h.status(), 'speaking'); assert.equal(h.state.replies.length, 1);
  assert.equal(h.state.players.length, 1); assert.equal(h.state.players[0].audio, voiceResult.audio); h.call.dispose();
});

test('recoverable greeting failure quietly starts listening without repeating the greeting request', async () => {
  const greeting = deferred(), h = harness({ greeting }), started = h.call.start();
  greeting.reject(new Error('Greeting unavailable.')); await started;
  assert.equal(h.status(), 'listening'); assert.equal(h.state.players.length, 0); assert.equal(h.state.greetings.length, 1);
  assert.equal(h.state.recorderCount, 1); assert.equal(h.state.statuses.at(-1).message, "Speak, then pause. Wattzun will reply.");
  h.speak(); await tick(); assert.equal(h.status(), 'speaking'); assert.equal(h.state.greetings.length, 1);
  assert.equal(h.state.submits.length, 1); assert.equal(h.state.microphoneRequested, 1); assert.equal(h.state.microphoneClosed, 0); h.call.dispose();
});

test('late failure from old playback cannot restart capture or interrupt the next Wattzun answer', async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  const oldPlayer = h.state.players[0]; oldPlayer.onError();
  assert.equal(h.status(), 'recovering'); assert.equal(h.state.players.length, 1); assert.equal(h.state.playbackClosed, 1);
  assert.equal(h.state.recorderCount, 2); assert.equal(h.state.timers.size, 1);
  h.speak(); await tick(); assert.equal(h.state.players.length, 2); assert.equal(h.status(), 'thinking');
  playbackWait.resolve(); await tick(); assert.equal(h.status(), 'speaking');
  const statusCount = h.state.statuses.length;
  oldPlayer.onEnd(); oldPlayer.onError(); h.sample(8000, .1);
  assert.equal(h.status(), 'speaking'); assert.equal(h.state.statuses.length, statusCount);
  assert.equal(h.state.players.length, 2); assert.equal(h.state.recorderCount, 2); assert.equal(h.state.submits.length, 2);
  assert.equal(h.state.timers.size, 0); assert.equal(h.state.microphoneClosed, 0); h.call.dispose();
});

test('a late startup rejection after a streaming error resumes capture only once without substitute speech', async () => {
  const playbackWait = deferred(), h = harness({ playbackWait }); await h.call.start(); h.speak(); await tick();
  const player = h.state.players[0]; player.onError(); assert.equal(h.status(), 'recovering');
  playbackWait.reject(new Error('Late stream failure.')); await tick(); player.onEnd(); player.onError();
  assert.equal(h.status(), 'recovering'); assert.equal(h.state.players.length, 1); assert.equal(h.state.playbackClosed, 1);
  assert.equal(h.state.recorderCount, 2); assert.equal(h.state.replies.length, 1); assert.equal(h.state.microphoneClosed, 0); h.call.dispose();
});

test('workspace cancellation during quiet recovery leaves no microphone, capture or timer', async () => {
  const options = { submit: () => Promise.reject(new Error('Reply unavailable.')) }, h = harness(options);
  options.onStatus = value => { if (value.state === 'recovering') h.call.dispose(); };
  await h.call.start(); h.speak(); await tick(); h.sample(600000);
  assert.equal(h.state.playbackClosed, 0); assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneClosed, 1);
  assert.equal(h.state.recorderCount, 1); assert.equal(h.state.submits.length, 1); assert.equal(h.state.timers.size, 0);
});

test('muting while a turn fails preserves mute and requires explicit unmute before capture resumes', async () => {
  const request = deferred(), h = harness({ request }); await h.call.start(); h.speak(); h.call.toggleMute();
  request.reject(new Error('Reply unavailable.')); await tick(); assert.equal(h.status(), 'muted');
  assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.recorderCount, 1); assert.equal(h.state.microphoneMuted, true);
  h.call.toggleMute(); assert.equal(h.status(), 'recovering'); assert.equal(h.state.recorderCount, 2); h.call.dispose();
});

test('muting during recovery status never reactivates capture', async () => {
  const options = { submit: () => Promise.reject(new Error('Reply unavailable.')) }, h = harness(options);
  options.onStatus = value => { if (value.state === 'recovering') { options.onStatus = undefined; h.call.toggleMute(); } };
  await h.call.start(); h.speak(); await tick();
  assert.equal(h.status(), 'muted'); assert.equal(h.state.microphoneMuted, true); assert.equal(h.state.recorderCount, 1);
  assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneClosed, 0); assert.equal(h.state.timers.size, 0);
  h.call.toggleMute(); assert.equal(h.status(), 'recovering'); assert.equal(h.state.recorderCount, 2); h.call.dispose();
});

test('hang-up during recovery status closes media and prevents capture from restarting', async () => {
  const options = { submit: () => Promise.reject(new Error('Reply unavailable.')) }, h = harness(options);
  options.onStatus = value => { if (value.state === 'recovering') h.call.hangUp(); };
  await h.call.start(); h.speak(); await tick(); h.sample(600000);
  assert.equal(h.status(), 'ended'); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.recorderCount, 1);
  assert.equal(h.state.players.length, 0); assert.equal(h.state.timers.size, 0); assert.equal(h.state.submits.length, 1);
});

test('late failed replies after cancellation cannot start audio or revive a call', async () => {
  for (const dispose of [false, true]) {
    const request = deferred(), h = harness({ request }); await h.call.start(); h.speak();
    if (dispose) h.call.dispose(); else h.call.hangUp(); const status = h.status();
    request.reject(new Error('Late provider failure.')); await tick();
    assert.equal(h.status(), status); assert.equal(h.state.players.length, 0); assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.timers.size, 0);
  }
});

test('explicit authentication and access failures end the call without substitute speech', async () => {
  for (const reason of ['authentication', 'access']) {
    const h = harness({ submit: () => Promise.reject(new WattzunVoiceCallError('Current workspace access is required.', reason)) });
    await h.call.start(); h.speak(); await tick(); assert.equal(h.status(), 'error');
    assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.players.length, 0); assert.equal(h.state.timers.size, 0); assert.equal(h.state.submits.length, 1);
  }
  const permission = deferred(), greeting = deferred(), h = harness({ permission, greeting }), started = h.call.start();
  greeting.reject(new WattzunVoiceCallError('Sign in to continue.', 'authentication')); await tick(); assert.equal(h.status(), 'error');
  assert.equal(h.state.greetings[0].signal.aborted, true); permission.resolve(h.microphone); await started;
  assert.equal(h.state.microphoneClosed, 1); assert.equal(h.state.recorderCount, 0); assert.equal(h.state.players.length, 0);
});
