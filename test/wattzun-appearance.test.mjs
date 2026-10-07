import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as contract from '../src/lib/wattzun-portal.ts';
import * as workContext from '../src/lib/wattzun-work-context.ts';

const source = readFileSync(new URL('../src/lib/wattzun-appearance.ts', import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
class StorageEventFixture extends Event { constructor(key) { super('storage'); this.key=key; } }
function harness({blocked=false}={}) {
  const values=new Map(), events=new EventTarget(), timers=new Map(), effects=[];
  let activeConsumer='default', timerId=0;
  const consumers=new Map();
  const consumer=()=>{if(!consumers.has(activeConsumer))consumers.set(activeConsumer,{});return consumers.get(activeConsumer);};
  const window={
    localStorage:{getItem:key=>{if(blocked)throw new Error('blocked');return values.get(key)||null;},setItem:(key,value)=>{if(blocked)throw new Error('blocked');values.set(key,value);},removeItem:key=>values.delete(key)},
    addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
    setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame:()=>{},
  };
  const dependencies={react:{useState:initial=>{const slot=consumer();slot.state??=initial;return[slot.state,value=>{slot.state=value;}];},useRef:initial=>{const slot=consumer();slot.reference??={current:initial};return slot.reference;},useEffect:callback=>effects.push(callback)},'./wattzun-portal':contract,'./wattzun-work-context':workContext};
  const exported={};
  new Function('require','exports','window','CustomEvent','StorageEvent',compiled)(name=>dependencies[name],exported,window,CustomEvent,StorageEventFixture);
  return{...exported,values,window,effects,timers,render:(id,selected)=>{activeConsumer=id;return exported.useWattzunPresentation(selected);}};
}
const scope={userUid:'person-a',portal:'trade',scopeId:'business-a'};

test('guided form calls require an explicit trade form selection and preserve the chosen mode',()=>{
  const h=harness(),request={...scope,mode:'call',guidedForm:true,workReference:{kind:'trade_form',formKind:'job_form',recordId:'form-one',jobId:'job-one'}};
  assert.deepEqual(h.readWattzunOpenRequest(request),request);
  for(const patch of [{mode:'message'},{portal:'council'},{portal:'creditex'},{guidedForm:'true'},{workReference:undefined},{workReference:{kind:'trade_job',recordId:'job-one'}}]){
    assert.equal(h.readWattzunOpenRequest({...request,...patch}),null);
  }
});

test('appearance and speed storage isolate actors, portals and workspaces, and malformed/blocked values use defaults',()=>{
  const h=harness();
  for(const other of [{...scope,userUid:'person-b'},{...scope,portal:'council'},{...scope,scopeId:'business-b'}]){
    assert.notEqual(h.wattzunAppearanceKey(scope),h.wattzunAppearanceKey(other));
    assert.notEqual(h.wattzunSpeedKey(scope),h.wattzunSpeedKey(other));
  }
  h.values.set(h.wattzunAppearanceKey(scope),'{"hat":"unknown"}');h.values.set(h.wattzunSpeedKey(scope),'malformed');
  assert.deepEqual(h.readWattzunPresentation(scope),{hat:'none',speed:1});
  assert.deepEqual(harness({blocked:true}).readWattzunPresentation(scope),{hat:'none',speed:1});
  assert.deepEqual(h.WATTZUN_HATS.map(choice=>choice.id),['none','hard-hat','cap','cowboy','viking','pirate','sausage','tinfoil','safety-plug','party','pumpkin','ghost']);
  assert.equal(h.WATTZUN_HATS.find(choice=>choice.id==='ghost').label,'Ghost');
  for (const { id } of h.WATTZUN_HATS) {
    h.writeWattzunPresentation(scope, { hat: id });
    assert.equal(h.readWattzunPresentation(scope).hat, id, `${id} survives storage readback`);
    assert.deepEqual(JSON.parse(h.values.get(h.wattzunSpeedKey(scope))), { speed: 1 }, 'Cosmetic choices never change voice preferences');
  }
});
test('legacy speed migrates without retaining voice, tone or personality, and hats stay outside API preferences',()=>{
  const h=harness(),key=h.wattzunSpeedKey(scope),legacy=key.replace(':v2:',':v1:');
  h.values.set(legacy,JSON.stringify({speed:.85,voice:'marin',tone:'formal',personality:'Private obsolete note'}));
  assert.deepEqual(h.readWattzunPresentation(scope),{hat:'none',speed:.85});assert.equal(h.values.has(legacy),false);
  assert.deepEqual(JSON.parse(h.values.get(key)),{speed:.85});
  h.values.set(key,JSON.stringify({speed:1.15,voice:'marin',personality:'Forged'}));h.values.set(legacy,'malformed');
  assert.deepEqual(h.readWattzunPresentation(scope),{hat:'none',speed:1.15});assert.equal(h.values.has(legacy),false);
  h.writeWattzunPresentation(scope,{hat:'cowboy'});
  assert.deepEqual(JSON.parse(h.values.get(key)),{speed:1.15});assert.deepEqual(JSON.parse(h.values.get(h.wattzunAppearanceKey(scope))),{hat:'cowboy'});
});
test('same-document and cross-tab changes sync, a new actor renders defaults immediately, and listeners clean up',()=>{
  const h=harness();h.useWattzunPresentation(scope);const cleanup=h.effects.shift()();
  h.writeWattzunPresentation(scope,{hat:'hard-hat',speed:.85});
  assert.equal(h.useWattzunPresentation(scope).hat,'hard-hat');assert.equal(h.useWattzunPresentation(scope).speed,.85);
  h.values.set(h.wattzunAppearanceKey(scope),'{"hat":"cap"}');h.window.dispatchEvent(new StorageEventFixture(h.wattzunAppearanceKey(scope)));
  assert.equal(h.useWattzunPresentation(scope).hat,'cap');
  const next={...scope,userUid:'person-b'};
  assert.equal(h.useWattzunPresentation(next).hat,'none');assert.equal(h.useWattzunPresentation(next).speed,1);
  assert.equal(h.useWattzunPresentation(null).hat,'none');
  cleanup();h.writeWattzunPresentation(scope,{hat:'cowboy'});assert.equal(h.useWattzunPresentation(scope).hat,'cap','Unmounted listeners do not update state');
});
test('stale controls update only their field and preserve the complementary choice, including blocked storage',()=>{
  const h=harness();h.useWattzunPresentation(scope);const cleanup=h.effects.shift()();
  const stale=h.useWattzunPresentation(scope);
  h.values.set(h.wattzunSpeedKey(scope),'{"speed":0.85}');stale.setHat('cowboy');
  assert.deepEqual(h.readWattzunPresentation(scope),{hat:'cowboy',speed:.85},'A hat click cannot overwrite the latest tab speed with its stale snapshot');
  h.values.set(h.wattzunAppearanceKey(scope),'{"hat":"cap"}');stale.setSpeed(1.15);
  assert.deepEqual(h.readWattzunPresentation(scope),{hat:'cap',speed:1.15},'A speed click cannot overwrite a later hat choice');cleanup();
  const blocked=harness({blocked:true});blocked.useWattzunPresentation(scope);const stop=blocked.effects.shift()();
  const staleBlocked=blocked.useWattzunPresentation(scope);staleBlocked.setHat('pirate');staleBlocked.setSpeed(.85);
  assert.equal(blocked.useWattzunPresentation(scope).hat,'pirate');assert.equal(blocked.useWattzunPresentation(scope).speed,.85);stop();
});
test('a late consumer reads live same-scope choices with blocked storage, isolates other identities and releases its read listener',()=>{
  const h=harness({blocked:true});
  h.render('tools',scope);const stopTools=h.effects.pop()();
  const controls=h.render('tools',scope);controls.setHat('pirate');controls.setSpeed(.85);
  assert.equal(h.render('conversation',scope).ready,false);const stopConversation=h.effects.pop()();
  const late=h.render('conversation',scope);assert.equal(late.ready,true);assert.equal(late.hat,'pirate');assert.equal(late.speed,.85);
  for(const [id,selected] of [['actor',{...scope,userUid:'person-b'}],['workspace',{...scope,scopeId:'business-b'}],['portal',{...scope,portal:'council'}]]){
    h.render(id,selected);const stop=h.effects.pop()();const other=h.render(id,selected);
    assert.equal(other.hat,'none');assert.equal(other.speed,1);stop();
  }
  stopTools();late.setSpeed(1.15);assert.equal(h.render('conversation',scope).hat,'pirate');assert.equal(h.render('conversation',scope).speed,1.15);
  stopConversation();h.render('after-cleanup',scope);const stopLast=h.effects.pop()();
  assert.equal(h.render('after-cleanup',scope).hat,'none');assert.equal(h.render('after-cleanup',scope).speed,1,'Unmounted hooks cannot provide stale choices');stopLast();
  assert.equal(h.values.size,0,'The handshake stores no preferences when storage is blocked');
});
test('open requests wait for lazy readiness, retain the intended actor and initial draft, and clean the handshake',async()=>{
  const h=harness(), request={...scope,mode:'message',initialMessage:'Help me find the quote'};
  let seen;
  const pending=h.requestWattzunAssistant(request);
  h.window.addEventListener(h.WATTZUN_OPEN_EVENT,event=>{seen=event.detail;event.detail.acknowledge();});
  h.window.dispatchEvent(new CustomEvent(h.WATTZUN_READY_EVENT,{detail:{portal:'trade'}}));
  assert.equal(await pending,true);assert.equal(seen.userUid,'person-a');assert.equal(seen.initialMessage,request.initialMessage);assert.equal(h.timers.size,0);
  assert.equal(h.readWattzunOpenRequest({...request,mode:'autocall'}),null);assert.equal(h.readWattzunOpenRequest({...request,userUid:''}),null);
  assert.equal(h.readWattzunOpenRequest({...request,initialMessage:'x'.repeat(4001)}),null);
});
test('an unavailable assistant returns false after the bounded handshake without storing or calling anything',async()=>{
  const h=harness(),pending=h.requestWattzunAssistant({...scope,mode:'call'});
  assert.equal(h.timers.size,1);[...h.timers.values()][0]();assert.equal(await pending,false);assert.equal(h.timers.size,0);assert.equal(h.values.size,0);
});
