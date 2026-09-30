import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {openTeamCallMedia,teamCallMediaConstraints,teamCallMediaError,teamCallNeedsPermission} from '../src/lib/trade-team-call-media.ts';
import {TEAM_CALL_RING_SECONDS} from '../src/lib/trade-team-calls.ts';

const source=fs.readFileSync(new URL('../src/components/TradeTeamCallProvider.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('TradeTeamCallProvider.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function operation(name,dependencies) {
  let expression;
  const visit=node=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name){
      expression=ts.isCallExpression(node.initializer)?node.initializer.arguments[0]:node.initializer;
    }
    ts.forEachChild(node,visit);
  };
  visit(tree);assert.ok(expression,`Missing ${name}`);
  const compiled=ts.transpileModule(`const extracted = ${expression.getText(tree)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(dependencies),`${compiled}; return extracted;`)(...Object.values(dependencies));
}

test('call API timeout includes a stalled auth refresh and never sends a late request',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let grant,fetches=0;
  const api=operation('api',{authentication:{current:{user:{getIdToken:()=>new Promise(resolve=>{grant=resolve;})}}},fetch:async()=>{fetches++;return Response.json({ok:true});}});
  const pending=api('view=incoming');const rejected=assert.rejects(pending,/timed out/);
  context.mock.timers.tick(15000);await rejected;
  grant('synthetic-token');await new Promise(resolve=>setImmediate(resolve));assert.equal(fetches,0);
});

test('call API timeout aborts a hanging fetch and preserves server access errors',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let signal;
  const api=operation('api',{authentication:{current:{getAuthHeaders:async()=>({Authorization:'Bearer synthetic'})}},fetch:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  const pending=api();const rejected=assert.rejects(pending,/timed out/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(signal.aborted,false);
  context.mock.timers.tick(15000);await rejected;assert.equal(signal.aborted,true);
  const denied=operation('api',{authentication:{current:{}},fetch:async()=>Response.json({ok:false,code:'CALL_ACCESS_REQUIRED',error:'No access'},{status:403})});
  await assert.rejects(denied(),error=>error.status===403&&error.code==='CALL_ACCESS_REQUIRED');
});

function pollFixture({hadRemote=false,elapsed=0,participants=[],online=true,readCall}={}) {
  const stops=[],incoming=[],active=[],silenced=[];
  const current={call:{id:'call-1234',createdAt:new Date(Date.now()-elapsed).toISOString()},sessionId:'session-1234',memberId:'member-self',cursor:0,lastSuccess:Date.now(),startedAt:Date.now(),hadRemote,
    peers:{sync:async()=>{},receive:async()=>{}}};
  const tick=operation('tick',{inFlight:false,disposed:false,session:{current},starting:{current:false},navigator:{onLine:online},
    api:async()=>readCall ? readCall(current.call) : {call:{...current.call,status:'active',participants},signals:[]},TEAM_CALL_RING_SECONDS,stop:(...args)=>stops.push(args),setActive:value=>active.push(value),setIncoming:value=>incoming.push(value),dismissed:{current:new Set()},ringer:{current:{silence:id=>silenced.push(id)}}});
  return{tick,stops,active,current,silenced};
}

test('unanswered calls stop exactly 45 seconds after server creation, not local session setup',async context=>{
  context.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,30)});
  assert.equal(TEAM_CALL_RING_SECONDS,45);
  const f=pollFixture({elapsed:44999,participants:[{memberId:'member-self'}]});
  await f.tick();assert.equal(f.stops.length,0);
  context.mock.timers.tick(1);await f.tick();assert.match(f.stops[0][0],/No answer/);
  assert.equal(Date.now()-f.current.startedAt,1,'Local setup cannot extend the call ringing deadline');
});

test('a delayed pre-deadline snapshot cannot end a call answered just before the deadline',async context=>{
  context.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,30)});
  let deliver,requests=0;
  const f=pollFixture({elapsed:44800,readCall:call=>{
    requests++;
    if(requests===1)return new Promise(resolve=>{deliver=()=>resolve({call:{...call,status:'active',participants:[{memberId:'member-self'}]},signals:[]});});
    return {call:{...call,status:'active',hasBeenAnswered:true,participants:[{memberId:'member-self'},{memberId:'member-peer'}]},signals:[]};
  }});
  const pending=f.tick();
  context.mock.timers.tick(250);deliver();await pending;
  assert.equal(f.stops.length,0,'A 44.8-second snapshot delivered at 45.05 seconds is not evidence of no answer');
  await f.tick();
  assert.equal(requests,2);assert.equal(f.stops.length,0);assert.equal(f.current.hadRemote,true);
});

test('a joined teammate leaving reports a departure rather than no answer',async()=>{
  const f=pollFixture({hadRemote:true});await f.tick();assert.match(f.stops[0][0],/teammate left/);
});

test('a joined call is not timed out as unanswered and offline calls release media',async()=>{
  const f=pollFixture({elapsed:60001,participants:[{memberId:'member-peer'}]});await f.tick();assert.equal(f.stops.length,0);assert.equal(f.current.hadRemote,true);
  const offline=pollFixture({online:false});await offline.tick();assert.match(offline.stops[0][0],/offline/);
});

test('ring tone and message audio are stopped on session cleanup without auto-answering',()=>{
  assert.match(source,/window\.addEventListener\("tlink:message-received",message\)/);
  assert.match(source,/if \(!session\.current && !starting\.current\) audio\.message\(\)/);
  assert.match(source,/window\.removeEventListener\("tlink:message-received",message\)/);
  assert.match(source,/onClick=\{\(\) => void begin\(invitation\.threadId,invitation\.mode,invitation\)\}>\{invitation\.hasBeenAnswered \? "Join call" : "Answer"\}/);
});

function ringEffect(dependencies) {
  dependencies={TEAM_CALL_RING_SECONDS,ringingCreatedAt:new Date().toISOString(),...dependencies};
  let expression;
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'
      &&ts.isArrayLiteralExpression(node.arguments[1])&&node.arguments[1].elements.some(item=>item.getText(tree)==='outgoingRingId'))expression=node.arguments[0];
    ts.forEachChild(node,visit);
  };
  visit(tree);assert.ok(expression,'Missing incoming/outgoing ring effect');
  const compiled=ts.transpileModule(`const extracted=${expression.getText(tree)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(dependencies),`${compiled}; return extracted;`)(...Object.values(dependencies))();
}

test('incoming and outgoing tones stop at the absolute deadline without ending the call or awaiting a poll',context=>{
  context.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,8,30)});
  for(const mode of ['incoming','outgoing']){
    const events=[],ringer={current:{start:value=>events.push(value),stop:()=>events.push('stop')}};
    const cleanup=ringEffect({ringingId:mode==='incoming'?'call-1234':undefined,outgoingRingId:mode==='outgoing'?'call-1234':undefined,
      ringingCreatedAt:new Date(Date.now()-39999).toISOString(),ringer,stop:()=>assert.fail('Ringing deadline must not end the call')});
    assert.deepEqual(events,[mode]);
    context.mock.timers.tick(5000);assert.deepEqual(events,[mode]);
    context.mock.timers.tick(1);assert.deepEqual(events,[mode,'stop']);
    cleanup();
  }
});

