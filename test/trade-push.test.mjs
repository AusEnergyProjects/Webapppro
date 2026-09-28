import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as pure from '../src/lib/trade-push.ts';
import { buildPushPayload } from '@block65/webcrypto-web-push';

const read = path => fs.readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,dependencies) {
  const output = ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',output)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},module,module.exports);
  return module.exports;
}
const access = load('../src/lib/trade-message-media-access.ts',{});
const account = load('../src/lib/trade-access-server.ts',{'../../db':{},'./firebase-server':{},'./creditex-schema-guards':{},'./trade-abn':{},'./trade-mfa-server':{}});
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const subscriberKeys = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const p256dh = b64(await crypto.subtle.exportKey('raw',subscriberKeys.publicKey));
const signingKeys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const privateJwk = await crypto.subtle.exportKey('jwk',signingKeys.privateKey);
const credentials = {publicKey:b64(await crypto.subtle.exportKey('raw',signingKeys.publicKey)),privateKey:privateJwk.d,subject:'mailto:info@ausenergyassessments.com'};
const browserSubscription = (suffix='device-1') => ({endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,expirationTime:null,keys:{p256dh,auth:b64(new Uint8Array(16).fill(8))}});
const owner = {ownerUid:'business-a',actorUid:'owner-uid',memberId:'owner',displayName:'Owner',isOwner:true};
const jane = {...owner,actorUid:'jane-uid',memberId:'jane',isOwner:false};
const john = {...owner,actorUid:'john-uid',memberId:'john',isOwner:false};
const foreign = {...owner,ownerUid:'business-b',actorUid:'foreign-uid',memberId:'foreign'};
const field = {...john,actorUid:'field-member:john',fieldSessionId:'field-john'};

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,abn TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT PRIMARY KEY,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    INSERT INTO trade_accounts VALUES('business-a','Synthetic A','51824753556','installer','active','approved','51824753556','review-a','2026-01-01','admin'),('business-b','Synthetic B','51824753556','installer','active','approved','51824753556','review-b','2026-01-01','admin');
    INSERT INTO trade_account_verification_reviews VALUES('review-a','business-a','51824753556','Synthetic A','installer','approved','official_abr_lookup','admin','2026-01-01'),('review-b','business-b','51824753556','Synthetic B','installer','approved','official_abr_lookup','admin','2026-01-01');
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT);
    INSERT INTO trade_team_members VALUES('owner','business-a','owner-uid','active'),('jane','business-a','jane-uid','active'),('john','business-a','john-uid','active'),('foreign','business-b','foreign-uid','active');
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT,device_id TEXT);
    INSERT INTO trade_field_sessions VALUES('field-john','business-a','john','active','2099-01-01','mobile-john');
    CREATE TABLE trade_mobile_devices(owner_uid TEXT,member_id TEXT,device_id TEXT,actor_uid TEXT,status TEXT);
    INSERT INTO trade_mobile_devices VALUES('business-a','john','mobile-john','field-member:john','active');`);
  for (const migration of ['0214_trade_messages','0216_trade_team_calls','0217_trade_web_push']) sqlite.exec(read(`../drizzle/${migration}.sql`).replaceAll('--> statement-breakpoint',''));
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO trade_message_threads(id,owner_uid,kind,subject,created_by_member_id,request_id,creation_hash,created_at,updated_at) VALUES('thread-a','business-a','group','Private team','owner','request-create','hash',?,?)`).run(now,now);
  for(const member of ['owner','jane','john']) sqlite.prepare("INSERT INTO trade_message_participants(thread_id,owner_uid,member_id) VALUES('thread-a','business-a',?)").run(member);
  const sends = [], state = {configured:true,providerStatus:'accepted',beforeRun:()=>{}};
  const statement = (sql,values=[]) => ({bind:(...params)=>statement(sql,params),first:async()=>sqlite.prepare(sql).get(...values)||null,
    all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>{state.beforeRun(sql);return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}});
  const db = {prepare:statement};
  const server = load('../src/lib/trade-push-server.ts',{'../../db':{getD1:()=>db},'./trade-message-media-access':access,'./trade-access-server':account,'./trade-push':pure,
    './trade-push-provider':{tradePushCredentials:()=>state.configured?credentials:null,sendTradePush:async(subscription,payload)=>{sends.push({subscription,payload});return state.providerStatus;}}});
  const subscribe = (actor,suffix=actor.memberId,options={}) => server.subscribeTradePush(actor,{subscription:browserSubscription(suffix),messages:true,calls:true,...options},db);
  const message = (id='message-1',ageMs=0) => sqlite.prepare(`INSERT INTO trade_internal_messages(id,owner_uid,thread_id,sequence,actor_member_id,actor_name,body,request_id,created_at)
    VALUES(?,'business-a','thread-a',(SELECT COUNT(*)+1 FROM trade_internal_messages),'owner','Sensitive name','Private customer address',?,?)`).run(id,id,new Date(Date.now()-ageMs).toISOString());
  const call = (id='call-1',ageMs=0) => {
    const time = new Date(Date.now()-ageMs).toISOString();
    sqlite.prepare(`INSERT INTO trade_team_calls(id,owner_uid,thread_id,mode,created_by_member_id,request_id,created_at,expires_at) VALUES(?,'business-a','thread-a','video','owner',?,?,?)`).run(id,id,time,new Date(Date.now()+3600000).toISOString());
    sqlite.prepare(`INSERT INTO trade_team_call_participants(call_id,owner_uid,member_id,session_id,joined_at,last_seen_at) VALUES(?,'business-a','owner','call-session',?,?)`).run(id,time,new Date().toISOString());
  };
  return {sqlite,db,server,subscribe,message,call,sends,state,close:()=>sqlite.close()};
}

