import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/trade-device-client.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(options={}){
  const record={exports:{}},storage=new Map([['tlink-push-subscription-id','subscription-fixture']]),requests=[],closed=[];
  let subscriptions=0,auth=0;
  const subscription={unsubscribe:async()=>{subscriptions++;if(options.browserFail)throw new Error('Browser offline');return true;}};
  const registration={active:{scriptURL:options.otherWorker?'https://tlink.test/other-worker.js':'https://tlink.test/tlink-notifications-sw.js'},pushManager:{getSubscription:async()=>options.empty?null:subscription},getNotifications:async()=>[{tag:'tlink:team-message:test',close:()=>closed.push('tlink')},{tag:'other',close:()=>closed.push('other')}],unregister:()=>{throw new Error('Never unregister worker');}};
  const context={module:record,exports:record.exports,URL,AbortSignal,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},navigator:{serviceWorker:{getRegistration:async()=>options.noWorker?undefined:registration}},fetch:async(url,init)=>{requests.push({url,init});if(options.serverFail)throw new Error('Server offline');return {ok:true,json:async()=>({ok:true})};}};
  vm.runInNewContext(compiled,context);
  return {api:record.exports,storage,requests,closed,removed:()=>subscriptions,auth:()=>auth,headers:async()=>{auth++;return {Authorization:'Bearer fixture-old-user'};}};
}
test('sign-out disables both delivery paths and closes only TLink notifications',async()=>{
  const f=fixture(),result=await f.api.disableTradeDeviceNotifications(f.headers);
  assert.equal(result.serverRemoved,true);assert.equal(result.browserRemoved,true);assert.equal(f.auth(),1);assert.equal(f.removed(),1);
  assert.equal(f.requests[0].init.headers.Authorization,'Bearer fixture-old-user');assert.equal(f.storage.size,0);assert.deepEqual(f.closed,['tlink']);
});
test('server failure still unsubscribes the browser and permits sign-out',async()=>{
  const f=fixture({serverFail:true}),result=await f.api.disableTradeDeviceNotifications(f.headers);
  assert.equal(result.serverRemoved,false);assert.equal(result.browserRemoved,true);assert.equal(f.removed(),1);assert.equal(f.storage.size,0);
});
test('browser failure still deletes the server subscription and closes toasts',async()=>{
  const f=fixture({browserFail:true}),result=await f.api.disableTradeDeviceNotifications(f.headers);
  assert.equal(result.serverRemoved,true);assert.equal(result.browserRemoved,false);assert.equal(f.requests.length,1);assert.deepEqual(f.closed,['tlink']);assert.equal(f.storage.size,0);
});
test('failure of both delivery removals blocks sign-out and preserves the ID for retry',async()=>{
  const f=fixture({browserFail:true,serverFail:true});await assert.rejects(f.api.disableTradeDeviceNotifications(f.headers),/try signing out again/);
  assert.equal(f.storage.get('tlink-push-subscription-id'),'subscription-fixture');assert.deepEqual(f.closed,['tlink']);
});
test('missing subscriptions or a different service worker do not block sign-out or unregister anything',async()=>{
  for(const options of [{noWorker:true},{otherWorker:true},{empty:true}]){
    const f=fixture(options);f.storage.clear();const result=await f.api.disableTradeDeviceNotifications(f.headers);
    assert.equal(result.browserRemoved,true);assert.equal(f.removed(),0);assert.equal(f.auth(),0);
  }
});
test('malformed persisted IDs are ignored instead of sent to the server',()=>{
  const f=fixture();f.storage.set('tlink-push-subscription-id','../other-user');assert.equal(f.api.readTradePushSubscriptionId(),'');
});
