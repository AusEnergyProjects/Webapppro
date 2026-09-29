import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const compile = path => ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const component = compile('../src/components/TradeNotificationSettings.tsx');
const client = compile('../src/lib/trade-notification-client.ts');
const key = Buffer.from([4,...Array.from({length:64},(_,i)=>i)]).toString('base64url');
const saved = {id:'device_1',messages:true,calls:true,enabled:true};
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node,match) => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(item=>nodes(item,match)) : [...(match(node)?[node]:[]),...nodes(node.props?.children,match)];
const button = (tree,label) => nodes(tree,node=>node.type==='button' && text(node)===label)[0];
const label = tree => text(nodes(tree,node=>node.type==='summary')[0]);
const tick = () => new Promise(resolve=>setImmediate(resolve));

function harness(options={}) {
  let cursor=0,permission=options.permission||'default',browserSubscription=null,permissionRequests=0,unsubscribed=0;
  const state=[],effects=[],pending=[],requests=[],shown=[],timers=new Map(),storage=new Map();
  const changed=(before,after)=>!before||before.length!==after.length||before.some((value,i)=>value!==after[i]);
  const react={
    useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=cursor++;return state[i]||={current:initial};},
    useCallback(callback,dependencies){const i=cursor++;if(!state[i]||changed(state[i].dependencies,dependencies))state[i]={dependencies,value:callback};return state[i].value;},
    useEffect(callback,dependencies){const i=cursor++;if(!effects[i]||changed(effects[i].dependencies,dependencies)){const old=effects[i];effects[i]={dependencies};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=callback();});}},
  };
  const subscription={toJSON:()=>({endpoint:'private-browser-endpoint',keys:{}}),unsubscribe:async()=>{unsubscribed++;browserSubscription=null;return true;}};
  const registration={active:{scriptURL:'https://tlink.test/tlink-notifications-sw.js'},pushManager:{getSubscription:async()=>browserSubscription,subscribe:async()=>{browserSubscription=subscription;return subscription;}},showNotification:async(title,settings)=>{shown.push({title,settings});}};
  const navigator={userAgent:options.iphone?'iPhone':'Chrome',maxTouchPoints:options.iphone?5:0,serviceWorker:{getRegistration:async()=>undefined,register:async()=>registration,ready:options.workerHang?new Promise(()=>{}):Promise.resolve(registration)}};
  const Notification={get permission(){return permission;},requestPermission:async()=>{permissionRequests++;if(options.permissionError)throw options.permissionError;const result=options.choose?await options.choose():options.choice||'granted';permission=result;return result;}};
  const window={isSecureContext:true,Notification,PushManager:{},matchMedia:()=>({matches:!!options.standalone}),addEventListener(){},removeEventListener(){}};
  const fetch=async(url,init)=>{requests.push({url,init});if(options.postError&&init.method==='POST')return Response.json({ok:false,error:options.postError},{status:503});return Response.json({ok:true,...(init.method==='GET'?{configured:options.configured!==false,publicKey:key,subscription:options.saved||null}:{subscription:saved})});};
  const localStorage={getItem:name=>storage.get(name)||null,setItem:(name,value)=>storage.set(name,value),removeItem:name=>storage.delete(name)};
  const helpers={};
  Function('exports','setTimeout','clearTimeout','localStorage',client)(helpers,(callback,ms)=>{const id=Symbol();timers.set(id,{callback,ms});return id;},id=>timers.delete(id),localStorage);
  const dependencies={react,'react/jsx-runtime':jsx,'./TradeBusinessProvider':{useTradeBusinessFetch:()=>fetch},'@/lib/trade-notification-client':helpers,'./TradeNotificationSettings.module.css':{default:{}}};
  const exports={};Function('require','exports','window','navigator','Notification',component)(id=>{assert.ok(dependencies[id],id);return dependencies[id];},exports,window,navigator,Notification);
  let auth=options.auth|| (async()=>({Authorization:'Bearer fixture-user'}));
  const render=()=>{cursor=0;const tree=exports.TradeNotificationSettings({getAuthHeaders:auth});for(const effect of pending.splice(0))effect();return tree;};
  return {requests,shown,storage,render,permissionRequests:()=>permissionRequests,unsubscribed:()=>unsubscribed,setAuth:next=>{auth=next;},
    expire(){for(const [id,timer]of [...timers]){timers.delete(id);timer.callback();}},
    unmount(){for(const effect of effects)effect?.cleanup?.();},
    async settle(){let tree;for(let i=0;i<6;i++){tree=render();await tick();}return tree;},
  };
}

