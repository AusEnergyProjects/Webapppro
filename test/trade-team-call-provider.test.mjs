import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {openTeamCallMedia,teamCallMediaConstraints,teamCallMediaError,teamCallNeedsPermission} from '../src/lib/trade-team-call-media.ts';

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

function pollFixture({hadRemote=false,elapsed=0,participants=[],online=true}={}) {
  const stops=[],incoming=[],active=[];
  const current={call:{id:'call-1234'},sessionId:'session-1234',memberId:'member-self',cursor:0,lastSuccess:Date.now(),startedAt:Date.now()-elapsed,hadRemote,
    peers:{sync:async()=>{},receive:async()=>{}}};
  const tick=operation('tick',{inFlight:false,disposed:false,session:{current},starting:{current:false},navigator:{onLine:online},
    api:async()=>({call:{id:'call-1234',status:'active',participants},signals:[]}),stop:(...args)=>stops.push(args),setActive:value=>active.push(value),setIncoming:value=>incoming.push(value),dismissed:{current:new Set()}});
  return{tick,stops,active,current};
}

test('unanswered calls stop after a minute and a joined teammate leaving is distinct',async()=>{
  let f=pollFixture({elapsed:60001});await f.tick();assert.match(f.stops[0][0],/No answer/);
  f=pollFixture({hadRemote:true});await f.tick();assert.match(f.stops[0][0],/teammate left/);
  f=pollFixture({elapsed:10000});await f.tick();assert.equal(f.stops.length,0);
});

test('a joined call is not timed out as unanswered and offline calls release media',async()=>{
  const f=pollFixture({elapsed:60001,participants:[{memberId:'member-peer'}]});await f.tick();assert.equal(f.stops.length,0);assert.equal(f.current.hadRemote,true);
  const offline=pollFixture({online:false});await offline.tick();assert.match(offline.stops[0][0],/offline/);
});

test('ring tone and message audio are stopped on session cleanup without auto-answering',()=>{
  assert.match(source,/window\.addEventListener\("tlink:message-received",message\)/);
  assert.match(source,/if \(!session\.current && !starting\.current\) audio\.message\(\)/);
  assert.match(source,/window\.removeEventListener\("tlink:message-received",message\)/);
  assert.match(source,/return \(\) => audio\?\.stop\(\)/);
  assert.match(source,/onClick=\{\(\) => void begin\(invitation\.threadId,invitation\.mode,invitation\)\}>Answer/);
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
    api:async()=>new Promise(done=>{resolve=done;}),setIncoming:value=>incoming.push(value),dismissed:{current:new Set()}});
  const pending=tick();revision.current++;
  resolve({memberId:'member-self',calls:[{id:'call-1234',createdByMemberId:'member-other'}]});await pending;
  assert.deepEqual(incoming,[]);
});

function startFixture({requestMedia,permissionState=async()=> 'unknown',policyBlocked=false}={}) {
  const order=[],state={},session={current:null},media={current:null},mediaRequest={current:null},generation={current:0},starting={current:false};
  const setters=Object.fromEntries(['Busy','Notice','Retry','PermissionHelp','Minimized','OpeningMode','LocalPreview','HasCamera','Active','Incoming','Remotes','Muted','CameraOff','CameraNotice','MultipleCameras','SwitchingCamera'].map(name=>[`set${name}`,value=>{state[name]=value;}]));
  const call={id:'call-1234',threadId:'thread-1234',status:'active',participants:[]};
  const api=async(_query,body)=>{
    order.push(body.action);
    return body.action==='ice'?{iceServers:[{urls:'stun:example.test'}]}:{call,memberId:'member-self'};
  };
  const release=operation('release',{generation,starting,mediaRequest,session,media,changingCamera:{current:false},dismissed:{current:new Set()},api});
  const stop=operation('stop',{release,...setters});
  const begin=operation('begin',{available:true,starting,session,...setters,generation,mediaRequest,media,facing:{current:'user'},
    navigator:{mediaDevices:{getUserMedia(){}}},window:{RTCPeerConnection(){}},teamCallMediaConstraints,
    openTeamCallMedia:(constraints,_request,signal)=>openTeamCallMedia(constraints,value=>{order.push('media');return requestMedia(value);},signal),
    api,stop,teamCallMediaError,teamCallNeedsPermission,teamCallPolicyBlocked:()=>policyBlocked,teamCallPermissionState:permissionState,
    TeamCallConnections:class{async sync(){}close(){}},dismissed:{current:new Set()}});
  return {begin,stop,state,order,session,media,generation};
}

const fakeStream=()=>({stopped:0,getTracks(){return[{stop:()=>this.stopped++}];},getVideoTracks(){return[];}});

test('start and answer invoke media on the click stack before auth or server work',async()=>{
  for(const existing of [undefined,{id:'incoming-1234'}]){
    let grant;const stream=fakeStream();
    const f=startFixture({requestMedia:()=>new Promise(resolve=>{grant=resolve;})});
    const pending=f.begin('thread-1234','audio',existing);
    assert.deepEqual(f.order,['media']);assert.equal(f.state.Busy,true);
    grant(stream);await pending;
    assert.deepEqual(f.order,['media',existing?'join':'start','ice']);assert.equal(f.state.Active.id,'call-1234');
    f.stop();assert.equal(stream.stopped,1);
  }
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
