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

test('operational price-book and customer message facts survive follow-up without becoming proof of a save or send',()=>{
  const operations=[
    {kind:'add_price_book_item',name:'Supply pump',description:'Agreed pump',itemType:'product',unitLabel:'each',unitPrice:'1450',supplierCost:null,taxCode:'gst'},
    {kind:'customer_message',jobQuery:'John last week in Frankston',jobId:'',channel:'sms',subject:'',body:'Could you confirm access tomorrow?'},
    {kind:'invoice_reminder',jobQuery:'John last week in Frankston',jobId:'',invoiceId:'',channel:'email',body:'A friendly invoice reminder.'},
    {kind:'draft_job_quote',jobQuery:'John last week in Frankston',jobId:'',mode:'append',description:'Replace agreed pump',lines:[{lineType:'product',description:'Supply agreed pump',quantity:'1',unitPrice:'1450',taxCode:'gst'}]},
  ];
  for(const operation of operations){
    const history=wattzunConversationHistory([{role:'assistant',content:'Review these details.',reply:{kind:'clarification',message:'Review these details.',questions:[],links:[],action:operation}}]);
    assert.match(JSON.stringify(history),/unconfirmed facts, not a saved record/);
    assert.match(JSON.stringify(history),new RegExp(operation.kind));
    assert.doesNotThrow(()=>parseWattzunTurn({portal:'trade',scopeId:'test-business',requestId:'operational-history-fixture',message:'Continue',history}));
  }
});

test('a confirmation proposal and frozen review IDs never enter untrusted conversational history',()=>{
  const history=wattzunConversationHistory([{role:'assistant',content:'Ready to send.',reply:{kind:'answer',message:'Ready to send.',questions:[],links:[],action:{kind:'confirm_workflow',reviewId:'private-review-123456'}}}]);
  assert.deepEqual(history,[{role:'assistant',content:'Ready to send.'}]);
  assert.doesNotMatch(JSON.stringify(history),/confirm_workflow|private-review/);
});

test('workflow receipts contribute their honest public message without copying receipt or review authority into history',()=>{
  const message='The provider accepted your reminder. Delivery is not yet confirmed.';
  const history=wattzunConversationHistory([{role:'assistant',content:message,reply:{kind:'answer',message,questions:[],links:[{label:'Open reminder',href:'/direct-trade/team?workspace=work&jobId=private-job-id'}],action:null,
    workflow:{state:'complete',receipt:{kind:'invoice_reminder',id:'private-receipt-id',label:'Open reminder',href:'/direct-trade/team?workspace=work&jobId=private-job-id',status:'submitted',message}}}}]);
  assert.deepEqual(history,[{role:'assistant',content:message}]);
  assert.doesNotMatch(JSON.stringify(history),/private-receipt-id|private-job-id|workflowReviewId/);
});

test('a completed server workflow replaces an earlier proposal in history even when receipt speech never arrived',()=>{
  const message='The provider accepted your reminder. Delivery is not yet confirmed.';
  const proposal={kind:'invoice_reminder',jobQuery:'John last week',jobId:'private-job-id',invoiceId:'private-invoice-id',channel:'sms',body:'A friendly reminder.'};
  const history=wattzunConversationHistory([{role:'assistant',content:'Review this invoice reminder.',reviewDraft:proposal,
    reply:{kind:'clarification',message:'Review this invoice reminder.',questions:['Shall I send it?'],links:[],action:proposal,
      workflow:{state:'complete',receipt:{kind:'invoice_reminder',id:'private-receipt-id',label:'Open job',href:'/direct-trade/team?workspace=work&jobId=private-job-id',status:'submitted',message}}}}]);
  assert.deepEqual(history,[{role:'assistant',content:message}]);
  assert.doesNotMatch(JSON.stringify(history),/Earlier proposed|Shall I send|private-job-id|private-invoice-id|private-receipt-id/);
});
