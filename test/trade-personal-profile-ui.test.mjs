import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
const content = portal.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TradeTeamPortalContent');
const statementNamed = name => content.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(portal) === name));
const first = content.body.statements.indexOf(statementNamed('appearanceScope'));
const last = content.body.statements.indexOf(statementNamed('toggleColourMode'));
assert.ok(first >= 0 && last > first, 'Use the production scoped preference lifecycle, including its storage effect.');
const appearanceLifecycle = content.body.statements.slice(first, last + 1).map(node => node.getText(portal)).join('\n');
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useCallback,useEffect,useMemo,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {TradePersonalProfileSettings} from './src/components/TradePersonalProfileSettings';
    import {DEFAULT_TRADE_PERSONAL_APPEARANCE,readTradePersonalAppearance,tradePersonalAppearanceStorageKey,writeTradePersonalAppearance} from './src/lib/trade-personal-appearance';
    import {DEFAULT_TRADE_BRAND_THEME} from './src/lib/trade-business-branding';
    import {AeaProductLink,TLinkBrand,TLinkMark} from './src/components/TLinkChrome';import {TLinkNavigationIcon} from './src/components/TLinkNavigationIcon';
    const TradeMessageUnreadBadge=()=>null,TradeTeamPresence=()=> <span>Online</span>;
    ${functions.map(node => node.getText(portal)).join('\n')}
    function Fixture(){
      const [identity,setIdentity]=useState({uid:'synthetic-josh',ownerUid:'synthetic-aea'}),[view,setView]=useState('profile'),[displayName,setDisplayName]=useState('Joshua Tester');
      const user=useMemo(()=>({uid:identity.uid,email:identity.uid+'@example.invalid',getIdToken:async()=>identity.uid}),[identity.uid]);
      const business={ownerUid:identity.ownerUid},data={access:{brandThemeKey:'violet_sunset'}},emailVerified=true,invitationReady=true,invitationError='',resolver=null,mfaRequired=false;
      window.fixtureOwnerUid=identity.ownerUid;window.fixtureSwitch=(uid,ownerUid)=>setIdentity({uid,ownerUid});
      ${appearanceLifecycle}
      return <main className="trade-team-page trade-portal-shell tlink-team-shell is-installer" data-trade-theme={personalTheme} data-trade-colour-mode={colourMode}>
        <TeamWorkspaceHeader businessName="Australian Energy Assessments" colourMode={colourMode} headerRef={null} getAuthHeaders={async()=>({})} onSignOut={()=>{}} onProfile={()=>setView('profile')} onToggleColourMode={toggleColourMode}/>
        <TeamWorkspaceNavigation permissions={window.fixturePermissions} view={view} crmView="today" onView={setView} onCrm={()=>setView('business')}/>
        <div className="tlink-team-content">{view==='profile'?<TradePersonalProfileSettings key={user.uid+':'+business.ownerUid} user={user} name={displayName} appearance={appearance} employerTheme="violet_sunset" storageAvailable={appearanceState.scope===appearanceScope&&appearanceState.storageAvailable} onAppearanceChange={changeAppearance} onResetAppearance={()=>changeAppearance({...DEFAULT_TRADE_PERSONAL_APPEARANCE})} onSaved={name=>{setDisplayName(name);window.fixtureSavedNames.push(name)}}/>:<p>Other scoped workspace</p>}</div>
        <footer className="tlink-team-footer">Signed in as {displayName}</footer>
      </main>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, write: false, format: 'iife', outfile: 'profile.js', jsx: 'automatic', loader: { '.css': 'css' },
  plugins: [{ name: 'profile-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/TradeBusinessProvider$/ }, () => ({ path: 'provider', namespace: 'fixture' }));
    builder.onLoad({ filter: /^provider$/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const useTradeBusinessFetch=()=>window.fixtureRequest;export const useTradePersonalNameUpdate=()=>window.fixtureNameUpdate;` }));
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, 'src', args.path.slice(2)+(path.extname(args.path)?'':'.ts')) }));
    builder.onResolve({ filter: /^next\/(image|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /^next\//, namespace: 'fixture' }, args => ({ resolveDir: root, loader: 'jsx', contents: args.path === 'next/image'
      ? `import React from 'react';export default function Image({priority,unoptimized,...props}){return <img {...props}/>} `
      : `import React from 'react';export default function Link(props){return <a {...props}/>} ` }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const globalCss = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8').replace(/^@import .*$/m, '').replace('@theme inline {', ':root {');
const css = globalCss+'\n'+['../src/app/protected-workspaces.css', '../src/app/tlink-colour-mode.css'].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
const permissions = { jobScope:'own',scheduleScope:'own',canViewCustomers:false,canSearchCustomers:false,canViewPriceBook:false,canManageTeam:false,canViewQuotes:false,canManageQuotes:false,canRunReports:false };

async function openFixture(browser, width, blockedStorage=false, loadFailure=false) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.route('https://fixture.invalid/**', route => route.fulfill({ status:200,contentType:'text/html',body:'<!doctype html><html></html>' }));
  await page.route('https://fixture.invalid/tlink-icon-192.png', route => route.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.join(root,'public','tlink-icon-192.png'))}));
  await page.goto('https://fixture.invalid/');
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}${css}</style><div id="root"></div>`);
  await page.evaluate(({permissions,blockedStorage,loadFailure})=>{
    if(blockedStorage)Object.defineProperty(window,'localStorage',{get(){throw Error('Storage blocked')}});
    window.fixturePermissions=permissions;window.fixtureLoadFailure=loadFailure;window.fixtureSavedNames=[];window.fixtureProviderNames=[];window.fixtureNameUpdate=name=>window.fixtureProviderNames.push(name);window.fixtureRequests=[];
    window.fixtureRequest=async(url,init={})=>{
      const entry={url,method:init.method||'GET',body:init.body?JSON.parse(init.body):null,uid:init.headers.Authorization.slice(7),ownerUid:window.fixtureOwnerUid};window.fixtureRequests.push(entry);
      if(entry.method==='GET')return new Response(JSON.stringify(window.fixtureLoadFailure?{ok:false,error:'Profile temporarily unavailable.'}:{ok:true,name:'Joshua Tester',phone:'+61400111222',isOwner:false}),{status:window.fixtureLoadFailure?503:200});
      if(window.fixtureDelay)await new Promise(resolve=>{window.fixtureRelease=resolve});
      if(window.fixtureSaveFailure)return new Response(JSON.stringify({ok:false,error:'Your profile could not be saved. Try again.'}),{status:503});
      return new Response(JSON.stringify({ok:true,name:entry.body.name.trim(),phone:entry.body.phone.replace(/^04/,'+614').replaceAll(' ',''),isOwner:false}),{status:200});
    };
  },{permissions,blockedStorage,loadFailure});
  await page.addScriptTag({content:script});
  if(!loadFailure)await page.getByLabel('Contact phone',{exact:true}).waitFor();
  return page;
}

test('personal profile saves own contact details with read-only identity and usable desktop/mobile presentation', {skip:!browserPath,timeout:90000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {for(const width of [1280,390]) {
    const page=await openFixture(browser,width),errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
      assert.equal(await page.getByLabel('Sign-in email',{exact:true}).inputValue(),'synthetic-josh@example.invalid');
      assert.equal(await page.getByLabel('Sign-in email',{exact:true}).evaluate(input=>input.readOnly),true);
      assert.equal(await page.getByLabel('Contact phone',{exact:true}).inputValue(),'+61400111222');
      await page.getByLabel('My name',{exact:true}).fill('  Joshua Updated  ');
      await page.getByLabel('Contact phone',{exact:true}).fill('0412 345 678');
      await page.getByRole('button',{name:'Save my profile',exact:true}).click();
      await page.getByText('Your profile is saved.',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('My name',{exact:true}).inputValue(),'Joshua Updated');
      assert.equal(await page.getByLabel('Contact phone',{exact:true}).inputValue(),'+61412345678');
      const saved=await page.evaluate(()=>({patches:window.fixtureRequests.filter(item=>item.method==='PATCH'),callback:window.fixtureSavedNames,provider:window.fixtureProviderNames}));
      assert.deepEqual(saved.patches[0].body,{name:'  Joshua Updated  ',phone:'0412 345 678'});assert.equal(saved.patches[0].uid,'synthetic-josh');assert.equal(saved.patches[0].ownerUid,'synthetic-aea');
      assert.deepEqual(saved.callback,['Joshua Updated']);assert.deepEqual(saved.provider,['Joshua Updated']);
      assert.equal(await page.getByRole('link',{name:'Password and account security'}).getAttribute('href'),'/direct-trade/security');
      assert.equal(await page.getByRole('button',{name:'Business settings',exact:true}).count(),0);
      await page.getByLabel('Dashboard colours',{exact:true}).selectOption('amber_ink');
      await page.getByLabel('Display mode',{exact:true}).selectOption('night');
      assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'amber_ink');
      assert.equal(await page.locator('main').getAttribute('data-trade-colour-mode'),'night');
      const contrast=await page.getByLabel('Contact phone',{exact:true}).evaluate(input=>{
        const style=getComputedStyle(input),luminance=value=>value.match(/\d+/g).slice(0,3).map(Number).map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
        const background=luminance(style.backgroundColor),ink=luminance(style.color);return (Math.max(background,ink)+.05)/(Math.min(background,ink)+.05);
      });
      assert.ok(contrast>=4.5,`Night input text contrast ${contrast} must remain readable`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'profile must not overflow');
      const output=process.env.TLINK_PROFILE_SCREENSHOT_DIR;
      if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`my-profile-${width}.png`),fullPage:true});}
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  }} finally {await browser.close();}
});

