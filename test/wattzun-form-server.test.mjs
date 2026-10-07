import test from "node:test";
import assert from "node:assert/strict";
import { prepareWattzunForm, executeWattzunForm, reconcileWattzunFormReceipt, loadWattzunFormContext, verifyWattzunFormAccess, isWattzunFormPrepared, WattzunFormError,
  prepareWattzunFormForTurn, prepareWattzunGuidedFormForTurn, verifyWattzunFormForTurn, verifyWattzunFormAccessForTurn,
  loadWattzunFormGuideForTurn, controlWattzunFormGuideForTurn, prepareWattzunFormCompletion, prepareWattzunFormCompletionForTurn,
  verifyWattzunFormCompletionForTurn, verifyWattzunFormCompletionAccessForTurn, executeWattzunFormCompletion, reconcileWattzunFormCompletionReceipt, isWattzunFormCompletionPrepared,
  prepareWattzunFormStep, prepareWattzunFormStepForTurn, verifyWattzunFormStepForTurn, verifyWattzunFormStepAccessForTurn, executeWattzunFormStep, reconcileWattzunFormStepReceipt, isWattzunFormStepPrepared, searchWattzunFormProductsForTurn } from "../src/lib/wattzun-form-server.ts";
import { readWattzunFormGuideProgress, wattzunFormGuideNarration } from "../src/lib/wattzun-form-guide.ts";
import { workContextGateway } from "./helpers/wattzun-work-context-fixture.mjs";

const request=new Request("https://fixture.invalid/api/wattzun/workflow",{headers:{Authorization:"Bearer synthetic",Origin:"https://fixture.invalid"}});
const access={actorUid:"actor-one",scope:{portal:"trade",scopeId:"owner-one",label:"Synthetic business"},db:{prepare(){throw new Error("Assistant must not mutate storage directly");}}};
const requestId="synthetic-request-one";
const reference=formKind=>({kind:"trade_form",formKind,recordId:formKind==="work_pack"?"pack-one":"form-one",jobId:"job-one"});
const proposal=(formKind,fieldKey="notes",value="Observed seal needs replacement")=>({kind:"fill_form",jobQuery:"",jobId:"job-one",formKind,formId:reference(formKind).recordId,answers:[{fieldKey,value}]});
const formError=status=>error=>error instanceof WattzunFormError&&error.status===status;
const stepProposal=(kind,step)=>({kind:"form_step",jobQuery:"",jobId:"job-one",formKind:kind,formId:reference(kind).recordId,step});
function field(key,type="text",extras={}){return {key,label:key==="notes"?"Site observations":key,type,required:true,options:[],help:"",phase:"before",section:"Installation",...extras};}
function prompt(key,type="text",extras={}){return {promptKey:key,label:key==="notes"?"Site observations":key,type,required:true,options:[],dependencyKeys:[],attestation:null,fileRequirement:null,referenceDocument:null,signerRoleKey:"",minimumLength:null,maximumLength:null,minimumNumber:null,maximumNumber:null,numberStep:null,...extras};}
function fixture(formKind){
  const team={ownerUid:"owner-one",actorUid:"actor-one",memberId:"member-one",isOwner:true,jobScope:"team",canViewFieldEvidence:true,canManageFieldEvidence:true};
  const job={id:"job-one",stage:"scheduled",revision:4};
  const supporting={id:"form-one",templateName:"Installation checks",revision:1,status:"draft",template:{fields:[field("notes","textarea"),field("next_question"),field("retained"),field("kind","select",{options:["heat","boiler"]}),field("boiler_question","text",{condition:{fieldKey:"kind",equals:"boiler"}}),field("check","checkbox"),field("work_date","date"),field("consent","checkbox"),field("evidence_reference")]},answers:{notes:"",next_question:"",retained:"Keep this",kind:"heat",check:false,work_date:"",consent:false,evidence_reference:""}};
  const activity={id:"form-one",workOrderId:"job-one",ownerUid:"owner-one",revision:1,status:"draft",form:{id:"synthetic",title:"Activity installation checks",version:1,activityTemplateId:"synthetic",programCode:"SYNTHETIC",fields:[field("notes"),field("next_question"),field("retained"),field("quantity","number"),field("date","date"),field("select","select",{options:["a","b"],optionLabels:{a:"Option A",b:"Option B"}}),field("checked","boolean"),field("derived","text",{presentation:"derived"}),field("brand","text",{approvedProduct:{role:"brand",productKind:"veu_water_heater",veuActivityCodes:["1"]}}),field("photo","photo"),field("prefill","text",{autofill:"job.customer.fullName"}),field("consent","boolean"),field("hidden","text",{condition:{fieldKey:"checked",equals:true}}),field("unit.serial","text",{repeatGroup:"units"})],declarations:[],sources:[],reviewNotes:[]},formSha256:"a".repeat(64),answers:{retained:"Keep this",checked:false,derived:"system-owned",prefill:"Saved customer","$repeat.units":2},signatures:[],evidence:[]};
  const workPack={instance:{id:"pack-one",workOrderId:"job-one",instanceKey:"stable-pack",revision:1,status:"in_progress",responseSha256:"sha256:"+"a".repeat(64)},definition:{title:"Governed installation checks",schema:{sections:[{sectionKey:"general",repeatability:null,prompts:[prompt("notes"),prompt("next_question"),prompt("retained"),prompt("quantity","number",{minimumNumber:0,maximumNumber:10,numberStep:.5}),prompt("choice","select",{options:[{value:"a",label:"Option A"},{value:"b",label:"Option B"}]}),prompt("photo","photo"),prompt("product","text",{dependencyKeys:["official-product"]}),prompt("declaration","checkbox",{attestation:{text:"I declare"}}),prompt("hidden")]},{sectionKey:"units",repeatability:{},prompts:[prompt("serial")]}]}},signatureBindings:{definitionSha256:"a",prefillSha256:"b"},response:{answers:{retained:"Keep this"},repeatableSections:{units:[{instanceKey:"unit-one",answers:{serial:"OLD"}}]}},completion:{visiblePromptKeys:["notes","next_question","retained","quantity","choice","photo","product","declaration","units[unit-one].serial"]}};
  const calls=[];
  const state={team,job,supporting,activity,workPack,calls,failAfterSave:false};
  const deps={
    async team(req){assert.equal(req.headers.get("X-TLink-Business"),"owner-one");assert.equal(req.headers.get("Authorization"),"Bearer synthetic");return team;},
    async job(current,id){assert.equal(current,team);assert.equal(id,"job-one");return job;},
    async getJobForms(req){assert.equal(new URL(req.url).searchParams.get("workOrderId"),"job-one");return Response.json({ok:true,forms:[structuredClone(supporting)]});},
    async saveJobForm(req){const body=await req.json();calls.push(body);assert.equal(body.complete,false);assert.equal(body.baseRevision,supporting.revision);supporting.answers=body.answers;supporting.revision++;if(state.failAfterSave)throw new Error("Connection lost after commit");return Response.json({ok:true,forms:[supporting]});},
    async loadActivity(current,id){assert.equal(current,team);assert.equal(id,"form-one");return structuredClone(activity);},
    async saveActivity(current,id,revision,answers){calls.push({id,revision,answers});assert.equal(revision,activity.revision);activity.answers=structuredClone(answers);activity.revision++;if(state.failAfterSave)throw new Error("Connection lost after commit");return structuredClone(activity);},
    async loadPack(db,input){assert.equal(db,access.db);assert.equal(input.ownerUid,team.ownerUid);assert.equal(input.actorUid,team.actorUid);assert.equal(input.actorMemberId,team.memberId);assert.equal(input.scope,team.jobScope);return structuredClone(workPack);},
    async savePack(db,input){calls.push(input);assert.equal(db,access.db);assert.equal(input.expectedResponseSha256,workPack.instance.responseSha256);for(const patch of input.sectionPatches){assert.equal(patch.remove,undefined);if(patch.repeatInstanceKey)Object.assign(workPack.response.repeatableSections[patch.sectionKey].find(row=>row.instanceKey===patch.repeatInstanceKey).answers,patch.answers);else Object.assign(workPack.response.answers,patch.answers);}workPack.instance.id="pack-two";workPack.instance.revision++;workPack.instance.responseSha256="sha256:"+"b".repeat(64);if(state.failAfterSave)throw new Error("Connection lost after commit");return {status:"applied",action:"work_pack_commit",projection:structuredClone(workPack)};},
  };
  return {...state,state,deps,ref:reference(formKind),propose:(key,value)=>proposal(formKind,key,value)};
}