test('push input rejects SSRF endpoints, noncanonical keys, expired subscriptions and unbounded IDs',()=>{
  for(const endpoint of ['http://fcm.googleapis.com/fcm/send/a','https://127.0.0.1/fcm/send/a','https://fcm.googleapis.com.evil.test/fcm/send/a','https://evil.test','https://fcm.googleapis.com:444/fcm/send/a','https://user@fcm.googleapis.com/fcm/send/a','https://fcm.googleapis.com/fcm/send/a#fragment','https://fcm.googleapis.com/fcm/send/a?redirect=foo','https://fcm.googleapis.com/other/a','https://web.push.apple.com.evil.test/abc','https://updates.push.services.mozilla.com/other/a','https://fcm.googleapis.com\@evil.test/fcm/send/a']) assert.throws(()=>pure.pushEndpoint(endpoint),/PUSH_ENDPOINT_INVALID/);
  for(const endpoint of ['https://fcm.googleapis.com/fcm/send/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://web.push.apple.com/Qtest-token']) assert.equal(pure.pushEndpoint(endpoint),endpoint);
  assert.deepEqual(pure.pushSubscriptionInput(browserSubscription()),browserSubscription());
  for(const value of [null,[],{}, {...browserSubscription(),expirationTime:1}, {...browserSubscription(),expirationTime:'2099'}, {...browserSubscription(),keys:{p256dh:'x'.repeat(87),auth:'x'.repeat(22)}}]) assert.throws(()=>pure.pushSubscriptionInput(value));
  for(const id of ['', 'a'.repeat(181), 'a?redirect=foreign', 123]) assert.throws(()=>pure.pushId(id),/PUSH_INPUT_INVALID/);
});

test('subscription updates stay bound to business, member and field session without exposing endpoints or secret keys',async()=>{
  const f=fixture();try{
    const saved=await f.subscribe(jane),again=await f.subscribe(jane);
    assert.equal(saved.id,again.id);assert.deepEqual(saved,{id:saved.id,messages:true,calls:true,enabled:true});
    const settings=await f.server.tradePushSettings(jane,saved.id,f.db);assert.equal(settings.configured,true);assert.equal(settings.publicKey,credentials.publicKey);
    assert.ok(!JSON.stringify(settings).includes('https://'));assert.ok(!JSON.stringify(settings).includes(credentials.privateKey));
    assert.equal((await f.server.tradePushSettings(owner,saved.id,f.db)).subscription,null);
    await assert.rejects(f.server.updateTradePush(owner,{subscriptionId:saved.id,messages:false,calls:false},f.db),/PUSH_ACCESS_REQUIRED/);
    await f.server.unsubscribeTradePush(foreign,saved.id,f.db);assert.equal((await f.server.tradePushSettings(jane,saved.id,f.db)).subscription.id,saved.id);
    await assert.rejects(f.subscribe(foreign,'jane'),/PUSH_DEVICE_CONFLICT/);
    const fieldSaved=await f.subscribe(field,'field');
    assert.equal((await f.server.tradePushSettings(john,fieldSaved.id,f.db)).subscription,null);
    await assert.rejects(f.subscribe({...field,fieldSessionId:'missing-session'},'another'),/PUSH_ACCESS_REQUIRED/);
    await f.server.unsubscribeTradePush(jane,saved.id,f.db);assert.equal((await f.server.tradePushSettings(jane,saved.id,f.db)).subscription,null);
  }finally{f.close();}
});

