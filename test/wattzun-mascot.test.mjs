import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const hats = ['none', 'hard-hat', 'cap', 'cowboy', 'viking', 'pirate', 'sausage', 'tinfoil', 'safety-plug', 'party', 'pumpkin', 'ghost'];
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {WattzunToolsWorkspace} from './src/components/WattzunToolsWorkspace';
    import {EnergyAssistantLauncher} from './src/components/EnergyAssistantLauncher';
    import {WattzunMascot} from './src/components/WattzunMascot';
    import {WATTZUN_HATS,useWattzunPresentation} from './src/lib/wattzun-appearance';
    const user={uid:'synthetic-user',emailVerified:true,getIdToken:async()=>'synthetic-token'};
    window.fetch=async url=>String(url).startsWith('/api/wattzun/usage')?Response.json({ok:true,usage:{portal:'trade',scopeId:'synthetic-business',month:'2026-10',monthBasis:'UTC',audience:'personal',textMessages:0,voiceExchanges:0}}):Response.json({ok:true,scopes:[{portal:'trade',scopeId:'synthetic-business',label:'Synthetic Trade'}]});
    function Fixture(){const [isPublic,setPublic]=React.useState(false);window.fixtureSetPublic=setPublic;const {hat}=useWattzunPresentation({userUid:user.uid,portal:'trade',scopeId:'synthetic-business'});return <><WattzunToolsWorkspace user={user} portal="trade"/><EnergyAssistantLauncher hat={isPublic?undefined:hat} onPreload={()=>{}} onOpen={()=>{}}/><div id="contact-sheet">{WATTZUN_HATS.map(item=><figure key={item.id}><WattzunMascot hat={item.id} className="sheet-mascot"/><figcaption>{item.label}</figcaption></figure>)}</div></>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, outfile: 'wattzun-mascot.js', format: 'iife', jsx: 'automatic', external: ['/surge-mascot.webp'],
  plugins: [{ name: 'mascot-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/trade-business-client$/ }, () => ({ path: 'business', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const readTradeBusinessSelection=()=> 'synthetic-business';`, loader: 'js' }));
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, 'src/lib', `${args.path.slice('@/lib/'.length)}.ts`) }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;

// Extract landmarks from decoded production pixels, independently of the component's transforms.
async function geometry(page, outer, id, control) {
  return outer.evaluate(async (element, {id,control}) => {
    const art = element.firstElementChild, source = getComputedStyle(art).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)[1];
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height), width = canvas.width, height = canvas.height;
    const seen = new Uint8Array(width * height), dark = index => data[index * 4 + 3] > 200 && Math.max(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]) < 80;
    let face, feet = 0, left = width, right = 0, top = height;
    for (let index = 0; index < seen.length; index++) {
      const x = index % width, y = Math.floor(index / width);
      if (data[index * 4 + 3] > 100) { feet = Math.max(feet, y); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); }
      if (seen[index] || !dark(index)) continue;
      const stack = [index]; seen[index] = 1; let count = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (stack.length) {
        const current = stack.pop(), cx = current % width, cy = Math.floor(current / width); count++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const neighbour of [cx > 0 ? current - 1 : -1, cx + 1 < width ? current + 1 : -1, cy > 0 ? current - width : -1, cy + 1 < height ? current + width : -1]) {
          if (neighbour >= 0 && !seen[neighbour] && dark(neighbour)) { seen[neighbour] = 1; stack.push(neighbour); }
        }
      }
      const fw = x1 - x0 + 1, fh = y1 - y0 + 1, fx = (x0 + x1) / 2, fy = (y0 + y1) / 2;
      if (count > 2000 && fw >= 130 && fw <= 500 && fw / fh >= 1.4 && fw / fh <= 3.5 && fx > width * .3 && fx < width * .7 && fy > height * .3 && fy < height * .65 && (!face || count > face.count)) face = {x:fx,y:fy,count};
    }
    if (!face) throw new Error('No face window in ' + id);
    const frame = element.getBoundingClientRect(), rect = art.getBoundingClientRect(), sx = rect.width / width, sy = rect.height / height;
    const bounds = {left:rect.left + left * sx,right:rect.left + (right + 1) * sx,top:rect.top + top * sy,bottom:rect.top + (feet + 1) * sy};
    const clipped = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (['hidden','clip','scroll','auto'].includes(style.overflowX) && (bounds.left < box.left - 1 || bounds.right > box.right + 1)) clipped.push('horizontal:' + ancestor.tagName);
      if (['hidden','clip','scroll','auto'].includes(style.overflowY) && (bounds.top < box.top - 1 || bounds.bottom > box.bottom + 1)) clipped.push('vertical:' + ancestor.tagName);
    }
    let controlOverlap = false;
    if (control) for (let y = 0; y < height && !controlOverlap; y++) for (let x = 0; x < width; x++) {
      const px = rect.left + x * sx, py = rect.top + y * sy;
      if (data[(y * width + x) * 4 + 3] > 100 && ((px - control.x - control.width / 2) / (control.width / 2)) ** 2 + ((py - control.y - control.height / 2) / (control.height / 2)) ** 2 < 1) { controlOverlap = true; break; }
    }
    return {faceX:rect.left + face.x * sx - frame.left,faceY:rect.top + face.y * sy - frame.top,feetY:rect.top + feet * sy - frame.top,sx,sy,bounds,clipped,controlOverlap};
  }, {id,control});
}