function governedStepsFixture(){
  const f=fixture("work_pack"), receipts=new Map(), lookups=[];
  const products=[{selectionId:"product-one",snapshotId:"snapshot-one",brand:"Example",manufacturer:"Example Manufacturing",model:"X1",sourceSha256:"a".repeat(64)},
    {selectionId:"product-two",snapshotId:"snapshot-one",brand:"Example",manufacturer:"Example Manufacturing",model:"X2",sourceSha256:"a".repeat(64)}];
  f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[]}];f.workPack.definition.schema.dependencies=[];
  f.workPack.response={answers:{},repeatableSections:{},dependencyResolutions:{}};f.workPack.completion={visiblePromptKeys:[],ready:false,blockers:[]};f.workPack.referenceDocuments=[];f.workPack.calculatorPendingReviews=[];
  const commit=async(action,db,input)=>{
    assert.equal(db,access.db);assert.equal(input.ownerUid,f.team.ownerUid);assert.equal(input.actorUid,f.team.actorUid);assert.equal(input.actorMemberId,f.team.memberId);
    assert.equal(input.caseInstanceId,f.workPack.instance.id);assert.equal(input.expectedResponseSha256,f.workPack.instance.responseSha256);f.calls.push(structuredClone({action,...input}));
    const base=f.workPack.instance.revision;
    if(action==="work_pack_commit"){
      for(const patch of input.sectionPatches??[])Object.assign(f.workPack.response.answers,patch.answers);
      for(const ack of input.referenceAcknowledgements??[])f.workPack.response.answers[ack.promptKey]={sourceArtifactId:ack.sourceArtifactId,acknowledged:true,acknowledgedAt:ack.acknowledgedAt};
      f.workPack.signatureBindings.prefillSha256="native-refreshed-prefill";
    }else if(action==="work_pack_prepare_signing"){
      f.workPack.instance.status="ready_to_sign";f.workPack.signatureBindings.prefillSha256="canonical-refreshed-prefill";f.workPack.instance.revision++;
    }else if(action==="work_pack_run_calculator"){
      f.workPack.response.dependencyResolutions[input.dependencyKey]={status:"blocked",reference:"actual-calculation-run-one"};f.workPack.calculatorPendingReviews=[{dependencyKey:input.dependencyKey}];
    }else f.workPack.response.dependencyResolutions[input.dependencyKey]={status:"resolved",reference:input.scenarioCode??input.selections[0].selectionId};
    f.workPack.instance.revision++;f.workPack.instance.id=`pack-revision-${f.workPack.instance.revision}`;f.workPack.instance.responseSha256="sha256:"+String(f.workPack.instance.revision).padStart(64,"0");
    receipts.set(input.idempotency.clientActionId,{action,base,result:f.workPack.instance.revision,idempotency:structuredClone(input.idempotency)});
    if(f.state.failAfterSave)throw new Error("Connection lost after commit");
    return {action,status:"applied",projection:structuredClone(f.workPack)};
  };
  f.deps.steps={
    async products(db,input){assert.equal(db,access.db);assert.equal(input.ownerUid,f.team.ownerUid);assert.equal(input.caseInstanceId,f.workPack.instance.id);assert.equal(input.limit,6);lookups.push(structuredClone(input));return structuredClone(products);},
    selectProducts:(db,input)=>commit("work_pack_select_official_products",db,input),selectScenario:(db,input)=>commit("work_pack_select_scenario",db,input),
    calculate:(db,input)=>commit("work_pack_run_calculator",db,input),prepareSigning:(db,input)=>commit("work_pack_prepare_signing",db,input),commit:(db,input)=>commit("work_pack_commit",db,input),
    async receipt(db,input){const saved=receipts.get(input.idempotency.clientActionId);if(!saved)return null;assert.deepEqual(input.idempotency,saved.idempotency);assert.equal(input.baseRevision,saved.base);assert.equal(input.action,saved.action);if(f.workPack.instance.revision!==saved.result)throw new WattzunFormError(409,"Later canonical revision");return {status:"duplicate",action:saved.action,projection:structuredClone(f.workPack)};}
  };
  return {...f,products,lookups,receipts};
}

for(const kind of ["job_form","activity_form","work_pack"]){
  test(`${kind}: authorized context, reviewed draft save, next question and exact replay`,async()=>{
    const f=fixture(kind);
    const gateway=workContextGateway({form:(request,access,reference)=>loadWattzunFormContext(request,access,reference,f.deps)});
    const context=await gateway.loadWattzunWorkContext(request,access,f.ref);
    assert.equal(context.sources[0].id,"trade_form_questions");
    assert.equal(context.reference.formKind,kind);assert.ok(context.facts.questions.length<=20);assert.ok(new TextEncoder().encode(JSON.stringify(context)).length<=24000);
    assert.ok(context.facts.questions.some(field=>field.fieldKey==="notes"&&field.canDraft));
    assert.ok(!context.facts.questions.some(field=>field.fieldKey==="hidden"||field.fieldKey==="boiler_question"));
    const prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);assert.equal(isWattzunFormPrepared(prepared),true);
    assert.equal(prepared.review.fields[0].value,"Observed seal needs replacement");assert.equal(f.calls.length,0);
    const saved=await executeWattzunForm(request,access,prepared,requestId,f.deps);
    assert.equal(saved.kind,"fill_form");assert.equal(saved.status,"saved");assert.match(saved.message,/draft answers are saved.*Next question: next_question/);
    assert.equal(saved.id,kind==="work_pack"?"pack-two":"form-one");assert.equal(f.calls.length,1);
    assert.equal((kind==="job_form"?f.supporting.answers:kind==="activity_form"?f.activity.answers:f.workPack.response.answers).retained,"Keep this");
    const replay=await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(replay.status,"saved");assert.equal(f.calls.length,1);
    await verifyWattzunFormAccess(request,access,prepared,f.deps);
  });
  test(`${kind}: saved draft survives a lost outer receipt without another mutation`,async()=>{
    const f=fixture(kind),prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);f.state.failAfterSave=true;
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),/Connection lost after commit/);
    assert.equal(f.calls.length,1);const recovered=await executeWattzunForm(request,access,prepared,requestId,f.deps);
    assert.equal(recovered.status,"saved");assert.equal(f.calls.length,1);
  });
  test(`${kind}: read-only reconciliation distinguishes an unchanged review from the exact saved result`,async()=>{
    const f=fixture(kind),prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);
    assert.equal(await reconcileWattzunFormReceipt(request,access,prepared,f.deps),null);assert.equal(f.calls.length,0);
    f.state.failAfterSave=true;
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),/Connection lost after commit/);
    const recovered=await reconcileWattzunFormReceipt(request,access,prepared,f.deps);
    assert.equal(recovered.status,"saved");assert.equal(recovered.id,kind==="work_pack"?"pack-two":"form-one");assert.equal(f.calls.length,1);
    f.team.canManageFieldEvidence=false;
    await assert.rejects(reconcileWattzunFormReceipt(request,access,prepared,f.deps),formError(403));
    f.team.canManageFieldEvidence=true;
    const current=kind==="job_form"?f.supporting:kind==="activity_form"?f.activity:f.workPack.instance;current.revision++;
    await assert.rejects(reconcileWattzunFormReceipt(request,access,prepared,f.deps),formError(409));assert.equal(f.calls.length,1);
  });
  test(`${kind}: changed answers after review never get overwritten`,async()=>{
    const f=fixture(kind),prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);
    if(kind==="job_form"){f.supporting.answers.notes="Office update";f.supporting.revision++;}
    else if(kind==="activity_form"){f.activity.answers.notes="Office update";f.activity.revision++;}
    else{f.workPack.response.answers.notes="Office update";f.workPack.instance.revision++;}
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
  });
  test(`${kind}: revoked permission, wrong business and terminal job are rechecked`,async()=>{
    const f=fixture(kind),prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);
    f.team.canManageFieldEvidence=false;
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(403));
    await assert.rejects(verifyWattzunFormAccess(request,access,prepared,f.deps),formError(403));
    f.team.canManageFieldEvidence=true;f.team.ownerUid="other-owner";
    await assert.rejects(loadWattzunFormContext(request,access,f.ref,f.deps),formError(403));
    f.team.ownerUid="owner-one";f.job.stage="completed";
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
  });
  test(`${kind}: unknown and evidence/declaration questions cannot become draft answers`,async()=>{
    const f=fixture(kind);
    for(const key of ["unknown",kind==="job_form"?"boiler_question":"hidden"]){await assert.rejects(prepareWattzunForm(request,access,f.propose(key,"invented"),f.deps),formError(409));}
    for(const key of kind==="job_form"?["evidence_reference","consent"]:kind==="activity_form"?["photo","consent","derived","brand","prefill"]:["photo","declaration","product"]){await assert.rejects(prepareWattzunForm(request,access,f.propose(key,true),f.deps),formError(400));}
    assert.equal(f.calls.length,0);
  });
  test(`${kind}: read-only staff context never offers draft writes`,async()=>{
    const f=fixture(kind),before=await loadWattzunFormContext(request,access,f.ref,f.deps);
    f.team.canManageFieldEvidence=false;
    const context=await loadWattzunFormContext(request,access,f.ref,f.deps);
    assert.equal(context.facts.editable,false);assert.ok(context.facts.questions.every(question=>!question.canDraft));
    assert.notEqual(context.sourceSha256,before.sourceSha256);
    await assert.rejects(prepareWattzunForm(request,access,proposal(kind),f.deps),formError(403));
  });
}

