import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {tradeBrowserDevice} from '../src/lib/trade-notification-client.ts';

const source=readFileSync(new URL('../src/components/FieldAppDownload.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(' '):text(n.props?.children);
const nodes=(n,match)=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(x=>nodes(x,match)):[...(match(n)?[n]:[]),...nodes(n.props?.children,match)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({ua='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile Safari/604.1',standalone=false,release='https://download.example/tlink.apk'}={}) {
  let cursor=0;const states=[],effects=[],pending=[],frames=[],listeners=new Map(),requests=[];
  const changed=(a,b)=>!a||a.some((v,i)=>v!==b[i]);
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=cursor++;return states[i]||={current:initial};},useEffect(fn,deps){const i=cursor++;if(!effects[i]||changed(effects[i].deps,deps)){const old=effects[i];effects[i]={deps};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}}};
  const navigator={userAgent:ua,maxTouchPoints:5,standalone};
  const window={matchMedia:()=>({matches:standalone}),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const fetch=async(url,init)=>{requests.push({url,init});return Response.json({policy:{latestVersion:'1.0.2',updateUrl:release}});};
  const deps={react,'react/jsx-runtime':jsx,'@/lib/trade-notification-client':{tradeBrowserDevice:()=>tradeBrowserDevice(navigator)}};
  const exports={};Function('require','exports','window','navigator','fetch','requestAnimationFrame','cancelAnimationFrame',compiled)(id=>{assert.ok(deps[id],id);return deps[id];},exports,window,navigator,fetch,fn=>{frames.push(fn);return frames.length;},()=>{});
  const render=()=>{cursor=0;const tree=exports.FieldAppDownload();for(const fn of pending.splice(0))fn();for(const fn of frames.splice(0))fn();return tree;};
  return {requests,exports,emit:(name,event)=>listeners.get(name)?.(event),async settle(){let tree;for(let i=0;i<5;i++){tree=render();await tick();}return tree;},dispose(){for(const effect of effects)effect?.cleanup?.();}};
}
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&text(n)===label)[0];

test('Chrome on iPhone gets its own Home Screen steps, with no Android request or PIN requirement',async()=>{
  const f=fixture(),tree=await f.settle();assert.match(text(tree),/In\s+Chrome\s*, tap\s+Share/);assert.match(text(tree),/Add to Home Screen/);assert.match(text(tree),/existing team login/);assert.doesNotMatch(text(tree),/Download Android|field app PIN|Open TLink in Safari/);assert.equal(f.requests.length,0);f.dispose();
});
test('Android uses the current validated release and retains existing app sign-in guidance',async()=>{
  const f=fixture({ua:'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36'}),tree=await f.settle();
  assert.equal(f.requests.length,1);assert.ok(f.requests[0].init.signal);assert.equal(nodes(tree,n=>n.type==='a'&&text(n).includes('Download Android'))[0].props.href,'https://download.example/tlink.apk');assert.match(text(tree),/one-time field app PIN/);f.dispose();
});
test('invalid release links cannot become downloads and show a retry action',async()=>{
  const f=fixture({ua:'Android Chrome/140.0',release:'javascript:alert(1)'}),tree=await f.settle();assert.match(text(tree),/could not load/);assert.ok(button(tree,'Try again'));assert.equal(nodes(tree,n=>n.type==='a'&&text(n).includes('Download')).length,0);f.dispose();
});
test('installation starts only from the user button and respects dismissal',async()=>{
  const f=fixture({ua:'Windows Chrome/140.0'});await f.settle();let prompts=0,prevented=0;
  f.emit('beforeinstallprompt',{preventDefault(){prevented++;},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'dismissed'})});
  let tree=await f.settle();assert.equal(prompts,0);assert.equal(prevented,1);button(tree,'Install TLink').props.onClick();assert.equal(prompts,1);tree=await f.settle();assert.match(text(tree),/keep using TLink here/);assert.equal(button(tree,'Install TLink'),undefined);f.dispose();
});
test('an installed web app opens the existing workspace without installation instructions',async()=>{
  const f=fixture({standalone:true}),tree=await f.settle();assert.match(text(tree),/TLink is on this device/);assert.doesNotMatch(text(tree),/tap Share/);assert.equal(nodes(tree,n=>n.type==='a')[0].props.href,'/direct-trade/dashboard');f.dispose();
});
test('download URL validation rejects relative, unsafe and recursive installer links',()=>{
  const f=fixture();for(const url of ['', '/file.apk','http://download.example/a.apk','javascript:x','https://tlink.test/direct-trade/field-app/?next=x'])assert.equal(f.exports.fieldAppReleaseUrl(url),'');assert.equal(f.exports.fieldAppReleaseUrl('https://download.example/tlink.apk'),'https://download.example/tlink.apk');f.dispose();
});
