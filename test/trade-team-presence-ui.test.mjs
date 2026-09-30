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
  let cursor=0,status='online',failSave=false,delayedRead;
  const state=[],effects=[],pending=[],timers=new Map(),frames=new Map(),listeners=new Map(),requests=[],events=[];
  const changed=(before,after)=>!before||before.some((value,i)=>value!==after[i]);
  const react={
    useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=cursor++;return state[i]||={current:initial};},
    useCallback(callback,dependencies){const i=cursor++;if(!state[i]||changed(state[i].dependencies,dependencies))state[i]={dependencies,value:callback};return state[i].value;},
    useEffect(callback,dependencies){const i=cursor++;if(!effects[i]||changed(effects[i].dependencies,dependencies)){const old=effects[i];effects[i]={dependencies};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=callback();});}},
  };
  const window={setTimeout:(callback)=>{const id=Symbol();timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>1,clearInterval(){},requestAnimationFrame:callback=>{const id=Symbol();frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>events.push(event)};
  const fetch=async(url,init)=>{requests.push({url,init});if(init.method==='PATCH'){if(failSave)return Response.json({ok:false},{status:503});status=JSON.parse(init.body).status;}else if(delayedRead){const value=delayedRead;delayedRead=null;return value;}return Response.json({ok:true,status,updatedAt:'now'});};
  const dependencies={react,'react/jsx-runtime':jsx,'./TradeBusinessProvider':{useTradeBusinessFetch:()=>fetch},'@/lib/trade-team-presence':presence,'./TradeTeamPresence.module.css':{default:{}}};
  const exports={};Function('require','exports','window','document',compiled)(name=>{assert.ok(dependencies[name],name);return dependencies[name];},exports,window,{hidden:false});
  const auth=options.auth|| (async()=>({Authorization:'Bearer identity'}));
  const render=()=>{cursor=0;const tree=exports.default({getAuthHeaders:auth});for(const effect of pending.splice(0))effect();for(const[id,callback]of [...frames]){frames.delete(id);callback();}return tree;};
  return {render,requests,events,focus:()=>listeners.get('focus')?.(),setServer:value=>{status=value;},failSave:()=>{failSave=true;},delayNextRead:value=>{delayedRead=value;},expire:()=>{for(const[id,callback]of [...timers]){timers.delete(id);callback();}},unmount:()=>{for(const effect of effects)effect?.cleanup?.();},async settle(){let tree;for(let i=0;i<5;i++){tree=render();await tick();}return tree;}};
}
const select=tree=>nodes(tree,node=>node.type==='select')[0];
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
  assert.equal(select(tree).props.value,'online');assert.match(text(tree),/was not changed/);assert.equal(f.events.length,0);assert.equal(select(tree).props.disabled,false);f.unmount();
});

test('focus restores a change made on another device without writing over it',async()=>{
  const f=fixture();await f.settle();f.setServer('offline');f.focus();const tree=await f.settle();
  assert.equal(select(tree).props.value,'offline');assert.equal(dotColour(tree),'#8a939c');assert.equal(f.requests.filter(item=>item.init.method==='PATCH').length,0);f.unmount();
});

test('an earlier read cannot overwrite a newly saved status',async()=>{
  let finish;const f=fixture();let tree=await f.settle();f.delayNextRead(new Promise(resolve=>{finish=resolve;}));f.focus();await tick();
  select(tree).props.onChange({target:{value:'busy'}});tree=await f.settle();assert.equal(select(tree).props.value,'busy');
  finish(Response.json({ok:true,status:'online'}));tree=await f.settle();assert.equal(select(tree).props.value,'busy');f.unmount();
});

test('authentication timeout is actionable and cannot start a late request after expiry',async()=>{
  let completeAuth;const f=fixture({auth:()=>new Promise(resolve=>{completeAuth=resolve;})});await f.settle();f.expire();let tree=await f.settle();
  assert.match(text(tree),/could not load/);completeAuth({Authorization:'Bearer late-identity'});tree=await f.settle();assert.equal(f.requests.length,0);assert.equal(select(tree).props.value,'');f.unmount();
});