test("same apparent saved answer at a newer unrelated revision is not treated as exact recovery",async()=>{
  const f=fixture("activity_form"),prepared=await prepareWattzunForm(request,access,proposal("activity_form"),f.deps);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);f.activity.revision++;
  await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,1);
});
test("changed form definitions and prefill bindings require a new review",async()=>{
  for(const kind of ["job_form","activity_form","work_pack"]){
    const f=fixture(kind),prepared=await prepareWattzunForm(request,access,proposal(kind),f.deps);
    if(kind==="job_form")f.supporting.template.fields[0].label="Changed";
    else if(kind==="activity_form")f.activity.form.fields[0].label="Changed";
    else f.workPack.signatureBindings.prefillSha256="changed";
    await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
  }
});
test("exact saved options, types, date validity and numeric constraints are enforced",async()=>{
  const activity=fixture("activity_form"),pack=fixture("work_pack"),job=fixture("job_form");
  for(const [f,key,value] of [[activity,"quantity","5"],[activity,"checked","yes"],[activity,"date","2026-02-30"],[activity,"select","c"],[pack,"quantity",10.5],[pack,"quantity",.3],[pack,"choice","Option A"],[job,"kind","unknown"],[job,"check","true"],[job,"work_date","2026-02-30"]])await assert.rejects(prepareWattzunForm(request,access,f.propose(key,value),f.deps),formError(400));
  const prepared=await prepareWattzunForm(request,access,pack.propose("choice","a"),pack.deps);assert.equal(prepared.review.fields[0].value,"Option A");
  assert.equal((await prepareWattzunForm(request,access,activity.propose("quantity",0),activity.deps)).patch[0].value,0);
  assert.equal((await prepareWattzunForm(request,access,activity.propose("checked",false),activity.deps)).patch[0].value,false);
});
test("supporting forms preserve unrelated saved answers when a branch would otherwise clear them",async()=>{
  const f=fixture("job_form");f.supporting.answers.kind="boiler";f.supporting.answers.boiler_question="Keep existing boiler measurement";
  await assert.rejects(prepareWattzunForm(request,access,f.propose("kind","heat"),f.deps),formError(409));assert.equal(f.calls.length,0);
});
test("existing repeated activity questions and governed instances use exact canonical field locations",async()=>{
  const activity=fixture("activity_form"),pack=fixture("work_pack");
  let prepared=await prepareWattzunForm(request,access,activity.propose("unit.serial[1]","SERIAL-TWO"),activity.deps);
  await executeWattzunForm(request,access,prepared,requestId,activity.deps);assert.equal(activity.activity.answers["unit.serial[1]"],"SERIAL-TWO");assert.equal(activity.activity.answers["$repeat.units"],2);
  prepared=await prepareWattzunForm(request,access,pack.propose("units[unit-one].serial","SERIAL-NEW"),pack.deps);
  assert.deepEqual(prepared.payload.sectionPatches,[{sectionKey:"units",repeatInstanceKey:"unit-one",answers:{serial:"SERIAL-NEW"}}]);
  await executeWattzunForm(request,access,prepared,requestId,pack.deps);assert.equal(pack.workPack.response.repeatableSections.units[0].answers.serial,"SERIAL-NEW");
  assert.match(pack.calls[0].idempotency.clientActionId,/^wattzun-form-/);assert.match(pack.calls[0].idempotency.payloadHash,/^sha256:[a-f0-9]{64}$/);
  const fresh=await loadWattzunFormContext(request,access,pack.ref,pack.deps);assert.equal(fresh.facts.revision,2,"Old instance reference resolves latest canonical instance");
});
test("prepared form guards and execution reject extra unreviewed answer mutations",async()=>{
  const f=fixture("job_form"),prepared=await prepareWattzunForm(request,access,proposal("job_form"),f.deps);
  assert.equal(isWattzunFormPrepared({...prepared,href:"https://attacker.invalid"}),false);
  assert.equal(isWattzunFormPrepared({...prepared,reference:{...prepared.reference,formKind:"unknown"}}),false);
  assert.equal(isWattzunFormPrepared({...prepared,patch:[{fieldKey:"__proto__",value:"x"}]}),false);
  prepared.payload.answers.retained="Unreviewed replacement";
  await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
});
test("form context exposes bounded next questions and never copies evidence or signature payloads",async()=>{
  const f=fixture("activity_form");f.activity.form.fields=Array.from({length:80},(_,index)=>field(`question_${index}`,"select",{options:Array.from({length:20},(_,option)=>`Option ${option} ${"a".repeat(150)}`)}));
  f.activity.evidence=[{objectKey:"PRIVATE_BUCKET_KEY"}];f.activity.signatures=[{strokes:"PRIVATE_SIGNATURE"}];
  const context=await loadWattzunFormContext(request,access,f.ref,f.deps),json=JSON.stringify(context);
  assert.ok(context.facts.questions.length>0&&context.facts.questions.length<=20);assert.ok(new TextEncoder().encode(json).length<=24000);assert.doesNotMatch(json,/PRIVATE_BUCKET_KEY|PRIVATE_SIGNATURE/);
});
test("staff links open their team workspace and foreign form/job bindings are rejected",async()=>{
  const f=fixture("activity_form");f.team.isOwner=false;f.team.jobScope="own";
  const context=await loadWattzunFormContext(request,access,f.ref,f.deps);assert.match(context.sources[0].href,/^\/direct-trade\/team\?workspace=work&jobId=job-one&jobTab=files$/);
  f.activity.workOrderId="foreign-job";await assert.rejects(loadWattzunFormContext(request,access,f.ref,f.deps),formError(403));
});
test("long saved answers are explicitly omitted rather than presented as complete truncated answers",async()=>{
  const f=fixture("activity_form");f.activity.answers.notes="Important saved observation ".repeat(150);
  const gateway=workContextGateway({form:(request,access,reference)=>loadWattzunFormContext(request,access,reference,f.deps)});
  const context=await gateway.loadWattzunWorkContext(request,access,f.ref),question=context.facts.questions.find(question=>question.fieldKey==="notes");
  assert.equal(question.hasSavedAnswer,true);assert.equal(question.valueOmitted,true);assert.equal(question.value,null);
  assert.ok(context.limitations.some(text=>text.includes("valueOmitted")));
});
test("clearing a draft activity answer follows canonical removal semantics and can recover its receipt",async()=>{
  const f=fixture("activity_form");f.activity.answers.notes="Old draft observation";
  const prepared=await prepareWattzunForm(request,access,f.propose("notes",""),f.deps);
  assert.equal(prepared.review.fields[0].value,"Clear saved answer");assert.equal(Object.hasOwn(prepared.payload.answers,"notes"),false);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);
  assert.equal(Object.hasOwn(f.activity.answers,"notes"),false);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(f.calls.length,1);
});
test("signed activity phases are read-only while unsigned after-work questions remain available",async()=>{
  const f=fixture("activity_form");f.activity.form.fields.push(field("after_notes","textarea",{phase:"after"}));
  f.activity.signatures=[{id:"signature-one",phase:"before",scopeSha256:"b".repeat(64)}];
  const context=await loadWattzunFormContext(request,access,f.ref,f.deps);
  assert.equal(context.facts.questions.find(question=>question.fieldKey==="notes").canDraft,false);
  assert.equal(context.facts.questions.find(question=>question.fieldKey==="after_notes").canDraft,true);
  await assert.rejects(prepareWattzunForm(request,access,f.propose("notes","Change signed observation"),f.deps),formError(400));
  const prepared=await prepareWattzunForm(request,access,f.propose("after_notes","Verified installation"),f.deps);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(f.activity.answers.after_notes,"Verified installation");
});
test("new signatures invalidate the reviewed form snapshot",async()=>{
  const f=fixture("activity_form"),prepared=await prepareWattzunForm(request,access,proposal("activity_form"),f.deps);
  f.activity.signatures=[{id:"signature-one",phase:"before",scopeSha256:"b".repeat(64)}];
  await assert.rejects(executeWattzunForm(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
});
test("canonical answer conflicts and governed errors retain their actionable status",async()=>{
  const activity=fixture("activity_form"),pack=fixture("work_pack");
  const prepared=await prepareWattzunForm(request,access,proposal("activity_form"),activity.deps);
  activity.deps.saveActivity=async()=>{throw new Error("ACTIVITY_ANSWER_CONFLICT");};
  await assert.rejects(executeWattzunForm(request,access,prepared,requestId,activity.deps),error=>formError(409)(error)&&/Another worker/.test(error.message));
  pack.deps.loadPack=async()=>{throw Object.assign(new Error("This work pack changed. Reopen it."),{name:"CreditexActivityWorkPackServerError",status:409});};
  await assert.rejects(loadWattzunFormContext(request,access,pack.ref,pack.deps),error=>formError(409)(error)&&error.message==="This work pack changed. Reopen it.");
});
test("governed repeated item keys retain the canonical dotted-key format",async()=>{
  const f=fixture("work_pack");f.workPack.response.repeatableSections.units[0].instanceKey="unit.one";
  f.workPack.completion.visiblePromptKeys=f.workPack.completion.visiblePromptKeys.map(key=>key.replace("unit-one","unit.one"));
  const prepared=await prepareWattzunForm(request,access,f.propose("units[unit.one].serial","SERIAL-NEW"),f.deps);
  assert.equal(isWattzunFormPrepared(prepared),true);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(f.workPack.response.repeatableSections.units[0].answers.serial,"SERIAL-NEW");
});

const guideStart = () => ({sessionId:"550e8400-e29b-41d4-a716-446655440000",stage:"start",authorization:"ordinary_form_answers",skippedFieldKeys:[]});
const continueGuide = guide => ({...guideStart(),stage:"continue",sourceSha256:guide.sourceSha256,questionKey:guide.next?.fieldKey??"",skippedFieldKeys:guide.skippedFieldKeys});
const loadGuide = (f,input=guideStart(),ref=f.ref) => loadWattzunFormGuideForTurn(request,access,ref,input,f.team,f.deps);
const completeProposal = kind => ({kind:"complete_form",jobQuery:"",jobId:"job-one",formKind:kind,formId:reference(kind).recordId});

test("guided answers advance the actual conditional schema, preserve false/zero and allow an explicit correction",async()=>{
  const f=fixture("activity_form");
  f.activity.form.fields=[field("checked","boolean"),field("measurement","number",{condition:{fieldKey:"checked",equals:true}}),field("notes")];f.activity.answers={};
  let {guide}=await loadGuide(f);assert.equal(guide.next.fieldKey,"checked");assert.ok(readWattzunFormGuideProgress(guide));
  let frozen=await prepareWattzunGuidedFormForTurn(request,access,f.propose("checked",true),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,frozen,requestId,f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.next.fieldKey,"measurement");
  frozen=await prepareWattzunGuidedFormForTurn(request,access,f.propose("measurement",0),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,frozen,requestId+"-two",f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.next.fieldKey,"notes");assert.equal(guide.counts.answered,2);
  frozen=await prepareWattzunGuidedFormForTurn(request,access,f.propose("checked",false),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,frozen,requestId+"-correction",f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.counts.visible,2);assert.equal(guide.counts.answered,1);assert.equal(guide.next.fieldKey,"notes");
  assert.equal(f.activity.answers.measurement,0,"A hidden previous observation is not silently erased");assert.equal(f.activity.answers.checked,false);
});

test("guided source, question, actor, write permission and source refresh are enforced before any save",async()=>{
  const f=fixture("activity_form"),{guide}=await loadGuide(f),input=continueGuide(guide);
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("notes","A"),guideStart(),f.team,f.deps),formError(409));
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("notes","A"),{...input,questionKey:"wrong"},f.team,f.deps),formError(409));
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("notes","A"),{...input,authorization:"all_actions"},f.team,f.deps),formError(400));
  f.activity.answers.notes="Office update";f.activity.revision++;
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("notes","A"),input,f.team,f.deps),formError(409));
  await assert.rejects(loadGuide(f,input),formError(409));
  const refreshed=await loadGuide(f,{...input,stage:"resume"});assert.notEqual(refreshed.guide.sourceSha256,guide.sourceSha256);
  f.team.canManageFieldEvidence=false;await assert.rejects(loadGuide(f),formError(403));
  f.team.canManageFieldEvidence=true;f.team.actorUid="another-worker";await assert.rejects(loadGuide(f),formError(403));assert.equal(f.calls.length,0);
});

