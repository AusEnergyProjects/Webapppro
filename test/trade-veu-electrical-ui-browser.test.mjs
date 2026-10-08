import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { electricalAnswers, electricalRecord } from "./helpers/wattzun-veu-electrical-fixture.mjs";
import { veuElectricalCompletion, VEU_ELECTRICAL_SOURCE_PATH, VEU_ELECTRICAL_SOURCE_SHA256, VEU_ELECTRICAL_SOURCE_URL } from "../src/lib/veu-electrical-safety-form.ts";
import { activityHash, activitySigningScope, activityDeclarationText, normaliseActivityAnswers, validateActivityStrokes, activityMissing } from "../src/lib/trade-activity-forms.ts";
import { expandedActivityFields } from "../src/lib/trade-activity-form-flow.ts";

const root=process.cwd();
const executablePath=[process.env.FORM_QA_BROWSER,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium"].find(value=>value&&fs.existsSync(value));
const bundle=await build({stdin:{resolveDir:root,loader:"tsx",contents:`
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import {TradeVeuElectricalAssessmentPanel,VeuElectricalFormLibrary} from './src/components/TradeVeuElectricalAssessmentPanel';
 window.formOpenRequests=[];window.piesaEvents=[];window.addEventListener('wattzun:form-native-saved',event=>window.piesaEvents.push(event.detail));
 const user={uid:'actor-one',getIdToken:async()=>'synthetic-token'};
 createRoot(document.getElementById('root')).render(location.search.includes('catalogue')?<VeuElectricalFormLibrary user={user}/>:<TradeVeuElectricalAssessmentPanel user={user} workOrderId="job-one" readOnly={location.search.includes('readonly')}/>);
 `},bundle:true,write:false,outfile:"piesa.js",format:"iife",jsx:"automatic",plugins:[{name:"synthetic-business",setup(builder){
 builder.onResolve({filter:/TradeBusinessProvider$/},()=>({path:"business",namespace:"fixture"}));
 builder.onResolve({filter:/wattzun-appearance$/},()=>({path:"assistant",namespace:"fixture"}));
 builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="business"?`const business={ownerUid:'owner-one',memberId:'member-one'};export const useTradeBusiness=()=>business;export const useTradeBusinessFetch=()=>window.fetch;`:`export async function requestWattzunAssistant(value){window.formOpenRequests.push(value);return true;}`}));
 }}]});
const js=bundle.outputFiles.find(x=>x.path.endsWith(".js")).text,css=bundle.outputFiles.find(x=>x.path.endsWith(".css")).text;

function presentation(record,state={}){const completion=veuElectricalCompletion(record);const {ownerUid,...visible}=record;void ownerUid;return {...visible,
 ...(state.prefillAnswers?{prefillAnswers:state.prefillAnswers,businessContactSuggestion:state.businessContactSuggestion}:{}),
 evidence:record.evidence.map(({objectKey,previewObjectKey,...evidence})=>evidence),ready:completion.ready,missing:completion.missing,signingScopes:{before:activitySigningScope(record,"before"),after:activitySigningScope(record,"after")},reportUrl:record.status==="complete"?"/api/trade-veu-electrical-assessments?recordId=piesa-one&view=pdf":"",delivery:record.status==="complete"?[{role:"customer",status:"accepted",message:"Provider accepted the customer copy.",acceptedAt:"2026-10-08T00:10:00Z"},{role:"business",status:"blocked",message:"Add a business email address, then retry delivery.",acceptedAt:""}]:[]};}
