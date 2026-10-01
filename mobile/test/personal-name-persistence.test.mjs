import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function storeHarness(file) {
  const storage=new Map(),writes=[];let beforeRead,beforeWrite;
  const secure={WHEN_UNLOCKED_THIS_DEVICE_ONLY:'locked',
    getItemAsync:async key=>{const value=storage.get(key)||null;const hook=beforeRead;beforeRead=undefined;await hook?.(key);return value;},
    setItemAsync:async(key,value,options)=>{assert.equal(options.keychainAccessible,'locked');const hook=beforeWrite;beforeWrite=undefined;await hook?.(key,value);storage.set(key,value);writes.push({key,value});},
    deleteItemAsync:async key=>storage.delete(key),
  };
  const exports={};Function('require','exports',compile(read(file)))(name=>{assert.equal(name,'expo-secure-store');return secure;},exports);
  return {...exports,storage,writes,readNext:hook=>{beforeRead=hook;},writeNext:hook=>{beforeWrite=hook;}};
}
const field=(ownerId='business-a',memberId='member-a',displayName='Katja')=>({ownerId,memberId,displayName,email:'member@test.invalid',businessName:ownerId,permissions:{canCreateJobs:false,canManageCustomers:false,canViewCustomers:false}});
const choice=(ownerUid='business-a',role='owner',managerName='James')=>({ownerUid,role,memberId:role==='owner'?'owner-a':'member-a',businessName:'Business company',displayName:role==='owner'?'Business company':'Katja',managerName});

test('field name writes are ordered with sign-out and a new login, so delayed storage cannot restore the old principal',async()=>{
  const h=storeHarness('../src/lib/field-session.ts'),old=await h.saveFieldSession('old-token',field());
  const blocked=deferred();h.writeNext(()=>blocked.promise);
  const updating=h.updateFieldPrincipalDisplayName('Katja R',old.localOwnerKey,()=>true);await tick();
  let cleared=false;const clearing=h.clearFieldSession().then(()=>{cleared=true;});
  const signingIn=h.saveFieldSession('new-token',field('business-b','member-b','New person'));
  await tick();assert.equal(cleared,false);
  blocked.resolve();await Promise.all([updating,clearing,signingIn]);
  assert.equal((await h.getFieldPrincipal()).displayName,'New person');assert.equal(await h.getFieldSessionToken(),'new-token');
});

test('field name reads must still match their expected identity and current generation when the read finishes',async()=>{
  const h=storeHarness('../src/lib/field-session.ts'),old=await h.saveFieldSession('token',field());
  let current=true;const reading=deferred();h.readNext(()=>reading.promise);
  const updating=h.updateFieldPrincipalDisplayName('Old result',old.localOwnerKey,()=>current);
  const rejected=assert.rejects(updating,/account changed/);await tick();current=false;
  const clear=h.clearFieldSession();const next=h.saveFieldSession('next-token',field('business-b','member-b','New person'));
  reading.resolve();await Promise.all([rejected,clear,next]);
  await assert.rejects(h.updateFieldPrincipalDisplayName('Wrong person',old.localOwnerKey,()=>true),/account changed/);
  assert.equal((await h.getFieldPrincipal()).displayName,'New person');
});

test('failed field writes do not prevent sign-out from removing private state',async()=>{
  const h=storeHarness('../src/lib/field-session.ts'),old=await h.saveFieldSession('token',field());
  h.writeNext(async()=>{throw new Error('Keychain unavailable');});
  await assert.rejects(h.updateFieldPrincipalDisplayName('Katja R',old.localOwnerKey,()=>true),/Keychain unavailable/);
  await h.clearFieldSession();assert.equal(await h.getFieldPrincipal(),null);assert.equal(await h.getFieldSessionToken(),'');
});

test('owner My name survives cold session reconstruction and staff cannot inherit an owner manager name',async()=>{
  const h=storeHarness('../src/lib/business-session.ts'),business=choice();
  const principal=h.businessPrincipal('james','owner@test.invalid',business);assert.equal(principal.displayName,'James');
  assert.equal(h.businessPrincipal('katja','member@test.invalid',choice('business-a','member','Wrong owner name')).displayName,'Katja');
  await h.saveBusinessSession('james',business,principal);
  await h.updateBusinessPersonalName('james',principal.localOwnerKey,'James Morris',()=>true);
  let saved=await h.getBusinessSession('james');
  assert.equal(saved.business.managerName,'James Morris');assert.equal(saved.business.displayName,'Business company');
  assert.equal(h.businessPrincipal('james',saved.principal.email,saved.business).displayName,'James Morris');
  await h.updateBusinessPersonalName('james',principal.localOwnerKey,'',()=>true);saved=await h.getBusinessSession('james');
  assert.equal(saved.business.managerName,'');assert.equal(saved.principal.displayName,'Business company');
  assert.equal(h.businessPrincipal('james',saved.principal.email,saved.business).displayName,'Business company');
});

