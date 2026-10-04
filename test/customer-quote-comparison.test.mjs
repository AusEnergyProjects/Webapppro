import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as roof from '../src/lib/trade-quote-roof-image.ts';
import * as equipment from '../src/lib/trade-quote-equipment.ts';
import * as documents from '../src/lib/trade-quote-product-documents.ts';
import * as priceDocuments from '../src/lib/trade-price-book-documents.ts';
import {canonicalGoogleBusinessProfileUrl} from '../src/lib/trade-google-business-profile.mjs';

function load(path,dependencies){const exports={};const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  Function('require','exports',source)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},exports);return exports;}
const review=load('../src/lib/trade-quote-review-server.ts',{'../../db':{},'@/lib/admin-server':{},'@/lib/trade-quote-links':{},'@/lib/trade-access-server':{},
  './trade-google-business-profile.mjs':{canonicalGoogleBusinessProfileUrl},'./trade-quote-roof-image':roof,'./trade-quote-equipment':equipment,'./trade-quote-product-documents':documents,'./trade-price-book-documents':priceDocuments});
const snapshot={schemaVersion:'trade-quote-document-v1',quoteId:'quote',quoteVersionId:'version',quoteNumber:'Q-1',versionNumber:1,
  work:{id:'job'},customer:{id:'customer',email:'private@example.invalid'},site:{id:'site',addressLine1:'PRIVATE ADDRESS'},business:{name:'Business',email:'private-business@example.invalid'},
  totalCents:123400,customerMessage:'Replace the hot water system',terms:'Excludes asbestos removal',validUntil:'2099-01-01',
  items:[{id:'item',description:'Hot water system',quantityMilli:1000,unitPriceCents:123400,subtotalCents:123400,taxCents:0,totalCents:123400}],
  choices:[{id:'extra',kind:'addon',groupKey:'extras',name:'Extra pipework',summary:'If selected',totalCents:22000,subtotalCents:22000,taxCents:0,items:[]}]};
const record=()=>({id:'link',status:'active',token_hash:'PRIVATE TOKEN',quote_id:'quote',quote_version_id:'version',work_order_id:'job',crm_customer_id:'customer',
  version_status:'issued',version_number:1,current_version_number:1,expires_at:'2099-01-01T00:00:00Z',valid_until:'2099-01-01',document_snapshot_json:JSON.stringify(snapshot)});
function comparison(get){return load('../src/lib/customer-quote-comparison-server.ts',{'./customer-quote-hub-server':{hubQuoteRecord:get},'./trade-quote-review-server':review}).hubQuoteComparison;}

test('comparison projects the bound issued document with options separate from base and no credentials or contact details',async()=>{
  const calls=[];const compare=comparison(async(db,token,id)=>{calls.push({db,token,id});return {link:record()};});const db={};
  const result=await compare(db,'customer-capability','link');assert.equal(calls.length,2);assert.deepEqual(calls[0],{db,token:'customer-capability',id:'link'});
  assert.equal(result.totalCents,123400);assert.equal(result.choices[0].totalCents,22000);assert.equal(result.scope,snapshot.customerMessage);assert.equal(result.terms,snapshot.terms);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private@|private-business|customer-capability/);assert.equal(result.items[0].description,'Hot water system');
});
test('foreign customer, job, quote or version snapshots never enter a comparison',async()=>{
  for(const change of [{quoteId:'foreign'},{quoteVersionId:'foreign'},{work:{id:'foreign'}},{customer:{id:'foreign'}}]){
    const link={...record(),document_snapshot_json:JSON.stringify({...snapshot,...change})};await assert.rejects(()=>comparison(async()=>({link}))({},'token','link'),/CUSTOMER_HUB_ACCESS_ENDED/);
  }
});
test('expired, decided, superseded and invalid documents cannot be compared',async()=>{
  for(const change of [{status:'accepted'},{status:'declined'},{expires_at:'2020-01-01'},{valid_until:'2020-01-01'},{version_status:'draft'},{current_version_number:2},{document_snapshot_json:'broken'}]){
    await assert.rejects(()=>comparison(async()=>({link:{...record(),...change}}))({},'token','link'),/CUSTOMER_HUB_ACCESS_ENDED/);
  }
});
test('authority is rechecked after loading and a revoked or changed document is withheld',async()=>{
  for(const change of [null,{status:'accepted'},{expires_at:'2020-01-01'},{valid_until:'2020-01-01'},{version_status:'draft'},{current_version_number:2},{token_hash:'changed'},{document_snapshot_json:JSON.stringify({...snapshot,terms:'changed'})}]){
    let reads=0;const compare=comparison(async()=>{if(++reads===1)return {link:record()};if(!change)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');return {link:{...record(),...change}};});
    await assert.rejects(()=>compare({},'token','link'),/CUSTOMER_HUB_ACCESS_ENDED/);assert.equal(reads,2);
  }
});