test('ring cleanup cancels the previous deadline and expired invitations never restart tones',context=>{
  context.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,8,30)});
  const events=[],ringer={current:{start:value=>events.push(value),stop:()=>events.push('stop')}};
  const cleanup=ringEffect({ringingId:'call-old',outgoingRingId:undefined,ringingCreatedAt:new Date(Date.now()-44000).toISOString(),ringer});
  cleanup();
  const nextCleanup=ringEffect({ringingId:undefined,outgoingRingId:'call-next',ringer});
  context.mock.timers.tick(1000);assert.deepEqual(events,['incoming','stop','outgoing'],'Old timer must not silence a later call');
  context.mock.timers.tick(44000);assert.deepEqual(events,['incoming','stop','outgoing','stop']);nextCleanup();
  events.length=0;
  ringEffect({ringingId:'call-expired',outgoingRingId:undefined,ringingCreatedAt:new Date(Date.now()-45000).toISOString(),ringer});
  assert.deepEqual(events,['stop']);
});

test('outgoing ringback stops when a remote connects or joins and never rings the answering side',()=>{
  for(const remoteState of ['connected','joined']){
    const events=[],ringer={current:{start:mode=>events.push(mode),stop:()=>events.push('stop')}};
    const active={id:'call-1234',createdByMemberId:'member-self'},session={current:{memberId:'member-self',hadRemote:false}};
    const state={active,session,remotes:[]};
    const outgoingRingId=operation('outgoingRingId',state);assert.equal(outgoingRingId,active.id);
    const cleanup=ringEffect({ringingId:undefined,outgoingRingId,ringer});assert.deepEqual(events,['outgoing']);
    if(remoteState==='connected')state.remotes=[{state:'connected'}];else session.current.hadRemote=true;
    const next=operation('outgoingRingId',state);assert.equal(next,undefined);
    cleanup();ringEffect({ringingId:undefined,outgoingRingId:next,ringer});assert.deepEqual(events,['outgoing','stop']);
    assert.equal(operation('outgoingRingId',{active:{...active,createdByMemberId:'member-other'},session:{current:{memberId:'member-self',hadRemote:false}},remotes:[]}),undefined);
  }
});

