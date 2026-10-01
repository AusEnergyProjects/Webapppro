import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/trade-team-call-client.ts',import.meta.url),'utf8');
const record={exports:{}};
new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(record,record.exports);
const {TeamCallConnections}=record.exports;
const people=[{memberId:'a',name:'Alex',sessionId:'session-a',joinedAt:''},{memberId:'b',name:'Blake',sessionId:'session-b',joinedAt:''}];
function fixture(memberId='a',send=async()=>{}) {
  const connections=[],sent=[],changes=[],failures=[];
  const localTracks=[{id:'mic',kind:'audio'},{id:'camera',kind:'video'}];
  const local={getTracks:()=>[...localTracks],getVideoTracks:()=>localTracks.filter(t=>t.kind==='video'),removeTrack:track=>localTracks.splice(localTracks.indexOf(track),1),addTrack:track=>localTracks.push(track)};
  const client=new TeamCallConnections({memberId,sessionId:`session-${memberId}`,local,iceServers:[{urls:'turn:example.test'}],
    send:async(target,type,payload)=>{sent.push({target,type,payload});await send(target,type,payload);},changed:value=>changes.push(value),failed:message=>failures.push(message),
    createPeer:configuration=>{const pc={configuration,connectionState:'new',signalingState:'stable',tracks:[],candidates:[],closed:false,
      senders:[],addTrack(track){this.tracks.push(track);this.senders.push({track,async replaceTrack(next){this.track=next;}});},getSenders(){return this.senders;},async createOffer(options){this.offerOptions=options;return{type:'offer',sdp:'v=0 offer'};},async createAnswer(){return{type:'answer',sdp:'v=0 answer'};},
      async setLocalDescription(description){this.localDescription=description;this.signalingState=description.type==='offer'?'have-local-offer':'stable';},
      async setRemoteDescription(description){this.remoteDescription=description;this.signalingState=description.type==='offer'?'have-remote-offer':'stable';},
      async addIceCandidate(candidate){this.candidates.push(candidate);},close(){this.closed=true;this.connectionState='closed';}};connections.push(pc);return pc;}});
  return{client,connections,sent,changes,failures,local};
}
const signal=(overrides={})=>({id:'signal',sequence:1,fromMemberId:'a',fromSessionId:'session-a',toSessionId:'session-b',requestId:'request',type:'ice',payload:{candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0},...overrides});

const flushSends = () => new Promise(resolve => setImmediate(resolve));
function delayedIce() {
  const pending = [];
  return { pending, send: async (_target, type) => {
    if (type === 'ice') await new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } };
}

for (const descriptionType of ['offer', 'answer']) test(`browser ${descriptionType} completes while four ICE requests remain unresolved`, async context => {
  const transport = delayedIce(), f = fixture(descriptionType === 'offer' ? 'a' : 'b', transport.send);
  context.after(() => f.client.close());
  const syncing = f.client.sync(people), pc = f.connections[0];
  const setLocal = pc.setLocalDescription;
  pc.setLocalDescription = async function(description) {
    for (let index = 0; index < 12; index += 1) this.onicecandidate({ candidate: { ...signal().payload, candidate: `candidate:${index}` } });
    await setLocal.call(this, description);
  };
  let completed = false;
  const work = descriptionType === 'offer' ? syncing
    : syncing.then(() => f.client.receive(signal({ type: 'offer', payload: { type: 'offer', sdp: 'v=0' } })));
  void work.then(() => { completed = true; });
  await flushSends();
  assert.equal(transport.pending.length, 4);
  assert.deepEqual(f.sent.map(item => item.type), ['ice', 'ice', 'ice', 'ice', descriptionType]);
  assert.equal(completed, true, 'SDP completes before any candidate request resolves');
  f.client.close();
  for (const item of transport.pending.splice(0)) item.resolve();
  await work;
});

