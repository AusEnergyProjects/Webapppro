import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const fixtures = {
  auth: `export function onAuthStateChanged(_auth, callback) { window.wattzunFixtureAuth=callback; callback({uid:'synthetic-user',displayName:'Synthetic Organisation',emailVerified:true,getIdToken:async()=>'synthetic-token'}); return ()=>{}; }`,
  firebase: 'export const firebaseAuth = {};',
  business: `export const readTradeBusinessSelection = () => 'synthetic-business'; export const TRADE_BUSINESS_SELECTION_CHANGED_EVENT='tlink:business-selection-changed';`,
  link: `import React from 'react'; export default function Link({href,onNavigate,prefetch,...props}) { return <a {...props} href={href} onClick={event=>{ if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return; event.preventDefault(); let prevented=false; onNavigate?.({preventDefault(){prevented=true;}}); if(!prevented){history.pushState(history.state,'',href);window.dispatchEvent(new Event('fixture:navigate'));}}}/>; }`,
  navigation: `import {useSyncExternalStore} from 'react'; export function usePathname(){return useSyncExternalStore(callback=>{window.addEventListener('popstate',callback);window.addEventListener('fixture:navigate',callback);return()=>{window.removeEventListener('popstate',callback);window.removeEventListener('fixture:navigate',callback);}},()=>location.pathname);}export const useRouter=()=>({push:href=>{history.pushState(history.state,'',href);window.dispatchEvent(new Event('fixture:navigate'));}});`,
  public: `export const LazyPublicEnergyAssistantWidget=()=>null;`,
  picker: `export const WattzunRecordPicker=()=>null;`,
  review: `import React from 'react';export function WattzunActionReview({onCreated,onCancel}) {return <section aria-label="Synthetic reviewed action"><button onClick={()=>onCreated({kind:'quote_draft',id:'saved-quote-23',workOrderId:'saved-job-23',versionId:'saved-version-23',href:'/direct-trade/dashboard?workspace=work&jobId=saved-job-23&jobTab=quote',label:'Open saved quote draft'})}>Confirm synthetic quote</button><button onClick={onCancel}>Cancel synthetic quote</button></section>;}`,
  // The real call lifecycle has deterministic clock tests. This fixture checks only the real UI wiring,
  // with no microphone, audio playback or provider access.
  voice: `
    export const createWattzunBrowserVoiceEnvironment = () => ({});
    export class WattzunVoiceCallError extends Error {
      constructor(message,reason) { super(message);this.name='WattzunVoiceCallError';this.reason=reason; }
    }
    export class WattzunVoiceCall {
      constructor(_environment,callbacks) { this.callbacks=callbacks; this.muted=false; window.wattzunFixtureCall=this; }
      async start() {
        window.wattzunFixtureCounters.started++;
        if(window.wattzunFixtureGreetingEnabled) {
          this.callbacks.status({state:'connecting',message:'Connecting to Wattzun.'});
          let audio;
          try { audio=await this.callbacks.greeting(new AbortController().signal); }
          catch(error) {this.requestFailed(error);return;}
          if(audio.mimeType!=='audio/pcm') throw new Error('Greeting must provide native PCM.');
          const reader=audio.stream.getReader();
          try {
            while(true) {
              const chunk=await reader.read();if(chunk.done) break;
              window.wattzunFixtureGreetingPcm.push(...chunk.value);
            }
          } finally { await reader.cancel();reader.releaseLock(); }
        }
        this.callbacks.status({state:'listening',message:'Listening for your question.'});
      }
      recover(message='That reply did not come through. Please say that last part again.') { this.callbacks.status({state:'recovering',message}); }
      resume() { this.callbacks.status({state:this.muted?'muted':'listening',message:'Listening for your question.'}); }
      requestFailed(error) {
        window.wattzunFixtureErrors.push({name:error.name,message:error.message,reason:error.reason});
        this.callbacks.status({state:error instanceof WattzunVoiceCallError?'error':'recovering',message:error.message});
      }
      async question() {
        this.callbacks.status({state:'thinking',message:''});
        try {
          const result=await this.callbacks.submit(new Blob([new Uint8Array(48)],{type:'audio/wav'}),new AbortController().signal);
          this.callbacks.reply(result);if(result.audio.mimeType==='audio/pcm')await result.audio.stream.cancel();this.resume();
        } catch(error) {this.requestFailed(error);}
      }
      toggleMute() { this.muted=!this.muted; this.callbacks.status({state:this.muted?'muted':'listening',message:this.muted?'Microphone muted.':'Listening for your question.'}); }
      hangUp() { window.wattzunFixtureCounters.hungUp++; this.callbacks.status({state:'ended',message:'Call ended.'}); }
      dispose() { window.wattzunFixtureCounters.disposed++; }
      interrupt() {}
    }
  `,
};
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { LazyEnergyAssistantWidget } from './src/components/LazyEnergyAssistantWidget';
    import { WattzunMascot } from './src/components/WattzunMascot';
    import { WATTZUN_HATS, WATTZUN_USAGE_CHANGED_EVENT, useWattzunPresentation, requestWattzunAssistant } from './src/lib/wattzun-appearance';
    window.wattzunFixtureOpen=requestWattzunAssistant;
    window.wattzunFixtureUsage=[];
    window.addEventListener(WATTZUN_USAGE_CHANGED_EVENT,event=>window.wattzunFixtureUsage.push(event.detail));
    window.wattzunFixtureRequests=[];
    window.wattzunFixtureCounters={started:0,hungUp:0,disposed:0};
    window.wattzunFixtureErrors=[];
    window.wattzunFixtureGreetingEnabled=window.wattzunFixtureGreetingEnabled??false;
    window.wattzunFixtureGreetingPcm=[];
    window.fetch=async (url,options={})=>{
      const body=options.body instanceof FormData?JSON.parse(options.body.get('request')):options.body?JSON.parse(options.body):null;
      window.wattzunFixtureRequests.push({url,headers:options.headers,body});
      const failure=window.wattzunFixtureFailures?.[url];
      if(failure?.network)throw new Error(failure.message);
      if(failure)return Response.json({ok:false,error:failure.message},{status:failure.status});
      if(url.startsWith('/api/wattzun/portal?portal=')) { const portal=new URL(url,location.origin).searchParams.get('portal');return Response.json({ok:true,scopes:window.wattzunFixtureScopes||[{portal,scopeId:portal==='trade'?'synthetic-business':'synthetic-'+portal,label:'Synthetic '+portal+' business',personalName:'Alex'}]}); }
      if(url==='/api/wattzun/greeting'&&options.method==='POST') {
        const frames=[{type:'reply',transcript:'',reply:{kind:'answer',message:"Hi Alex, I'm here. What can I help you with?",questions:[],links:[]}},
          {type:'audio',data:'EIAgAQ=='},{type:'done'}];
        return new Response(frames.map(frame=>JSON.stringify(frame)).join('\\n')+'\\n',
          {headers:{'Content-Type':'application/x-wattzun-realtime-voice+ndjson'}});
      }
      if(url==='/api/wattzun/voice'&&options.method==='POST') {
        const frames=[{type:'reply',transcript:'',requestSummary:'User asks how to find Schedule.',reply:{kind:'answer',message:'Open Schedule to review your visits.',questions:[],links:[]}},
          {type:'audio',data:'EIAgAQ=='},{type:'done'}];
        return new Response(frames.map(frame=>JSON.stringify(frame)).join('\\n')+'\\n',
          {headers:{'Content-Type':'application/x-wattzun-realtime-voice+ndjson'}});
      }
      if(url==='/api/wattzun/portal'&&options.method==='POST') return Response.json({ok:true,reply:{kind:'clarification',message:'I can help you follow up the sale. Tell me a little more so I can point you to the right next step.',questions:['Which job are you following up?','Do you want to call the customer or review the quote?'],links:window.wattzunFixtureLinks||[{label:'Open Sales',href:'/direct-trade/dashboard?workspace=sales'}],...(window.wattzunFixtureAction?{action:window.wattzunFixtureAction}:{})}});
      throw new Error('Unexpected fixture request: '+url);
    };
    function FixtureTools() {
      const presentation=useWattzunPresentation({userUid:'synthetic-user',portal:'trade',scopeId:'synthetic-business'});
      window.wattzunFixturePresentation={speed:presentation.speed,hat:presentation.hat};
      const open=mode=>void requestWattzunAssistant({userUid:'synthetic-user',portal:'trade',scopeId:'synthetic-business',mode,initialMessage:mode==='message'?'Help me follow up the sale':undefined});
      return <section aria-label="Synthetic Tools"><WattzunMascot hat={presentation.hat}/><label>Wattzun hat<select aria-label="Wattzun hat" value={presentation.hat} onChange={event=>presentation.setHat(event.target.value)}>{WATTZUN_HATS.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><button onClick={()=>open('message')}>Message from Tools</button><button onClick={()=>open('call')}>Call from Tools</button></section>;
    }
    createRoot(document.getElementById('root')).render(<><FixtureTools/><LazyEnergyAssistantWidget /></>);
  ` },
  bundle: true, write: false, outfile: 'wattzun.js', format: 'iife', jsx: 'automatic', external:['/surge-mascot.webp'],
  plugins: [{ name: 'synthetic-wattzun-scope', setup(builder) {
    for (const [filter, fixture] of [
      [/^firebase\/auth$/, 'auth'], [/^@\/lib\/firebase-client$/, 'firebase'],
      [/^@\/lib\/trade-business-client$/, 'business'],
      [/^@\/lib\/wattzun-voice-client$/, 'voice'],
      [/^next\/link$/, 'link'], [/^next\/navigation$/, 'navigation'], [/LazyPublicEnergyAssistantWidget$/, 'public'],
      [/WattzunRecordPicker$/, 'picker'],
      [/WattzunActionReview$/, 'review'],
    ]) builder.onResolve({ filter }, () => ({ path: fixture, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-portal$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-portal.ts') }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-appearance$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-appearance.ts') }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-portal-path$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-portal-path.ts') }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-records$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-records.ts') }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-actions$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-actions.ts') }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const modes = fs.readFileSync(path.join(root, 'src/app/tlink-colour-mode.css'), 'utf8');

test('Wattzun speed settings, clarifications and connected recovery remain usable in desktop and mobile day/night layouts', { skip: !browserPath && 'No installed browser for layout checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [{name:'desktop-day',width:1366,height:900,mode:'day'}, {name:'desktop-night',width:1366,height:900,mode:'night'}, {name:'mobile-day',width:390,height:844,mode:'day'}, {name:'mobile-night',width:390,height:844,mode:'night'}]) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://fixture.invalid/**', route => route.fulfill(route.request().url().endsWith('/surge-mascot.webp')
        ? {status:200,contentType:'image/webp',body:fs.readFileSync(path.join(root,'public/surge-mascot.webp'))}
        : {status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid/direct-trade/dashboard');
      await page.setContent(`<html data-tlink-colour-mode="${scenario.mode}"><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:${scenario.mode==='night'?'#0c1c1b':'#e9f0ee'}}*{box-sizing:border-box}${modes}${css}</style></head><body><main class="trade-portal-shell"><div id="root"></div></main></body></html>`);
      await page.evaluate(() => localStorage.setItem('wattzun-preferences:v1:synthetic-user:trade:synthetic-business', JSON.stringify({speed:.85,voice:'obsolete',tone:'obsolete',personality:'Obsolete private preference'})));
      await page.addScriptTag({ content: script });
      const launcher = page.getByRole('button', {name:'Open Wattzun AI chat',exact:true});
      await launcher.waitFor();
      await page.getByRole('combobox',{name:'Wattzun hat',exact:true}).selectOption('hard-hat');
      await page.waitForFunction(()=>document.querySelectorAll('[data-wattzun-hat="hard-hat"]').length===3);
      await launcher.click();
      const dialog = page.getByRole('dialog', {name:'Wattzun',exact:true});
      await dialog.waitFor();
      assert.equal(await dialog.locator(':focus').count(), 1, 'Opening Wattzun moves focus into its modal');
      assert.equal(await dialog.evaluate(element=>getComputedStyle(element).backgroundColor), scenario.mode==='night'?'rgb(16, 38, 37)':'rgb(255, 255, 255)', 'The actual scoped theme colours apply');
      assert.equal(await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).count(), 1);
      assert.equal(await dialog.locator('[data-wattzun-hat="hard-hat"]').count(),1);
      await dialog.getByText('Speech speed', {exact:true}).click();
      const speed = dialog.getByRole('combobox', {name:'Speaking speed',exact:true});
      assert.equal(await speed.inputValue(), '0.85', 'Legacy speed survives while the obsolete settings are removed');
      assert.equal(await dialog.getByRole('combobox').count(), 1);
      assert.equal(await dialog.getByLabel('Tone', {exact:true}).count(), 0);
      assert.equal(await dialog.getByLabel('Personality note', {exact:true}).count(), 0);
      await speed.selectOption('1.15');
      await page.waitForFunction(()=>localStorage.getItem('wattzun-preferences:v2:synthetic-user:trade:synthetic-business')==='{"speed":1.15}');
      assert.equal(await page.evaluate(()=>window.wattzunFixturePresentation.speed),1.15,'Tools and assistant share the same speed source');
      assert.equal(await page.evaluate(()=>localStorage.getItem('wattzun-preferences:v1:synthetic-user:trade:synthetic-business')), null);
      await screenshot(page, scenario.name, 'settings');
      await dialog.getByLabel('Message Wattzun', {exact:true}).fill('Help me follow up the sale');
      await dialog.getByRole('button', {name:'Send',exact:true}).click();
      const conversation = dialog.getByRole('log', {name:'Conversation with Wattzun'});
      await conversation.getByText('Which job are you following up?', {exact:true}).waitFor();
      assert.equal(await conversation.getByText('Do you want to call the customer or review the quote?', {exact:true}).count(), 1);
      assert.equal(await conversation.getByRole('link', {name:'Open Sales'}).getAttribute('href'), '/direct-trade/dashboard?workspace=sales');
      const requests = await page.evaluate(()=>window.wattzunFixtureRequests);
      assert.equal(requests.length, 2);
      assert.equal(requests[1].headers.Authorization, 'Bearer synthetic-token');
      assert.deepEqual(requests[1].body.preferences, {speed:1.15});
      assert.equal(requests[1].body.scopeId, 'synthetic-business');
      assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureUsage),[{userUid:'synthetic-user',portal:'trade',scopeId:'synthetic-business'}]);
      await screenshot(page, scenario.name, 'clarification');
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).click();
      await dialog.getByText('Listening', {exact:true}).waitFor();
      assert.equal(await dialog.getByLabel('Message Wattzun', {exact:true}).isDisabled(), true);
      await page.evaluate(()=>window.wattzunFixtureCall.recover());
      await dialog.getByText('Still connected', {exact:true}).waitFor();
      await dialog.getByText('That reply did not come through. Please say that last part again.', {exact:true}).waitFor();
      for(const name of ['Mute microphone','Hang up']) assert.ok((await dialog.getByRole('button',{name,exact:true}).boundingBox()).height>=42);
      assert.equal(await dialog.getByRole('group',{name:'Call check-in',exact:true}).count(),0);
      assert.equal(await dialog.getByRole('button',{name:'Continue call',exact:true}).count(),0);
      await screenshot(page, scenario.name, 'call-recovery');
      await dialog.getByRole('button',{name:'Mute microphone',exact:true}).click();
      await dialog.getByRole('button',{name:'Unmute microphone',exact:true}).click();
      await dialog.getByRole('button', {name:'Hang up',exact:true}).click();
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).hungUp, 1);
      assert.equal(await dialog.getByLabel('Message Wattzun', {exact:true}).isDisabled(), false);
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).click();
      await dialog.getByRole('button',{name:'Hang up',exact:true}).click();
      await dialog.getByText('Call ended.', {exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.wattzunFixtureRequests)).length, 2, 'UI call fixtures never use a provider or microphone');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      assert.equal(await launcher.evaluate(element=>document.activeElement===element), true, 'Closing restores launcher focus');
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).disposed, 1, 'Restarting disposes the old call; minimising retains the ended call and conversation');
      await page.getByRole('button',{name:'Message from Tools'}).click();
      await dialog.waitFor();
      await page.waitForFunction(()=>document.querySelector('#wattzun-portal-message')?.value==='Help me follow up the sale');
      assert.equal(await dialog.getByLabel('Message Wattzun',{exact:true}).inputValue(),'Help me follow up the sale');
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).started,2,'Message from Tools does not open the microphone');
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      await page.getByRole('button',{name:'Call from Tools'}).click();
      await dialog.getByText('Listening',{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).started,3,'A deliberate Tools Call starts one call');
      await dialog.getByRole('button',{name:'Hang up',exact:true}).click();
      for(const hat of ['cap','cowboy','viking','pirate']) {
        await page.evaluate(hat=>{const key='wattzun-appearance:v1:synthetic-user:trade:synthetic-business';localStorage.setItem(key,JSON.stringify({hat}));window.dispatchEvent(new StorageEvent('storage',{key}));},hat);
        await page.waitForFunction(hat=>document.querySelectorAll('[data-wattzun-hat="'+hat+'"]').length===3,hat);
        await screenshot(page,scenario.name,`hat-${hat}`);
      }
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally { await browser.close(); }
});

test('starting a call wires the literal greeting to the current authenticated portal without adding a question or conversation turn', { skip: !browserPath && 'No installed browser for greeting wiring checks' }, async t => {
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    for(const layout of [{name:'desktop',width:1366,height:900,speed:0.85},{name:'mobile',width:390,height:844,speed:1.15}]) {
      for(const named of [true,false]) for(const [portal,pathname] of [['trade','/direct-trade/dashboard'],['council','/council'],['creditex','/creditex/compliance']]) await t.test(`${layout.name}-${portal}-${named?'named':'unnamed'}`,async()=>{
        const page=await browser.newPage({viewport:{width:layout.width,height:layout.height}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('https://fixture.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
        await page.goto('https://fixture.invalid'+pathname);
        await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div></body></html>`);
        const scopeId=portal==='trade'?'synthetic-business':'synthetic-'+portal;
        await page.evaluate(({portal,scopeId,speed,named})=>{
          window.wattzunFixtureGreetingEnabled=true;
          window.wattzunFixtureScopes=[{portal,scopeId,label:'Synthetic organisation',...(named?{personalName:'Alex'}:{})}];
          localStorage.setItem(`wattzun-preferences:v2:synthetic-user:${portal}:${scopeId}`,JSON.stringify({speed}));
        },{portal,scopeId,speed:layout.speed,named});
        await page.addScriptTag({content:script});
        await page.getByRole('button',{name:'Open Wattzun AI chat',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
        await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
        await dialog.getByText('Listening',{exact:true}).waitFor();
        const requests=await page.evaluate(()=>window.wattzunFixtureRequests);
        assert.equal(requests.length,2,'Only scope discovery and the greeting run when starting a call');
        const greeting=requests.find(request=>request.url==='/api/wattzun/greeting');
        assert.ok(greeting,'The actual React greeting callback submits its dedicated request');
        assert.equal(greeting.headers.Authorization,'Bearer synthetic-token');
        assert.equal(greeting.headers['Content-Type'],'application/json');
        assert.match(greeting.body.requestId,/^[A-Za-z0-9:_-]{16,72}$/);
        assert.deepEqual(greeting.body,{portal,scopeId,requestId:greeting.body.requestId,name:named?'Alex':'',preferences:{speed:layout.speed}},
          'Greeting uses the portal member first name or stays unnamed, never the organisational Firebase display name');
        assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureGreetingPcm),[0x10,0x80,0x20,0x01],
          'The fixture consumes the PCM returned through the real native frame parser');
        const conversation=dialog.getByRole('log',{name:'Conversation with Wattzun',exact:true});
        assert.equal(await conversation.locator('article').count(),0,'Greeting never appends a conversation turn');
        assert.equal(await dialog.getByText("Hi Alex, I'm here. What can I help you with?",{exact:true}).count(),0);
        assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureUsage),[],'Greeting never dispatches question usage');
        await dialog.getByRole('button',{name:'Hang up',exact:true}).click();
        await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).fill('Help me find the next step');
        await dialog.getByRole('button',{name:'Send',exact:true}).click();
        await conversation.getByText('Which job are you following up?',{exact:true}).waitFor();
        const question=await page.evaluate(()=>window.wattzunFixtureRequests.find(request=>request.url==='/api/wattzun/portal'&&request.body));
        assert.deepEqual(question.body.history,[],'The first real question has no greeting in provider history');
        assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureUsage),[{userUid:'synthetic-user',portal,scopeId}],
          'Only the real question updates usage');
        assert.deepEqual(errors,[]);await page.close();
      });
    }
  } finally {await browser.close();}
});

