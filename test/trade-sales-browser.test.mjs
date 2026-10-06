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
    import { TradeSalesWorkspace } from './src/components/TradeSalesWorkspace';
    const settings = { revision: 1, stages: [{id:'enquiry',name:'New'}, {id:'qualifying',name:'Checking'}, {id:'quoting',name:'Quoting'}] };
    const makeItem = (id) => ({ id:String(id), workNumber:'JOB-'+id, title:'Air conditioning installation '+id,
      customerName:'Synthetic customer', customerProtected:false, serviceCategory:'air_conditioning',
      stageId:'enquiry', stageName:'New', status:'open', ownerMemberId:'sam', ownerName:'Sam',
      estimatedValueCents:250000, expectedCloseOn:'2026-10-20', lastContactOn:'', nextAction:'Confirm the site visit', nextActionOn:'2026-10-12',
      revision:1, jobRevision:2, canEdit:true, canEditValue:true });
    const records = Array.from({length:26},(_,index)=>makeItem(index+1));
    window.salesOpened = []; window.salesWrites = [];
    window.salesFetch = async (url, options) => {
      const params = new URL(url,'https://fixture.invalid').searchParams;
      let result;
      if(options.method === 'PATCH') {
        const body = JSON.parse(options.body); window.salesWrites.push(body);
        const item = records.find(item=>item.id===body.workOrderId);
        if(item) { Object.assign(item,body); item.revision++; item.jobRevision++; }
        result = {ok:true,item};
      } else if(params.get('mode')==='config') result={ok:true,settings,owners:[{id:'sam',name:'Sam'}],permissions:{canManage:true,canViewValues:true,canEditValues:true,canConfigure:true}};
      else {
        const matching = records.filter(item=>!params.get('stage') || item.stageId===params.get('stage'));
        const offset = params.get('cursor') ? 25 : 0;
        result={ok:true,items:matching.slice(offset,offset+25),stages:[],total:matching.length,pageSize:25,hasNext:matching.length>offset+25,nextCursor:matching.length>offset+25?'second-page':''};
      }
      return {ok:true,status:200,json:async()=>result};
    };
    const user = {uid:'synthetic-owner',getIdToken:async()=>'synthetic-token'};
    createRoot(document.getElementById('root')).render(<TradeSalesWorkspace user={user}
      onOpenJob={(id,tab)=>window.salesOpened.push({id,tab})} onNewQuote={()=>window.salesOpened.push({newQuote:true})}
      suppliedLeads={[{id:'fixture-lead',title:'Heat pump enquiry',detail:'Sydney NSW'}]} onReviewSuppliedLeads={()=>{}}
      onRegisterLeave={check=>window.salesCanLeave=check} />);
  ` },
  bundle: true, write: false, outfile: 'sales.js', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'synthetic-business', setup(builder) {
    builder.onResolve({ filter: /TradeBusinessProvider$/ }, () => ({ path: 'business', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const business={ownerUid:'synthetic-owner',memberId:'sam',role:'owner'}; export const useTradeBusiness=()=>business; export const useTradeBusinessFetch=()=>window.salesFetch;` }));
    builder.onResolve({ filter: /^@\/lib\/trade-sales$/ }, () => ({ path: path.join(root, 'src/lib/trade-sales.ts') }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const modes = fs.readFileSync(path.join(root, 'src/app/tlink-colour-mode.css'), 'utf8');

test('Sales board paginates beyond 25 and supports saved details, same-job navigation and accessible responsive dialogs', { skip: !browserPath && 'No installed browser for layout checks' }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const scenario of [{name:'desktop-day',width:1366,height:900,mode:'day'}, {name:'desktop-night',width:1366,height:900,mode:'night'}, {name:'mobile-day',width:390,height:844,mode:'day'}, {name:'mobile-night',width:390,height:844,mode:'night'}]) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://fixture.invalid/', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html></html>'}));
      await page.goto('https://fixture.invalid/');
      await page.setContent(`<html data-tlink-colour-mode="${scenario.mode}"><head><style>html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;background:#e9f0ee}*{box-sizing:border-box}.trade-portal-shell{--trade-ink:#163c43;--trade-muted:#61767a;--trade-surface:#fff;--trade-surface-soft:#eff8f4;--trade-line:#d9e6e4;--trade-accent:#087b69} ${modes} ${css}</style></head><body><main class="trade-portal-shell"><div id="root"></div></main></body></html>`);
      await page.addScriptTag({ content: script });
      const column = page.getByRole('region', {name:'New',exact:true});
      // Sections have accessible names, even without an explicit role attribute.
      await page.getByRole('button', {name:/Load more new \(25 of 26\)/}).waitFor();
      assert.equal(await column.getByRole('listitem').count(), 25);
      await column.getByRole('button', {name:/Load more new/}).click();
      await page.getByText('26 of 26 shown', {exact:true}).waitFor();
      assert.equal(await column.getByRole('listitem').count(), 26);
      const first = column.getByRole('listitem').first();
      await first.getByRole('button', {name:'Open quote',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.salesOpened), [{id:'1',tab:'quote'}]);
      await first.getByRole('button', {name:'Edit sales details'}).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      assert.equal(await dialog.locator(':focus').count(), 1, 'Opening the dialog moves focus inside it');
      await dialog.getByLabel('Next action', {exact:true}).fill('Call to confirm access');
      await dialog.getByRole('button', {name:'Save sales details'}).click();
      await dialog.waitFor({state:'detached'});
      assert.equal((await page.evaluate(()=>window.salesWrites))[0].workOrderId, '1');
      assert.equal((await page.evaluate(()=>window.salesWrites))[0].nextAction, 'Call to confirm access');
      await page.getByRole('button', {name:'Manage stages'}).click();
      await dialog.waitFor();
      await dialog.getByRole('button', {name:'Add stage'}).click();
      await dialog.getByLabel('Stage 4', {exact:true}).fill('Follow up');
      page.once('dialog', event=>event.dismiss());
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), true, 'Declining to discard preserves the stage draft');
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= scenario.width + 1, 'Dialog fits the viewport');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, 'Board scrolling stays inside the workspace');
      if(process.env.SALES_QA_OUTPUT) {
        fs.mkdirSync(process.env.SALES_QA_OUTPUT, {recursive:true});
        await page.screenshot({path:path.join(process.env.SALES_QA_OUTPUT,`${scenario.name}-dialog.png`)});
      }
      page.once('dialog', event=>event.accept());
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      await page.getByRole('button', {name:'List',exact:true}).click();
      await page.getByRole('button', {name:/Load more opportunities/}).waitFor();
      assert.equal(await page.getByRole('list', {name:'Opportunities'}).getByRole('listitem').count(), 25);
      if(process.env.SALES_QA_OUTPUT) await page.screenshot({path:path.join(process.env.SALES_QA_OUTPUT,`${scenario.name}-list.png`)});
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally { await browser.close(); }
});
