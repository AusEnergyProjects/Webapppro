import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { tradeTeamDocumentExpiryStatus } from '../src/lib/trade-team-document-expiry-server.ts';

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => dependencies[id] || {}, record, record.exports);
  return record.exports;
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,display_name TEXT,status TEXT,UNIQUE(owner_uid,id));
    INSERT INTO trade_team_members VALUES('member','owner','Alex Assessor','active');
    CREATE TABLE trade_team_member_credentials(id TEXT,owner_uid TEXT,team_member_id TEXT,credential_type TEXT,name TEXT,
      credential_number TEXT,issuer TEXT,jurisdiction TEXT,rental_gate TEXT,status TEXT,file_id TEXT,expires_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_team_member_events(id TEXT,owner_uid TEXT,team_member_id TEXT,actor_uid TEXT,entity_type TEXT,
      entity_id TEXT,event_type TEXT,metadata TEXT,created_at TEXT);`);
  const original = fs.readFileSync(new URL('../drizzle/0131_trade_team_permissions_and_member_files.sql',import.meta.url),'utf8');
  database.exec(original.match(/CREATE TABLE `trade_team_member_files` \([\s\S]*?\n\);/)[0]);
  database.exec("ALTER TABLE trade_team_member_files ADD COLUMN title TEXT NOT NULL DEFAULT ''; ALTER TABLE trade_team_member_files ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';");
  database.exec(fs.readFileSync(new URL('../drizzle/0235_trade_member_engagement.sql',import.meta.url),'utf8'));
  function statement(sql, values = []) {
    return { bind(...next) { return statement(sql, next); },
      async first() { return database.prepare(sql).get(...values) || null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; } };
  }
  const db = { prepare: statement, async batch(entries) {
    database.exec('BEGIN');
    try { const results=[];for(const entry of entries) results.push(await entry.run());database.exec('COMMIT');return results; }
    catch(error) { database.exec('ROLLBACK');throw error; }
  } };
  const access={ownerUid:'owner',actorUid:'owner',isOwner:true,canManageTeam:false};
  const stored=[]; const downloads=[];
  const route=load('../src/app/api/trade-team/member-files/route.ts',{
    'cloudflare:workers':{env:{EVIDENCE:{put:async(key)=>stored.push(key),get:async(key)=>{downloads.push(key);return stored.includes(key)?{body:'%PDF-1.7\nFixture',httpMetadata:{contentType:'application/pdf'}}:null;},delete:async()=>{}}}},
    '../../../../../db':{getD1:()=>db},
    '@/lib/admin-server':{ mfaErrorResponse,adminJson:(value,status=200)=>Response.json(value,{status}),sameOrigin:()=>true,cleanAdminText:(value,max)=>String(value||'').trim().slice(0,max)},
    '@/lib/trade-team-server':{requireInstallerTeamAccess:async()=>access},
    '@/lib/trade-team-member-files-server':load('../src/lib/trade-team-member-files-server.ts'),
    '@/lib/trade-team-document-expiry-server':{tradeTeamDocumentExpiryStatus},
    '@/lib/trade-team-member-file-cleanup':{drainTradeTeamMemberFileCleanup:async()=>({completed:0,pending:0})},
  });
  async function upload(values={}) {
    const data=new FormData();
    for(const [key,value] of Object.entries({action:'upload',memberId:'member',category:'insurance',title:'Public liability insurance',expiresAt:'2027-01-31',...values})) data.set(key,value);
    data.set('file',new File(['%PDF-1.7\nInsurance certificate'], 'insurance.pdf',{type:'application/pdf'}));
    const request=new Request('https://example.test/api/trade-team/member-files',{method:'POST',body:data});
    request.headers.set('content-length',String((await request.clone().arrayBuffer()).byteLength));
    return route.POST(request);
  }
  return { database,access,stored,downloads,route,upload };
}

test('insurance upload retains its category and expiry without creating a trade credential',async()=>{
  const f=fixture();
  try {
    const response=await f.upload();const body=await response.json();
    assert.equal(response.status,201,JSON.stringify(body));
    assert.equal(body.file.category,'insurance');assert.equal(body.file.expiresAt,'2027-01-31');
    assert.equal(body.file.expiryStatus,tradeTeamDocumentExpiryStatus('2027-01-31'));
    assert.equal(body.file.credential,null);
    const row=f.database.prepare('SELECT category,expires_at,status FROM trade_team_member_files').get();
    assert.deepEqual({...row},{category:'insurance',expires_at:'2027-01-31',status:'active'});
    assert.equal(f.database.prepare('SELECT COUNT(*) count FROM trade_team_member_credentials').get().count,0);
    assert.equal(f.stored.length,1);
    const listed=await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member'));
    assert.equal((await listed.json()).files[0].category,'insurance');
  } finally { f.database.close(); }
});

test('insurance needs a valid expiry and unknown document categories never reach storage',async()=>{
  for(const values of [{expiresAt:''},{expiresAt:'2027-02-30'},{category:'invented'}]) {
    const f=fixture();
    try { assert.equal((await f.upload(values)).status,400);assert.equal(f.stored.length,0); }
    finally { f.database.close(); }
  }
  const f=fixture();
  try { assert.equal((await f.upload({category:'other',expiresAt:''})).status,201); }
  finally { f.database.close(); }
});

test('insurance files retain owner or delegated manager access and do not cross organisations',async()=>{
  for(const values of [{isOwner:false,canManageTeam:false},{ownerUid:'another-business'}]) {
    const f=fixture();
    try { Object.assign(f.access,values);assert.ok([403,404].includes((await f.upload()).status));assert.equal(f.stored.length,0); }
    finally { f.database.close(); }
  }
  const f=fixture();
  try { Object.assign(f.access,{isOwner:false,canManageTeam:true});assert.equal((await f.upload()).status,201); }
  finally { f.database.close(); }
});

test('owner-only contracts use the real file constraints and stay out of general lists and audit titles',async()=>{
  const f=fixture();
  try {
    const response=await f.upload({scope:'employment',category:'other',expiresAt:'',title:'Private agreement at confidential rate'});
    const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));
    assert.equal(f.database.prepare('SELECT owner_private FROM trade_team_member_files').get().owner_private,1);
    const general=await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member'));
    assert.equal((await general.json()).files.length,0);
    const privateList=await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member&scope=employment'));
    assert.equal((await privateList.json()).files[0].id,body.file.id);
    const document=await f.route.GET(new Request(`https://example.test/api/trade-team/member-files?memberId=member&fileId=${body.file.id}`));
    assert.equal(document.status,200);assert.equal(f.downloads.length,1);
    assert.doesNotMatch(JSON.stringify(f.database.prepare('SELECT metadata FROM trade_team_member_events').all()),/confidential rate/);
    Object.assign(f.access,{isOwner:false,canManageTeam:true});
    assert.equal((await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member&scope=employment'))).status,403);
    assert.equal((await f.route.GET(new Request(`https://example.test/api/trade-team/member-files?memberId=member&fileId=${body.file.id}`))).status,404);
    assert.equal((await f.route.DELETE(new Request(`https://example.test/api/trade-team/member-files?memberId=member&fileId=${body.file.id}`,{method:'DELETE'}))).status,404);
    assert.equal(f.downloads.length,1,'denied reads never reach private object storage');
    assert.equal((await f.upload({scope:'employment',category:'other',expiresAt:''})).status,403);
    assert.equal(f.database.prepare('SELECT status FROM trade_team_member_files').get().status,'active');
  } finally {f.database.close();}
});

