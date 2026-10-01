import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as push from '../src/lib/trade-push.ts';
import * as policy from '../src/lib/trade-mobile-device-list-policy.mjs';
import * as diagnostics from '../src/lib/trade-native-call-diagnostics.ts';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const javascript=ts.transpileModule(read('../src/app/api/trade-team/devices/route.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const appleToken='ab'.repeat(32),voipToken='cd'.repeat(32);
const input={deviceId:'device-12345',platform:'ios',appVersion:'1.0.2',pushProvider:'apns',pushToken:appleToken,voipPushToken:voipToken,nativeCallCapable:true};
function fixture(){
 const database=new DatabaseSync(':memory:');
 database.exec(read('../drizzle/0027_handy_the_anarchist.sql').split('CREATE TABLE `trade_mobile_push_outbox`')[0]);
 database.exec("ALTER TABLE trade_mobile_devices ADD COLUMN voip_push_token TEXT NOT NULL DEFAULT ''; ALTER TABLE trade_mobile_devices ADD COLUMN native_call_capable INTEGER NOT NULL DEFAULT 0; CREATE TABLE trade_mobile_push_outbox(owner_uid TEXT,status TEXT); CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,display_name TEXT,email TEXT,status TEXT);");
 const state={beforeRun:()=>{},onLog:()=>{},accessError:null,originAccepted:true};
 const logs=[];
 const statement=(sql,values=[])=>({bind:(...values)=>statement(sql,values),first:async()=>database.prepare(sql).get(...values)||null,all:async()=>({results:database.prepare(sql).all(...values)}),run:async()=>{state.beforeRun(sql);return {meta:{changes:Number(database.prepare(sql).run(...values).changes)}};}});
 const dependencies={
  '../../../../../db':{getD1:()=>({prepare:statement})},'@/lib/trade-push':push,'@/lib/trade-mobile-device-list-policy.mjs':policy,
  '@/lib/trade-native-call-diagnostics':diagnostics,
  '@/lib/admin-server':{mfaErrorResponse:()=>null,adminJson:(body,status=200)=>Response.json(body,{status}),cleanAdminText:(value,length)=>typeof value==='string'?value.trim().slice(0,length):'',sameOrigin:()=>state.originAccepted},
  '@/lib/trade-team-server':{canManageTeam:()=>false,requireInstallerTeamAccess:async()=>{if(state.accessError)throw state.accessError;return {ownerUid:'owner',actorUid:'actor',memberId:'member',isOwner:false};}},
  '@/lib/trade-mobile-server':{appVersionAccepted:()=>true,mobileAppPolicy:()=>({}),MOBILE_CLIENT_ID_PATTERN:/^[A-Za-z0-9-]{8,120}$/,MOBILE_PLATFORMS:new Set(['ios','android']),mobileErrorResponse:()=>null},
  '@/lib/trade-mobile-device-revocation':{abortDeviceUploads:async()=>{}},
 };
 const loadedModule={exports:{}};new Function('require','module','exports','console',javascript)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},loadedModule,loadedModule.exports,{info:(...args)=>{state.onLog();logs.push(args);}});
 const request=(body=input,method='POST')=>new Request('https://tlink.test/api/trade-team/devices',{method,body:JSON.stringify(body)});
 return {database,state,logs,route:loadedModule.exports,request};
}

test('trade device registration persists distinct Apple tokens and never returns their values',async()=>{
 const f=fixture();try{
  const response=await f.route.POST(f.request());assert.equal(response.status,201);
  const row=f.database.prepare('SELECT * FROM trade_mobile_devices').get();
  assert.equal(row.push_token,appleToken);assert.equal(row.voip_push_token,voipToken);assert.equal(row.native_call_capable,1);
  const publicBody=await response.text();assert.ok(!publicBody.includes(appleToken));assert.ok(!publicBody.includes(voipToken));
  const invalid=await f.route.POST(f.request({...input,pushProvider:'fcm'}));assert.equal(invalid.status,400);
  assert.equal(f.database.prepare('SELECT push_token FROM trade_mobile_devices').get().push_token,appleToken);
  assert.equal((await f.route.POST(f.request({...input,pushToken:'',voipPushToken:'',nativeCallCapable:false}))).status,201);
  assert.deepEqual({...f.database.prepare('SELECT push_token,voip_push_token,native_call_capable FROM trade_mobile_devices').get()},{push_token:'',voip_push_token:'',native_call_capable:0});
 }finally{f.database.close();}
});

