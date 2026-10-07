import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {CouncilConnect} from './src/components/council/CouncilConnect';
  window.fixtureRequests=[];window.fixtureMessages=[];window.fixtureSends=[];window.fixtureReceipts=[];window.fixtureHistory={};
  window.fixtureConfig={failOnce:false,deferConversation:false};
  const api=async(url,options={})=>{
    const parsed=new URL(url,location.origin),scope=parsed.searchParams.get('councilId'),peer=parsed.searchParams.get('peerId');
    const body=options.body?JSON.parse(options.body):null;
    window.fixtureRequests.push({url,body});
    if(body?.action==='read'){window.fixtureReceipts.push(body);return {ok:true};}
    if(body?.action==='send'){
      window.fixtureSends.push(body);
      if(!window.fixtureMessages.some(message=>message.id===body.id)) window.fixtureMessages.push({id:body.id,peerId:body.recipientId,body:body.body,senderId:'owner',senderName:'You',createdAt:new Date().toISOString()});
      if(window.fixtureConfig.failOnce){window.fixtureConfig.failOnce=false;throw new Error('Connection interrupted before confirmation.');}
      if(window.fixtureConfig.deferSend===body.recipientId) return new Promise(resolve=>window.fixtureResolveSend=()=>resolve({ok:true,id:body.id}));
      return {ok:true,id:body.id};
    }
    if(peer){
      const before=parsed.searchParams.get('before');
      const messages=(window.fixtureHistory[peer]??[{id:'00000000-0000-4000-8000-000000000001',body:'Ready to plan the council information session?',senderId:peer,senderName:scope==='one'?'Jordan Programs':'Other Council colleague',createdAt:'2026-10-07T00:00:00.000Z'},...window.fixtureMessages.filter(message=>message.peerId===peer)]).filter(message=>!before||(message.createdAt+'|'+message.id)<before).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
      const selected=messages.slice(-50),first=selected[0];
      const result={conversation:{memberId:'owner',peerId:peer,messages:selected,hasMore:messages.length>50,before:first?first.createdAt+'|'+first.id:''}};
      if(before&&window.fixtureConfig.deferOlder) return new Promise(resolve=>window.fixtureResolveOlder=()=>resolve(result));
      if(window.fixtureConfig.deferConversation) return new Promise(resolve=>window.fixtureResolveConversation=()=>resolve(result));
      return result;
    }
    return {directory:{memberId:'owner',unread:window.fixtureReceipts.length?0:1,hasMore:false,people:[{id:'editor',name:scope==='one'?'Jordan Programs':'Other Council colleague',role:'editor',unread:window.fixtureReceipts.length?0:1,lastMessage:'Ready to plan the council information session?',lastMessageAt:'2026-10-07T00:00:00.000Z'},...(window.fixtureConfig.secondPeer?[{id:'viewer',name:'Alex Community',role:'viewer',unread:0,lastMessage:'',lastMessageAt:''}]:[])]}};
  };
  function Fixture(){
    const [scope,setScope]=useState('one'),[visible,setVisible]=useState(true);
    window.fixtureSwitchCouncil=setScope;
    return <><button id="toggle-panel" onClick={()=>{setVisible(value=>!value);setTimeout(()=>window.dispatchEvent(new PopStateEvent('popstate')),0);}}>Toggle Connect</button><div hidden={!visible}><CouncilConnect key={scope} councilId={scope} api={api}/></div></>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, write: false, outfile: "council-connect.js", format: "iife", jsx: "automatic",
  plugins: [{ name: "council-connect-alias", setup(builder) { builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, "src/lib", `${args.path.slice("@/lib/".length)}.ts`) })); } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const colours = "--c-ink:#16332d;--c-muted:#526c65;--c-line:#cbded7;--c-surface:#ffffff;--c-field:#ffffff;--c-soft:#f4f8f6;--c-accent:#087461;--c-accent-soft:#e3f5ec;--c-button:#075d4a;--c-button-ink:#fff;";