test('private uploads cannot become shared credentials or renewal alerts and do not consume general capacity',async()=>{
  const f=fixture();
  try {
    assert.equal((await f.upload({scope:'employment',category:'other',expiresAt:'2027-01-01'})).status,400);
    assert.equal((await f.upload({scope:'employment',category:'insurance',expiresAt:''})).status,400);
    const result=await f.upload({scope:'employment',category:'other',expiresAt:''});assert.equal(result.status,201);
    const row=f.database.prepare('SELECT * FROM trade_team_member_files').get();
    const keys=Object.keys(row);const insert=f.database.prepare(`INSERT INTO trade_team_member_files(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`);
    for(let i=1;i<40;i++) insert.run(...keys.map(key=>key==='id'?`private-${i}`:key==='object_key'?`trade-team-members/owner/member/private-${i}`:row[key]));
    Object.assign(f.access,{isOwner:false,canManageTeam:true});
    assert.equal((await f.upload()).status,201,'general manager upload is not blocked by invisible private documents');
    const list=await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member'));
    assert.equal((await list.json()).files.length,1);
    f.access.ownerUid='another-business';f.access.isOwner=true;
    assert.equal((await f.route.GET(new Request('https://example.test/api/trade-team/member-files?memberId=member&scope=employment'))).status,404);
  } finally {f.database.close();}
});
