import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const job = { jobId: 'job-john', workNumber: 'TL-112', title: 'Hot water replacement', customerName: 'John Smith', address: '12 Example Street, Frankston VIC 3199', scheduledAt: '2026-10-01T01:00:00Z', completedAt: '2026-10-02T01:00:00Z' };
const quote = { kind: 'draft_job_quote', jobQuery: 'John in Frankston', jobId: 'job-john', mode: 'append', description: 'Agreed replacement', lines: [{ lineType: 'product', description: 'Supply agreed unit', quantity: '1', unitPrice: '1500', taxCode: 'gst' }] };
const item = { kind: 'add_price_book_item', name: 'Hot water unit', description: 'Supply unit', itemType: 'product', unitLabel: 'each', unitPrice: '1500', supplierCost: null, taxCode: 'gst' };
const reminder = { kind: 'invoice_reminder', jobQuery: 'last week in Frankston', jobId: '', invoiceId: '', channel: 'sms', body: 'A friendly reminder about your invoice.' };
const review = { state: 'review', reviewId: 'review-frozen-123456', expiresAt: '2026-10-07T23:59:00Z', kind: 'invoice_reminder', heading: 'Send invoice reminder', summary: 'Send the selected customer a reminder for invoice INV-112.', confirmationLabel: 'Send text', lines: [{ label: 'Recipient', value: 'John Smith · 0412 345 678' }, { label: 'Invoice', value: 'INV-112 · $1,650.00 outstanding' }, { label: 'Channel', value: 'SMS' }], preview: { subject: '', body: 'Hi John, a friendly reminder that invoice INV-112 is outstanding. Thanks.' }, target: job };
const receipt = { kind: 'invoice_reminder', id: 'receipt-123', label: 'Open sent reminder', href: '/direct-trade/dashboard?workspace=work&jobId=job-john&jobTab=connect', status: 'submitted', message: 'The SMS provider accepted this reminder. Delivery is not yet confirmed.' };