test('incoming ring mode is cleared when the invitation is answered, dismissed or a call is active',()=>{
  const events=[],ringer={current:{start:mode=>events.push(mode),stop:()=>events.push('stop')}};
  const state={active:null,busy:false,retry:null,incoming:[{id:'call-1234'}]};
  assert.equal(operation('ringingId',state),'call-1234');
  const cleanup=ringEffect({ringingId:'call-1234',outgoingRingId:undefined,ringer});assert.deepEqual(events,['incoming']);
  for(const changes of [{busy:true},{incoming:[]},{active:{id:'active-1234'}},{retry:{threadId:'thread-1234'}}])assert.equal(operation('ringingId',{...state,...changes}),undefined);
  cleanup();assert.deepEqual(events,['incoming','stop']);
});

test('a group call answered by another teammate stops ringing and stays silent on later polls',()=>{
  const events=[],ringer={current:{start:mode=>events.push(mode),stop:()=>events.push('stop')}};
  const invitation={id:'call-1234',hasBeenAnswered:false};
  const state={active:null,busy:false,retry:null,incoming:[invitation]};
  const ringingId=operation('ringingId',state);
  const cleanup=ringEffect({ringingId,outgoingRingId:undefined,ringer});
  assert.deepEqual(events,['incoming']);
  state.incoming=[{...invitation,hasBeenAnswered:true}];
  const answeredRingId=operation('ringingId',state);assert.equal(answeredRingId,undefined);
  cleanup();ringEffect({ringingId:answeredRingId,outgoingRingId:undefined,ringer});
  assert.deepEqual(events,['incoming','stop']);
  state.incoming=[{...invitation,hasBeenAnswered:true}];
  ringEffect({ringingId:operation('ringingId',state),outgoingRingId:undefined,ringer});
  assert.deepEqual(events,['incoming','stop'],'Polling an answered group call cannot restart the ringtone');
});

test('changing to busy clears the pending ring without touching an established call',()=>{
  let stopped=0;const incoming=[],revision={current:0};
  const changed=operation('presenceChanged',{presenceRevision:revision,setIncoming:value=>incoming.push(value),audio:{stop:()=>stopped++}});
  changed(new CustomEvent('tlink:team-presence-changed',{detail:{status:'busy'}}));
  assert.equal(stopped,1);assert.deepEqual(incoming,[[]]);assert.equal(revision.current,1);
  changed(new CustomEvent('tlink:team-presence-changed',{detail:{status:'online'}}));assert.equal(stopped,1);assert.equal(revision.current,2);
});

