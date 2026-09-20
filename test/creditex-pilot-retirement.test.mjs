import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/app/api/creditex/pilot/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function route(role='admin',signedIn=true) {
  let verified=0;
  class ComplianceAccessError extends Error {constructor(code,status,message){super(message);this.code=code;this.status=status;}}
  const database={prepare(){throw Error('Retired endpoint must never access pilot records');},batch(){throw Error('Retired endpoint must never mutate pilot records');}};
  const exports={}; const require=id=>id.endsWith('/db')?{getD1:()=>database}:id.endsWith('firebase-server')?{requireFirebaseIdentity:async()=>{verified++;if(!signedIn)throw Error('AUTH_REQUIRED');return{uid:'test-user'};}}:id.endsWith('compliance-access-server')?{ComplianceAccessError,requireComplianceIdentity:async(identity,options)=>{if(!options.allowedRoles.includes(role))throw new ComplianceAccessError('ROLE_FORBIDDEN',403,'Role not allowed');return{...identity,role};}}:{};
  Function('require','exports',compiled)(require,exports);
  return {...exports,get verified(){return verified;}};
}
const request=(method,origin='https://test.invalid')=>new Request('https://test.invalid/api/creditex/pilot',{method,headers:{Origin:origin},...(method==='POST'?{body:JSON.stringify({action:'start',confirmation:'START SYNTHETIC VEU PILOT'})}:{})});

test('retired pilot refuses cross-origin requests before authentication',async()=>{
  const r=route();for(const method of ['GET','POST'])assert.equal((await r[method](request(method,'https://other.invalid'))).status,403);assert.equal(r.verified,0);
});
test('retired pilot keeps sign-in and administrator creation gates',async()=>{
  for(const method of ['GET','POST'])assert.equal((await route('admin',false)[method](request(method))).status,401);
  for(const role of ['reviewer','case_manager','auditor'])assert.equal((await route(role).POST(request('POST'))).status,403);
});
test('authorised historical access reports retirement privately without reading records',async()=>{
  for(const role of ['admin','case_manager','reviewer','auditor']){
    const response=await route(role).GET(request('GET'));assert.equal(response.status,410);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(await response.json(),{ok:false,code:'CREDITEX_PILOT_RETIRED',error:'The test pilot has been retired. Use the Creditex Jobs workspace.'});
  }
});
test('even an authenticated administrator cannot create another pilot',async()=>{
  const response=await route().POST(request('POST'));assert.equal(response.status,410);assert.equal((await response.json()).code,'CREDITEX_PILOT_RETIRED');
});
