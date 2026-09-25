import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readBoundedJsonRequest,BoundedJsonRequestError} from '../src/lib/bounded-json-request.ts';
function compile(path,dependencies){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{assert.ok(key in dependencies,key);return dependencies[key];},m,m.exports);return m.exports;}
class JobLifecycleError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
class ComplianceAccessError extends Error{}
const response=(body,status=200)=>Response.json(body,{status});
function fixture(){const state={origin:true,calls:[],accessFailure:null};const db={id:'db'},actor={uid:'trusted',organisationId:'org',role:'reviewer'};
 const operation=name=>async(...args)=>{state.calls.push({name,args});return {saved:name};};
 const shared=compile('../src/app/api/creditex/job-lifecycle/_shared.ts',{'@/lib/admin-server':{adminJson:response,mfaErrorResponse:()=>null},'@/lib/bounded-json-request':{readBoundedJsonRequest,BoundedJsonRequestError},'@/lib/compliance-access-server':{ComplianceAccessError},'@/lib/creditex-job-lifecycle-server':{JobLifecycleError,loadJobLifecycle:operation('load'),mutateJobLifecycle:operation('mutate'),loadTradeJobReview:operation('loadReview'),reviewTradeJob:operation('review'),dispatchJobCorrectionEmail:operation('retry')}});
 const common={'@/lib/admin-server':{adminJson:response,sameOrigin:()=>state.origin},'@/app/api/creditex/job-lifecycle/_shared':shared};
 const creditex=compile('../src/app/api/creditex/job-lifecycle/route.ts',{'../../../../../db':{getD1:()=>db},'@/lib/admin-server':common['@/lib/admin-server'],'@/lib/compliance-access-server':{requireComplianceAccess:async(_r,options,d)=>{state.calls.push({name:'auth',options,db:d});if(state.accessFailure)throw state.accessFailure;return actor;}},'./_shared':shared});
 const trade=compile('../src/app/api/trade-job-review/route.ts',{'../../../../db':{getD1:()=>db},...common,'@/lib/trade-team-server':{requireInstallerTeamAccess:async()=>({actorUid:'manager',ownerUid:'business',canManageJobs:true})}});
 return{state,db,actor,shared,creditex,trade};}
const request=(body)=>new Request('https://example.test/api/creditex/job-lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('Creditex lifecycle derives organisation and reviewer from authentication',async()=>{const f=fixture();const r=await f.creditex.POST(request({intentId:'intent',action:'deleted',organisationId:'attacker',role:'admin'}));assert.equal(r.status,200);const call=f.state.calls.find(c=>c.name==='mutate');assert.deepEqual(call.args[1],{kind:'compliance',uid:'trusted',organisationId:'org',role:'reviewer'});assert.equal(f.state.calls[0].db,f.db);});
test('origin failure prevents authentication and mutation; bounded JSON prevents oversized actions',async()=>{const f=fixture();f.state.origin=false;assert.equal((await f.creditex.POST(request({}))).status,403);assert.equal(f.state.calls.length,0);f.state.origin=true;assert.equal((await f.creditex.POST(request({note:'a'.repeat(17000)}))).status,413);assert.equal(f.state.calls.some(c=>c.name==='mutate'),false);});
test('trade whole-job review and email retry retain trusted owner access',async()=>{const f=fixture();assert.equal((await f.trade.POST(request({workOrderId:'job',action:'reviewed',ownerUid:'attacker'}))).status,200);const call=f.state.calls.find(c=>c.name==='review');assert.equal(call.args[1].access.ownerUid,'business');assert.equal(call.args[1].uid,'manager');assert.equal((await f.trade.POST(request({workOrderId:'job',action:'retry_notification',deliveryId:'delivery'}))).status,200);assert.equal(f.state.calls.find(c=>c.name==='retry').args[2],'delivery');});
test('known lifecycle errors retain conflict status; non-object input cannot mutate',async()=>{const f=fixture();assert.equal(f.shared.lifecycleError(new JobLifecycleError('CHANGED','Refresh',409)).status,409);assert.equal((await f.creditex.POST(request([]))).status,400);assert.equal(f.state.calls.some(c=>c.name==='mutate'),false);});

test('admin Jobs detail resolves certificate activities within the active organisation, including Bin jobs',async()=>{
 const sqlite=new DatabaseSync(':memory:');try{sqlite.exec(`CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,partner_type TEXT,record_status TEXT);
 CREATE TABLE trade_work_order_compliance_intents(id TEXT,work_order_id TEXT,installer_uid TEXT,compliance_organisation_id TEXT,activity_template_id TEXT,status TEXT,intent_snapshot TEXT);
 INSERT INTO trade_work_orders VALUES('job','business','installer','archived');
 INSERT INTO trade_work_order_compliance_intents VALUES('allowed','job','business','trusted-org','activity','planned','{"activity":{"title":"Heat pump"}}');
 INSERT INTO trade_work_order_compliance_intents VALUES('other-org','job','business','untrusted-org','activity','planned','{}');
 INSERT INTO trade_work_order_compliance_intents VALUES('wrong-owner','job','elsewhere','trusted-org','activity','planned','{}');`);
 const db={prepare(sql){return{bind(...values){return{async all(){return{results:sqlite.prepare(sql).all(...values)};}};}};}};
 const route=compile('../src/app/api/admin/compliance-job-lifecycle/route.ts',{'../../../../../db':{getD1:()=>db},'@/lib/admin-server':{adminJson:response,sameOrigin:()=>true,adminError:()=>response({},403),requireAdminIdentity:async()=>({uid:'admin',role:'owner'})},'@/lib/creditex-official-source-custody-server':{resolveActiveCreditexOfficialSourceOrganisation:async()=> 'trusted-org'},'@/app/api/creditex/job-lifecycle/_shared':{handleLifecycleRequest(){throw new Error('Unexpected mutation');},lifecycleError:e=>{throw e;}}});
 const result=await route.GET(new Request('https://example.test/api/admin/compliance-job-lifecycle?workOrderId=job&organisationId=untrusted-org'));
 assert.equal(result.status,200);assert.deepEqual((await result.json()).activities,[{intentId:'allowed',label:'Heat pump'}]);
 }finally{sqlite.close();}
});
