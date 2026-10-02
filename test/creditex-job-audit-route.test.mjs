import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-json-request.ts';
class AuditError extends Error { constructor(code,message,status=409){super(message);this.code=code;this.status=status;} }
class AccessError extends AuditError {}
function load(path,dependencies){const exportedModule={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{assert.ok(key in dependencies,key);return dependencies[key];},exportedModule,exportedModule.exports);return exportedModule.exports;}
function fixture(){
  const db={},events=[];let denied=false;
  const helper=load('../src/lib/creditex-job-audit-route-server.ts',{
    './admin-server':{sameOrigin:request=>!request.headers.get('origin')||request.headers.get('origin')===new URL(request.url).origin,
      mfaErrorResponse:error=>error.message==='MFA_REQUIRED'?Response.json({ok:false,code:'MFA_REQUIRED'},{status:403}):null,
      adminError:error=>Response.json({ok:false,code:error.message},{status:403}),
      requireAdminIdentity:async(request,roles)=>{events.push(['admin',roles]);if(denied)throw new Error('MFA_REQUIRED');return {uid:'platform',adminId:'admin-id',displayName:'Admin',role:'reviewer'};}},
    './compliance-access-server':{ComplianceAccessError:AccessError,requireComplianceAccess:async(request,options)=>{events.push(['compliance',options.allowedRoles]);if(denied)throw new AccessError('COMPLIANCE_SUSPENDED','Suspended',403);return {uid:'member',membershipId:'member-id',displayName:'Member',role:'reviewer',organisationCode:'creditex',organisationId:'org'};}},
    './creditex-official-source-custody-server':{resolveActiveCreditexOfficialSourceOrganisation:async()=> 'org'},
    './trade-compliance-intent':{CREDITEX_PARTNER_ORGANISATION_CODE:'creditex'},
    './bounded-json-request':bounded,'./creditex-job-lifecycle-server':{JobLifecycleError:AccessError},'./creditex-job-audit-server':{CreditexJobAuditError:AuditError},
  });
  const service={loadCreditexAuditDashboard:async(db,actor)=>({total:3,countsUnit:'activities',actor:actor.kind}),loadCreditexJobAudit:async(db,actor,intentId)=>{events.push(['load',actor.kind,intentId]);return {target:{intentId}};},saveCreditexJobAudit:async(db,actor,input)=>{events.push(['save',actor.kind,input]);return {checklist:{revision:1}};},readCreditexJobAuditFile:async(db,actor,input)=>{events.push(['file',actor.kind,input]);return {bytes:new Uint8Array([1,2]),contentType:'application/pdf',fileName:'test"\r\n.pdf'};}};
  const routes=load('../src/app/api/creditex/job-audit/route.ts',{'../../../../../db':{getD1:()=>db},'@/lib/bounded-json-request':bounded,'@/lib/creditex-job-audit-server':service,'@/lib/creditex-job-audit-route-server':helper});
  const files=load('../src/app/api/creditex/job-audit/file/route.ts',{'../../../../../../db':{getD1:()=>db},'@/lib/creditex-job-audit-server':service,'@/lib/creditex-job-audit-route-server':helper});
  return {routes,files,events,deny:()=>denied=true};
}
test('audit route uses authoritative actorMode query, checks roles and retains bounded private envelopes',async()=>{
  const f=fixture();let response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit?intentId=job&actorMode=admin'));
  assert.equal(response.status,200);assert.deepEqual(f.events[0],['admin',['owner','admin','reviewer']]);assert.equal(response.headers.get('cache-control'),'private, no-store');
  response=await f.routes.POST(new Request('https://example.test/api/creditex/job-audit',{method:'POST',body:JSON.stringify({actorMode:'admin',intentId:'job'})}));
  assert.equal(response.status,200);assert.equal(f.events.at(-1)[1],'compliance');
  response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit?actorMode=unknown'));assert.equal(response.status,400);
  const prior=f.events.length;response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit',{headers:{origin:'https://foreign.test'}}));assert.equal(response.status,403);assert.equal(f.events.length,prior);
  response=await f.routes.POST(new Request('https://example.test/api/creditex/job-audit',{method:'POST',body:JSON.stringify({note:'x'.repeat(33000)})}));assert.equal(response.status,413);
});
test('dashboard API is scoped and read failures preserve actionable MFA/access responses',async()=>{
  const f=fixture();let response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit?view=dashboard'));
  assert.deepEqual(await response.json(),{ok:true,dashboard:{total:3,countsUnit:'activities',actor:'compliance'}});
  f.deny();response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit?actorMode=admin&intentId=job'));assert.equal(response.status,403);assert.equal((await response.json()).code,'MFA_REQUIRED');
  response=await f.routes.GET(new Request('https://example.test/api/creditex/job-audit?intentId=job'));assert.equal(response.status,403);assert.equal((await response.json()).code,'COMPLIANCE_SUSPENDED');
});
test('private file route uses same actor gate and browser-safe inline headers',async()=>{
  const f=fixture(),response=await f.files.GET(new Request('https://example.test/api/creditex/job-audit/file?actorMode=admin&intentId=job&kind=field_pdf&id=file&parentId=field'));
  assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(response.headers.get('content-security-policy'),"sandbox; default-src 'none'");assert.doesNotMatch(response.headers.get('content-disposition'),/[\r\n]/);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2]);assert.equal(f.events.at(-1)[1],'admin');
});
