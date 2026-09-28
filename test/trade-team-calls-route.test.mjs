import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-request-body.mjs';
const source=fs.readFileSync(new URL('../src/app/api/trade-team-calls/route.ts',import.meta.url),'utf8');
function fixture({denied=false,configured=true,revokeAfterProvider=false}={}){
 const events=[];class AccessError extends Error{status=403;}
 const server={};for(const name of ['incomingTeamCalls','joinTeamCall','leaveTeamCall','reserveTeamCallIce','sendTeamCallSignal','startTeamCall','teamCallStatus','assertTeamCallJoined'])server[name]=async()=>{events.push(name);if(denied)throw new Error('CALL_ACCESS_REQUIRED');if(name==='assertTeamCallJoined'&&revokeAfterProvider)throw new Error('CALL_ACCESS_REQUIRED');return name==='reserveTeamCallIce'?{ttl:300,expiresAt:'2099-01-01'}:name==='incomingTeamCalls'?[]:name==='teamCallStatus'?{call:null,signals:[]}:{id:'call-1234'};};
 const dependencies={'@/lib/admin-server':{sameOrigin:request=>!request.headers.get('origin')||request.headers.get('origin')===new URL(request.url).origin,adminJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}}),mfaErrorResponse:()=>null},'@/lib/trade-access-server':{TradeAccessError:AccessError},'@/lib/trade-team-server':{requireInstallerTeamAccess:async request=>{events.push('access');if(!request.headers.get('authorization'))throw new Error('AUTH_REQUIRED');return{memberId:'member-0001'};}},'@/lib/bounded-request-body.mjs':bounded,'@/lib/trade-team-calls-server':server,'@/lib/trade-team-calls-provider':{teamCallTurnCredentials:()=>{events.push('credentials');if(!configured)throw new Error('CALL_UNAVAILABLE');return{accountSid:'server-only-sid',authToken:'server-only-token'};},teamCallIceServers:async()=>{events.push('provider');return[{urls:'turn:global.turn.twilio.com:3478',username:'ephemeral',credential:'temporary'}];}}};
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,record={exports:{}};
 new Function('require','module','exports',output)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},record,record.exports);return{route:record.exports,events};
}
const req=(body,headers={})=>new Request('https://tlink.test/api/trade-team-calls',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
test('route rejects foreign origins, missing auth, invalid actions and oversized actual bytes before operations',async()=>{
 let f=fixture();assert.equal((await f.route.POST(req({action:'start'},{origin:'https://foreign.test'}))).status,403);assert.deepEqual(f.events,[]);
 f=fixture();assert.equal((await f.route.POST(new Request('https://tlink.test/api/trade-team-calls',{method:'POST',body:'{}'}))).status,401);assert.deepEqual(f.events,['access']);
 for(const body of ['null','[]','invalid JSON','{"action":"unknown"}']){f=fixture();assert.equal((await f.route.POST(req(body))).status,400);assert.deepEqual(f.events,['access']);}
 f=fixture();assert.equal((await f.route.POST(req(JSON.stringify({action:'signal',payload:'é'.repeat(40000)})))).status,413);assert.deepEqual(f.events,['access']);
});
test('relay issuance always reserves authorised joined slot before provider and rechecks after provider',async()=>{
 let f=fixture({denied:true});assert.equal((await f.route.POST(req({action:'ice',callId:'call-1234',sessionId:'session-1234'}))).status,403);assert.ok(!f.events.includes('provider'));
 f=fixture();const response=await f.route.POST(req({action:'ice',callId:'call-1234',sessionId:'session-1234'}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(f.events,['access','credentials','reserveTeamCallIce','provider','assertTeamCallJoined']);assert.ok(!JSON.stringify(await response.json()).includes('server-only'));
 f=fixture({revokeAfterProvider:true});const revoked=await f.route.POST(req({action:'ice',callId:'call-1234',sessionId:'session-1234'}));assert.equal(revoked.status,403);assert.ok(!JSON.stringify(await revoked.json()).includes('ephemeral'));
});
test('unconfigured relay cannot create ringing calls and incoming list never returns provider credentials',async()=>{
 let f=fixture({configured:false});const response=await f.route.POST(req({action:'start'}));assert.equal(response.status,503);assert.equal((await response.json()).code,'CALL_UNAVAILABLE');assert.ok(!f.events.includes('startTeamCall'));
 f=fixture();const list=await f.route.GET(new Request('https://tlink.test/api/trade-team-calls?view=incoming',{headers:{Authorization:'Bearer synthetic'}}));assert.equal(list.status,200);assert.deepEqual(await list.json(),{ok:true,memberId:'member-0001',calls:[]});assert.deepEqual(f.events,['access','incomingTeamCalls']);
});