test('an incoming response started before a presence change cannot restart ringing',async()=>{
  let resolve;const incoming=[],revision={current:0};
  const tick=operation('tick',{inFlight:false,disposed:false,session:{current:null},starting:{current:false},navigator:{onLine:true},presenceRevision:revision,
    api:async()=>new Promise(done=>{resolve=done;}),setIncoming:value=>incoming.push(value),dismissed:{current:new Set()},generation:{current:0}});
  const pending=tick();revision.current++;
  resolve({memberId:'member-self',calls:[{id:'call-1234',createdByMemberId:'member-other'}]});await pending;
  assert.deepEqual(incoming,[]);
});

function startFixture({requestMedia,permissionState=async()=> 'unknown',policyBlocked=false}={}) {
  const order=[],audioEvents=[],silenced=[],peerOptions=[],state={},session={current:null},media={current:null},mediaRequest={current:null},generation={current:0},starting={current:false},tickRef={current:async()=>{}};
  const ringer={current:{stop:()=>audioEvents.push('stop'),unlock:async()=>{audioEvents.push('unlock');return true;},silence:id=>silenced.push(id)}};
  const setters=Object.fromEntries(['Busy','Notice','Retry','PermissionHelp','Minimized','OpeningMode','LocalPreview','HasCamera','Active','Incoming','Remotes','Muted','CameraOff','CameraNotice','MultipleCameras','SwitchingCamera'].map(name=>[`set${name}`,value=>{state[name]=value;}]));
  const call={id:'call-1234',threadId:'thread-1234',status:'active',createdAt:new Date().toISOString(),participants:[]};
  const api=async(_query,body)=>{
    order.push(body.action);
    return body.action==='ice'?{iceServers:[{urls:'stun:example.test'}]}:{call,memberId:'member-self'};
  };
  const release=operation('release',{generation,starting,mediaRequest,session,media,ringer,changingCamera:{current:false},dismissed:{current:new Set()},api});
  const stop=operation('stop',{release,...setters});
  const begin=operation('begin',{available:true,starting,session,...setters,generation,mediaRequest,media,ringer,tickRef,facing:{current:'user'},
    navigator:{mediaDevices:{getUserMedia(){}}},window:{RTCPeerConnection(){}},teamCallMediaConstraints,
    openTeamCallMedia:(constraints,_request,signal)=>openTeamCallMedia(constraints,value=>{order.push('media');return requestMedia(value);},signal),
    api,stop,teamCallMediaError,teamCallNeedsPermission,teamCallPolicyBlocked:()=>policyBlocked,teamCallPermissionState:permissionState,
    TeamCallConnections:class{constructor(options){peerOptions.push(options);}async sync(){}close(){}},dismissed:{current:new Set()}});
  return {begin,stop,state,order,audioEvents,silenced,peerOptions,session,media,generation,starting,tickRef};
}

const fakeStream=()=>({stopped:0,getTracks(){return[{stop:()=>this.stopped++}];},getVideoTracks(){return[];}});

test('start and answer invoke media on the click stack before auth or server work',async()=>{
  for(const existing of [undefined,{id:'incoming-1234'}]){
    let grant;const stream=fakeStream();
    const f=startFixture({requestMedia:()=>new Promise(resolve=>{grant=resolve;})});
    const pending=f.begin('thread-1234','audio',existing);
    assert.deepEqual(f.order,['media']);assert.equal(f.state.Busy,true);
    assert.deepEqual(f.audioEvents,['stop','unlock'],'Starting or answering stops stale tones and unlocks on the click stack');
    assert.deepEqual(f.silenced,existing?['incoming-1234']:[],'Answer silences other tabs before permission or authentication resolves');
    grant(stream);await pending;
    assert.deepEqual(f.order,['media',existing?'join':'start','ice']);assert.equal(f.state.Active.id,'call-1234');
    f.stop();assert.equal(stream.stopped,1);assert.deepEqual(f.audioEvents,['stop','unlock','stop']);
  }
});

