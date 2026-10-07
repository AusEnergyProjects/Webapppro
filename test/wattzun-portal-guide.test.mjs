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

test('off-topic reminders describe only the current portal role',()=>{
  for(const [portal,expected,unrelated] of [
    ['trade',/TLink jobs, quotes, customers and day-to-day trade work/,/Council|Creditex|audits/],
    ['council',/Council campaigns, resident communications and reporting/,/Creditex|trade work|quotes|invoices/],
    ['creditex',/Creditex audits, compliance questions and correction notes/,/Council|trade work|quotes|invoices/],
  ]){
    const reply=wattzunOffTopicReply('Recommend a restaurant for dinner.',[],portal);
    assert.match(reply.message,expected);assert.doesNotMatch(reply.message,unrelated);
    assert.deepEqual(reply.links,[{label:WATTZUN_PORTAL_GUIDE[portal][0].label,href:WATTZUN_PORTAL_GUIDE[portal][0].href}]);
    assert.deepEqual(reply.questions,[]);
  }
});

test('Council drafting preserves supplied logistics without inventing free entry or promised benefits',()=>{
  const guidance=WATTZUN_TASK_GUIDANCE.council.join(' ');
  assert.match(guidance,/Never add a price, free entry, refreshments, speakers, booking link, eligibility, council endorsement or promised savings unless supplied by the user or present in the selected source/);
  assert.match(guidance,/Earlier assistant drafts are not evidence for these facts; remove unsupported wording when revising a draft/);
  assert.match(guidance,/If cost is unknown, omit cost wording rather than calling an event free or delaying an otherwise useful draft/);
  assert.match(guidance,/Carry supplied logistics forward and apply corrections to the same draft without re-asking answered questions/);
});

test('price-book guidance maps a supplied installation unit without asking for it again',()=>{
  assert.match(WATTZUN_TASK_GUIDANCE.trade.join(' '),/Use the canonical itemType and unitLabel values in the action schema/);
  assert.match(WATTZUN_TASK_GUIDANCE.trade.join(' '),/price per installation, per item or per system means each; retain that supplied charging description/);
});

