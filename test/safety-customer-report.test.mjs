import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';
import * as contract from '../src/lib/safety-customer-report.ts';

const token = 'example-id.example-secret', api = `/api/trade-safety-check-report?token=${encodeURIComponent(token)}`;
const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const styles = { default: new Proxy({}, { get: (_, key) => key }) };
function load(file, imports) {
  const output = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(name in imports, `Unmapped import: ${name}`); return imports[name]; }, record, record.exports);
  return record.exports;
}
const { SafetyCustomerReportContent } = load('src/components/SafetyCustomerReportContent.tsx', {
  'react/jsx-runtime': jsx, '@/lib/safety-customer-report': contract, './SafetyCustomerReport.module.css': styles,
});
function report(extra = {}) {
  return { kind: 'gas', recordNumber: 'GSC-EXAMPLE-ONLY', title: 'Gas Safety Check', propertyAddress: '1 Example Street, Melbourne VIC 3000',
    inspectionDate: '2026-10-13', completedAt: '2026-10-13T03:30:00.000Z', inspectorName: 'Example Inspector',
    business: { name: 'Example Safety Services', email: 'example@example.test', phone: '03 0000 0000', logoUrl: `${api}&view=brand-logo` },
    outcome: { label: 'Unsafe: the recorded appliance requires disconnection and urgent work.', attention: 'urgent' },
    sections: [
      { title: 'Recorded findings and next steps', items: [{ label: 'Details of identified faults', value: 'Example ventilation fault recorded by the inspector.' },
        { label: 'Remedial action to be taken', value: 'Do not use the identified appliance until the inspecting business confirms the necessary work.' },
        { label: 'Next gas safety check due', value: '2028-10-13' }] },
      { title: 'Appliance 1: example kitchen cooktop', items: [{ label: 'Appliance', value: 'Example kitchen cooktop, model EXAMPLE-1' },
        { label: 'Adequate ventilation', value: 'No' }, { label: 'Completed service in accordance with AS 4575', value: 'Yes' },
        { label: 'Comments', value: 'Example finding, not a real customer assessment.' }] },
    ],
    signatures: [{ name: 'Example Inspector', title: 'Signed by gasfitter', signedAt: '2026-10-13T03:25:00.000Z' }],
    evidence: [{ id: 'example-photo', label: 'Appliance 1 identifying photo', fileName: 'example-appliance.jpg', contentType: 'image/jpeg', url: `${api}&view=evidence&evidenceId=example-photo` },
      { id: 'example-record', label: 'Full appliance servicing record', fileName: 'example-consumer-record.pdf', contentType: 'application/pdf', url: `${api}&view=evidence&evidenceId=example-record` }],
    pdfUrl: `${api}&view=pdf`, ...extra };
}
const html = data => renderToStaticMarkup(createElement(SafetyCustomerReportContent, { report: data }));

test('customer report contract accepts actual supported shapes and only same-capability private assets', () => {
  for (const kind of ['piesa', 'electrical', 'gas']) assert.equal(contract.isSafetyCustomerReport(report({ kind }), token), true);
  assert.equal(contract.safetyReportDate('2026-10-13'), '13 Oct 2026');
  assert.equal(contract.safetyReportDate('not a date'), 'not a date');
  for (const changed of [
    { pdfUrl: 'javascript:alert(1)' }, { pdfUrl: 'https://external.example/api/trade-safety-check-report?token=example&view=pdf' },
    { pdfUrl: '/api/trade-safety-check-report?token=other-secret&view=pdf' },
    { business: { ...report().business, logoUrl: `${api}&view=pdf` } },
    { evidence: [{ ...report().evidence[0], url: `${api}&view=evidence&evidenceId=other-photo` }] },
    { evidence: [{ ...report().evidence[0], contentType: 'text/html' }] },
    { sections: [{ title: 'Wrong answer shape', items: [{ label: 'An answer', value: true }] }] },
  ]) assert.equal(contract.isSafetyCustomerReport(report(changed), token), false);
  assert.deepEqual(contract.safetyReportHighlights(report()).map(item => item.label), ['Details of identified faults', 'Remedial action to be taken', 'Next gas safety check due']);
});

test('rendered report keeps actual unsafe and conditional findings distinct from completion and escapes entered text', () => {
  const rendered = html(report({ inspectorName: '<script>example</script>' }));
  assert.match(rendered, /class="result urgent"/); assert.match(rendered, /Do not use the identified appliance/);
  assert.match(rendered, /&lt;script&gt;example&lt;\/script&gt;/); assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /Download official PDF/); assert.match(rendered, /Save copy/);
  assert.match(rendered, /referrerPolicy="no-referrer"/i); assert.match(rendered, /loading="lazy"/);
  assert.match(rendered, /<main id="site-content"/); assert.match(rendered, /aria-label="Report sections"/);
  assert.doesNotMatch(rendered, /create an account|log in|all checks passed|certified safe|r2:|objectKey|ownerUid|actorUid/i);
  const conditional = html(report({ kind: 'piesa', outcome: { label: 'Rectification recorded. Proceed only when the recorded isolation conditions are met.', attention: 'follow_up' } }));
  assert.match(conditional, /class="result caution"/); assert.match(conditional, /Proceed only when the recorded isolation conditions are met/);
  const withoutOutcome = html(report({ kind: 'electrical', outcome: undefined }));
  assert.doesNotMatch(withoutOutcome, /INSPECTOR&#x27;S RECORDED RESULT|Compliant|Safe to proceed/);
});