test('browser ICE sends four immediately and drains a bounded number concurrently', async context => {
  const transport = delayedIce(), f = fixture('b', transport.send);
  context.after(() => f.client.close());
  await f.client.sync(people);
  for (let index = 0; index < 20; index += 1) f.connections[0].onicecandidate({ candidate: { ...signal().payload, candidate: `candidate:${index}` } });
  assert.equal(f.sent.length, 4);
  transport.pending.shift().resolve();
  await flushSends();
  assert.equal(f.sent.length, 5);
  assert.equal(transport.pending.length, 4);
  while (transport.pending.length) {
    assert.ok(transport.pending.length <= 4);
    transport.pending.shift().resolve();
    await flushSends();
  }
  assert.deepEqual(f.sent.map(item => item.payload.candidate), Array.from({ length: 20 }, (_, index) => `candidate:${index}`));
});

test('browser rejoin discards queued old-session ICE and ignores late old-session failures', async context => {
  const transport = delayedIce(), f = fixture('b', transport.send);
  context.after(() => f.client.close());
  await f.client.sync(people);
  const oldHandler = f.connections[0].onicecandidate;
  for (let index = 0; index < 12; index += 1) oldHandler({ candidate: signal().payload });
  await f.client.sync([{ ...people[0], sessionId: 'new-session' }, people[1]]);
  assert.equal(f.connections[0].onicecandidate, null);
  oldHandler({ candidate: signal().payload });
  f.connections[1].onicecandidate({ candidate: signal().payload });
  await f.client.receive(signal({ fromSessionId: 'new-session', type: 'offer', payload: { type: 'offer', sdp: 'v=0' } }));
  for (const item of transport.pending.splice(0)) item.reject(new Error('Old session request failed'));
  await flushSends();
  assert.equal(f.failures.length, 0);
  assert.equal(f.sent.filter(item => item.target.sessionId === 'session-a').length, 4);
  assert.deepEqual(f.sent.filter(item => item.target.sessionId === 'new-session').map(item => item.type), ['answer', 'ice']);
  f.client.close();
  for (const item of transport.pending.splice(0)) item.resolve();
});

test('browser close discards queued ICE and suppresses late send failures', async () => {
  const transport = delayedIce(), f = fixture('b', transport.send);
  await f.client.sync(people);
  const handler = f.connections[0].onicecandidate;
  for (let index = 0; index < 12; index += 1) handler({ candidate: signal().payload });
  f.client.close();
  handler({ candidate: signal().payload });
  for (const item of transport.pending.splice(0)) item.reject(new Error('Closed request'));
  await flushSends();
  assert.equal(f.sent.length, 4);
  assert.equal(f.failures.length, 0);
});

test('browser send failure reports once and discards queued traffic', async context => {
  const transport = delayedIce(), f = fixture('b', transport.send);
  context.after(() => f.client.close());
  await f.client.sync(people);
  for (let index = 0; index < 12; index += 1) f.connections[0].onicecandidate({ candidate: signal().payload });
  for (const item of transport.pending.splice(0)) item.reject(new Error('Network failed'));
  await flushSends();
  assert.equal(f.sent.length, 4);
  assert.equal(f.failures.length, 1);
  assert.equal(f.connections[0].closed, true);
});

test('browser outgoing ICE queue is limited to 128 waiting requests', async context => {
  const transport = delayedIce(), f = fixture('b', transport.send);
  context.after(() => f.client.close());
  await f.client.sync(people);
  const handler = f.connections[0].onicecandidate;
  for (let index = 0; index < 132; index += 1) handler({ candidate: signal().payload });
  assert.equal(f.failures.length, 0);
  handler({ candidate: signal().payload });
  handler({ candidate: signal().payload });
  assert.equal(f.failures.length, 1);
  assert.equal(f.sent.length, 4);
  assert.equal(f.connections[0].closed, true);
  for (const item of transport.pending.splice(0)) item.resolve();
  await flushSends();
  assert.equal(f.sent.length, 4);
});