test("trusted turn checks preserve full source verification without repeating the completed team read",async()=>{
  const f=fixture("job_form");let teamReads=0;const original=f.deps.team;f.deps.team=async req=>{teamReads++;return original(req);};
  const prepared=await prepareWattzunFormForTurn(request,access,f.propose("notes","Read by team"),f.team,f.deps);
  await verifyWattzunFormForTurn(request,access,prepared,f.team,f.deps);assert.equal(teamReads,0);
  f.supporting.answers.notes="Changed";f.supporting.revision++;
  await verifyWattzunFormAccessForTurn(request,access,prepared,f.team,f.deps);
  await assert.rejects(verifyWattzunFormForTurn(request,access,prepared,f.team,f.deps),formError(409));
  f.team.canManageFieldEvidence=false;await assert.rejects(verifyWattzunFormAccessForTurn(request,access,prepared,f.team,f.deps),formError(403));
  f.team.canManageFieldEvidence=true;await prepareWattzunForm(request,access,f.propose("notes","Fresh standalone"),f.deps);assert.equal(teamReads,1);
});

test("skip, repeat and pause do not write or remove required completion blockers",async()=>{
  const f=fixture("job_form");f.supporting.template.fields=[field("notes"),field("next_question")];f.supporting.answers={};
  const {guide}=await loadGuide(f),input=continueGuide(guide),control=command=>({kind:"form_guide_control",command,fieldKey:"notes"});
  const repeat=await controlWattzunFormGuideForTurn(request,access,f.ref,input,control("repeat"),f.team,f.deps);assert.equal(repeat.guide.next.fieldKey,"notes");
  const skipped=await controlWattzunFormGuideForTurn(request,access,f.ref,input,control("skip"),f.team,f.deps);assert.equal(skipped.guide.next.fieldKey,"next_question");assert.equal(skipped.guide.counts.skipped,1);assert.ok(skipped.guide.completion.missing.includes("Site observations"));
  const paused=await controlWattzunFormGuideForTurn(request,access,f.ref,input,control("pause"),f.team,f.deps);assert.equal(paused.guide.state,"paused");assert.equal(paused.guide.next,null);assert.ok(readWattzunFormGuideProgress(paused.guide));
  f.supporting.answers.notes="Saved while paused";f.supporting.revision++;
  const resumed=await controlWattzunFormGuideForTurn(request,access,f.ref,continueGuide(paused.guide),{kind:"form_guide_control",command:"resume",fieldKey:""},f.team,f.deps);assert.equal(resumed.guide.next.fieldKey,"next_question");assert.notEqual(resumed.guide.sourceSha256,paused.guide.sourceSha256);
  await assert.rejects(controlWattzunFormGuideForTurn(request,access,f.ref,input,control("complete"),f.team,f.deps),formError(409));assert.equal(f.calls.length,0);
});

test("full snapshot progress goes beyond the twenty-question model window and deferred required false still blocks completion",async()=>{
  const f=fixture("job_form");f.supporting.template.fields=[field("checked","checkbox"),...Array.from({length:35},(_,i)=>field(`q_${i}`))];f.supporting.answers={checked:false};
  for(let i=0;i<30;i++)f.supporting.answers[`q_${i}`]="Observed";
  assert.equal((await loadGuide(f)).guide.next.fieldKey,"checked");
  const {context,guide}=await loadGuide(f,{...guideStart(),skippedFieldKeys:["checked"]});
  assert.equal(guide.counts.visible,36);assert.equal(guide.counts.answered,31);assert.equal(guide.next.fieldKey,"q_30");assert.equal(guide.counts.manualMissing,0);
  assert.ok(context.facts.questions.length<=20);assert.equal(context.facts.questions[0].fieldKey,"q_30");
  assert.equal(guide.completion.ready,false);assert.ok(guide.completion.missing.includes("checked"));assert.equal(f.supporting.answers.checked,false);
});