test('concurrent revocation cannot be undone by a stale device registration',async()=>{
 const f=fixture();try{
  assert.equal((await f.route.POST(f.request())).status,201);
  f.state.beforeRun=sql=>{if(sql.startsWith('INSERT INTO trade_mobile_devices')){
   f.state.beforeRun=()=>{};f.database.exec("UPDATE trade_mobile_devices SET status='revoked',push_token='',voip_push_token='',native_call_capable=0");
  }};
  const response=await f.route.POST(f.request());assert.equal(response.status,403);assert.equal((await response.json()).code,'DEVICE_REAUTHORISATION_REQUIRED');
  assert.deepEqual({...f.database.prepare('SELECT status,push_token,voip_push_token,native_call_capable FROM trade_mobile_devices').get()},{status:'revoked',push_token:'',voip_push_token:'',native_call_capable:0});
 }finally{f.database.close();}
});

const diagnosticEvent=()=>({timestamp:new Date().toISOString(),stage:'call_report_failed',localEnabled:true,appState:'background',managedCallCount:0,managedConnectedCount:0,systemCallCount:0,systemConnectedCount:0,errorDomain:'callkit_incoming',errorCode:3});

test('native diagnostic logs require a successful authorised iOS device write and contain only approved fields',async()=>{
 const f=fixture();try{
  const event=diagnosticEvent();
  f.state.onLog=()=>assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_mobile_devices').get().count,1);
  const response=await f.route.POST(f.request({...input,nativeCallDiagnostics:[{...event,callerName:'private-person',voipToken:'private-token'}]}));
  assert.equal(response.status,201);
  assert.deepEqual(f.logs,[['tlink_native_call_diagnostics',{appVersion:input.appVersion,events:[event]}]]);
  assert.doesNotMatch(JSON.stringify(f.logs),/private|owner|actor|member|device-12345/);
  assert.equal((await f.route.POST(f.request({...input,platform:'android',pushProvider:'fcm',pushToken:'',voipPushToken:'',nativeCallCapable:false,nativeCallDiagnostics:[event]}))).status,201);
  assert.equal(f.logs.length,1);
 }finally{f.database.close();}
});

test('malformed native diagnostics do not prevent an otherwise valid device registration',async()=>{
 const f=fixture();try{
  for(const nativeCallDiagnostics of [undefined,null,{},[{}],Array(13).fill(diagnosticEvent()),[{...diagnosticEvent(),errorDomain:'private-error'}]]){
   assert.equal((await f.route.POST(f.request({...input,nativeCallDiagnostics}))).status,201);
  }
  assert.deepEqual(f.logs,[]);
 }finally{f.database.close();}
});

test('origin, team access, ownership and concurrent revocation failures cannot emit native diagnostic logs',async()=>{
 for(const failure of ['origin','access','ownership','revocation','save']){
  const f=fixture();try{
   const body={...input,nativeCallDiagnostics:[diagnosticEvent()]};
   if(failure==='origin')f.state.originAccepted=false;
   if(failure==='access')f.state.accessError=new Error('TEAM_ACCESS_REQUIRED');
   if(failure==='ownership'){
    assert.equal((await f.route.POST(f.request())).status,201);
    f.database.exec("UPDATE trade_mobile_devices SET actor_uid='another-actor'");
   }
   if(failure==='revocation'){
    assert.equal((await f.route.POST(f.request())).status,201);
    f.state.beforeRun=sql=>{if(sql.startsWith('INSERT INTO trade_mobile_devices'))f.database.exec("UPDATE trade_mobile_devices SET status='revoked'");};
   }
   if(failure==='save')f.state.beforeRun=()=>{throw new Error('write failed');};
   assert.equal((await f.route.POST(f.request(body))).status,failure==='save'?500:403,failure);
   assert.deepEqual(f.logs,[],failure);
  }finally{f.database.close();}
 }
});
