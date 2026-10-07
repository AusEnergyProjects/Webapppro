import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const boundaries = {
  business: `export const useTradeBusiness=()=>({ownerUid:'business-one'});export const useTradeBusinessFetch=()=>window.fixtureFetch;`,
  timing: `export const WorkTimeStatus=()=>null;export const useFormTimeTracking=()=>({bind:{},markCompleted(){throw Error('Unexpected completion');}});`,
  appearance: `export async function requestWattzunAssistant(){return true;}`,
  core: `export * from './src/lib/creditex-activity-work-pack.ts';export const creditexActivityWorkPackCompletion=()=>({ready:false,blockers:[{key:'model',code:'required',message:'Model is required'}],completedPromptKeys:[],requiredPromptKeys:['model'],visiblePromptKeys:['model']});`,
  crypto: `export function createHash(){throw Error('Server schema hashing is outside this browser fixture');}`,
};
const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {TradeActivityWorkPackPanel} from './src/components/TradeActivityWorkPackPanel';
  import {prepareWattzunFormCapture,captureWattzunFormPhoto,focusWattzunFormQuestion,WATTZUN_FORM_CAPTURE_SAVED_EVENT,WATTZUN_FORM_SAVED_EVENT,WATTZUN_FORM_REFRESHED_EVENT,WATTZUN_FORM_NATIVE_SAVED_EVENT} from './src/lib/wattzun-form-client';
  const prompt=(key,type='text',extra={})=>({promptKey:key,type,label:type==='photo'?'Equipment photo':'Installed model',instructions:'Use the exact item shown.',required:true,order:1,visibility:null,dependencyKeys:[],stageKey:'',options:[],signerRoleKey:'',...extra});
  const photo=prompt('photo','photo',{fileRequirement:{minimumCount:1,maximumCount:2,allowedContentTypes:['image/jpeg'],metadataRequired:false,gpsRequired:false,captureTimeRequired:false}});
  const schema={stages:[],signerRoles:[],dependencies:[],documentOutputs:[],sections:[
    {sectionKey:'work',title:'Site checks',order:1,visibility:null,prompts:[prompt('model')]},
    {sectionKey:'units',title:'Equipment evidence',order:2,visibility:null,repeatability:{itemLabel:'Unit',minimumInstances:1,maximumInstances:5},prompts:[photo,
      prompt('hidden_photo','photo',{...photo,promptKey:'hidden_photo',visibility:{match:'all',conditions:[{scope:'response',promptKey:'show_hidden',operator:'equals',value:true}]}})]}
  ]};
  if(window.fixtureOptions.blocked){schema.dependencies=[{dependencyKey:'product-check',required:true,label:'Verify product',kind:'scenario',scenarioCodes:[]}];photo.dependencyKeys=['product-check'];}
  if(window.fixtureOptions.declaration) schema.sections.push({sectionKey:'signoff',title:'Declaration',order:3,visibility:null,prompts:[prompt('declaration','checkbox',{label:'Confirm declaration'})]});
  window.fixturePack={instance:{id:'revision-one',instanceKey:'stable-pack',workOrderId:'job-one',responseSha256:'sha256:'+'1'.repeat(64),status:window.fixtureOptions.completed?'completed':'in_progress',activityDate:'2026-10-07'},
    definition:{title:'Synthetic installation',version:1,schema},executionContext:{provider:{legalName:'Synthetic provider'},installerBusiness:{businessName:'Synthetic installer'},assignment:{displayName:'Test technician'}},customerContext:{firstName:'Synthetic',lastName:'Customer'},
    response:{answers:{},repeatableSections:{units:[{instanceKey:'unit-one',answers:{}},{instanceKey:'unit-two',answers:{}}]},dependencyResolutions:{}},
    completion:{blockers:[{key:'model'}]},referenceDocuments:[],signatures:[],signerBindings:[],artifacts:[],calculatorOutputs:[],calculatorPendingReviews:[]};
  window.fixtureUploads=[];window.fixtureCommits=[];window.fixtureSaved=[];window.fixtureChooserClicks=[];
  window.fixtureRefreshed=[];
  window.fixtureNativeSaved=[];
  window.addEventListener(WATTZUN_FORM_NATIVE_SAVED_EVENT,event=>window.fixtureNativeSaved.push(event.detail));
  window.addEventListener(WATTZUN_FORM_REFRESHED_EVENT,event=>window.fixtureRefreshed.push(event.detail));
  window.fixtureVoiceSave=(suffix='voice')=>{const pack=structuredClone(window.fixturePack);pack.instance.id='revision-'+suffix;pack.response.answers.model='Voice-saved model '+suffix;window.fixturePack=pack;window.dispatchEvent(new CustomEvent(WATTZUN_FORM_SAVED_EVENT,{detail:{portal:'trade',scopeId:'business-one',formKind:'work_pack',formId:'revision-one',jobId:'job-one'}}));};
  window.addEventListener(WATTZUN_FORM_CAPTURE_SAVED_EVENT,event=>window.fixtureSaved.push(event.detail));
  const nativeClick=HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click=function(){if(this.type==='file')window.fixtureChooserClicks.push({capture:this.getAttribute('capture'),accept:this.accept,active:navigator.userActivation.isActive});return nativeClick.call(this);};
  let retained;
  window.fixtureFetch=async(url,options={})=>{
    if(url.endsWith('/upload')){
      const data=options.body,file=data.get('file');
      window.fixtureUploads.push(Object.fromEntries([...data.entries()].filter(([key])=>key!=='file')));
      if(window.fixtureOptions.rejectUpload)return Response.json({error:'Original photo GPS metadata is required.'},{status:409});
      const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
      retained={clientUploadId:data.get('clientUploadId'),sha256,sizeBytes:file.size,contentType:file.type,fileName:file.name,purpose:'artifact',promptKey:data.get('repeatInstanceKey')?data.get('sectionKey')+'['+data.get('repeatInstanceKey')+'].'+data.get('promptKey'):data.get('promptKey'),deviceId:'fixture-device',sessionId:'fixture-session',capturedAt:'2026-10-07T00:00:00.000Z'};
      return Response.json({ok:true,status:'applied',upload:retained},{status:201});
    }
    if(options.method==='POST'){
      const body=JSON.parse(options.body);window.fixtureCommits.push(body);
      if(window.fixtureOptions.rejectCommit)return Response.json({error:'Fixture commit unavailable.'},{status:503});
      if(window.fixtureOptions.deferCommit)await new Promise(resolve=>window.fixtureReleaseCommit=resolve);
      const pack=structuredClone(window.fixturePack);pack.instance.id='revision-two';pack.instance.responseSha256='sha256:'+'2'.repeat(64);
      if(body.artifactLinks?.length&&!window.fixtureOptions.omitArtifact){const link=body.artifactLinks[0];
        const artifact={id:'artifact-one',promptKey:retained.promptKey,artifactKind:'photo',originalSha256:retained.sha256,capturedDeviceId:retained.deviceId};pack.artifacts=[artifact];
        const answers=link.repeatInstanceKey?pack.response.repeatableSections[link.sectionKey].find(item=>item.instanceKey===link.repeatInstanceKey).answers:pack.response.answers;answers[link.promptKey]=[artifact.id];
      }
      for(const patch of body.sectionPatches||[])Object.assign(pack.response.answers,patch.answers);
      window.fixturePack=pack;return Response.json({result:{projection:pack}});
    }
    const readPack=structuredClone(window.fixturePack);
    if(window.fixtureDeferRead){window.fixtureDeferRead=false;await new Promise(resolve=>window.fixtureReleaseRead=resolve);}
    return Response.json({ok:true,instances:[readPack]});
  };
  window.fixtureTarget={portal:'trade',scopeId:'business-one',formKind:'work_pack',formId:'revision-one',jobId:'job-one',fieldKey:'units[unit-two].photo'};
  window.fixtureFocus=changes=>focusWattzunFormQuestion({...window.fixtureTarget,...changes});
  window.fixturePrepare=async changes=>{const result=await prepareWattzunFormCapture({...window.fixtureTarget,...changes});window.fixtureReady=result;return result;};
  document.getElementById('camera').onclick=()=>{window.fixtureCaptureAccepted=window.fixtureReady?.status==='ready'&&captureWattzunFormPhoto(window.fixtureReady.target);};
  createRoot(document.getElementById('root')).render(<TradeActivityWorkPackPanel user={{uid:'user-one',getIdToken:async()=>'fixture-token'}} workOrderId='job-one' readOnly={Boolean(window.fixtureOptions.readOnly)}/>);