test("canonical checkbox defaulting after a date save still asks each untouched required checkbox by voice",async()=>{
  const f=fixture("job_form");f.supporting.template.fields=[field("work_date","date"),field("site_safe","checkbox"),field("scope_checked","checkbox")];f.supporting.answers={};
  let {guide}=await loadGuide(f);assert.equal(guide.next.fieldKey,"work_date");
  const date=await prepareWattzunGuidedFormForTurn(request,access,f.propose("work_date","2026-10-07"),continueGuide(guide),f.team,f.deps);
  assert.deepEqual(date.payload.answers,{work_date:"2026-10-07",site_safe:false,scope_checked:false});
  await executeWattzunForm(request,access,date,requestId,f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.state,"question");assert.equal(guide.next.fieldKey,"site_safe");assert.equal(guide.counts.manualMissing,0);
  const yes=await prepareWattzunGuidedFormForTurn(request,access,f.propose("site_safe",true),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,yes,requestId+"-safe",f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.next.fieldKey,"scope_checked");
  const no=await prepareWattzunGuidedFormForTurn(request,access,f.propose("scope_checked",false),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,no,requestId+"-scope",f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume",skippedFieldKeys:["scope_checked"]}));assert.equal(guide.state,"review");assert.equal(guide.completion.ready,false);assert.equal(guide.counts.manualMissing,0);
  assert.equal(f.supporting.answers.scope_checked,false);assert.ok(guide.completion.missing.includes("scope_checked"));
  await assert.rejects(prepareWattzunFormCompletion(request,access,completeProposal("job_form"),f.deps),formError(409));
});

test("governed answer to photo to required signing preserves latest immutable identity and never invents evidence",async()=>{
  const f=fixture("work_pack"),photo=prompt("photo","photo",{fileRequirement:{minimumCount:1,maximumCount:3,allowedContentTypes:["image/jpeg"],originalRequired:true,metadataRequired:true,gpsRequired:true,captureTimeRequired:true}});
  f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[prompt("notes"),photo,prompt("signed","signature")]}];f.workPack.response={answers:{},repeatableSections:{}};
  const originalLoad=f.deps.loadPack;f.deps.loadPack=async(...args)=>{
    f.workPack.completion={visiblePromptKeys:["notes","photo","signed"],ready:false,blockers:[]};
    if(!f.workPack.response.answers.notes)f.workPack.completion.blockers.push({key:"notes",message:"Provide observations"});
    if(!f.workPack.response.answers.photo?.length)f.workPack.completion.blockers.push({key:"photo",message:"Capture the installation photo"});
    f.workPack.completion.blockers.push({key:"signed",message:"Installer must sign the current declaration"});return originalLoad(...args);
  };
  let {guide}=await loadGuide(f);assert.equal(guide.next.fieldKey,"notes");
  const prepared=await prepareWattzunGuidedFormForTurn(request,access,f.propose("notes","Correctly installed"),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.state,"capture");assert.equal(guide.next.fieldKey,"photo");assert.equal(guide.next.capture.gpsRequired,true);assert.equal(guide.next.capture.savedCount,0);
  assert.equal(guide.reference.recordId,"pack-two");assert.equal(guide.requestedReference.recordId,"pack-one");assert.ok(readWattzunFormGuideProgress(guide));
  const usingLatest=await loadGuide(f,continueGuide(guide),guide.reference);assert.equal(usingLatest.guide.sourceSha256,guide.sourceSha256);
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("photo","made-up-artifact"),continueGuide(guide),f.team,f.deps),formError(400));
  f.workPack.response.answers.photo=["actual-canonical-upload-artifact"];f.workPack.instance.id="pack-three";f.workPack.instance.revision++;
  await assert.rejects(loadGuide(f,continueGuide(guide)),formError(409));
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.equal(guide.state,"question");assert.equal(guide.next.step.kind,"prepare_signing");assert.equal(guide.counts.evidenceMissing,0);
  ({guide}=await controlWattzunFormGuideForTurn(request,access,guide.reference,continueGuide(guide),{kind:"form_guide_control",command:"skip",fieldKey:"$prepare_signing"},f.team,f.deps));
  assert.equal(guide.state,"manual");assert.equal(guide.next.fieldKey,"signed");assert.match(wattzunFormGuideNarration(guide),/review and sign/);
  const review=await controlWattzunFormGuideForTurn(request,access,guide.reference,continueGuide(guide),{kind:"form_guide_control",command:"skip",fieldKey:"signed"},f.team,f.deps);
  assert.equal(review.guide.state,"review");assert.equal(review.guide.completion.ready,false);assert.equal(f.calls.length,1);
});

test("legacy evidence remains a native-app requirement and cannot claim a browser photo control",async()=>{
  const f=fixture("activity_form");f.activity.form.fields=[field("photo","photo")];f.activity.answers={};
  const {guide}=await loadGuide(f);assert.equal(guide.state,"manual");assert.equal(guide.next.capture,undefined);assert.match(guide.next.reason,/field-app/);
});

function completedFixture(kind){
  const f=fixture(kind);
  if(kind==="job_form"){
    f.supporting.template.fields=[field("notes")];f.supporting.answers={notes:"Verified observation"};
    f.deps.saveJobForm=async req=>{const body=await req.json();f.calls.push(body);assert.equal(body.complete,true);assert.equal(body.baseRevision,f.supporting.revision);f.supporting.answers=structuredClone(body.answers);f.supporting.status="complete";f.supporting.revision++;if(f.state.failAfterSave)throw new Error("Completion acknowledgement lost");return Response.json({ok:true});};
  }else if(kind==="activity_form"){
    f.activity.form.fields=[field("notes")];f.activity.answers={notes:"Verified observation"};
    f.deps.submitActivity=async(team,id,revision)=>{assert.equal(team,f.team);assert.equal(id,f.activity.id);assert.equal(revision,f.activity.revision);f.calls.push({kind:"submit"});f.activity.status="submitted_for_creditex_review";f.activity.revision++;if(f.state.failAfterSave)throw new Error("Completion acknowledgement lost");return structuredClone(f.activity);};
  }else{
    f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[prompt("notes")]}];f.workPack.response={answers:{notes:"Verified observation"},repeatableSections:{}};f.workPack.instance.status="ready_to_sign";
    f.workPack.completion={ready:true,visiblePromptKeys:["notes"],blockers:[]};
    f.deps.finalisePack=async(db,input)=>{assert.equal(db,access.db);assert.equal(input.ownerUid,access.scope.scopeId);assert.equal(input.expectedResponseSha256,f.workPack.instance.responseSha256);assert.match(input.idempotency.clientActionId,/^wattzun-complete-/);assert.match(input.idempotency.payloadHash,/^sha256:[a-f0-9]{64}$/);f.calls.push(input);f.workPack.instance.status="completed";f.workPack.instance.id="pack-final";f.workPack.instance.revision++;if(f.state.failAfterSave)throw new Error("Completion acknowledgement lost");return {status:"applied",projection:structuredClone(f.workPack)};};
  }
  return f;
}
for(const kind of ["job_form","activity_form","work_pack"]){
  test(`${kind}: actual canonical completion needs frozen confirmation and recovers a lost receipt without a second submission`,async()=>{
    const f=completedFixture(kind),{guide}=await loadGuide(f);assert.equal(guide.state,"ready_to_complete");assert.match(wattzunFormGuideNarration(guide),/complete this form now/);
    const prepared=await prepareWattzunFormCompletionForTurn(request,access,completeProposal(kind),f.team,f.deps);assert.equal(isWattzunFormCompletionPrepared(prepared),true);assert.equal(f.calls.length,0);
    await verifyWattzunFormCompletionForTurn(request,access,prepared,f.team,f.deps);
    assert.equal(await reconcileWattzunFormCompletionReceipt(request,access,prepared,f.deps),null);
    f.state.failAfterSave=true;await assert.rejects(executeWattzunFormCompletion(request,access,prepared,requestId,f.deps),/Completion acknowledgement lost/);
    const recovered=await reconcileWattzunFormCompletionReceipt(request,access,prepared,f.deps);assert.equal(recovered.kind,"complete_form");assert.equal(recovered.status,"submitted");assert.equal(f.calls.length,1);
    await executeWattzunFormCompletion(request,access,prepared,requestId,f.deps);assert.equal(f.calls.length,1);
    await verifyWattzunFormCompletionAccessForTurn(request,access,prepared,f.team,f.deps);
    const final=await loadGuide(f,{...guideStart(),stage:"resume"});assert.equal(final.guide.state,"complete");assert.equal(final.guide.receipt.kind,"complete_form");assert.ok(readWattzunFormGuideProgress(final.guide));
    f.team.canManageFieldEvidence=false;await assert.rejects(reconcileWattzunFormCompletionReceipt(request,access,prepared,f.deps),formError(403));
  });
  test(`${kind}: stale, tampered, foreign and closed-job completion cannot mutate`,async()=>{
    const f=completedFixture(kind),prepared=await prepareWattzunFormCompletion(request,access,completeProposal(kind),f.deps);
    await assert.rejects(executeWattzunFormCompletion(request,access,{...prepared,expectedAnswersSha256:"f".repeat(64)},requestId,f.deps),formError(409));
    await assert.rejects(executeWattzunFormCompletion(request,access,{...prepared,actorUid:"other-actor"},requestId,f.deps),formError(403));
    const current=kind==="job_form"?f.supporting:kind==="activity_form"?f.activity:f.workPack.instance;current.revision++;
    await assert.rejects(executeWattzunFormCompletion(request,access,prepared,requestId,f.deps),formError(409));current.revision--;
    f.job.stage="completed";await assert.rejects(prepareWattzunFormCompletion(request,access,completeProposal(kind),f.deps),formError(409));assert.equal(f.calls.length,0);
  });
}

