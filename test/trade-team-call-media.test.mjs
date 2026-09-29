import test from 'node:test';
import assert from 'node:assert/strict';
import {openTeamCallMedia,TeamCallRinger,teamCallMediaConstraints,teamCallCameraConstraints,teamCallMediaError,teamCallNeedsPermission,teamCallPolicyBlocked,teamCallPermissionState,teamCallPermissionSteps} from '../src/lib/trade-team-call-media.ts';
import {tradeBrowserDevice} from '../src/lib/trade-device-client.ts';

test('voice calling requests no camera and video starts with the front camera',()=>{
  assert.equal(teamCallMediaConstraints('audio').video,false);
  assert.equal(teamCallMediaConstraints('audio').audio.echoCancellation,true);
  assert.equal(teamCallMediaConstraints('video').video.facingMode.ideal,'user');
  assert.equal(teamCallCameraConstraints('environment').facingMode.exact,'environment');
});

test('permission refusal does not claim a persistent block unless the browser reports denied',()=>{
  const denied=new DOMException('blocked','NotAllowedError');
  assert.match(teamCallMediaError(denied,'audio'),/Choose Allow/);
  assert.doesNotMatch(teamCallMediaError(denied,'audio'),/blocked|Safari|Chrome|Edge/);
  assert.doesNotMatch(teamCallMediaError(denied,'audio'),/camera/);
  assert.match(teamCallMediaError(denied,'video'),/microphone and camera/);
  assert.match(teamCallMediaError(denied,'video',true),/reports microphone and camera access is blocked/);
  assert.equal(teamCallNeedsPermission(denied),true);
  assert.equal(teamCallNeedsPermission(new Error('Network failed')),false);
});

