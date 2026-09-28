import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/trade-team-call-client.ts',import.meta.url),'utf8');
const record={exports:{}};
new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(record,record.exports);
const {TeamCallConnections}=record.exports;
const people=[{memberId:'a',name:'Alex',sessionId:'session-a',joinedAt:''},{memberId:'b',name:'Blake',sessionId:'session-b',joinedAt:''}];
function fixture(memberId='a') {
  const connections=[],sent=[],changes=[],failures=[];
  const client=new TeamCallConnections({memberId,sessionId:`session-${memberId}`,local:{getTracks:()=>[{id:'mic'},{id:'camera'}]},iceServers:[{urls:'turn:example.test'}],
    send:async(target,type,payload)=>sent.push({target,type,payload}),changed:value=>changes.push(value),failed:message=>failures.push(message),
    createPeer:configuration=>{const pc={configuration,connectionState:'new',signalingState:'stable',tracks:[],candidates:[],closed:false,
      addTrack(track){this.tracks.push(track);},async createOffer(){return{type:'offer',sdp:'v=0 offer'};},async createAnswer(){return{type:'answer',sdp:'v=0 answer'};},
      async setLocalDescription(description){this.localDescription=description;this.signalingState=description.type==='offer'?'have-local-offer':'stable';},
      async setRemoteDescription(description){this.remoteDescription=description;this.signalingState=description.type==='offer'?'have-remote-offer':'stable';},
      async addIceCandidate(candidate){this.candidates.push(candidate);},close(){this.closed=true;this.connectionState='closed';}};connections.push(pc);return pc;}});
  return{client,connections,sent,changes,failures};
}
const signal=(overrides={})=>({id:'signal',sequence:1,fromMemberId:'a',fromSessionId:'session-a',toSessionId:'session-b',requestId:'request',type:'ice',payload:{candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0},...overrides});

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