test("unmet declarations and work-pack preparation cannot be fabricated by completion",async()=>{
  const job=fixture("job_form"),pack=completedFixture("work_pack");
  await assert.rejects(prepareWattzunFormCompletion(request,access,completeProposal("job_form"),job.deps),formError(409));
  pack.workPack.instance.status="in_progress";
  await assert.rejects(prepareWattzunFormCompletion(request,access,completeProposal("work_pack"),pack.deps),formError(409));
  pack.workPack.instance.status="ready_to_sign";pack.workPack.completion={...pack.workPack.completion,ready:false,blockers:[{key:"signature",message:"The customer must sign the declaration"}]};
  const {guide}=await loadGuide(pack);assert.equal(guide.next.fieldKey,"signature");assert.match(guide.completion.missing[0],/customer must sign/);
  await assert.rejects(prepareWattzunFormCompletion(request,access,completeProposal("work_pack"),pack.deps),formError(409));assert.equal(pack.calls.length,0);
});

test("spoken governed multi-select validates saved option values and selection counts, preserves lists and recovers exactly",async()=>{
  const f=fixture("work_pack"),choice=prompt("choices","multiselect",{options:[{value:"a",label:"Option A"},{value:"b",label:"Option B"},{value:"c",label:"Option C"}],minimumSelections:1,maximumSelections:2});
  f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[choice,prompt("notes")]}];f.workPack.response={answers:{},repeatableSections:{}};f.workPack.completion={ready:false,visiblePromptKeys:["choices","notes"],blockers:[{key:"choices",message:"Choose at least one option"}]};
  const {guide}=await loadGuide(f);assert.equal(guide.next.type,"multiselect");assert.equal(guide.next.fieldKey,"choices");
  for(const value of [["a","a"],["a","b","c"],["Option A"],[],"a"]){await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("choices",value),continueGuide(guide),f.team,f.deps),formError(400));}
  const prepared=await prepareWattzunGuidedFormForTurn(request,access,f.propose("choices",["a","c"]),continueGuide(guide),f.team,f.deps);
  assert.equal(isWattzunFormPrepared(prepared),true);assert.equal(prepared.review.fields[0].value,"Option A, Option C");
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.deepEqual(f.workPack.response.answers.choices,["a","c"]);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(f.calls.length,1);
  const context=await loadWattzunFormContext(request,access,f.ref,f.deps);assert.deepEqual(context.facts.questions.find(item=>item.fieldKey==="choices").value,["a","c"]);
  const activity=fixture("activity_form");await assert.rejects(prepareWattzunForm(request,access,activity.propose("select",["a"]),activity.deps),formError(400));
});

test("a saved allowed empty multi-select is an answered none, while evidence IDs remain omitted from model context",async()=>{
  const f=fixture("work_pack");f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[prompt("choices","multiselect",{minimumSelections:0,maximumSelections:2}),prompt("photo","photo"),prompt("notes")]}];
  f.workPack.response={answers:{choices:[],photo:["private-custody-artifact-id"]},repeatableSections:{}};f.workPack.completion={ready:false,visiblePromptKeys:["choices","photo","notes"],blockers:[{key:"notes",message:"Notes needed"}]};
  const {context,guide}=await loadGuide(f);assert.equal(guide.next.fieldKey,"notes");assert.equal(guide.counts.answered,2);assert.doesNotMatch(JSON.stringify(context),/private-custody-artifact-id/);
});

test("required repeat items can be created by spoken count, then filled through canonical locations without replay duplication",async()=>{
  const f=fixture("work_pack"),section={sectionKey:"units",title:"Installed units",visibility:null,repeatability:{minimumInstances:2,maximumInstances:4,itemLabel:"units",itemKey:"unit"},prompts:[prompt("serial")]};
  f.workPack.definition.schema.sections=[section];f.workPack.response={answers:{},repeatableSections:{units:[]}};
  const originalLoad=f.deps.loadPack;f.deps.loadPack=async(...args)=>{
    const items=f.workPack.response.repeatableSections.units;
    f.workPack.completion={ready:false,visiblePromptKeys:items.map(item=>`units[${item.instanceKey}].serial`),blockers:items.length<2?[{key:"units",message:"Installed units needs 2 to 4 items"}]:items.filter(item=>!item.answers.serial).map(item=>({key:`units[${item.instanceKey}].serial`,message:"Serial number needed"}))};return originalLoad(...args);
  };
  f.deps.savePack=async(db,body)=>{
    assert.equal(db,access.db);assert.equal(body.expectedResponseSha256,f.workPack.instance.responseSha256);f.calls.push(body);
    for(const patch of body.sectionPatches){assert.equal(patch.remove,undefined);assert.equal(patch.sectionKey,"units");let instance=f.workPack.response.repeatableSections.units.find(item=>item.instanceKey===patch.repeatInstanceKey);
      if(!instance){instance={instanceKey:patch.repeatInstanceKey,answers:{}};f.workPack.response.repeatableSections.units.push(instance);}Object.assign(instance.answers,patch.answers);}
    f.workPack.instance.revision++;f.workPack.instance.id=`pack-revision-${f.workPack.instance.revision}`;f.workPack.instance.responseSha256="sha256:"+String(f.workPack.instance.revision).padStart(64,"0");return {status:"applied",projection:structuredClone(f.workPack)};
  };
  let {guide}=await loadGuide(f);assert.equal(guide.state,"question");assert.equal(guide.next.fieldKey,"$repeat.units");assert.match(guide.next.label,/choose 2 to 4/);
  for(const value of [0,1,5,2.5,"2"])await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("$repeat.units",value),continueGuide(guide),f.team,f.deps),formError(400));
  let frozen=await prepareWattzunGuidedFormForTurn(request,access,f.propose("$repeat.units",2),continueGuide(guide),f.team,f.deps);
  assert.equal(isWattzunFormPrepared(frozen),true);assert.equal(frozen.payload.sectionPatches.length,2);assert.ok(frozen.payload.sectionPatches.every(item=>Object.keys(item.answers).length===0));
  await executeWattzunForm(request,access,frozen,requestId,f.deps);await executeWattzunForm(request,access,frozen,requestId,f.deps);assert.equal(f.calls.length,1);assert.equal(f.workPack.response.repeatableSections.units.length,2);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));const firstKey=guide.next.fieldKey;assert.match(firstKey,/^units\[item-wattzun-[a-f0-9]{32}-1\]\.serial$/);
  frozen=await prepareWattzunGuidedFormForTurn(request,access,{...f.propose(firstKey,"SERIAL-1"),formId:guide.reference.recordId},continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,frozen,requestId+"-serial",f.deps);
  ({guide}=await loadGuide(f,{...guideStart(),stage:"resume"}));assert.notEqual(guide.next.fieldKey,firstKey);assert.equal(f.workPack.response.repeatableSections.units[0].answers.serial,"SERIAL-1");
  await assert.rejects(prepareWattzunGuidedFormForTurn(request,access,f.propose("$repeat.units",1),continueGuide(guide),f.team,f.deps),formError(400));
  const tampered=await prepareWattzunGuidedFormForTurn(request,access,f.propose("$repeat.units",3),continueGuide(guide),f.team,f.deps);tampered.payload.sectionPatches[0].repeatInstanceKey=f.workPack.response.repeatableSections.units[0].instanceKey;
  await assert.rejects(executeWattzunForm(request,access,tampered,requestId+"-tampered",f.deps),formError(409));assert.equal(f.calls.length,2);
});