test('browser session replacement during offer creation cannot publish stale local SDP', async context => {
  const f = fixture(); context.after(() => f.client.close());
  await f.client.sync(people);
  await f.client.sync([people[0]]);
  // Pause the next offer immediately after peer creation, before it resolves.
  const pending = f.client.sync(people), old = f.connections[1];
  await f.client.sync([people[0]]);
  await pending;
  assert.equal(old.localDescription, undefined);
  assert.equal(f.sent.length, 1);
});

test('browser close during remote SDP cannot create or send an answer', async () => {
  const f = fixture('b'); await f.client.sync(people);
  const pc = f.connections[0]; let finish, answers = 0;
  pc.setRemoteDescription = () => new Promise(resolve => { finish = resolve; });
  pc.createAnswer = async () => { answers += 1; return { type: 'answer', sdp: 'v=0' }; };
  const pending = f.client.receive(signal({ type: 'offer', payload: { type: 'offer', sdp: 'v=0' } }));
  f.client.close(); finish(); await pending;
  assert.equal(answers, 0);
  assert.equal(f.sent.length, 0);
});

test('browser close during the last buffered ICE operation prevents answer creation', async () => {
  const f = fixture('b'); await f.client.sync(people);
  await f.client.receive(signal());
  const pc = f.connections[0]; let finish, answers = 0;
  pc.addIceCandidate = () => new Promise(resolve => { finish = resolve; });
  pc.createAnswer = async () => { answers += 1; return { type: 'answer', sdp: 'v=0' }; };
  const pending = f.client.receive(signal({ type: 'offer', payload: { type: 'offer', sdp: 'v=0' } }));
  await flushSends();
  f.client.close(); finish(); await pending;
  assert.equal(answers, 0);
  assert.equal(f.sent.length, 0);
});

test('only one side offers, adds both media tracks and uses supplied relay configuration',async()=>{
  const a=fixture('a'),b=fixture('b');await a.client.sync(people);await b.client.sync(people);
  assert.equal(a.sent.length,1);assert.equal(a.sent[0].type,'offer');assert.equal(b.sent.length,0);
  assert.deepEqual(a.connections[0].tracks.map(t=>t.id),['mic','camera']);assert.equal(a.connections[0].configuration.iceServers[0].urls,'turn:example.test');
  await a.client.sync(people);assert.equal(a.connections.length,1);assert.equal(a.sent.length,1);
  a.client.close();b.client.close();
});
test('ICE arriving before the offer is queued until the remote description and answered once',async()=>{
  const f=fixture('b');await f.client.sync(people);await f.client.receive(signal());assert.equal(f.connections[0].candidates.length,0);
  await f.client.receive(signal({type:'offer',payload:{type:'offer',sdp:'v=0 offer'}}));
  assert.equal(f.connections[0].candidates.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'answer');f.client.close();
});

test('a voice-only browser offer still accepts video from the answering native teammate',async()=>{
  const f=fixture();f.local.removeTrack(f.local.getVideoTracks()[0]);await f.client.sync(people);
  assert.deepEqual(f.connections[0].tracks.map(track=>track.kind),['audio']);
  assert.deepEqual(f.connections[0].offerOptions,{offerToReceiveAudio:true,offerToReceiveVideo:true});f.client.close();
});
test('stale sender or recipient sessions cannot renegotiate a rejoined call',async()=>{
  const f=fixture('b');await f.client.sync(people);
  await f.client.receive(signal({toSessionId:'old'}));await f.client.receive(signal({fromSessionId:'old'}));
  assert.equal(f.connections[0].candidates.length,0);
  await f.client.sync([{...people[0],sessionId:'new-session'},people[1]]);
  assert.equal(f.connections[0].closed,true);assert.equal(f.connections.length,2);
  await f.client.receive(signal({type:'offer',payload:{type:'offer',sdp:'v=0 old'}}));assert.equal(f.sent.length,0);
  await f.client.receive(signal({fromSessionId:'new-session',type:'offer',payload:{type:'offer',sdp:'v=0 new'}}));assert.equal(f.sent.length,1);f.client.close();
});
test('leaving disconnects removed peers and close disables all future signalling',async()=>{
  const f=fixture();await f.client.sync(people);await f.client.sync([people[0]]);assert.equal(f.connections[0].closed,true);
  await f.client.sync(people);const pc=f.connections[1];f.client.close();assert.equal(pc.closed,true);assert.equal(pc.onicecandidate,null);assert.equal(pc.ontrack,null);
  const count=f.sent.length;await f.client.sync(people);await f.client.receive(signal());assert.equal(f.sent.length,count);
});
test('pre-description ICE is bounded against a participant flooding memory',async()=>{
  const f=fixture('b');await f.client.sync(people);for(let i=0;i<128;i++)await f.client.receive(signal());await assert.rejects(f.client.receive(signal()),/Too many/);f.client.close();
});