test('RTC connection silences ringing immediately and obsolete peer callbacks cannot affect a later session',async()=>{
  const f=startFixture({requestMedia:async()=>fakeStream()});
  await f.begin('thread-1234','audio');
  const peers=[{state:'connected',memberId:'member-peer'}];
  f.peerOptions[0].changed(peers);
  assert.deepEqual(f.silenced,['call-1234']);assert.equal(f.state.Remotes,peers);
  f.stop();const count=f.silenced.length;
  f.peerOptions[0].changed(peers);
  assert.equal(f.silenced.length,count);assert.deepEqual(f.state.Remotes,[]);
});

test('ready peers wake signalling immediately and connected calls return to normal polling',async()=>{
  const f=startFixture({requestMedia:async()=>fakeStream()});
  let wakes=0;f.tickRef.current=async()=>{wakes++;assert.equal(f.starting.current,false);assert.ok(f.session.current.peers);};
  await f.begin('thread-1234','audio');assert.equal(wakes,1);
  for(const [activeId,remotes,expected] of [[undefined,[],5000],['call-1234',[],300],['call-1234',[{state:'connecting'}],300],['call-1234',[{state:'connected'}],1500],['call-1234',[{state:'connected'},{state:'connecting'}],300]]){
    assert.equal(operation('pollInterval',{activeId,remotes}),expected);
  }
  f.stop();
});

test('polling cannot race the initial peer negotiation while Answer is still setting up',async()=>{
  const tick=operation('tick',{inFlight:false,disposed:false,session:{current:{peers:{}}},starting:{current:true},
    api:()=>assert.fail('Peer setup must finish before the polling processor can use it')});
  await tick();
});

test('retrying the same incoming call after permission refusal keeps its sound silenced without preventing Join',async()=>{
  let attempts=0;const existing={id:'call-1234'};
  const f=startFixture({requestMedia:async()=>{if(!attempts++)throw new DOMException('denied','NotAllowedError');return fakeStream();}});
  await f.begin('thread-1234','audio',existing);assert.equal(f.state.Retry.existing,existing);assert.deepEqual(f.order,['media']);
  await f.begin('thread-1234','audio',existing);
  assert.deepEqual(f.order,['media','media','join','ice']);assert.equal(f.state.Active.id,existing.id);assert.ok(f.silenced.every(id=>id===existing.id));f.stop();
});

test('authenticated remote join silences ringback before the React render or peer sync',async()=>{
  const f=pollFixture({participants:[{memberId:'member-peer'}]});
  f.current.peers.sync=async()=>assert.deepEqual(f.silenced,['call-1234']);
  await f.tick();assert.deepEqual(f.silenced,['call-1234']);assert.equal(f.stops.length,0);
});

test('an invitation poll started before Answer cannot restore ringing during setup or after cancellation',async()=>{
  for(const cancel of [false,true]){
    let deliver,grant;const incoming=[];
    const f=startFixture({requestMedia:()=>new Promise(resolve=>{grant=resolve;})});
    const tick=operation('tick',{inFlight:false,disposed:false,session:f.session,starting:f.starting,navigator:{onLine:true},presenceRevision:{current:0},generation:f.generation,
      api:async()=>new Promise(resolve=>{deliver=resolve;}),setIncoming:value=>incoming.push(value),dismissed:{current:new Set()},ringer:{current:{silence:()=>assert.fail('A stale poll must be discarded')}}});
    const polling=tick();const answering=f.begin('thread-1234','audio',{id:'incoming-1234'});
    if(cancel)f.stop();
    deliver({memberId:'member-self',calls:[{id:'incoming-1234',createdByMemberId:'member-other'}]});await polling;
    assert.deepEqual(incoming,[],cancel?'Cancellation must also invalidate the old snapshot':'Permission setup must not repopulate an invitation');
    grant(fakeStream());await answering;f.stop();
  }
});

