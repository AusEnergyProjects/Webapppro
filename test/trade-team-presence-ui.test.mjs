import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as presence from '../src/lib/trade-team-presence.ts';

const compiled=ts.transpileModule(readFileSync(new URL('../src/components/TradeTeamPresence.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=(node,match)=>node==null||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(child=>nodes(child,match)):[...(match(node)?[node]:[]),...nodes(node.props?.children,match)];
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  let cursor=0,status='online',failSave=false,failRead=Boolean(options.failRead),delayedRead=options.read;
  const state=[],effects=[],pending=[],timers=new Map(),frames=new Map(),listeners=new Map(),requests=[],events=[];
  const changed=(before,after)=>!before||before.some((value,i)=>value!==after[i]);
  const react={
    useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=cursor++;return state[i]||={current:initial};},
    useId(){const i=cursor++;return state[i]||=`presence-${i}`;},
    useCallback(callback,dependencies){const i=cursor++;if(!state[i]||changed(state[i].dependencies,dependencies))state[i]={dependencies,value:callback};return state[i].value;},
    useEffect(callback,dependencies){const i=cursor++;if(!effects[i]||changed(effects[i].dependencies,dependencies)){const old=effects[i];effects[i]={dependencies};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=callback();});}},
  };
  const window={setTimeout:(callback)=>{const id=Symbol();timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>1,clearInterval(){},requestAnimationFrame:callback=>{const id=Symbol();frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>events.push(event)};
  const fetch=async(url,init)=>{requests.push({url,init});if(init.method==='PATCH'){if(failSave)return Response.json({ok:false},{status:503});status=JSON.parse(init.body).status;}else if(delayedRead){const value=delayedRead;delayedRead=null;return value;}else if(failRead)return Response.json({ok:false},{status:503});return Response.json({ok:true,status,updatedAt:'now'});};
  const dependencies={react,'react/jsx-runtime':jsx,'./TradeBusinessProvider':{useTradeBusinessFetch:()=>fetch},'@/lib/trade-team-presence':presence,'./TradeTeamPresence.module.css':{default:{}}};
  const exports={};Function('require','exports','window','document',compiled)(name=>{assert.ok(dependencies[name],name);return dependencies[name];},exports,window,{hidden:false});
  const auth=options.auth|| (async()=>({Authorization:'Bearer identity'}));
  const render=()=>{cursor=0;const tree=exports.default({getAuthHeaders:auth});for(const effect of pending.splice(0))effect();for(const[id,callback]of [...frames]){frames.delete(id);callback();}return tree;};
  return {render,requests,events,focus:()=>listeners.get('focus')?.(),setServer:value=>{status=value;},failSave:()=>{failSave=true;},restoreSave:()=>{failSave=false;},failRead:()=>{failRead=true;},restoreRead:()=>{failRead=false;},delayNextRead:value=>{delayedRead=value;},expire:()=>{for(const[id,callback]of [...timers]){timers.delete(id);callback();}},unmount:()=>{for(const effect of effects)effect?.cleanup?.();},async settle(){let tree;for(let i=0;i<5;i++){tree=render();await tick();}return tree;}};
}
const select=tree=>nodes(tree,node=>node.type==='select')[0];
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
const details=tree=>nodes(tree,node=>node.props?.role==='group'&&node.props?.['aria-label']==='Call status details');
const styles=readFileSync(new URL('../src/app/protected-workspaces.css',import.meta.url),'utf8');
function dotColour(tree){
  const dot=nodes(tree,node=>node.props?.className?.split(' ').includes('tlink-presence-dot'))[0];
  const classes=new Set(dot.props.className.split(' '));
  let colour;
  for(const match of styles.matchAll(/(\.tlink-presence-dot(?:\.[\w-]+)?)\s*\{([^}]+)\}/g)){
    if(match[1].slice(1).split('.').every(name=>classes.has(name)))colour=match[2].match(/background:\s*([^;]+)/)?.[1];
  }
  return colour;
}

