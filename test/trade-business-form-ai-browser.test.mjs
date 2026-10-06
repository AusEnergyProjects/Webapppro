import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { TradeBusinessFormEditor } from './src/components/TradeBusinessFormEditor';
    import styles from './src/components/TradeFormsWorkspace.module.css';
    window.formAiRequests=[]; window.formAiWrites=[];
    const template={name:'Electrical inspection',description:'Before-work technician inspection',guidance:'Record inspection findings.',
      fields:[{key:'follow_up',label:'Describe follow-up work',type:'textarea',required:false,maxLength:1200,options:[],section:'Inspection',phase:'before'}]};
    const saved=[];
    window.formAiFetch=async (url,options)=>{
      const body=options.body?JSON.parse(options.body):null;
      window.formAiRequests.push({url,method:options.method,body});
      if(url==='/api/trade-form-templates/assist') {
        const result=body.purpose==='Make a form'
          ? {kind:'clarify',questions:['Who will complete the form?','What work should they record?'],form:null}
          : {kind:'draft',questions:[],form:template};
        return Response.json({ok:true,result,sourceHash:'a'.repeat(64)});
      }
      if(url!=='/api/trade-form-templates') throw new Error('Unexpected fixture request: '+url);
      if(options.method==='POST') { window.formAiWrites.push(body); saved.push({...body,id:'saved-template',version:1,updatedAt:'2026-10-06T00:00:00.000Z'}); }
      return Response.json({ok:true,canManage:true,templates:saved});
    };
    const user={uid:'synthetic-author',getIdToken:async()=>'synthetic-token'};
    createRoot(document.getElementById('root')).render(<section className={styles.workspace}>
      <TradeBusinessFormEditor user={user} onRegisterLeave={check=>window.formAiCanLeave=check} />
    </section>);
  ` },
  bundle: true, write: false, outfile: 'form-ai.js', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'synthetic-form-business', setup(builder) {
    builder.onResolve({ filter: /TradeBusinessProvider$/ }, () => ({ path: 'business', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const business={ownerUid:'synthetic-business',memberId:'author',role:'member'}; export const useTradeBusiness=()=>business; export const useTradeBusinessFetch=()=>window.formAiFetch;` }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const modes = fs.readFileSync(path.join(root, 'src/app/tlink-colour-mode.css'), 'utf8');

test('Wattzun form clarification, review and explicit publication work in real desktop/mobile React layouts', { skip: !browserPath && 'No installed browser for layout checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [{name:'desktop-day',width:1366,height:900,mode:'day'}, {name:'desktop-night',width:1366,height:900,mode:'night'}, {name:'mobile-day',width:390,height:844,mode:'day'}, {name:'mobile-night',width:390,height:844,mode:'night'}]) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      page.setDefaultTimeout(5000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://fixture.invalid/**', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid/');
      await page.setContent(`<html data-tlink-colour-mode="${scenario.mode}"><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:#e9f0ee}*{box-sizing:border-box}.trade-portal-shell{--trade-ink:#163c43;--trade-muted:#61767a;--trade-surface:#fff;--trade-surface-soft:#eff8f4;--trade-line:#d9e6e4;--trade-accent:#087b69} ${modes} ${css}</style></head><body><main class="trade-portal-shell"><div id="root"></div></main></body></html>`);
      await page.addScriptTag({ content: script });
      await page.getByText('Draft with Wattzun', {exact:true}).click();
      await page.getByLabel('Form purpose', {exact:true}).fill('Make a form');
      await page.getByLabel('Available on').selectOption('electrical');
      await page.getByRole('button', {name:'Generate draft',exact:true}).click();
      await page.getByText('Who will complete the form?', {exact:true}).waitFor();
      assert.equal(await page.getByRole('button', {name:'Save form',exact:true}).count(), 0);
      assert.deepEqual(await page.evaluate(()=>window.formAiWrites), []);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, 'Clarification fits the viewport');
      await page.getByLabel('Form purpose', {exact:true}).fill('A before-work electrical inspection checklist for technicians, recording follow-up work.');
      await page.getByRole('button', {name:'Generate again',exact:true}).click();
      await page.getByLabel('Form name', {exact:true}).waitFor();
      assert.equal(await page.getByLabel('Form name', {exact:true}).inputValue(), 'Electrical inspection');
      await page.getByLabel('Question', {exact:true}).fill('Describe any follow-up work needed');
      page.once('dialog', dialog=>dialog.dismiss());
      assert.equal(await page.evaluate(()=>window.formAiCanLeave().then(()=>null).catch(error=>error.message)), 'Keep editing');
      assert.equal(await page.getByLabel('Question', {exact:true}).inputValue(), 'Describe any follow-up work needed');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, 'Designer fits the viewport');
      await page.getByRole('tab', {name:'Try the form',exact:true}).click();
      await page.getByText('Describe any follow-up work needed', {exact:true}).first().waitFor();
      assert.deepEqual(await page.evaluate(()=>window.formAiWrites), [], 'Generating, editing and previewing do not publish');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, 'Real phone preview fits the viewport');
      if(process.env.FORM_AI_QA_OUTPUT) {
        fs.mkdirSync(process.env.FORM_AI_QA_OUTPUT, {recursive:true});
        await page.screenshot({path:path.join(process.env.FORM_AI_QA_OUTPUT,`${scenario.name}-preview.png`),fullPage:true});
      }
      await page.getByRole('button', {name:'Save form',exact:true}).click();
      await page.getByRole('button', {name:'Open designer',exact:true}).waitFor();
      const writes = await page.evaluate(()=>window.formAiWrites);
      assert.equal(writes.length, 1); assert.equal(writes[0].name, 'Electrical inspection');
      assert.equal(writes[0].fields[0].label, 'Describe any follow-up work needed'); assert.deepEqual(writes[0].categories, ['electrical']);
      assert.equal(await page.evaluate(()=>window.formAiRequests.filter(request=>request.url.endsWith('/assist')).length), 2);
      assert.deepEqual(errors, []); await page.close();
    });
  } finally { await browser.close(); }
});
