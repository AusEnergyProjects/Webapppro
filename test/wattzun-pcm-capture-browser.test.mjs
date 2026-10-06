import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const bundle = await build({
  stdin: { resolveDir: root, loader: "js", contents: `
    import {createWattzunPcmCapture} from './src/lib/wattzun-pcm-capture.ts';
    let context, source, capture, recorder;
    window.fixture={started:false,done:false,error:null};
    document.getElementById('start').onclick=async()=>{
      try {
        context=new AudioContext({sampleRate:48000}); await context.resume();
        source=context.createOscillator(); source.frequency.value=440;
        capture=await createWattzunPcmCapture(context,source);
        recorder=capture.recorder();
        recorder.onError=()=>{window.fixture.error='Processor error';};
        recorder.onData=async audio=>{
          const bytes=await audio.arrayBuffer(),data=new DataView(bytes);
          let energy=0;for(let offset=44;offset<bytes.byteLength;offset+=2)energy+=(data.getInt16(offset,true)/32768)**2;
          window.fixture.result={size:audio.size,mime:audio.type,rate:data.getUint32(24,true),channels:data.getUint16(22,true),bits:data.getUint16(34,true),dataBytes:data.getUint32(40,true),rms:Math.sqrt(energy/((bytes.byteLength-44)/2)),contextRate:context.sampleRate,elapsed:window.fixture.stoppedAt-window.fixture.startedAt};
          capture.close(); capture.close(); source.stop();
          window.fixture.contextStillOpen=context.state!=='closed'; await context.close();window.fixture.done=true;
        };
        recorder.start();source.start();window.fixture.startedAt=context.currentTime;window.fixture.started=true;
        window.fixture.ready=()=>context.currentTime-window.fixture.startedAt>=.25;
      } catch(error) {window.fixture.error=error.message;}
    };
    document.getElementById('stop').onclick=()=>{window.fixture.stoppedAt=context.currentTime;recorder.stop();};
  ` },
  bundle: true, write: false, format: "iife", target: "es2022",
});

test("native Chrome loads same-origin worklet modules and captures resampled WAV without MediaRecorder", { skip: !browserPath, timeout: 20000 }, async () => {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self'; worker-src 'self'" });
      response.end('<button id="start">Start synthetic capture</button><button id="stop">Stop</button><script src="/fixture.js"></script>');
    } else if (pathname === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(bundle.outputFiles[0].text);
    } else if (["/wattzun-voice-worklet.js", "/wattzun-pcm-resampler.js"].includes(pathname)) {
      response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(fs.readFileSync(new URL(`../public${pathname}`, import.meta.url), "utf8"));
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.getByRole("button", { name: "Start synthetic capture" }).click();
    await page.waitForFunction(() => window.fixture.started || window.fixture.error);
    assert.equal(await page.evaluate(() => window.fixture.error), null);
    await page.waitForFunction(() => window.fixture.ready()); await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForFunction(() => window.fixture.done || window.fixture.error);
    const value = await page.evaluate(() => window.fixture);
    assert.equal(value.error, null); assert.equal(value.result.mime, "audio/wav"); assert.equal(value.result.rate, 24000);
    assert.equal(value.result.channels, 1); assert.equal(value.result.bits, 16); assert.equal(value.result.contextRate, 48000);
    assert.equal(value.result.dataBytes + 44, value.result.size); assert.ok(value.result.size > 44 && value.result.size < 2160044);
    assert.ok(Math.abs(value.result.dataBytes / 48000 - value.result.elapsed) < .04, "Resampled duration tracks device-context duration");
    assert.ok(value.result.rms > .6 && value.result.rms < .75, "Native processor received the oscillator signal");
    assert.equal(value.contextStillOpen, true, "Capture leaves context ownership with the caller");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