test('profile save failure retains edits, prevents duplicate requests and never reports a false save', {skip:!browserPath,timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await openFixture(browser,390);
  try {
    await page.getByLabel('My name',{exact:true}).fill('Unsaved Joshua');
    await page.evaluate(()=>{window.fixtureSaveFailure=true;window.fixtureDelay=true;document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit()});
    await page.getByRole('button',{name:'Saving...',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixtureRequests.filter(item=>item.method==='PATCH').length),1);
    await page.evaluate(()=>window.fixtureRelease());
    await page.getByRole('alert').getByText('Your profile could not be saved. Try again.').waitFor();
    assert.equal(await page.getByLabel('My name',{exact:true}).inputValue(),'Unsaved Joshua');
    assert.deepEqual(await page.evaluate(()=>window.fixtureSavedNames),[]);
    assert.equal(await page.getByText('Your profile is saved.',{exact:true}).count(),0);
    await page.evaluate(()=>{window.fixtureSaveFailure=false;window.fixtureDelay=false});
    await page.getByRole('button',{name:'Save my profile',exact:true}).click();await page.getByText('Your profile is saved.',{exact:true}).waitFor();
  }finally{await page.close();await browser.close();}
});

test('actual staff preference lifecycle inherits, persists, resets and isolates identity plus selected business', {skip:!browserPath,timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await openFixture(browser,1280);
  try {
    assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'violet_sunset');
    await page.getByLabel('Dashboard colours',{exact:true}).selectOption('forest_jade');await page.getByLabel('Display mode',{exact:true}).selectOption('night');
    await page.evaluate(()=>window.fixtureSwitch('synthetic-kris','synthetic-aea'));
    await page.getByLabel('Sign-in email',{exact:true}).filter({visible:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('input[type=email]')?.value==='synthetic-kris@example.invalid');
    assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'violet_sunset');assert.equal(await page.locator('main').getAttribute('data-trade-colour-mode'),'day');
    await page.evaluate(()=>window.fixtureSwitch('synthetic-josh','another-business'));
    await page.waitForFunction(()=>document.querySelector('input[type=email]')?.value==='synthetic-josh@example.invalid');
    assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'violet_sunset');
    await page.evaluate(()=>window.fixtureSwitch('synthetic-josh','synthetic-aea'));
    await page.waitForFunction(()=>document.querySelector('main').dataset.tradeTheme==='forest_jade');
    assert.equal(await page.locator('main').getAttribute('data-trade-colour-mode'),'night');
    await page.getByRole('button',{name:'Reset my dashboard',exact:true}).click();
    assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'violet_sunset');assert.equal(await page.locator('main').getAttribute('data-trade-colour-mode'),'day');
    await page.evaluate(()=>window.fixtureSwitch('synthetic-kris','synthetic-aea'));await page.waitForFunction(()=>document.querySelector('input[type=email]')?.value==='synthetic-kris@example.invalid');
    await page.evaluate(()=>window.fixtureSwitch('synthetic-josh','synthetic-aea'));await page.waitForFunction(()=>document.querySelector('input[type=email]')?.value==='synthetic-josh@example.invalid');
    assert.equal(await page.getByLabel('Dashboard colours',{exact:true}).inputValue(),'');
    assert.equal(await page.evaluate(()=>window.fixtureRequests.some(item=>item.url==='/api/trade-profile')),false);
  }finally{await page.close();await browser.close();}
});

