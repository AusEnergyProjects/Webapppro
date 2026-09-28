import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-request-body.mjs';
import * as pure from '../src/lib/trade-push.ts';

const source=fs.readFileSync(new URL('../src/app/api/trade-push/route.ts',import.meta.url),'utf8');
function fixture({error='',authenticated=true}={}){
  const calls=[];
  class AccessError extends Error { status=403; }
  const subscription={id:'subscription-1',messages:true,calls:true,enabled:true};
  const server={};
  for(const name of ['tradePushSettings','subscribeTradePush','updateTradePush','unsubscribeTradePush'])server[name]=async(...args)=>{
    calls.push({name,args});if(error)throw new Error(error);
    return name==='tradePushSettings'?{configured:true,publicKey:'public-only',subscription}:subscription;
  };
  const deps={
    '@/lib/admin-server':{sameOrigin:request=>!request.headers.get('origin')||new URL(request.url).origin===request.headers.get('origin'),mfaErrorResponse:()=>null,adminJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})},
    '@/lib/trade-access-server':{TradeAccessError:AccessError},
    '@/lib/trade-communications-access':{requireTeamCommunicationAccess:async()=>{calls.push({name:'authenticate'});if(!authenticated)throw new Error('AUTH_REQUIRED');return {ownerUid:'owner',memberId:'member',actorUid:'actor'};}},
    '@/lib/bounded-request-body.mjs':bounded,'@/lib/trade-push':pure,'@/lib/trade-push-server':server,
  };
  const record={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},record,record.exports);
  return {route:record.exports,calls};
}
const request=(method='GET',body,headers={})=>new Request('https://tlink.test/api/trade-push?subscriptionId=subscription-1',{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});

test('push route rejects foreign origins and missing current team authentication for every operation',async()=>{
  for(const method of ['GET','POST','PATCH','DELETE']){
    let f=fixture();assert.equal((await f.route[method](request(method,method==='GET'?undefined:{},{origin:'https://foreign.test'}))).status,403);assert.deepEqual(f.calls,[]);
    f=fixture({authenticated:false});assert.equal((await f.route[method](request(method,method==='GET'?undefined:{}))).status,401);assert.deepEqual(f.calls,[{name:'authenticate'}]);
  }
});

test('push route refuses oversized bytes and malformed object bodies before any subscription mutation',async()=>{
  for(const method of ['POST','PATCH','DELETE']){
    for(const input of ['null','[]','no json','"string"']){
      const f=fixture();assert.equal((await f.route[method](request(method,input))).status,400);assert.equal(f.calls.length,1);
    }
    const f=fixture();assert.equal((await f.route[method](request(method,{data:'é'.repeat(3500)}))).status,413);assert.equal(f.calls.length,1);
  }
});

test('push config is no-store, only returns public registration state, and operations use the authenticated actor',async()=>{
  const f=fixture();const response=await f.route.GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{ok:true,configured:true,publicKey:'public-only',subscription:{id:'subscription-1',messages:true,calls:true,enabled:true}});
  const body={subscriptionId:'subscription-1',messages:false,calls:true,ownerUid:'forged',memberId:'foreign'};
  assert.equal((await f.route.PATCH(request('PATCH',body))).status,200);
  assert.equal(f.calls.at(-1).name,'updateTradePush');assert.deepEqual(f.calls.at(-1).args[0],{ownerUid:'owner',memberId:'member',actorUid:'actor'});
  assert.equal((await f.route.POST(request('POST',{subscription:{},messages:true,calls:true}))).status,200);assert.equal(f.calls.at(-1).name,'subscribeTradePush');
  assert.equal((await f.route.DELETE(request('DELETE',body))).status,200);assert.equal(f.calls.at(-1).name,'unsubscribeTradePush');assert.equal(f.calls.at(-1).args[1],'subscription-1');
});

test('push failures distinguish invalid input, revoked access, device conflict and missing configuration without leaking diagnostics',async()=>{
  for(const [error,status] of [['PUSH_INPUT_INVALID',400],['PUSH_ENDPOINT_INVALID',400],['PUSH_ACCESS_REQUIRED',403],['PUSH_DEVICE_CONFLICT',409],['PUSH_UNAVAILABLE',503],['database includes secret endpoint',503]]){
    const f=fixture({error}),response=await f.route.POST(request('POST',{}));assert.equal(response.status,status,error);
    assert.ok(!JSON.stringify(await response.json()).includes('secret endpoint'));
  }
});