test('dropdown loads explicit availability and saves only the chosen status before notifying call UI',async()=>{
  const f=fixture();let tree=await f.settle();assert.equal(select(tree).props.value,'online');assert.match(text(tree),/Available for calls/);
  assert.equal(dotColour(tree),'#21a676');
  select(tree).props.onChange({target:{value:'busy'}});tree=await f.settle();assert.equal(select(tree).props.value,'busy');assert.match(text(tree),/Calls off. Messages on/);
  assert.equal(dotColour(tree),'#dc8b21');
  assert.deepEqual(JSON.parse(f.requests.find(item=>item.init.method==='PATCH').init.body),{status:'busy'});
  assert.equal(f.events[0].type,'tlink:team-presence-changed');assert.deepEqual(f.events[0].detail,{status:'busy'});f.unmount();
});

test('failed save preserves the real status and emits no successful presence event',async()=>{
  const f=fixture();let tree=await f.settle();f.failSave();select(tree).props.onChange({target:{value:'offline'}});tree=await f.settle();
  assert.equal(select(tree).props.value,'online');assert.match(text(tree),/was not changed/);assert.equal(f.events.length,0);assert.equal(select(tree).props.disabled,false);
  assert.equal(details(tree).length,0);button(tree,'Not saved').props.onClick();tree=await f.settle();assert.equal(details(tree).length,1);
  f.restoreSave();button(tree,'Retry').props.onClick();tree=await f.settle();assert.equal(select(tree).props.value,'offline');assert.equal(details(tree).length,0);assert.equal(f.events.length,1);f.unmount();
});

test('focus restores a change made on another device without writing over it',async()=>{
  const f=fixture();await f.settle();f.setServer('offline');f.focus();const tree=await f.settle();
  assert.equal(select(tree).props.value,'offline');assert.equal(dotColour(tree),'#8a939c');assert.equal(f.requests.filter(item=>item.init.method==='PATCH').length,0);f.unmount();
});

test('a later matching confirmation clears a failed save without retrying or claiming a new save',async()=>{
  const f=fixture();let tree=await f.settle();f.failSave();select(tree).props.onChange({target:{value:'busy'}});tree=await f.settle();
  button(tree,'Not saved').props.onClick();tree=await f.settle();assert.equal(details(tree).length,1);
  f.setServer('busy');f.focus();tree=await f.settle();
  assert.equal(select(tree).props.value,'busy');assert.equal(button(tree,'Not saved'),undefined);assert.equal(details(tree).length,0);
  assert.equal(f.requests.filter(item=>item.init.method==='PATCH').length,1);assert.equal(f.events.length,0);f.unmount();
});

test('a later different confirmation retains the intended failed save and Retry submits it',async()=>{
  const f=fixture();let tree=await f.settle();f.failSave();select(tree).props.onChange({target:{value:'busy'}});tree=await f.settle();
  f.setServer('offline');f.focus();tree=await f.settle();assert.equal(select(tree).props.value,'offline');assert.ok(button(tree,'Not saved'));assert.equal(details(tree).length,0);
  button(tree,'Not saved').props.onClick();tree=await f.settle();f.restoreSave();button(tree,'Retry').props.onClick();tree=await f.settle();
  assert.equal(select(tree).props.value,'busy');assert.equal(button(tree,'Not saved'),undefined);assert.equal(details(tree).length,0);
  const writes=f.requests.filter(item=>item.init.method==='PATCH');assert.equal(writes.length,2);assert.deepEqual(writes.map(item=>JSON.parse(item.init.body)),[{status:'busy'},{status:'busy'}]);
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].detail,{status:'busy'});f.unmount();
});

test('an earlier read cannot overwrite a newly saved status',async()=>{
  let finish;const f=fixture();let tree=await f.settle();f.delayNextRead(new Promise(resolve=>{finish=resolve;}));f.focus();await tick();
  select(tree).props.onChange({target:{value:'busy'}});tree=await f.settle();assert.equal(select(tree).props.value,'busy');
  finish(Response.json({ok:true,status:'online'}));tree=await f.settle();assert.equal(select(tree).props.value,'busy');f.unmount();
});