test('a server-confirmed answered invitation silences other tabs before updating the invitation list',async()=>{
  const events=[];const invitation={id:'call-1234',createdByMemberId:'member-other',hasBeenAnswered:true};
  const tick=operation('tick',{inFlight:false,disposed:false,session:{current:null},starting:{current:false},navigator:{onLine:true},presenceRevision:{current:0},generation:{current:0},
    api:async()=>({memberId:'member-self',calls:[invitation]}),setIncoming:value=>events.push(value),dismissed:{current:new Set()},ringer:{current:{silence:id=>events.push(id)}}});
  await tick();assert.deepEqual(events,['call-1234',[invitation]]);
});

test('permission refusal shows retry without contacting the server and voice recovery requests no camera',async()=>{
  const requests=[],stream=fakeStream();let attempt=0;
  const f=startFixture({requestMedia:async constraints=>{requests.push(constraints);if(attempt++===0)throw new DOMException('not allowed','NotAllowedError');return stream;}});
  await f.begin('thread-1234','video');
  assert.deepEqual(f.order,['media']);assert.equal(f.state.Retry.mode,'video');assert.deepEqual(f.state.PermissionHelp,{mode:'video',denied:false,policyBlocked:false});
  assert.doesNotMatch(f.state.Notice,/blocked/);
  await f.begin('thread-1234','audio');
  assert.equal(requests[1].video,false);assert.equal(f.state.PermissionHelp,null);assert.equal(f.state.Busy,false);f.stop();
});

test('cancelled permission prompts never create calls or revive a late camera stream',async()=>{
  let grant;const stream=fakeStream();
  const f=startFixture({requestMedia:()=>new Promise(resolve=>{grant=resolve;})});
  const pending=f.begin('thread-1234','video');f.stop();await pending;
  grant(stream);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stream.stopped,1);assert.deepEqual(f.order,['media']);assert.equal(f.state.Retry,null);assert.equal(f.state.Notice,'');
});

test('late permission diagnostics cannot overwrite a successful retry or a closed notice',async()=>{
  for(const action of ['retry','close']){
    let resolvePermission,attempt=0;const stream=fakeStream();
    const f=startFixture({requestMedia:async()=>{if(attempt++===0)throw new DOMException('denied','NotAllowedError');return stream;},permissionState:()=>new Promise(resolve=>{resolvePermission=resolve;})});
    await f.begin('thread-1234','audio');
    if(action==='retry')await f.begin('thread-1234','audio');else f.stop();
    resolvePermission('denied');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.state.PermissionHelp,null,action);assert.equal(f.state.Notice,'',action);f.stop();
  }
});

test('a confirmed permission block opens device help but never pretends access is granted',async()=>{
  const f=startFixture({requestMedia:async()=>{throw new DOMException('denied','NotAllowedError');},permissionState:async()=> 'denied'});
  await f.begin('thread-1234','audio');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.state.PermissionHelp,{mode:'audio',denied:true,policyBlocked:false});assert.match(f.state.Notice,/reports microphone access is blocked/);
  assert.deepEqual(f.order,['media']);assert.equal(f.state.Active,null);
});

test('inherited or embedded document policy denial offers a full-document calls link instead of permission settings',async()=>{
  const f=startFixture({requestMedia:async()=>{throw new DOMException('policy denied','NotAllowedError');},policyBlocked:true,permissionState:()=>assert.fail('policy denial should not be mislabelled as user denial')});
  await f.begin('thread-1234','video');
  assert.deepEqual(f.state.PermissionHelp,{mode:'video',denied:false,policyBlocked:true});assert.match(f.state.Notice,/Open TLink directly/);
  assert.doesNotMatch(f.state.Notice,/settings/);assert.deepEqual(f.order,['media']);
  assert.match(source,/<a className="tlink-call-direct-link" href=\{`\/direct-trade\/messages\?threadId=\$\{encodeURIComponent\(retry\.threadId\)\}/);
  assert.match(source,/target=\{openDirectInNewTab \? "_blank" : undefined\} rel="noopener noreferrer"/);
  assert.match(source,/browser\.embedded \|\| typeof window !== "undefined" && window\.top !== window/);
});
