import test from 'node:test';
import assert from 'node:assert/strict';
import {openTeamCallMedia,TeamCallRinger,teamCallMediaConstraints,teamCallCameraConstraints,teamCallMediaError} from '../src/lib/trade-team-call-media.ts';

test('voice calling requests no camera and video starts with the front camera',()=>{
  assert.equal(teamCallMediaConstraints('audio').video,false);
  assert.equal(teamCallMediaConstraints('audio').audio.echoCancellation,true);
  assert.equal(teamCallMediaConstraints('video').video.facingMode.ideal,'user');
  assert.equal(teamCallCameraConstraints('environment').facingMode.exact,'environment');
});

test('permission denial tells the user how to recover and only names the requested devices',()=>{
  const denied=new DOMException('blocked','NotAllowedError');
  assert.match(teamCallMediaError(denied,'audio'),/microphone permission is blocked/);
  assert.doesNotMatch(teamCallMediaError(denied,'audio'),/camera/);
  assert.match(teamCallMediaError(denied,'video'),/microphone and camera/);
  assert.match(teamCallMediaError(denied,'video'),/device settings/);
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
  const failure=assert.rejects(pending,/access was not completed/);
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
