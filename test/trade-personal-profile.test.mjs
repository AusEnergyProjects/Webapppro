import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-request-body.mjs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, dependencies) {
  const compiled = ts.transpileModule(read(path), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const out = {};
  Function('require','exports',compiled)(name => {assert.ok(Object.hasOwn(dependencies,name),name); return dependencies[name];}, out);
  return out;
}
const owner = {ownerUid:'business-a',actorUid:'business-a',memberId:'owner-a',isOwner:true};
const teammate = {ownerUid:'business-a',actorUid:'person-uid',memberId:'member-a',isOwner:false};
const otherBusiness = {...teammate,ownerUid:'business-b',memberId:'member-b'};
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,manager_name TEXT,updated_at TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT,updated_at TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_accounts VALUES('business-a','A Business','',''),('business-b','B Business','Other owner','');
    INSERT INTO trade_team_members VALUES('owner-a','business-a','business-a','active','A Business',''),
      ('member-a','business-a','person-uid','active','Katja Rosic',''),('member-b','business-b','person-uid','active','Other team name','');`);
  let beforeMutation;
  const statement = (sql,values=[]) => ({bind:(...next)=>statement(sql,next),first:async()=>sqlite.prepare(sql).get(...values)||null,
    run:async()=>{if(beforeMutation){const action=beforeMutation;beforeMutation=null;action();}return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}});
  const db = {prepare:statement,async batch(statements){
    sqlite.exec('BEGIN');
    try {const result=[];for(const next of statements)result.push(await next.run());sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  const server = load('../src/lib/trade-personal-profile-server.ts',{'../../db':{getD1:()=>db},'./trade-message-media-access':load('../src/lib/trade-message-media-access.ts',{})});
  return {sqlite,server,beforeMutation:action=>{beforeMutation=action;}};
}

test('owner My name persists canonically and immediately updates the shared team identity without changing business or other staff',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.server.readTradePersonalProfile(owner),{name:'',isOwner:true});
  assert.deepEqual(await f.server.updateTradePersonalProfile(owner,'  James   Morris  '),{name:'James Morris',isOwner:true});
  assert.deepEqual(await f.server.readTradePersonalProfile({...owner}),{name:'James Morris',isOwner:true});
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='owner-a'").get().display_name,'James Morris');
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='member-a'").get().display_name,'Katja Rosic');
  assert.equal(f.sqlite.prepare("SELECT business_name FROM trade_accounts WHERE firebase_uid='business-a'").get().business_name,'A Business');
  assert.deepEqual(await f.server.updateTradePersonalProfile(owner,''),{name:'',isOwner:true});
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='owner-a'").get().display_name,'A Business');
});

test('member My name updates only their membership in the selected business',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.server.updateTradePersonalProfile(teammate,'Katja R'),{name:'Katja R',isOwner:false});
  assert.deepEqual(await f.server.readTradePersonalProfile(otherBusiness),{name:'Other team name',isOwner:false});
  assert.deepEqual(await f.server.readTradePersonalProfile(owner),{name:'',isOwner:true});
  for(const forged of [{...teammate,isOwner:true},{...teammate,memberId:owner.memberId},{...teammate,ownerUid:'business-b'},
    {...owner,actorUid:teammate.actorUid},{...owner,isOwner:false}]) {
    await assert.rejects(f.server.readTradePersonalProfile(forged),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.updateTradePersonalProfile(forged,'Forged name'),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  }
  assert.equal((await f.server.readTradePersonalProfile(teammate)).name,'Katja R');
  assert.equal((await f.server.readTradePersonalProfile(owner)).name,'');
});

test('invalid or empty staff names cannot clear existing personal identity',async t=>{
  const f=fixture(t);
  for(const name of [null,12,{},[],true,'x'.repeat(121),'Katja\nR','Katja\u0000R','Katja\u007fR']) {
    await assert.rejects(f.server.updateTradePersonalProfile(teammate,name),/PERSONAL_NAME_INVALID/);
  }
  await assert.rejects(f.server.updateTradePersonalProfile(teammate,'  '),/PERSONAL_NAME_REQUIRED/);
  assert.equal((await f.server.readTradePersonalProfile(teammate)).name,'Katja Rosic');
  assert.equal((await f.server.updateTradePersonalProfile(teammate,'K'.repeat(120))).name.length,120);
});

test('active field sessions can update their personal name but revoked, expired and suspended access cannot',async t=>{
  const f=fixture(t),field={...teammate,actorUid:'field-member:member-a',fieldSessionId:'session-a'};
  f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('session-a','business-a','member-a','active',new Date(Date.now()+60000).toISOString());
  assert.equal((await f.server.updateTradePersonalProfile(field,'Katja R')).name,'Katja R');
  f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");
  await assert.rejects(f.server.updateTradePersonalProfile(field,'Wrong'),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  f.sqlite.exec("UPDATE trade_field_sessions SET status='active',expires_at='2000-01-01'");
  await assert.rejects(f.server.readTradePersonalProfile(field),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  f.beforeMutation(()=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-a'"));
  await assert.rejects(f.server.updateTradePersonalProfile(teammate,'Wrong'),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='member-a'").get().display_name,'Katja R');
});

test('owner name and team display projection roll back together when storage fails',async t=>{
  const f=fixture(t);
  f.sqlite.exec("CREATE TRIGGER reject_name BEFORE UPDATE ON trade_team_members BEGIN SELECT RAISE(ABORT,'storage failed'); END");
  await assert.rejects(f.server.updateTradePersonalProfile(owner,'James'),/storage failed/);
  assert.equal((await f.server.readTradePersonalProfile(owner)).name,'');
});

test('personal profile route requires token identity, rejects arbitrary targets and returns exact canonical name',async t=>{
  const f=fixture(t);let actor=teammate;let calls=0;
  class TradeAccessError extends Error {}
  class TradeBusinessContextError extends Error {}
  const route=load('../src/app/api/trade-personal-profile/route.ts',{
    '@/lib/admin-server':{adminJson:(body,status=200)=>Response.json(body,{status}),mfaErrorResponse:()=>null,sameOrigin:request=>request.headers.get('origin')!=='https://evil.test'},
    '@/lib/trade-access-server':{TradeAccessError},'@/lib/trade-business-context-server':{TradeBusinessContextError},
    '@/lib/trade-communications-access':{requireTeamCommunicationIdentity:async request=>{calls++;if(!request.headers.get('authorization'))throw new Error('AUTH_REQUIRED');return actor;}},
    '@/lib/bounded-request-body.mjs':bounded,'@/lib/trade-personal-profile-server':f.server,
  });
  const request=(body,headers={})=>new Request('https://example.test/api/trade-personal-profile',{method:body===undefined?'GET':'PATCH',headers:{authorization:'Bearer fixture',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  const saved=await route.PATCH(request({name:'  Katja  R '}));assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{ok:true,name:'Katja R',isOwner:false});
  assert.deepEqual(await (await route.GET(request())).json(),{ok:true,name:'Katja R',isOwner:false});
  for(const body of [{name:'bad',memberId:'owner-a'},{name:'bad',ownerUid:'business-b'},{name:'bad',isOwner:true},[],{},'broken']) assert.equal((await route.PATCH(request(body))).status,400);
  assert.equal((await route.PATCH(request({name:'x'.repeat(1100)}))).status,413);
  assert.equal((await route.PATCH(request({name:''}))).status,400);
  assert.equal((await route.GET(request(undefined,{authorization:'',cookie:'__Host-tlink-comms=test'}))).status,401);
  const prior=calls;assert.equal((await route.PATCH(request({name:'bad'},{origin:'https://evil.test'}))).status,403);assert.equal(calls,prior);
  actor=owner;assert.equal((await route.PATCH(request({name:''}))).status,200);
});
