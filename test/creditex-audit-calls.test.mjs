import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as pure from "../src/lib/creditex-audit-calls.ts";
const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
function load(path,dependencies) {
  const output=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:path}).outputText;
  const record={exports:{}};
  new Function("require","module","exports",output)(name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error(`Unexpected dependency ${name}`);},record,record.exports);
  return record.exports;
}
const provider=load("../src/lib/creditex-audit-call-provider.ts",{"./creditex-audit-calls":pure});
const keys=generateKeyPairSync("ed25519");
const publicKey=keys.publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("base64");
const config={connectionId:"connection",organisationId:"org",apiKey:"private-provider-key",publicKey,credentialConnectionId:"100",callControlApplicationId:"200",outboundVoiceProfileId:"300",callerId:"+61280000000"};
const member={uid:"operator",membershipId:"member",organisationId:"org",organisationCode:"CREDITEX",role:"auditor",displayName:"Auditor"};
const target={caseId:"case",jobIntentId:"",workOrderId:"work",customerPhone:"+61412345678",canCall:true,unavailableReason:""};
const metadata=call=>({id:"recording-id",call_leg_id:call.customer_call_leg_id,call_session_id:call.customer_call_session_id,connection_id:"200",status:"completed",channels:"dual",source:"call",to:call.customer_phone,from:call.caller_id,
  recording_started_at:new Date(Date.parse(call.consented_at)+1).toISOString(),duration_millis:3000,download_urls:{mp3:`https://s3.amazonaws.com/telephony-recorder-prod/account/date/file.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=600&X-Amz-Signature=${"a".repeat(64)}`}});