const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, {StrictMode,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {WattzunWorkflowReview} from './src/components/WattzunWorkflowReview';
    window.fixtureRequests=[]; window.fixtureResults=[]; window.fixtureNavigated=[]; window.fixtureCancelled=0; window.fixtureAborted=[]; window.fixturePending=[]; window.fixtureCallConnected=true;
    let executeAttempts=0;
    window.fetch=async(input,options={})=>{
      const url=new URL(input,location.origin), body=JSON.parse(options.body),headers=new Headers(options.headers);
      window.fixtureRequests.push({url:url.pathname,body,scope:headers.get('X-TLink-Business'),authorization:headers.get('Authorization')});
      options.signal?.addEventListener('abort',()=>window.fixtureAborted.push(body.requestId));
      if(url.pathname!=='/api/wattzun/workflows')throw new Error('Unexpected endpoint '+url.pathname);
      if(window.fixtureConfig.delayStage===body.stage)await new Promise(resolve=>window.fixturePending.push(resolve));
      if(body.stage==='prepare')return Response.json({ok:true,result:window.fixtureConfig.prepareResult});
      executeAttempts++;
      if(window.fixtureConfig.uncertain&&executeAttempts===1)throw new Error('Connection ended before a receipt arrived.');
      if(window.fixtureConfig.rejectOnce&&executeAttempts===1)return Response.json({ok:false,error:'The job changed. Prepare the current details again.'},{status:409});
      if(window.fixtureConfig.recoveryReject&&executeAttempts===2)return Response.json({ok:false,error:'Receipt status remains unavailable.'},{status:409});
      return Response.json({ok:true,result:window.fixtureConfig.executeResult});
    };
    function Fixture(){
      const [actor,setActor]=useState('actor-one'),[scope,setScope]=useState('selected-business'),[proposal,setProposal]=useState(window.fixtureConfig.proposal),[visible,setVisible]=useState(true),[initial,setInitial]=useState(window.fixtureConfig.initialResult);
      window.fixtureSwitch=(change)=>{if(change.actor)setActor(change.actor);if(change.scope)setScope(change.scope);if(change.proposal)setProposal(change.proposal);if('initialResult' in change)setInitial(change.initialResult);if('visible' in change)setVisible(change.visible);};
      return visible?<WattzunWorkflowReview user={{uid:actor,getIdToken:async()=>{if(window.fixtureConfig.failToken)throw new Error('Sign in again to recover the result.');return 'token-'+actor;}}} scopeId={scope} proposal={proposal} initialResult={initial} onResult={result=>window.fixtureResults.push(result)} onNavigate={href=>window.fixtureNavigated.push(href)} onCancel={()=>window.fixtureCancelled++}/>:null;
    }
    createRoot(document.getElementById('root')).render(window.fixtureConfig.strict?<StrictMode><Fixture/></StrictMode>:<Fixture/>);
  ` },
  bundle: true, write: false, outfile: 'wattzun-workflow.js', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'workflow-aliases', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, 'src/lib', args.path.slice('@/lib/'.length) + (path.extname(args.path) ? '' : '.ts')) }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;

async function pageFor(browser, config = {}) {
  const page = await browser.newPage({ viewport: { width: config.width || 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto('https://fixture.invalid/');
  await page.evaluate(config => { window.fixtureConfig = config; document.documentElement.dataset.tlinkColourMode = config.night ? 'night' : 'day'; }, {
    proposal: reminder, initialResult: review, prepareResult: review, executeResult: { state: 'complete', receipt }, ...config,
  });
  await page.addStyleTag({ content: 'body{margin:0;padding:10px;font-family:Arial,sans-serif;}*{box-sizing:border-box;}' + css });
  await page.addScriptTag({ content: script });
  return { page, errors };
}

test('actual Wattzun workflow review handles operational confirmations, ambiguity, recovery and scope changes', { skip: !executablePath && 'No installed test browser' }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await t.test('initial server review has one explicit confirmation and scoped send with honest provider receipt', async () => {
      const { page, errors } = await pageFor(browser);
      await page.getByRole('button', { name: 'Send text', exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox').count(), 0);
      assert.equal(await page.evaluate(() => window.fixtureRequests.length), 0);
      assert.match(await page.getByLabel('Message preview').innerText(), /invoice INV-112/);
      assert.match(await page.getByLabel('Selected job').innerText(), /John Smith[\s\S]*12 Example Street/);
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      await page.getByText('The SMS provider accepted this reminder. Delivery is not yet confirmed.').waitFor();
      assert.equal(await page.getByText('submitted', { exact: true }).count(), 1);
      const [request] = await page.evaluate(() => window.fixtureRequests);
      assert.equal(request.scope, 'selected-business'); assert.equal(request.authorization, 'Bearer token-actor-one');
      assert.deepEqual(Object.keys(request.body).sort(), ['stage', 'portal', 'scopeId', 'requestId', 'reviewId', 'reviewed'].sort());
      assert.equal(request.body.reviewId, review.reviewId); assert.equal(request.body.reviewed, true);
      await page.getByRole('button', { name: 'Open sent reminder', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.fixtureNavigated), [receipt.href]);
      assert.equal(await page.evaluate(() => window.fixtureCallConnected), true);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('ambiguous jobs show the saved name, address and date before preparing the exact choice', async () => {
      const other = { ...job, jobId: 'job-other', workNumber: 'TL-113', customerName: 'Jane Smith', address: '14 Example Street, Frankston VIC 3199' };
      const choice = { state: 'choose_job', proposal: reminder, question: 'Did you mean John or Jane in Frankston?', choices: [job, other] };
      const { page, errors } = await pageFor(browser, { initialResult: choice });
      const button = page.getByRole('button', { name: /John Smith 12 Example Street/ }); await button.waitFor();
      assert.match(await button.innerText(), /Completed 2 Oct 2026/);
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).count(), 0);
      await button.click(); await page.getByRole('button', { name: 'Send text', exact: true }).waitFor();
      const [request] = await page.evaluate(() => window.fixtureRequests);
      assert.equal(request.body.stage, 'prepare'); assert.equal(request.body.proposal.jobId, 'job-john');
      assert.equal(request.scope, 'selected-business'); assert.equal(await page.evaluate(() => window.fixtureResults[0].state), 'review');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('unknown quantities and prices produce relevant questions without a save control', async () => {
      const questions = { state: 'needs_details', questions: ['How many units should the quote include?', 'What is the unit price excluding GST?'] };
      const { page, errors } = await pageFor(browser, { proposal: quote, initialResult: questions });
      await page.getByText('How many units should the quote include?', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Save|Send|Add item/ }).count(), 0);
      assert.equal(await page.evaluate(() => window.fixtureRequests.length), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('existing-job draft saves into its real quote editor without creating a new job', async () => {
      const quoteReview = { ...review, kind: 'draft_job_quote', heading: 'Save quote draft', summary: 'Append one reviewed line to job TL-112.', confirmationLabel: 'Save quote draft', preview: undefined, lines: [{ label: 'Supply agreed unit', value: '1 × $1,500.00 ex GST · GST $150.00' }, { label: 'Total', value: '$1,650.00 including GST' }] };
      const quoteReceipt = { ...receipt, kind: 'draft_job_quote', id: 'version-112', label: 'Open saved quote draft', href: '/direct-trade/dashboard?workspace=work&jobId=job-john&jobTab=quote', status: 'saved', message: 'The draft is saved on job TL-112. It has not been issued or sent.' };
      const { page, errors } = await pageFor(browser, { proposal: quote, initialResult: quoteReview, executeResult: { state: 'complete', receipt: quoteReceipt } });
      await page.getByRole('button', { name: 'Save quote draft', exact: true }).click();
      await page.getByRole('button', { name: 'Open saved quote draft', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.fixtureNavigated), [quoteReceipt.href]);
      assert.equal(await page.evaluate(() => window.fixtureRequests.length), 1);
      assert.equal(await page.evaluate(() => window.fixtureCallConnected), true);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('price-book review shows the ex GST price and explicit Add item action', async () => {
      const itemReview = { ...review, kind: item.kind, heading: 'Add price-book item', confirmationLabel: 'Add item', summary: 'Add Hot water unit to this business price book.', preview: undefined, target: undefined, lines: [{ label: 'Unit price ex GST', value: '$1,500.00' }, { label: 'Tax treatment', value: 'GST' }] };
      const itemReceipt = { ...receipt, kind: item.kind, id: 'item-112', label: 'Open price book', href: '/direct-trade/dashboard?workspace=price-book', status: 'saved', message: 'Hot water unit was saved in your business price book.' };
      const { page, errors } = await pageFor(browser, { proposal: item, initialResult: itemReview, executeResult: { state: 'complete', receipt: itemReceipt } });
      await page.getByRole('button', { name: 'Add item', exact: true }).waitFor();
      assert.match(await page.getByLabel('Review Wattzun workflow').innerText(), /Unit price ex GST[\s\S]*\$1,500\.00/);
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await page.getByText(itemReceipt.message, { exact: true }).waitFor();
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('network uncertainty and recovery rejection retain the identical reviewed request', async () => {
      const { page, errors } = await pageFor(browser, { uncertain: true, recoveryReject: true });
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      const retry = page.getByRole('button', { name: 'Retry the same review', exact: true }); await retry.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Cancel task', exact: true }).isDisabled(), true);
      await retry.click(); await page.getByRole('alert').filter({ hasText: 'Receipt status remains unavailable' }).waitFor();
      await retry.click(); await page.getByText(receipt.message, { exact: true }).waitFor();
      const requests = await page.evaluate(() => window.fixtureRequests);
      assert.equal(requests.length, 3); assert.deepEqual(requests[0].body, requests[1].body); assert.deepEqual(requests[0].body, requests[2].body);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a definite stale review rejection requires current preparation before another execution', async () => {
      const { page, errors } = await pageFor(browser, { rejectOnce: true });
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      await page.getByRole('button', { name: 'Prepare a fresh review', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).isDisabled(), true);
      await page.evaluate(() => { window.fixtureConfig.prepareResult = { ...window.fixtureConfig.prepareResult, reviewId: 'review-current-654321' }; });
      await page.getByRole('button', { name: 'Prepare a fresh review', exact: true }).click();
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      await page.getByText(receipt.message, { exact: true }).waitFor();
      const requests = await page.evaluate(() => window.fixtureRequests);
      assert.deepEqual(requests.map(request => request.body.stage), ['execute', 'prepare', 'execute']);
      assert.notEqual(requests[0].body.requestId, requests[2].body.requestId); assert.equal(requests[2].body.reviewId, 'review-current-654321');
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('authentication failure during uncertain recovery preserves the original request ID', async () => {
      const { page, errors } = await pageFor(browser, { uncertain: true });
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      const retry = page.getByRole('button', { name: 'Retry the same review', exact: true }); await retry.waitFor();
      await page.evaluate(() => { window.fixtureConfig.failToken = true; });
      await retry.click(); await page.getByRole('alert').filter({ hasText: 'Sign in again to recover' }).waitFor();
      assert.equal(await page.evaluate(() => window.fixtureRequests.length), 1);
      await page.evaluate(() => { window.fixtureConfig.failToken = false; });
      await retry.click(); await page.getByText(receipt.message, { exact: true }).waitFor();
      const requests = await page.evaluate(() => window.fixtureRequests);
      assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('actor, business and proposal changes abort pending requests and suppress late results', async () => {
      for (const change of [{ actor: 'actor-two' }, { scope: 'other-business' }, { proposal: { ...reminder, body: 'Please check your invoice.' } }]) {
        const { page, errors } = await pageFor(browser, { delayStage: 'execute' });
        await page.getByRole('button', { name: 'Send text', exact: true }).click();
        await page.waitForFunction(() => window.fixturePending.length === 1);
        await page.evaluate(change => window.fixtureSwitch({ ...change, initialResult: { state: 'needs_details', questions: ['Confirm the current task.'] } }), change);
        await page.getByText('Confirm the current task.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.fixtureAborted.length), 1);
        await page.evaluate(() => window.fixturePending.shift()());
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert.deepEqual(await page.evaluate(() => window.fixtureResults), []);
        assert.equal(await page.getByText(receipt.message, { exact: true }).count(), 0);
        assert.deepEqual(errors, []); await page.close();
      }
    });

    await t.test('an external voice receipt replaces the review without another execution or result callback', async () => {
      const { page, errors } = await pageFor(browser);
      await page.getByRole('button', { name: 'Send text', exact: true }).waitFor();
      await page.evaluate(receipt => window.fixtureSwitch({ initialResult: { state: 'complete', receipt } }), receipt);
      await page.getByText(receipt.message, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.fixtureRequests.length), 0);
      assert.deepEqual(await page.evaluate(() => window.fixtureResults), []);
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).count(), 0);
      await page.evaluate(receipt => window.fixtureSwitch({ initialResult: { state: 'complete', receipt } }), receipt);
      assert.equal(await page.getByText(receipt.message, { exact: true }).count(), 1);
      await page.evaluate(review => window.fixtureSwitch({ initialResult: review }), review);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).count(), 0, 'An older parent review cannot reopen a completed operation');
      assert.equal(await page.getByText(receipt.message, { exact: true }).count(), 1);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a newer external receipt aborts pending work and a late response cannot restore the old review', async () => {
      const { page, errors } = await pageFor(browser, { delayStage: 'execute' });
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      await page.waitForFunction(() => window.fixturePending.length === 1);
      const currentReceipt = { ...receipt, message: 'The current server receipt confirms submission.' };
      await page.evaluate(receipt => window.fixtureSwitch({ initialResult: { state: 'complete', receipt } }), currentReceipt);
      await page.getByText(currentReceipt.message, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.fixtureAborted.length), 1);
      await page.evaluate(() => window.fixturePending.shift()());
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await page.getByText(receipt.message, { exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.fixtureResults), []);
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).count(), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('changing business during preparation cancels and hides the old prepared customer facts', async () => {
      const { page, errors } = await pageFor(browser, { initialResult: undefined, delayStage: 'prepare' });
      await page.waitForFunction(() => window.fixturePending.length === 1);
      await page.evaluate(() => window.fixtureSwitch({ scope: 'other-business', initialResult: { state: 'needs_details', questions: ['Describe the task for this business.'] } }));
      await page.getByText('Describe the task for this business.', { exact: true }).waitFor();
      await page.evaluate(() => window.fixturePending.shift()());
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await page.evaluate(() => window.fixtureAborted.length), 1);
      assert.deepEqual(await page.evaluate(() => window.fixtureResults), []);
      assert.equal(await page.getByLabel('Selected job').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Send text', exact: true }).count(), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('a mismatched operation receipt is rejected rather than shown as success', async () => {
      const { page, errors } = await pageFor(browser, { executeResult: { state: 'complete', receipt: { ...receipt, kind: 'add_price_book_item' } } });
      await page.getByRole('button', { name: 'Send text', exact: true }).click();
      await page.getByRole('button', { name: 'Retry the same review', exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.fixtureResults), []);
      assert.equal(await page.getByText(receipt.message, { exact: true }).count(), 0);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('preparation runs correctly in React strict mode without disclosing an aborted response', async () => {
      const { page, errors } = await pageFor(browser, { strict: true, initialResult: undefined });
      await page.getByRole('button', { name: 'Send text', exact: true }).waitFor();
      const requests = await page.evaluate(() => window.fixtureRequests);
      assert.equal(requests.length, 1); assert.equal(requests[0].body.stage, 'prepare');
      assert.equal(await page.evaluate(() => window.fixtureResults.length), 1);
      assert.deepEqual(errors, []); await page.close();
    });

    await t.test('mobile and night layouts fit and retain accessible confirmation controls', async () => {
      for (const config of [{ width: 390 }, { width: 1366, night: true }]) {
        const { page, errors } = await pageFor(browser, config);
        await page.getByRole('button', { name: 'Send text', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const sizes = await page.getByRole('button').evaluateAll(elements => elements.map(element => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })));
        assert.ok(sizes.every(size => size.height >= 44 && size.width >= 44));
        await page.getByRole('button', { name: 'Cancel task', exact: true }).click();
        assert.equal(await page.evaluate(() => window.fixtureCancelled), 1);
        assert.deepEqual(errors, []); await page.close();
      }
    });
  } finally { await browser.close(); }
});
