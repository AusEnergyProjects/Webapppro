import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as pure from '../src/lib/trade-team-calls.ts';
import * as presence from '../src/lib/trade-team-presence.ts';
import * as personalNames from '../src/lib/trade-team-personal-name.ts';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,dependencies){const output=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const record={exports:{}};new Function('require','module','exports',output)(name=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`);return dependencies[name];},record,record.exports);return record.exports;}
const owner={ownerUid:'business-a',actorUid:'owner-uid',memberId:'owner-0001',displayName:'Owner',isOwner:true};
const member=i=>({...owner,actorUid:`person-${i}`,memberId:`member-00${i}`,displayName:`Member ${i}`,isOwner:false});
const foreign={...owner,ownerUid:'business-b',actorUid:'other-uid',memberId:'other-0001'};
const session=i=>`session-${String(i).padStart(8,'0')}`;
const request=i=>`request-${String(i).padStart(8,'0')}`;
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,manager_name TEXT NOT NULL DEFAULT ''); INSERT INTO trade_accounts VALUES('business-a',''),('business-b','')");
 sqlite.exec(`PRAGMA foreign_keys=ON;CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT);CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
 INSERT INTO trade_team_members VALUES('owner-0001','business-a','owner-uid','active','Owner'),('other-0001','business-b','other-uid','active','Other');`);
 for(let i=1;i<=8;i++)sqlite.prepare('INSERT INTO trade_team_members VALUES(?,?,?,?,?)').run(member(i).memberId,owner.ownerUid,member(i).actorUid,'active',member(i).displayName);
 sqlite.exec(read('../drizzle/0214_trade_messages.sql').replaceAll('--> statement-breakpoint',''));
 sqlite.exec(read('../drizzle/0216_trade_team_calls.sql').replaceAll('--> statement-breakpoint',''));
 sqlite.exec(read('../drizzle/0219_trade_team_presence.sql').replaceAll('--> statement-breakpoint',''));
 for(const id of ['thread-demo-1','thread-private','thread-demo-2'])sqlite.prepare('INSERT INTO trade_message_threads(id,owner_uid,kind,subject,created_by_member_id,request_id,creation_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner.ownerUid,'group','Installation crew',owner.memberId,id,id,new Date().toISOString(),new Date().toISOString());
 for(const actor of [owner,...Array.from({length:8},(_,i)=>member(i+1))])for(const id of ['thread-demo-1','thread-demo-2'])sqlite.prepare('INSERT INTO trade_message_participants(thread_id,owner_uid,member_id)VALUES(?,?,?)').run(id,owner.ownerUid,actor.memberId);
 sqlite.prepare('INSERT INTO trade_message_participants(thread_id,owner_uid,member_id)VALUES(?,?,?)').run('thread-private',owner.ownerUid,member(1).memberId);
 let failBatch=false,beforeBatch;
 const roundTrips=[];
 const statement=(sql,values=[])=>({sql,bind:(...next)=>statement(sql,next),first:async()=>{roundTrips.push({type:'first',sql});return sqlite.prepare(sql).get(...values)||null;},all:async()=>{roundTrips.push({type:'all',sql});return{results:sqlite.prepare(sql).all(...values)};},runSync:()=>sql.trimStart().startsWith('SELECT ')?{meta:{changes:0},results:sqlite.prepare(sql).all(...values)}:{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)},results:[]},run(){roundTrips.push({type:'run',sql});return Promise.resolve(this.runSync());}});
 const db={prepare:statement,batch:async statements=>{roundTrips.push({type:'batch',sql:statements.map(s=>s.sql).join('\n')});if(beforeBatch){const action=beforeBatch;beforeBatch=null;action(statements);}sqlite.exec('BEGIN');try{const output=[];for(const [i,s]of statements.entries()){output.push(s.runSync());if(failBatch&&i===0&&statements[0].sql.startsWith('INSERT OR IGNORE INTO trade_team_calls')){failBatch=false;throw new Error('forced rollback');}}sqlite.exec('COMMIT');return output;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const guards=load('../src/lib/trade-message-media-access.ts',{});
 const server=load('../src/lib/trade-team-calls-server.ts',{'../../db':{getD1:()=>db},'./trade-team-calls':pure,'./trade-message-media-access':guards,'./trade-team-presence':presence,'./trade-team-personal-name':personalNames});
 return{sqlite,db,server,roundTrips,failNextBatch(){failBatch=true;},beforeBatch(action){beforeBatch=action;},close:()=>sqlite.close()};
}
const start=(f,actor=owner,n=1,threadId='thread-demo-1')=>f.server.startTeamCall(actor,{threadId,requestId:request(n),sessionId:session(n),mode:'video'},f.db);
const join=(f,call,actor,n)=>f.server.joinTeamCall(actor,call.id,session(n),f.db);
const signal=(f,call,overrides={})=>f.server.sendTeamCallSignal(owner,{callId:call.id,sessionId:session(1),toMemberId:member(1).memberId,toSessionId:session(2),requestId:request(100),type:'offer',payload:{type:'offer',sdp:'v=0\r\ns=Test\r\n'},...overrides},f.db);
const setPresence=(f,actor,status)=>f.sqlite.prepare('INSERT OR REPLACE INTO trade_team_presence(owner_uid,member_id,status,updated_at) VALUES(?,?,?,?)').run(actor.ownerUid,actor.memberId,status,new Date().toISOString());

test('incoming call projects the personal caller name from its owner account even before the owner team row is updated',async()=>{
 const f=fixture();try {
  const caller={...owner,actorUid:owner.ownerUid};
  f.sqlite.prepare('UPDATE trade_team_members SET member_uid=? WHERE id=?').run(owner.ownerUid,owner.memberId);
  const call=await start(f,caller);
  f.sqlite.prepare("UPDATE trade_accounts SET manager_name='James Morris' WHERE firebase_uid='business-a'").run();
  f.sqlite.prepare("UPDATE trade_message_threads SET kind='dm',subject='' WHERE id=?").run(call.threadId);
  const incoming=await f.server.incomingTeamCalls(member(1),f.db);
  assert.equal(incoming[0].participants.find(person=>person.memberId===owner.memberId).name,'James Morris');
  assert.match(incoming[0].threadName,/James Morris/);
  assert.equal(f.sqlite.prepare('SELECT display_name FROM trade_team_members WHERE id=?').get(owner.memberId).display_name,'Owner');
 }finally{f.close();}
});

test('input bounds and SDP/ICE shapes reject arbitrary data and excessive payloads',()=>{
 assert.equal(pure.teamCallMode('audio'),'audio');assert.equal(pure.teamCallCursor('12'),12);
 for(const value of ['../secret','','a'.repeat(121),null])assert.throws(()=>pure.teamCallId(value),/CALL_INPUT_INVALID/);
 for(const value of ['-1','1e2',1.5,NaN])assert.throws(()=>pure.teamCallCursor(value),/CALL_INPUT_INVALID/);
 assert.deepEqual(pure.teamCallSignalInput('ice',{candidate:'candidate:1 1 UDP 123 127.0.0.1 1234 typ host',sdpMid:'0',sdpMLineIndex:0}).payload,{candidate:'candidate:1 1 UDP 123 127.0.0.1 1234 typ host',sdpMid:'0',sdpMLineIndex:0});
 for(const [type,payload]of [['offer',{type:'answer',sdp:'v=0'}],['offer',{type:'offer',sdp:'v=0'+'x'.repeat(60000)}],['offer',{type:'offer',sdp:'v=0',script:'x'}],['ice',{candidate:'x\n'}],['ice',{candidate:'x',sdpMLineIndex:1.5}],['ice',{candidate:'x',usernameFragment:5}]])assert.throws(()=>pure.teamCallSignalInput(type,payload),/CALL_SIGNAL_INVALID/);
});
test('start is atomic and idempotent, with one active call per thread and conflict detection',async()=>{const f=fixture();try{
 const [one,two]=await Promise.all([start(f),start(f)]);assert.equal(one.id,two.id);assert.equal(one.participants.length,1);assert.equal(one.threadName,'Installation crew');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_calls').get().n,1);
 await assert.rejects(start(f,member(1),2),/CALL_ALREADY_ACTIVE/);
 await assert.rejects(start(f,owner,1,'thread-demo-2'),/CALL_REQUEST_CONFLICT/);
 await f.server.leaveTeamCall(owner,one.id,session(1),f.db);assert.equal((await start(f)).status,'ended');assert.notEqual((await start(f,owner,3)).id,one.id);
}finally{f.close();}});
test('tenant, participant, inactive-member and field-session guards protect calls and invitations',async()=>{const f=fixture();try{
 const call=await start(f);for(const action of [()=>join(f,call,foreign,2),()=>f.server.teamCallStatus(foreign,{callId:call.id},f.db),()=>start(f,owner,2,'thread-private')])await assert.rejects(action(),/CALL_ACCESS_REQUIRED/);
 assert.equal((await f.server.incomingTeamCalls(foreign,f.db)).length,0);
 f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-001'");await assert.rejects(join(f,call,member(1),2),/CALL_ACCESS_REQUIRED/);
 const field={...member(2),actorUid:'unused',fieldSessionId:'field-session'};
 f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('field-session',owner.ownerUid,field.memberId,'active',new Date(Date.now()+60000).toISOString());
 await join(f,call,field,4);f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");await assert.rejects(f.server.teamCallStatus(field,{callId:call.id,sessionId:session(4)},f.db),/CALL_ACCESS_REQUIRED/);
}finally{f.close();}});
test('six concurrent slots never overbook and stale or suspended participants release capacity',async()=>{const f=fixture();try{
 const call=await start(f);const results=await Promise.allSettled(Array.from({length:8},(_,i)=>join(f,call,member(i+1),i+2)));assert.equal(results.filter(x=>x.status==='fulfilled').length,5);assert.equal(results.filter(x=>x.status==='rejected').length,3);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_team_call_participants WHERE left_at=''").get().n,6);
 f.sqlite.exec("UPDATE trade_team_call_participants SET last_seen_at='2020-01-01' WHERE member_id='member-001'");const next=await join(f,call,member(6),8);assert.equal(next.participants.length,6);assert.ok(!next.participants.some(p=>p.memberId===member(1).memberId));
 f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-002'");assert.equal((await join(f,call,member(7),9)).participants.length,6);
}finally{f.close();}});
test('signalling is recipient-only, retry-safe, session-fenced and deleted on leave',async()=>{const f=fixture();try{
 const call=await start(f);await join(f,call,member(1),2);await join(f,call,member(2),3);await signal(f,call);await signal(f,call);
 let result=await f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2),after:0},f.db);assert.equal(result.signals.length,1);assert.equal(result.signals[0].requestId,request(100));
 assert.equal((await f.server.teamCallStatus(member(2),{callId:call.id,sessionId:session(3)},f.db)).signals.length,0);
 await assert.rejects(signal(f,call,{payload:{type:'offer',sdp:'v=0 changed'}}),/CALL_REQUEST_CONFLICT/);
 await join(f,call,member(1),22);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,0);
 await assert.rejects(f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2)},f.db),/CALL_SESSION_REPLACED/);
 await assert.rejects(signal(f,call,{requestId:request(101)}),/CALL_ACCESS_REQUIRED/);
 await signal(f,call,{requestId:request(102),toSessionId:session(22)});
 result=await f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(22),after:0},f.db);assert.equal(result.signals.length,1);assert.ok(result.signals[0].sequence>1);
 await f.server.leaveTeamCall(member(1),call.id,session(2),f.db);assert.ok((await f.server.teamCallStatus(owner,{callId:call.id,sessionId:session(1)},f.db)).call.participants.some(p=>p.sessionId===session(22)));
 await f.server.leaveTeamCall(member(1),call.id,session(22),f.db);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,0);
}finally{f.close();}});
test('individual ICE delivery uses two round trips while polling retains lifecycle cleanup',async()=>{const f=fixture();try{
 const call=await start(f);await join(f,call,member(1),2);
 const unrelated=await start(f,owner,3,'thread-demo-2');
 f.sqlite.prepare("UPDATE trade_team_calls SET created_at='2020-01-01' WHERE id=?").run(unrelated.id);
 f.roundTrips.length=0;
 await signal(f,call,{type:'ice',payload:{candidate:'candidate:1 1 UDP 123 127.0.0.1 1234 typ host'}});
 assert.deepEqual(f.roundTrips.map(trip=>trip.type),['first','batch']);
 assert.equal(f.sqlite.prepare('SELECT status FROM trade_team_calls WHERE id=?').get(unrelated.id).status,'active');
 f.roundTrips.length=0;
 const result=await f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2)},f.db);
 assert.equal(result.signals.length,1);
 assert.equal(f.roundTrips.length,5);
 assert.ok(f.roundTrips.some(trip=>trip.type==='batch'&&trip.sql.includes('SET last_seen_at=')&&trip.sql.includes('SELECT s.* FROM trade_team_call_signals')));
 assert.equal(f.sqlite.prepare('SELECT status FROM trade_team_calls WHERE id=?').get(unrelated.id).status,'ended');
}finally{f.close();}});

test('signal writes recheck sender, recipient and lifecycle authority after the initial call read',async()=>{
 const cases=[
  ['sender suspended',f=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='owner-0001'")],
  ['sender removed from thread',f=>f.sqlite.exec("DELETE FROM trade_message_participants WHERE member_id='owner-0001'")],
  ['sender session replaced',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET session_id='replacement-session' WHERE member_id='owner-0001'")],
  ['sender left',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET left_at='2020-01-01' WHERE member_id='owner-0001'")],
  ['sender stale',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET last_seen_at='2020-01-01' WHERE member_id='owner-0001'")],
  ['recipient suspended',f=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-001'")],
  ['recipient removed from thread',f=>f.sqlite.exec("DELETE FROM trade_message_participants WHERE member_id='member-001'")],
  ['recipient session replaced',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET session_id='replacement-session' WHERE member_id='member-001'")],
  ['recipient left',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET left_at='2020-01-01' WHERE member_id='member-001'")],
  ['recipient stale',f=>f.sqlite.exec("UPDATE trade_team_call_participants SET last_seen_at='2020-01-01' WHERE member_id='member-001'")],
  ['call ended',f=>f.sqlite.exec("UPDATE trade_team_calls SET status='ended'")],
  ['call expired',f=>f.sqlite.exec("UPDATE trade_team_calls SET expires_at='2020-01-01'")],
  ['unanswered deadline expired',f=>f.sqlite.exec("UPDATE trade_team_calls SET had_peer=0,created_at='2020-01-01'")],
 ];
 for(const [name,revoke] of cases){const f=fixture();try{
  const call=await start(f);await join(f,call,member(1),2);
  f.beforeBatch(()=>revoke(f));
  await assert.rejects(signal(f,call),/CALL_ACCESS_REQUIRED/,name);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,0,name);
  assert.equal(f.sqlite.prepare('SELECT next_signal_sequence n FROM trade_team_calls').get().n,0,name);
 }finally{f.close();}}
});

test('signal retries cannot acknowledge delivery to a revoked or replaced recipient',async()=>{
 for(const sql of ["UPDATE trade_team_members SET status='suspended' WHERE id='member-001'","UPDATE trade_team_call_participants SET session_id='replacement-session' WHERE member_id='member-001'","UPDATE trade_team_call_participants SET left_at='2020-01-01' WHERE member_id='member-001'"]){const f=fixture();try{
  const call=await start(f);await join(f,call,member(1),2);await signal(f,call);
  f.beforeBatch(()=>f.sqlite.exec(sql));
  await assert.rejects(signal(f,call),/CALL_ACCESS_REQUIRED/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,1);
 }finally{f.close();}}
});

test('signals reject cross-business actors and field sessions revoked or expired during delivery',async()=>{
 for(const update of ["status='revoked'","expires_at='2020-01-01'"]){const f=fixture();try{
  const call=await start(f);await join(f,call,member(1),2);
  const input={callId:call.id,sessionId:session(1),toMemberId:member(1).memberId,toSessionId:session(2),requestId:request(100),type:'offer',payload:{type:'offer',sdp:'v=0'}};
  await assert.rejects(f.server.sendTeamCallSignal(foreign,input,f.db),/CALL_ACCESS_REQUIRED/);
  const field={...owner,actorUid:'unused',fieldSessionId:'field-session'};
  f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run(field.fieldSessionId,owner.ownerUid,owner.memberId,'active',new Date(Date.now()+60000).toISOString());
  f.beforeBatch(()=>f.sqlite.exec(`UPDATE trade_field_sessions SET ${update}`));
  await assert.rejects(f.server.sendTeamCallSignal(field,input,f.db),/CALL_ACCESS_REQUIRED/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,0);
 }finally{f.close();}}
});

test('parallel ICE candidates keep atomic rate limits, unique order and idempotent acknowledgements',async()=>{const f=fixture();try{
 const call=await start(f);await join(f,call,member(1),2);
 const input=index=>({requestId:request(1000+index),type:'ice',payload:{candidate:`candidate:${index} 1 UDP 123 127.0.0.1 1234 typ host`}});
 const results=await Promise.allSettled(Array.from({length:125},(_,i)=>signal(f,call,input(i))));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,120);
 for(const result of results.filter(result=>result.status==='rejected'))assert.match(result.reason.message,/CALL_RATE_LIMIT/);
 const rows=f.sqlite.prepare('SELECT sequence FROM trade_team_call_signals ORDER BY sequence').all();
 assert.deepEqual(rows.map(row=>row.sequence),Array.from({length:120},(_,i)=>i+1));
 await Promise.all(Array.from({length:8},()=>signal(f,call,input(0))));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,120);
 assert.equal(f.sqlite.prepare('SELECT next_signal_sequence n FROM trade_team_calls').get().n,120);
 await assert.rejects(signal(f,call,{...input(0),payload:input(1).payload}),/CALL_REQUEST_CONFLICT/);
}finally{f.close();}});

test('the total per-call signal limit stays atomic even when no cleanup runs between sends',async()=>{const f=fixture();try{
 const call=await start(f);await join(f,call,member(1),2);
 const seed=f.sqlite.prepare('INSERT INTO trade_team_call_signals(id,owner_uid,call_id,sequence,from_member_id,from_session_id,to_member_id,to_session_id,request_id,type,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let i=1;i<=999;i++)seed.run(`signal-${i}`,owner.ownerUid,call.id,i,owner.memberId,session(1),member(1).memberId,session(2),request(i),'ice',JSON.stringify({candidate:'candidate:seed'}),new Date(Date.now()-61000).toISOString());
 f.sqlite.prepare('UPDATE trade_team_calls SET next_signal_sequence=999 WHERE id=?').run(call.id);
 const results=await Promise.allSettled([1000,1001].map(i=>signal(f,call,{requestId:request(i)})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/CALL_RATE_LIMIT/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,1000);
 assert.equal(f.sqlite.prepare('SELECT next_signal_sequence n FROM trade_team_calls').get().n,1000);
}finally{f.close();}});

test('batched status cannot refresh or disclose signals for a revoked or replaced recipient',async()=>{
 for(const update of ["UPDATE trade_team_members SET status='suspended' WHERE id='member-001'","UPDATE trade_team_call_participants SET session_id='replacement-session' WHERE member_id='member-001'","UPDATE trade_team_call_participants SET last_seen_at='2020-01-01' WHERE member_id='member-001'"]){const f=fixture();try{
  const call=await start(f);await join(f,call,member(1),2);await signal(f,call);
  const original=f.db.batch;
  f.db.batch=async statements=>{
   if(statements[0].sql.startsWith('UPDATE trade_team_call_participants SET last_seen_at='))f.sqlite.exec(update);
   return original(statements);
  };
  await assert.rejects(f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2)},f.db),/CALL_SESSION_REPLACED/);
 }finally{f.close();}}
});

test('one-hour expiry and unanswered timeout end calls and purge sensitive signalling',async()=>{const f=fixture();try{
 let call=await start(f);await join(f,call,member(1),2);await signal(f,call);f.sqlite.prepare("UPDATE trade_team_calls SET expires_at='2020-01-01' WHERE id=?").run(call.id);
 let result=await f.server.teamCallStatus(owner,{callId:call.id,sessionId:session(1)},f.db);assert.equal(result.call.status,'ended');assert.deepEqual(result.signals,[]);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_signals').get().n,0);
 call=await start(f,owner,3);f.sqlite.prepare("UPDATE trade_team_calls SET created_at='2020-01-01' WHERE id=?").run(call.id);result=await f.server.teamCallStatus(owner,{callId:call.id},f.db);assert.equal(result.call.status,'ended');
}finally{f.close();}});
test('unanswered calls reject joins at 45 seconds even with a healthy caller heartbeat',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,30,4)});
 const f=fixture();try{
  const call=await start(f);
  t.mock.timers.tick(44000);
  assert.equal((await f.server.teamCallStatus(owner,{callId:call.id,sessionId:session(1)},f.db)).call.status,'active');
  assert.equal((await f.server.incomingTeamCalls(member(1),f.db)).length,1);
  t.mock.timers.tick(1000);
  await assert.rejects(join(f,call,member(1),2),/CALL_ENDED/);
  assert.deepEqual(await f.server.incomingTeamCalls(member(1),f.db),[]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_participants WHERE member_id=?').get(member(1).memberId).n,0);
 }finally{f.close();}
});

test('an answer before 45 seconds keeps the established call alive beyond the ring deadline',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,30,5)});
 const f=fixture();try{
  const call=await start(f); t.mock.timers.tick(44000);
  await f.server.teamCallStatus(owner,{callId:call.id,sessionId:session(1)},f.db);
  await join(f,call,member(1),2); t.mock.timers.tick(2000);
  const result=await f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2)},f.db);
  assert.equal(result.call.status,'active'); assert.equal(result.call.participants.length,2); assert.equal(result.call.hasBeenAnswered,true);
  const invited=await f.server.incomingTeamCalls(member(2),f.db);
  assert.equal(invited[0].hasBeenAnswered,true);
  assert.equal((await join(f,call,member(2),3)).participants.length,3);
  assert.equal(f.sqlite.prepare('SELECT had_peer FROM trade_team_calls WHERE id=?').get(call.id).had_peer,1);
 }finally{f.close();}
});

test('the atomic join guard rejects a call whose ring deadline expired after the initial read',async()=>{
 const f=fixture();try{
  const call=await start(f); const original=f.db.batch;
  f.db.batch=async statements=>{
   if(statements[0].sql.startsWith('INSERT INTO trade_team_call_participants'))
    f.sqlite.prepare('UPDATE trade_team_calls SET created_at=? WHERE id=?').run(new Date(Date.now()-46000).toISOString(),call.id);
   return original(statements);
  };
  await assert.rejects(join(f,call,member(1),2),/CALL_ENDED/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_call_participants WHERE member_id=?').get(member(1).memberId).n,0);
 }finally{f.close();}
});

test('transaction rollback and membership revocation never partially create calls',async()=>{const f=fixture();try{
 f.beforeBatch(()=>{});f.failNextBatch();await assert.rejects(start(f),/forced rollback/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_calls').get().n,0);
 let batches=0;const original=f.db.batch;f.db.batch=async statements=>{batches++;if(statements.some(s=>s.sql.startsWith('INSERT OR IGNORE INTO trade_team_calls')))f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='owner-0001'");return original(statements);};
 await assert.rejects(start(f),/CALL_ACCESS_REQUIRED/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_calls').get().n,0);assert.ok(batches>0);
}finally{f.close();}});
test('relay credentials require an active joined session and have an atomic issue rate limit',async()=>{const f=fixture();try{
 const call=await start(f);await assert.rejects(f.server.reserveTeamCallIce(member(1),call.id,session(2),f.db),/CALL_ACCESS_REQUIRED/);
 const results=await Promise.allSettled([1,2].map(()=>f.server.reserveTeamCallIce(owner,call.id,session(1),f.db)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/CALL_RATE_LIMIT/);const issued=results.find(x=>x.status==='fulfilled').value;assert.ok(issued.ttl>3500&&issued.ttl<=3600);
 await f.server.leaveTeamCall(owner,call.id,session(1),f.db);await assert.rejects(f.server.assertTeamCallJoined(owner,call.id,session(1),f.db),/CALL_ACCESS_REQUIRED/);
}finally{f.close();}});
test('provider returns only short-lived ICE credentials, with server-held auth and strict response validation',async()=>{
 const provider=load('../src/lib/trade-team-calls-provider.ts',{'cloudflare:workers':{env:{}}});
 const credentials=provider.teamCallTurnCredentials({TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32)});
 const ice=[{urls:'stun:global.stun.twilio.com:3478'},{urls:'turn:global.turn.twilio.com:3478?transport=udp',username:'short-lived',credential:'temporary'}];
 let observed;const out=await provider.teamCallIceServers(credentials,3600,async(url,init)=>{observed={url,init};return new Response(JSON.stringify({ice_servers:ice,account_sid:credentials.accountSid,password:'unused'}));});
 assert.deepEqual(out,ice);assert.equal(observed.url,`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Tokens.json`);assert.equal(observed.init.body.get('Ttl'),'3600');assert.equal(observed.init.redirect,'manual');assert.equal(observed.init.headers.Authorization,`Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`);assert.ok(!JSON.stringify(out).includes(credentials.authToken));
 for(const value of [{ice_servers:[]},{ice_servers:[{urls:'turn:evil.test:3478',username:'x',credential:'y'}]},{ice_servers:[{urls:'turn:global.turn.twilio.com:3478'}]},{ice_servers:[ice[0]]}])await assert.rejects(provider.teamCallIceServers(credentials,60,async()=>new Response(JSON.stringify(value))),/CALL_RELAY_UNAVAILABLE/);
 await assert.rejects(provider.teamCallIceServers(credentials,60,async()=>new Response('',{status:503})),/CALL_RELAY_UNAVAILABLE/);
});

test('direct call to a busy or offline teammate cannot create a ringing call',async()=>{const f=fixture();try{
 f.sqlite.prepare('DELETE FROM trade_message_participants WHERE thread_id=? AND member_id NOT IN (?,?)').run('thread-demo-1',owner.memberId,member(1).memberId);
 for(const status of ['busy','offline']){
  setPresence(f,member(1),status);await assert.rejects(start(f),/CALL_RECIPIENT_UNAVAILABLE/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_calls').get().n,0);
 }
 setPresence(f,member(1),'online');assert.equal((await start(f)).status,'active');
}finally{f.close();}});

test('group calls reach available people and a presence change removes pending invitations',async()=>{const f=fixture();try{
 setPresence(f,member(1),'busy');setPresence(f,member(2),'offline');const call=await start(f);
 assert.deepEqual(await f.server.incomingTeamCalls(member(1),f.db),[]);
 assert.deepEqual(await f.server.incomingTeamCalls(member(2),f.db),[]);
 assert.equal((await f.server.incomingTeamCalls(member(3),f.db))[0].id,call.id);
 setPresence(f,member(3),'busy');assert.deepEqual(await f.server.incomingTeamCalls(member(3),f.db),[]);
 assert.equal((await f.server.teamCallStatus(member(3),{threadId:'thread-demo-1'},f.db)).call,null);
 await assert.rejects(join(f,call,member(3),3),/CALL_PRESENCE_UNAVAILABLE/);
 assert.equal((await f.server.incomingTeamCalls(member(4),f.db))[0].id,call.id);
}finally{f.close();}});

test('changing presence leaves an established call intact and a denied rejoin cannot delete its signals',async()=>{const f=fixture();try{
 const call=await start(f);await join(f,call,member(1),2);await signal(f,call);
 setPresence(f,member(1),'busy');await assert.rejects(join(f,call,member(1),22),/CALL_PRESENCE_UNAVAILABLE/);
 const result=await f.server.teamCallStatus(member(1),{callId:call.id,sessionId:session(2)},f.db);
 assert.equal(result.call.status,'active');assert.equal(result.signals.length,1);assert.equal(result.call.participants.length,2);
}finally{f.close();}});

test('availability is rechecked atomically when the call is created and stays business-scoped',async()=>{const f=fixture();try{
 setPresence(f,{...member(1),ownerUid:foreign.ownerUid},'busy');assert.equal((await start(f)).status,'active');
 const original=f.db.batch;f.db.batch=async statements=>{
  if(statements.some(statement=>statement.sql.startsWith('INSERT OR IGNORE INTO trade_team_calls')))for(let i=1;i<=8;i++)setPresence(f,member(i),'offline');
  return original(statements);
 };
 await assert.rejects(start(f,owner,2,'thread-demo-2'),/CALL_RECIPIENT_UNAVAILABLE/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_team_calls WHERE thread_id=?').get('thread-demo-2').n,0);
}finally{f.close();}});

test('the consolidated projection still rechecks permissions before returning call details',async()=>{const f=fixture();try{
 const call=await start(f);const original=f.db.prepare;
 f.db.prepare=sql=>{
  if(sql.startsWith('SELECT t.kind,t.subject'))f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='owner-0001'");
  return original(sql);
 };
 await assert.rejects(f.server.teamCallStatus(owner,{callId:call.id},f.db),/CALL_ACCESS_REQUIRED/);
}finally{f.close();}});
