import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-request-body.mjs';
const source=fs.readFileSync(new URL('../src/app/api/trade-team-calls/route.ts',import.meta.url),'utf8');
function fixture({denied=false,configured=true,revokeAfterProvider=false,deferStart=false,startFails=false,deferPush=false,operationError=''}={}){
 const events=[],background=[],diagnostics=[];let persisted=false,releaseStart,releasePush;class AccessError extends Error{status=403;}
 const server={};for(const name of ['incomingTeamCalls','joinTeamCall','leaveTeamCall','reserveTeamCallIce','sendTeamCallSignal','startTeamCall','teamCallStatus','assertTeamCallJoined'])server[name]=async()=>{events.push(name);if(operationError)throw new Error(operationError);if(denied)throw new Error('CALL_ACCESS_REQUIRED');if(name==='assertTeamCallJoined'&&revokeAfterProvider)throw new Error('CALL_ACCESS_REQUIRED');if(name==='startTeamCall'){if(deferStart)await new Promise(resolve=>{releaseStart=resolve;});if(startFails)throw new Error('CALL_RATE_LIMIT');persisted=true;events.push('persisted');}return name==='reserveTeamCallIce'?{ttl:300,expiresAt:'2099-01-01'}:name==='incomingTeamCalls'?[]:name==='teamCallStatus'?{call:null,signals:[]}:{id:'call-1234',threadId:'thread-1234'};};
 const dependencies={'@/lib/admin-server':{sameOrigin:request=>!request.headers.get('origin')||request.headers.get('origin')===new URL(request.url).origin,adminJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}}),mfaErrorResponse:()=>null},'@/lib/trade-access-server':{TradeAccessError:AccessError},'@/lib/trade-communications-access':{requireTeamCommunicationAccess:async request=>{events.push('access');if(!request.headers.get('authorization'))throw new Error('AUTH_REQUIRED');return{memberId:'member-0001'};}},
 'cloudflare:workers':{waitUntil:promise=>{events.push('waitUntil');background.push(promise);}},'@/lib/trade-push-server':{notifyTeamCall:async(actor,call)=>{assert.equal(persisted,true,'Call must persist before notification');assert.equal(actor.memberId,'member-0001');assert.deepEqual(call,{id:'call-1234',threadId:'thread-1234'});events.push('notifyTeamCall');if(deferPush)await new Promise(resolve=>{releasePush=resolve;});return {attempted:0,accepted:0,failed:1,skipped:true};}},
 '@/lib/bounded-request-body.mjs':bounded,'@/lib/trade-team-calls-server':server,'@/lib/trade-team-calls-provider':{teamCallTurnCredentials:()=>{events.push('credentials');if(!configured)throw new Error('CALL_UNAVAILABLE');return{accountSid:'server-only-sid',authToken:'server-only-token'};},teamCallIceServers:async()=>{events.push('provider');return[{urls:'turn:global.turn.twilio.com:3478',username:'ephemeral',credential:'temporary'}];}}};
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,record={exports:{}};
 new Function('require','module','exports','console',output)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},record,record.exports,{warn:(tag,fields)=>diagnostics.push({tag,...fields})});return{route:record.exports,events,background,diagnostics,releaseStart:()=>releaseStart(),releasePush:()=>releasePush()};
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

test('call notification starts only after persistence and remains background work even when delivery fails',async()=>{
 const f=fixture({deferStart:true,deferPush:true}),pending=f.route.POST(req({action:'start',threadId:'thread-1234'}));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['access','credentials','startTeamCall']);assert.equal(f.background.length,0);
 f.releaseStart();const response=await pending;assert.equal(response.status,200);assert.deepEqual(f.events,['access','credentials','startTeamCall','persisted','notifyTeamCall','waitUntil']);
 assert.equal((await response.json()).call.id,'call-1234');assert.equal(f.background.length,1);f.releasePush();await Promise.all(f.background);
});

test('denied, failed or unconfigured call starts never dispatch notifications',async()=>{
 for(const [options,status] of [[{denied:true},403],[{startFails:true},429],[{configured:false},503]]){
  const f=fixture(options);assert.equal((await f.route.POST(req({action:'start'}))).status,status);assert.ok(!f.events.includes('notifyTeamCall'));assert.equal(f.background.length,0);
 }
});

test('busy and offline call failures are actionable and do not send invitations',async()=>{
 for(const [code,text]of [['CALL_RECIPIENT_UNAVAILABLE',/busy or offline/],['CALL_PRESENCE_UNAVAILABLE',/Switch to Online/]]){
  const f=fixture({operationError:code});const response=await f.route.POST(req({action:code==='CALL_PRESENCE_UNAVAILABLE'?'join':'start'}));
  assert.equal(response.status,409);const result=await response.json();assert.equal(result.code,code);assert.match(result.error,text);assert.equal(f.background.length,0);
 }
});

test('slow-call diagnostics show operation and stage without private payloads and clear when finished',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const f=fixture({deferStart:true});const pending=f.route.POST(req({action:'start',threadId:'private-thread',sessionId:'private-session',payload:'private-sdp'}));
 await new Promise(resolve=>setImmediate(resolve));context.mock.timers.tick(8000);
 assert.equal(f.diagnostics.length,1);assert.equal(f.diagnostics[0].action,'start');assert.equal(f.diagnostics[0].stage,'start');assert.equal(f.diagnostics[0].code,'CALL_SLOW');
 assert.doesNotMatch(JSON.stringify(f.diagnostics),/private|Bearer/);
 f.releaseStart();assert.equal((await pending).status,200);context.mock.timers.tick(9000);assert.equal(f.diagnostics.length,1);
});

test('unexpected errors and unrecognised actions cannot put arbitrary text in call logs',async()=>{
 let f=fixture({operationError:'private-provider-token'});await f.route.POST(req({action:'ice',callId:'private-call'}));
 assert.equal(f.diagnostics[0].code,'CALL_REQUEST_FAILED');assert.doesNotMatch(JSON.stringify(f.diagnostics),/private/);
 f=fixture();await f.route.POST(req({action:'private-action'}));assert.equal(f.diagnostics[0].action,'unknown');assert.doesNotMatch(JSON.stringify(f.diagnostics),/private/);
});
