import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const fixtures = {
  business: `export const useTradeBusiness=()=>({ownerUid:'business-one'});export const useTradeBusinessFetch=()=>window.fixtureFetch;`,
  timing: `export const WorkTimeStatus=()=>null;export const useFormTimeTracking=()=>({bind:{},markCompleted(){window.fixtureCompleted++;}});`,
  assistant: `export async function requestWattzunAssistant(request){window.fixtureOpens.push(request);return true;}`,
};
const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {TradeJobFormsPanel} from './src/components/TradeJobFormsPanel';
  import {dispatchWattzunFormSaved} from './src/lib/wattzun-form-client';
  window.fixtureOpens=[];window.fixtureWrites=[];window.fixtureReads=0;window.fixtureCompleted=0;window.fixtureNativeSaves=[];
  window.addEventListener('wattzun:form-native-saved',event=>window.fixtureNativeSaves.push(event.detail));
  window.fixtureForm={id:'form-one',templateKey:'inspection',templateVersion:1,templateName:'Site inspection',jurisdiction:'VIC',template:{guidance:'Record what you observed.',fields:[{key:'model',label:'Installed model',type:'text',required:true}]},answers:{},status:'draft',revision:1,ready:false,missing:['model'],completedAt:''};
  window.fixtureFetch=async(url,options={})=>{
    if(options.method==='PATCH'){
      const body=JSON.parse(options.body);window.fixtureWrites.push(body);
      if(window.fixtureFailSave) return Response.json({error:'Fixture save failed.'},{status:503});
      if(window.fixtureDeferSave) await new Promise(resolve=>window.fixtureReleaseSave=resolve);
      window.fixtureForm={...window.fixtureForm,revision:window.fixtureForm.revision+1,answers:body.answers,status:body.complete?'complete':'draft'};
    }else window.fixtureReads++;
    return Response.json({ok:true,templates:[],forms:[window.fixtureForm]});
  };
  window.fixtureSaved=(answers,detail={})=>{
    window.fixtureForm={...window.fixtureForm,answers,revision:window.fixtureForm.revision+1};
    dispatchWattzunFormSaved({portal:'trade',scopeId:'business-one',formKind:'job_form',formId:'form-one',jobId:'job-one',...detail});
  };
  createRoot(document.getElementById('root')).render(<TradeJobFormsPanel user={{uid:'user-one',getIdToken:async()=>'fixture-token'}} workOrderId="job-one" readOnly={window.fixtureReadOnly||false}/>);