async function fixture(browser, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fixture.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }));
  await page.goto("https://fixture.invalid/");
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px;${colours}}${css}</style><div id="root"></div>`);
  await page.addScriptTag({ content: script });
  await page.getByRole("button", { name: /Jordan Programs/ }).waitFor();
  return { page, errors };
}

test("Council Connect works in a real browser with synthetic API boundaries", { skip: !browserPath, timeout: 60000 }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const width of [1280, 390]) await t.test(`desktop/mobile conversation, compose and draft preservation at ${width}px`, async () => {
      const { page, errors } = await fixture(browser, width);
      try {
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log", { name: "Conversation" }).getByText("Ready to plan the council information session?", { exact: true }).waitFor();
        await page.waitForFunction(() => window.fixtureReceipts.length === 1);
        const compose = page.getByRole("textbox", { name: "Message Jordan Programs" });
        await compose.fill("Let's review the postcode report tomorrow.");
        await page.locator("#toggle-panel").click();
        assert.equal(await page.getByRole("region", { name: "Council team messages" }).isVisible(), false);
        await page.locator("#toggle-panel").click();
        await compose.waitFor(); assert.equal(await compose.inputValue(), "Let's review the postcode report tomorrow.");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("log").getByText("Let's review the postcode report tomorrow.", { exact: true }).waitFor();
        assert.equal(await compose.inputValue(), "");
        assert.equal(await page.evaluate(() => window.fixtureMessages.length), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal page overflow");
        if (width < 500) {
          await page.getByRole("button", { name: "Back to team", exact: true }).click();
          await page.getByRole("button", { name: /Jordan Programs/ }).waitFor();
          await page.getByRole("button", { name: /Jordan Programs/ }).click();
          await page.getByRole("log").getByText("Let's review the postcode report tomorrow.", { exact: true }).waitFor();
        }
        if (process.env.COUNCIL_CONNECT_QA_OUTPUT) {
          fs.mkdirSync(process.env.COUNCIL_CONNECT_QA_OUTPUT, { recursive: true });
          await page.screenshot({ path: path.join(process.env.COUNCIL_CONNECT_QA_OUTPUT, `council-connect-${width}.png`), fullPage: true });
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("uncertain send retains draft and retries the same id without duplicating delivery", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("Ready to plan the council information session?", { exact: true }).waitFor();
        const compose = page.getByRole("textbox", { name: "Message Jordan Programs" });
        await compose.fill("Please review the campaign draft.");
        await page.evaluate(() => { window.fixtureConfig.failOnce = true; });
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("alert").getByText(/Your draft is kept/).waitFor();
        assert.equal(await compose.inputValue(), "Please review the campaign draft.");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("log").getByText("Please review the campaign draft.", { exact: true }).waitFor();
        const sends = await page.evaluate(() => window.fixtureSends);
        assert.equal(sends.length, 2); assert.equal(sends[0].id, sends[1].id);
        assert.equal(await page.evaluate(() => window.fixtureMessages.length), 1); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("late history from a previous council cannot render or acknowledge messages after a scope switch", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => { window.fixtureConfig.deferConversation = true; });
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.waitForFunction(() => typeof window.fixtureResolveConversation === "function");
        await page.evaluate(() => { window.fixtureConfig.deferConversation = false; window.fixtureSwitchCouncil("two"); });
        await page.getByRole("button", { name: /Other Council colleague/ }).waitFor();
        await page.evaluate(() => window.fixtureResolveConversation());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.getByRole("log").count(), 0);
        assert.equal(await page.getByRole("button", { name: /Jordan Programs/ }).count(), 0);
        assert.equal(await page.evaluate(() => window.fixtureReceipts.length), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("a non-overlapping refreshed window keeps every missed message reachable", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => {
          window.fixtureMakeHistory=(peer,count)=>Array.from({length:count},(_,index)=>({id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),body:'History '+(index+1),senderId:peer,senderName:'Jordan Programs',createdAt:new Date(Date.UTC(2026,9,7,0,0,index)).toISOString()}));
          window.fixtureHistory.editor=window.fixtureMakeHistory('editor',3);
        });
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("History 3",{exact:true}).waitFor();
        assert.equal(await page.getByRole("button",{name:"Load earlier messages",exact:true}).count(),0);
        await page.evaluate(()=>{window.fixtureHistory.editor=window.fixtureMakeHistory('editor',63);});
        await page.getByRole("button",{name:"Refresh messages",exact:true}).click();
        await page.getByRole("log").getByText("History 63",{exact:true}).waitFor();
        await page.getByRole("button",{name:"Load earlier messages",exact:true}).click();
        await page.getByRole("log").getByText("History 1",{exact:true}).waitFor();
        assert.equal(await page.getByRole("log").locator("article").count(),63);
        assert.equal(await page.getByRole("button",{name:"Load earlier messages",exact:true}).count(),0);
        await page.evaluate(()=>{window.fixtureHistory.editor=window.fixtureMakeHistory('editor',64);});
        await page.getByRole("button",{name:"Refresh messages",exact:true}).click();
        await page.getByRole("log").getByText("History 64",{exact:true}).waitFor();
        assert.equal(await page.getByRole("log").locator("article").count(),64,"An overlapping refresh preserves already loaded history");
        assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
    await t.test("switching peers during an older-page request does not leave pagination busy", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(()=>{
          window.fixtureConfig.secondPeer=true;
          for(const peer of ['editor','viewer'])window.fixtureHistory[peer]=Array.from({length:60},(_,index)=>({id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),body:peer+' history '+(index+1),senderId:peer,senderName:peer,createdAt:new Date(Date.UTC(2026,9,7,0,0,index)).toISOString()}));
        });
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("editor history 60",{exact:true}).waitFor();
        await page.evaluate(()=>{window.fixtureConfig.deferOlder=true;});
        await page.getByRole("button",{name:"Load earlier messages",exact:true}).click();
        await page.waitForFunction(()=>typeof window.fixtureResolveOlder==='function');
        await page.getByRole("button",{name:/Alex Community/}).click();
        await page.getByRole("log").getByText("viewer history 60",{exact:true}).waitFor();
        await page.evaluate(()=>{window.fixtureConfig.deferOlder=false;window.fixtureResolveOlder();});
        const older=page.getByRole("button",{name:"Load earlier messages",exact:true});
        assert.equal(await older.isEnabled(),true);
        await older.click();await page.getByRole("log").getByText("viewer history 1",{exact:true}).waitFor();
        assert.equal(await page.getByRole("log").getByText("editor history 1",{exact:true}).count(),0);
        assert.equal(await page.getByRole("log").locator("article").count(),60);assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
    await t.test("uncertain send identity survives a successful send in another conversation", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(()=>{window.fixtureConfig.secondPeer=true;});
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("Ready to plan the council information session?",{exact:true}).waitFor();
        await page.getByRole("textbox",{name:"Message Jordan Programs"}).fill("First colleague reminder");
        await page.evaluate(()=>{window.fixtureConfig.failOnce=true;});
        await page.getByRole("button",{name:"Send message",exact:true}).click();
        await page.getByRole("alert").getByText(/Your draft is kept/).waitFor();
        await page.getByRole("button",{name:/Alex Community/}).click();
        await page.getByRole("textbox",{name:"Message Alex Community"}).fill("Second colleague update");
        await page.getByRole("button",{name:"Send message",exact:true}).click();
        await page.getByRole("log").getByText("Second colleague update",{exact:true}).waitFor();
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        const compose=page.getByRole("textbox",{name:"Message Jordan Programs"});
        assert.equal(await compose.inputValue(),"First colleague reminder");
        await page.getByRole("button",{name:"Send message",exact:true}).click();
        await page.waitForFunction(()=>window.fixtureSends.length===3);
        const sends=await page.evaluate(()=>window.fixtureSends);
        assert.equal(sends[0].id,sends[2].id);assert.notEqual(sends[0].id,sends[1].id);
        await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
        assert.equal(await page.evaluate(()=>window.fixtureMessages.length),2);assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
    await t.test("a pending send does not block another peer and its late confirmation clears only its own draft", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(()=>{window.fixtureConfig.secondPeer=true;window.fixtureConfig.deferSend='editor';});
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("Ready to plan the council information session?",{exact:true}).waitFor();
        await page.getByRole("textbox",{name:"Message Jordan Programs"}).fill("Waiting for first confirmation");
        await page.getByRole("button",{name:"Send message",exact:true}).click();
        await page.waitForFunction(()=>typeof window.fixtureResolveSend==='function');
        await page.getByRole("button",{name:/Alex Community/}).click();
        await page.getByRole("textbox",{name:"Message Alex Community"}).fill("Draft for second colleague");
        assert.equal(await page.getByRole("button",{name:"Send message",exact:true}).isEnabled(),true);
        await page.evaluate(()=>window.fixtureResolveSend());
        assert.equal(await page.getByRole("textbox",{name:"Message Alex Community"}).inputValue(),"Draft for second colleague");
        await page.getByRole("button", { name: /Jordan Programs/ }).click();
        await page.getByRole("log").getByText("Waiting for first confirmation",{exact:true}).waitFor();
        assert.equal(await page.getByRole("textbox",{name:"Message Jordan Programs"}).inputValue(),"");
        assert.equal(await page.evaluate(()=>window.fixtureMessages.length),1);assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
