import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const frame = value => `${JSON.stringify(value)}\n`;
const reply = { kind: "answer", message: "Synthetic workflow answer.", questions: [], links: [] };
function pcm(seconds) {
  const bytes = new Uint8Array(Math.round(24_000 * seconds) * 2), view = new DataView(bytes.buffer);
  for (let sample = 0; sample < bytes.length / 2; sample++) view.setInt16(sample * 2, Math.sin(sample / 24_000 * Math.PI * 440) * 2000, true);
  return Buffer.from(bytes).toString("base64");
}
const bundle = await build({ entryPoints: ["scripts/wattzun-voice-eval-browser.mjs"], absWorkingDir: root,
  bundle: true, write: false, format: "iife", target: "es2022" });

test("native Chrome rehearses greetings, repeated tasks, quiet recovery, navigation, interruption, mute and cancellation", {
  skip: !browserPath, timeout: 120_000,
}, async t => {
  const captured = [], cancelled = [], timers = new Set();
  let releaseHeldReply;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(bundle.outputFiles[0].text); return;
    }
    if (["/wattzun-voice-worklet.js", "/wattzun-pcm-resampler.js"].includes(url.pathname)) {
      response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(fs.readFileSync(new URL(`../public${url.pathname}`, import.meta.url))); return;
    }
    if (url.pathname === "/greeting" || url.pathname === "/reply") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      if (url.pathname === "/reply") {
        const audio = Buffer.concat(chunks); captured.push(audio);
        assert.equal(audio.toString("ascii", 0, 4), "RIFF"); assert.equal(audio.readUInt32LE(24), 24_000);
        assert.equal(audio.readUInt16LE(22), 1); assert.equal(audio.readUInt16LE(34), 16);
        assert.equal(audio.readUInt32LE(40), audio.length - 44);
      }
      const mode = url.searchParams.get("mode");
      if (mode === "held") await new Promise(resolve => { releaseHeldReply = resolve; });
      if (mode === "unavailable") { response.writeHead(503, { "Content-Type": "application/json" }); response.end('{"error":"Synthetic provider failure"}'); return; }
      response.writeHead(200, { "Content-Type": "application/x-wattzun-realtime-voice+ndjson" });
      response.write(frame({ type: "reply", transcript: "", requestSummary: "Synthetic spoken task.", reply }));
      const audioData = pcm(mode === "long" ? 3 : mode === "late-error" ? .6 : .08);
      for (let offset = 0; offset < audioData.length; offset += 32_000) {
        response.write(frame({ type: "audio", data: audioData.slice(offset, offset + 32_000) }));
      }
      if (mode === "long") {
        const timer = setTimeout(() => { timers.delete(timer); response.end(frame({ type: "done" })); }, 5_000);
        timers.add(timer); response.on("close", () => {
          if (timers.has(timer)) cancelled.push(mode);
          clearTimeout(timer); timers.delete(timer);
        });
      } else if (mode === "late-error") {
        const timer = setTimeout(() => { timers.delete(timer); response.destroy(new Error("Synthetic stream break")); }, 100);
        timers.add(timer);
      } else response.end(frame({ type: "done" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html", "Permissions-Policy": "microphone=(self)",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'" });
    response.end('<div id="status">idle</div><div id="workspace">initial</div><button id="call">Call</button><button id="speak">Speak synthetic turn</button><button id="sentence-pause">Speak with a sentence pause</button><button id="interrupt">Interrupt</button><button id="mute">Mute</button><button id="navigate">Navigate</button><button id="hangup">Hang up</button><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--mute-audio"] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const status = async expected => page.waitForFunction(value => value === "thinking"
      ? window.voiceEval.state.statuses.some(status => status.state === value && status.at >= window.voiceEval.state.turnStartedAt)
      : document.getElementById("status").textContent === value, expected, { timeout: 12_000 });
    const mode = value => page.evaluate(value => window.voiceEval.mode(value), value);
    const speak = async value => { await mode(value); await page.getByRole("button", { name: "Speak synthetic turn", exact: true }).click(); };
    await page.getByRole("button", { name: "Call", exact: true }).click(); await status("listening");
    const greeting = await page.evaluate(() => window.voiceEval.state);
    assert.ok(greeting.statuses.some(value => value.state === "speaking"));
    assert.ok(greeting.statuses.find(value => value.state === "speaking").at - greeting.startedAt < 2_000);
    await page.getByRole("button", { name: "Speak with a sentence pause", exact: true }).click();
    await page.waitForFunction(() => performance.now() - window.voiceEval.state.turnStartedAt > 1_400);
    assert.equal(captured.length, 0, "The 1100ms sentence pause must not submit a partial task");
    await status("thinking"); await status("listening");
    const pausedTurn = captured[0];
    assert.ok(pausedTurn.length > 44 + 24_000 * 2 * 3, "Both clauses and the final bounded silence remain in the WAV");
    const rmsAt = second => {
      let squares = 0;
      for (let sample = second * 24_000; sample < second * 24_000 + 2_400; sample++) squares += (pausedTurn.readInt16LE(44 + sample * 2) / 32_768) ** 2;
      return Math.sqrt(squares / 2_400);
    };
    assert.ok(rmsAt(.2) > .025); assert.ok(rmsAt(.9) < .005); assert.ok(rmsAt(1.7) > .025);
    for (let turn = 0; turn < 12; turn++) {
      await speak("normal"); await status("thinking"); await status("listening");
    }
    assert.equal(await page.evaluate(() => window.voiceEval.state.replies.length), 13);
    await speak("unavailable"); await status("thinking"); await status("recovering");
    const recovering = await page.evaluate(() => window.voiceEval.state);
    assert.equal(recovering.statuses.at(-1).message, "No spoken reply was completed. Your call is still connected and listening.");
    assert.equal(recovering.microphoneRequests, 1); assert.equal(recovering.replies.length, 13);
    assert.equal(recovering.submissions.length, 14); assert.equal(recovering.replacementSpeech, 0);
    await speak("normal"); await status("thinking"); await status("listening");
    const resumed = await page.evaluate(() => window.voiceEval.state);
    assert.equal(resumed.microphoneRequests, 1); assert.equal(resumed.replies.length, 14);
    assert.equal(resumed.submissions.length, 15); assert.equal(resumed.replacementSpeech, 0);
    await speak("late-error"); await status("speaking");
    await page.getByRole("button", { name: "Navigate", exact: true }).click();
    assert.match(new URL(page.url()).pathname, /^\/workspace\//); await status("recovering");
    await speak("long"); await status("speaking");
    await page.getByRole("button", { name: "Interrupt", exact: true }).click(); await status("listening");
    await page.getByRole("button", { name: "Mute", exact: true }).click(); await status("muted");
    const beforeMute = captured.length; await speak("normal");
    await page.waitForFunction(() => performance.now() - window.voiceEval.state.turnStartedAt > 1_500);
    assert.equal(captured.length, beforeMute);
    await page.getByRole("button", { name: "Mute", exact: true }).click(); await status("listening");
    await speak("normal"); await status("thinking"); await status("listening");
    const beforeQueued = captured.length;
    await speak("held"); await status("thinking");
    await page.waitForFunction(() => window.voiceEval.state.submissions.at(-1)?.mode === "held");
    await speak("normal");
    await page.waitForFunction(() => performance.now() - window.voiceEval.state.turnStartedAt > 2_200);
    assert.equal(captured.length, beforeQueued + 1, "A follow-on utterance cannot race the preceding request");
    releaseHeldReply(); releaseHeldReply = undefined;
    await status("listening");
    const queued = await page.evaluate(() => window.voiceEval.state.submissions.slice(-2));
    assert.equal(queued[0].mode, "held"); assert.equal(queued[0].firstAudio, null, "The superseded question is not spoken");
    assert.equal(queued[1].mode, "normal"); assert.equal(queued[1].historyLength, queued[0].historyLength + 1);
    assert.equal(captured.length, beforeQueued + 2, "The retained follow-on WAV is submitted exactly once");
    const result = await page.evaluate(() => window.voiceEval.state);
    assert.equal(result.microphoneRequests, 1); assert.equal(result.replacementSpeech, 0); assert.equal(result.failure, null);
    assert.equal(result.replies.length, 19); assert.equal(result.submissions.length, 20);
    assert.ok(result.statuses.filter(value => value.state === "recovering").length >= 2);
    assert.ok(result.submissions.every(value => value.size > 4_844 && value.mime === "audio/wav"));
    assert.ok(result.submissions.at(-1).historyLength > 12, "The continuing call retains previous successful replies");
    const firstPlayback = result.submissions.filter(value => value.firstAudio !== null).map(value => value.firstAudio).sort((a, b) => a - b);
    assert.equal(firstPlayback.length, 18);
    t.diagnostic(JSON.stringify({ evidence: result.evidence, submissions: result.submissions.length, replies: result.replies.length,
      microphoneRequests: result.microphoneRequests, replacementSpeech: result.replacementSpeech,
      firstPlaybackAfterSubmitMs: { median: Math.round(firstPlayback[Math.floor(firstPlayback.length / 2)]),
        maximum: Math.round(firstPlayback.at(-1)) } }));
    await page.getByRole("button", { name: "Hang up", exact: true }).click(); await status("ended");
    await page.evaluate(() => window.voiceEval.cleanup());
    assert.ok(cancelled.includes("long"));
  } finally {
    releaseHeldReply?.();
    if (browser) await browser.close(); for (const timer of timers) clearTimeout(timer);
    await new Promise(resolve => server.close(resolve));
  }
});