test("conditional repeat sections stay hidden and new item additions are capped without a removal operation",async()=>{
  const f=fixture("work_pack"),section={sectionKey:"units",title:"Installed units",visibility:{match:"all",conditions:[{promptKey:"enabled",scope:"work_pack",operator:"equals",value:true}]},repeatability:{minimumInstances:25,maximumInstances:50,itemLabel:"units",itemKey:"unit"},prompts:[prompt("serial")]};
  f.workPack.definition.schema.sections=[section];f.workPack.response={answers:{enabled:false},repeatableSections:{units:[]}};f.workPack.completion={ready:false,visiblePromptKeys:[],blockers:[]};
  assert.equal((await loadGuide(f)).guide.next,null);
  await assert.rejects(prepareWattzunForm(request,access,f.propose("$repeat.units",2),f.deps),formError(409));
  f.workPack.response.answers.enabled=true;f.workPack.completion.blockers=[{key:"units",message:"25 units required"}];
  const {guide}=await loadGuide(f);assert.match(guide.next.label,/choose 20 to 20/);
  await assert.rejects(prepareWattzunForm(request,access,f.propose("$repeat.units",21),f.deps),formError(400));
  const prepared=await prepareWattzunForm(request,access,f.propose("$repeat.units",20),f.deps);assert.equal(prepared.payload.sectionPatches.length,20);assert.ok(prepared.payload.sectionPatches.every(item=>item.remove===undefined));
});

test("legacy activity repeat counts use canonical answers, preserve existing items and respect signed phases",async()=>{
  const f=fixture("activity_form");f.activity.form.fields=[field("unit.serial","text",{repeatGroup:"units"})];f.activity.answers={"unit.serial":"EXISTING"};
  const {guide}=await loadGuide(f);assert.equal(guide.next.fieldKey,"$repeat.units");
  const prepared=await prepareWattzunGuidedFormForTurn(request,access,f.propose("$repeat.units",3),continueGuide(guide),f.team,f.deps);
  await executeWattzunForm(request,access,prepared,requestId,f.deps);assert.equal(f.activity.answers["$repeat.units"],3);assert.equal(f.activity.answers["unit.serial"],"EXISTING");
  const next=await loadGuide(f,{...guideStart(),stage:"resume"});assert.equal(next.guide.next.fieldKey,"unit.serial[1]");
  await assert.rejects(prepareWattzunForm(request,access,f.propose("$repeat.units",2),f.deps),formError(400));
  f.activity.signatures=[{id:"real-signature",phase:"before",scopeSha256:"b".repeat(64)}];
  await assert.rejects(prepareWattzunForm(request,access,f.propose("$repeat.units",4),f.deps),formError(400));
  assert.equal(f.calls.length,1);
});