test('all production costumes retain original face/feet anchors without warping or clipping in actual Tools and launcher', { skip: !browserPath && 'No installed browser for visual checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const width of [1366, 390]) await t.test(width < 500 ? 'mobile' : 'desktop', async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://fixture.invalid/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        return route.fulfill(pathname.endsWith('.webp') ? { contentType:'image/webp',body:fs.readFileSync(path.join(root, 'public', pathname)) } : { contentType:'text/html',body:'<!doctype html><html></html>' });
      });
      await page.goto('https://fixture.invalid/');
      await page.setContent(`<html><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:#edf4f1}*{box-sizing:border-box}${css}#contact-sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:50px}#contact-sheet figure{margin:0;padding:45px 6px 8px;display:grid;justify-items:center;background:#d7e4df;border-radius:10px}.sheet-mascot{width:110px;height:140px}figcaption{margin-top:12px;font-size:12px}@media(max-width:500px){#contact-sheet{grid-template-columns:repeat(2,1fr)}}</style></head><body><main style="max-width:1180px;margin:auto"><div id="root"></div></main></body></html>`);
      await page.addScriptTag({content:script});
      const tools = page.getByRole('region', {name:'Wattzun tools',exact:true});
      const hero = tools.locator('header span[aria-hidden="true"]');
      const launcher = page.getByRole('button', {name:'Open Wattzun AI chat',exact:true}).locator('span[aria-hidden="true"]');
      await hero.waitFor();
      const baseline = await Promise.all([geometry(page, hero, 'none'), geometry(page, launcher, 'none')]);
      for (const id of hats) {
        const preview = id === 'none' ? tools.getByRole('button', {name:'None',exact:true}) : tools.locator('button').filter({has:page.locator(`[data-wattzun-hat="${id}"]`)});
        await preview.click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const [index, location] of [hero, launcher].entries()) {
          const result = await geometry(page, location, id);
          for (const anchor of ['faceX','faceY','feetY']) assert.ok(Math.abs(result[anchor] - baseline[index][anchor]) < .3, `${id} ${index ? 'launcher' : 'Tools'} ${anchor} matches original`);
          assert.ok(Math.abs(result.sx - result.sy) < .0001, `${id} keeps uniform scale`);
          assert.deepEqual(result.clipped, [], `${id} has complete headgear`);
        }
        const previewArt = await geometry(page, preview.locator('span[aria-hidden="true"]'), id);
        const tile = await preview.boundingBox();
        assert.ok(previewArt.bounds.top >= tile.y + 2 && previewArt.bounds.left >= tile.x && previewArt.bounds.right <= tile.x + tile.width, `${id} headgear fits its appearance tile`);
        const dismiss = await page.getByRole('button', {name:'Hide Wattzun AI mascot',exact:true}).boundingBox();
        const launcherButton = await page.getByRole('button', {name:'Open Wattzun AI chat',exact:true}).boundingBox();
        assert.equal(dismiss.y - launcherButton.y, -28, `${id} portal close control has headgear clearance`);
        const shown = await geometry(page, launcher, id, dismiss);
        assert.equal(shown.controlOverlap, false, `${id} does not crowd launcher close control`);
      }
      await page.evaluate(() => window.fixtureSetPublic(true));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await launcher.locator('[data-wattzun-hat]').count(), 0, 'Public AEA launcher uses the original mascot');
      const publicGeometry = await geometry(page, launcher, 'none');
      for (const anchor of ['faceX','faceY','feetY']) assert.ok(Math.abs(publicGeometry[anchor] - baseline[1][anchor]) < .3, `Public AEA ${anchor} remains unchanged`);
      const publicDismiss = await page.getByRole('button', {name:'Hide Wattzun AI mascot',exact:true}).boundingBox();
      const publicButton = await page.getByRole('button', {name:'Open Wattzun AI chat',exact:true}).boundingBox();
      assert.equal(publicDismiss.y - publicButton.y, -5, 'Public AEA close control retains its original position');
      assert.deepEqual(errors, []);
      if (process.env.WATTZUN_MASCOT_QA_OUTPUT) {
        fs.mkdirSync(process.env.WATTZUN_MASCOT_QA_OUTPUT, {recursive:true});
        await page.locator('#contact-sheet').screenshot({path:path.join(process.env.WATTZUN_MASCOT_QA_OUTPUT, `wattzun-aligned-${width}.png`)});
      }
      await page.close();
    });
  } finally { await browser.close(); }
});
