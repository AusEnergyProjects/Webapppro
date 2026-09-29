import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as presence from '../src/lib/trade-team-presence.ts';
import * as bounded from '../src/lib/bounded-request-body.mjs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,deps){const compiled=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const out={};Function('require','exports',compiled)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},out);return out;}
const owner={ownerUid:'business-a',actorUid:'owner-uid',memberId:'owner-a'};
const teammate={ownerUid:'business-a',actorUid:'person-uid',memberId:'member-a'};
const otherBusiness={ownerUid:'business-b',actorUid:'person-uid',memberId:'member-b'};
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON; CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_team_members VALUES('owner-a','business-a','owner-uid','active'),('member-a','business-a','person-uid','active'),('member-b','business-b','person-uid','active');`);
  sqlite.exec(read('../drizzle/0219_trade_team_presence.sql'));
  let beforeRun;
  const statement=(sql,values=[])=>({bind:(...next)=>statement(sql,next),first:async()=>sqlite.prepare(sql).get(...values)||null,run:async()=>{if(beforeRun){const action=beforeRun;beforeRun=null;action();}return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}});
  const db={prepare:statement},guards=load('../src/lib/trade-message-media-access.ts',{});
  const server=load('../src/lib/trade-team-presence-server.ts',{'../../db':{getD1:()=>db},'./trade-team-presence':presence,'./trade-message-media-access':guards});
  return {db,sqlite,server,beforeRun:action=>{beforeRun=action;},close:()=>sqlite.close()};
}

test('existing members default Online without rows and explicit settings persist across devices',async()=>{
  const f=fixture();try{
    assert.deepEqual(await f.server.readTradeTeamPresence(owner),{status:'online',updatedAt:''});
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM trade_team_presence').get().count,0);
    const first=await f.server.updateTradeTeamPresence(teammate,'busy');assert.equal(first.status,'busy');assert.ok(Date.parse(first.updatedAt));
    assert.deepEqual(await f.server.readTradeTeamPresence({...teammate}),first);
    assert.equal((await f.server.updateTradeTeamPresence(teammate,'offline')).status,'offline');
    assert.equal((await f.server.updateTradeTeamPresence(teammate,'online')).status,'online');
  }finally{f.close();}
});

test('same login has separate availability in each business and cannot edit another member',async()=>{
  const f=fixture();try{
    await f.server.updateTradeTeamPresence(teammate,'busy');
    assert.equal((await f.server.readTradeTeamPresence(otherBusiness)).status,'online');
    assert.equal((await f.server.readTradeTeamPresence(owner)).status,'online');
    for(const forged of [{...teammate,ownerUid:'business-b'},{...teammate,memberId:owner.memberId},{...owner,actorUid:teammate.actorUid}]){
      await assert.rejects(f.server.readTradeTeamPresence(forged),/PRESENCE_ACCESS_REQUIRED/);
      await assert.rejects(f.server.updateTradeTeamPresence(forged,'offline'),/PRESENCE_ACCESS_REQUIRED/);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM trade_team_presence').get().count,1);
  }finally{f.close();}
});

test('inactive members and revoked or expired field sessions cannot read or change availability',async()=>{
  const f=fixture();try{
    const field={...teammate,actorUid:'field-actor',fieldSessionId:'session'};
    f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('session',teammate.ownerUid,teammate.memberId,'active',new Date(Date.now()+60000).toISOString());
    await f.server.updateTradeTeamPresence(field,'busy');assert.equal((await f.server.readTradeTeamPresence(teammate)).status,'busy');
    f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");await assert.rejects(f.server.updateTradeTeamPresence(field,'online'),/PRESENCE_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_field_sessions SET status='active',expires_at='2000-01-01'");await assert.rejects(f.server.readTradeTeamPresence(field),/PRESENCE_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-a'");await assert.rejects(f.server.readTradeTeamPresence(teammate),/PRESENCE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.updateTradeTeamPresence(teammate,'online'),/PRESENCE_ACCESS_REQUIRED/);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_team_presence WHERE member_id='member-a'").get().status,'busy');
  }finally{f.close();}
});

test('same choice is idempotent and access revocation at write time prevents the mutation',async()=>{
  const f=fixture();try{
    await f.server.updateTradeTeamPresence(teammate,'busy');
    f.sqlite.exec("UPDATE trade_team_presence SET updated_at='2026-01-01T00:00:00.000Z'");
    assert.equal((await f.server.updateTradeTeamPresence(teammate,'busy')).updatedAt,'2026-01-01T00:00:00.000Z');
    f.beforeRun(()=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-a'"));
    await assert.rejects(f.server.updateTradeTeamPresence(teammate,'online'),/PRESENCE_ACCESS_REQUIRED/);
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_team_presence WHERE member_id='member-a'").get().status,'busy');
  }finally{f.close();}
});

test('presence predicates exclude Busy and Offline, retain default Online and scope tenant/member',async()=>{
  const f=fixture();try{
    await f.server.updateTradeTeamPresence(teammate,'busy');await f.server.updateTradeTeamPresence(otherBusiness,'offline');
    const rows=f.sqlite.prepare(`SELECT member.id,${presence.tradeTeamPresenceStatusSql('member.id','member.owner_uid')} status FROM trade_team_members member WHERE ${presence.tradeTeamCallAvailabilitySql('member.id','member.owner_uid')}`).all();
    assert.deepEqual(rows.map(row=>row.id),['owner-a']);assert.equal(rows[0].status,'online');
    assert.equal(f.sqlite.prepare(`SELECT ${presence.tradeTeamCallAvailabilitySql('?','?')} available`).get(teammate.memberId,'business-b').available,1);
    for(const input of [null,'','Online','away',false,{},'offline;DROP'])assert.throws(()=>presence.tradeTeamPresenceStatus(input),/PRESENCE_INPUT_INVALID/);
    for(const invalid of ['member.id; DROP TABLE x','member.id OR 1=1',"'member-id'"])assert.throws(()=>presence.tradeTeamCallAvailabilitySql(invalid,'owner_uid'),/PRESENCE_REFERENCE_INVALID/);
    assert.throws(()=>f.sqlite.exec("INSERT INTO trade_team_presence VALUES('business-a','owner-a','unknown','now')"),/CHECK constraint/);
  }finally{f.close();}
});

function routeFixture({authenticated=true,failure=''}={}){
  const calls=[];class AccessError extends Error {status=403;}
  const route=load('../src/app/api/trade-team-presence/route.ts',{
    '@/lib/admin-server':{sameOrigin:request=>!request.headers.get('origin')||new URL(request.url).origin===request.headers.get('origin'),mfaErrorResponse:()=>null,adminJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})},
    '@/lib/trade-access-server':{TradeAccessError:AccessError},
    '@/lib/trade-communications-access':{requireTeamCommunicationAccess:async()=>{if(!authenticated)throw new Error('AUTH_REQUIRED');return teammate;}},
    '@/lib/bounded-request-body.mjs':bounded,
    '@/lib/trade-team-presence-server':{readTradeTeamPresence:async actor=>{calls.push({actor});if(failure)throw new Error(failure);return {status:'online',updatedAt:''};},updateTradeTeamPresence:async(actor,status)=>{presence.tradeTeamPresenceStatus(status);calls.push({actor,status});if(failure)throw new Error(failure);return {status,updatedAt:'now'};}},
  });
  return {route,calls};
}
const request=(method,body,headers={})=>new Request('https://tlink.test/api/trade-team-presence',{method,headers,...(method==='PATCH'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});

test('route is authenticated, same-origin, no-store and updates only its authenticated member',async()=>{
  for(const method of ['GET','PATCH']){
    let f=routeFixture();assert.equal((await f.route[method](request(method,{status:'busy'},{origin:'https://other.test'}))).status,403);assert.equal(f.calls.length,0);
    f=routeFixture({authenticated:false});assert.equal((await f.route[method](request(method,{status:'busy'}))).status,401);assert.equal(f.calls.length,0);
    f=routeFixture();const response=await f.route[method](request(method,{status:'busy'}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls[0].actor,teammate);
  }
});

test('route refuses unknown statuses, forged targets, oversized input and hides unexpected errors',async()=>{
  for(const value of [null,[],false,'{',{}, {status:'away'},{status:'busy',memberId:owner.memberId},{status:'offline',ownerUid:'business-b'}]){
    const f=routeFixture();assert.equal((await f.route.PATCH(request('PATCH',value))).status,400);assert.equal(f.calls.length,0);
  }
  const large=routeFixture();assert.equal((await large.route.PATCH(request('PATCH',{status:'x'.repeat(300)}))).status,413);assert.equal(large.calls.length,0);
  for(const [failure,status]of [['PRESENCE_ACCESS_REQUIRED',403],['FIELD_SESSION_REVOKED',403],['secret database failure',503]]){
    const f=routeFixture({failure});const response=await f.route.PATCH(request('PATCH',{status:'busy'}));assert.equal(response.status,status);assert.doesNotMatch(JSON.stringify(await response.json()),/secret database/);
  }
});
