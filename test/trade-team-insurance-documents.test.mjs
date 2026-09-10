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
  database.exec(`CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,display_name TEXT,status TEXT);
    INSERT INTO trade_team_members VALUES('member','owner','Alex Assessor','active');
    CREATE TABLE trade_team_member_files(id TEXT,owner_uid TEXT,team_member_id TEXT,category TEXT,description TEXT,
      title TEXT,expires_at TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,sha256 TEXT,object_key TEXT,status TEXT,
      cleanup_attempts INTEGER,next_cleanup_at TEXT,last_cleanup_error TEXT,uploaded_by_uid TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE trade_team_member_credentials(id TEXT,owner_uid TEXT,team_member_id TEXT,credential_type TEXT,name TEXT,
      credential_number TEXT,issuer TEXT,jurisdiction TEXT,rental_gate TEXT,status TEXT,file_id TEXT,expires_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_team_member_events(id TEXT,owner_uid TEXT,team_member_id TEXT,actor_uid TEXT,entity_type TEXT,
      entity_id TEXT,event_type TEXT,metadata TEXT,created_at TEXT);`);
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
  const stored=[];
  const route=load('../src/app/api/trade-team/member-files/route.ts',{
    'cloudflare:workers':{env:{EVIDENCE:{put:async(key)=>stored.push(key),get:async()=>null,delete:async()=>{}}}},
    '../../../../../db':{getD1:()=>db},
    '@/lib/admin-server':{adminJson:(value,status=200)=>Response.json(value,{status}),sameOrigin:()=>true,cleanAdminText:(value,max)=>String(value||'').trim().slice(0,max)},
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
  return { database,access,stored,route,upload };
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