async function setup(browser,width,query="") {
 const page=await browser.newPage({viewport:{width,height:900}}),record=electricalRecord(),writes=[],state={rejectNextSave:false};
 let started=query.includes("readonly")||query.includes("prefill");
 if(query.includes("prefill")){
  record.answers={initial_rec_name:"Manual REC name"};
  state.prefillAnswers={job_reference:"TLJ-SYNTHETIC",property_address:"12 Synthetic Street, Frankston, VIC, 3199",owner_name:"Synthetic Customer",initial_electrician_name:"Synthetic Electrician",initial_electrician_licence:"SYNTHETIC-LICENCE"};
  state.businessContactSuggestion={name:"Synthetic Business",phone:"0399990001"};
 }
 const errors=[];page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(7000);
 await page.route("https://fixture.invalid/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname!=="/api/trade-veu-electrical-assessments")return route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html><body></body></html>"});
  assert.equal(request.headers().authorization,"Bearer synthetic-token");
  let result;
  if(request.method()==="GET") {
   if(url.searchParams.has("catalogue"))result={ok:true,form:record.form,source:{url:VEU_ELECTRICAL_SOURCE_URL,path:VEU_ELECTRICAL_SOURCE_PATH,sha256:VEU_ELECTRICAL_SOURCE_SHA256,label:"March 2026"}};
   else if(url.searchParams.has("recordId"))result={ok:true,record:presentation(record,state)};
   else result={ok:true,canManage:true,records:started?[presentation(record,state)]:[]};
  } else {
   const multipart=request.headers()["content-type"]?.startsWith("multipart/form-data");
   const data=multipart?await new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.postDataBuffer()}).formData():null;
   const payload=data?{action:data.get("action"),recordId:data.get("recordId"),baseRevision:Number(data.get("baseRevision")),fieldKey:data.get("fieldKey"),requestId:data.get("requestId")}:request.postDataJSON();writes.push(structuredClone(payload));
   if(payload.action==="start"){assert.equal(started,false);started=true;assert.equal(payload.workOrderId,record.workOrderId);}
   else if(payload.action==="retry_delivery") {assert.equal(record.status,"complete");}
   else {
    assert.equal(payload.recordId,record.id);assert.equal(payload.baseRevision,record.revision);
    if(request.method()==="PATCH") {
     if(state.rejectNextSave){state.rejectNextSave=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"Synthetic save unavailable"})});}
     assert.match(payload.requestId,/^[a-f0-9-]{36}$/);record.answers=normaliseActivityAnswers(record.form,payload.answers);
    }else if(payload.action==="upload") {
     assert.match(payload.requestId,/^[a-f0-9-]{36}$/);const file=data.get("file");assert.equal(file.name,"synthetic-consent.pdf");
     record.evidence.push({id:"evidence-one",fieldKey:payload.fieldKey,fileName:file.name,contentType:file.type,sizeBytes:file.size,sha256:activityHash(new Uint8Array(await file.arrayBuffer())),capturedAt:"",latitude:null,longitude:null,metadataOrigin:"file_upload",uploadedAt:"2026-10-08T00:01:00Z",actorUid:"actor-one",objectKey:"private/synthetic",previewObjectKey:""});
    }else if(payload.action==="attest_initial") {
     assert.equal(payload.scopeSha256,activitySigningScope(record,"before"));assert.equal(payload.accepted,true);
     record.answers.initial_correct=true;assert.deepEqual(activityMissing(record,"before",false),[]);
     record.initialAttestation={actorUid:"actor-one",confirmedAt:"2026-10-08T00:02:00Z",scopeSha256:activitySigningScope(record,"before")};
    }else if(payload.action==="sign") {
     const declaration=record.form.declarations.find(item=>item.key===payload.declarationKey);assert.ok(declaration);assert.equal(payload.scopeSha256,activitySigningScope(record,declaration.phase));assert.equal(payload.accepted,true);
     const strokes=validateActivityStrokes(payload.strokes);assert.ok(strokes.some(x=>x.points.length>=8),"Real drawn marks are sent");
     const text=activityDeclarationText(declaration,record.answers);record.signatures.push({id:`signature-${record.signatures.length}`,declarationKey:declaration.key,signerName:payload.signerName,role:declaration.role,phase:declaration.phase,declarationText:text,declarationSha256:activityHash(text),scopeSha256:payload.scopeSha256,signedAt:"2026-10-08T00:03:00Z",actorUid:"actor-one",strokes});
    }else if(payload.action==="complete") {
     assert.equal(veuElectricalCompletion(record).ready,true,"Actual official policy permits completion only after saved attestations and real ink");assert.match(payload.requestId,/^[a-f0-9-]{36}$/);record.status="complete";record.completedAt="2026-10-08T00:04:00Z";
    }else throw new Error("Unexpected assessment action");
    record.revision++;
   }
   result={ok:true,record:presentation(record,state)};
  }
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(result)});
 });
 await page.goto(`https://fixture.invalid/${query}`);await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:Arial,sans-serif;background:#edf4f1;color:#173d40}${css}</style></head><body><main><div id="root"></div></main></body></html>`);await page.addScriptTag({content:js});
 return {page,record,writes,errors,state};
}

