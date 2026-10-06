import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as portal from '../src/lib/wattzun-portal.ts';

function compile(path,dependencies,transform=source=>source) {
  const output={};
  const code=ts.transpileModule(transform(readFileSync(new URL(path,import.meta.url),'utf8')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(id=>{
    if(typeof dependencies==='function') return dependencies(id);
    assert.ok(Object.hasOwn(dependencies,id),`Unexpected dependency ${id}`);return dependencies[id];
  },output);
  return output;
}
const contract=compile('../src/lib/wattzun-usage.ts',{'./wattzun-portal':portal});
const {recordWattzunUsage,readWattzunUsage,WattzunUsageError}=compile('../src/lib/wattzun-usage-server.ts',{'./wattzun-portal':portal,'./wattzun-usage':contract});
const migration=readFileSync(new URL('../drizzle/0254_wattzun_usage.sql',import.meta.url),'utf8');
const now=new Date('2026-10-06T03:00:00.000Z');
const requestId=index=>`synthetic-request-${String(index).padStart(4,'0')}`;
const access=(db,actorUid='actor-one',portalName='trade',scopeId='business-one')=>({db,actorUid,scope:{portal:portalName,scopeId,label:'Fixture workspace'}});
const unavailable=error=>error instanceof WattzunUsageError&&error.code==='unavailable'&&error.message==='WATTZUN_USAGE_UNAVAILABLE';

function fixture(t,persistent=false) {
  const directory=persistent?mkdtempSync(join(tmpdir(),'wattzun-usage-test-')):null;
  const path=directory?join(directory,'usage.sqlite'):':memory:';
  let sqlite=new DatabaseSync(path);sqlite.exec(migration);
  t.after(()=>{sqlite.close();if(directory){unlinkSync(path);rmdirSync(directory);}});
  const prepare=(sql,values=[])=>({bind:(...args)=>prepare(sql,args),first:async()=>sqlite.prepare(sql).get(...values)||null,
    all:async()=>({success:true,results:sqlite.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}})});
  return {get sqlite(){return sqlite;},db:{prepare},reopen:()=>{sqlite.close();sqlite=new DatabaseSync(path);}};
}

test('successful text and voice usage survives database reopening without conversation content',async t=>{
  const f=fixture(t,true),a=access(f.db);
  await recordWattzunUsage({access:a,requestId:requestId(1),kind:'text'},now);
  await recordWattzunUsage({access:a,requestId:requestId(2),kind:'voice'},now);
  f.reopen();
  assert.deepEqual(await readWattzunUsage(access(f.db),now),{portal:'trade',scopeId:'business-one',month:'2026-10',monthBasis:'UTC',audience:'personal',textMessages:1,voiceExchanges:1});
  assert.deepEqual(f.sqlite.prepare('PRAGMA table_info(wattzun_usage_events)').all().map(column=>column.name),['actor_uid','portal','scope_id','request_id','kind','completed_at']);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM wattzun_usage_events').get().n,2);
});

test('personal counters isolate actor, portal and selected workspace even when request IDs match',async t=>{
  const f=fixture(t),contexts=[access(f.db),access(f.db,'actor-two'),access(f.db,'actor-one','council'),access(f.db,'actor-one','creditex'),access(f.db,'actor-one','trade','business-two')];
  for(const [index,a] of contexts.entries()) await recordWattzunUsage({access:a,requestId:requestId(1),kind:index%2?'voice':'text'},now);
  for(const [index,a] of contexts.entries()){
    const usage=await readWattzunUsage(a,now);assert.equal(usage.textMessages,index%2?0:1);assert.equal(usage.voiceExchanges,index%2?1:0);assert.equal(usage.portal,a.scope.portal);assert.equal(usage.scopeId,a.scope.scopeId);
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM wattzun_usage_events').get().n,5);
});

test('same successful request is idempotent including concurrent calls and cross-month retries',async t=>{
  const f=fixture(t),a=access(f.db),record={access:a,requestId:requestId(1),kind:'text'};
  await Promise.all(Array.from({length:12},()=>recordWattzunUsage(record,now)));
  await recordWattzunUsage(record,new Date('2026-11-01T00:00:00.000Z'));
  assert.equal((await readWattzunUsage(a,now)).textMessages,1);assert.equal((await readWattzunUsage(a,new Date('2026-11-01T00:00:00.000Z'))).textMessages,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM wattzun_usage_events').get().n,1);assert.equal(f.sqlite.prepare('SELECT completed_at FROM wattzun_usage_events').get().completed_at,now.toISOString());
});

test('reusing a request ID for the other kind rejects without changing the original exchange',async t=>{
  const f=fixture(t),a=access(f.db);
  await recordWattzunUsage({access:a,requestId:requestId(1),kind:'text'},now);
  await assert.rejects(recordWattzunUsage({access:a,requestId:requestId(1),kind:'voice'},now),error=>error instanceof WattzunUsageError&&error.code==='conflict');
  const usage=await readWattzunUsage(a,now);assert.equal(usage.textMessages,1);assert.equal(usage.voiceExchanges,0);
});

test('UTC periods handle offset dates, leap years and the December year boundary',()=>{
  for(const [date,month,startsAt,endsAt] of [
    ['2026-10-31T23:30:00-04:00','2026-11','2026-11-01T00:00:00.000Z','2026-12-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z','2026-12','2026-12-01T00:00:00.000Z','2027-01-01T00:00:00.000Z'],
    ['2027-01-01T00:00:00.000Z','2027-01','2027-01-01T00:00:00.000Z','2027-02-01T00:00:00.000Z'],
    ['2028-02-29T12:00:00.000Z','2028-02','2028-02-01T00:00:00.000Z','2028-03-01T00:00:00.000Z'],
  ]) assert.deepEqual(contract.wattzunUsagePeriod(new Date(date)),{month,startsAt,endsAt});
  assert.throws(()=>contract.wattzunUsagePeriod(new Date('invalid')));
});

test('monthly SQL includes the first instant and excludes the next month and year',async t=>{
  const f=fixture(t),a=access(f.db);
  for(const [index,date,kind] of [[1,'2026-11-30T23:59:59.999Z','text'],[2,'2026-12-01T00:00:00.000Z','text'],[3,'2026-12-31T23:59:59.999Z','voice'],[4,'2027-01-01T00:00:00.000Z','voice']]) await recordWattzunUsage({access:a,requestId:requestId(index),kind},new Date(date));
  const december=await readWattzunUsage(a,new Date('2026-12-15T12:00:00.000Z'));assert.equal(december.textMessages,1);assert.equal(december.voiceExchanges,1);
  const january=await readWattzunUsage(a,new Date('2027-01-01T00:00:00.000Z'));assert.equal(january.textMessages,0);assert.equal(january.voiceExchanges,1);
  const empty=await readWattzunUsage(a,new Date('2027-02-01T00:00:00.000Z'));assert.equal(empty.textMessages,0);assert.equal(empty.voiceExchanges,0);
});

test('invalid counts or database failures never become invented zero usage',async()=>{
  const broken={prepare:()=>{throw new Error('private database failure');}};
  await assert.rejects(readWattzunUsage(access(broken),now),unavailable);
  for(const row of [null,{text_messages:-1,voice_exchanges:0},{text_messages:0,voice_exchanges:-1},{text_messages:0.5,voice_exchanges:0},{text_messages:0,voice_exchanges:'0'},{text_messages:Number.MAX_SAFE_INTEGER+1,voice_exchanges:0},{text_messages:0,voice_exchanges:Infinity},{text_messages:NaN,voice_exchanges:0},{}]){
    const db={prepare:()=>({bind:()=>({first:async()=>row})})};await assert.rejects(readWattzunUsage(access(db),now),unavailable);
  }
  await assert.rejects(readWattzunUsage(access({}),new Date('invalid')),unavailable);
});

test('invalid identity, scope, request, kind and dates stop before database work',async()=>{
  let touched=0;const db={prepare:()=>{touched++;throw new Error('unexpected database call');}},a=access(db);
  for(const invalid of [access(db,''),access(db,'x'.repeat(181)),access(db,'actor-one','unknown'),access(db,'actor-one','trade','../foreign'),access(db,'actor-one','trade','x'.repeat(129))]){
    await assert.rejects(recordWattzunUsage({access:invalid,requestId:requestId(1),kind:'text'},now),unavailable);await assert.rejects(readWattzunUsage(invalid,now),unavailable);
  }
  for(const fields of [{requestId:'short'},{requestId:'x'.repeat(73)},{requestId:'bad request identifier'},{kind:'audio'}]) await assert.rejects(recordWattzunUsage({access:a,requestId:requestId(1),kind:'text',...fields},now),unavailable);
  await assert.rejects(recordWattzunUsage({access:a,requestId:requestId(1),kind:'text'},new Date('invalid')),unavailable);assert.equal(touched,0);
});

test('failed and inconsistent database write acknowledgements fail honestly',async()=>{
  for(const result of [{success:false,meta:{changes:1}},{success:true,meta:{changes:-1}},{success:true,meta:{changes:2}},{success:true,meta:{changes:'1'}},{success:true,meta:{changes:0.5}},{success:true,meta:{}},null]){
    const db={prepare:()=>({bind:()=>({run:async()=>result})})};await assert.rejects(recordWattzunUsage({access:access(db),requestId:requestId(1),kind:'text'},now),unavailable);
  }
  const missingDuplicate={prepare:()=>({bind:()=>({run:async()=>({success:true,meta:{changes:0}}),first:async()=>null})})};
  await assert.rejects(recordWattzunUsage({access:access(missingDuplicate),requestId:requestId(1),kind:'text'},now),unavailable);
  const broken={prepare:()=>{throw new Error('private database failure');}};await assert.rejects(recordWattzunUsage({access:access(broken),requestId:requestId(1),kind:'text'},now),unavailable);
});

test('real migration enforces event identity, kind and timestamp boundaries',t=>{
  const f=fixture(t),insert=f.sqlite.prepare('INSERT INTO wattzun_usage_events VALUES(?,?,?,?,?,?)');
  for(const row of [['','trade','scope',requestId(1),'text',now.toISOString()],['actor','public','scope',requestId(1),'text',now.toISOString()],['actor','trade','',requestId(1),'text',now.toISOString()],['actor','trade','scope','short','text',now.toISOString()],['actor','trade','scope',requestId(1),'tts',now.toISOString()],['actor','trade','scope',requestId(1),'text','not-a-date']]) assert.throws(()=>insert.run(...row),/CHECK constraint/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM wattzun_usage_events').get().n,0);
});

test('Drizzle usage schema matches the migration personal key and monthly query index',()=>{
  const schema=compile('../db/schema.ts',createRequire(import.meta.url),source=>source.replace(/^export \* from .*;\r?$/gm,''));
  const config=getTableConfig(schema.wattzunUsageEvents);
  assert.deepEqual(config.columns.map(column=>column.name),['actor_uid','portal','scope_id','request_id','kind','completed_at']);
  assert.deepEqual(config.primaryKeys[0].columns.map(column=>column.name),['actor_uid','portal','scope_id','request_id']);
  assert.deepEqual(config.indexes.find(index=>index.config.name==='wattzun_usage_events_actor_month_idx').config.columns.map(column=>column.name),['actor_uid','portal','scope_id','completed_at','kind']);
});

test('real D1 counts concurrent idempotent completions and rejects kind conflicts',async t=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-01',d1Databases:['DB']});t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');await db.batch(migration.split('--> statement-breakpoint').map(sql=>db.prepare(sql.trim())));
  const a=access(db),record={access:a,requestId:requestId(1),kind:'voice'};await Promise.all(Array.from({length:8},()=>recordWattzunUsage(record,now)));
  assert.equal((await readWattzunUsage(a,now)).voiceExchanges,1);
  await assert.rejects(recordWattzunUsage({...record,kind:'text'},now),error=>error instanceof WattzunUsageError&&error.code==='conflict');
  assert.equal((await readWattzunUsage(access(db,'actor-two'),now)).voiceExchanges,0);
});
