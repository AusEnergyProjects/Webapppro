import { WattzunVoiceCall, createWattzunBrowserVoiceEnvironment } from "../src/lib/wattzun-voice-client.ts";
import { readWattzunVoiceStream } from "../src/lib/wattzun-voice-stream.ts";
import { WATTZUN_REALTIME_VOICE_STREAM_TYPE } from "../src/lib/wattzun-portal.ts";

// Test-only microphone: a generated signal enters the production native capture
// graph. This harness never requests permission or captures an ambient device.
let inputContext, destination, call, mode = "normal", inputSource;
const state = {
  evidence: "native browser audio with a synthetic provider",
  statuses: [], submissions: [], replies: [], microphoneRequests: 0,
  replacementSpeech: 0, failure: null, startedAt: 0, turnStartedAt: 0,
};
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async constraints => {
  if (!constraints.audio || constraints.video !== false) throw new Error("Fixture expected audio only");
  state.microphoneRequests++;
  inputContext = new AudioContext({ sampleRate: 48_000 });
  await inputContext.resume();
  destination = inputContext.createMediaStreamDestination();
  return destination.stream;
} });
Object.defineProperty(window, "speechSynthesis", { configurable: true, get() {
  state.replacementSpeech++;
  throw new Error("A device voice must never replace Wattzun");
} });

function isReply(value) {
  return value?.kind === "answer" && typeof value.message === "string"
    && Array.isArray(value.questions) && Array.isArray(value.links);
}
async function responseAudio(path, signal, audio) {
  const response = await fetch(path, { method: "POST", ...(audio ? { body: audio } : {}),
    headers: { Accept: WATTZUN_REALTIME_VOICE_STREAM_TYPE }, signal });
  return readWattzunVoiceStream(response, signal, isReply);
}
function start() {
  state.startedAt = performance.now();
  call?.dispose();
  call = new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(), {
    greeting: async signal => (await responseAudio("/greeting", signal)).audio,
    status: value => {
      const at = performance.now();
      state.statuses.push({ ...value, at });
      const submission = state.submissions.at(-1);
      if (value.state === "speaking" && submission && submission.firstAudio === null) submission.firstAudio = at - submission.started;
      document.getElementById("status").textContent = value.state;
    },
    async submit(audio, signal) {
      const submission = { mode, size: audio.size, mime: audio.type, started: performance.now(),
        latency: null, firstAudio: null, historyLength: state.replies.length };
      state.submissions.push(submission);
      const result = await responseAudio(`/reply?mode=${mode}`, signal, audio);
      submission.latency = performance.now() - submission.started;
      return result;
    },
    reply: value => state.replies.push(value.reply),
  });
  void call.start().catch(error => { state.failure = error.message; });
}
function speak(withSentencePause = false) {
  if (!inputContext || !destination) throw new Error("Synthetic microphone is not ready");
  inputSource?.stop();
  inputSource = inputContext.createOscillator();
  const gain = inputContext.createGain(); gain.gain.value = .15;
  inputSource.frequency.value = 220;
  inputSource.connect(gain); gain.connect(destination);
  state.turnStartedAt = performance.now();
  const startAt = inputContext.currentTime;
  if (withSentencePause) {
    gain.gain.setValueAtTime(.15, startAt);
    gain.gain.setValueAtTime(0, startAt + .4);
    gain.gain.setValueAtTime(.15, startAt + 1.5);
  }
  inputSource.start(); inputSource.stop(startAt + (withSentencePause ? 2 : .5));
}
document.getElementById("call").onclick = start;
document.getElementById("speak").onclick = () => speak();
document.getElementById("sentence-pause").onclick = () => speak(true);
document.getElementById("interrupt").onclick = () => call.interrupt();
document.getElementById("mute").onclick = () => call.toggleMute();
document.getElementById("navigate").onclick = () => {
  history.pushState({}, "", `/workspace/${state.replies.length + 1}`);
  document.getElementById("workspace").textContent = location.pathname;
};
document.getElementById("hangup").onclick = () => call.hangUp();
window.voiceEval = {
  state,
  mode(value) { mode = value; },
  async cleanup() {
    call?.dispose();
    inputSource?.disconnect();
    for (const track of destination?.stream.getTracks() || []) track.stop();
    if (inputContext?.state !== "closed") await inputContext?.close();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: originalGetUserMedia });
  },
};