test("official assessment native controls save every applicable field and real ink on desktop/mobile",{skip:!executablePath&&"Native browser unavailable",timeout:120000},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try {for(const width of [1366,390])await t.test(`${width}px`,async()=>{
  const f=await setup(browser,width),{page,record,writes}=f;await page.getByRole("button",{name:"Start assessment",exact:true}).click();
  const expected=electricalAnswers(record.form);delete expected.initial_correct;
  if(width===390)Object.assign(expected,{assessment_outcome:"rectification_required",work_tps:true,electrical_works_performed:true,rectification_electrician_name:"Synthetic Rectifier"});
  // All visible sections use the actual official source fixture and actual field controls.
  const sections=[...new Set(expandedActivityFields(record.form,expected).map(x=>x.section))];
  for(const section of sections){await page.getByLabel("Assessment section",{exact:true}).selectOption({label:section});
   const visible=expandedActivityFields(record.form,expected).filter(x=>x.section===section);
   for(const field of visible){if(field.key==="initial_correct"||["photo","document"].includes(field.type))continue;
    const input=page.locator(`[id="piesa-${record.id}-${field.key}"]`);
    if(field.type==="boolean")await input.selectOption(expected[field.key]?"yes":"no");else if(field.type==="select")await input.selectOption(String(expected[field.key]));else await input.fill(String(expected[field.key]));
   }
   const save=page.getByRole("button",{name:"Save answers",exact:true});if(await save.isEnabled()){await save.click();await page.getByText("Saved.",{exact:true}).waitFor();}
   if(section.startsWith("B3")){await page.getByRole("button",{name:"Confirm initial assessment declaration",exact:true}).click();await page.getByText("Initial assessment attestation saved.",{exact:true}).waitFor();}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"Section fits viewport");
  }
  assert.equal(record.answers.life_support,false,"An explicit No stays a saved boolean");
  assert.equal(record.answers.inspection_date,"2026-10-08");assert.ok(record.initialAttestation);
  await page.getByRole("button",{name:"Fill by voice",exact:true}).click();
  const opened=await page.evaluate(()=>window.formOpenRequests);assert.equal(opened.length,1);assert.deepEqual(opened[0].workReference,{kind:"trade_form",formKind:"veu_electrical",recordId:record.id,jobId:record.workOrderId});assert.equal(opened[0].mode,"call");
  await page.getByLabel("Assessment section",{exact:true}).selectOption({label:"Signatures and completion"});
  if(width===390){
   const declaration=page.locator('[data-assessment-key="rectification_electrician"]');await declaration.getByLabel("I am the named signer and have read and agree to this declaration.",{exact:true}).check();const pad=declaration.getByRole("img"),box=await pad.boundingBox();await page.mouse.move(box.x+20,box.y+40);await page.mouse.down();for(let i=1;i<=12;i++)await page.mouse.move(box.x+20+i*(box.width-50)/14,box.y+40+(i%3)*12);await page.mouse.up();await page.getByRole("button",{name:"Save electrician signature",exact:true}).click();await page.getByText(/Signed by Synthetic Rectifier/).waitFor();
  }
  await page.locator('[data-assessment-key="property_owner"]').getByLabel("I am the named signer and have read and agree to this declaration.",{exact:true}).check();
  const pad=page.getByRole("img",{name:"Property owner / representative signature drawing area",exact:true}),box=await pad.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+20,box.y+40);await page.mouse.down();for(let i=1;i<=12;i++)await page.mouse.move(box.x+20+i*(box.width-50)/14,box.y+40+(i%3)*12);await page.mouse.up();
  await page.getByRole("button",{name:"Save owner signature",exact:true}).click();await page.getByText(/Signed by Synthetic Owner/).waitFor();
  await page.getByRole("button",{name:"Complete assessment and prepare PDF",exact:true}).click();await page.getByRole("button",{name:"Download completed assessment PDF",exact:true}).waitFor();
  assert.equal(record.status,"complete");assert.equal(veuElectricalCompletion(record).ready,true);assert.equal(writes.filter(x=>x.action==="sign").length,width===390?2:1);assert.equal(writes.filter(x=>x.action==="complete").length,1);
  await page.getByText(/Customer copy: accepted/).waitFor();await page.getByText(/Business copy: blocked/).waitFor();
  assert.equal(await page.getByRole("button",{name:"Save answers",exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const events=await page.evaluate(()=>window.piesaEvents);assert.ok(events.every(x=>x.scopeId==="owner-one"&&x.formKind==="veu_electrical"&&x.formId==="piesa-one"));assert.ok(events.length>=3);assert.deepEqual(f.errors,[]);
  if(process.env.PIESA_UI_QA_OUTPUT){fs.mkdirSync(process.env.PIESA_UI_QA_OUTPUT,{recursive:true});await page.screenshot({path:`${process.env.PIESA_UI_QA_OUTPUT}/piesa-${width}px-complete.png`,fullPage:true});}await page.close();
 });}finally{await browser.close();}
});