test('enable requests permission only on click, persists On, and test alerts are local to this device',async()=>{
  const h=harness();let tree=await h.settle();assert.equal(h.permissionRequests(),0);assert.match(label(tree),/Off/);
  button(tree,'Enable notifications').props.onClick();tree=await h.settle();assert.match(label(tree),/On/);assert.equal(h.permissionRequests(),1);
  assert.equal(h.storage.get('tlink-push-subscription-id'),'device_1');assert.equal(h.requests.filter(request=>request.init.method==='POST').length,1);
  button(tree,'Test this device').props.onClick();tree=await h.settle();assert.equal(h.shown.length,1);assert.equal(h.shown[0].settings.body,'Device notification test');
  assert.deepEqual(h.shown[0].settings.data,{kind:'device-test'});assert.equal(h.requests.filter(request=>request.init.method==='POST').length,1);
  assert.match(text(tree),/Focus or Do Not Disturb/);h.unmount();
});

test('dismissed permission needs attention with an explanation and does not register a device',async()=>{
  const h=harness({choice:'default'});let tree=await h.settle();button(tree,'Enable notifications').props.onClick();tree=await h.settle();
  assert.match(label(tree),/Needs attention/);assert.match(text(tree),/until you choose Allow/);assert.match(text(tree),/beside the address bar/);assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);h.unmount();
});

test('blocked permission stays visible in the badge with recovery instructions',async()=>{
  const h=harness({choice:'denied'});let tree=await h.settle();button(tree,'Enable notifications').props.onClick();tree=await h.settle();
  assert.match(label(tree),/Blocked/);assert.match(text(tree),/browser or device settings/);assert.ok(button(tree,'Check again'));assert.equal(button(tree,'Enable notifications'),undefined);h.unmount();
});

test('registration failure is Needs attention and cleans up the new browser subscription',async()=>{
  const h=harness({postError:'Notifications are temporarily unavailable.'});let tree=await h.settle();button(tree,'Enable notifications').props.onClick();tree=await h.settle();
  assert.match(label(tree),/Needs attention/);assert.equal(nodes(tree,node=>node.props?.role==='alert').length,1);assert.equal(h.unsubscribed(),1);assert.equal(h.storage.size,0);h.unmount();
});

test('hung sign-in and worker readiness leave the grey state with an actionable timeout',async()=>{
  for(const options of [{auth:()=>new Promise(()=>{})},{workerHang:true}]){
    const h=harness(options);await h.settle();h.expire();const tree=await h.settle();assert.match(label(tree),/Needs attention/);assert.match(text(tree),/took too long/);assert.equal(button(tree,'Check again').props.disabled,false);h.unmount();
  }
});

test('rerendering new auth callbacks does not cancel an in-progress permission choice',async()=>{
  let choose;const h=harness({choose:()=>new Promise(resolve=>{choose=resolve;})});let tree=await h.settle();button(tree,'Enable notifications').props.onClick();await h.settle();
  h.setAuth(async()=>({Authorization:'Bearer same-user-refreshed'}));await h.settle();choose('granted');tree=await h.settle();
  assert.match(label(tree),/On/);assert.equal(h.requests.filter(request=>request.init.method==='GET').length,1);assert.equal(h.requests.find(request=>request.init.method==='POST').init.headers.Authorization,'Bearer fixture-user');h.unmount();
});

test('unmount during permission request never registers using the next sign-in',async()=>{
  let choose;const h=harness({choose:()=>new Promise(resolve=>{choose=resolve;})});const tree=await h.settle();button(tree,'Enable notifications').props.onClick();h.unmount();choose('granted');await tick();await tick();
  assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
});

test('iPhone browser explains installation and missing server setup is distinct from Off',async()=>{
  const iphone=harness({iphone:true});const tree=await iphone.settle();assert.match(label(tree),/Set up/);assert.match(text(tree),/Add to Home Screen/);assert.equal(iphone.requests.length,0);iphone.unmount();
  const unavailable=harness({configured:false});const unavailableTree=await unavailable.settle();assert.match(label(unavailableTree),/Unavailable/);assert.equal(button(unavailableTree,'Enable notifications'),undefined);unavailable.unmount();
});
