import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const presence = {};
Function('exports', ts.transpileModule(readFileSync(new URL('../../src/lib/trade-team-presence.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(presence);

const source = readFileSync(new URL('../src/components/team-presence.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);

function fixture() {
  let cursor=0, server='online', failSave=false, nextRead, nextSave;
  const state=[],effects=[],pending=[],listeners=new Set(),intervals=new Set(),frames=new Set(),requests=[],events=[];
  const same=(a,b)=>a && b && a.length===b.length && a.every((value,i)=>value===b[i]);
  const react={
    useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=cursor++;return state[i]||={current:initial};},
    useCallback(fn,deps){const i=cursor++;if(!state[i]||!same(state[i].deps,deps))state[i]={deps,fn};return state[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||!same(effects[i].deps,deps)){const old=effects[i];effects[i]={deps};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}},
  };
  const request=async(url,init={})=>{
    requests.push({url,init});
    if(init.method==='PATCH'){if(failSave)throw new Error('offline');if(nextSave){const result=nextSave;nextSave=null;return result;}server=JSON.parse(init.body).status;}
    else if(nextRead){const result=nextRead;nextRead=null;return result;}
    return {ok:true,status:server};
  };
  const dependencies={
    react,
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-native':{AppState:{currentState:'active',addEventListener:(_event,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};}},DeviceEventEmitter:{emit:(type,detail)=>events.push({type,detail})},Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:value=>value}},
    '../../../src/lib/trade-team-presence':presence,
    '@/lib/use-business-api':{useBusinessApi:()=>request},
    '@/lib/theme':{colours:{},radius:{},spacing:{}},
  };
  const exports={};
  Function('require','exports','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',compiled)(name=>{assert.ok(name in dependencies,name);return dependencies[name];},exports,fn=>{intervals.add(fn);return fn;},fn=>intervals.delete(fn),fn=>{frames.add(fn);return fn;},fn=>frames.delete(fn));
  const render=()=>{cursor=0;const tree=exports.TeamPresence();for(const effect of pending.splice(0))effect();for(const frame of [...frames]){frames.delete(frame);frame();}return tree;};
  return {render,requests,events,intervals,failSave:()=>{failSave=true;},setServer:value=>{server=value;},nextRead:value=>{nextRead=value;},nextSave:value=>{nextSave=value;},foreground:()=>{for(const listener of listeners)listener('active');},unmount:()=>{for(const effect of effects)effect?.cleanup?.();},async settle(){let tree;for(let i=0;i<4;i++){tree=render();await tick();}return tree;}};
}
const option=(tree,status)=>nodes(tree).find(node=>node.type==='Pressable'&&node.props.accessibilityRole==='radio'&&text(node).includes(status));
const trigger=tree=>nodes(tree).find(node=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('My call status'));

test('native status selector saves only the selected availability and emits after server confirmation',async()=>{
  const f=fixture();let tree=await f.settle();assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Online');
  option(tree,'Busy').props.onPress();tree=await f.settle();assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Busy');
  assert.deepEqual(JSON.parse(f.requests.find(item=>item.init.method==='PATCH').init.body),{status:'busy'});
  assert.deepEqual(f.events,[{type:'tlink:team-presence-changed',detail:{status:'online'}},{type:'tlink:team-presence-changed',detail:{status:'busy'}}]);assert.match(text(tree),/Messages still arrive/);f.unmount();assert.equal(f.intervals.size,0);
});

test('failed status save keeps Online and leaves a useful error without silencing calls',async()=>{
  const f=fixture();let tree=await f.settle();f.failSave();option(tree,'Offline').props.onPress();tree=await f.settle();
  assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Online');assert.match(text(tree),/was not changed/);assert.deepEqual(f.events,[{type:'tlink:team-presence-changed',detail:{status:'online'}}]);assert.equal(option(tree,'Online').props.disabled,false);f.unmount();
});

test('foreground refresh applies another device status to the local call provider without writing a change',async()=>{
  const f=fixture();await f.settle();f.setServer('offline');f.foreground();let tree=await f.settle();assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Offline');
  f.setServer('online');f.foreground();tree=await f.settle();assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Online');
  assert.deepEqual(f.events.map(event=>event.detail.status),['online','offline','online']);assert.equal(f.requests.some(item=>item.init.method==='PATCH'),false);f.unmount();
});

test('late earlier read cannot replace a newly confirmed status',async()=>{
  const f=fixture();let tree=await f.settle();let finish;f.nextRead(new Promise(resolve=>{finish=resolve;}));f.foreground();await tick();
  option(tree,'Busy').props.onPress();tree=await f.settle();finish({ok:true,status:'online'});tree=await f.settle();assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Busy');f.unmount();
});

test('old business unmount cannot emit a successful change under the next business',async()=>{
  const f=fixture();await f.settle();let finish;f.nextRead(new Promise(resolve=>{finish=resolve;}));f.foreground();f.unmount();finish({ok:true,status:'offline'});await tick();assert.deepEqual(f.events.map(event=>event.detail.status),['online']);assert.equal(f.intervals.size,0);
});

test('a stalled status save stops waiting and keeps the last confirmed status',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();let tree=await f.settle();let finish;
  f.nextSave(new Promise(resolve=>{finish=resolve;}));option(tree,'Offline').props.onPress();tree=await f.settle();
  assert.equal(option(tree,'Online').props.disabled,true);
  t.mock.timers.tick(12_000);tree=await f.settle();
  assert.equal(option(tree,'Online').props.disabled,false);assert.match(text(tree),/was not changed/);
  finish({ok:true,status:'offline'});tree=await f.settle();
  assert.equal(trigger(tree).props.accessibilityLabel,'My call status: Online');
  assert.deepEqual(f.events.map(event=>event.detail.status),['online']);f.unmount();
});

test('bundled ringtone is a small quiet PCM clip with a pause between rings',()=>{
  const audio=readFileSync(new URL('../assets/sounds/tlink-call-soft.wav',import.meta.url));
  assert.equal(audio.toString('ascii',0,4),'RIFF');assert.equal(audio.toString('ascii',8,12),'WAVE');assert.equal(audio.readUInt16LE(22),1);assert.equal(audio.readUInt32LE(24),22050);assert.equal(audio.readUInt16LE(34),16);
  assert.ok(audio.length<200000);let peak=0;for(let i=44;i<audio.length;i+=2)peak=Math.max(peak,Math.abs(audio.readInt16LE(i)));assert.ok(peak>1000 && peak<16000);
  const lastSecond=audio.subarray(audio.length-44100);assert.ok(lastSecond.every(byte=>byte===0));
});
