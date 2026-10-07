import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const bundle = await build({ stdin: { resolveDir: root, loader: "js", contents: `
  import {WattzunVoiceCall,createWattzunBrowserVoiceEnvironment} from './src/lib/wattzun-voice-client.ts';
  const state=window.idleVoice={statuses:[],submissions:[],microphoneRequests:0,error:null};
  let input,source,call;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
    state.microphoneRequests++;input=new AudioContext({sampleRate:48000});await input.resume();
    const destination=input.createMediaStreamDestination();state.inputDestination=destination;
    return destination.stream;
  }});
  document.getElementById('call').onclick=async()=>{
    try {
      call=new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(),{
        status:value=>state.statuses.push({...value,at:performance.now()}),reply:()=>{},
        async submit(audio){
          const submitted=performance.now(),bytes=await audio.arrayBuffer(),data=new DataView(bytes);
          let first=null,last=null;
          for(let start=44;start<bytes.byteLength;start+=480){let sum=0,count=0;for(let offset=start;offset<Math.min(start+480,bytes.byteLength);offset+=2){sum+=(data.getInt16(offset,true)/32768)**2;count++;}
            if(Math.sqrt(sum/count)>.025){if(first===null)first=(start-44)/48000;last=(start-44)/48000+count/24000;}}
          state.submissions.push({bytes:bytes.byteLength,duration:(bytes.byteLength-44)/48000,first,last,submitted});
          return {ok:true,transcript:'',reply:{kind:'answer',message:'Synthetic test reply',questions:[],links:[]},audio:{mimeType:'audio/pcm',stream:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4800));controller.close();}})}};
        },
      });
      await call.start();state.started=performance.now();
      const buffer=input.createBuffer(1,480000,48000),samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=.2*Math.sin(2*Math.PI*440*i/48000);
      source=input.createBufferSource();source.buffer=buffer;source.connect(state.inputDestination);
      source.onended=()=>{state.inputEnded=performance.now();};
      state.speechStartsAt=input.currentTime+43;source.start(state.speechStartsAt);
      state.inputTime=()=>input.currentTime;
    } catch(error){state.error=error.message;}
  };
  window.cleanupIdleVoice=async()=>{call?.dispose();source?.disconnect();await input?.close();};
` }, bundle: true, write: false, format: "iife", target: "es2022" });

test("native Chrome captures the complete ten-second sentence after 43 seconds idle on the same microphone", {skip:!browserPath,timeout:90000},async t=>{
  const server=createServer((request,response)=>{
    const pathname=new URL(request.url,"http://127.0.0.1").pathname;
    if(pathname==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"});response.end(bundle.outputFiles[0].text);return;}
    if(["/wattzun-voice-worklet.js","/wattzun-pcm-resampler.js"].includes(pathname)){response.writeHead(200,{"Content-Type":"application/javascript"});response.end(fs.readFileSync(new URL(`../public${pathname}`,import.meta.url)));return;}
    response.writeHead(200,{"Content-Type":"text/html"});response.end('<button id="call">Start idle call</button><script src="/fixture.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let browser;
  try {
    browser=await chromium.launch({executablePath:browserPath,headless:true,args:["--mute-audio"]});const page=await browser.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole("button",{name:"Start idle call"}).click();
    await page.waitForFunction(()=>window.idleVoice.started||window.idleVoice.error);assert.equal(await page.evaluate(()=>window.idleVoice.error),null);
    await page.waitForFunction(()=>window.idleVoice.inputTime()>=window.idleVoice.speechStartsAt-.1,{},{timeout:65000});
    assert.equal(await page.evaluate(()=>window.idleVoice.submissions.length),0,"Long idle silence does not call the provider");
    await page.waitForFunction(()=>window.idleVoice.submissions.length||window.idleVoice.error,{},{timeout:20000});
    const state=await page.evaluate(()=>({error:window.idleVoice.error,submissions:window.idleVoice.submissions,microphoneRequests:window.idleVoice.microphoneRequests,statuses:window.idleVoice.statuses}));
    assert.equal(state.error,null);assert.equal(state.microphoneRequests,1);assert.equal(state.submissions.length,1);
    const capture=state.submissions[0];assert.ok(capture.first>=0&&capture.first<1,"Opening voiced audio is retained inside the bounded pre-roll");
    assert.ok(capture.last-capture.first>=9.9&&capture.last-capture.first<10.15,JSON.stringify(capture));
    assert.ok(capture.duration<13&&capture.bytes<=2160044,"Idle silence is omitted and the audio byte cap is retained");
    assert.deepEqual(errors,[]);t.diagnostic(JSON.stringify({microphoneRequests:state.microphoneRequests,...capture}));
    await page.evaluate(()=>window.cleanupIdleVoice());
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