test("conditional medical attachment and failed-save retry preserve actual answers and request identity",{skip:!executablePath&&"Native browser unavailable",timeout:30000},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});try{
  const f=await setup(browser,390);await f.page.getByRole("button",{name:"Start assessment",exact:true}).click();
  await f.page.locator('[id="piesa-piesa-one-job_reference"]').fill("SYNTHETIC-RETRY");f.state.rejectNextSave=true;
  await f.page.getByRole("button",{name:"Save answers",exact:true}).click();await f.page.getByRole("alert").filter({hasText:"Synthetic save unavailable"}).waitFor();
  assert.equal(f.record.answers.job_reference,undefined);assert.equal(await f.page.locator('[id="piesa-piesa-one-job_reference"]').inputValue(),"SYNTHETIC-RETRY");
  await f.page.getByRole("button",{name:"Save answers",exact:true}).click();await f.page.getByText("Saved.",{exact:true}).waitFor();assert.equal(f.writes[1].requestId,f.writes[2].requestId,"Exact retry uses the same native request key");
  await f.page.locator('[id="piesa-piesa-one-life_support"]').selectOption("yes");await f.page.locator('[id="piesa-piesa-one-life_support_consent"]').selectOption("yes");await f.page.locator('[id="piesa-piesa-one-life_support_plan"]').selectOption("no");
  const file=f.page.locator('[id="piesa-piesa-one-life_support_record"]');assert.equal(await file.isDisabled(),true,"Unsaved answer changes cannot upload against another snapshot");
  await f.page.getByRole("button",{name:"Save answers",exact:true}).click();await f.page.getByText("Saved.",{exact:true}).waitFor();
  await file.setInputFiles({name:"synthetic-consent.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.7 synthetic controlled consent fixture")});await f.page.getByText("Evidence saved.",{exact:true}).waitFor();
  assert.equal(f.record.evidence.length,1);assert.equal(f.record.evidence[0].fieldKey,"life_support_record");assert.equal(f.record.answers.life_support_plan,false);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(f.errors,[]);await f.page.close();
 }finally{await browser.close();}
});