test('camera switching replaces every video sender and future joins without touching microphone or renegotiating',async()=>{
  const f=fixture();await f.client.sync([...people,{memberId:'c',name:'Chris',sessionId:'session-c'}]);
  const offers=f.sent.length,mic=f.local.getTracks()[0],camera={id:'back-camera',kind:'video'};
  await f.client.replaceVideoTrack(camera);
  for(const peer of f.connections){assert.equal(peer.getSenders()[1].track,camera);assert.equal(peer.getSenders()[0].track,mic);assert.equal(peer.closed,false);}
  assert.equal(f.sent.length,offers);assert.equal(f.local.getVideoTracks()[0],camera);
  await f.client.sync([...people,{memberId:'c',name:'Chris',sessionId:'session-c'},{memberId:'d',name:'Drew',sessionId:'session-d'}]);
  assert.equal(f.connections[2].getSenders()[1].track,camera);f.client.close();
});

test('a failed camera switch rolls every peer and the shared local stream back',async()=>{
  const f=fixture();await f.client.sync([...people,{memberId:'c',name:'Chris',sessionId:'session-c'}]);
  const old=f.local.getVideoTracks()[0],camera={id:'back-camera',kind:'video'};
  const sender=f.connections[1].getSenders()[1];
  sender.replaceTrack=async function(next){if(next===camera)throw new Error('Camera cannot be encoded');this.track=next;};
  await assert.rejects(f.client.replaceVideoTrack(camera),/could not switch/);
  assert.equal(f.local.getVideoTracks()[0],old);
  for(const peer of f.connections)assert.equal(peer.getSenders()[1].track,old);
  assert.equal(f.failures.length,0);f.client.close();
});

test('camera replacement cannot revive a closed call',async()=>{
  const f=fixture();await f.client.sync(people);const old=f.local.getVideoTracks()[0];f.client.close();
  await assert.rejects(f.client.replaceVideoTrack({id:'new-camera',kind:'video'}),/ended/);
  assert.equal(f.local.getVideoTracks()[0],old);
});

test('a peer that never finishes connecting fails within thirty seconds',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();await f.client.sync(people);
  context.mock.timers.tick(29999);assert.equal(f.failures.length,0);
  context.mock.timers.tick(1);assert.equal(f.failures.length,1);assert.match(f.failures[0],/could not connect/);
  f.client.close();
});

test('connected peers cancel negotiation timeout and transient disconnects can recover',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();await f.client.sync(people);const pc=f.connections[0];
  pc.connectionState='connected';pc.onconnectionstatechange();context.mock.timers.tick(30001);assert.equal(f.failures.length,0);
  pc.connectionState='disconnected';pc.onconnectionstatechange();context.mock.timers.tick(10000);
  pc.connectionState='connected';pc.onconnectionstatechange();context.mock.timers.tick(16000);assert.equal(f.failures.length,0);
  pc.connectionState='disconnected';pc.onconnectionstatechange();context.mock.timers.tick(15000);assert.equal(f.failures.length,1);
  f.client.close();
});

test('removed and closed peers cannot report a late connection timeout',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();await f.client.sync(people);await f.client.sync([people[0]]);
  context.mock.timers.tick(30001);assert.equal(f.failures.length,0);
  await f.client.sync(people);f.client.close();context.mock.timers.tick(30001);assert.equal(f.failures.length,0);
});
