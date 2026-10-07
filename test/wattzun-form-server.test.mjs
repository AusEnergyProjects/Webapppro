import test from "node:test";
import assert from "node:assert/strict";
import { prepareWattzunForm, executeWattzunForm, reconcileWattzunFormReceipt, loadWattzunFormContext, verifyWattzunFormAccess, isWattzunFormPrepared, WattzunFormError } from "../src/lib/wattzun-form-server.ts";
import { workContextGateway } from "./helpers/wattzun-work-context-fixture.mjs";

const request=new Request("https://fixture.invalid/api/wattzun/workflow",{headers:{Authorization:"Bearer synthetic",Origin:"https://fixture.invalid"}});
const access={actorUid:"actor-one",scope:{portal:"trade",scopeId:"owner-one",label:"Synthetic business"},db:{prepare(){throw new Error("Assistant must not mutate storage directly");}}};
const requestId="synthetic-request-one";
const reference=formKind=>({kind:"trade_form",formKind,recordId:formKind==="work_pack"?"pack-one":"form-one",jobId:"job-one"});
const proposal=(formKind,fieldKey="notes",value="Observed seal needs replacement")=>({kind:"fill_form",jobQuery:"",jobId:"job-one",formKind,formId:reference(formKind).recordId,answers:[{fieldKey,value}]});
const formError=status=>error=>error instanceof WattzunFormError&&error.status===status;
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
