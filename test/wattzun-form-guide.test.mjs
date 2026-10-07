import test from "node:test";
import assert from "node:assert/strict";
import {readWattzunFormGuideInput,readWattzunFormGuideControl,readWattzunFormGuideProgress,wattzunFormGuideNarration,WATTZUN_FORM_GUIDE_CONTROL_SCHEMA} from "../src/lib/wattzun-form-guide.ts";
import {readWattzunFormStep,readWattzunFormGuideStep,readWattzunFormProductSearchAction} from "../src/lib/wattzun-form-step.ts";

const input=()=>({sessionId:"550e8400-e29b-41d4-a716-446655440000",stage:"start",authorization:"ordinary_form_answers",skippedFieldKeys:[]});
const reference=()=>({kind:"trade_form",formKind:"work_pack",recordId:"pack-two",jobId:"job-one"});
const progress=()=>({sessionId:input().sessionId,reference:reference(),requestedReference:{...reference(),recordId:"pack-one"},recordId:"pack-two",revision:2,sourceSha256:"a".repeat(64),state:"question",
  next:{kind:"question",fieldKey:"units[first].serial",label:"Serial number",type:"text",options:[]},counts:{visible:3,answered:1,unanswered:2,evidenceMissing:1,manualMissing:0,skipped:0},skippedFieldKeys:[],completion:{ready:false,missing:["Serial number","Installation photo"],status:"in_progress"}});

test("guided input requires explicit bounded ordinary-answer authorization and complete source binding for continuation",()=>{
  assert.deepEqual(readWattzunFormGuideInput(input()),input());
  for(const bad of [{...input(),authorization:"all_actions"},{...input(),sessionId:"guessed"},{...input(),stage:"continue"},{...input(),stage:"continue",sourceSha256:"a".repeat(64)},
    {...input(),skippedFieldKeys:["same","same"]},{...input(),skippedFieldKeys:Array.from({length:101},(_,i)=>`q${i}`)},{...input(),skippedFieldKeys:["constructor"]},{...input(),ownerUid:"attacker"},{...input(),pendingRequestId:"short"}]) assert.equal(readWattzunFormGuideInput(bad),null);
  const continued={...input(),stage:"continue",sourceSha256:"a".repeat(64),questionKey:"",pendingRequestId:"synthetic-request-one"};assert.deepEqual(readWattzunFormGuideInput(continued),continued);
});
test("voice controls require the exact typed command shape and schema includes pause plus resume",()=>{
  for(const command of ["skip","repeat","pause","resume","complete"]){const value={kind:"form_guide_control",command,fieldKey:command==="skip"||command==="repeat"?"notes":""};assert.deepEqual(readWattzunFormGuideControl(value),value);assert.ok(WATTZUN_FORM_GUIDE_CONTROL_SCHEMA.properties.command.enum.includes(command));}
  for(const value of [{kind:"form_guide_control",command:"sign",fieldKey:""},{kind:"form_guide_control",command:"skip",fieldKey:""},{kind:"form_guide_control",command:"pause",fieldKey:"",signature:"fake"}])assert.equal(readWattzunFormGuideControl(value),null);
});
test("progress links latest immutable ID only to the same requested form kind and job",()=>{
  assert.ok(readWattzunFormGuideProgress(progress()));
  for(const value of [{...progress(),requestedReference:undefined},{...progress(),recordId:"another"},{...progress(),requestedReference:{...reference(),jobId:"foreign"}},
    {...progress(),requestedReference:{...reference(),formKind:"activity_form"}},{...progress(),reference:{...reference(),formKind:"job_form"},requestedReference:{...reference(),formKind:"job_form",recordId:"other"}}])assert.equal(readWattzunFormGuideProgress(value),null);
});
test("capture requires canonical metadata and is only offered for governed photos",()=>{
  const capture={minimumCount:1,maximumCount:3,savedCount:0,allowedContentTypes:["image/jpeg"],gpsRequired:true,captureTimeRequired:true,metadataRequired:true,originalRequired:true};
  const value={...progress(),state:"capture",next:{kind:"capture",fieldKey:"photo",label:"Installation photo",type:"photo",options:[],capture}};assert.ok(readWattzunFormGuideProgress(value));
  for(const bad of [{...value,next:{...value.next,capture:undefined}},{...value,next:{...value.next,type:"document"}},
    {...value,reference:{...reference(),formKind:"activity_form"},requestedReference:{...reference(),formKind:"activity_form"}},
    {...value,next:{...value.next,capture:{...capture,maximumCount:0}}}])assert.equal(readWattzunFormGuideProgress(bad),null);
});
test("state and counts must agree with the question and canonical completion receipt",()=>{
  for(const value of [{...progress(),state:"capture"},{...progress(),state:"paused"},{...progress(),state:"ready_to_complete",next:null},{...progress(),counts:{...progress().counts,answered:4}},
    {...progress(),counts:{...progress().counts,skipped:1}},{...progress(),state:"complete",next:null}])assert.equal(readWattzunFormGuideProgress(value),null);
  const receipt={kind:"complete_form",id:"pack-two",label:"Form completed",href:"/direct-trade/dashboard?workspace=work&jobId=job-one&jobTab=files",status:"submitted",message:"The form is complete."};
  const value={...progress(),state:"complete",next:null,completion:{ready:true,missing:[],status:"completed"},receipt};assert.ok(readWattzunFormGuideProgress(value));
  for(const bad of [{...value,receipt:{...receipt,kind:"fill_form"}},{...value,receipt:{...receipt,status:"saved"}},{...value,receipt:{...receipt,id:"foreign"}},{...value,receipt:{...receipt,href:"/direct-trade/dashboard?workspace=work&jobId=foreign&jobTab=files"}}])assert.equal(readWattzunFormGuideProgress(bad),null);
});
test("parsers return clean independent projections and do not retain injected nested properties",()=>{
  const value=progress();value.next.secret="UNTRUSTED";value.reference.instructions="UNTRUSTED";assert.equal(readWattzunFormGuideProgress(value),null,"Reference parser rejects extra identity fields");delete value.reference.instructions;
  value.counts.secret="UNTRUSTED";value.completion.instructions="UNTRUSTED";value.extra="UNTRUSTED";
  const parsed=readWattzunFormGuideProgress(value);assert.ok(parsed);assert.doesNotMatch(JSON.stringify(parsed),/UNTRUSTED/);value.next.options.push({value:"x",label:"X"});assert.equal(parsed.next.options.length,0);
});
test("narration asks one actual question and never claims incomplete records are complete",()=>{
  assert.equal(wattzunFormGuideNarration(progress()),"Serial number?");
  assert.match(wattzunFormGuideNarration({...progress(),state:"ready_to_complete",next:null}),/Would you like me to complete/);
  assert.match(wattzunFormGuideNarration({...progress(),state:"review",next:null}),/Before completion, Serial number/);
  assert.match(wattzunFormGuideNarration({...progress(),state:"paused",next:null}),/paused/);
});

