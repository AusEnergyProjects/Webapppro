import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/tlink-notifications-sw.js',import.meta.url),'utf8');
const payload=(more={})=>({v:1,kind:'team-call',id:'call_12345',threadId:'thread_12345',title:'Private customer',body:'Sensitive site message',url:'https://evil.test/steal',expiresAt:new Date(Date.now()+60000).toISOString(),...more});
function fixture(windows=[]){
  const handlers={},shown=[],opened=[];
  const self={location:{origin:'https://tlink.example'},addEventListener:(name,listener)=>handlers[name]=listener,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(source,{self,URL,Date});return {handlers,shown,opened};
}
async function push(f,data){let pending;f.handlers.push({data:{json:()=>data},waitUntil:p=>pending=p});await pending;}
async function click(f,data){let pending,closed=false;f.handlers.notificationclick({notification:{data,close:()=>closed=true},waitUntil:p=>pending=p});await pending;assert.equal(closed,true);}

test('service worker does not intercept or cache application requests',()=>{
  const f=fixture();assert.deepEqual(Object.keys(f.handlers).sort(),['activate','install','notificationclick','push']);
  assert.doesNotMatch(source,/\bfetch\s*\(|\bcaches\./);
});
test('lock-screen contents stay generic and untrusted URL/title/body never enter notification data',async()=>{
  const f=fixture();await push(f,payload());assert.equal(f.shown.length,1);
  assert.equal(f.shown[0].title,'TLink');assert.equal(f.shown[0].options.body,'Incoming team call');
  assert.equal(f.shown[0].options.data.url,undefined);assert.equal(f.shown[0].options.data.body,undefined);
  await click(f,f.shown[0].options.data);assert.equal(f.opened[0],'https://tlink.example/direct-trade/messages?threadId=thread_12345&callId=call_12345');
});
test('message notifications deep-link only to their conversation',async()=>{
  const f=fixture();await push(f,payload({kind:'team-message'}));await click(f,f.shown[0].options.data);
  assert.equal(f.shown[0].options.body,'New team message');assert.equal(f.opened[0],'https://tlink.example/direct-trade/messages?threadId=thread_12345');
});
test('malformed identifiers and unknown schema never display or open',async()=>{
  const f=fixture();
  for(const data of [null,payload({v:2}),payload({kind:'sms'}),payload({id:'../admin'}),payload({threadId:'abc&redirect=https://evil.test'}),payload({expiresAt:'invalid'})])await push(f,data);
  assert.equal(f.shown.length,0);await click(f,payload({threadId:'../admin'}));assert.equal(f.opened.length,0);
});
test('expired valid push remains visible as a missed call or generic message',async()=>{
  const f=fixture();await push(f,payload({expiresAt:new Date(0).toISOString()}));
  assert.equal(f.shown[0].options.body,'Missed team call');assert.equal(f.shown[0].options.requireInteraction,false);
  await click(f,f.shown[0].options.data);assert.equal(f.opened[0],'https://tlink.example/direct-trade/messages?threadId=thread_12345');
  await push(f,payload({kind:'team-message',expiresAt:new Date(0).toISOString()}));assert.equal(f.shown[1].options.body,'New team message');
});
test('expired call clicks open the conversation without reopening the old call',async()=>{
  const f=fixture();await click(f,payload({expiresAt:new Date(0).toISOString()}));assert.equal(f.opened[0],'https://tlink.example/direct-trade/messages?threadId=thread_12345');
});
test('click focuses an existing same-origin messages window but never navigates a CRM document tab',async()=>{
  let focused=0,navigated='';const crm={url:'https://tlink.example/direct-trade/dashboard',navigate:()=>{throw new Error('Do not navigate CRM');}};
  const message={url:'https://tlink.example/direct-trade/messages',navigate:async url=>{navigated=url;return {focus:async()=>focused++};}};
  const f=fixture([crm,{url:'https://evil.test/direct-trade/messages'},message]);await click(f,payload());
  assert.match(navigated,/^https:\/\/tlink.example\/direct-trade\/messages\?/);assert.equal(focused,1);assert.equal(f.opened.length,0);
});
test('no notification click can directly answer or request microphone/camera',()=>{
  assert.doesNotMatch(source,/getUserMedia|RTCPeerConnection|action:\s*['"]join|action:\s*['"]start/);
});
test('a messages tab closing during navigation falls back to a new same-origin tab',async()=>{
  const f=fixture([{url:'https://tlink.example/direct-trade/messages',navigate:async()=>{throw new Error('Tab closed');}}]);
  await click(f,payload());assert.equal(f.opened.length,1);assert.match(f.opened[0],/^https:\/\/tlink.example\/direct-trade\/messages\?/);
});

test('local device test opens only TLink messages and cannot supply a redirect or request a call',async()=>{
  const f=fixture();await click(f,{kind:'device-test',url:'https://evil.test',callId:'untrusted'});
  assert.equal(f.opened[0],'https://tlink.example/direct-trade/messages');
  await push(f,{kind:'device-test'});assert.equal(f.shown.length,0);
});
