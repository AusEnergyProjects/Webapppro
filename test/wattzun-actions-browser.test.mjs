import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const proposal = { kind: 'prepare_quote', firstName: 'Alex', lastName: 'Customer', email: 'alex@example.test', phone: '0412345678', addressQuery: '12 Main Street', serviceCategory: 'hot-water', description: 'Replace the agreed hot water system', lines: [{ lineType: 'product', description: 'Supply and install agreed system', quantity: null, unitPrice: null, taxCode: null }] };
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useCallback,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {WattzunActionReview} from './src/components/WattzunActionReview';
    import {AustralianAddressLookup} from './src/components/AustralianAddressLookup';
    import {createTradeBusinessFetch} from './src/lib/trade-business-client';
    window.fixtureRequests=[];window.fixtureCreated=[];window.fixtureNavigated=[];window.fixtureCancelled=0;window.fixtureAddressSelections=[];window.fixtureAddressAborted=false;
    const customer={customerId:'saved-customer',serviceSiteId:'saved-site',displayName:'Alex Customer',firstName:'Alex',lastName:'Customer',email:'alex@example.test',phone:'0412345678',addressLine1:'12 Main Street',addressLine2:'',suburb:'Richmond',addressState:'VIC',postcode:'3121'};
    let failed=false,actionAttempts=0,addressResolutions=0;
    window.fetch=async(input,options={})=>{
      const url=new URL(input,location.origin),body=options.body?JSON.parse(options.body):null;
      const headers=new Headers(options.headers);window.fixtureRequests.push({url:url.pathname,body,scope:headers.get('X-TLink-Business'),authorization:headers.get('Authorization')});
      if(url.pathname==='/api/trade-crm')return Response.json({ok:true,matches:[customer]});
      if(url.pathname==='/api/trade-address-suggestions'){
        const street=window.fixtureConfig.changedAddress?'14 Main Street':'12 Main Street',formatted=street+', Richmond VIC 3121, Australia';
        if(body.action==='predict')return Response.json({ok:true,configured:true,predictions:[{id:'google-place-one',label:formatted,provider:'google-places'}]});
        const resolved=()=>Response.json({ok:true,configured:true,selection:{id:'google-place-one',label:formatted,addressLine1:street,addressLine2:'',suburb:'Richmond',addressState:'VIC',postcode:'3121',provider:window.fixtureConfig.neutral?'neutral':'google-places',providerReference:'google-place-one',formattedAddress:formatted,selectionProof:'synthetic-proof-'+(++addressResolutions)}});
        if(window.fixtureConfig.delayAddressResolve){options.signal.addEventListener('abort',()=>{window.fixtureAddressAborted=true;});return new Promise(resolve=>{window.fixtureReleaseAddressResolve=()=>resolve(resolved());});}
        return resolved();
      }
      if(url.pathname==='/api/wattzun/actions'){
        actionAttempts++;
        if(window.fixtureConfig.expireOnRetry){
          if(actionAttempts===1)throw new Error('The connection ended before the saved result arrived.');
          if(actionAttempts===2||body.action.address.addressSelectionProof==='synthetic-proof-1')return Response.json({ok:false,error:'The Google address verification has expired. Select that address again.'},{status:400});
        }
        if(window.fixtureConfig.partial&&!failed){failed=true;return Response.json({ok:false,error:'The saved job needs draft recovery.',partial:{workOrderId:'saved-job',href:'/direct-trade/dashboard?workspace=work&jobId=saved-job&jobTab=quote'}},{status:503});}
        const receipt=body.action.kind==='create_customer'?{kind:'customer',id:'saved-customer',href:'/direct-trade/dashboard?workspace=work&customerId=saved-customer',label:'Open saved customer'}:{kind:'quote_draft',id:'saved-quote',workOrderId:'saved-job',versionId:'saved-version',href:'/direct-trade/dashboard?workspace=work&jobId=saved-job&jobTab=quote',label:'Open saved quote draft'};
        return Response.json({ok:true,receipt});
      }
      throw new Error('Unexpected fixture request '+url.pathname);
    };
    const user={uid:'actor-one',getIdToken:async()=>'synthetic-token'};
    function ScopedLookup(){const [scope,setScope]=useState('selected-business'),[query,setQuery]=useState('12 Main Street');window.fixtureSwitchAddressScope=setScope;
      const request=useCallback((input,init)=>createTradeBusinessFetch(scope,location.origin,fetch)(input,init),[scope]);const authorization=useCallback(()=>user.getIdToken(),[]);
      return <AustralianAddressLookup label='Match street address with Google' value={query} onChange={setQuery} onSelect={value=>{window.fixtureAddressSelections.push({scope,value});setQuery(value.addressLine1);}} endpoint='/api/trade-address-suggestions' getAuthorization={authorization} request={request}/>;}
    createRoot(document.getElementById('root')).render(window.fixtureConfig.addressOnly?<ScopedLookup/>:<WattzunActionReview user={user} scopeId='selected-business' proposal={window.fixtureConfig.proposal} onCreated={receipt=>window.fixtureCreated.push(receipt)} onNavigate={href=>window.fixtureNavigated.push(href)} onCancel={()=>window.fixtureCancelled++}/>);
  ` }, bundle: true, write: false, outfile: 'wattzun-review.js', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'scoped-review-aliases', setup(builder) {
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
  await page.evaluate(config => { window.fixtureConfig = config; document.documentElement.dataset.tlinkColourMode = config.night ? 'night' : 'day'; }, { proposal, ...config });
  await page.addStyleTag({ content: 'body{margin:0;padding:10px;box-sizing:border-box;font-family:Arial,sans-serif;}*{box-sizing:border-box;}' + css });
  await page.addScriptTag({ content: script });
  return { page, errors };
}
async function googleAddress(page, expectSelection = true) {
  const input = page.getByRole('combobox', { name: 'Match street address with Google' });
  await input.fill('12 Main Street');
  const result = page.getByRole('option', { name: '12 Main Street, Richmond VIC 3121, Australia' });
  await result.waitFor(); await result.click();
  if (expectSelection) await page.getByText(/^Selected Google address:/).waitFor();
}
async function quoteReview(page) {
  await page.getByRole('button', { name: 'Alex Customer 12 Main Street, Richmond, VIC, 3121' }).click();
  await googleAddress(page);
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByLabel('Unit price ex GST ($)', { exact: true }).fill('1000.00');
  await page.getByLabel('Tax for line 1', { exact: true }).selectOption('gst');
  await page.getByRole('checkbox').check();
}

test('actual quote review keeps unknown amounts blank and requires explicit spelling and Google review before saving', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, errors } = await pageFor(browser);
    await page.getByRole('button', { name: 'Alex Customer 12 Main Street, Richmond, VIC, 3121' }).waitFor();
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Unit price ex GST ($)', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Tax for line 1', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/actions').length), 0);
    await quoteReview(page);
    assert.deepEqual(await page.locator('form').evaluate(form => [...form.elements].filter(element => element.validity && !element.validity.valid).map(element => ({ name: element.getAttribute('aria-label') || element.name || element.tagName, value: element.value, error: element.validationMessage }))), []);
    assert.match(await page.getByLabel('Reviewed quote total').innerText(), /Subtotal ex GST: \$1,000\.00\. GST: \$100\.00\. Total: \$1,100\.00/);
    await page.getByRole('button', { name: 'Confirm and save quote draft' }).click();
    await page.waitForFunction(() => window.fixtureCreated.length === 1);
    const request = await page.evaluate(() => window.fixtureRequests.find(request => request.url === '/api/wattzun/actions'));
    assert.equal(request.scope, 'selected-business'); assert.equal(request.body.action.customerMode, 'existing');
    assert.equal(request.body.action.customerId, 'saved-customer'); assert.equal(request.body.action.serviceSiteId, 'saved-site');
    assert.equal(request.body.confirmation.name, 'Alex Customer'); assert.equal(request.body.confirmation.reviewed, true);
    assert.equal(request.body.confirmation.address, '12 Main Street, Richmond VIC 3121, Australia');
    assert.deepEqual(request.body.action.lines[0], { lineType: 'product', description: 'Supply and install agreed system', quantity: '1', unitPrice: '1000.00', taxCode: 'gst' });
    assert.ok((await page.evaluate(() => window.fixtureRequests)).every(request => request.scope === 'selected-business' && request.authorization === 'Bearer synthetic-token'));
    assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});
test('partial quote recovery keeps the exact request ID/body and offers the actual saved job', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, errors } = await pageFor(browser, { partial: true });
    await quoteReview(page); await page.getByRole('button', { name: 'Confirm and save quote draft' }).click();
    await page.getByRole('button', { name: 'Retry the same review' }).waitFor();
    assert.equal(await page.getByLabel('Quantity', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Open the saved quote job' }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureNavigated), ['/direct-trade/dashboard?workspace=work&jobId=saved-job&jobTab=quote']);
    await page.getByRole('button', { name: 'Retry the same review' }).click();
    await page.waitForFunction(() => window.fixtureCreated.length === 1);
    const requests = await page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/actions'));
    assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});

test('ambiguous recovery refreshes only the same Google proof while keeping submitted identity and amounts fixed', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, errors } = await pageFor(browser, { expireOnRetry: true });
    await quoteReview(page); await page.getByRole('button', { name: 'Confirm and save quote draft' }).click();
    const retry = page.getByRole('button', { name: 'Retry the same review' }); await retry.waitFor();
    await retry.click(); await page.getByRole('alert').filter({ hasText: 'verification has expired' }).waitFor();
    assert.equal(await page.getByLabel('Quantity', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Unit price ex GST ($)', { exact: true }).isDisabled(), true);
    const refresh = page.getByRole('combobox', { name: 'Refresh the same Google address' });
    await page.evaluate(() => { window.fixtureConfig.changedAddress = true; });
    await refresh.fill('14 Main Street'); await page.getByRole('option', { name: '14 Main Street, Richmond VIC 3121, Australia' }).click();
    await page.getByRole('alert').filter({ hasText: 'Choose the same Google property' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/actions').length), 2);
    await page.evaluate(() => { window.fixtureConfig.changedAddress = false; });
    await refresh.fill('12 Main Street'); await page.getByRole('option', { name: '12 Main Street, Richmond VIC 3121, Australia' }).click();
    await page.waitForFunction(() => !document.querySelector('[role=alert]'));
    await retry.click(); await page.waitForFunction(() => window.fixtureCreated.length === 1);
    const requests = await page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/actions'));
    assert.equal(requests.length, 3); assert.deepEqual(requests[0].body, requests[1].body);
    assert.equal(requests[2].body.requestId, requests[0].body.requestId);
    assert.equal(requests[2].body.action.address.addressSelectionProof, 'synthetic-proof-3');
    const original = structuredClone(requests[0].body); original.action.address.addressSelectionProof = 'synthetic-proof-3';
    assert.deepEqual(requests[2].body, original); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});
test('editing the name or Google query revokes confirmation and neutral selections never save', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page } = await pageFor(browser, { proposal: { ...proposal, kind: 'create_customer', serviceCategory: '', description: '', lines: [] } });
    await googleAddress(page); await page.getByRole('checkbox').check();
    await page.getByLabel('First name', { exact: true }).fill('Alec'); assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByRole('checkbox').check(); await page.getByRole('combobox', { name: 'Match street address with Google' }).fill('14 Main Street');
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirm and create customer' }).click();
    await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.fixtureCreated.length), 0); await page.close();
    const neutral = await pageFor(browser, { neutral: true, proposal: { ...proposal, kind: 'create_customer', serviceCategory: '', description: '', lines: [] } });
    await googleAddress(neutral.page, false); await neutral.page.getByRole('alert').waitFor();
    await neutral.page.getByRole('checkbox').check(); await neutral.page.getByRole('button', { name: 'Confirm and create customer' }).click();
    assert.equal(await neutral.page.evaluate(() => window.fixtureRequests.filter(request => request.url === '/api/wattzun/actions').length), 0); await neutral.page.close();
  } finally { await browser.close(); }
});
test('mobile and night review layouts fit the viewport with usable controls', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const config of [{ width: 390 }, { width: 1366, night: true }]) {
      const { page, errors } = await pageFor(browser, config);
      await page.getByRole('button', { name: 'New customer', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const sizes = await page.locator('button,input:not([type=checkbox]),select,textarea').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })));
      assert.ok(sizes.every(size => size.height >= 44 && size.width >= 44));
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
test('an address request override scopes both Google stages and rejects a late selection after the business changes', { skip: !executablePath && 'No installed test browser' }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, errors } = await pageFor(browser, { addressOnly: true, delayAddressResolve: true });
    await page.getByRole('option', { name: '12 Main Street, Richmond VIC 3121, Australia' }).click();
    await page.waitForFunction(() => Boolean(window.fixtureReleaseAddressResolve));
    await page.evaluate(() => window.fixtureSwitchAddressScope('other-business'));
    await page.waitForFunction(() => window.fixtureAddressAborted);
    await page.evaluate(() => window.fixtureReleaseAddressResolve());
    await page.waitForFunction(() => window.fixtureRequests.some(request => request.scope === 'other-business'));
    assert.deepEqual(await page.evaluate(() => window.fixtureAddressSelections), []);
    const original = await page.evaluate(() => window.fixtureRequests.filter(request => request.scope === 'selected-business'));
    assert.deepEqual(original.map(request => request.body.action), ['predict', 'resolve']);
    assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});
