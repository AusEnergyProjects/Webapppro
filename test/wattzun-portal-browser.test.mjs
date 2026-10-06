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
  auth: `export function onAuthStateChanged(_auth, callback) { callback({uid:'synthetic-user',emailVerified:true,getIdToken:async()=>'synthetic-token'}); return ()=>{}; }`,
  firebase: 'export const firebaseAuth = {};',
  business: `export const readTradeBusinessSelection = () => 'synthetic-business';`,
  launcher: `import React from 'react'; export function EnergyAssistantLauncher({onOpen}) { return <button type="button" onClick={onOpen}>Open Wattzun</button>; }`,
  // The real call lifecycle has deterministic clock tests. This fixture checks only the real UI wiring,
  // with no microphone, audio playback or provider access.
  voice: `
    export const createWattzunBrowserVoiceEnvironment = () => ({});
    export class WattzunVoiceCall {
      constructor(_environment,callbacks) { this.callbacks=callbacks; this.muted=false; window.wattzunFixtureCall=this; }
      async start() { window.wattzunFixtureCounters.started++; this.callbacks.status({state:'listening',message:'Listening for your question.'}); }
      checkIn() { this.callbacks.status({state:'confirming',message:'Would you like to continue this call?'}); }
      continueCall() { window.wattzunFixtureCounters.continued++; this.callbacks.status({state:this.muted?'muted':'listening',message:'Call continued.'}); }
      toggleMute() { this.muted=!this.muted; this.callbacks.status({state:this.muted?'muted':'listening',message:this.muted?'Microphone muted.':'Listening for your question.'}); }
      hangUp() { window.wattzunFixtureCounters.hungUp++; this.callbacks.status({state:'ended',message:'Call ended.'}); }
      noResponse() { this.callbacks.status({state:'ended',message:'Call ended after no response.'}); }
      dispose() { window.wattzunFixtureCounters.disposed++; }
      interrupt() {}
    }
  `,
};
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { WattzunPortalAssistant } from './src/components/WattzunPortalAssistant';
    window.wattzunFixtureRequests=[];
    window.wattzunFixtureCounters={started:0,continued:0,hungUp:0,disposed:0};
    window.fetch=async (url,options={})=>{
      window.wattzunFixtureRequests.push({url,headers:options.headers,body:options.body?JSON.parse(options.body):null});
      if(url==='/api/wattzun/portal?portal=trade') return Response.json({ok:true,scopes:[{portal:'trade',scopeId:'synthetic-business',label:'Synthetic trade business'}]});
      if(url==='/api/wattzun/portal'&&options.method==='POST') return Response.json({ok:true,reply:{kind:'clarification',message:'I can help you follow up the sale. Tell me a little more so I can point you to the right next step.',questions:['Which job are you following up?','Do you want to call the customer or review the quote?'],links:[{label:'Open Sales',href:'/direct-trade/dashboard?workspace=sales'}]}});
      throw new Error('Unexpected fixture request: '+url);
    };
    createRoot(document.getElementById('root')).render(<WattzunPortalAssistant portal="trade" />);
  ` },
  bundle: true, write: false, outfile: 'wattzun.js', format: 'iife', jsx: 'automatic', external:['/surge-mascot.webp'],
  plugins: [{ name: 'synthetic-wattzun-scope', setup(builder) {
    for (const [filter, fixture] of [
      [/^firebase\/auth$/, 'auth'], [/^@\/lib\/firebase-client$/, 'firebase'],
      [/^@\/lib\/trade-business-client$/, 'business'], [/EnergyAssistantLauncher$/, 'launcher'],
      [/^@\/lib\/wattzun-voice-client$/, 'voice'],
    ]) builder.onResolve({ filter }, () => ({ path: fixture, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^@\/lib\/wattzun-portal$/ }, () => ({ path: path.join(root, 'src/lib/wattzun-portal.ts') }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const modes = fs.readFileSync(path.join(root, 'src/app/tlink-colour-mode.css'), 'utf8');

test('Wattzun speed settings, clarifications and call check-ins remain usable in desktop and mobile day/night layouts', { skip: !browserPath && 'No installed browser for layout checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [{name:'desktop-day',width:1366,height:900,mode:'day'}, {name:'desktop-night',width:1366,height:900,mode:'night'}, {name:'mobile-day',width:390,height:844,mode:'day'}, {name:'mobile-night',width:390,height:844,mode:'night'}]) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://fixture.invalid/**', route => route.fulfill(route.request().url().endsWith('/surge-mascot.webp')
        ? {status:200,contentType:'image/webp',body:fs.readFileSync(path.join(root,'public/surge-mascot.webp'))}
        : {status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid/');
      await page.setContent(`<html data-tlink-colour-mode="${scenario.mode}"><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:${scenario.mode==='night'?'#0c1c1b':'#e9f0ee'}}*{box-sizing:border-box}${modes}${css}</style></head><body><main class="trade-portal-shell"><div id="root"></div></main></body></html>`);
      await page.evaluate(() => localStorage.setItem('wattzun-preferences:v1:synthetic-user:trade:synthetic-business', JSON.stringify({speed:.85,voice:'obsolete',tone:'obsolete',personality:'Obsolete private preference'})));
      await page.addScriptTag({ content: script });
      const launcher = page.getByRole('button', {name:'Open Wattzun',exact:true});
      await launcher.click();
      const dialog = page.getByRole('dialog', {name:'Wattzun',exact:true});
      await dialog.waitFor();
      assert.equal(await dialog.locator(':focus').count(), 1, 'Opening Wattzun moves focus into its modal');
      assert.equal(await dialog.evaluate(element=>getComputedStyle(element).backgroundColor), scenario.mode==='night'?'rgb(16, 38, 37)':'rgb(255, 255, 255)', 'The actual scoped theme colours apply');
      assert.equal(await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).count(), 1);
      await dialog.getByText('Speech speed', {exact:true}).click();
      const speed = dialog.getByRole('combobox', {name:'Speaking speed',exact:true});
      assert.equal(await speed.inputValue(), '0.85', 'Legacy speed survives while the obsolete settings are removed');
      assert.equal(await dialog.getByRole('combobox').count(), 1);
      assert.equal(await dialog.getByLabel('Tone', {exact:true}).count(), 0);
      assert.equal(await dialog.getByLabel('Personality note', {exact:true}).count(), 0);
      await speed.selectOption('1.15');
      await page.waitForFunction(()=>localStorage.getItem('wattzun-preferences:v2:synthetic-user:trade:synthetic-business')==='{"speed":1.15}');
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
      await screenshot(page, scenario.name, 'clarification');
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).click();
      await dialog.getByText('Listening', {exact:true}).waitFor();
      assert.equal(await dialog.getByLabel('Message Wattzun', {exact:true}).isDisabled(), true);
      await page.evaluate(()=>window.wattzunFixtureCall.checkIn());
      const checkIn = dialog.getByRole('group', {name:'Call check-in',exact:true});
      await checkIn.waitFor();
      await dialog.getByText('Would you like to continue this call?', {exact:true}).waitFor();
      const continueButton = checkIn.getByRole('button', {name:'Continue call',exact:true});
      const endButton = checkIn.getByRole('button', {name:'End call',exact:true});
      assert.ok((await continueButton.boundingBox()).height >= 42);
      assert.ok((await endButton.boundingBox()).height >= 42);
      await screenshot(page, scenario.name, 'call-check-in');
      await continueButton.focus();
      await page.keyboard.press('Enter');
      await checkIn.waitFor({state:'detached'});
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).continued, 1);
      await page.evaluate(()=>window.wattzunFixtureCall.checkIn());
      await checkIn.getByRole('button', {name:'End call',exact:true}).click();
      await checkIn.waitFor({state:'detached'});
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).hungUp, 1);
      assert.equal(await dialog.getByLabel('Message Wattzun', {exact:true}).isDisabled(), false);
      await dialog.getByRole('button', {name:'Call Wattzun',exact:true}).click();
      await page.evaluate(()=>window.wattzunFixtureCall.noResponse());
      await dialog.getByText('Call ended after no response.', {exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.wattzunFixtureRequests)).length, 2, 'UI call fixtures never use a provider or microphone');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      assert.equal(await launcher.evaluate(element=>document.activeElement===element), true, 'Closing restores launcher focus');
      assert.equal((await page.evaluate(()=>window.wattzunFixtureCounters)).disposed, 2, 'Restarting and closing dispose the prior call');
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally { await browser.close(); }
});

async function screenshot(page, scenario, state) {
  const bounds = await page.getByRole('dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, `${state}: the dialog fits the viewport`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, `${state}: no document overflow`);
  if (!process.env.WATTZUN_QA_OUTPUT) return;
  fs.mkdirSync(process.env.WATTZUN_QA_OUTPUT, {recursive:true});
  await page.screenshot({path:path.join(process.env.WATTZUN_QA_OUTPUT,`${scenario}-${state}.png`)});
}