test('five-device cap is enforced atomically, and malformed curve keys cannot register',async()=>{
  const f=fixture();try{
    const registrations=await Promise.allSettled(Array.from({length:8},(_,index)=>f.subscribe(jane,`device-${index}`)));
    assert.equal(registrations.filter(item=>item.status==='fulfilled').length,5);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM trade_push_subscriptions').get().count,5);
    assert.ok(registrations.filter(item=>item.status==='rejected').every(item=>item.reason.message==='PUSH_DEVICE_CONFLICT'));
    const invalid={...browserSubscription('invalid-curve'),keys:{...browserSubscription().keys,p256dh:b64(Uint8Array.from([4,...new Uint8Array(64)]))}};
    await assert.rejects(f.subscribe(john,'invalid',{subscription:invalid}),/PUSH_INPUT_INVALID/);
  }finally{f.close();}
});

test('message push is participant-only, generic, skips sender and already-read messages, and replay is idempotent',async()=>{
  const f=fixture();try{
    await f.subscribe(owner);await f.subscribe(jane);await f.subscribe(john);await f.subscribe(foreign);f.message();
    f.sqlite.exec("UPDATE trade_message_participants SET last_read_sequence=1 WHERE member_id='john'");
    const results=await Promise.all([1,2,3].map(()=>f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)));
    assert.equal(results.reduce((sum,result)=>sum+result.accepted,0),1);assert.equal(f.sends.length,1);
    const push=f.sends[0];assert.equal(push.subscription.endpoint,browserSubscription('jane').endpoint);
    assert.equal(push.payload.body,'New team message');assert.equal(push.payload.url,'/direct-trade/messages?threadId=thread-a');
    assert.ok(!JSON.stringify(push.payload).includes('Sensitive'));assert.ok(!JSON.stringify(push.payload).includes('Private'));
    assert.equal((await f.server.notifyTeamMessage(jane,'thread-a','message-1',f.db)).attempted,0);
    assert.equal((await f.server.notifyTeamMessage(foreign,'thread-a','message-1',f.db)).attempted,0);
    f.message('old-message',16*60000);assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','old-message',f.db)).attempted,0);
  }finally{f.close();}
});

test('mute preferences apply separately to calls and messages',async()=>{
  const f=fixture();try{
    await f.subscribe(jane,'jane',{messages:false,calls:true});await f.subscribe(john,'john',{messages:true,calls:false});f.message();f.call();
    assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).accepted,1);
    assert.equal(f.sends[0].subscription.endpoint,browserSubscription('john').endpoint);
    assert.equal((await f.server.notifyTeamCall(owner,{id:'call-1',threadId:'thread-a'},f.db)).accepted,1);
    assert.equal(f.sends[1].subscription.endpoint,browserSubscription('jane').endpoint);assert.equal(f.sends[1].payload.body,'Incoming team video call');
    assert.match(f.sends[1].payload.url,/callId=call-1/);assert.ok(Date.parse(f.sends[1].payload.expiresAt)<=Date.now()+90000);
  }finally{f.close();}
});

test('expired, ended, abandoned and already-joined calls never produce new ringing pushes',async()=>{
  for(const change of ['old','ended','caller-left','caller-stale','callee-joined']){
    const f=fixture();try{
      await f.subscribe(jane);f.call('call-1',change==='old'?91000:0);
      if(change==='ended')f.sqlite.exec("UPDATE trade_team_calls SET status='ended'");
      if(change==='caller-left')f.sqlite.exec("UPDATE trade_team_call_participants SET left_at='2026-01-01'");
      if(change==='caller-stale')f.sqlite.exec("UPDATE trade_team_call_participants SET last_seen_at='2026-01-01'");
      if(change==='callee-joined')f.sqlite.prepare("INSERT INTO trade_team_call_participants(call_id,owner_uid,member_id,session_id,joined_at,last_seen_at) VALUES('call-1','business-a','jane','joined',?,?)").run(new Date().toISOString(),new Date().toISOString());
      assert.equal((await f.server.notifyTeamCall(owner,{id:'call-1',threadId:'thread-a'},f.db)).attempted,0,change);assert.equal(f.sends.length,0);
    }finally{f.close();}
  }
});

test('current recipient membership, account approval, session and registration expiry are enforced at dispatch',async()=>{
  for(const change of ["UPDATE trade_team_members SET status='suspended' WHERE id='john'","UPDATE trade_field_sessions SET status='revoked'","UPDATE trade_field_sessions SET expires_at='2026-01-01'","UPDATE trade_mobile_devices SET status='revoked'","UPDATE trade_mobile_devices SET actor_uid='different-actor'","UPDATE trade_push_subscriptions SET expires_at='2026-01-01'","UPDATE trade_accounts SET account_status='suspended' WHERE firebase_uid='business-a'","UPDATE trade_account_verification_reviews SET decision='rejected' WHERE id='review-a'","DELETE FROM trade_message_participants WHERE member_id='john'"]){
    const f=fixture();try{
      await f.subscribe(field);f.message();f.sqlite.exec(change);
      assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).attempted,0,change);assert.equal(f.sends.length,0);
    }finally{f.close();}
  }
  const f=fixture();try{
    await f.subscribe(jane);f.message();f.sqlite.exec("UPDATE trade_team_members SET member_uid='replacement-uid' WHERE id='jane'");
    assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).attempted,0);
  }finally{f.close();}
});

