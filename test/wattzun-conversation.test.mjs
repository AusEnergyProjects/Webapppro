import assert from 'node:assert/strict';
import test from 'node:test';
import { wattzunConversationHistory } from '../src/lib/wattzun-conversation.ts';
import { parseWattzunTurn } from '../src/lib/wattzun-portal.ts';

const draft={kind:'prepare_quote',firstName:'Alex',lastName:'Test',email:'',phone:'',addressQuery:'',serviceCategory:'electrical',description:'Inspection',
  lines:[{lineType:'labour',description:'Inspection',quantity:'1',unitPrice:'120',taxCode:'gst'}]};
const reply={kind:'clarification',message:'Is that a new quote?',questions:[],links:[],action:draft};

test('native clarification retains the spoken workflow facts before an action proposal exists',()=>{
  const summary='Prepare an audit checklist for a two storey brick home with ceiling insulation. The user has not supplied the audit scheme.';
  const history=wattzunConversationHistory([{role:'assistant',content:'Which audit scheme is this for?',requestSummary:summary,
    reply:{kind:'clarification',message:'Which audit scheme is this for?',questions:[],links:[],action:null}}]);
  assert.equal(history.length,2);assert.ok(history.every(turn=>turn.role==='assistant'));
  assert.match(history[0].content,/two storey brick home/);assert.match(history[0].content,/not a transcript or saved record/);
  assert.equal(history[1].content,'Which audit scheme is this for?');
  assert.doesNotThrow(()=>parseWattzunTurn({portal:'trade',scopeId:'test-business',requestId:'native-followup-test-1',history},true));
});

test('native audio turns retain supplied draft facts without an empty or invented user transcript',()=>{
  const history=wattzunConversationHistory([{role:'user',content:''},{role:'assistant',content:reply.message,reply}]);
  assert.ok(history.every(turn=>turn.role==='assistant'&&turn.content.trim()));
  assert.match(JSON.stringify(history),/Alex/);assert.match(JSON.stringify(history),/120/);
  assert.match(JSON.stringify(history),/unconfirmed facts, not a saved record/);
  assert.doesNotThrow(()=>parseWattzunTurn({portal:'trade',scopeId:'test-business',requestId:'native-history-test-1',history},true));
});

test('dismissing a review retains its earlier conversational facts without retaining saved record IDs',()=>{
  const history=wattzunConversationHistory([{role:'assistant',content:reply.message,reply:{...reply,action:null},reviewDraft:draft},
    {role:'assistant',content:'Your quote draft has been saved in TLink.',reply:{kind:'answer',message:'Saved',questions:[],links:[{label:'Quote',href:'/job/private-record-id'}]}}]);
  assert.match(JSON.stringify(history),/Alex/);assert.doesNotMatch(JSON.stringify(history),/private-record-id/);
});

test('whole quote lines and large scope survive context grouping without truncation',()=>{
  const proposal={...draft,description:'"'.repeat(1000),lines:Array.from({length:10},(_,i)=>({...draft.lines[0],description:`line ${i} `+'"'.repeat(150)}))};
  const history=wattzunConversationHistory([{role:'assistant',content:'Review these details.',reply:{...reply,action:proposal}}]);
  assert.ok(history.every(turn=>turn.content.length<=4000));
  assert.match(history.map(turn=>turn.content).join('\n'),/line 0 /);assert.match(history.map(turn=>turn.content).join('\n'),/line 9 /);
  assert.ok(history.some(turn=>turn.content.includes(JSON.stringify(proposal.description))));
});

test('context still follows the 40 turn and 24000 character API ceilings',()=>{
  for(const content of ['short','x'.repeat(4000)]){
    const history=wattzunConversationHistory(Array.from({length:90},(_,i)=>({role:i%2?'assistant':'user',content})));
    assert.ok(history.length<=40);assert.ok(JSON.stringify(history).length<=24000);
    assert.doesNotThrow(()=>parseWattzunTurn({portal:'trade',scopeId:'test-business',requestId:'native-history-test-2',history},true));
  }
});