` }, bundle: true, write: false, outfile: "capture.js", format: "iife", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "capture-boundaries", setup(builder) {
    for (const [filter, fixture] of [[/TradeBusinessProvider$/, "business"], [/TradeWorkTimeTracking$/, "timing"], [/wattzun-appearance$/, "appearance"], [/^@\/lib\/creditex-activity-work-pack$/, "core"], [/^node:crypto$/, "crypto"]]) builder.onResolve({ filter }, () => ({ path: fixture, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: boundaries[args.path], loader: "tsx", resolveDir: root }));
    builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: path.join(root, "src/lib", `${args.path.slice(6)}${path.extname(args.path) ? "" : ".ts"}`) }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
async function fixture(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fixture.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><button id='camera'>Take requested photo</button><div id='root'></div>" }));
  await page.goto("https://fixture.invalid/"); await page.evaluate(value => { window.fixtureOptions = value; }, options);
  await page.addScriptTag({ content: script }); await page.getByRole("heading", { name: "Complete the assigned activity forms" }).waitFor();
  return { page, errors };
}
const photo = { name: "synthetic-photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from([255,216,255,224,0,4,0,0,255,217]) };
async function pick(page, file = photo) {
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Take requested photo" }).click();
  await (await chooser).setFiles(file ? file : []);
}

test("guided camera uses the actual question-bound browser control and canonical evidence commit", { skip: !browserPath, timeout: 45000 }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const rejectCommit of [false, true]) await t.test(`native declaration opens without filling it and only confirmed save resumes: rejected=${rejectCommit}`, async () => {
      const { page, errors } = await fixture(browser, { declaration: true, rejectCommit });
      try {
        assert.equal(await page.evaluate(() => window.fixtureFocus({ fieldKey: 'declaration', scopeId: 'other' })), false);
        assert.equal(await page.evaluate(() => window.fixtureFocus({ fieldKey: 'declaration' })), true);
        const checkbox = page.getByRole('checkbox', { name: 'Confirm declaration', exact: true });
        await checkbox.waitFor(); assert.equal(await checkbox.isChecked(), false);
        assert.equal(await page.evaluate(() => window.fixtureNativeSaved.length), 0);
        await checkbox.check();
        if (rejectCommit) {
          await page.getByText('Fixture commit unavailable.', { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.fixtureNativeSaved.length), 0);
        } else {
          await page.waitForFunction(() => window.fixtureNativeSaved.length === 1);
          assert.deepEqual(await page.evaluate(() => window.fixtureNativeSaved[0]), { portal: 'trade', scopeId: 'business-one', formKind: 'work_pack', oldFormId: 'revision-one', formId: 'revision-two', jobId: 'job-one' });
          assert.equal(await page.evaluate(() => window.fixturePack.response.answers.declaration), true);
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("a canonical voice answer refreshes the real editor before the next photo is prepared", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => window.fixtureVoiceSave());
        await page.waitForFunction(() => window.fixtureRefreshed.length === 1);
        assert.deepEqual(await page.evaluate(() => window.fixtureRefreshed[0]), { portal: "trade", scopeId: "business-one", formKind: "work_pack", oldFormId: "revision-one", formId: "revision-voice", jobId: "job-one" });
        assert.equal(await page.getByRole("group", { name: "Installed model" }).getByRole("textbox").inputValue(), "Voice-saved model voice");
        const ready = await page.evaluate(() => window.fixturePrepare({ formId: "revision-voice" }));
        assert.equal(ready.status, "ready"); assert.equal(ready.target.formId, "revision-voice");
        await pick(page); await page.waitForFunction(() => window.fixtureSaved.length === 1);
        assert.equal(await page.evaluate(() => window.fixtureUploads[0].caseInstanceId), "revision-voice");
        assert.equal(await page.evaluate(() => window.fixtureSaved[0].oldFormId), "revision-voice");
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("a second saved answer during an editor refresh is retained and loaded", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => { window.fixtureDeferRead=true; window.fixtureVoiceSave('first'); });
        await page.waitForFunction(() => typeof window.fixtureReleaseRead === 'function');
        await page.evaluate(() => { window.fixtureVoiceSave('second'); window.fixtureReleaseRead(); });
        await page.waitForFunction(() => window.fixtureRefreshed.some(item => item.formId === 'revision-second'));
        assert.equal(await page.getByRole("group", { name: "Installed model" }).getByRole("textbox").inputValue(), "Voice-saved model second");
        assert.equal((await page.evaluate(() => window.fixturePrepare({ formId: "revision-second" }))).status, "ready");
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("exact repeated item is selected and real user tap opens native photo chooser", async () => {
      const { page, errors } = await fixture(browser, { deferCommit: true });
      try {
        assert.equal((await page.evaluate(() => window.fixturePrepare())).status, "ready");
        assert.equal(await page.getByRole("button", { name: "Unit 2", exact: true }).getAttribute("data-selected"), "true");
        await pick(page); await page.waitForFunction(() => typeof window.fixtureReleaseCommit === 'function');
        assert.equal(await page.evaluate(() => window.fixtureSaved.length), 0, "Custody alone must not advance the guided form");
        const upload = await page.evaluate(() => window.fixtureUploads[0]);
        assert.equal(upload.caseInstanceId, "revision-one"); assert.equal(upload.sectionKey, "units"); assert.equal(upload.repeatInstanceKey, "unit-two"); assert.equal(upload.promptKey, "photo");
        assert.deepEqual(await page.evaluate(() => window.fixtureChooserClicks[0]), { capture: "environment", accept: "image/jpeg", active: true });
        await page.evaluate(() => window.fixtureReleaseCommit()); await page.waitForFunction(() => window.fixtureSaved.length === 1);
        assert.deepEqual(await page.evaluate(() => window.fixtureSaved[0]), { portal: "trade", scopeId: "business-one", formKind: "work_pack", oldFormId: "revision-one", formId: "revision-two", jobId: "job-one", fieldKey: "units[unit-two].photo" });
        const ready = await page.evaluate(() => window.fixturePrepare()); assert.equal(ready.target.formId, "revision-two");
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("camera cancellation performs no upload and remains ready at the same question", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => window.fixturePrepare()); await pick(page, null);
        assert.deepEqual(await page.evaluate(() => ({ uploads: window.fixtureUploads.length, commits: window.fixtureCommits.length, saved: window.fixtureSaved.length })), { uploads: 0, commits: 0, saved: 0 });
        await pick(page); await page.waitForFunction(() => window.fixtureSaved.length === 1); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    for (const [name, options, message] of [["rejected metadata", { rejectUpload: true }, "Original photo GPS metadata is required."], ["failed artifact commit", { rejectCommit: true }, "Fixture commit unavailable."]]) {
      await t.test(`${name} never advances and retains the same photo question`, async () => {
        const { page, errors } = await fixture(browser, options);
        try {
          await page.evaluate(() => window.fixturePrepare()); await pick(page); await page.getByText(message, { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.fixtureSaved.length), 0);
          assert.equal((await page.evaluate(() => window.fixturePrepare())).target.fieldKey, "units[unit-two].photo"); assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
    await t.test("a success-shaped response without a linked artifact cannot advance", async () => {
      const { page, errors } = await fixture(browser, { omitArtifact: true });
      try {
        await page.evaluate(() => window.fixturePrepare()); await pick(page); await page.getByText("The uploaded photo could not be confirmed against this question. Refresh the form before continuing.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.fixtureSaved.length), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("foreign scope, job and form cannot prepare or select any camera", async () => {
      const { page, errors } = await fixture(browser);
      try {
        const results = await page.evaluate(() => Promise.all([{ scopeId: "other" }, { jobId: "other" }, { formId: "other" }].map(change => window.fixturePrepare(change))));
        assert.ok(results.every(result => result.status === "unavailable")); assert.equal(await page.locator('input[type="file"]').count(), 0);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    for (const options of [{ readOnly: true }, { completed: true }, { blocked: true }]) {
      await t.test(`locked capture is unavailable: ${Object.keys(options)[0]}`, async () => {
        const { page, errors } = await fixture(browser, options);
        try { assert.equal((await page.evaluate(() => window.fixturePrepare())).status, "unavailable"); assert.equal(await page.evaluate(() => window.fixtureUploads.length), 0); assert.deepEqual(errors, []); }
        finally { await page.close(); }
      });
    }
    await t.test("hidden and non-photo questions cannot be requested as photos", async () => {
      const { page, errors } = await fixture(browser);
      try {
        for (const fieldKey of ["units[unit-two].hidden_photo", "model", "units[missing].photo"]) {
          assert.equal((await page.evaluate(key => window.fixturePrepare({ fieldKey: key }), fieldKey)).status, "unavailable");
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("changing section after readiness invalidates the old camera action", async () => {
      const { page, errors } = await fixture(browser);
      try {
        await page.evaluate(() => window.fixturePrepare()); await page.getByRole("navigation", { name: "Activity form sections" }).getByRole("button", { name: /Site checks/ }).click();
        await page.getByRole("button", { name: "Take requested photo" }).click();
        assert.equal(await page.evaluate(() => window.fixtureCaptureAccepted), false); assert.equal(await page.evaluate(() => window.fixtureChooserClicks.length), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("unsaved manual answers prevent capture preparation and remain intact", async () => {
      const { page, errors } = await fixture(browser, { deferCommit: true });
      try {
        const input = page.getByRole("group", { name: "Installed model" }).getByRole("textbox");
        await input.fill("Keep my manual answer");
        assert.equal((await page.evaluate(() => window.fixturePrepare())).status, "unavailable");
        assert.equal(await input.inputValue(), "Keep my manual answer"); assert.equal(await page.evaluate(() => window.fixtureUploads.length), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