test('revocation between fanout read and durable claim prevents the network call',async()=>{
  const f=fixture();try{
    await f.subscribe(jane);f.message();f.state.beforeRun=sql=>{if(sql.startsWith('INSERT OR IGNORE INTO trade_push_deliveries'))f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='jane'");};
    assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).attempted,0);assert.equal(f.sends.length,0);
  }finally{f.close();}
});

test('failed provider attempts never resend on replay; gone subscriptions disable while stale events do not',async()=>{
  for(const providerStatus of ['failed','expired','stale']){
    const f=fixture();try{
      const sub=await f.subscribe(jane);f.message();f.state.providerStatus=providerStatus;
      assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).failed,1);
      assert.equal((await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db)).attempted,0);assert.equal(f.sends.length,1);
      assert.equal(f.sqlite.prepare('SELECT enabled FROM trade_push_subscriptions WHERE id=?').get(sub.id).enabled,providerStatus==='expired'?0:1);
    }finally{f.close();}
  }
});

test('unconfigured push stays honest and never affects an existing message',async()=>{
  const f=fixture();try{
    f.state.configured=false;assert.equal((await f.server.tradePushSettings(jane,undefined,f.db)).configured,false);
    await assert.rejects(f.subscribe(jane),/PUSH_UNAVAILABLE/);f.message();
    assert.deepEqual(await f.server.notifyTeamMessage(owner,'thread-a','message-1',f.db),{attempted:0,accepted:0,failed:0,skipped:true});
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM trade_internal_messages').get().count,1);
  }finally{f.close();}
});

test('actual provider encrypts payload, signs valid VAPID and bounds TTL with redirects disabled',async()=>{
  const provider=load('../src/lib/trade-push-provider.ts',{'cloudflare:workers':{env:{}},'@block65/webcrypto-web-push':{buildPushPayload},'./trade-push':pure});
  assert.equal(provider.tradePushCredentials({}),null);
  assert.deepEqual(provider.tradePushCredentials({TLINK_WEB_PUSH_PUBLIC_KEY:credentials.publicKey,TLINK_WEB_PUSH_PRIVATE_KEY:credentials.privateKey}),credentials);
  const payload={v:1,kind:'team-call',id:'call-1',threadId:'thread-a',title:'TLink',body:'Incoming team video call',url:'/direct-trade/messages?threadId=thread-a&callId=call-1',expiresAt:new Date(Date.now()+60000).toISOString()};
  let request;
  assert.equal(await provider.sendTradePush(browserSubscription(),payload,credentials,async(endpoint,init)=>{request={endpoint,init};return new Response('',{status:201});}),'accepted');
  assert.equal(request.endpoint,browserSubscription().endpoint);assert.equal(request.init.redirect,'error');assert.ok(request.init.signal instanceof AbortSignal);
  const headers=new Headers(request.init.headers);assert.equal(headers.get('content-encoding'),'aes128gcm');assert.ok(Number(headers.get('ttl'))<=60);assert.equal(headers.get('urgency'),'high');
  assert.equal(request.init.body.byteLength,4096);assert.ok(!new TextDecoder().decode(request.init.body).includes('Incoming team video call'));
  const token=headers.get('authorization').match(/^vapid t=([^,]+), k=/)[1],parts=token.split('.');
  assert.equal(JSON.parse(Buffer.from(parts[1],'base64url').toString()).aud,'https://fcm.googleapis.com');
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},signingKeys.publicKey,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts.slice(0,2).join('.'))),true);
  for(const code of [404,410])assert.equal(await provider.sendTradePush(browserSubscription(),payload,credentials,async()=>new Response('',{status:code})),'expired');
  assert.equal(await provider.sendTradePush(browserSubscription(),payload,credentials,async()=>{throw new Error('Network failure');}),'failed');
  assert.equal(await provider.sendTradePush({...browserSubscription(),endpoint:'https://127.0.0.1/'},payload,credentials,async()=>assert.fail('SSRF attempted')),'failed');
  assert.equal(await provider.sendTradePush(browserSubscription(),{...payload,expiresAt:'2000-01-01'},credentials,async()=>assert.fail('Expired call sent')),'stale');
});
