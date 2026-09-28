import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,deps={}){const record={exports:{}};new Function('require','module','exports',ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>deps[name],record,record.exports);return record.exports;}
const delivery=load('../src/lib/service-reminder-delivery.ts');
const {messageCustomerIdentity}=load('../src/lib/trade-message-customer.ts',{'./service-reminder-delivery':delivery});
function fixture(){const sqlite=new DatabaseSync(':memory:');sqlite.exec("CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,customer_number TEXT,phone TEXT,record_status TEXT)");const stmt=(sql,values=[])=>({bind:(...v)=>stmt(sql,v),all:async()=>({results:sqlite.prepare(sql).all(...values)}),first:async()=>sqlite.prepare(sql).get(...values)||null});return{sqlite,db:{prepare:stmt}};}
test('SMS contact identity normalises Australian mobile formats and stays business-bound',async()=>{const f=fixture();try{
  const a=await messageCustomerIdentity(f.db,'a','0412 345 678'),b=await messageCustomerIdentity(f.db,'a','+61 412 345 678'),other=await messageCustomerIdentity(f.db,'b','0412 345 678');
  assert.equal(a.id,b.id);assert.equal(a.phone,'+61412345678');assert.notEqual(a.id,other.id);await assert.rejects(messageCustomerIdentity(f.db,'a','not a number'),/PHONE_INVALID/);
}finally{f.sqlite.close();}});
test('existing customer is reused, shared numbers require selection, archived contact is not resurrected',async()=>{const f=fixture();try{
  const identity=await messageCustomerIdentity(f.db,'a','0412 345 678');f.sqlite.prepare('INSERT INTO trade_crm_customers VALUES(?,?,?,?,?)').run(identity.id,'a','CUS-ONE','0412 345 678','active');
  f.sqlite.prepare('INSERT INTO trade_crm_customers VALUES(?,?,?,?,?)').run('foreign','b','CUS-OTHER','0412 345 678','active');
  assert.equal((await messageCustomerIdentity(f.db,'a','+61412345678')).existing.customer_number,'CUS-ONE');
  f.sqlite.prepare('INSERT INTO trade_crm_customers VALUES(?,?,?,?,?)').run('second','a','CUS-TWO','+61412345678','active');await assert.rejects(messageCustomerIdentity(f.db,'a','0412345678'),/AMBIGUOUS/);
  f.sqlite.exec("DELETE FROM trade_crm_customers WHERE id='second';UPDATE trade_crm_customers SET record_status='archived' WHERE firebase_uid='a'");await assert.rejects(messageCustomerIdentity(f.db,'a','0412345678'),/ARCHIVED/);
}finally{f.sqlite.close();}});
test('only owner Messages intake relaxes email and reuses canonical atomic customer/contact/site creation',()=>{
  const route=read('../src/app/api/trade-crm/route.ts');assert.match(route,/fromMessages && !identity.access.isOwner/);assert.match(route,/!email && !fromMessages/);assert.match(route,/email && !EMAIL_PATTERN.test\(email\)/);assert.match(route,/ON CONFLICT\(id\) DO NOTHING/);assert.match(route,/fromMessages \? `\$\{id\}-site-contact`/);
});
