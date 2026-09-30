import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const clients = new Set();
test.after(() => { for (const client of clients) client.close(); });

function moduleWithNativeMock(name, native) {
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const result = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    assert.equal(id, 'react-native-webrtc');
    return native;
  }, result, result.exports);
  return result.exports;
}

class Stream {
  constructor(tracks = []) { this.tracks = tracks; this.released = false; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  addTrack(track) { this.tracks.push(track); }
  release() { this.released = true; }
}
const person = (memberId, sessionId = `${memberId}-session`) => ({ memberId, sessionId, name: memberId, joinedAt: '' });
const track = (kind = 'audio') => ({ id: `track-${kind}`, kind, stopped: false, stop() { this.stopped = true; } });
const signal = (type, payload, overrides = {}) => ({ id: 'signal', sequence: 1, fromMemberId: 'a-member', fromSessionId: 'a-member-session', toSessionId: 'local-session', requestId: 'request', type, payload, ...overrides });
const ice = { candidate: 'candidate:one', sdpMid: '0', sdpMLineIndex: 0 };

function harness(memberId = 'z-member') {
  const connections = [], sent = [], changed = [], failures = [];
  class Connection {
    constructor(configuration) { this.configuration = configuration; this.connectionState = 'new'; this.signalingState = 'stable'; this.remoteDescription = null; this.localDescription = null; this.candidates = []; this.added = []; connections.push(this); }
    addTrack(track) { this.added.push(track); }
    async createOffer(options) { this.offerOptions = options; return { type: 'offer', sdp: 'v=0\r\no=offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\no=answer' }; }
    async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    close() { this.closed = true; this.connectionState = 'closed'; }
  }
  const { NativeTeamCallConnections } = moduleWithNativeMock('native-team-call-client', { MediaStream: Stream, RTCPeerConnection: Connection });
  const client = new NativeTeamCallConnections({ memberId, sessionId: 'local-session', local: new Stream([track()]), iceServers: [{ urls: 'turn:relay.test', username: 'temporary', credential: 'temporary' }],
    send: async (...args) => sent.push(args), changed: peers => changed.push(peers), failed: message => failures.push(message) });
  clients.add(client);
  return { client, connections, sent, changed, failures, Connection };
}

test('the lower member ID offers using server TURN, including receive video for voice-only callers', async () => {
  const h = harness('a-member');
  await h.client.sync([person('a-member'), person('z-member')]);
  assert.equal(h.connections.length, 1);
  assert.equal(h.connections[0].configuration.iceServers[0].urls, 'turn:relay.test');
  assert.deepEqual(h.connections[0].offerOptions, { offerToReceiveAudio: true, offerToReceiveVideo: true });
  assert.equal(h.sent[0][1], 'offer');
  assert.equal(h.connections[0].added.length, 1);
});

test('the answerer queues early ICE until remote SDP and sends an answer', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  assert.equal(h.sent.length, 0);
  await h.client.receive(signal('ice', ice));
  assert.equal(h.connections[0].candidates.length, 0);
  await h.client.receive(signal('offer', { type: 'offer', sdp: 'v=0\r\no=web' }));
  assert.deepEqual(h.connections[0].candidates, [ice]);
  assert.equal(h.sent[0][1], 'answer');
  await h.client.receive(signal('ice', { ...ice, candidate: 'candidate:two' }));
  assert.equal(h.connections[0].candidates.length, 2);
});

test('late packets addressed to an old local or remote session cannot change the call', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  await h.client.receive(signal('offer', { type: 'offer', sdp: 'v=0' }, { toSessionId: 'old-local' }));
  await h.client.receive(signal('offer', { type: 'offer', sdp: 'v=0' }, { fromSessionId: 'old-remote' }));
  assert.equal(h.connections[0].remoteDescription, null);
  assert.equal(h.sent.length, 0);
});

test('designated offerer ignores glare, accepts one answer and ignores duplicate answers', async () => {
  const h = harness('a-member');
  await h.client.sync([person('z-member')]);
  const remote = { fromMemberId: 'z-member', fromSessionId: 'z-member-session' };
  await h.client.receive(signal('offer', { type: 'offer', sdp: 'v=0\r\nglare' }, remote));
  assert.equal(h.connections[0].remoteDescription, null);
  await h.client.receive(signal('answer', { type: 'answer', sdp: 'v=0\r\nanswer' }, remote));
  await h.client.receive(signal('answer', { type: 'answer', sdp: 'v=0\r\nduplicate' }, remote));
  assert.equal(h.connections[0].remoteDescription.sdp, 'v=0\r\nanswer');
});

test('rejoining from a different device closes the preceding connection and stream', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  const old = h.connections[0], stream = new Stream([track('video')]);
  old.ontrack({ streams: [stream], track: stream.tracks[0] });
  assert.equal(h.changed.at(-1)[0].stream, stream);
  await h.client.sync([person('a-member', 'replacement-session')]);
  assert.equal(old.closed, true);
  assert.equal(old.ontrack, null);
  assert.equal(stream.released, true);
  assert.equal(h.connections.length, 2);
  await h.client.receive(signal('ice', ice));
  assert.equal(h.connections[1].candidates.length, 0);
});

test('closing while offer creation is pending prevents local SDP or late signaling', async () => {
  const h = harness('a-member');
  let finish;
  h.Connection.prototype.createOffer = () => new Promise(resolve => { finish = resolve; });
  const pending = h.client.sync([person('z-member')]);
  h.client.close();
  finish({ type: 'offer', sdp: 'v=0' });
  await pending;
  assert.equal(h.connections[0].closed, true);
  assert.equal(h.connections[0].localDescription, null);
  assert.equal(h.sent.length, 0);
  await h.client.sync([person('another-member')]);
  assert.equal(h.connections.length, 1);
});