function viewerHarness(response) {
  const slots = [], effects = [], requests = []; let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect(callback) { const index = cursor++; if (!effects[index]) effects[index] = { callback, pending: true }; },
  };
  const fetch = async (url, init) => { requests.push({ url, init }); return response; };
  // Bind fetch only to this compiled module rather than changing global network
  // state shared by concurrent tests.
  const output = ts.transpileModule(source('src/components/SafetyCustomerReportViewer.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const imports = { react: hooks, 'react/jsx-runtime': jsx, '@/lib/safety-customer-report': contract,
    './SafetyCustomerReportContent': { SafetyCustomerReportContent }, './SafetyCustomerReport.module.css': styles };
  const record = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', output)(name => imports[name], record, record.exports, fetch);
  const render = () => { cursor = 0; return record.exports.SafetyCustomerReportViewer({ token }); };
  return { requests, render, async settled() { render(); for (const effect of effects.filter(effect => effect?.pending)) { effect.pending = false; effect.cleanup = effect.callback(); }
    for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); return render(); } };
}

test('no-login viewer uses uncached private requests and never renders expired or malformed report data', async () => {
  const valid = viewerHarness(Response.json({ ok: true, report: report() })); const viewed = await valid.settled();
  assert.equal(viewed.type, SafetyCustomerReportContent); assert.equal(viewed.props.report.recordNumber, 'GSC-EXAMPLE-ONLY');
  assert.equal(valid.requests[0].init.cache, 'no-store'); assert.equal(valid.requests[0].init.referrerPolicy, 'no-referrer');
  for (const response of [Response.json({ ok: false, error: 'This report link has expired.' }, { status: 410 }),
    Response.json({ ok: true, report: report({ pdfUrl: 'https://external.example/private.pdf' }) })]) {
    const h = viewerHarness(response), rendered = renderToStaticMarkup(await h.settled());
    assert.match(rendered, /Report unavailable/); assert.doesNotMatch(rendered, /GSC-EXAMPLE-ONLY|1 Example Street/);
    assert.match(rendered, /role="alert"/); assert.equal(h.requests.length, 1);
  }
});

test('private Next page awaits its token and disables indexing, referrers and persistent caching', async () => {
  const page = load('src/app/reports/safety/[token]/page.tsx', { 'react/jsx-runtime': jsx,
    '@/components/SafetyCustomerReportViewer': { SafetyCustomerReportViewer: 'report-viewer' } });
  const rendered = await page.default({ params: Promise.resolve({ token }) });
  assert.equal(rendered.type, 'report-viewer'); assert.equal(rendered.props.token, token);
  assert.equal(rendered.key, token, 'A different capability mounts clean state, without a previous property flash');
  const next = await page.default({ params: Promise.resolve({ token: 'another-id.another-secret' }) });
  assert.notEqual(next.key, rendered.key);
  assert.equal(page.dynamic, 'force-dynamic'); assert.equal(page.revalidate, 0); assert.equal(page.fetchCache, 'force-no-store');
  assert.deepEqual(page.metadata.robots, { index: false, follow: false, noarchive: true, nocache: true, nosnippet: true });
  assert.equal(page.metadata.referrer, 'no-referrer');
});

test('actual report HTML remains readable and keyboard expandable at phone and desktop widths', { timeout: 45_000 }, async () => {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  assert.ok(executablePath, 'An installed browser is required for the actual responsive check');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
  try {
    const context = await browser.newContext();
    const icon = fs.readFileSync(new URL('../public/tlink-icon-192.png', import.meta.url));
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'image/png', body: icon }));
    const page = await context.newPage(), css = source('src/components/SafetyCustomerReport.module.css');
    const document = `<!doctype html><html lang="en-AU"><head><base href="http://report.example"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>body{margin:0}${css}</style></head><body>${html(report())}</body></html>`;
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 850 : 950 }); await page.setContent(document);
      assert.equal(await page.locator('h1').count(), 1);
      assert.ok(await page.getByRole('link', { name: 'Download official PDF' }).isVisible());
      assert.equal(await page.locator('form,input,select').count(), 0, 'Read-only report adds no customer form or login');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
      const summary = page.locator('details').nth(1).locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('details').nth(1).getAttribute('open'), '');
      assert.ok(await page.getByText('Example kitchen cooktop, model EXAMPLE-1', { exact: true }).isVisible());
      assert.equal(await page.locator('img:not([alt])').count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Save Appliance 1 identifying photo', exact: true }).count(), 1);
      if (process.env.SAFETY_REPORT_QA_DIR) {
        fs.mkdirSync(process.env.SAFETY_REPORT_QA_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SAFETY_REPORT_QA_DIR, `safety-customer-report-${width}.png`), fullPage: true });
      }
    }
    await context.close();
  } finally { await browser.close(); }
});
