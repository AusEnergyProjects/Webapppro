import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as calls from '../src/lib/trade-team-calls.ts';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const cryptoLib = load('../src/lib/trade-integration-crypto.ts', { 'cloudflare:workers': { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') } }, '@/lib/trade-integration-state': {} });
const account = load('../src/lib/trade-access-server.ts', { '../../db': {}, './firebase-server': {}, './creditex-schema-guards': {}, './trade-abn': {}, './trade-mfa-server': {} });
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,business_name TEXT,abn TEXT,partner_type TEXT,account_status TEXT,verification_status TEXT,verified_abn TEXT,verification_review_id TEXT,verification_reviewed_at TEXT,verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews(id TEXT PRIMARY KEY,firebase_uid TEXT,abn TEXT,business_name TEXT,partner_type TEXT,decision TEXT,review_method TEXT,reviewed_by_uid TEXT,reviewed_at TEXT);
    INSERT INTO trade_accounts VALUES('business-a','Synthetic A','51824753556','installer','active','approved','51824753556','review-a','2026-01-01','admin');
    INSERT INTO trade_account_verification_reviews VALUES('review-a','business-a','51824753556','Synthetic A','installer','approved','official_abr_lookup','admin','2026-01-01');
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,display_name TEXT);
    INSERT INTO trade_team_members VALUES('owner','business-a','business-a','active','James'),('jane','business-a','jane-uid','active','Jane'),('john','business-a','','active','John');
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT,device_id TEXT);
    INSERT INTO trade_field_sessions VALUES('field-john','business-a','john','active','2099-01-01','mobile-john');
    CREATE TABLE trade_mobile_devices(id TEXT PRIMARY KEY,owner_uid TEXT,member_id TEXT,device_id TEXT,actor_uid TEXT,status TEXT,platform TEXT,push_provider TEXT,push_token TEXT,updated_at TEXT,voip_push_token TEXT,native_call_capable INTEGER);
    INSERT INTO trade_mobile_devices VALUES('phone-john','business-a','john','mobile-john','field-member:john','active','ios','apns','','2026-01-01','synthetic-voip',1),('phone-jane','business-a','jane','mobile-jane','jane-uid','active','android','fcm','synthetic-fcm','2026-01-01','',1);
    CREATE TABLE trade_team_calls(id TEXT PRIMARY KEY,owner_uid TEXT,thread_id TEXT,created_by_member_id TEXT,created_at TEXT,expires_at TEXT,status TEXT);
    INSERT INTO trade_team_calls VALUES('call-one','business-a','thread-one','owner','','2099-01-01','active'),('call-other','business-a','thread-other','owner','','2099-01-01','active');
    CREATE TABLE trade_message_participants(owner_uid TEXT,member_id TEXT,thread_id TEXT);
    INSERT INTO trade_message_participants VALUES('business-a','john','thread-one'),('business-a','jane','thread-one');`);
  sqlite.prepare('UPDATE trade_team_calls SET created_at=?').run(new Date().toISOString());
  const statement = (sql, values = []) => ({ bind: (...args) => statement(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null });
  const db = { prepare: statement };
  const api = load('../src/lib/trade-call-answer-access.ts', { '../../db': { getD1: () => db }, './trade-access-server': account, './trade-integration-crypto': cryptoLib, './trade-team-calls': calls });
  const mint = (deviceRegistrationId = 'phone-john') => api.createTeamCallAnswerToken({ callId: 'call-one', threadId: 'thread-one', deviceRegistrationId }, db);
  const access = (token, input = {}, method = 'POST', headers = {}) => api.requireTeamCallAnswerAccess(new Request('https://tlink.test/api/trade-team-calls', { method, headers: { 'X-TLink-Call-Answer': token, ...headers } }), { action: method === 'POST' ? 'join' : 'status', callId: 'call-one', threadId: 'thread-one', ...input }, db);
  return { sqlite, api, db, mint, access, close: () => sqlite.close() };
}

test('call-only grant restores exact field or Firebase actor without a CRM token and expires within one hour', async () => {
  const f = fixture();
  try {
    for (const [device,member,session] of [['phone-john','john','field-john'],['phone-jane','jane',undefined]]) {
      const token = await f.mint(device);
      assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/); assert.ok(token.length <= 3072);
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      assert.ok(claims.e - claims.i <= 3600000); assert.doesNotMatch(JSON.stringify(claims), /synthetic-voip|synthetic-fcm|email|displayName/);
      for (const action of ['join','leave','signal','ice']) {
        const result = await f.access(token, { action });
        assert.equal(result.actor.memberId, member); assert.equal(result.actor.ownerUid, 'business-a'); assert.equal(result.actor.fieldSessionId, session);
        assert.equal(result.callId, 'call-one'); assert.equal(result.threadId, 'thread-one');
      }
      for (const action of ['status','incoming']) assert.equal((await f.access(token, {action}, 'GET')).actor.memberId, member);
    }
  } finally { f.close(); }
});

test('grant rejects tampering, other calls/threads/business, broad list and starts', async () => {
  const f = fixture();
  try {
    const token = await f.mint();
    for (const bad of ['', token.slice(0,-1) + (token.endsWith('0') ? '1' : '0'), token + '.extra', 'x'.repeat(4000)]) await assert.rejects(f.access(bad), /CALL_ACCESS_REQUIRED/);
    for (const input of [{action:'start'},{callId:'call-other'},{threadId:'thread-other'},{callId:undefined},{action:'incoming'}]) await assert.rejects(f.access(token,input), /CALL_ACCESS_REQUIRED/);
    await assert.rejects(f.access(token, {}, 'POST', {'X-TLink-Business':'other-business'}), /CALL_ACCESS_REQUIRED/);
    await assert.rejects(f.api.requireTeamCallAnswerAccess(new Request('https://tlink.test/api/trade-messages',{headers:{'X-TLink-Call-Answer':token}}),{action:'status',callId:'call-one'},f.db),/CALL_ACCESS_REQUIRED/);
    const value = token.split('.').slice(0,2).join('.');
    const otherPurpose = `${value}.${await cryptoLib.keyedProtectedAuditHash('different-purpose',value)}`;
    await assert.rejects(f.access(otherPurpose), /CALL_ACCESS_REQUIRED/);
  } finally { f.close(); }
});

test('grant expiry is enforced independently of call and current device lifetime', async context => {
  const f = fixture();
  try {
    const token = await f.mint(); const now = Date.now();
    context.mock.method(Date,'now',()=>now+3600001);
    await assert.rejects(f.access(token),/CALL_ACCESS_REQUIRED/);
  } finally { context.mock.restoreAll(); f.close(); }
});

for (const [name, sql] of [
  ['revoked phone',"UPDATE trade_mobile_devices SET status='revoked' WHERE id='phone-john'"],
  ['disabled member',"UPDATE trade_team_members SET status='disabled' WHERE id='john'"],
  ['removed conversation member',"DELETE FROM trade_message_participants WHERE member_id='john'"],
  ['revoked field session',"UPDATE trade_field_sessions SET status='revoked'"],
  ['expired field session',"UPDATE trade_field_sessions SET expires_at='2000-01-01'"],
  ['replacement field session',"UPDATE trade_field_sessions SET id='new-session'"],
  ['changed registration actor',"UPDATE trade_mobile_devices SET actor_uid='somebody-else' WHERE id='phone-john'"],
  ['rotated push token',"UPDATE trade_mobile_devices SET voip_push_token='replacement' WHERE id='phone-john'"],
  ['unverified business',"UPDATE trade_accounts SET verification_status='pending'"],
  ['invalid ABN',"UPDATE trade_accounts SET abn='11111111111',verified_abn='11111111111'"],
  ['expired call',"UPDATE trade_team_calls SET expires_at='2000-01-01' WHERE id='call-one'"],
  ['business switch on same installation',"INSERT INTO trade_mobile_devices SELECT 'new-phone','business-other',member_id,device_id,actor_uid,status,platform,push_provider,push_token,'2027-01-01',voip_push_token,native_call_capable FROM trade_mobile_devices WHERE id='phone-john'"],
]) test(`grant immediately rejects ${name}`, async () => {
  const f = fixture(); try { const token = await f.mint(); f.sqlite.exec(sql); await assert.rejects(f.access(token),/CALL_ACCESS_REQUIRED/); } finally { f.close(); }
});

test('issuance rejects retired call or an unregistered/unentitled recipient',async()=>{
  const f=fixture();try{
    await assert.rejects(f.mint('unknown'),/CALL_ACCESS_REQUIRED/);
    f.sqlite.exec("UPDATE trade_team_calls SET status='ended' WHERE id='call-one'");
    await assert.rejects(f.mint(),/CALL_ACCESS_REQUIRED/);
  }finally{f.close();}
});

test('issuance stops at the unanswered ringing deadline independently of push fanout',async()=>{
 const f=fixture();try{
  f.sqlite.prepare('UPDATE trade_team_calls SET created_at=?').run(new Date(Date.now()-46000).toISOString());
  await assert.rejects(f.mint(),/CALL_ACCESS_REQUIRED/);
 }finally{f.close();}
});