async function screenshot(page, scenario, state) {
  const bounds = await page.getByRole('dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, `${state}: the dialog fits the viewport`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, `${state}: no document overflow`);
  if (!process.env.WATTZUN_QA_OUTPUT) return;
  fs.mkdirSync(process.env.WATTZUN_QA_OUTPUT, {recursive:true});
  await page.screenshot({path:path.join(process.env.WATTZUN_QA_OUTPUT,`${scenario}-${state}.png`)});
}

test('actual greeting and voice callbacks distinguish terminal auth failures from recoverable provider failures', {skip:!browserPath&&'No installed browser for call error wiring'},async t=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    for(const layout of [{name:'desktop',width:1366,height:900},{name:'mobile',width:390,height:844}]) {
      for(const failure of [
        {stage:'greeting',status:401,reason:'authentication'}, {stage:'greeting',status:403,reason:'access'},
        {stage:'voice',status:401,reason:'authentication'}, {stage:'voice',status:403,reason:'access'},
        {stage:'greeting',status:503}, {stage:'voice',status:503}, {stage:'voice',status:429}, {stage:'voice',network:true},
      ]) await t.test(`${layout.name}-${failure.stage}-${failure.status||'network'}`,async()=>{
        const page=await browser.newPage({viewport:{width:layout.width,height:layout.height}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('https://fixture.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
        await page.goto('https://fixture.invalid/direct-trade/dashboard');
        await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div></body></html>`);
        const endpoint='/api/wattzun/'+failure.stage;
        const message=`Specific ${failure.stage} ${failure.status||'network'} failure`;
        await page.evaluate(({endpoint,failure,message})=>{
          window.wattzunFixtureGreetingEnabled=failure.stage==='greeting';
          window.wattzunFixtureFailures={[endpoint]:{...failure,message}};
        },{endpoint,failure,message});
        await page.addScriptTag({content:script});
        await page.getByRole('button',{name:'Open Wattzun AI chat',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
        await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).fill('Help me follow up the sale');
        await dialog.getByRole('button',{name:'Send',exact:true}).click();
        await dialog.getByRole('link',{name:'Open Sales'}).waitFor();
        await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
        if(failure.stage==='voice') {
          await dialog.getByText('Listening',{exact:true}).waitFor();
          await page.evaluate(()=>window.wattzunFixtureCall.question());
        }
        await dialog.getByText(message,{exact:true}).waitFor();
        const callError=await page.evaluate(()=>window.wattzunFixtureErrors.at(-1));
        assert.equal(callError.message,message,'The actual callback preserves the request error');
        assert.equal(callError.name,failure.reason?'WattzunVoiceCallError':'Error');
        assert.equal(callError.reason,failure.reason);
        assert.equal(await dialog.getByRole('log',{name:'Conversation with Wattzun'}).locator('article').count(),2,'A failed voice request does not append a fake reply or lose the conversation');
        const attempts=await page.evaluate(()=>window.wattzunFixtureRequests.filter(request=>['/api/wattzun/greeting','/api/wattzun/voice'].includes(request.url)).length);
        if(failure.reason) {
          assert.equal(await dialog.getByRole('button',{name:'Hang up',exact:true}).count(),0);
          assert.equal(await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).isDisabled(),false);
          await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).waitFor();
          assert.equal(await dialog.getByRole('alert').textContent(),message);
        } else {
          await dialog.getByText('Still connected',{exact:true}).waitFor();
          assert.equal(await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).count(),0);
          assert.equal(await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).isDisabled(),true);
          assert.equal(await dialog.getByRole('button',{name:'Mute microphone',exact:true}).isEnabled(),true);
          await dialog.getByRole('link',{name:'Open Sales'}).click();
          const dock=page.getByRole('region',{name:'Wattzun call',exact:true});
          await dock.getByText('Still connected',{exact:true}).waitFor();
          await dock.getByText(message,{exact:true}).waitFor();
          assert.equal(new URL(page.url()).search,'?workspace=sales','Workflow navigation remains available during recovery');
          await dock.getByRole('button',{name:'Mute microphone',exact:true}).click();
          await dock.getByRole('button',{name:'Unmute microphone',exact:true}).click();
          assert.equal(await page.evaluate(()=>window.wattzunFixtureRequests.filter(request=>['/api/wattzun/greeting','/api/wattzun/voice'].includes(request.url)).length),attempts,'Navigation and mute never retry a failed request');
          await dock.getByRole('button',{name:'Open Wattzun',exact:true}).click();
          await page.evaluate(endpoint=>{delete window.wattzunFixtureFailures[endpoint];window.wattzunFixtureCall.resume();},endpoint);
          await dialog.getByText('Listening',{exact:true}).waitFor();
          await page.evaluate(()=>window.wattzunFixtureCall.question());
          await dialog.getByRole('log',{name:'Conversation with Wattzun'}).getByText('Open Schedule to review your visits.',{exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>window.wattzunFixtureCounters.started),1,'A deliberate new question reuses the connected call');
          await dialog.getByRole('button',{name:'Hang up',exact:true}).click();
        }
        assert.equal(await dialog.getByRole('group',{name:'Call check-in',exact:true}).count(),0);
        assert.equal(await dialog.getByRole('button',{name:'Continue call',exact:true}).count(),0);
        assert.deepEqual(errors,[]);await page.close();
      });
    }
  } finally {await browser.close();}
});

test('authentication, scope selection and pagehide still dispose a recovering call', {skip:!browserPath&&'No installed browser for call boundary wiring'},async t=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    for(const boundary of ['authentication','scope','pagehide']) await t.test(boundary,async()=>{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://fixture.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid/direct-trade/dashboard');
      await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div></body></html>`);
      await page.addScriptTag({content:script});
      await page.getByRole('button',{name:'Open Wattzun AI chat',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
      await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
      await dialog.getByText('Listening',{exact:true}).waitFor();
      await page.evaluate(()=>window.wattzunFixtureCall.recover());
      await dialog.getByText('Still connected',{exact:true}).waitFor();
      await page.evaluate(boundary=>{
        if(boundary==='authentication')window.wattzunFixtureAuth(null);
        else if(boundary==='scope')window.dispatchEvent(new CustomEvent('tlink:business-selection-changed',{detail:{uid:'synthetic-user',ownerUid:'unauthorised-business'}}));
        else window.dispatchEvent(new Event('pagehide'));
      },boundary);
      await page.waitForFunction(()=>window.wattzunFixtureCounters.disposed===1);
      if(boundary!=='pagehide') {
        assert.equal(await page.getByRole('region',{name:'Wattzun call',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Hang up',exact:true}).count(),0);
      }
      assert.deepEqual(errors,[]);await page.close();
    });
  } finally {await browser.close();}
});

test('a call and its conversation survive guarded workspace links, client route changes and minimising until an explicit boundary', { skip: !browserPath && 'No installed browser for call navigation checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const [portal, pathname] of [['trade','/direct-trade/dashboard'],['trade','/direct-trade/team'],['council','/council'],['creditex','/creditex/compliance']]) await t.test(portal+(pathname.endsWith('/team')?'-staff':''), async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://fixture.invalid/**', route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid'+pathname);
      await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div></body></html>`);
      await page.evaluate(({pathname,portal})=>{
        window.wattzunFixtureLinks=[{label:'Open workspace',href:pathname+'?workspace=finance'},{label:'Open file preview',href:'/api/synthetic-file.pdf'}];
        if(portal==='trade')window.wattzunFixtureLinks.push({label:'Open Connect',href:'/direct-trade/messages'});
        window.wattzunFixtureRejectedNavigation=0;
        window.addEventListener('popstate',()=>{
          if(window.wattzunFixtureGuardReject){history.replaceState(history.state,'',pathname);window.wattzunFixtureRejectedNavigation++;}
        });
      },{pathname,portal});
      await page.addScriptTag({content:script});
      const launcher=page.getByRole('button',{name:'Open Wattzun AI chat',exact:true});
      await launcher.click();
      const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
      await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).fill('Open my quote');
      await dialog.getByRole('button',{name:'Send',exact:true}).click();
      await dialog.getByRole('link',{name:'Open workspace',exact:false}).waitFor();
      await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
      await dialog.getByText('Listening',{exact:true}).waitFor();
      await page.evaluate(()=>{window.wattzunFixtureGuardReject=true;});
      await dialog.getByRole('link',{name:'Open workspace',exact:false}).click();
      await dialog.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.wattzunFixtureRejectedNavigation),1,'Workspace navigation runs the existing popstate guard');
      assert.equal(new URL(page.url()).search,'','A rejected change keeps the previous workspace');
      const dock=page.getByRole('region',{name:'Wattzun call',exact:true});
      await dock.getByText('Listening',{exact:true}).waitFor();
      assert.ok((await dock.getByRole('button',{name:'Hang up',exact:true}).boundingBox()).height>=44);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Docked call fits the mobile viewport');
      await dock.getByRole('button',{name:'Open Wattzun',exact:true}).click();
      await dialog.getByRole('log',{name:'Conversation with Wattzun',exact:true}).getByText('Open my quote',{exact:true}).waitFor();
      await page.evaluate(()=>{window.wattzunFixtureGuardReject=false;});
      await dialog.getByRole('link',{name:'Open workspace',exact:false}).click();
      await dock.waitFor();
      assert.equal(new URL(page.url()).search,'?workspace=finance');
      await dock.getByRole('button',{name:'Open Wattzun',exact:true}).click();
      if(portal==='trade') {
        await dialog.getByRole('link',{name:'Open Connect',exact:false}).click();
        await dock.waitFor();
        assert.equal(new URL(page.url()).pathname,'/direct-trade/messages','Next client navigation changes the route');
        await dock.getByRole('button',{name:'Open Wattzun',exact:true}).click();
      }
      const file=dialog.getByRole('link',{name:'Open file preview',exact:false});
      assert.equal(await file.getAttribute('target'),'_blank');
      assert.equal(await file.getAttribute('rel'),'noopener noreferrer');
      const previewPromise=page.waitForEvent('popup');
      await file.click();
      const preview=await previewPromise; await preview.close();
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      await dialog.getByRole('button',{name:'Minimise Wattzun',exact:true}).click();
      await dock.waitFor();
      assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureCounters),{started:1,hungUp:0,disposed:0},'Navigation, background file previews and dismissal keep the same call instance');
      assert.equal(await page.evaluate(()=>window.wattzunFixtureRequests.filter(request=>request.url.startsWith('/api/wattzun/portal?')).length),1,'Client navigation retains the authorised portal assistant');
      await page.evaluate(()=>window.wattzunFixtureCall.recover());
      await dock.getByText('Still connected',{exact:true}).waitFor();
      await dock.getByText('That reply did not come through. Please say that last part again.',{exact:true}).waitFor();
      assert.equal(await dock.getByRole('button',{name:'Continue call',exact:true}).count(),0);
      await dock.getByRole('button',{name:'Mute microphone',exact:true}).click();
      await dock.getByRole('button',{name:'Unmute microphone',exact:true}).click();
      await dock.getByRole('button',{name:'Hang up',exact:true}).click();
      await dock.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.wattzunFixtureCounters.hungUp),1,'Only explicit Hang up stops this call');
      await launcher.click();
      await dialog.getByRole('log',{name:'Conversation with Wattzun',exact:true}).getByText('Open my quote',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
      await dialog.getByText('Listening',{exact:true}).waitFor();
      await page.evaluate(()=>{history.pushState(history.state,'','/');window.dispatchEvent(new Event('fixture:navigate'));});
      await dialog.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.wattzunFixtureCounters.disposed),2,'Restart disposes its predecessor and leaving authorised routes disposes the active call');
      assert.equal(await page.getByRole('button',{name:'Call Wattzun',exact:true}).count(),0,'Public AEA has no call control');
      assert.deepEqual(errors,[]); await page.close();
    });
  } finally { await browser.close(); }
});

test('a voice action opens its review, preserves the call through receipt confirmation and opens the saved quote on the staff route', { skip: !browserPath && 'No installed browser for action integration checks' }, async () => {
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fixture.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
    await page.goto('https://fixture.invalid/direct-trade/team');
    await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({content:script});
    const launcher=page.getByRole('button',{name:'Open Wattzun AI chat',exact:true});
    await launcher.click();
    const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
    await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
    await dialog.getByText('Listening',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Minimise Wattzun',exact:true}).click();
    const deliverProposal=()=>page.evaluate(()=>window.wattzunFixtureCall.callbacks.reply({transcript:'Prepare my quote',reply:{kind:'clarification',message:'Review the exact customer spelling, Google address and quote details.',questions:[],links:[],action:{kind:'prepare_quote',firstName:'Sam',lastName:'Example',email:'',phone:'',addressQuery:'',serviceCategory:'',description:'Install heat pump',lines:[]}},audio:{base64:'AQID',mimeType:'audio/mpeg'}}));
    await deliverProposal();
    const review=dialog.getByRole('region',{name:'Synthetic reviewed action',exact:true});
    await review.waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Hang up',exact:true}).count(),1,'A voice proposal reveals review without ending the call');
    await review.getByRole('button',{name:'Cancel synthetic quote',exact:true}).click();
    await review.waitFor({state:'detached'});
    assert.equal(await dialog.getByText('Your quote draft has been saved in TLink. Open it to review the details.',{exact:true}).count(),0,'Cancelling never claims a record was saved');
    await deliverProposal();
    await review.getByRole('button',{name:'Confirm synthetic quote',exact:true}).click();
    await review.waitFor({state:'detached'});
    const receipt=dialog.getByRole('link',{name:'Open saved quote draft',exact:false});
    await receipt.waitFor();
    assert.equal(await receipt.getAttribute('href'),'/direct-trade/team?workspace=work&jobId=saved-job-23&jobTab=quote','Owner-form receipts are normalised to the active staff route');
    assert.equal(await dialog.getByText('Your quote draft has been saved in TLink. Open it to review the details.',{exact:true}).count(),1,'Success appears only after the review supplies its persisted receipt');
    await receipt.click();
    const dock=page.getByRole('region',{name:'Wattzun call',exact:true});
    await dock.waitFor();
    assert.equal(new URL(page.url()).pathname,'/direct-trade/team');
    assert.equal(new URL(page.url()).searchParams.get('jobId'),'saved-job-23');
    assert.equal(new URL(page.url()).searchParams.get('jobTab'),'quote');
    assert.deepEqual(await page.evaluate(()=>window.wattzunFixtureCounters),{started:1,hungUp:0,disposed:0},'Review, confirmation and opening the saved quote retain the original call');
    await dock.getByRole('button',{name:'Hang up',exact:true}).click();
    await launcher.click();await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).fill('What is my next step?');
    await dialog.getByRole('button',{name:'Send',exact:true}).click();
    await dialog.getByText('I can help you follow up the sale. Tell me a little more so I can point you to the right next step.',{exact:true}).waitFor();
    const followup=await page.evaluate(()=>window.wattzunFixtureRequests.filter(request=>request.body?.message==='What is my next step?').at(-1));
    assert.match(JSON.stringify(followup.body.history),/quote draft has been saved/);
    assert.doesNotMatch(JSON.stringify(followup.body.history),/saved-(?:quote|job|version)-23/,'Saved record identities stay in UI links instead of provider history');
    assert.deepEqual(errors,[]);await page.close();
  } finally {await browser.close();}
});
