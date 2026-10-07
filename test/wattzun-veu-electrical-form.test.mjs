import test from "node:test";
import assert from "node:assert/strict";
import { veuElectricalCompletion } from "../src/lib/veu-electrical-safety-form.ts";
import { activityHash, normaliseActivityAnswers } from "../src/lib/trade-activity-forms.ts";
import {electricalAnswers,electricalRecord,signElectricalFixture} from "./helpers/wattzun-veu-electrical-fixture.mjs";
import { loadWattzunFormGuideForTurn, prepareWattzunGuidedFormForTurn, prepareWattzunForm, executeWattzunForm, reconcileWattzunFormReceipt,
  prepareWattzunFormCompletion, executeWattzunFormCompletion, reconcileWattzunFormCompletionReceipt,
  executeWattzunGuidedPreparedForm, reconcileWattzunGuidedPreparedFormForTurn, WattzunFormError } from "../src/lib/wattzun-form-server.ts";
import { readWattzunFormGuideProgress } from "../src/lib/wattzun-form-guide.ts";
import { readWattzunWorkReference } from "../src/lib/wattzun-work-context.ts";
import { readWattzunFormSaved, readWattzunFormCaptureTarget } from "../src/lib/wattzun-form-client.ts";
import { isWattzunWorkflowProposal } from "../src/lib/wattzun-workflow.ts";

const reference={kind:"trade_form",formKind:"veu_electrical",recordId:"piesa-one",jobId:"job-one"};
const request=new Request("https://fixture.invalid/api/wattzun/voice",{headers:{Authorization:"Bearer synthetic"}});
const access={actorUid:"actor-one",scope:{portal:"trade",scopeId:"owner-one",label:"Synthetic business"},db:{}};
const guideInput={sessionId:"923ed4f9-c46b-4c0e-8a66-996c44671918",stage:"resume",authorization:"ordinary_form_answers",skippedFieldKeys:[]};
const proposal=(fieldKey,value)=>({kind:"fill_form",jobQuery:"",jobId:reference.jobId,formKind:reference.formKind,formId:reference.recordId,answers:[{fieldKey,value}]});
const completionProposal={kind:"complete_form",jobQuery:"",jobId:reference.jobId,formKind:reference.formKind,formId:reference.recordId};
const status=code=>error=>error instanceof WattzunFormError&&error.status===code;

function fixture(ready=false) {
  const record=electricalRecord(),team={actorUid:"actor-one",ownerUid:"owner-one",memberId:"member-one",isOwner:true,jobScope:"team",canViewFieldEvidence:true,canManageFieldEvidence:true};
  if(ready){record.answers=electricalAnswers(record.form);signElectricalFixture(record);assert.equal(veuElectricalCompletion(record).ready,true);}
  const receipts=new Map(),calls=[],state={failAfter:false};
  const commit=async(operation,id,base,answers,key)=>{
    assert.equal(id,record.id);assert.equal(base,record.revision);assert.match(key,/^wattzun-piesa-[a-f0-9]{64}$/);
    calls.push({operation,id,base,answers,key});
    if(operation==="save")record.answers=normaliseActivityAnswers(record.form,answers);else {record.status="complete";record.completedAt="2026-10-08T00:05:00.000Z";}
    record.revision++;const requestSha256=activityHash(operation==="save"?{operation,baseRevision:base,answers:record.answers}:{operation,baseRevision:base});
    receipts.set(key,{recordId:id,operation,baseRevision:base,resultRevision:record.revision,requestSha256,recordSha256:activityHash(record),actorUid:team.actorUid});
    if(state.failAfter)throw new Error("Lost canonical response after commit");return structuredClone(record);
  };
  const deps={team:async()=>team,job:async()=>({id:reference.jobId,stage:"scheduled",revision:2}),assessment:{load:async(current,id)=>{assert.equal(current,team);assert.equal(id,record.id);return structuredClone(record);},save:(team,id,base,answers,key)=>commit("save",id,base,answers,key),complete:(team,id,base,key)=>commit("complete",id,base,null,key),receipt:async(current,id,key,expected)=>{const receipt=receipts.get(key);if(!receipt)return null;assert.equal(id,receipt.recordId);assert.equal(expected.operation,receipt.operation);assert.equal(expected.baseRevision,receipt.baseRevision);assert.equal(expected.requestSha256,receipt.requestSha256);if(receipt.actorUid!==current.actorUid||record.revision!==receipt.resultRevision||activityHash(record)!==receipt.recordSha256)throw new WattzunFormError(409,"Native exact receipt changed");return structuredClone(receipt);}}};
  return {record,team,deps,calls,state,receipts};
}

