import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const portalText = fs.readFileSync(new URL('../src/components/TradeTeamPortal.tsx', import.meta.url), 'utf8');
const portal = ts.createSourceFile('TradeTeamPortal.tsx', portalText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['teamCrmShortcuts', 'canUseTeamSales', 'TeamWorkspaceNavigation', 'TeamWorkspaceHeader'];
const functions = portal.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const content = portal.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TradeTeamPortalContent');
const headerObserver = content.body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(portal) === 'observePortalHeader'));
assert.ok(headerObserver, 'The real header observer must position staff navigation below the business switcher.');
const bundled = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, {useCallback, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AeaProductLink,TLinkBrand,TLinkMark} from './src/components/TLinkChrome';
    import {TLinkNavigationIcon} from './src/components/TLinkNavigationIcon';
    const TradeMessageUnreadBadge=()=>null;
    const TradeTeamPresence=()=> <label className="tlink-presence-control"><select aria-label="Call status" defaultValue="online"><option value="online">Online</option></select></label>;
    ${functions.map(node => node.getText(portal)).join('\n')}
    function Fixture(){
      const [view,setView]=useState('business'),[crmView,setCrm]=useState('today'),[colourMode,setMode]=useState('day');
      const permissions=window.fixturePermissions;
      ${headerObserver.getText(portal)}
      return <main className="trade-team-page trade-portal-shell tlink-team-shell is-installer" data-trade-theme="violet_sunset" data-trade-colour-mode={colourMode}>
        <TeamWorkspaceHeader businessName="Australian Energy Assessments" colourMode={colourMode} headerRef={observePortalHeader} getAuthHeaders={async()=>({})} onProfile={()=>setView('profile')} onSignOut={()=>{window.fixtureSignedOut=true}} onToggleColourMode={()=>{const next=colourMode==='night'?'day':'night';document.documentElement.dataset.tlinkColourMode=next;setMode(next)}}/>
        <TeamWorkspaceNavigation permissions={permissions} view={view} crmView={crmView} onView={setView} onCrm={next=>{setCrm(next);setView('business')}}/>
        <div className="tlink-team-content"><section className="dashboard-panel" style={{padding:24,minHeight:1400}}><h1>{view==='business'?crmView:view}</h1><p>Synthetic scoped staff workspace</p></section></div>
        <footer className="tlink-team-footer">Signed in as Synthetic Tester</footer>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, format: 'iife', outfile: 'team-shell.js', jsx: 'automatic',
  loader: { '.css': 'css' },
  plugins: [{ name: 'next-fixture', setup(builder) {
    builder.onResolve({ filter: /^next\/(image|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: root, loader: 'jsx', contents: args.path === 'next/image'
      ? `import React from 'react';export default function Image({priority,unoptimized,...props}){return <img {...props}/>}`
      : `import React from 'react';export default function Link(props){return <a {...props}/>}` }));
  } }],
});
const script = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const globalCss = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8').replace(/^@import .*$/m, '').replace('@theme inline {', ':root {');
const css = globalCss+'\n'+['../src/app/protected-workspaces.css', '../src/app/tlink-colour-mode.css'].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
  + '\n' + (bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const fieldPermissions = { jobScope: 'own', scheduleScope: 'own', canViewCustomers: false, canSearchCustomers: false, canViewPriceBook: false, canManageTeam: false, canViewQuotes: false, canManageQuotes: false, canRunReports: false };

test('staff inherit the shared branded shell with scoped desktop and mobile navigation', { skip: !browserPath, timeout: 90000 }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const width of [1280, 390]) await t.test(`${width}px branded shell and navigation`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('https://fixture.invalid/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }));
        await page.route('https://fixture.invalid/tlink-icon-192.png', route => route.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(new URL('../public/tlink-icon-192.png',import.meta.url))}));
        await page.goto('https://fixture.invalid/');
        await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}[data-tlink-business-switcher]{height:48px;position:sticky;top:0;z-index:90}${css}</style><div data-tlink-business-switcher>Working with Synthetic AEA</div><div id="root"></div>`);
        await page.evaluate(permissions => { window.fixturePermissions = permissions; }, fieldPermissions);
        await page.addScriptTag({ content: script });
        await page.getByRole('navigation', { name: 'Staff workspace' }).waitFor();
        const geometry = await page.evaluate(() => {
          const shell = document.querySelector('.trade-portal-shell'), header = shell.querySelector('.dashboard-hero'), nav = shell.querySelector('nav'), content = shell.querySelector('.tlink-team-content');
          return { gradient: getComputedStyle(header).backgroundImage, rail: getComputedStyle(nav).backgroundColor,
            navX: nav.getBoundingClientRect().x, navWidth: nav.getBoundingClientRect().width, contentX: content.getBoundingClientRect().x,
            shellWidth: shell.getBoundingClientRect().width, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
            stack: Number.parseFloat(getComputedStyle(shell).getPropertyValue('--trade-header-stack-height')), headerBottom: header.getBoundingClientRect().bottom };
        });
        assert.match(geometry.gradient, /75, 42, 132/);
        assert.equal(geometry.rail, 'rgb(43, 23, 71)');
        assert.ok(geometry.documentWidth <= width, `No page overflow: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.stack, geometry.headerBottom);
        if (width > 780) {
          assert.equal(geometry.navX, 0); assert.equal(geometry.navWidth, 244); assert.ok(geometry.contentX >= 244);
          await page.evaluate(() => window.scrollTo(0, 600));
          assert.equal(await page.locator('nav').evaluate(nav => nav.getBoundingClientRect().top), geometry.stack);
        } else {
          assert.equal(geometry.navWidth, width); assert.ok(geometry.contentX < 30);
        }
        await page.getByRole('button', { name: 'Jobs', exact: true }).click();
        await page.getByRole('heading', { name: 'jobs', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Jobs', exact: true }).getAttribute('aria-current'), 'page');
        assert.equal(await page.getByRole('button', { name: 'Jobs', exact: true }).getAttribute('class'), 'active');
        for (const name of ['Customers', 'Products', 'Reports', 'Team', 'Map & quote', 'Business settings']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Night mode' }).click();
        assert.equal(await page.locator('main').getAttribute('data-trade-theme'), 'violet_sunset');
        assert.equal(await page.locator('main').getAttribute('data-trade-colour-mode'), 'night');
        assert.equal(await page.getByRole('button', { name: 'Night mode' }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Wattzun', exact: true }).click();
        await page.getByRole('heading', { name: 'wattzun', exact: true }).waitFor();
        await page.locator('header').getByRole('button', { name: 'My profile', exact: true }).click();
        await page.getByRole('heading', { name: 'profile', exact: true }).waitFor();
        assert.equal(await page.locator('nav').getByRole('button', { name: 'My profile', exact: true }).getAttribute('aria-current'), 'page');
        assert.equal(await page.getByRole('link', { name: 'Get the app', exact: true }).getAttribute('href'), '/direct-trade/field-app');
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        assert.equal(await page.evaluate(() => window.fixtureSignedOut), true);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