test('business name writes cannot resurrect a logged-out session or overwrite the next account',async()=>{
  const h=storeHarness('../src/lib/business-session.ts'),business=choice(),old=h.businessPrincipal('james','',business);
  await h.saveBusinessSession('james',business,old);
  const blocked=deferred();h.writeNext(()=>blocked.promise);
  const updating=h.updateBusinessPersonalName('james',old.localOwnerKey,'James Morris',()=>true);await tick();
  const clearing=h.clearBusinessSession();const nextChoice=choice('business-b','member');
  const next=h.saveBusinessSession('katja',nextChoice,h.businessPrincipal('katja','',nextChoice));
  blocked.resolve();await Promise.all([updating,clearing,next]);
  assert.equal(await h.getBusinessSession('james'),null);
  assert.equal((await h.getBusinessSession('katja')).principal.displayName,'Katja');
  await assert.rejects(h.updateBusinessPersonalName('james',old.localOwnerKey,'Wrong',()=>true),/business changed/);
  assert.equal((await h.getBusinessSession('katja')).principal.displayName,'Katja');
});

test('business personal updates recheck generation and pause after an asynchronous cache read',async()=>{
  for(const invalidation of ['generation','pause']) {
    const h=storeHarness('../src/lib/business-session.ts'),business=choice(),old=h.businessPrincipal('james','',business);
    await h.saveBusinessSession('james',business,old);
    let current=true;const reading=deferred();h.readNext(()=>reading.promise);
    const updating=h.updateBusinessPersonalName('james',old.localOwnerKey,'Old result',()=>current);
    const rejected=assert.rejects(updating,/business changed/);await tick();
    if(invalidation==='pause')h.pauseBusinessSession(true);else current=false;
    reading.resolve();await rejected;
    assert.equal((await h.getBusinessSession('james',true)).business.managerName,'James');
  }
});

test('a queued verification save cannot run after its identity fence is invalidated',async()=>{
  const h=storeHarness('../src/lib/business-session.ts'),business=choice(),old=h.businessPrincipal('james','',business);
  await h.saveBusinessSession('james',business,old);
  const blocked=deferred();h.writeNext(()=>blocked.promise);
  const updating=h.updateBusinessPersonalName('james',old.localOwnerKey,'James Morris',()=>true);await tick();
  let current=true;const obsolete=h.saveBusinessSession('james',business,old,()=>current);
  const rejected=assert.rejects(obsolete,/account changed/);current=false;
  const clearing=h.clearBusinessSession();blocked.resolve();await Promise.all([updating,rejected,clearing]);
  assert.equal(await h.getBusinessSession('james'),null);
});

function providerNameCallback(overrides={}) {
  const source=ts.createSourceFile('app-provider.tsx',read('../src/providers/app-provider.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='updatePersonalName')callback=node.initializer.arguments[0].getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(callback);
  const state={writes:[],updates:[]},user={...field(),authMode:'field_pin',localOwnerKey:'field:business-a:member-a'};
  const deps={user,switching:{current:false},authGeneration:{current:1},firebaseAuth:{currentUser:null},
    apiRequest:async()=>({ok:true,name:'Katja R',isOwner:false}),updateFieldPrincipalDisplayName:async(...args)=>state.writes.push(args),
    updateBusinessPersonalName:async(...args)=>state.writes.push(args),setUser:updater=>state.updates.push(updater(user)),...overrides};
  return {state,deps,update:Function(...Object.keys(deps),`${compile(`const callback=${callback};`)} return callback;`)(...Object.values(deps))};
}

test('late personal API responses never enter local persistence after sign-out or another Firebase identity',async()=>{
  for(const mode of ['field_pin','firebase']) {
    const reply=deferred(),h=providerNameCallback({user:{...field(),authMode:mode,localOwnerKey:`${mode}:business-a:member-a`},
      firebaseAuth:{currentUser:mode==='firebase'?{uid:'james'}:null},apiRequest:()=>reply.promise});
    const request=h.update('Katja R');
    if(mode==='firebase')h.deps.firebaseAuth.currentUser={uid:'new-user'};else h.deps.authGeneration.current++;
    reply.resolve({ok:true,name:'Katja R',isOwner:false});await assert.rejects(request,/business changed/);
    assert.equal(h.state.writes.length,0);assert.equal(h.state.updates.length,0);
  }
});

test('personal API success passes the original cache identity and a live fence into storage',async()=>{
  const h=providerNameCallback();assert.equal(await h.update('Katja R'),'Katja R');
  const [name,key,isCurrent]=h.state.writes[0];assert.equal(name,'Katja R');assert.equal(key,h.deps.user.localOwnerKey);assert.equal(isCurrent(),true);
  h.deps.authGeneration.current++;assert.equal(isCurrent(),false);assert.equal(h.state.updates[0].displayName,'Katja R');
});