test('profile load failures expose a working retry without empty contact details being saved', {skip:!browserPath,timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await openFixture(browser,390,false,true);
  try {
    await page.getByRole('alert').getByText('Profile temporarily unavailable.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save my profile',exact:true}).count(),0);
    await page.evaluate(()=>{window.fixtureLoadFailure=false});
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await page.getByLabel('Contact phone',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Contact phone',{exact:true}).inputValue(),'+61400111222');
    assert.equal(await page.evaluate(()=>window.fixtureRequests.filter(item=>item.method==='PATCH').length),0);
  }finally{await page.close();await browser.close();}
});

test('a stalled profile save times out visibly and ignores a late response after cancellation', {skip:!browserPath,timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await openFixture(browser,390);
  try {
    await page.evaluate(()=>{const original=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>original(callback,delay===15000?40:delay,...args);window.fixtureDelay=true});
    await page.getByLabel('My name',{exact:true}).fill('Pending Joshua');
    await page.getByRole('button',{name:'Save my profile',exact:true}).click();
    await page.getByRole('alert').getByText('Your profile took too long to respond. Check your connection and try again.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save my profile',exact:true}).isEnabled(),true);
    assert.equal(await page.getByLabel('My name',{exact:true}).inputValue(),'Pending Joshua');
    await page.evaluate(async()=>{window.fixtureRelease();await new Promise(resolve=>setTimeout(resolve,0))});
    assert.deepEqual(await page.evaluate(()=>window.fixtureSavedNames),[]);
    assert.equal(await page.getByText('Your profile is saved.',{exact:true}).count(),0);
  }finally{await page.close();await browser.close();}
});

test('blocked device storage keeps working choices and explains that they are not remembered', {skip:!browserPath,timeout:60000},async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await openFixture(browser,390,true);
  try {
    await page.getByText('Your choices apply in this tab. Your browser is not allowing them to be remembered.',{exact:true}).waitFor();
    await page.getByLabel('Dashboard colours',{exact:true}).selectOption('rose_plum');
    assert.equal(await page.locator('main').getAttribute('data-trade-theme'),'rose_plum');
    assert.equal(await page.getByText('Your choices are remembered on this device for your account in this business.',{exact:true}).count(),0);
  }finally{await page.close();await browser.close();}
});
