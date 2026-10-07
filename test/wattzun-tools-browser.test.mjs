import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const hats = [{ id: 'none', label: 'None' }, { id: 'hard-hat', label: 'Hard hat' }, { id: 'cap', label: 'Cap' }, { id: 'cowboy', label: 'Cowboy' }, { id: 'viking', label: 'Viking hat' }, { id: 'pirate', label: 'Pirate hat' }, { id: 'sausage', label: 'Sausage' }, { id: 'tinfoil', label: 'Tinfoil hat' }, { id: 'safety-plug', label: 'Safety plug' }, { id: 'party', label: 'Party hat' }, { id: 'pumpkin', label: 'Pumpkin' }, { id: 'ghost', label: 'Ghost' }];
const fixtures = {
  auth: `export function onAuthStateChanged(_auth, callback) { window.fixtureAuthListeners.add(callback); callback(window.fixtureUser); return ()=>window.fixtureAuthListeners.delete(callback); }`,
  firebase: 'export const firebaseAuth = {};',
  business: `export {createTradeBusinessFetch} from './src/lib/trade-business-client';export const readTradeBusinessSelection = () => 'synthetic-trade-one';export const TRADE_BUSINESS_SELECTION_CHANGED_EVENT='tlink:business-selection-changed';`,
  link: `import React from 'react'; export default function Link({href,onNavigate,prefetch,...props}) { return <a {...props} href={href} onClick={event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return; event.preventDefault();let prevented=false;onNavigate?.({preventDefault(){prevented=true;}});if(!prevented)history.pushState(history.state,'',href);}}/>; }`,
  navigation: `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:href=>history.pushState(history.state,'',href)});`,
  picker: `export const WattzunRecordPicker=()=>null;`,
  review: `export const WattzunActionReview=()=>null;`,
  // Real presentation, opening, UI and request code runs. Only microphone/audio/provider boundaries are synthetic.
  voice: `
    export const createWattzunBrowserVoiceEnvironment = () => ({});
    export class WattzunVoiceCallError extends Error {
      constructor(message,reason) { super(message);this.name='WattzunVoiceCallError';this.reason=reason; }
    }
    export class WattzunVoiceCall {
      constructor(_environment,callbacks) { this.callbacks=callbacks; this.muted=false; window.fixtureCall=this; }
      async start() {
        window.fixtureCounters.started++; this.callbacks.status({state:'listening',message:'Listening for your question.'});
        if(window.fixtureConfig.submitOnCall) await this.callbacks.submit(new Blob(['synthetic question'],{type:'audio/webm'}),new AbortController().signal);
      }
      hangUp() { window.fixtureCounters.hungUp++; this.callbacks.status({state:'ended',message:'Call ended.'}); }
      dispose() { window.fixtureCounters.disposed++; }
      toggleMute() { this.muted=!this.muted; this.callbacks.status({state:this.muted?'muted':'listening',message:this.muted?'Microphone muted.':'Listening for your question.'}); }
      interrupt() {}
    }
  `,
};
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WattzunToolsWorkspace} from './src/components/WattzunToolsWorkspace';
    import {WattzunPortalAssistant} from './src/components/WattzunPortalAssistant';
    import {WATTZUN_OPEN_EVENT,WATTZUN_USAGE_CHANGED_EVENT} from './src/lib/wattzun-appearance';
    const makeUser=uid=>({uid,emailVerified:true,getIdToken:async()=>'synthetic-token:'+uid});
    window.fixtureUser=makeUser(window.fixtureConfig.actor||'user-one');
    window.fixtureAuthListeners=new Set();
    window.fixtureRequests=[]; window.fixtureDeferred={};
    window.fixtureCounters={started:0,hungUp:0,disposed:0,microphone:0};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.fixtureCounters.microphone++;throw new Error('Real microphone forbidden in fixtures');}}});
    const scopeKey=(actor,portal,scopeId)=>actor+':'+portal+':'+scopeId;
    const usageFor=(actor,portal,scopeId)=>({portal,scopeId,month:'2026-10',monthBasis:'UTC',audience:'personal',textMessages:actor==='user-two'?41:scopeId.endsWith('-two')?19:7,voiceExchanges:actor==='user-two'?11:scopeId.endsWith('-two')?4:3});
    window.fixtureResolveUsage=(key,usage)=>{const waiting=window.fixtureDeferred[key]||[];delete window.fixtureDeferred[key];waiting.forEach(resolve=>resolve(Response.json({ok:true,usage:usage||resolve.usage})));};
    window.fixtureUsageChanged=detail=>window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT,{detail}));
    window.fixtureOpenEvent=detail=>window.dispatchEvent(new CustomEvent(WATTZUN_OPEN_EVENT,{detail}));
    window.fetch=async(url,options={})=>{
      const parsed=new URL(url,location.origin), authorization=new Headers(options.headers).get('Authorization')||'';
      const actor=authorization.replace('Bearer synthetic-token:','');
      const request={url:String(url),actor,method:options.method||'GET',body:options.body instanceof FormData?JSON.parse(options.body.get('request')):options.body?JSON.parse(options.body):null};window.fixtureRequests.push(request);
      if(parsed.pathname==='/api/wattzun/portal'&&request.method==='GET') {
        const portal=parsed.searchParams.get('portal');
        if(window.fixtureConfig.scopeFailure) return Response.json({ok:false,error:'Current workspace access is unavailable.'},{status:403});
        return Response.json({ok:true,scopes:window.fixtureConfig.scopes[portal]||[]});
      }
      if(parsed.pathname==='/api/wattzun/usage') {
        const portal=parsed.searchParams.get('portal'),scopeId=parsed.searchParams.get('scopeId'),key=scopeKey(actor,portal,scopeId);
        const mode=window.fixtureConfig.usageModes[key];
        const usage=usageFor(actor,portal,scopeId);
        if(mode==='error') return Response.json({ok:false,error:'Usage unavailable. Try again.'},{status:503});
        if(mode==='invalid') return Response.json({ok:true,usage:{...usage,scopeId:'foreign-workspace',textMessages:0}});
        // Intentionally ignore AbortSignal so the production post-response scope guard is exercised.
        if(mode==='deferred') return new Promise(resolve=>{resolve.usage=usage;(window.fixtureDeferred[key] ||= []).push(resolve);});
        return Response.json({ok:true,usage});
      }
      if(parsed.pathname==='/api/wattzun/portal'&&request.method==='POST') return Response.json({ok:true,reply:{kind:'clarification',message:'Tell me the job and the outcome you need.',questions:['Which job are you working on?'],links:[]}});
      if(parsed.pathname==='/api/wattzun/voice'&&request.method==='POST') return new Response([
        {type:'reply',transcript:'Help me with this synthetic job',reply:{kind:'answer',message:'Synthetic reply',questions:[],links:[]}},
        {type:'audio',data:'AAA='},{type:'done'}
      ].map(frame=>JSON.stringify(frame)).join(String.fromCharCode(10))+String.fromCharCode(10),{headers:{'Content-Type':'application/x-wattzun-voice+ndjson'}});
      throw new Error('Unexpected fixture request: '+url);
    };
    function Fixture() {
      const [user,setUser]=useState(window.fixtureUser),[portal,setPortal]=useState(window.fixtureConfig.portal);
      window.fixtureSwitchActor=uid=>{window.fixtureUser=makeUser(uid);window.fixtureAuthListeners.forEach(callback=>callback(window.fixtureUser));setUser(window.fixtureUser);};
      window.fixtureSwitchPortal=setPortal;
      return <><WattzunToolsWorkspace user={user} portal={portal}/><WattzunPortalAssistant key={portal} portal={portal}/></>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, outfile: 'wattzun-tools.js', format: 'iife', jsx: 'automatic', external: ['/surge-mascot.webp'],
  plugins: [{ name: 'bounded-wattzun-tools-fixtures', setup(builder) {
    for (const [filter, fixture] of [[/^firebase\/auth$/, 'auth'], [/^@\/lib\/firebase-client$/, 'firebase'], [/^@\/lib\/trade-business-client$/, 'business'], [/^@\/lib\/wattzun-voice-client$/, 'voice'], [/^next\/link$/, 'link'], [/^next\/navigation$/, 'navigation'], [/WattzunRecordPicker$/, 'picker'], [/WattzunActionReview$/, 'review']]) builder.onResolve({ filter }, () => ({ path: fixture, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, 'src/lib', `${args.path.slice('@/lib/'.length)}.ts`) }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const modes = fs.readFileSync(path.join(root, 'src/app/tlink-colour-mode.css'), 'utf8');

async function fixturePage(browser, config = {}) {
  const { portal = 'trade', width = 1366, mode = 'day', multiple = false, usageModes = {}, storage = {}, scopeFailure = false, blockedStorage = false, submitOnCall = false } = config;
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, hasTouch: width < 500 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fixture.invalid/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const image = pathname === '/surge-mascot.webp' || hats.some(hat => hat.id !== 'none' && pathname === `/wattzun/${hat.id}.webp`);
    return route.fulfill(image
      ? { status: 200, contentType: 'image/webp', body: fs.readFileSync(path.join(root, 'public', pathname)) }
      : { status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
  });
  await page.goto('https://fixture.invalid/');
  await page.setContent(`<html data-tlink-colour-mode="${mode}"><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:${mode === 'night' ? '#0c1c1b' : '#e9f0ee'}}*{box-sizing:border-box}${modes}${css}</style></head><body><main class="trade-portal-shell" style="max-width:1180px;margin:auto"><div id="root"></div></main></body></html>`);
  await page.evaluate(({ portal, multiple, usageModes, storage, scopeFailure, blockedStorage, submitOnCall }) => {
    const scopes = Object.fromEntries(['trade', 'council', 'creditex'].map(value => [value, [{ portal: value, scopeId: `synthetic-${value}-one`, label: `Synthetic ${value} one` }, ...(multiple ? [{ portal: value, scopeId: `synthetic-${value}-two`, label: `Synthetic ${value} two` }] : [])]]));
    window.fixtureConfig = { portal, scopes, usageModes, scopeFailure, submitOnCall };
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
    if (blockedStorage) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Fixture storage is blocked', 'SecurityError'); } });
  }, { portal, multiple, usageModes, storage, scopeFailure, blockedStorage, submitOnCall });
  await page.addScriptTag({ content: script });
  const tools = page.getByRole('region', { name: 'Wattzun tools', exact: true });
  await tools.waitFor();
  // Reproduce the assistant's late stylesheet arriving after the Tools stylesheet.
  // Component defaults must not override a consumer's deliberate preview sizing.
  if (!scopeFailure) {
    const mascotClass = (await tools.locator('header span[aria-hidden="true"]').getAttribute('class')).split(' ')[0];
    const mascotCss = fs.readFileSync(path.join(root, 'src/components/WattzunMascot.module.css'), 'utf8');
    await page.addStyleTag({ content: mascotCss.replaceAll('.mascot', `.${mascotClass}`) });
  }
  return { page, tools, errors };
}
async function numbers(tools, expected) {
  const metrics = tools.getByRole('region', { name: 'Your Wattzun usage', exact: true }).locator('strong');
  await tools.page().waitForFunction(expected => {
    const values = [...document.querySelectorAll('[aria-label="Your Wattzun usage"] strong')].map(element => element.textContent);
    return values.length === expected.length && values.every((value, index) => value === String(expected[index]));
  }, expected);
  assert.deepEqual(await metrics.allTextContents(), expected.map(String));
}
async function rendered(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function touchControls(location, label) {
  const controls = await location.locator('button,select,textarea,summary').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  for (const control of controls) assert.ok(control.width >= 44 && control.height >= 44, `${label}: ${control.label} has a 44px touch target (${control.width}x${control.height})`);
}
async function screen(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no document overflow`);
  const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
  if (await dialog.count()) {
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, `${name}: dialog fits`);
  }
  if (process.env.WATTZUN_TOOLS_QA_OUTPUT) {
    fs.mkdirSync(process.env.WATTZUN_TOOLS_QA_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.WATTZUN_TOOLS_QA_OUTPUT, `${name}.png`), fullPage: !(await dialog.count()) });
  }
}
async function currentHat(tools, launcher, dialog, id) {
  for (const location of [tools.locator('header'), launcher, ...(dialog ? [dialog.locator('header')] : [])]) {
    if (id === 'none') assert.equal(await location.locator('[data-wattzun-hat]').count(), 0);
    else {
      const mascot = location.locator(`[data-wattzun-hat="${id}"]`);
      await mascot.waitFor();
      const image = await mascot.evaluate(async element => {
        const source = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        const image = new Image(); image.src = source; await image.decode();
        return { source, width: image.naturalWidth, height: image.naturalHeight };
      });
      assert.ok(image.source.endsWith(`/wattzun/${id}.webp`), `${id} has its actual rendered costume`);
      assert.ok(image.width >= 384 && image.height >= 512, `${id} has a high resolution decoded image`);
    }
  }
}

test('actual Tools, floating launcher and assistant share all 12 appearance choices and speed in desktop/mobile day/night layouts', { skip: !browserPath && 'No installed browser for layout checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [{ name: 'desktop-day', width: 1366, mode: 'day' }, { name: 'desktop-night', width: 1366, mode: 'night' }, { name: 'mobile-day', width: 390, mode: 'day' }, { name: 'mobile-night', width: 390, mode: 'night' }]) await t.test(scenario.name, async () => {
      const { page, tools, errors } = await fixturePage(browser, scenario);
      await numbers(tools, [7, 3]);
      await tools.getByText('Speed changes apply to his next reply.', { exact: true }).waitFor();
      assert.equal(await tools.getByText('Warm and conversational, with a little humour.', { exact: false }).count(), 0);
      const launcher = page.getByRole('button', { name: 'Open Wattzun AI chat', exact: true });
      await launcher.waitFor();
      const heroSize = await tools.locator('header span[aria-hidden="true"]').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
      assert.deepEqual(heroSize, scenario.width < 500 ? {width:75,height:90} : {width:150,height:176}, 'Late mascot defaults preserve hero size');
      const previewSize = await tools.getByRole('button', { name: 'None', exact: true }).locator('span[aria-hidden="true"]').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
      assert.deepEqual(previewSize, {width:58,height:78}, 'Late mascot defaults preserve high-resolution gallery size');
      assert.equal(await tools.getByRole('button', { name: 'None', exact: true }).getAttribute('aria-pressed'), 'true');
      for (const hat of hats) {
        const button = tools.getByRole('button', { name: hat.label, exact: true });
        await button.focus(); await page.keyboard.press('Enter');
        await currentHat(tools, launcher, null, hat.id);
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => localStorage.getItem('wattzun-appearance:v1:user-one:trade:synthetic-trade-one')), JSON.stringify({ hat: hat.id }));
        await tools.getByRole('button', { name: 'Message Wattzun', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
        await dialog.waitFor(); await currentHat(tools, launcher, dialog, hat.id);
        assert.equal(await dialog.locator(':focus').count(), 1, 'Opening moves keyboard focus into the modal');
        await dialog.getByRole('button', { name: 'Minimise Wattzun', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
      }
      await tools.getByRole('button', { name: 'Pirate hat', exact: true }).click();
      await currentHat(tools, launcher, null, 'pirate');
      assert.deepEqual(await page.evaluate(() => window.fixtureCounters), { started: 0, hungUp: 0, disposed: 0, microphone: 0 }, 'Hats and ordinary Message never request a call or microphone');
      await touchControls(tools, scenario.name);
      await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).selectOption('1.15');
      await screen(page, `${scenario.name}-tools-pirate`);
      await tools.getByRole('button', { name: 'Message Wattzun', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
      await dialog.getByText('Speech speed', { exact: true }).click();
      assert.equal(await dialog.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '1.15');
      await dialog.getByRole('combobox', { name: 'Speaking speed', exact: true }).selectOption('0.85');
      assert.equal(await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '0.85', 'Dialog and Tools update the same scoped speed');
      assert.equal(await dialog.evaluate(element => getComputedStyle(element).backgroundColor), scenario.mode === 'night' ? 'rgb(16, 38, 37)' : 'rgb(255, 255, 255)');
      await touchControls(dialog, `${scenario.name} assistant`);
      await dialog.getByRole('button', { name: 'Minimise Wattzun', exact: true }).focus();
      for (let step = 0; step < 12; step++) { await page.keyboard.press('Tab'); assert.equal(await dialog.locator(':focus').count(), 1, 'Keyboard focus remains in the open modal'); }
      await screen(page, `${scenario.name}-assistant-pirate`);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).focus();
      await page.keyboard.press('Enter');
      await dialog.getByText('Listening', { exact: true }).waitFor();
      await touchControls(dialog, `${scenario.name} active call`);
      assert.equal(await page.evaluate(() => window.fixtureCounters.started), 1, 'A deliberate keyboard Call starts once');
      await dialog.getByRole('button', { name: 'Minimise Wattzun', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.fixtureCounters.disposed), 0, 'Minimising retains the active call');
      assert.equal(await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).evaluate(element => document.activeElement === element), true, 'Minimising restores the originating control focus');
      await page.getByRole('region', { name: 'Wattzun call', exact: true }).getByRole('button', { name: 'Hang up', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixtureCounters.hungUp), 1, 'Hang up is separate from minimising');
      assert.equal(await page.evaluate(() => window.fixtureRequests.filter(request => request.method === 'POST').length), 0, 'Presentation and call fixtures never submit an AI request');
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => localStorage.getItem('wattzun-appearance:v1:user-one:trade:synthetic-trade-one')), '{"hat":"pirate"}');
      await page.reload();
      // Reload restores the same actual UI from device storage, rather than supplying presentation defaults.
      await page.setContent(`<html data-tlink-colour-mode="${scenario.mode}"><head><style>*{box-sizing:border-box}body{margin:16px;font-family:Arial}${modes}${css}</style></head><body><div id="root"></div></body></html>`);
      await page.evaluate(() => { window.fixtureConfig = { portal: 'trade', usageModes: {}, scopes: { trade: [{ portal: 'trade', scopeId: 'synthetic-trade-one', label: 'Synthetic trade one' }] } }; });
      await page.addScriptTag({ content: script });
      const restoredTools = page.getByRole('region', { name: 'Wattzun tools', exact: true });
      await restoredTools.getByRole('button', { name: 'Pirate hat', exact: true }).waitFor();
      await rendered(page);
      assert.equal(await restoredTools.getByRole('button', { name: 'Pirate hat', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await restoredTools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '0.85');
      await page.close();
    });
  } finally { await browser.close(); }
});

test('all three portal Tools use personal scoped usage and deliberate draft/send/call controls', { skip: !browserPath && 'No installed browser for interaction checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const portal of ['trade', 'council', 'creditex']) await t.test(portal, async () => {
      const { page, tools, errors } = await fixturePage(browser, { portal });
      await numbers(tools, [7, 3]);
      await tools.getByText('October 2026 · UTC', { exact: true }).waitFor();
      await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).selectOption('1.15');
      const suggestion = portal === 'trade' ? 'Update an existing quote' : portal === 'council' ? 'Campaigns and events' : 'Audit preparation';
      await tools.getByRole('button', { name: new RegExp(`^${suggestion}`) }).click();
      const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
      await dialog.waitFor();
      const input = dialog.getByLabel('Message Wattzun', { exact: true });
      await page.waitForFunction(() => Boolean(document.querySelector('#wattzun-portal-message')?.value));
      assert.match(await input.inputValue(), portal === 'trade' ? /draft changes to the quote for an existing job and save them into its real quote editor/ : portal === 'council' ? /council campaign/ : /audit review/);
      assert.equal(await page.evaluate(() => window.fixtureRequests.filter(request => request.method === 'POST').length), 0, 'Suggested prompt is editable and is not sent automatically');
      assert.equal(await page.evaluate(() => window.fixtureCounters.started + window.fixtureCounters.microphone), 0);
      await input.fill(`Help me with my ${portal} workflow`);
      await dialog.getByRole('button', { name: 'Send', exact: true }).click();
      await dialog.getByText('Which job are you working on?', { exact: true }).waitFor();
      const requests = await page.evaluate(() => window.fixtureRequests);
      const post = requests.find(request => request.method === 'POST');
      assert.equal(post.actor, 'user-one');
      assert.equal(post.body.portal, portal); assert.equal(post.body.scopeId, `synthetic-${portal}-one`);
      assert.deepEqual(post.body.preferences, { speed: 1.15 }, 'Provider-facing preferences contain only speed');
      assert.ok(requests.filter(request => request.url.startsWith('/api/wattzun/usage?')).every(request => request.actor === 'user-one' && new URL(request.url, 'https://fixture.invalid').searchParams.get('scopeId') === `synthetic-${portal}-one`));
      await page.waitForFunction(() => window.fixtureRequests.filter(request => request.url.startsWith('/api/wattzun/usage?')).length >= 2);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).click();
      await dialog.getByText('Listening', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.fixtureCounters.started), 1);
      await dialog.getByRole('button', { name: 'Hang up', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixtureCounters.hungUp), 1);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []); await page.close();
    });
  } finally { await browser.close(); }
});

test('loading/errors show no invented zero and deferred old workspace or actor usage cannot replace current figures', { skip: !browserPath && 'No installed browser for isolation checks' }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const { page, tools, errors } = await fixturePage(browser, { multiple: true, usageModes: { 'user-one:trade:synthetic-trade-one': 'deferred' } });
    const usage = tools.getByRole('region', { name: 'Your Wattzun usage', exact: true });
    await usage.getByRole('status').waitFor();
    await page.waitForFunction(() => window.fixtureDeferred['user-one:trade:synthetic-trade-one']?.length === 1);
    assert.equal(await usage.locator('strong').count(), 0, 'Pending usage shows no metrics');
    await tools.getByRole('combobox', { name: 'Wattzun workspace', exact: true }).selectOption('synthetic-trade-two');
    await numbers(tools, [19, 4]);
    await page.evaluate(() => window.fixtureResolveUsage('user-one:trade:synthetic-trade-one', { portal: 'trade', scopeId: 'synthetic-trade-one', month: '2026-10', monthBasis: 'UTC', audience: 'personal', textMessages: 999, voiceExchanges: 999 }));
    await rendered(page);
    await numbers(tools, [19, 4]);
    await tools.getByRole('button', { name: 'Pirate hat', exact: true }).click();
    await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).selectOption('0.85');
    await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
    await dialog.getByText('Listening', { exact: true }).waitFor();
    await dialog.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('synthetic-trade-one');
    await dialog.getByRole('button', { name: 'Call Wattzun', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureCounters.disposed), 1, 'Changing the assistant workspace disposes the previous call');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.fixtureConfig.usageModes['user-one:trade:synthetic-trade-two'] = 'deferred'; });
    await tools.getByRole('button', { name: 'Refresh Wattzun usage', exact: true }).click();
    await usage.getByRole('status').waitFor(); assert.equal(await usage.locator('strong').count(), 0);
    await page.waitForFunction(() => window.fixtureDeferred['user-one:trade:synthetic-trade-two']?.length === 1);
    await page.evaluate(() => window.fixtureSwitchActor('user-two'));
    await numbers(tools, [41, 11]);
    assert.equal(await tools.getByRole('button', { name: 'None', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '1', 'New actor receives their own preferences');
    await page.evaluate(() => window.fixtureResolveUsage('user-one:trade:synthetic-trade-two', { portal: 'trade', scopeId: 'synthetic-trade-two', month: '2026-10', monthBasis: 'UTC', audience: 'personal', textMessages: 999, voiceExchanges: 999 }));
    await rendered(page);
    await numbers(tools, [41, 11]);
    const before = await page.evaluate(() => window.fixtureRequests.length);
    await page.evaluate(() => {
      window.fixtureUsageChanged({ userUid: 'user-one', portal: 'trade', scopeId: 'synthetic-trade-two' });
      window.fixtureUsageChanged({ userUid: 'user-two', portal: 'trade', scopeId: 'synthetic-trade-two' });
      window.fixtureUsageChanged({ userUid: 'user-two', portal: 'council', scopeId: 'synthetic-council-one' });
      window.fixtureOpenEvent({ userUid: 'user-one', portal: 'trade', scopeId: 'synthetic-trade-two', mode: 'call' });
    });
    await rendered(page);
    assert.equal(await dialog.count(), 0, 'Old actor opening event is ignored');
    assert.equal(await page.evaluate(() => window.fixtureRequests.length), before, 'Foreign usage events do not refresh the active actor');
    await page.evaluate(() => window.fixtureUsageChanged({ userUid: 'user-two', portal: 'trade', scopeId: 'synthetic-trade-one' }));
    await page.waitForFunction(before => window.fixtureRequests.length > before, before);
    await page.evaluate(() => { window.fixtureConfig.usageModes['user-two:trade:synthetic-trade-one'] = 'error'; });
    await tools.getByRole('button', { name: 'Refresh Wattzun usage', exact: true }).click();
    await usage.getByRole('alert').getByText('Usage unavailable. Try again.', { exact: true }).waitFor();
    assert.equal(await usage.locator('strong').count(), 0, 'Server failure does not substitute zero');
    await page.evaluate(() => { window.fixtureConfig.usageModes['user-two:trade:synthetic-trade-one'] = 'invalid'; });
    await tools.getByRole('button', { name: 'Refresh Wattzun usage', exact: true }).click();
    await usage.getByRole('alert').getByText('Your usage figures could not be read. Try again.', { exact: true }).waitFor();
    assert.equal(await usage.locator('strong').count(), 0, 'Mismatched scope never displays figures');
    await page.evaluate(() => { delete window.fixtureConfig.usageModes['user-two:trade:synthetic-trade-one']; });
    await tools.getByRole('button', { name: 'Refresh Wattzun usage', exact: true }).click(); await numbers(tools, [41, 11]);
    await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).click();
    await dialog.getByText('Listening', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.fixtureOldActorAcknowledged = 0;
      window.fixtureSwitchActor('user-one');
      window.fixtureOpenEvent({ userUid: 'user-two', portal: 'trade', scopeId: 'synthetic-trade-one', mode: 'call', acknowledge: () => window.fixtureOldActorAcknowledged++ });
    });
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.fixtureOldActorAcknowledged), 0, 'Auth invalidates old actor opening events synchronously before React cleanup');
    assert.equal(await page.evaluate(() => window.fixtureCounters.disposed), 2, 'Actor change disposes the active call');
    await page.evaluate(() => { delete window.fixtureConfig.usageModes['user-one:trade:synthetic-trade-one']; delete window.fixtureConfig.usageModes['user-one:trade:synthetic-trade-two']; });
    await tools.getByRole('combobox', { name: 'Wattzun workspace', exact: true }).selectOption('synthetic-trade-two');
    await numbers(tools, [19, 4]);
    await page.waitForFunction(() => document.querySelector('[aria-pressed="true"]')?.textContent === 'Pirate hat');
    assert.equal(await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '0.85', 'Returning to the original actor and workspace restores only its saved preferences');
    assert.equal(await page.evaluate(() => window.fixtureCounters.microphone), 0);
    assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});

test('revoked scope lookup shows no usage or callable Tools controls', { skip: !browserPath && 'No installed browser for access checks' }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const { page, tools, errors } = await fixturePage(browser, { scopeFailure: true });
    await tools.getByRole('alert').getByText('Current workspace access is unavailable.', { exact: true }).waitFor();
    assert.equal(await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).count(), 0);
    assert.equal(await tools.getByRole('region', { name: 'Your Wattzun usage', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open Wattzun AI chat', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureRequests.some(request => request.url.startsWith('/api/wattzun/usage?'))), false);
    assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});

test('blocked device storage preserves live Tools choices for late Message and first Call consumers without actor or scope bleed', { skip: !browserPath && 'No installed browser for storage checks' }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const { page, tools, errors } = await fixturePage(browser, { multiple: true, blockedStorage: true, submitOnCall: true });
    const launcher = page.getByRole('button', { name: 'Open Wattzun AI chat', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Wattzun', exact: true });
    await numbers(tools, [7, 3]); await launcher.waitFor(); await rendered(page);
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('anything'); return false; } catch (error) { return error.name === 'SecurityError'; } }), true, 'The browser storage boundary actually rejects reads');
    await tools.getByRole('combobox', { name: 'Wattzun workspace', exact: true }).selectOption('synthetic-trade-two');
    await numbers(tools, [19, 4]); await rendered(page);
    await tools.getByRole('button', { name: 'Pirate hat', exact: true }).click();
    await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).selectOption('0.85');
    await tools.locator('header [data-wattzun-hat="pirate"]').waitFor();
    assert.equal(await launcher.locator('[data-wattzun-hat]').count(), 0, 'Tools choices do not bleed into the assistant while it still has another workspace');
    await tools.getByRole('button', { name: 'Message Wattzun', exact: true }).click();
    await dialog.waitFor(); await currentHat(tools, launcher, dialog, 'pirate');
    await dialog.getByText('Speech speed', { exact: true }).click();
    assert.equal(await dialog.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '0.85', 'A newly mounted conversation receives the live slower choice');
    assert.equal(await dialog.getByRole('combobox', { name: 'Workspace', exact: true }).inputValue(), 'synthetic-trade-two');
    assert.equal(await page.evaluate(() => window.fixtureRequests.filter(request => request.method === 'POST').length), 0, 'Message does not send automatically');
    assert.equal(await page.evaluate(() => window.fixtureCounters.started), 0, 'Message never starts the call');
    await dialog.getByRole('button', { name: 'Minimise Wattzun', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).click();
    await dialog.getByText('Listening', { exact: true }).waitFor();
    await page.waitForFunction(() => window.fixtureRequests.some(request => request.url === '/api/wattzun/voice'));
    const firstCall = await page.evaluate(() => window.fixtureRequests.find(request => request.url === '/api/wattzun/voice'));
    assert.equal(firstCall.actor, 'user-one'); assert.equal(firstCall.body.scopeId, 'synthetic-trade-two');
    assert.deepEqual(firstCall.body.preferences, { speed: 0.85 }, 'The first voice request uses the live slower choice, with no storage or style override');
    assert.equal(await page.evaluate(() => window.fixtureCounters.started), 1);
    await currentHat(tools, launcher, dialog, 'pirate');
    await screen(page, 'blocked-storage-first-call');
    await dialog.getByRole('button', { name: 'Minimise Wattzun', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await tools.getByRole('combobox', { name: 'Wattzun workspace', exact: true }).selectOption('synthetic-trade-one');
    await numbers(tools, [7, 3]); await rendered(page);
    assert.equal(await tools.getByRole('button', { name: 'None', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '1');
    await tools.getByRole('button', { name: 'Message Wattzun', exact: true }).click();
    await dialog.waitFor(); await rendered(page); await currentHat(tools, launcher, dialog, 'none');
    await dialog.getByText('Speech speed', { exact: true }).click();
    assert.equal(await dialog.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '1', 'Another workspace does not inherit the prior slower choice');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => window.fixtureSwitchActor('user-two'));
    await numbers(tools, [41, 11]);
    await tools.getByRole('combobox', { name: 'Wattzun workspace', exact: true }).selectOption('synthetic-trade-two');
    await rendered(page);
    assert.equal(await tools.getByRole('button', { name: 'None', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await tools.getByRole('combobox', { name: 'Speaking speed', exact: true }).inputValue(), '1', 'A different actor in the same workspace starts with their own defaults');
    await tools.getByRole('button', { name: 'Call Wattzun', exact: true }).click();
    await dialog.getByText('Listening', { exact: true }).waitFor();
    await page.waitForFunction(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/voice').length === 2);
    const secondCall = await page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/voice')[1]);
    assert.equal(secondCall.actor, 'user-two'); assert.equal(secondCall.body.scopeId, 'synthetic-trade-two');
    assert.deepEqual(secondCall.body.preferences, { speed: 1 }, 'The new actor voice request does not inherit the old actor preference');
    await currentHat(tools, launcher, dialog, 'none');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.fixtureCounters.disposed), 1, 'Only leaving the prior actor and workspace disposes its call');
    await page.getByRole('region', { name: 'Wattzun call', exact: true }).getByRole('button', { name: 'Hang up', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureCounters.microphone), 0, 'The audio boundary remains synthetic');
    assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});

test('portal navigation renders the actual Tools workspace and excludes the Council demo', () => {
  for (const [file, portal] of [['src/components/DirectTradeDashboard.tsx', 'trade'], ['src/components/TradeTeamPortal.tsx', 'trade'], ['src/components/CreditexCompliancePortal.tsx', 'creditex'], ['src/components/council/CouncilWorkspace.tsx', 'council']]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(`<WattzunToolsWorkspace[^>]*portal="${portal}"`), file);
  }
  const council = fs.readFileSync(path.join(root, 'src/components/council/CouncilWorkspace.tsx'), 'utf8');
  assert.match(council, /view === "wattzun" && !demo && portalUser/);
  assert.match(council, /<WattzunToolsWorkspace[^>]*scopeId=\{profile\.councilId\}/);
  const staff = fs.readFileSync(path.join(root, 'src/components/TradeTeamPortal.tsx'), 'utf8');
  assert.match(staff, /workspace === "wattzun"/);
});

test('business selection and sign-out stop a minimised call without trusting another actor or leaking its transcript', { skip: !browserPath && 'No installed browser for tenant boundary checks' }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const {page,tools,errors}=await fixturePage(browser,{multiple:true,blockedStorage:true});
    await tools.getByRole('button',{name:'Message Wattzun',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Wattzun',exact:true});
    await dialog.getByRole('textbox',{name:'Message Wattzun',exact:true}).fill('Private first business question');
    await dialog.getByRole('button',{name:'Send',exact:true}).click();
    await dialog.getByRole('log',{name:'Conversation with Wattzun',exact:true}).getByText('Private first business question',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
    await dialog.getByText('Listening',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Minimise Wattzun',exact:true}).click();
    const dock=page.getByRole('region',{name:'Wattzun call',exact:true});
    await dock.waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tlink:business-selection-changed',{detail:{uid:'foreign-actor',ownerUid:'synthetic-trade-two'}})));
    assert.equal(await page.evaluate(()=>window.fixtureCounters.disposed),0,'A foreign actor cannot retarget or dismiss this call');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tlink:business-selection-changed',{detail:{uid:'user-one',ownerUid:'synthetic-trade-two'}})));
    await dock.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.fixtureCounters.disposed),1,'The actual business switch disposes the old call even when storage is blocked');
    await page.getByRole('button',{name:'Open Wattzun AI chat',exact:true}).click();
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('combobox',{name:'Workspace',exact:true}).inputValue(),'synthetic-trade-two');
    assert.equal(await dialog.getByText('Private first business question',{exact:true}).count(),0,'The new business never inherits old conversation content');
    await dialog.getByRole('button',{name:'Call Wattzun',exact:true}).click();
    await dialog.getByText('Listening',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Minimise Wattzun',exact:true}).click();
    await dock.waitFor();
    await page.evaluate(()=>window.fixtureAuthListeners.forEach(callback=>callback(null)));
    await dock.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.fixtureCounters.disposed),2,'Sign-out disposes the active minimised call');
    assert.equal(await page.getByRole('button',{name:'Open Wattzun AI chat',exact:true}).count(),0);
    assert.deepEqual(errors,[]); await page.close();
  } finally { await browser.close(); }
});