` }, bundle: true, write: false, outfile: "wattzun-form-editor.js", format: "iife", jsx: "automatic",
  plugins: [{ name: "wattzun-form-editor-boundaries", setup(builder) {
    for (const [filter, fixture] of [[/TradeBusinessProvider$/, "business"], [/TradeWorkTimeTracking$/, "timing"], [/wattzun-appearance$/, "assistant"]]) builder.onResolve({ filter }, () => ({ path: fixture, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: fixtures[args.path], loader: "tsx", resolveDir: root }));
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, "src/lib", `${args.path.slice("@/lib/".length)}${path.extname(args.path) ? "" : ".ts"}`) }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
async function fixture(browser, readOnly = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fixture.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><div id='root'></div>" }));
  await page.goto("https://fixture.invalid/"); await page.evaluate(value => { window.fixtureReadOnly = value; }, readOnly);
  await page.addScriptTag({ content: script }); await page.getByText("Site inspection", { exact: true }).waitFor();
  return { page, errors };
}
async function rendered(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test("actual trade form editor safely hands saved context to Wattzun and refreshes confirmed answers", { skip: !browserPath, timeout: 30000 }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    await t.test("unsaved manual answers are committed before opening the exact selected form", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.getByRole("textbox", { name: "Installed model" }).fill("Known model 123");
        await page.evaluate(() => { window.fixtureDeferSave = true; });
        await page.getByRole("button", { name: "Fill with Wattzun", exact: true }).click();
        await page.waitForFunction(() => typeof window.fixtureReleaseSave === "function");
        assert.equal(await page.evaluate(() => window.fixtureOpens.length), 0, "No assistant request before the save succeeds");
        assert.equal(await page.evaluate(() => window.fixtureNativeSaves.length), 0);
        await page.evaluate(() => window.fixtureReleaseSave());
        await page.waitForFunction(() => window.fixtureOpens.length === 1);
        const result = await page.evaluate(() => ({ writes: window.fixtureWrites, opens: window.fixtureOpens }));
        assert.deepEqual(result.writes[0], { formId: "form-one", baseRevision: 1, answers: { model: "Known model 123" }, complete: false, workOrderId: "job-one" });
        assert.deepEqual(result.opens[0], { userUid: "user-one", portal: "trade", scopeId: "business-one", mode: "message", workReference: { kind: "trade_form", formKind: "job_form", recordId: "form-one", jobId: "job-one" }, initialMessage: "Help me fill this form. Ask me the next unanswered question, one at a time." });
        assert.equal(await page.evaluate(() => window.fixtureCompleted), 0); assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.fixtureNativeSaves), [{ portal: "trade", scopeId: "business-one", formKind: "job_form", formId: "form-one", oldFormId: "form-one", jobId: "job-one" }]);
      } finally { await page.close(); }
    });
    await t.test("failed save keeps the manual draft and does not open Wattzun", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.getByRole("textbox", { name: "Installed model" }).fill("Unsaved model");
        await page.evaluate(() => { window.fixtureFailSave = true; });
        await page.getByRole("button", { name: "Fill with Wattzun", exact: true }).click();
        await page.getByRole("alert").waitFor(); assert.equal(await page.evaluate(() => window.fixtureOpens.length), 0);
        assert.equal(await page.evaluate(() => window.fixtureNativeSaves.length), 0);
        assert.equal(await page.getByRole("textbox", { name: "Installed model" }).inputValue(), "Unsaved model"); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("Fill by voice saves first and explicitly starts the selected guided call", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.getByRole("textbox", { name: "Installed model" }).fill("Voice-ready model");
        await page.evaluate(() => { window.fixtureDeferSave = true; });
        await page.getByRole("button", { name: "Fill by voice", exact: true }).click();
        await page.waitForFunction(() => typeof window.fixtureReleaseSave === "function");
        assert.equal(await page.evaluate(() => window.fixtureOpens.length), 0);
        await page.evaluate(() => window.fixtureReleaseSave());
        await page.waitForFunction(() => window.fixtureOpens.length === 1);
        const request = await page.evaluate(() => window.fixtureOpens[0]);
        assert.equal(request.mode, "call"); assert.equal(request.guidedForm, true);
        assert.deepEqual(request.workReference, { kind: "trade_form", formKind: "job_form", recordId: "form-one", jobId: "job-one" });
        assert.equal(await page.evaluate(() => window.fixtureCompleted), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("Fill by voice cannot bypass a failed manual draft save", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.getByRole("textbox", { name: "Installed model" }).fill("Keep this model");
        await page.evaluate(() => { window.fixtureFailSave = true; });
        await page.getByRole("button", { name: "Fill by voice", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.evaluate(() => window.fixtureOpens.length), 0);
        assert.equal(await page.getByRole("textbox", { name: "Installed model" }).inputValue(), "Keep this model");
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("saved assistant answers refresh the actual field while foreign events and concurrent manual drafts are preserved", async () => {
      const { page, errors } = await fixture(browser);
      try {
        const input = page.getByRole("textbox", { name: "Installed model" });
        const reads = await page.evaluate(() => window.fixtureReads);
        await page.evaluate(() => window.fixtureSaved({ model: "Wrong business" }, { scopeId: "other-business" })); await rendered(page);
        assert.equal(await input.inputValue(), ""); assert.equal(await page.evaluate(() => window.fixtureReads), reads);
        await page.evaluate(() => window.fixtureSaved({ model: "Wattzun saved model" }));
        await page.waitForFunction(() => document.querySelector('input[type="text"]').value === "Wattzun saved model");
        await input.fill("My newer manual edit");
        await page.evaluate(() => window.fixtureSaved({ model: "Another saved answer" })); await rendered(page);
        assert.equal(await input.inputValue(), "My newer manual edit");
        await page.getByRole("button", { name: "Load saved answers", exact: true }).waitFor();
        page.once("dialog", dialog => dialog.dismiss());
        await page.getByRole("button", { name: "Load saved answers", exact: true }).click();
        assert.equal(await input.inputValue(), "My newer manual edit"); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("view-only forms never offer assistant editing", async () => {
      const { page, errors } = await fixture(browser, true);
      try { assert.equal(await page.getByRole("button", { name: "Fill with Wattzun", exact: true }).count(), 0); assert.equal(await page.getByRole("textbox", { name: "Installed model" }).isDisabled(), true); assert.deepEqual(errors, []); }
      finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