function fixture(overrides={}) {
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE compliance_users(id TEXT,firebase_uid TEXT,organisation_id TEXT,status TEXT);
    INSERT INTO compliance_users VALUES('member','operator','org','active');
    CREATE TABLE compliance_audit_events(id TEXT PRIMARY KEY,organisation_id TEXT,actor_type TEXT,actor_uid TEXT,event_type TEXT,target_type TEXT,target_id TEXT,summary TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT,compliance_case_id TEXT,compliance_organisation_id TEXT,work_order_id TEXT);
  `);
  sqlite.exec(read("../drizzle/0183_creditex_audit_calls.sql").replaceAll("--> statement-breakpoint",""));
  sqlite.prepare(`INSERT INTO creditex_voice_connections(id,organisation_id,account_key_hash,account_label,encrypted_credentials,credential_connection_id,call_control_application_id,outbound_voice_profile_id,status,authorised_by_member_id,created_at,updated_at)
    VALUES('connection','org','hash','Creditex','encrypted','100','200','300','connected','member','now','now')`).run();
  sqlite.exec("UPDATE creditex_voice_connections SET default_number_id='number'; INSERT INTO creditex_voice_numbers VALUES('connection','number','+61280000000','Creditex',1)");
  const statement=(sql,values=[])=>({bind:(...args)=>statement(sql,args),first:async()=>sqlite.prepare(sql).get(...values)||null,all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}})});
  const db={prepare:statement,batch:async statements=>{sqlite.exec("BEGIN");try{const results=[];for(const item of statements)results.push(await item.run());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const objects=new Map(),requests=[];
  const bucket={put:async(key,bytes)=>{if(overrides.failStorage)throw new Error("storage down");objects.set(key,new Uint8Array(bytes));if(overrides.afterPut)await overrides.afterPut(sqlite);},get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}};
  const getCall=()=>sqlite.prepare("SELECT * FROM creditex_audit_calls ORDER BY created_at DESC LIMIT 1").get();
  const targetAuth={loadAuditCallTarget:async(_db,actor,input)=>{
    if(overrides.denied||actor.organisationId!=="org"||actor.uid!=="operator")throw new Error("ACCESS_DENIED");
    if(Boolean(input.caseId)===Boolean(input.jobIntentId))throw new Error("TARGET_INVALID");
    return {...target,...overrides.target};
  },assertStoredAuditCallTarget:async()=>{if(overrides.revoked)throw new Error("ACCESS_REVOKED");}};
  const fetchImpl=async(url,init={})=>{
    const value=String(url),body=init.body?JSON.parse(init.body):null;
    requests.push({url:value,body,init});
    assert.equal(init.redirect,"error");
    if(value.startsWith("https://s3.amazonaws.com/")){assert.equal(init.headers,undefined);return new Response(new Uint8Array([0x49,0x44,0x33,1,2,3]),{headers:{"Content-Type":"audio/mpeg"}});}
    assert.equal(init.headers.Authorization,`Bearer ${config.apiKey}`);
    if(overrides.request){const response=await overrides.request(value,init,body);if(response)return response;}
    if(value.endsWith("/telephony_credentials"))return Response.json({data:{id:"credential",resource_id:"connection:100",expires_at:body.expires_at}});
    if(value.endsWith("/telephony_credentials/credential/token"))return new Response("header.payload.signature");
    if(value.endsWith("/calls"))return Response.json({data:{call_control_id:"v3:customer",call_leg_id:"customer-leg",call_session_id:"session"}});
    if(value.includes("/actions/"))return Response.json({data:{result:"ok"}});
    if(value.includes("/recordings?"))return Response.json({data:[metadata(getCall())]});
    if(value.endsWith("/recordings/recording-id"))return Response.json({data:{...metadata(getCall()),...overrides.metadata}});
    throw new Error(`Unexpected request ${value}`);
  };
  const server=load("../src/lib/creditex-audit-call-server.ts",{"../../db":{getD1:()=>db},"./creditex-audit-call-target-server":targetAuth,
    "./creditex-custody-bucket":{getCreditexCustodyBucket:()=>bucket},"./creditex-official-source-custody-server":{sha256Hex:async bytes=>createHash("sha256").update(bytes).digest("hex")},
    "./creditex-voice-connection-server":{resolveAuditCallConfiguration:async()=>({configured:true,unavailableReason:"",configuration:config}),resolveStoredAuditCallConfiguration:async()=>config},
    "./creditex-audit-call-provider":provider,"./creditex-audit-calls":pure});
  const f={sqlite,db,bucket,objects,requests,server,options:{fetchImpl,bucket},getCall,overrides};
  f.prepare=()=>server.prepareAuditCall(db,member,overrides.target?.jobIntentId?{jobIntentId:overrides.target.jobIntentId}:{caseId:"case"},crypto.randomUUID(),f.options);
  f.event=async(type,payload,extra={})=>{
    const raw=JSON.stringify({data:{id:crypto.randomUUID(),event_type:type,occurred_at:new Date().toISOString(),payload}});
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=sign(null,Buffer.from(`${timestamp}|${raw}`),keys.privateKey).toString("base64");
    return server.receiveAuditCallWebhook(new Request(provider.AUDIT_CALL_CALLBACK_URL,{method:"POST",headers:{"telnyx-timestamp":timestamp,"telnyx-signature-ed25519":signature,...extra},body:raw}),db,f.options);
  };
  f.payload=stage=>({connection_id:"200",call_control_id:"v3:customer",call_leg_id:"customer-leg",call_session_id:"session",from:config.callerId,to:target.customerPhone,
    client_state:btoa(JSON.stringify({callId:getCall().id,stage}))});
  f.park=prepared=>f.event("call.initiated",{connection_id:"100",call_control_id:"v3:agent",call_leg_id:"agent-leg",call_session_id:"session",state:"parked",direction:"outgoing",to:"+19005551234",from:"+19999999999",custom_headers:prepared.customHeaders});
  f.notice=async()=>{await f.event("call.answered",f.payload("dial"));await f.event("call.speak.ended",{...f.payload("notice"),status:"completed"});};
  f.consent=()=>f.event("call.gather.ended",{...f.payload("gather"),digits:"1",status:"valid"});
  f.start=async()=>{const prepared=await f.prepare();await f.park(prepared);await f.notice();await f.consent();return prepared;};
  return f;
}
test("only Australian landline/mobile phone destinations normalize",()=>{
  assert.equal(pure.normalizeAuditCallPhone("(02) 8000 0000"),"+61280000000");assert.equal(pure.normalizeAuditCallPhone("0412 345 678"),"+61412345678");
  for(const value of ["1900123456","+19005551234","sip:attacker@example.com","1300123456"])assert.equal(pure.normalizeAuditCallPhone(value),"");
});
test("Ed25519 verifies raw bytes and rejects changed body, old timestamp and other key",async()=>{
  const raw='{"a":1}',time=String(Math.floor(Date.now()/1000)),sig=sign(null,Buffer.from(`${time}|${raw}`),keys.privateKey).toString("base64");
  assert.equal(await provider.verifyAuditCallSignature(raw,time,sig,publicKey),true);
  assert.equal(await provider.verifyAuditCallSignature(raw+" ",time,sig,publicKey),false);
  assert.equal(await provider.verifyAuditCallSignature(raw,time,sig,publicKey,Date.now()+301000),false);
  assert.equal(await provider.verifyAuditCallSignature(raw,time,sig,Buffer.alloc(32).toString("base64")),false);
});
test("atomic concurrent reservations make one credential and contain no secret in history",async()=>{
  const f=fixture();try{
    const results=await Promise.allSettled([f.prepare(),f.prepare()]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(f.requests.filter(r=>r.url.endsWith("/telephony_credentials")).length,1);
    const prepared=results.find(r=>r.status==="fulfilled").value;
    assert.equal(prepared.destinationNumber,config.callerId);assert.equal(prepared.customHeaders[0].value.length,64);
    assert.notEqual(f.getCall().intent_secret_hash,prepared.customHeaders[0].value);
    const history=await f.server.loadAuditCalls(f.db,member,{caseId:"case"});assert.equal(history.calls.length,1);
    assert.ok(!JSON.stringify(history).includes(prepared.customHeaders[0].value));assert.ok(!JSON.stringify(history).includes(config.apiKey));
  }finally{f.sqlite.close();}
});
test("disconnected setup cannot reserve even when previously resolved ready",async()=>{
  const f=fixture();try{f.sqlite.exec("UPDATE creditex_voice_connections SET status='disconnected'");await assert.rejects(f.prepare(),/already prepared/);assert.equal(f.requests.length,0);}finally{f.sqlite.close();}
});
test("signed parked request ignores arbitrary browser To/From and one intent dials once",async()=>{
  const f=fixture();try{const p=await f.prepare();await Promise.all([f.park(p),f.park(p)]);
    const dials=f.requests.filter(r=>r.url.endsWith("/calls"));assert.equal(dials.length,1);assert.equal(dials[0].body.to,target.customerPhone);assert.equal(dials[0].body.from,config.callerId);
    assert.equal(dials[0].body.bridge_on_answer,false);assert.equal(dials[0].body.record,undefined);assert.equal(dials[0].body.time_limit_secs,1800);
  }finally{f.sqlite.close();}
});
test("known call ID cannot replace missing, wrong or malformed rendezvous secret",async()=>{
  const f=fixture();try{const p=await f.prepare();
    for(const value of [undefined,"a".repeat(64),"bad"])await f.event("call.initiated",{connection_id:"100",call_control_id:"v3:attacker",call_leg_id:"attacker-leg",call_session_id:"session",state:"parked",direction:"outgoing",client_state:btoa(JSON.stringify({callId:p.callId,stage:"dial"})),custom_headers:value?[{name:"X-Creditex-Call-Intent",value}]:[]});
    assert.equal(f.getCall().status,"prepared");assert.equal(f.requests.filter(r=>r.url.endsWith("/calls")).length,0);
    assert.equal(f.requests.filter(r=>r.url.endsWith("/hangup")).length,3);
    await f.park(p);assert.equal(f.requests.filter(r=>r.url.endsWith("/calls")).length,1);
  }finally{f.sqlite.close();}
});
test("revoked assignment at parked callback cannot dial",async()=>{
  const f=fixture();try{const p=await f.prepare();f.overrides.revoked=true;await f.park(p);assert.equal(f.requests.filter(r=>r.url.endsWith("/calls")).length,0);assert.equal(f.getCall().status,"failed");}finally{f.sqlite.close();}
});
test("complete notice precedes gather; consent precedes dual recording and bridge",async()=>{
  const f=fixture();try{const p=await f.prepare();await f.park(p);await f.event("call.answered",f.payload("dial"));
    await f.consent();assert.equal(f.getCall().recording_status,"none");
    assert.equal(f.requests.filter(r=>r.url.endsWith("/actions/gather")).length,0);
    await f.event("call.speak.ended",{...f.payload("notice"),status:"completed"});await Promise.all([f.consent(),f.consent()]);
    const actions=f.requests.filter(r=>r.url.includes("/actions/")).map(r=>r.url.split("/").at(-1));assert.deepEqual(actions,["speak","gather","record_start","bridge"]);
    const record=f.requests.find(r=>r.url.endsWith("/record_start"));assert.equal(record.body.channels,"dual");assert.equal(record.body.transcription,false);assert.equal(f.getCall().status,"in_progress");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='audit_call.recording_consent'").get().n,1);
  }finally{f.sqlite.close();}
});
test("decline never creates a recording or bridge",async()=>{
  const f=fixture();try{const p=await f.prepare();await f.park(p);await f.notice();await f.event("call.gather.ended",{...f.payload("gather"),digits:"2",status:"valid"});
    assert.equal(f.getCall().status,"declined");assert.ok(!f.requests.some(r=>/record_start|\/bridge$/.test(r.url)));
  }finally{f.sqlite.close();}
});
test("unknown recording-start result ends both legs without bridge or retry creation",async()=>{
  const f=fixture({request:async url=>url.endsWith("/record_start")?new Response("timeout",{status:408}):null});try{await f.start();await f.consent();
    assert.equal(f.getCall().status,"failed");assert.equal(f.getCall().recording_status,"unknown");assert.equal(f.requests.filter(r=>r.url.endsWith("/record_start")).length,1);
    assert.equal(f.requests.filter(r=>r.url.endsWith("/bridge")).length,0);assert.equal(f.requests.filter(r=>r.url.endsWith("/hangup")).length,2);
  }finally{f.sqlite.close();}
});
test("consent callback checks current assignment again before any recording",async()=>{
  const f=fixture();try{const p=await f.prepare();await f.park(p);await f.notice();f.overrides.revoked=true;await f.consent();assert.equal(f.getCall().status,"failed");assert.ok(!f.requests.some(r=>r.url.endsWith("/record_start")));}finally{f.sqlite.close();}
});
test("private custody survives operator revocation and replay; playback remains authorised and audited",async()=>{
  const f=fixture();try{await f.start();await f.event("call.hangup",{...f.payload("recording"),hangup_cause:"normal_clearing"});f.overrides.revoked=true;
    await f.event("call.recording.saved",{...f.payload("recording"),public_recording_urls:{}});
    assert.equal(f.getCall().recording_status,"saved");assert.equal(f.objects.size,1);
    await f.event("call.recording.saved",{...f.payload("recording"),public_recording_urls:{}});assert.equal(f.objects.size,1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='audit_call.recording_saved'").get().n,1);
    const audio=await f.server.readAuditCallAudio(f.db,member,f.getCall().id,f.options);assert.equal(audio.bytes.length,6);
    f.overrides.denied=true;await assert.rejects(f.server.readAuditCallAudio(f.db,member,f.getCall().id,f.options),/ACCESS_DENIED/);
  }finally{f.sqlite.close();}
});
test("storage failure never labels saved; scheduled retry only transfers, never records",async()=>{
  const f=fixture({failStorage:true});try{await f.start();await f.event("call.recording.saved",{...f.payload("recording"),public_recording_urls:{}});assert.equal(f.getCall().recording_status,"failed");assert.equal(f.getCall().saved_at,"");
    f.overrides.failStorage=false;f.sqlite.exec("UPDATE creditex_audit_calls SET next_recording_attempt_at=''");const result=await f.server.processCreditexAuditCallRecordings(f.db,f.options);assert.equal(result.saved,1);
    assert.equal(f.requests.filter(r=>r.url.endsWith("/record_start")).length,1);
  }finally{f.sqlite.close();}
});
test("stale custody worker cannot write saved receipt or replace winning lease",async()=>{
  const f=fixture({afterPut:async sqlite=>sqlite.exec("UPDATE creditex_audit_calls SET recording_lease_token='new-worker'")});try{await f.start();await f.event("call.recording.saved",{...f.payload("recording"),public_recording_urls:{}});
    assert.equal(f.getCall().recording_lease_token,"new-worker");assert.equal(f.getCall().saved_at,"");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='audit_call.recording_saved'").get().n,0);
  }finally{f.sqlite.close();}
});
test("stale recording-start reservation is ended and reconciled without retrying creation",async()=>{
  const f=fixture();try{await f.start();f.sqlite.exec("UPDATE creditex_audit_calls SET recording_status='starting',updated_at='2020-01-01T00:00:00.000Z'");
    const result=await f.server.processCreditexAuditCallRecordings(f.db,f.options);assert.equal(result.saved,1);assert.equal(f.getCall().status,"expired");
    assert.equal(f.requests.filter(r=>r.url.endsWith("/record_start")).length,1);
  }finally{f.sqlite.close();}
});
test("daily atomic operator cap retains cancelled reservations",async()=>{
  const f=fixture();try{for(let i=0;i<20;i++){const prepared=await f.prepare();await f.server.cancelAuditCall(f.db,member,{caseId:"case"},prepared.callId,f.options);}
    await assert.rejects(f.prepare(),/daily limit/);assert.equal(f.requests.filter(r=>r.url.endsWith("/telephony_credentials")).length,20);
  }finally{f.sqlite.close();}
});
test("unknown dial outcome cannot be retried while unbound customer leg may still exist",async()=>{
  const f=fixture({request:async url=>url.endsWith("/calls")?new Response(null,{status:500}):null});try{const p=await f.prepare();await f.park(p);assert.equal(f.getCall().end_requested,1);await assert.rejects(f.prepare(),/already prepared/);
    f.overrides.request=undefined;await f.event("call.initiated",f.payload("dial"));assert.equal(f.getCall().customer_call_control_id,"v3:customer");assert.equal(f.getCall().end_requested,0);
    assert.equal(f.requests.filter(r=>r.url.endsWith("/calls")).length,1);
  }finally{f.sqlite.close();}
});
test("public media and mismatched recording ownership fail custody closed",async()=>{
  for(const change of [{metadata:{to:"+61400000000"}},{public:true}]){const f=fixture(change);try{await f.start();await f.event("call.recording.saved",{...f.payload("recording"),public_recording_urls:change.public?{mp3:"https://public.example/file.mp3"}:{}});assert.equal(f.getCall().recording_status,"failed");assert.equal(f.objects.size,0);}finally{f.sqlite.close();}}
});
test("media transport rejects arbitrary hosts and redirects without forwarding credentials",async()=>{
  for(const url of ["http://s3.amazonaws.com/telephony-recorder-prod/a?x=1","https://127.0.0.1/private?x=1","https://evil.amazonaws.com/file?x=1"])
    await assert.rejects(provider.downloadAuditRecording(url,async()=>{throw new Error("must not fetch");}),/URL_INVALID/);
  await assert.rejects(provider.downloadAuditRecording(metadata({consented_at:new Date().toISOString()}).download_urls.mp3,async(_url,init)=>{assert.equal(init.headers,undefined);return new Response(null,{status:302,headers:{Location:"https://attacker.example"}});}),/MEDIA_UNAVAILABLE/);
});
test("planned intent history remains visible from linked case without empty-target leakage",async()=>{
  const f=fixture({target:{caseId:"",jobIntentId:"intent"}});try{await f.prepare();f.sqlite.prepare("INSERT INTO trade_work_order_compliance_intents VALUES('intent','case','org','work')").run();
    f.overrides.target={caseId:"case",jobIntentId:""};assert.equal((await f.server.loadAuditCalls(f.db,member,{caseId:"case"})).calls.length,1);
    f.overrides.target={caseId:"another",jobIntentId:""};assert.equal((await f.server.loadAuditCalls(f.db,member,{caseId:"another"})).calls.length,0);
  }finally{f.sqlite.close();}
});
test("cancel ends active server legs; failed provider hangup blocks further calls",async()=>{
  const f=fixture();try{await f.start();f.overrides.request=async url=>url.endsWith("/hangup")?new Response(null,{status:500}):null;
    await assert.rejects(f.server.cancelAuditCall(f.db,member,{caseId:"case"},f.getCall().id,f.options),/still being confirmed/);assert.equal(f.getCall().end_requested,1);await assert.rejects(f.prepare(),/already prepared/);
    f.overrides.request=undefined;await f.server.cancelAuditCall(f.db,member,{caseId:"case"},f.getCall().id,f.options);assert.equal(f.getCall().end_requested,0);
  }finally{f.sqlite.close();}
});
test("audit call API rejects cross-origin and disallowed members before preparing a provider call",async()=>{
  class AccessError extends Error{constructor(code,status,message){super(message);this.code=code;this.status=status;}}
  class CallError extends Error{constructor(code,status,message){super(message);this.code=code;this.status=status;}}
  let denied=false,prepares=0;
  const server={CreditexAuditCallError:CallError,prepareAuditCall:async(_db,_member,input)=>{prepares++;return{ok:true,...input};}};
  const helpers=load("../src/lib/creditex-audit-call-route-server.ts",{"./compliance-access-server":{ComplianceAccessError:AccessError,requireComplianceAccess:async(_request,options)=>{
    assert.deepEqual(options.allowedRoles,["admin","case_manager","reviewer","auditor"]);if(denied)throw new AccessError("COMPLIANCE_ACCESS_REQUIRED",403,"Access required");return member;
  }},"./creditex-audit-call-server":server,"./trade-compliance-intent":{CREDITEX_PARTNER_ORGANISATION_CODE:"CREDITEX"}});
  const route=load("../src/app/api/creditex/audit-calls/route.ts",{"../../../../../db":{getD1:()=>({})},"@/lib/creditex-audit-call-server":server,"@/lib/creditex-audit-call-route-server":helpers});
  const request=origin=>new Request("https://example.test/api/creditex/audit-calls",{method:"POST",headers:{Origin:origin},body:JSON.stringify({action:"prepare",jobIntentId:"intent",requestId:crypto.randomUUID()})});
  assert.equal((await route.POST(request("https://attacker.test"))).status,403);assert.equal(prepares,0);
  denied=true;const rejected=await route.POST(request("https://example.test"));assert.equal(rejected.status,403);assert.equal((await rejected.json()).code,"COMPLIANCE_ACCESS_REQUIRED");assert.equal(prepares,0);
  denied=false;const accepted=await route.POST(request("https://example.test"));assert.equal(accepted.status,200);assert.equal((await accepted.json()).jobIntentId,"intent");assert.equal(prepares,1);assert.equal(accepted.headers.get("Cache-Control"),"private, no-store");
});