test("PIESA has a separate scoped reference, workflow kind and native control identity",()=>{
  assert.deepEqual(readWattzunWorkReference(reference,"trade"),reference);assert.equal(readWattzunWorkReference(reference,"council"),null);
  assert.equal(isWattzunWorkflowProposal(proposal("inspection_date","2026-10-08")),true);
  const saved={portal:"trade",scopeId:"owner-one",formKind:"veu_electrical",formId:reference.recordId,jobId:reference.jobId};
  assert.deepEqual(readWattzunFormSaved(saved),saved);assert.deepEqual(readWattzunFormCaptureTarget({...saved,fieldKey:"initial_correct"}),{...saved,fieldKey:"initial_correct"});
  assert.equal(readWattzunFormCaptureTarget({...saved,fieldKey:"__proto__"}),null);
});
test("actual official questions guide one typed answer at a time without an ActivityRecord",async()=>{
  const f=fixture(),loaded=await loadWattzunFormGuideForTurn(request,access,reference,guideInput,f.team,f.deps);
  assert.equal(readWattzunFormGuideProgress(loaded.guide)?.reference.formKind,"veu_electrical");assert.equal(loaded.guide.next.fieldKey,"job_reference");
  const input={...guideInput,stage:"continue",sourceSha256:loaded.guide.sourceSha256,questionKey:loaded.guide.next.fieldKey};
  const prepared=await prepareWattzunGuidedFormForTurn(request,access,proposal("job_reference","SYNTHETIC-PIESA"),input,f.team,f.deps);
  const saved=await executeWattzunGuidedPreparedForm(request,access,{kind:"fill_form",prepared},reference,guideInput,"synthetic-request-one",f.deps);
  assert.equal(saved.receipt.status,"saved");assert.equal(saved.guide.next.fieldKey,"property_address");assert.equal(f.calls.length,1);
  assert.equal(readWattzunFormGuideProgress(saved.guide)?.revision,2);assert.equal(f.record.answers.job_reference,"SYNTHETIC-PIESA");
  const recovered=await reconcileWattzunGuidedPreparedFormForTurn(request,access,{kind:"fill_form",prepared},reference,guideInput,f.team,f.deps);
  assert.deepEqual(recovered.receipt,saved.receipt);assert.equal(f.calls.length,1);
});
test("initial attestation, declaration checkboxes, evidence and signature never become spoken answer saves",async()=>{
  const f=fixture();
  for(const key of ["initial_correct","owner_access","owner_assessment","owner_information","property_owner","life_support_record"]){
    await assert.rejects(prepareWattzunForm(request,access,proposal(key,true),f.deps),error=>error instanceof WattzunFormError&&[400,409].includes(error.status));
  }assert.equal(f.calls.length,0);
  f.record.answers=electricalAnswers(f.record.form);delete f.record.answers.initial_correct;
  let loaded=await loadWattzunFormGuideForTurn(request,access,reference,guideInput,f.team,f.deps);
  assert.equal(loaded.guide.next.kind,"manual");assert.equal(loaded.guide.next.fieldKey,"initial_correct");
});
test("lost answer receipt reuses the exact actor-bound native key and never writes twice",async()=>{
  const f=fixture(),prepared=await prepareWattzunForm(request,access,proposal("inspection_date","2026-10-08"),f.deps);f.state.failAfter=true;
  await assert.rejects(executeWattzunForm(request,access,prepared,"synthetic-request-one",f.deps),/Lost canonical response/);
  assert.equal(f.calls.length,1);assert.equal((await reconcileWattzunFormReceipt(request,access,prepared,f.deps)).status,"saved");
  assert.equal((await executeWattzunForm(request,access,prepared,"synthetic-request-one",f.deps)).status,"saved");assert.equal(f.calls.length,1);
  f.team.canManageFieldEvidence=false;await assert.rejects(reconcileWattzunFormReceipt(request,access,prepared,f.deps),status(403));
});
test("another actor's matching answer is not proof this assistant request saved",async()=>{
  const f=fixture(),prepared=await prepareWattzunForm(request,access,proposal("inspection_date","2026-10-08"),f.deps);
  f.record.answers.inspection_date="2026-10-08";f.record.revision++;
  await assert.rejects(reconcileWattzunFormReceipt(request,access,prepared,f.deps),status(409));assert.equal(f.calls.length,0);
});
test("changed selected job, native source or authority denies write",async()=>{
  for(const change of [f=>{f.record.workOrderId="another-job";},f=>{f.record.answers.inspection_date="2026-10-09";f.record.revision++;},f=>{f.team.canManageFieldEvidence=false;}]){
    const f=fixture(),prepared=await prepareWattzunForm(request,access,proposal("inspection_date","2026-10-08"),f.deps);change(f);
    await assert.rejects(executeWattzunForm(request,access,prepared,"synthetic-request-one",f.deps),error=>error instanceof WattzunFormError&&[403,409].includes(error.status));assert.equal(f.calls.length,0);
  }
});
test("complete PIESA requires native readiness and locks a standalone PDF record, with exact recovery",async()=>{
  const incomplete=fixture();await assert.rejects(prepareWattzunFormCompletion(request,access,completionProposal,incomplete.deps),status(409));
  const f=fixture(true),prepared=await prepareWattzunFormCompletion(request,access,completionProposal,f.deps);f.state.failAfter=true;
  await assert.rejects(executeWattzunFormCompletion(request,access,prepared,"synthetic-request-one",f.deps),/Lost canonical response/);
  const recovered=await reconcileWattzunFormCompletionReceipt(request,access,prepared,f.deps);
  assert.equal(recovered.kind,"complete_form");assert.equal(recovered.message,`${f.record.form.title} is complete.`);assert.doesNotMatch(recovered.message,/Creditex|claim/);assert.equal(f.calls.length,1);
  assert.equal((await executeWattzunFormCompletion(request,access,prepared,"synthetic-request-one",f.deps)).status,"submitted");assert.equal(f.calls.length,1);
  const loaded=await loadWattzunFormGuideForTurn(request,access,reference,guideInput,f.team,f.deps);assert.equal(loaded.guide.state,"complete");assert.equal(readWattzunFormGuideProgress(loaded.guide)?.completion.status,"complete");
});