for(const kind of ["job_form","activity_form","work_pack"]){
  test(kind+": declarations stay native and spoken approval cannot manufacture acknowledgement",async()=>{
    const f=fixture(kind),key=kind==="work_pack"?"declaration":"consent";
    if(kind==="job_form"){f.supporting.template.fields=[field(key,"checkbox",{label:"Declaration that must be reviewed on screen"})];f.supporting.answers={};}
    if(kind==="activity_form"){f.activity.form.fields=[field(key,"boolean",{label:"Declaration",help:"Exact long statement ".repeat(150)})];f.activity.answers={};}
    if(kind==="work_pack"){f.workPack.definition.schema.sections=[{sectionKey:"general",repeatability:null,prompts:[prompt(key,"checkbox",{attestation:{text:"Exact statement must be reviewed on screen"}})]}];f.workPack.response.answers={};f.workPack.completion.visiblePromptKeys=[key];f.workPack.completion.blockers=[{key,message:"Confirm declaration"}];}
    const {guide}=await loadGuide(f);assert.equal(guide.state,"manual");assert.equal(guide.next.type,"declaration");assert.equal(guide.next.step,undefined);
    const spoken=wattzunFormGuideNarration(guide);assert.match(spoken,/review and confirm the declaration on screen/);assert.doesNotMatch(spoken,/Exact long statement|Exact statement must/);
    await assert.rejects(prepareWattzunFormStep(request,access,stepProposal(kind,{kind:"declaration",fieldKey:key,acknowledged:true}),f.deps),formError(400));
    await assert.rejects(prepareWattzunForm(request,access,f.propose(key,true),f.deps),formError(400));assert.equal(f.calls.length,0);
  });
}
test("governed reference acknowledgement binds literal text and exact source artifact to the canonical acknowledgement command",async()=>{
  const f=governedStepsFixture();f.workPack.definition.schema.sections[0].prompts=[prompt("document","reference_document")];f.workPack.completion.visiblePromptKeys=["document"];
  f.workPack.completion.blockers=[{key:"document",message:"Acknowledge the safety source"}];
  f.workPack.referenceDocuments=[{responseKey:"document",sectionKey:"general",promptKey:"document",sourceArtifactId:"artifact-one",sourceArtifactSha256:"sha256:"+"a".repeat(64),title:"Safety source",acknowledgementMode:"viewed",acknowledgementText:"I have personally read the pinned document.\nI understand its requirements."}];
  const {guide}=await loadGuide(f);assert.equal(guide.next.step.kind,"reference_document");assert.ok(readWattzunFormGuideProgress(guide));assert.match(wattzunFormGuideNarration(guide),/personally read/);
  const input=stepProposal("work_pack",{kind:"reference_document",fieldKey:"document",sourceArtifactId:"artifact-one",acknowledged:true});
  await assert.rejects(prepareWattzunFormStep(request,access,{...input,step:{...input.step,sourceArtifactId:"other-artifact"}},f.deps),formError(409));
  const prepared=await prepareWattzunFormStep(request,access,input,f.deps);f.workPack.referenceDocuments[0].sourceArtifactSha256="sha256:"+"b".repeat(64);
  await assert.rejects(executeWattzunFormStep(request,access,prepared,requestId,f.deps),formError(409));assert.equal(f.calls.length,0);
  f.workPack.referenceDocuments[0].sourceArtifactSha256="sha256:"+"a".repeat(64);f.state.failAfterSave=true;
  await assert.rejects(executeWattzunFormStep(request,access,prepared,requestId,f.deps),/Connection lost/);
  assert.deepEqual(f.calls[0].referenceAcknowledgements,[{sectionKey:"general",promptKey:"document",sourceArtifactId:"artifact-one",acknowledgedAt:prepared.acknowledgedAt}]);assert.equal(f.calls[0].sectionPatches,undefined);
  assert.equal((await reconcileWattzunFormStepReceipt(request,access,prepared,f.deps)).kind,"form_step");assert.equal(f.calls.length,1);
});
test("official products are read-only scoped choices then exact canonical selection with fresh registry/source checks",async()=>{
  const f=governedStepsFixture();f.workPack.definition.schema.dependencies=[{kind:"product",dependencyKey:"products",label:"Installed product",required:true,minimumCount:1,maximumCount:2}];
  f.workPack.completion.blockers=[{key:"products",message:"Select the installed product"}];
  let {guide}=await loadGuide(f);assert.equal(guide.next.step.kind,"official_product");assert.equal(f.lookups.length,0);
  ({guide}=await searchWattzunFormProductsForTurn(request,access,f.ref,continueGuide(guide),{kind:"search_form_products",dependencyKey:"products",search:"Example"},f.team,f.deps));
  assert.deepEqual(guide.next.step.choices.map(item=>item.model),["X1","X2"]);assert.equal(guide.productSearch.search,"Example");assert.equal(f.calls.length,0);
  assert.ok(readWattzunFormGuideProgress(guide));assert.match(wattzunFormGuideNarration(guide),/1, Example X1; 2, Example X2/);
  const input=stepProposal("work_pack",{kind:"official_product",dependencyKey:"products",search:"Example",selections:[{selectionId:"product-two",snapshotId:"snapshot-one",quantity:2}]});
  for(const step of [{...input.step,selections:[{selectionId:"foreign",snapshotId:"snapshot-one",quantity:2}]},{...input.step,selections:[{selectionId:"product-two",snapshotId:"old-snapshot",quantity:2}]}])await assert.rejects(prepareWattzunFormStep(request,access,{...input,step},f.deps),formError(409));
  const prepared=await prepareWattzunFormStepForTurn(request,access,input,f.team,f.deps);assert.ok(isWattzunFormStepPrepared(prepared));f.products[1].sourceSha256="b".repeat(64);
  await assert.rejects(verifyWattzunFormStepForTurn(request,access,prepared,f.team,f.deps),formError(409));assert.equal(f.calls.length,0);f.products[1].sourceSha256="a".repeat(64);
  f.state.failAfterSave=true;await assert.rejects(executeWattzunFormStep(request,access,prepared,requestId,f.deps),/Connection lost/);
  assert.deepEqual(f.calls[0].selections,input.step.selections);assert.equal(f.calls[0].action,"work_pack_select_official_products");assert.equal(f.calls[0].dependencyKey,"products");
  assert.equal((await reconcileWattzunFormStepReceipt(request,access,prepared,f.deps)).status,"saved");assert.equal(f.calls.length,1);
  const changed=structuredClone(prepared);changed.step.selections[0].quantity=3;
  await assert.rejects(reconcileWattzunFormStepReceipt(request,access,changed,f.deps),formError(409));assert.equal(f.calls.length,1);
  await verifyWattzunFormStepAccessForTurn(request,access,prepared,f.team,f.deps);
  f.team.canManageFieldEvidence=false;await assert.rejects(reconcileWattzunFormStepReceipt(request,access,prepared,f.deps),formError(403));f.team.canManageFieldEvidence=true;
  f.workPack.instance.revision++;await assert.rejects(reconcileWattzunFormStepReceipt(request,access,prepared,f.deps),formError(409));
});
test("spoken product ordinals are bound to the exact offered list until a fresh read-only list is spoken",async()=>{
  const f=governedStepsFixture();f.workPack.definition.schema.dependencies=[{kind:"product",dependencyKey:"products",label:"Installed product",required:true,minimumCount:1,maximumCount:2}];
  let {guide}=await loadGuide(f);
  ({guide}=await searchWattzunFormProductsForTurn(request,access,f.ref,continueGuide(guide),{kind:"search_form_products",dependencyKey:"products",search:"Example"},f.team,f.deps));
  assert.match(guide.productSearch.resultsSha256,/^[a-f0-9]{64}$/);
  const nextInput={...continueGuide(guide),productSearch:guide.productSearch};
  await loadGuide(f,nextInput);
  f.products.reverse();await assert.rejects(loadGuide(f,nextInput),formError(409));assert.equal(f.calls.length,0);
  const refreshed=await loadGuide(f,{...nextInput,stage:"resume"});assert.notEqual(refreshed.guide.productSearch.resultsSha256,guide.productSearch.resultsSha256);
  assert.equal(refreshed.guide.next.step.choices[0].selectionId,"product-two");
  await loadGuide(f,{...continueGuide(refreshed.guide),productSearch:refreshed.guide.productSearch});
});
test("a ready work pack without visible signatures reports the actual upstream completion requirement",async()=>{
  const f=governedStepsFixture();f.workPack.completion.ready=true;
  const {guide}=await loadGuide(f);assert.equal(guide.state,"manual");assert.match(guide.next.label,/no visible signature requirement/);assert.equal(guide.next.step,undefined);
  await assert.rejects(prepareWattzunFormStep(request,access,stepProposal("work_pack",{kind:"prepare_signing"}),f.deps),formError(409));assert.equal(f.calls.length,0);
});
test("approved scenario, governed calculation and prepare-signing each use their native command and exact recoverable receipt",async()=>{
  for(const kind of ["scenario","calculator","prepare_signing"]){
    const f=governedStepsFixture();
    if(kind==="prepare_signing"){
      f.workPack.definition.schema.sections[0].prompts=[prompt("signature","signature")];f.workPack.completion.visiblePromptKeys=["signature"];f.workPack.completion.blockers=[{key:"signature",message:"Installer signature required"}];
    }else{f.workPack.definition.schema.dependencies=[{kind,dependencyKey:"required-step",label:"Required step",required:true,scenarioCodes:["approved-a","approved-b"]}];f.workPack.completion.blockers=[{key:"required-step",message:"Complete required step"}];}
    const step=kind==="prepare_signing"?{kind}:{kind,dependencyKey:"required-step",...(kind==="scenario"?{scenarioCode:"approved-b"}:{})};
    const {guide}=await loadGuide(f);assert.equal(guide.next.step.kind,kind);
    if(kind==="scenario")await assert.rejects(prepareWattzunFormStep(request,access,stepProposal("work_pack",{...step,scenarioCode:"invented"}),f.deps),formError(400));
    const prepared=await prepareWattzunFormStep(request,access,stepProposal("work_pack",step),f.deps);f.state.failAfterSave=true;
    await assert.rejects(executeWattzunFormStep(request,access,prepared,requestId,f.deps),/Connection lost/);const recovered=await reconcileWattzunFormStepReceipt(request,access,prepared,f.deps);
    assert.equal(recovered.status,"saved");assert.equal(f.calls.length,1);assert.equal((await executeWattzunFormStep(request,access,prepared,requestId,f.deps)).id,recovered.id);assert.equal(f.calls.length,1);
    if(kind==="calculator"){assert.match(recovered.message,/awaiting independent Creditex review/);assert.match(recovered.message,/not been approved/);const next=await loadGuide(f,{...guideStart(),stage:"resume"});assert.equal(next.guide.state,"manual");assert.notEqual(next.guide.next.step?.kind,"calculator");}
    if(kind==="prepare_signing"){assert.equal(f.workPack.instance.status,"ready_to_sign");assert.equal(f.workPack.instance.revision,3);const next=await loadGuide(f,{...guideStart(),stage:"resume"});assert.equal(next.guide.state,"manual");assert.equal(next.guide.next.type,"signature");assert.equal(next.guide.completion.ready,false);assert.equal(f.workPack.response.answers.signature,undefined);}
  }
});
test("resolved governed dependencies unlock their ordinary questions without bypassing required source resolution",async()=>{
  const f=governedStepsFixture();f.workPack.definition.schema.sections[0].prompts=[prompt("measured_value","number",{dependencyKeys:["products"]})];f.workPack.completion.visiblePromptKeys=["measured_value"];
  assert.equal((await loadWattzunFormContext(request,access,f.ref,f.deps)).facts.questions[0].canDraft,false);
  f.workPack.response.dependencyResolutions.products={status:"resolved",reference:"actual-product"};assert.equal((await loadWattzunFormContext(request,access,f.ref,f.deps)).facts.questions[0].canDraft,true);
});
test("hangup during final canonical reads prevents ordinary, completion and governed scenario mutations",async()=>{
  for(const kind of ["ordinary","completion","step"]){
    const f=kind==="completion"?completedFixture("job_form"):kind==="step"?governedStepsFixture():fixture("job_form"),controller=new AbortController();
    if(kind==="step")f.workPack.definition.schema.dependencies=[{kind:"scenario",dependencyKey:"scenario",label:"Scenario",required:true,scenarioCodes:["approved"]}];
    const prepared=kind==="ordinary"?await prepareWattzunForm(request,access,proposal("job_form"),f.deps):kind==="completion"?await prepareWattzunFormCompletion(request,access,{kind:"complete_form",jobQuery:"",jobId:"job-one",formKind:"job_form",formId:"form-one"},f.deps):await prepareWattzunFormStep(request,access,stepProposal("work_pack",{kind:"scenario",dependencyKey:"scenario",scenarioCode:"approved"}),f.deps);
    const method=kind==="step"?"loadPack":"getJobForms",original=f.deps[method];f.deps[method]=async(...args)=>{const result=await original(...args);controller.abort();return result;};
    const callRequest=new Request(request,{signal:controller.signal});const execute=kind==="ordinary"?executeWattzunForm:kind==="completion"?executeWattzunFormCompletion:executeWattzunFormStep;
    await assert.rejects(execute(callRequest,access,prepared,requestId,f.deps),error=>error.name==="AbortError");assert.equal(f.calls.length,0);
  }
});
