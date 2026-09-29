import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

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