test('authentication timeout is actionable and cannot start a late request after expiry',async()=>{
  let completeAuth;const f=fixture({auth:()=>new Promise(resolve=>{completeAuth=resolve;})});await f.settle();f.expire();let tree=await f.settle();
  assert.match(text(tree),/could not load/);assert.match(text(select(tree)),/Unavailable/);assert.doesNotMatch(text(select(tree)),/Loading/);assert.equal(details(tree).length,0);
  completeAuth({Authorization:'Bearer late-identity'});tree=await f.settle();assert.equal(f.requests.length,0);assert.equal(select(tree).props.value,'');f.unmount();
});

test('initial read failure stays quiet until details are requested and a successful retry closes them',async()=>{
  const f=fixture({failRead:true});let tree=await f.settle();
  assert.equal(select(tree).props.disabled,true);assert.match(text(select(tree)),/Unavailable/);assert.doesNotMatch(text(select(tree)),/Loading/);
  assert.equal(details(tree).length,0);assert.equal(nodes(tree,node=>node.props?.role==='alert').length,0);
  const trigger=button(tree,'Check status');assert.equal(trigger.props['aria-expanded'],false);trigger.props.onClick();tree=await f.settle();
  assert.equal(details(tree).length,1);assert.match(text(details(tree)),/could not load/);assert.equal(button(tree,'Check status').props['aria-controls'],details(tree)[0].props.id);
  f.restoreRead();button(tree,'Retry').props.onClick();tree=await f.settle();assert.equal(select(tree).props.value,'online');assert.equal(details(tree).length,0);assert.equal(button(tree,'Check status'),undefined);f.unmount();
});

test('background read failures preserve the confirmed status without opening a popup, including after a prior successful retry',async()=>{
  const f=fixture();await f.settle();f.failRead();f.focus();let tree=await f.settle();
  assert.equal(select(tree).props.value,'online');assert.equal(details(tree).length,0);assert.equal(nodes(tree,node=>node.props?.role==='alert').length,0);
  button(tree,'Check status').props.onClick();tree=await f.settle();assert.match(text(details(tree)),/Last confirmed:\s+Online/);
  f.restoreRead();button(tree,'Retry').props.onClick();await f.settle();f.failRead();f.focus();tree=await f.settle();assert.equal(details(tree).length,0);f.unmount();
});

test('details can be closed by button or Escape without discarding their actionable error',async()=>{
  const f=fixture({failRead:true});let tree=await f.settle();button(tree,'Check status').props.onClick();tree=await f.settle();
  button(tree,'Close').props.onClick();tree=await f.settle();assert.equal(details(tree).length,0);assert.equal(button(tree,'Check status').props['aria-expanded'],false);
  button(tree,'Check status').props.onClick();tree=await f.settle();let prevented=false;tree.props.onKeyDown({key:'Escape',preventDefault:()=>{prevented=true;}});tree=await f.settle();
  assert.equal(prevented,true);assert.equal(details(tree).length,0);assert.match(text(tree),/could not load/);f.unmount();
});

test('repeated focus events share one pending read instead of overlapping requests',async()=>{
  let finish;const f=fixture({read:new Promise(resolve=>{finish=resolve;})});await f.settle();assert.equal(f.requests.length,1);
  f.focus();f.focus();f.focus();await f.settle();assert.equal(f.requests.length,1);
  finish(Response.json({ok:true,status:'busy'}));let tree=await f.settle();assert.equal(select(tree).props.value,'busy');
  f.focus();tree=await f.settle();assert.equal(f.requests.length,2);f.unmount();
});

test('a stalled response times out into a quiet actionable state and unmount aborts requests',async()=>{
  let finish;const f=fixture({read:new Promise(resolve=>{finish=resolve;})});await f.settle();f.expire();let tree=await f.settle();
  assert.equal(f.requests[0].init.signal.aborted,true);assert.match(text(select(tree)),/Unavailable/);assert.equal(details(tree).length,0);
  finish(Response.json({ok:true,status:'offline'}));tree=await f.settle();assert.equal(select(tree).props.value,'');assert.equal(f.events.length,0);f.unmount();
  const pending=fixture({read:new Promise(()=>{})});await pending.settle();pending.unmount();assert.equal(pending.requests[0].init.signal.aborted,true);pending.expire();await tick();
});