test("source acknowledgement stays short while its multiline source text is retained and signatures use native controls",()=>{
  const step={kind:"reference_document",fieldKey:"document",sourceArtifactId:"artifact-one",sourceArtifactSha256:"sha256:"+"a".repeat(64),title:"Pinned safety instructions",text:"I have read this document.\nI understand the requirements.",mode:"viewed"};
  const value={...progress(),next:{kind:"question",fieldKey:step.fieldKey,label:"Short generic label",type:step.kind,options:[],step}};
  const parsed=readWattzunFormGuideProgress(value);assert.ok(parsed);assert.equal(parsed.next.step.text,step.text);
  const spoken=wattzunFormGuideNarration(parsed);assert.ok(!spoken.includes(step.text));assert.match(spoken,/personally read Pinned safety instructions/);assert.match(spoken,/reviewed its acknowledgement on screen/);
  assert.match(wattzunFormGuideNarration({...parsed,next:{...parsed.next,step:{...step,mode:"confirmed"}}}),/personally read and understood Pinned safety instructions/);
  assert.equal(readWattzunFormGuideStep({...step,text:step.text+"\u0000"}),null);
  assert.equal(readWattzunFormGuideStep({kind:"declaration",fieldKey:"consent",text:"Declaration"}),null);
  for(const type of ["signature","declaration"]){const guide={...progress(),state:"manual",next:{kind:"manual",fieldKey:"signed",label:"EXACT LONG LEGAL DECLARATION",type,options:[]}};
    const narration=wattzunFormGuideNarration(guide);assert.match(narration,/on screen/);assert.doesNotMatch(narration,/EXACT LONG LEGAL DECLARATION/);}
});
test("governed step parser accepts only exact typed operations, unique official selections and immutable source identifiers",()=>{
  const selection={kind:"official_product",dependencyKey:"installed-products",search:"Example X1",selections:[{selectionId:"product-one",snapshotId:"snapshot-one",quantity:2}]};
  assert.deepEqual(readWattzunFormStep(selection),selection);
  for(const bad of [{...selection,selections:[...selection.selections,...selection.selections]},{...selection,selections:[{...selection.selections[0],quantity:0}]},
    {...selection,selections:[{...selection.selections[0],quantity:1.5}]},{...selection,ownerUid:"foreign"},{kind:"declaration",fieldKey:"__proto__",acknowledged:true},
    {kind:"declaration",fieldKey:"consent",acknowledged:false},{kind:"signature",fieldKey:"signed",mark:"fake"}])assert.equal(readWattzunFormStep(bad),null);
  assert.equal(readWattzunFormProductSearchAction({kind:"search_form_products",dependencyKey:"products",search:"X1",save:true}),null);
  const parsed=readWattzunFormStep(selection);selection.selections[0].quantity=100;assert.equal(parsed.selections[0].quantity,2);
});
