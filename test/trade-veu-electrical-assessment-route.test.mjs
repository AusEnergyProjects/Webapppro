import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as form from '../src/lib/veu-electrical-safety-form.ts';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
function compile(path,imports={}){
  const code=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,exports={};
  Function('require','exports',code)(id=>{assert.ok(id in imports,`Unexpected import ${id}`);return imports[id];},exports);return exports;
}
const types=compile('../src/lib/veu-electrical-assessment.ts'),bounded=compile('../src/lib/bounded-json-request.ts');
function fixture(){
  let access={ownerUid:'owner',canViewFieldEvidence:true,canManageFieldEvidence:true},origin=true;const calls=[];
  const record={id:'assessment',workOrderId:'job',revision:2,status:'draft'};
  const service={};
  for(const name of ['attestPiesaInitial','completePiesaRecord','readPiesaRecord','savePiesaAnswers','signPiesaDeclaration','startPiesaRecord','uploadPiesaEvidence'])service[name]=async(...args)=>{calls.push({name,args});return record;};
  service.piesaPresentation=async(actor,value)=>{assert.equal(actor,access);return {...value,delivery:[]};};
  service.listPiesaRecords=async(...args)=>{calls.push({name:'listPiesaRecords',args});return[record];};
  service.retryPiesaDelivery=async(...args)=>{calls.push({name:'retryPiesaDelivery',args});return{...record,status:'complete',delivery:[{role:'customer',status:'blocked'}]};};
  service.readPiesaPdf=async(...args)=>{calls.push({name:'readPiesaPdf',args});return{bytes:new TextEncoder().encode('%PDF-private'),contentType:'application/pdf',fileName:'PIESA-1.pdf'};};
  service.readPiesaEvidence=service.readPiesaPdf;
  const route=compile('../src/app/api/trade-veu-electrical-assessments/route.ts',{
    '@/lib/admin-server':{adminJson:(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}}),sameOrigin:()=>origin,mfaErrorResponse:()=>null},
    '@/lib/trade-team-server':{async requireInstallerTeamAccess(){if(!access)throw new Error('AUTH_REQUIRED');return access;}},
    '@/lib/bounded-json-request':bounded,'@/lib/veu-electrical-assessment':types,'@/lib/veu-electrical-safety-form':form,'@/lib/trade-veu-electrical-assessment-server':service,
  });
  return{route,calls,service,access(value){access=value;},origin(value){origin=value;}};
}
const json=(body,method='POST')=>new Request('https://test.example/api/trade-veu-electrical-assessments',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('catalogue and job list require current evidence access and expose exact official source',async()=>{
  const h=fixture(),response=await h.route.GET(new Request('https://test.example/api?catalogue=1')),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.source.sha256,form.VEU_ELECTRICAL_SOURCE_SHA256);assert.equal(data.form.id,form.createVeuElectricalForm().id);assert.equal(h.calls.length,0);
  assert.deepEqual(data.signerFields,form.VEU_ELECTRICAL_SIGNER_FIELDS);
  const list=await(await h.route.GET(new Request('https://test.example/api?workOrderId=job'))).json();assert.equal(list.records.length,1);assert.equal(list.canManage,true);
  h.access({canViewFieldEvidence:false});assert.equal((await h.route.GET(new Request('https://test.example/api?catalogue=1'))).status,403);
});
test('cross-origin writes and read-only users cannot reach any mutation service',async()=>{
  const h=fixture();h.origin(false);assert.equal((await h.route.POST(json({action:'start',workOrderId:'job'}))).status,403);
  h.origin(true);h.access({canViewFieldEvidence:true,canManageFieldEvidence:false});assert.equal((await h.route.POST(json({action:'start',workOrderId:'job'}))).status,403);assert.equal(h.calls.length,0);
});
test('save binds exact record, revision, strict answers and request identity without inferred values',async()=>{
  const h=fixture(),body={recordId:'assessment',baseRevision:2,answers:{mains_identified:false},requestId:'request-1'};
  const response=await h.route.PATCH(json(body,'PATCH'));assert.equal(response.status,200);
  assert.equal(h.calls[0].name,'savePiesaAnswers');assert.deepEqual(h.calls[0].args.slice(1),['assessment',2,body.answers,'request-1']);
  assert.equal((await h.route.PATCH(json({...body,baseRevision:'2'},'PATCH'))).status,400);assert.equal(h.calls.length,1);
});
test('malformed or oversized JSON and unsupported actions never execute',async()=>{
  const h=fixture();assert.equal((await h.route.POST(json({action:'sign_for_me',recordId:'assessment'}))).status,400);
  assert.equal((await h.route.PATCH(json({recordId:'assessment',baseRevision:1,answers:{property_address:'x'.repeat(270000)}},'PATCH'))).status,413);
  const malformed=new Request('https://test.example/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal((await h.route.POST(malformed)).status,400);assert.equal(h.calls.length,0);
});
test('signature and initial attestation pass actual acceptance and snapshot to canonical service',async()=>{
  const h=fixture(),body={action:'sign',recordId:'assessment',baseRevision:2,declarationKey:'property_owner',signerName:'Sam Owner',strokes:[{points:[]}],scopeSha256:'a'.repeat(64),accepted:false,requestId:'sign-1'};
  assert.equal((await h.route.POST(json(body))).status,200);
  assert.equal(h.calls[0].args[3].accepted,false);assert.deepEqual(h.calls[0].args[3].strokes,body.strokes);
  await h.route.POST(json({action:'attest_initial',recordId:'assessment',baseRevision:2,scopeSha256:body.scopeSha256,accepted:true,requestId:'attest-1'}));
  assert.deepEqual(h.calls[1].args.slice(1),['assessment',2,body.scopeSha256,true,'attest-1']);
});
test('private final PDF preserves exact bytes and safe headers, record access errors are returned honestly',async()=>{
  const h=fixture(),response=await h.route.GET(new Request('https://test.example/api?recordId=assessment&view=pdf'));
  assert.equal(await response.text(),'%PDF-private');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  h.service.readPiesaRecord=async()=>{throw new types.PiesaError(404,'PIESA_NOT_FOUND','Not in this business.');};
  assert.equal((await h.route.GET(new Request('https://test.example/api?recordId=foreign'))).status,404);
});
test('canonical signature rejection is a correctable validation result and recipient blocks preserve completion',async()=>{
  const h=fixture();h.service.signPiesaDeclaration=async()=>{throw new Error('ACTIVITY_SIGNATURE_REQUIRED');};
  assert.equal((await h.route.POST(json({action:'sign',recordId:'assessment',baseRevision:2,declarationKey:'property_owner',signerName:'Sam',scopeSha256:'a'.repeat(64),strokes:[],accepted:true}))).status,400);
  const response=await h.route.POST(json({action:'retry_delivery',recordId:'assessment'})),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.record.status,'complete');assert.equal(data.record.delivery[0].status,'blocked');
});
test('multipart evidence binds the selected native field and rejects excess bytes before parsing',async()=>{
  const h=fixture(),data=new FormData();data.set('action','upload');data.set('recordId','assessment');data.set('baseRevision','2');data.set('fieldKey','life_support_record');data.set('file',new File(['%PDF-test'],'consent.pdf',{type:'application/pdf'}));data.set('requestId','upload-1');
  const response=await h.route.POST(new Request('https://test.example/api',{method:'POST',body:data}));assert.equal(response.status,200);assert.equal(h.calls[0].name,'uploadPiesaEvidence');assert.equal(h.calls[0].args[3],'life_support_record');assert.equal(h.calls[0].args[5],'upload-1');
  const oversized=new Request('https://test.example/api',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=synthetic'},body:new Uint8Array(8*1024*1024+65537)});
  assert.equal((await h.route.POST(oversized)).status,413);assert.equal(h.calls.length,1);
});
