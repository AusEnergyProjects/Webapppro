import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {tradeBrowserDevice} from '../src/lib/trade-device-client.ts';

const source=readFileSync(new URL('../src/components/FieldAppDownload.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(' '):text(n.props?.children);
const nodes=(n,match)=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(x=>nodes(x,match)):[...(match(n)?[n]:[]),...nodes(n.props?.children,match)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const androidUa='Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36';
const appleLink='https://testflight.apple.com/join/AbC12345';
const apkLink='https://expo.dev/artifacts/eas/tlink.apk';
const noRelease='https://ausenergyassessments.com/direct-trade/field-app';
function fixture({ua='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile Safari/604.1',standalone=false,release,releasePlatform,deferred=false}={}) {
  let cursor=0;const states=[],effects=[],pending=[],frames=[],listeners=new Map(),requests=[];
  const changed=(a,b)=>!a||a.some((v,i)=>v!==b[i]);
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=cursor++;return states[i]||={current:initial};},useEffect(fn,deps){const i=cursor++;if(!effects[i]||changed(effects[i].deps,deps)){const old=effects[i];effects[i]={deps};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}}};
  const navigator={userAgent:ua,maxTouchPoints:5,standalone};
  const window={matchMedia:()=>({matches:standalone}),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const fetch=(url,init)=>new Promise((resolve,reject)=>{
    const platform=new URL(url,'https://tlink.test').searchParams.get('platform');
    requests.push({url,init,resolve,reject});
    if(!deferred)resolve(Response.json({policy:{platform:releasePlatform||platform,latestVersion:'1.0.2',updateUrl:release??(platform==='android'?apkLink:noRelease)}}));
  });
  const deps={react,'react/jsx-runtime':jsx,'@/lib/trade-device-client':{tradeBrowserDevice:()=>tradeBrowserDevice(navigator)}};
  const exports={};Function('require','exports','window','navigator','fetch','requestAnimationFrame','cancelAnimationFrame',compiled)(id=>{assert.ok(deps[id],id);return deps[id];},exports,window,navigator,fetch,fn=>{frames.push(fn);return frames.length;},()=>{});
  const render=()=>{cursor=0;const tree=exports.FieldAppDownload();for(const fn of pending.splice(0))fn();for(const fn of frames.splice(0))fn();return tree;};
  return {requests,exports,render,emit:(name,event)=>listeners.get(name)?.(event),respond(index,platform,updateUrl){requests[index].resolve(Response.json({policy:{platform,updateUrl,latestVersion:'1.0.2'}}));},async settle(){let tree;for(let i=0;i<5;i++){tree=render();await tick();}return tree;},dispose(){for(const effect of effects)effect?.cleanup?.();}};
}
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&text(n)===label)[0];
const link=(tree,label)=>nodes(tree,n=>n.type==='a'&&text(n).includes(label))[0];

test('iPhone checks its release policy and shows an honest unavailable state with the web portal primary',async()=>{
  const f=fixture(),tree=await f.settle();
  assert.deepEqual(f.requests.map(r=>r.url),['/api/field/app-release?platform=ios']);
  assert.match(text(tree),/iPhone app is not available yet/);assert.equal(link(tree,'Install iPhone app'),undefined);
  assert.equal(link(tree,'Open web portal').props.className,'tlink-install-primary');
  assert.equal(link(tree,'Open web portal').props.href,'/direct-trade/dashboard');
  const optional=nodes(tree,n=>n.type==='details')[0];assert.match(text(optional),/This adds the web portal, not the native iPhone app/);
  assert.match(text(optional),/In\s+Chrome\s*, tap\s+Share/);assert.match(text(optional),/Add to Home Screen/);
  assert.doesNotMatch(text(tree),/Download Android|field app PIN|TLink is on this device/);f.dispose();
});

test('a published Apple App Store or TestFlight URL produces a native install button',async()=>{
  for(const release of [appleLink,'https://apps.apple.com/au/app/tlink/id1234567890']){
    const f=fixture({release}),tree=await f.settle();assert.equal(link(tree,'Install iPhone app').props.href,release);
    assert.equal(link(tree,'Open web portal').props.className,'tlink-install-secondary');assert.doesNotMatch(text(tree),/not available yet/);f.dispose();
  }
});

test('iPhone never installs an APK, generic website, Apple lookalike or unverified EAS build',async()=>{
  for(const release of [apkLink,'https://example.com/tlink','https://testflight.apple.com.evil.test/join/AbC12345','https://apps.apple.com/au/','https://expo.dev/accounts/aea/projects/tlink/builds/123']){
    const f=fixture({release}),tree=await f.settle();assert.equal(link(tree,'Install iPhone app'),undefined);assert.match(text(tree),/iPhone app is not available yet/);f.dispose();
  }
});

test('a mismatched release policy cannot advertise a native download and offers a retry',async()=>{
  const f=fixture({release:appleLink,releasePlatform:'android'}),tree=await f.settle();
  assert.equal(link(tree,'Install iPhone app'),undefined);assert.match(text(tree),/could not check/);assert.ok(button(tree,'Try again'));
  button(tree,'Try again').props.onClick();await f.settle();assert.equal(f.requests.length,2);f.dispose();
});

test('a Home Screen web portal does not imply that the native iPhone app is installed',async()=>{
  for(const release of [noRelease,appleLink]){
    const f=fixture({standalone:true,release}),tree=await f.settle();
    assert.match(text(tree),/web portal is on your Home Screen/);assert.match(text(tree),/separate from the native iPhone app/);
    assert.equal(Boolean(link(tree,'Install iPhone app')),release===appleLink);
    if(release===noRelease)assert.match(text(tree),/iPhone app is not available yet/);
    assert.equal(nodes(tree,n=>n.type==='details').length,0);assert.doesNotMatch(text(tree),/TLink is on this device/);f.dispose();
  }
});

test('Android keeps its current APK and PIN guidance even when a web portal is installed',async()=>{
  for(const standalone of [false,true]){
    const f=fixture({ua:androidUa,standalone}),tree=await f.settle();
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/field/app-release?platform=android');assert.ok(f.requests[0].init.signal);
    assert.equal(link(tree,'Download Android').props.href,apkLink);assert.match(text(tree),/one-time field app PIN/);f.dispose();
  }
});

test('Android rejects invalid release links and an iPhone link',async()=>{
  for(const release of ['javascript:alert(1)',appleLink]){
    const f=fixture({ua:androidUa,release}),tree=await f.settle();assert.match(text(tree),/could not load/);assert.ok(button(tree,'Try again'));assert.equal(link(tree,'Download Android'),undefined);f.dispose();
  }
});

test('switching platforms hides the old download immediately and ignores a late response',async()=>{
  const f=fixture({ua:androidUa,deferred:true});let tree=await f.settle();
  button(tree,'iPhone / iPad').props.onClick();tree=f.render();assert.equal(link(tree,'Download Android'),undefined);assert.equal(link(tree,'Install iPhone app'),undefined);
  assert.equal(f.requests[0].init.signal.aborted,true);assert.equal(f.requests[1].url,'/api/field/app-release?platform=ios');
  f.respond(1,'ios',appleLink);tree=await f.settle();assert.equal(link(tree,'Install iPhone app').props.href,appleLink);
  f.respond(0,'android',apkLink);tree=await f.settle();assert.equal(link(tree,'Install iPhone app').props.href,appleLink);assert.equal(link(tree,'Download Android'),undefined);
  button(tree,'Android').props.onClick();tree=f.render();assert.equal(link(tree,'Install iPhone app'),undefined);assert.equal(link(tree,'Download Android'),undefined);
  f.respond(2,'android',apkLink);tree=await f.settle();assert.equal(link(tree,'Download Android').props.href,apkLink);f.dispose();
});

test('a failed superseded request cannot replace the current platform result',async()=>{
  const f=fixture({ua:androidUa,deferred:true});let tree=await f.settle();button(tree,'iPhone / iPad').props.onClick();await f.settle();
  f.respond(1,'ios',noRelease);tree=await f.settle();f.requests[0].reject(new Error('old request failed'));tree=await f.settle();
  assert.match(text(tree),/iPhone app is not available yet/);assert.equal(button(tree,'Try again'),undefined);f.dispose();
});

test('switching from an already loaded APK clears it before the iPhone request completes',async()=>{
  const f=fixture({ua:androidUa,deferred:true});await f.settle();f.respond(0,'android',apkLink);let tree=await f.settle();assert.ok(link(tree,'Download Android'));
  button(tree,'iPhone / iPad').props.onClick();tree=f.render();assert.equal(link(tree,'Install iPhone app'),undefined);assert.equal(link(tree,'Download Android'),undefined);assert.match(text(tree),/Checking the iPhone app/);f.dispose();
});

test('computer web installation starts only from its button and respects dismissal',async()=>{
  const f=fixture({ua:'Windows Chrome/140.0'});await f.settle();let prompts=0,prevented=0;
  f.emit('beforeinstallprompt',{preventDefault(){prevented++;},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'dismissed'})});
  let tree=await f.settle();assert.equal(f.requests.length,0);assert.equal(prompts,0);assert.equal(prevented,1);
  button(tree,'Install TLink web portal').props.onClick();assert.equal(prompts,1);tree=await f.settle();assert.match(text(tree),/keep using TLink here/);assert.equal(button(tree,'Install TLink web portal'),undefined);f.dispose();
});