test('guided trade forms record ordinary answers and complete only through real requirements and separate consent',()=>{
  const guidance=WATTZUN_TASK_GUIDANCE.trade.join(' '),onsite=WATTZUN_PORTAL_GUIDE.trade.find(item=>item.id==='trade_onsite').description;
  assert.match(onsite,/Fill by voice.*guided conversation/);
  assert.match(onsite,/without a save review every time/);
  assert.match(onsite,/cancellation or a failed upload does not advance/);
  assert.match(onsite,/required answers, evidence and signatures are satisfied and you separately confirm completion/);
  assert.match(guidance,/Outside an active guided session.*concrete answer review/);
  assert.match(guidance,/server-owned formGuideProgress.*without repeatedly asking to save it/);
  assert.match(guidance,/Do not invent measurements, attest on another person's behalf, draw signatures or approve products/);
  assert.match(guidance,/specific form_step action after the user explicitly confirms that step/);
  assert.match(guidance,/Product search is read-only; clarify ambiguous matches before selection/);
  assert.match(guidance,/calculator result remains subject to Creditex review and does not approve certificates or eligibility/);
  assert.match(guidance,/Ask briefly for the required signature or onscreen declaration confirmation; do not read the whole declaration aloud/);
  assert.match(guidance,/Spoken agreement cannot record a declaration or create a signature/);
  assert.doesNotMatch(guidance,/record the user's own declaration/);
  assert.match(guidance,/Final completion uses complete_form.*separate explicit current completion approval/);
  assert.doesNotMatch(guidance,/Do not.*or submit the form/);
});

test('guided input is limited to one selected trade form and cannot smuggle server progress or reviewed workflows',()=>{
  const formGuide={sessionId:'00000000-0000-4000-8000-000000000001',stage:'continue',authorization:'ordinary_form_answers',sourceSha256:'a'.repeat(64),questionKey:'notes',skippedFieldKeys:[]};
  const input={portal:'trade',scopeId:'business',requestId:'synthetic-request-0001',message:'Continue this form.',preferences:{speed:1},history:[],workReference:{kind:'trade_form',formKind:'job_form',recordId:'form-one',jobId:'job-one'},formGuide};
  assert.deepEqual(parseWattzunTurn(input).formGuide,formGuide);
  const serverForged={state:'complete',completion:{ready:true},counts:{answered:999}};
  const parsed=parseWattzunTurn({...input,formGuideProgress:serverForged,receipt:{status:'saved'}});
  assert.equal(parsed.formGuideProgress,undefined);assert.equal(parsed.receipt,undefined);
  for(const change of [{portal:'council'},{portal:'creditex'},{workReference:undefined},{workReference:{kind:'trade_job',recordId:'job-one'}},
    {workflowReviewId:'review-current-00000001'},{workflowProposal:{kind:'complete_form',jobQuery:'',jobId:'job-one',formKind:'job_form',formId:'form-one'}}]) assert.throws(()=>parseWattzunTurn({...input,...change}));
  for(const invalid of [null,[],{...formGuide,authorization:'all_actions'},{...formGuide,sourceSha256:'bad'},{...formGuide,questionKey:undefined},{...formGuide,completion:{ready:true}},{...formGuide,sessionId:'not-a-session'}]) assert.throws(()=>parseWattzunTurn({...input,formGuide:invalid}));
  for(const control of [null,{kind:'form_guide_control',command:'invented',fieldKey:'notes'},{kind:'form_guide_control',command:'skip',fieldKey:''},{kind:'form_guide_control',command:'pause',fieldKey:'notes',extra:true}]) assert.throws(()=>parseWattzunTurn({...input,formGuideControl:control}));
  assert.throws(()=>parseWattzunTurn({...input,formGuide:undefined,formGuideControl:{kind:'form_guide_control',command:'pause',fieldKey:'notes'}}));
  const paused=parseWattzunTurn({...input,formGuide:{...formGuide,paused:true,questionKey:''},formGuideControl:{kind:'form_guide_control',command:'resume',fieldKey:''}});
  assert.equal(paused.formGuide.paused,true);assert.equal(paused.formGuideControl.command,'resume');
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
  assert.match(WATTZUN_TASK_GUIDANCE.trade.join(' '),/30 questions and 8 per page/);
  assert.match(WATTZUN_PORTAL_GUIDE.creditex[1].description,/does not inspect photo\/PDF contents/);
  assert.match(WATTZUN_PORTAL_GUIDE.creditex[1].description,/Ask Wattzun.*authorised saved-source projection.*does not run its separate pre-review/);
  for(const portal of Object.keys(WATTZUN_PORTAL_GUIDE)){
    const ids=WATTZUN_PORTAL_GUIDE[portal].map(item=>item.id);assert.equal(new Set(ids).size,ids.length);
    for(const item of WATTZUN_PORTAL_GUIDE[portal]) assert.ok(item.href.startsWith('/')&&!item.href.includes('jobId='));
  }
});

test('Wattzun settings guidance uses verified destinations and preserves current Council and auditor access',()=>{
  const trade=WATTZUN_PORTAL_GUIDE.trade.find(item=>item.id==='trade_wattzun');
  assert.equal(trade.href,'/direct-trade/dashboard?workspace=wattzun');
  assert.match(trade.description,/Specialist tools for owners.*staff workspace for team members/);
  assert.match(trade.description,/current authorised business workspace/);
  for(const [portal,path] of [['council','/council?workspace=wattzun'],['creditex','/creditex/compliance']]){
    const entry=WATTZUN_PORTAL_GUIDE[portal].find(item=>item.id===`${portal}_wattzun`);
    assert.equal(entry.href,path);
    assert.match(entry.description,portal==='council'?/sidebar select Wattzun under Tools/:/left sidebar select Wattzun\./);
    if(portal==='council') assert.match(entry.description,/verified panel link retains the selected council and current role/);
    else { assert.match(entry.description,/no verified direct link to this panel/); assert.doesNotMatch(entry.href,/\?/); }
    assert.match(entry.description,/Current (?:council|Creditex) access is required/);
  }
  assert.match(WATTZUN_PORTAL_GUIDE.council.find(item=>item.id==='council_wattzun').description,/demonstration does not offer this tool/);
});

test('every portal guide teaches the released in-app speed control instead of unsupported browser-TTS advice',()=>{
  const question="Where can I adjust Wattzun's speech speed in TLink?";
  for(const portal of ['trade','council','creditex']){
    assert.equal(wattzunOffTopicReply(question,[],portal),null);
    const entry=WATTZUN_PORTAL_GUIDE[portal].find(item=>item.id===`${portal}_wattzun`);
    assert.match(entry.description,/Speaking speed.*Slower, Normal or Quicker.*next reply/);
    const guidance=WATTZUN_TASK_GUIDANCE[portal].join(' ');
    assert.match(guidance,/Speaking speed is an existing in-app control: choose Slower, Normal or Quicker for the next spoken reply/);
    assert.match(guidance,/Do not say speech speed is unavailable or send users to browser, device or operating-system text-to-speech settings/);
    assert.match(guidance,/Call Wattzun opens voice conversation; Message Wattzun opens chat/);
    assert.match(guidance,/Starter prompts open an editable chat draft.*reviews before sending/);
    assert.match(guidance,/warm, conversational voice and personality.*little humour.*fixed by the brand/);
    assert.match(guidance,/12 personal choices: None, Hard hat, Cap, Cowboy, Viking hat, Pirate hat, Sausage, Tinfoil hat, Safety plug, Party hat, Pumpkin and Ghost/);
    assert.match(guidance,/hats do not change personality or access/);
  }
});

test('Wattzun usage guidance states personal UTC exchange counts and preserves the private-record and free-core boundaries',()=>{
  for(const portal of ['trade','council','creditex']){
    const guidance=WATTZUN_TASK_GUIDANCE[portal].join(' ');
    assert.match(guidance,/privately shows the signed-in user's completed Messages answered and Voice replies in the selected workspace for the current UTC month/);
    assert.match(guidance,/recorded since usage tracking began/);
    assert.match(guidance,/Each voice reply is one exchange; these are not call minutes, billed minutes or business totals/);
    assert.match(guidance,/Form drafts and record-specific assistants are separate/);
    assert.match(guidance,/This conversation has not loaded those counts/);
    assert.match(guidance,/No paid activation is required.*core TLink remains free/);
    assert.match(guidance,/do not infer a subscription, allowance or charge/);
  }
});
