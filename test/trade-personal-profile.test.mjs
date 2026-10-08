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
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,manager_name TEXT,phone TEXT,updated_at TEXT);
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT,phone TEXT,updated_at TEXT,
      email TEXT DEFAULT 'member@example.test',role TEXT DEFAULT 'technician',field_username TEXT DEFAULT 'existing-login',
      capabilities TEXT DEFAULT '["insulation"]',can_manage_team INTEGER DEFAULT 0);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_accounts VALUES('business-a','A Business','','0390000000',''),('business-b','B Business','Other owner','0391111111','');
    INSERT INTO trade_team_members(id,owner_uid,member_uid,status,display_name,phone,updated_at)
      VALUES('owner-a','business-a','business-a','active','A Business','+61400000001',''),
      ('member-a','business-a','person-uid','active','Katja Rosic','+61400000002',''),
      ('member-b','business-b','person-uid','active','Other team name','+61400000003','');`);
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
  assert.deepEqual(await f.server.readTradePersonalProfile(owner),{name:'',phone:'+61400000001',isOwner:true});
  assert.deepEqual(await f.server.updateTradePersonalProfile(owner,{name:'  James   Morris  '}),{name:'James Morris',phone:'+61400000001',isOwner:true});
  assert.deepEqual(await f.server.readTradePersonalProfile({...owner}),{name:'James Morris',phone:'+61400000001',isOwner:true});
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='owner-a'").get().display_name,'James Morris');
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='member-a'").get().display_name,'Katja Rosic');
  assert.equal(f.sqlite.prepare("SELECT business_name FROM trade_accounts WHERE firebase_uid='business-a'").get().business_name,'A Business');
  assert.deepEqual(await f.server.updateTradePersonalProfile(owner,{name:''}),{name:'',phone:'+61400000001',isOwner:true});
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='owner-a'").get().display_name,'A Business');
});

test('member My name updates only their membership in the selected business',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.server.updateTradePersonalProfile(teammate,{name:'Katja R'}),{name:'Katja R',phone:'+61400000002',isOwner:false});
  assert.deepEqual(await f.server.readTradePersonalProfile(otherBusiness),{name:'Other team name',phone:'+61400000003',isOwner:false});
  assert.deepEqual(await f.server.readTradePersonalProfile(owner),{name:'',phone:'+61400000001',isOwner:true});
  for(const forged of [{...teammate,isOwner:true},{...teammate,memberId:owner.memberId},{...teammate,ownerUid:'business-b'},
    {...owner,actorUid:teammate.actorUid},{...owner,isOwner:false}]) {
    await assert.rejects(f.server.readTradePersonalProfile(forged),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
    await assert.rejects(f.server.updateTradePersonalProfile(forged,{name:'Forged name',phone:'0412 345 678'}),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  }
  assert.equal((await f.server.readTradePersonalProfile(teammate)).name,'Katja R');
  assert.equal((await f.server.readTradePersonalProfile(owner)).name,'');
});

test('invalid or empty staff names cannot clear existing personal identity',async t=>{
  const f=fixture(t);
  for(const name of [null,12,{},[],true,'x'.repeat(121),'Katja\nR','Katja\u0000R','Katja\u007fR']) {
    await assert.rejects(f.server.updateTradePersonalProfile(teammate,{name}),/PERSONAL_NAME_INVALID/);
  }
  await assert.rejects(f.server.updateTradePersonalProfile(teammate,{name:'  '}),/PERSONAL_NAME_REQUIRED/);
  assert.equal((await f.server.readTradePersonalProfile(teammate)).name,'Katja Rosic');
  assert.equal((await f.server.updateTradePersonalProfile(teammate,{name:'K'.repeat(120)})).name.length,120);
});

test('personal contact phone changes only the actor membership and preserves business, other teams and access fields',async t=>{
  const f=fixture(t);
  const member=id=>f.sqlite.prepare('SELECT * FROM trade_team_members WHERE id=?').get(id);
  const accounts=()=>f.sqlite.prepare('SELECT * FROM trade_accounts ORDER BY firebase_uid').all();
  const beforeAccounts=accounts(),beforeOwner=member('owner-a'),beforeSibling=member('member-b'),beforeSelf=member('member-a');
  assert.deepEqual(await f.server.updateTradePersonalProfile(teammate,{name:'Katja R',phone:'0412 345 678'}),
    {name:'Katja R',phone:'+61412345678',isOwner:false});
  assert.deepEqual(accounts(),beforeAccounts);
  assert.deepEqual(member('owner-a'),beforeOwner);
  assert.deepEqual(member('member-b'),beforeSibling);
  const afterSelf=member('member-a');
  for(const key of ['owner_uid','member_uid','status','email','role','field_username','capabilities','can_manage_team']) assert.equal(afterSelf[key],beforeSelf[key],key);
  assert.equal((await f.server.updateTradePersonalProfile(teammate,{name:'Katja Again'})).phone,'+61412345678');
  assert.equal((await f.server.updateTradePersonalProfile(teammate,{name:'Katja Again',phone:''})).phone,'');
  const beforeStaff=member('member-a');
  assert.deepEqual(await f.server.updateTradePersonalProfile(owner,{name:'James',phone:'03 9123 4567'}),
    {name:'James',phone:'+61391234567',isOwner:true});
  assert.equal(accounts()[0].phone,beforeAccounts[0].phone);
  assert.equal(accounts()[0].business_name,beforeAccounts[0].business_name);
  assert.deepEqual(accounts()[1],beforeAccounts[1]);
  assert.deepEqual(member('member-a'),beforeStaff);
  assert.deepEqual(member('member-b'),beforeSibling);
  for(const key of ['owner_uid','member_uid','status','email','role','field_username','capabilities','can_manage_team']) assert.equal(member('owner-a')[key],beforeOwner[key],key);
});

test('invalid phone input rejects the entire update and standard phone formats persist canonically',async t=>{
  const f=fixture(t),before=f.sqlite.prepare("SELECT * FROM trade_team_members WHERE id='member-a'").get();
  for(const phone of [null,12,{},[],true,undefined,'1'.repeat(41),'12345','1'.repeat(16),'0412abc678','0412\n345678','0412\u0000345678','0412\u007f345678','61+412345678','++61412345678','0012345']) {
    await assert.rejects(f.server.updateTradePersonalProfile(teammate,{name:'Changed name',phone}),/PERSONAL_PHONE_INVALID/);
  }
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM trade_team_members WHERE id='member-a'").get(),before);
  for(const [phone,expected] of [[' (03) 9123-4567 ','+61391234567'],['+61 412 345 678','+61412345678'],
    ['0061 412 345 678','+61412345678'],['０４１２ ３４５ ６７８','+61412345678'],['  ','']]) {
    assert.equal((await f.server.updateTradePersonalProfile(teammate,{name:'Katja',phone})).phone,expected);
  }
});

test('personal update rejects target and permission fields at the server boundary before writing',async t=>{
  const f=fixture(t),before=f.sqlite.prepare('SELECT * FROM trade_team_members ORDER BY id').all();
  for(const changes of [null,'Katja',[],{}, {phone:'0412 345 678'},
    ...['ownerUid','actorUid','memberId','isOwner','email','role','fieldUsername','capabilities','canManageTeam'].map(key=>({name:'Katja',phone:'0412 345 678',[key]:'forged'}))]) {
    await assert.rejects(f.server.updateTradePersonalProfile(teammate,changes),/PERSONAL_PROFILE_INVALID/);
  }
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM trade_team_members ORDER BY id').all(),before);
});

test('active field sessions can update their personal name but revoked, expired and suspended access cannot',async t=>{
  const f=fixture(t),field={...teammate,actorUid:'field-member:member-a',fieldSessionId:'session-a'};
  f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('session-a','business-a','member-a','active',new Date(Date.now()+60000).toISOString());
  assert.equal((await f.server.updateTradePersonalProfile(field,{name:'Katja R',phone:'0412 345 678'})).phone,'+61412345678');
  f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked'");
  await assert.rejects(f.server.updateTradePersonalProfile(field,{name:'Wrong',phone:'0411 111 111'}),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  f.sqlite.exec("UPDATE trade_field_sessions SET status='active',expires_at='2000-01-01'");
  await assert.rejects(f.server.readTradePersonalProfile(field),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  f.beforeMutation(()=>f.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='member-a'"));
  await assert.rejects(f.server.updateTradePersonalProfile(teammate,{name:'Wrong',phone:'0411 111 111'}),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  assert.equal(f.sqlite.prepare("SELECT display_name FROM trade_team_members WHERE id='member-a'").get().display_name,'Katja R');
  assert.equal(f.sqlite.prepare("SELECT phone FROM trade_team_members WHERE id='member-a'").get().phone,'+61412345678');
});

test('concurrent owner suspension and field-session revocation prevent name and phone writes',async t=>{
  const own=fixture(t),beforeOwner=own.sqlite.prepare("SELECT * FROM trade_accounts WHERE firebase_uid='business-a'").get();
  own.beforeMutation(()=>own.sqlite.exec("UPDATE trade_team_members SET status='suspended' WHERE id='owner-a'"));
  await assert.rejects(own.server.updateTradePersonalProfile(owner,{name:'Changed',phone:'0412 345 678'}),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  assert.deepEqual(own.sqlite.prepare("SELECT * FROM trade_accounts WHERE firebase_uid='business-a'").get(),beforeOwner);
  assert.equal(own.sqlite.prepare("SELECT phone FROM trade_team_members WHERE id='owner-a'").get().phone,'+61400000001');
  const f=fixture(t),field={...teammate,actorUid:'field-member:member-a',fieldSessionId:'session-a'};
  f.sqlite.prepare('INSERT INTO trade_field_sessions VALUES(?,?,?,?,?)').run('session-a','business-a','member-a','active',new Date(Date.now()+60000).toISOString());
  const before=f.sqlite.prepare("SELECT * FROM trade_team_members WHERE id='member-a'").get();
  f.beforeMutation(()=>f.sqlite.exec("UPDATE trade_field_sessions SET status='revoked' WHERE id='session-a'"));
  await assert.rejects(f.server.updateTradePersonalProfile(field,{name:'Changed',phone:'0412 345 678'}),/PERSONAL_PROFILE_ACCESS_REQUIRED/);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM trade_team_members WHERE id='member-a'").get(),before);
});

test('owner name and team display projection roll back together when storage fails',async t=>{
  const f=fixture(t);
  f.sqlite.exec("CREATE TRIGGER reject_name BEFORE UPDATE ON trade_team_members BEGIN SELECT RAISE(ABORT,'storage failed'); END");
  await assert.rejects(f.server.updateTradePersonalProfile(owner,{name:'James',phone:'0412 345 678'}),/storage failed/);
  assert.equal((await f.server.readTradePersonalProfile(owner)).name,'');
  assert.equal((await f.server.readTradePersonalProfile(owner)).phone,'+61400000001');
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
  const saved=await route.PATCH(request({name:'  Katja  R '}));assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{ok:true,name:'Katja R',phone:'+61400000002',isOwner:false});
  assert.deepEqual(await (await route.GET(request())).json(),{ok:true,name:'Katja R',phone:'+61400000002',isOwner:false});
  const contact=await route.PATCH(request({name:'Katja R',phone:'0412 345 678'}));assert.equal(contact.status,200);
  assert.deepEqual(await contact.json(),{ok:true,name:'Katja R',phone:'+61412345678',isOwner:false});
  for(const body of [{name:'bad',memberId:'owner-a'},{name:'bad',ownerUid:'business-b'},{name:'bad',isOwner:true},
    {name:'bad',actorUid:'business-a'},{name:'bad',email:'other@example.test'},{name:'bad',role:'owner'},
    {name:'bad',fieldUsername:'new-login'},{name:'bad',canManageTeam:true},{name:'bad',capabilities:['solar']},
    {phone:'0412 345 678'},[],{},'broken']) assert.equal((await route.PATCH(request(body))).status,400);
  const invalidPhone=await route.PATCH(request({name:'Katja R',phone:'not a phone'}));assert.equal(invalidPhone.status,400);
  assert.match((await invalidPhone.json()).error,/valid contact phone/);
  assert.equal((await route.PATCH(request({name:'x'.repeat(1100)}))).status,413);
  assert.equal((await route.PATCH(request({name:''}))).status,400);
  assert.equal((await route.GET(request(undefined,{authorization:'',cookie:'__Host-tlink-comms=test'}))).status,401);
  const prior=calls;assert.equal((await route.PATCH(request({name:'bad'},{origin:'https://evil.test'}))).status,403);assert.equal(calls,prior);
  actor=owner;assert.equal((await route.PATCH(request({name:''}))).status,200);
});
