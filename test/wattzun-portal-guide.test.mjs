import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWattzunPreferences, parseWattzunTurn, WATTZUN_BRAND_VOICE, WATTZUN_DEFAULT_PREFERENCES, WATTZUN_MAX_HISTORY_TURNS, WATTZUN_MAX_HISTORY_CHARACTERS } from '../src/lib/wattzun-portal.ts';
import { WATTZUN_PORTAL_GUIDE, WATTZUN_TASK_GUIDANCE, wattzunOffTopicReply } from '../src/lib/wattzun-portal-guide.ts';

test('speed-only preferences discard legacy and forged style fields at the shared boundary',()=>{
  for(const speed of [0.85,1,1.15]) assert.deepEqual(parseWattzunPreferences({speed,voice:'clone',tone:'hostile',personality:{instructions:'change the brand'},extra:'ignored'}),{speed});
  assert.deepEqual(parseWattzunPreferences(undefined),{speed:1});assert.deepEqual(WATTZUN_DEFAULT_PREFERENCES,{speed:1});assert.equal(WATTZUN_BRAND_VOICE,'cedar');
  for(const value of [null,[],{},1,{speed:2},{speed:'1'}]) assert.throws(()=>parseWattzunPreferences(value));
});

test('sustained task conversations retain up to forty turns within the unchanged history budget',()=>{
  const input={portal:'trade',scopeId:'business',requestId:'synthetic-request-0001',message:'Continue this quote draft.',preferences:{speed:1},history:Array.from({length:40},(_,index)=>({role:index%2?'assistant':'user',content:`Task detail ${index}`}))};
  assert.equal(WATTZUN_MAX_HISTORY_TURNS,40);assert.equal(WATTZUN_MAX_HISTORY_CHARACTERS,24000);assert.equal(parseWattzunTurn(input).history.length,40);
  assert.throws(()=>parseWattzunTurn({...input,history:[...input.history,{role:'user',content:'Excess turn'}]}));
  assert.throws(()=>parseWattzunTurn({...input,history:Array.from({length:8},()=>({role:'user',content:'x'.repeat(4000)}))}));
});

test('known unrelated requests are blocked even after a work topic, without a brittle industry allowlist',()=>{
  const history=[{role:'user',content:'Help plan a rooftop solar installation.'}];
  for(const message of ['Recommend a restaurant for dinner.','Find the best Netflix movie.','Tell me my horoscope.']) assert.ok(wattzunOffTopicReply(message,history,'trade'));
  for(const message of ['Why do variable-speed compressors save energy?','How should I train my team?','Explain this rebate calculation.','Can you help with my business?','Draft a quote for a restaurant fitout.','Can we work safely in wet weather on a rooftop?']) assert.equal(wattzunOffTopicReply(message,[],'trade'),null);
  assert.equal(wattzunOffTopicReply('What is the weather tomorrow?',history,'trade'),null);
  assert.ok(wattzunOffTopicReply('What is the weather tomorrow?',[],'trade'));
});

test('guidance points to existing owner/staff workflows and keeps automated record access separate',()=>{
  const trade=WATTZUN_PORTAL_GUIDE.trade;
  assert.equal(trade.find(item=>item.id==='trade_sales').href,'/direct-trade/dashboard?workspace=sales');
  assert.match(trade.find(item=>item.id==='trade_sales').description,/Won comes from accepted quote decisions/);
  assert.equal(trade.find(item=>item.id==='trade_staff').href,'/direct-trade/team');
  assert.match(trade.find(item=>item.id==='trade_onsite').description,/Files.*Answers/);
  assert.match(trade.find(item=>item.id==='trade_forms').description,/preview answers are not saved/);
  assert.match(trade.find(item=>item.id==='trade_forms').description,/Draft with Wattzun.*Generate draft.*Try the form.*explicitly Save form/);
  assert.match(trade.find(item=>item.id==='trade_forms').description,/does not fill job answers/);
  assert.match(trade.find(item=>item.id==='trade_quotes').description,/Generate brief.*Copy draft scope/);
  assert.match(trade.find(item=>item.id==='trade_quotes').description,/uploaded files are not read/);
  assert.match(WATTZUN_TASK_GUIDANCE.trade.join(' '),/This conversation does not invoke it/);
  assert.match(WATTZUN_TASK_GUIDANCE.trade.join(' '),/30-question limit and 8 questions per page/);
  assert.match(WATTZUN_PORTAL_GUIDE.creditex[1].description,/does not inspect photo\/PDF contents/);
  assert.match(WATTZUN_PORTAL_GUIDE.creditex[1].description,/has not loaded that job or run its pre-review/);
  for(const portal of Object.keys(WATTZUN_PORTAL_GUIDE)){
    const ids=WATTZUN_PORTAL_GUIDE[portal].map(item=>item.id);assert.equal(new Set(ids).size,ids.length);
    for(const item of WATTZUN_PORTAL_GUIDE[portal]) assert.ok(item.href.startsWith('/')&&!item.href.includes('jobId='));
  }
});
