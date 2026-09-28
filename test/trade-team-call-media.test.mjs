import test from 'node:test';
import assert from 'node:assert/strict';
import {teamCallMediaConstraints,teamCallCameraConstraints,teamCallMediaError} from '../src/lib/trade-team-call-media.ts';

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