test("official safety library is authenticated, source-based and read-only; job read-only users cannot write",{skip:!executablePath&&"Native browser unavailable",timeout:30000},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});try{
  const f=await setup(browser,390,"?catalogue");await f.page.getByText("VICTORIA · OFFICIAL FORM",{exact:true}).waitFor();await f.page.getByText("View assessment questions",{exact:true}).click();await f.page.getByText("Date of inspection",{exact:true}).waitFor();
  assert.equal(await f.page.getByRole("button",{name:"Start assessment",exact:true}).count(),0);assert.equal(await f.page.locator("input,select,textarea").count(),0);assert.equal(f.writes.length,0);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.page.close();
  const g=await setup(browser,390,"?readonly");await g.page.getByRole("button",{name:"Open assessment",exact:true}).click();assert.equal(await g.page.getByRole("button",{name:"Save answers",exact:true}).count(),0);assert.equal(await g.page.getByRole("button",{name:"Fill by voice",exact:true}).count(),0);assert.equal(await g.page.locator("fieldset input:not(:disabled),fieldset select:not(:disabled)").count(),0);assert.equal(g.writes.length,0);await g.page.close();
 }finally{await browser.close();}
});

test("existing draft known details are visible, editable and explicitly saved; REC suggestions never claim registration",{skip:!executablePath&&"Native browser unavailable",timeout:40000},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});try{
  for(const width of [1366,390])await t.test(`${width}px`,async()=>{
   const f=await setup(browser,width,"?prefill"),{page}=f;
   await page.getByRole("button",{name:"Open assessment",exact:true}).click();
   assert.equal(await page.locator('[id="piesa-piesa-one-job_reference"]').inputValue(),"TLJ-SYNTHETIC");
   assert.equal(await page.locator('[id="piesa-piesa-one-property_address"]').inputValue(),"12 Synthetic Street, Frankston, VIC, 3199");
   assert.equal(await page.locator('[id="piesa-piesa-one-inspection_date"]').inputValue(),"");
   assert.equal(f.record.answers.job_reference,undefined);assert.equal(f.writes.length,0,"Reading a draft does not persist its defaults");
   await page.locator('[id="piesa-piesa-one-job_reference"]').fill("");
   const refreshed=page.waitForResponse(response=>response.url().includes("recordId="));
   await page.getByRole("button",{name:"Refresh",exact:true}).click();await refreshed;
   assert.equal(await page.locator('[id="piesa-piesa-one-job_reference"]').inputValue(),"","Refresh preserves a locally cleared answer");
   const b3=f.record.form.fields.find(field=>field.key==="initial_rec_name").section;
   await page.getByLabel("Assessment section",{exact:true}).selectOption({label:b3});
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_electrician_name"]').inputValue(),"Synthetic Electrician");
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_rec_name"]').inputValue(),"Manual REC name");
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_rec_phone"]').inputValue(),"");
   await page.getByRole("button",{name:"Use business contact details",exact:true}).click();
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_rec_name"]').inputValue(),"Manual REC name","Opt-in never overwrites an entered contractor name");
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_rec_phone"]').inputValue(),"0399990001");
   assert.equal(await page.locator('[id="piesa-piesa-one-initial_rec_number"]').inputValue(),"");
   assert.equal(f.writes.length,0,"The contact suggestion is still an editable local answer");
   await page.getByRole("button",{name:"Save answers",exact:true}).click();await page.getByText("Saved.",{exact:true}).waitFor();
   assert.equal(f.writes.length,1);assert.equal(f.record.answers.initial_rec_phone,"0399990001");
   assert.equal(f.record.answers.initial_rec_name,"Manual REC name");assert.equal(f.record.answers.job_reference,undefined,"Blank answers are omitted by canonical normalization");
   await page.getByLabel("Assessment section",{exact:true}).selectOption({label:f.record.form.fields[0].section});
   assert.equal(await page.locator('[id="piesa-piesa-one-job_reference"]').inputValue(),"","Successful save does not reapply an intentionally cleared default");
   assert.equal(f.record.answers.initial_rec_number,undefined);assert.equal(f.record.initialAttestation,undefined);assert.equal(f.record.signatures.length,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(f.errors,[]);await page.close();
  });
  const readonly=await setup(browser,390,"?readonly&prefill");await readonly.page.getByRole("button",{name:"Open assessment",exact:true}).click();
  assert.equal(await readonly.page.locator('[id="piesa-piesa-one-job_reference"]').inputValue(),"","Read-only answers remain the actual saved record");
  assert.equal(readonly.writes.length,0);await readonly.page.close();
 }finally{await browser.close();}
});