test('permission help names only the current browser and requested devices',()=>{
  const chrome=tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile Safari/604.1'});
  const chromeSteps=teamCallPermissionSteps('audio',chrome).join(' ');
  assert.match(chromeSteps,/iPhone Settings > Apps > Chrome/);assert.match(chromeSteps,/microphone icon/);
  assert.doesNotMatch(chromeSteps,/camera|Safari|Edge|Website Settings/);
  const safari=tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPad) Version/18.5 Mobile Safari/604.1'});
  assert.match(teamCallPermissionSteps('video',safari).join(' '),/Website Settings.+Microphone and Camera.+iPad Settings/);
  assert.doesNotMatch(teamCallPermissionSteps('video',safari).join(' '),/Chrome|Edge/);
  const android=tradeBrowserDevice({userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Safari/537.36'});
  assert.match(teamCallPermissionSteps('audio',android).join(' '),/Site settings > Microphone.+Android Settings/);
  const desktop=tradeBrowserDevice({userAgent:'Mozilla/5.0 (Windows) Chrome/140.0 Safari/537.36 Edg/140.0'});
  assert.match(teamCallPermissionSteps('audio',desktop).join(' '),/site controls beside/);
  assert.doesNotMatch(teamCallPermissionSteps('audio',desktop).join(' '),/iPhone|Android|Safari/);
  const embedded=tradeBrowserDevice({userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148'});
  assert.match(teamCallPermissionSteps('audio',embedded).join(' '),/phone's browser/);
});

test('permission queries distinguish denied, prompt, granted and unsupported without requesting access',async()=>{
  const names=[];
  const mixed={query:async({name})=>{names.push(name);return {state:name==='camera'?'denied':'granted'};}};
  assert.equal(await teamCallPermissionState('video',mixed),'denied');assert.deepEqual(names,['microphone','camera']);
  assert.equal(await teamCallPermissionState('audio',mixed),'granted');
  assert.equal(await teamCallPermissionState('audio',{query:async()=>({state:'prompt'})}),'prompt');
  assert.equal(await teamCallPermissionState('audio',{query:async()=>{throw new TypeError('unsupported');}}),'unknown');
  assert.equal(await teamCallPermissionState('audio',{}),'unknown');
});

test('document policy checks actual microphone and camera capability, not browser identity',()=>{
  assert.equal(teamCallPolicyBlocked('audio',{permissionsPolicy:{allowsFeature:()=>false}}),true);
  assert.equal(teamCallPolicyBlocked('audio',{permissionsPolicy:undefined,featurePolicy:{allowsFeature:()=>false}}),true);
  const cameraOnly={featurePolicy:{allowsFeature:name=>name!=='camera'}};
  assert.equal(teamCallPolicyBlocked('video',cameraOnly),true);assert.equal(teamCallPolicyBlocked('audio',cameraOnly),false);
  assert.equal(teamCallPolicyBlocked('video',{permissionsPolicy:{allowsFeature:()=>true}}),false);
  assert.equal(teamCallPolicyBlocked('video',{featurePolicy:{allowsFeature:()=>{throw new Error('unsupported');}}}),false);
  assert.equal(teamCallPolicyBlocked('video',{featurePolicy:{allowsFeature:()=>undefined}}),false);
  assert.equal(teamCallPolicyBlocked('video',{}),false);
});

test('ignored permission queries cannot leave recovery waiting',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const result=teamCallPermissionState('audio',{query:()=>new Promise(()=>{})});
  context.mock.timers.tick(500);assert.equal(await result,'unknown');
});

test('media request happens synchronously on the initiating click before yielding',async()=>{
  let requested=false;const stream={getTracks:()=>[]};
  const pending=openTeamCallMedia({},()=>{requested=true;return Promise.resolve(stream);});
  assert.equal(requested,true);assert.equal(await pending,stream);
});

test('cancelled permission requests settle promptly and stop any later granted stream',async()=>{
  let grant,stopped=0;const controller=new AbortController();
  const pending=openTeamCallMedia({},()=>new Promise(resolve=>{grant=resolve;}),controller.signal);
  const failure=assert.rejects(pending,error=>error.name==='AbortError');controller.abort();await failure;
  grant({getTracks:()=>[{stop:()=>stopped++}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,1);
  await assert.rejects(openTeamCallMedia({},()=>assert.fail('cancelled request opened hardware'),controller.signal),error=>error.name==='AbortError');
});

test('missing hardware, busy devices and network failures have distinct recovery guidance',()=>{
  assert.match(teamCallMediaError(new DOMException('none','NotFoundError'),'video'),/use voice only/);
  assert.match(teamCallMediaError(new DOMException('none','NotFoundError'),'audio'),/No microphone/);
  assert.match(teamCallMediaError(new DOMException('busy','NotReadableError'),'video'),/Close other apps/);
  assert.match(teamCallMediaError(new DOMException('rear camera missing','OverconstrainedError'),'video'),/unavailable/);
  assert.equal(teamCallMediaError(new Error('Your network is offline.'),'audio'),'Your network is offline.');
});

test('media permission timeout stops a stream granted after the call was cancelled',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let grant,stopped=0;
  const pending=openTeamCallMedia(teamCallMediaConstraints('audio'),()=>new Promise(resolve=>{grant=resolve;}));
  const failure=assert.rejects(pending,error=>error.name==='TeamCallMediaPermissionTimeout'&&teamCallNeedsPermission(error));
  context.mock.timers.tick(30000);await failure;
  grant({getTracks:()=>[{stop:()=>stopped++}]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stopped,1);
});

test('successful or denied media requests clear their deadline without hiding the permission error',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let stopped=0;const stream={getTracks:()=>[{stop:()=>stopped++}]};
  assert.equal(await openTeamCallMedia({},async()=>stream),stream);
  const denied=new DOMException('blocked','NotAllowedError');
  await assert.rejects(openTeamCallMedia({},async()=>{throw denied;}),error=>error===denied);
  context.mock.timers.tick(30001);assert.equal(stopped,0);
});

function ringFixture({blocked=false}={}) {
  const states=[],tones=[];let created=0;
  const context={state:'suspended',currentTime:0,destination:{},
    async resume(){if(blocked)throw new DOMException('blocked','NotAllowedError');this.state='running';this.onstatechange?.();},
    async close(){this.state='closed';},
    createOscillator(){const tone={frequency:{value:0},starts:[],stops:0,disconnects:0,connect(){},start(at){this.starts.push(at);},stop(){this.stops++;},disconnect(){this.disconnects++;}};tones.push(tone);return tone;},
    createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}};
  const ringer=new TeamCallRinger(ready=>states.push(ready),()=>{created++;return context;});
  return{ringer,context,tones,states,get created(){return created;}};
}

test('incoming ringing never opens audio before interaction and stops every tone when answered',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  const f=ringFixture();f.ringer.start();context.mock.timers.tick(8000);
  assert.equal(f.created,0);assert.equal(f.tones.length,0);
  assert.equal(await f.ringer.unlock(),true);assert.equal(f.tones.length,2);
  context.mock.timers.tick(4000);assert.equal(f.tones.length,4);
  f.ringer.stop();assert.ok(f.tones.every(tone=>tone.stops===2&&tone.disconnects===1));
  context.mock.timers.tick(8000);assert.equal(f.tones.length,4);f.ringer.close();assert.equal(f.context.state,'closed');
});

test('browser blocking ring sound remains explicit and closing prevents late audio',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  const f=ringFixture({blocked:true});f.ringer.start();assert.equal(await f.ringer.unlock(),false);
  assert.equal(f.states.at(-1),false);assert.equal(f.tones.length,0);
  f.ringer.close();context.mock.timers.tick(8000);assert.equal(await f.ringer.unlock(),false);assert.equal(f.tones.length,0);
});

test('message sound uses the unlocked audio context and stays silent while ringing',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  const f=ringFixture();f.ringer.message();assert.equal(f.tones.length,0);
  await f.ringer.unlock();f.ringer.message();assert.equal(f.tones.length,1);assert.equal(f.tones[0].frequency.value,660);assert.equal(f.tones[0].type,'sine');
  f.ringer.start();const count=f.tones.length;f.ringer.message();assert.equal(f.tones.length,count);
  f.ringer.close();f.ringer.message();assert.equal(f.tones.length,count);
});