test('closing during remote SDP prevents answers and releases all event handlers', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  let finish;
  h.connections[0].setRemoteDescription = () => new Promise(resolve => { finish = resolve; });
  const pending = h.client.receive(signal('offer', { type: 'offer', sdp: 'v=0' }));
  h.client.close();
  finish();
  await pending;
  assert.equal(h.sent.length, 0);
  assert.equal(h.connections[0].onicecandidate, null);
  assert.equal(h.connections[0].onconnectionstatechange, null);
});

test('ICE buffering and group size are bounded', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  for (let i = 0; i < 128; i++) await h.client.receive(signal('ice', ice));
  await assert.rejects(h.client.receive(signal('ice', ice)), /Too many/);
  await assert.rejects(h.client.sync(Array.from({ length: 7 }, (_, i) => person(`member-${i}`))), /six people/);
});

test('native ICE messages use the same null-safe signaling payload as browser peers', async () => {
  const h = harness();
  await h.client.sync([person('a-member')]);
  h.connections[0].onicecandidate({ candidate: { candidate: 'candidate:native' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent[0].slice(1), ['ice', { candidate: 'candidate:native', sdpMid: null, sdpMLineIndex: null }]);
  h.connections[0].connectionState = 'failed';
  h.connections[0].onconnectionstatechange();
  assert.equal(h.failures.length, 1);
});

test('cancelling a pending permission prompt stops and releases late microphone/camera tracks', async () => {
  let finish, current = true;
  const stream = new Stream([track(), track('video')]);
  const { acquireNativeCallMedia } = moduleWithNativeMock('native-team-call-media', { mediaDevices: { getUserMedia: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = acquireNativeCallMedia('video', () => current);
  current = false;
  finish(stream);
  assert.equal(await pending, null);
  assert.equal(stream.released, true);
  assert.ok(stream.tracks.every(item => item.stopped));
});

test('voice-only requests no camera; partial media is released with a helpful failure', async () => {
  const constraints = [], streams = [new Stream([track()]), new Stream([track('video')])];
  const { acquireNativeCallMedia } = moduleWithNativeMock('native-team-call-media', { mediaDevices: { getUserMedia: async value => { constraints.push(value); return streams[constraints.length - 1]; } } });
  assert.equal(await acquireNativeCallMedia('audio', () => true), streams[0]);
  assert.equal(constraints[0].video, false);
  await assert.rejects(acquireNativeCallMedia('video', () => true), error => error.name === 'NotAllowedError' && /microphone and camera/.test(error.message));
  assert.equal(streams[1].released, true);
  assert.equal(streams[1].tracks[0].stopped, true);
});

test('denied permissions explain device settings; missing hardware offers voice-only recovery', () => {
  const { nativeCallError } = moduleWithNativeMock('native-team-call-media', {});
  const denied = new Error('Permission denied'); denied.name = 'NotAllowedError';
  assert.deepEqual(nativeCallError(denied, 'video'), { message: 'Allow TLink to use your microphone and camera in device settings, then retry.', settings: true });
  const missing = new Error(); missing.name = 'NotFoundError';
  assert.match(nativeCallError(missing, 'video').message, /voice only/);
  const server = new Error('This call already has six people.');
  assert.equal(nativeCallError(server, 'video').message, server.message);
});

test('native media permission wait is bounded and releases a stream arriving after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  const stream = new Stream([track()]);
  const { acquireNativeCallMedia } = moduleWithNativeMock('native-team-call-media', { mediaDevices: { getUserMedia: () => new Promise(done => { resolve = done; }) } });
  const pending = acquireNativeCallMedia('audio', () => true);
  const failure = assert.rejects(pending, error => error.name === 'NativeCallMediaPermissionTimeout');
  t.mock.timers.tick(30_000); await failure;
  resolve(stream); await Promise.resolve();
  assert.equal(stream.released, true); assert.equal(stream.tracks[0].stopped, true);
});

test('native media cancellation resolves immediately and cleans a later permission grant', async () => {
  let resolve;
  const stream = new Stream([track()]), controller = new AbortController();
  const { acquireNativeCallMedia } = moduleWithNativeMock('native-team-call-media', { mediaDevices: { getUserMedia: () => new Promise(done => { resolve = done; }) } });
  const pending = acquireNativeCallMedia('audio', () => true, controller.signal);
  controller.abort(); assert.equal(await pending, null);
  resolve(stream); await Promise.resolve();
  assert.equal(stream.released, true);
});

test('native peer connection timeout ends a call that would otherwise remain connecting forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); await h.client.sync([person('a-member')]);
  t.mock.timers.tick(29_999); assert.equal(h.failures.length, 0);
  t.mock.timers.tick(1); assert.equal(h.failures.length, 1); h.client.close();
});

test('a transient native disconnect has a grace period which is cleared on recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); await h.client.sync([person('a-member')]); const peer = h.connections[0];
  peer.connectionState = 'connected'; peer.onconnectionstatechange();
  t.mock.timers.tick(30_001); assert.equal(h.failures.length, 0);
  peer.connectionState = 'disconnected'; peer.onconnectionstatechange();
  t.mock.timers.tick(14_000); peer.connectionState = 'connected'; peer.onconnectionstatechange();
  t.mock.timers.tick(2_000); assert.equal(h.failures.length, 0); h.client.close();
});
