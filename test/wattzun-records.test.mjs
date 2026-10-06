import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWattzunRecordLookup, readWattzunJobMatches, wattzunJobHref } from '../src/lib/wattzun-records.ts';

test('job lookup accepts a bounded user search and rejects forged navigation fields',()=>{
  assert.deepEqual(parseWattzunRecordLookup({kind:'job',query:'  TL100  '}),{kind:'job',query:'TL100'});
  assert.deepEqual(parseWattzunRecordLookup({kind:'file',query:''}),{kind:'file',query:''});
  for(const value of [null,[],{kind:'customer',query:'A'},{kind:'job',query:'A',href:'https://evil.invalid'},{kind:'job',query:'a'.repeat(101)},{kind:'file',query:'A\nB'}]) assert.throws(()=>parseWattzunRecordLookup(value));
});
test('search results expose only validated already-projected metadata and generate known job destinations',()=>{
  assert.deepEqual(readWattzunJobMatches([{id:'job-1',title:'Site inspection',workNumber:'TL100',customerEmail:'not-rendered@example.invalid'}]),[{id:'job-1',title:'Site inspection',workNumber:'TL100'}]);
  assert.equal(wattzunJobHref('job:1','job'),'/direct-trade/dashboard?workspace=work&jobId=job%3A1&jobTab=summary');
  assert.equal(wattzunJobHref('job-1','file'),'/direct-trade/dashboard?workspace=work&jobId=job-1&jobTab=field');
  for(const value of [{},[{}],[{id:'../escape',title:'A',workNumber:'TL1'}],Array(21).fill({id:'a',title:'A',workNumber:'TL1'})]) assert.throws(()=>readWattzunJobMatches(value));
  assert.throws(()=>wattzunJobHref('https://evil.invalid','file'));
});