test('an installed desktop web portal is identified without a native app claim',async()=>{
  const f=fixture({ua:'Windows Chrome/140.0',standalone:true}),tree=await f.settle();assert.match(text(tree),/Web portal installed/);assert.equal(f.requests.length,0);
  assert.equal(link(tree,'Open web portal').props.href,'/direct-trade/dashboard');assert.equal(button(tree,'Install TLink web portal'),undefined);f.dispose();
});

test('download validation rejects unsafe, recursive, credential-bearing and mismatched destinations',()=>{
  const f=fixture();
  for(const url of ['', '/file.apk','http://download.example/a.apk','javascript:x','https://tlink.test/direct-trade/field-app/?next=x','https://user:password@download.example/a.apk'])assert.equal(f.exports.fieldAppReleaseUrl(url),'');
  assert.equal(f.exports.fieldAppReleaseUrl(apkLink),apkLink);assert.equal(f.exports.fieldAppReleaseUrl(apkLink,'ios'),'');
  assert.equal(f.exports.fieldAppReleaseUrl(appleLink,'ios'),appleLink);assert.equal(f.exports.fieldAppReleaseUrl(appleLink,'android'),'');
  assert.equal(f.exports.fieldAppReleaseUrl('https://apps.apple.com/app/id123456','ios'),'https://apps.apple.com/app/id123456');
  assert.equal(f.exports.fieldAppReleaseUrl('https://testflight.apple.com:444/join/AbC12345','ios'),'');f.dispose();
});
