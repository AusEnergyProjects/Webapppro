import {createVeuElectricalForm} from '../../src/lib/veu-electrical-safety-form.ts';
import {activityHash,activitySigningScope} from '../../src/lib/trade-activity-forms.ts';
import {boundActivityDeclaration} from '../../src/lib/trade-activity-form-flow.ts';
export function electricalAnswers(form) {
  const no=new Set(["life_support","alternative_supply","non_tps_cables","split_metal_conduit","damaged_cables","recessed_luminaires","prohibited_luminaires","ceiling_appliances","ceiling_flues","other_hazards_present",...form.fields.filter(x=>x.key.startsWith("work_")).map(x=>x.key)]);
  const answers=Object.fromEntries(form.fields.filter(x=>!["photo","document"].includes(x.type)).map(field=>[field.key,field.type==="boolean"?!no.has(field.key):field.type==="date"?"2026-10-08":field.type==="number"?1:field.type==="select"?field.key==="assessment_outcome"?"no_rectification":"yes":"Synthetic assessment answer"]));
  Object.assign(answers,{job_reference:"SYNTHETIC-PIESA",property_address:"12 Synthetic Street, Melbourne VIC 3000",owner_name:"Synthetic Owner",initial_electrician_name:"Synthetic Electrician"});
  return answers;
}
export function electricalRecord() {
  const form=createVeuElectricalForm();
  return {id:"piesa-one",workOrderId:"job-one",ownerUid:"owner-one",recordNumber:"PIESA-SYNTHETIC",revision:1,status:"draft",form,formSha256:activityHash(form),answers:{},evidence:[],signatures:[],signerDefaults:{customer:"Synthetic Owner",technician:"Synthetic Electrician"},createdAt:"2026-10-08T00:00:00.000Z",updatedAt:"2026-10-08T00:00:00.000Z",completedAt:""};
}
export function signElectricalFixture(record) {
  record.initialAttestation={actorUid:"actor-one",confirmedAt:"2026-10-08T00:00:30.000Z",scopeSha256:activitySigningScope(record,"before")};
  const declaration=record.form.declarations.find(x=>x.key==="property_owner"),text=boundActivityDeclaration(declaration,record.answers);
  record.signatures=[{id:"signature-synthetic",declarationKey:declaration.key,role:declaration.role,phase:declaration.phase,signerName:record.answers.owner_name,declarationText:text,declarationSha256:activityHash(text),scopeSha256:activitySigningScope(record,"after"),signedAt:"2026-10-08T00:01:00.000Z",actorUid:"actor-one",strokes:[{points:Array.from({length:10},(_,i)=>({x:i/12,y:.4+i/30,capturedAtMs:i*25,pressure:.5}))}]}];
}
