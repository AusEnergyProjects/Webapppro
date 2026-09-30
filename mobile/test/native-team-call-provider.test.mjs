import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/providers/native-team-call-provider.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const invitation = { id: 'call-123456', threadId: 'thread-123456', threadName: 'Install team', mode: 'video', status: 'active', participants: [], createdByMemberId: 'member-remote', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness({ native = false } = {}) {
  const slots = [], effects = [], pendingEffects = [], intervals = new Set(), listeners = new Set(), pushListeners = new Set(), presenceListeners = new Set();
  let cursor = 0, tree;
  const state = { api: [], media: [], audioStarts: [], stops: 0, released: [], settings: 0, peerCloses: 0, rings:0, ringStops:0, notificationMuted:false, audioModes:[],
    respond: async (url, body) => body?.action === 'start' || body?.action === 'join' ? { ok: true, call: invitation, memberId: 'member-local' }
      : body?.action === 'ice' ? { ok: true, iceServers: [{ urls: 'turn:relay.test' }] }
        : url.includes('view=incoming') ? { ok: true, calls: [invitation] } : { ok: true, call: invitation },
  };
  const system = { shown: [], answers: [], ended: [], started: [], listeners: new Set() };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createContext: () => ({ Provider: 'context' }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || !same(effects[i].deps, deps)) { const old = effects[i]; effects[i] = { deps, cleanup: null }; pendingEffects.push(() => { old?.cleanup?.(); effects[i].cleanup = fn(); }); } },
  };
  const stream = { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] };
  const audio = { enabled: true, kind: 'audio' }, video = { enabled: true, kind: 'video', applyConstraints: async () => undefined };
  state.stream = stream;
  state.acquire = async (mode, isCurrent) => isCurrent() ? stream : null;
  class ApiError extends Error {}
  let audioReleased = false;
  const ringtone = {pause:()=>{assert.equal(audioReleased,false,'released audio player used during cleanup');state.ringStops++;},play:()=>state.rings++,seekTo:async()=>{},loop:false,volume:1};
  const dependencies = {
    react,
    '@expo/vector-icons/MaterialCommunityIcons': 'MaterialCommunityIcons',
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-crypto': { randomUUID: () => 'random-session-123456' },
    'expo-audio': {useAudioPlayer:()=>{react.useEffect(()=>()=>{audioReleased=true;},[]);return ringtone;},setAudioModeAsync:async value=>{state.audioModes.push(value);}},
    'expo-notifications': {addNotificationReceivedListener:fn=>{pushListeners.add(fn);return {remove:()=>pushListeners.delete(fn)};}},
    '../../assets/sounds/tlink-call-soft.wav':1,
    'react-native': { Platform: { OS: 'ios' }, ActivityIndicator: 'ActivityIndicator', AppState: { currentState: 'active', addEventListener: (_event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } },
      DeviceEventEmitter:{addListener:(_name,fn)=>{presenceListeners.add(fn);return {remove:()=>presenceListeners.delete(fn)};}},
      Linking: { openSettings: async () => { state.settings++; } }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value, absoluteFill: {} } },
    'react-native-incall-manager': { start: value => state.audioStarts.push(value), stop: () => state.stops++, setKeepScreenOn: () => undefined, setForceSpeakerphoneOn: () => undefined },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-webrtc': { mediaDevices: { enumerateDevices: async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }] }, RTCView: 'RTCView' },
    '@/components/field-button': { FieldButton: 'FieldButton' },
    '@/lib/api': { ApiError, apiRequest: async (url, options) => { const body = options.body ? JSON.parse(options.body) : null; state.api.push({ url, body, signal: options.signal }); return state.respond(url, body); } },
    '@/lib/device':{notificationsMuted:async()=>state.notificationMuted},
    '@/lib/team-messages':{teamNotificationTarget:value=>value?.type==='team_call'?{threadId:value.threadId,callId:value.callId}:null},
    '@/lib/native-team-call-client': { NativeTeamCallConnections: class { async sync() {} async receive() {} close() { state.peerCloses++; } } },
    '@/lib/native-team-call-media': { acquireNativeCallMedia: (...args) => { state.media.push(args[0]); return state.acquire(...args); }, releaseNativeCallMedia: media => { if (media) state.released.push(media); }, nativeCallError: error => ({ message: error.message, settings: error.name === 'NotAllowedError' }) },
    '@/lib/native-system-calls': {
      nativeSystemCallsAvailable: native, currentSystemCall: event => Date.parse(event.expiresAt) > Date.now(),
      showSystemCall: async call => system.shown.push(call), answerSystemCall: async id => system.answers.push(id),
      startSystemCall: async call => system.started.push(call), endSystemCall: async id => system.ended.push(id),
      connectSystemCall: async () => undefined, setSystemCallSpeaker: async () => undefined,
      subscribeSystemCalls: listener => { system.listeners.add(listener); return () => system.listeners.delete(listener); },
    },
    '@/lib/theme': { colours: {}, radius: {}, spacing: {} },
    '@/providers/app-provider': { useApp: () => ({ user: { localOwnerKey: 'owner:member' }, access: { status: 'approved' }, loading: false }) },
  };
  const exports = {};
  new Function('require', 'exports', 'setInterval', 'clearInterval', `${compiled}\nexports.TestSession = NativeTeamCallSession;`)(id => {
    assert.ok(id in dependencies, `unexpected dependency ${id}`); return dependencies[id];
  }, exports, fn => { intervals.add(fn); return fn; }, fn => intervals.delete(fn));
  function render() { cursor = 0; tree = exports.TestSession({ enabled: true, children: 'app' }); while (pendingEffects.length) pendingEffects.shift()(); return tree; }
  function visit(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(2).flatMap(child => visit(child))]; }
  function nodes() { return visit(tree); }
  const hasLabel = (node, label) => (node.type === 'FieldButton' && node.props.children === label) || (node.type?.name === 'CallControl' && node.props.label === label);
  function button(label) { const match = nodes().find(node => hasLabel(node, label)); assert.ok(match, `Missing button ${label}`); return match.props.onPress; }
  function hasButton(label) { return nodes().some(node => hasLabel(node, label)); }
  function context() { return tree.props.value; }
  function appState(value) { for (const listener of [...listeners]) listener(value); }
  function cleanup() { for (const effect of effects) effect?.cleanup?.(); }
  render();
  return { state, render, nodes, button, hasButton, context, appState, cleanup, intervals,ringtone, system,
    systemEvent: async event => { for (const listener of [...system.listeners]) await listener(event); },
    receivePush:()=>{for(const listener of pushListeners)listener({request:{content:{data:{type:'team_call',threadId:invitation.threadId,callId:invitation.id}}}});},
    presence:status=>{for(const listener of presenceListeners)listener({status});},
  };
}

test('incoming calls play the bundled soft chime, stop when dismissed and never acquire microphone',async()=>{
  const h=harness();await h.context().openInvitation({threadId:invitation.threadId,callId:invitation.id});h.render();await flush();
  assert.equal(h.state.rings,1);assert.equal(h.ringtone.loop,true);assert.equal(h.ringtone.volume,0.6);assert.equal(h.state.audioModes[0].playsInSilentMode,false);assert.deepEqual(h.state.media,[]);
  const stops=h.state.ringStops;h.button('Decline')();h.render();assert.ok(h.state.ringStops>stops);h.cleanup();
});

test('muted devices show incoming calls without audio and Busy immediately silences an invitation',async()=>{
  const h=harness();h.state.notificationMuted=true;await h.context().openInvitation({threadId:invitation.threadId,callId:invitation.id});h.render();await flush();assert.equal(h.state.rings,0);assert.ok(h.button('Answer'));
  h.presence('busy');h.render();assert.equal(h.hasButton('Answer'),false);h.cleanup();
});

test('a native push refreshes authenticated incoming state without navigating or accessing media',async()=>{
  const h=harness();await flush();h.state.respond=async()=>({ok:true,calls:[invitation]});h.receivePush();await flush();h.render();await flush();
  assert.ok(h.button('Answer'));assert.equal(h.state.rings,1);assert.deepEqual(h.state.media,[]);const stops=h.state.ringStops;h.appState('background');h.render();assert.ok(h.state.ringStops>stops);h.cleanup();
});

test('returning Online refreshes call availability after Busy dismissed a ringing invitation', async () => {
  const h = harness();
  await h.context().openInvitation({threadId:invitation.threadId,callId:invitation.id});h.render();await flush();
  h.presence('busy');h.render();
  assert.equal(h.hasButton('Answer'),false);
  h.presence('online');await flush();h.render();await flush();
  assert.ok(h.button('Answer'));assert.equal(h.state.rings,2);assert.deepEqual(h.state.media,[]);h.cleanup();
});

test('unanswered foreground ringtone stops after 45 seconds while leaving the invitation visible', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h = harness();
  await h.context().openInvitation({threadId:invitation.threadId,callId:invitation.id});h.render();await flush();
  const stopped = h.state.ringStops;
  t.mock.timers.tick(45_000);await flush();h.render();
  assert.ok(h.state.ringStops>stopped);assert.ok(h.button('Answer'));assert.deepEqual(h.state.media,[]);h.cleanup();
});

test('incoming polling and notification opening show an invitation without accessing microphone or camera', async () => {
  const h = harness();
  await flush();
  await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id });
  h.render();
  assert.deepEqual(h.state.media, []);
  assert.deepEqual(h.state.audioStarts, []);
  assert.equal(h.context().busy, false);
  assert.ok(h.button('Answer'));
  assert.ok(h.button('Answer with voice only'));
  h.cleanup();
});

test('voice-only answer requests audio and joins the existing call without starting another', async () => {
  const h = harness();
  await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id });
  h.render();
  h.button('Answer with voice only')();
  await flush(); h.render(); await flush();
  assert.deepEqual(h.state.media, ['audio']);
  assert.equal(h.state.api.filter(request => request.body?.action === 'join').length, 1);
  assert.equal(h.state.api.filter(request => request.body?.action === 'start').length, 0);
  assert.equal(h.context().busy, true);
  h.button('End call')();
  assert.equal(h.state.released.length, 1);
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.peerCloses, 1);
  h.cleanup();
});

test('start creates one native session, rejects duplicate taps, and hangup frees all media', async () => {
  const h = harness();
  await flush();
  const first = h.context().start(invitation.threadId, 'video');
  await h.context().start(invitation.threadId, 'video');
  await first; h.render(); await flush();
  assert.equal(h.state.media.length, 1);
  assert.equal(h.state.api.filter(request => request.body?.action === 'start').length, 1);
  h.button('End call')(); await flush(); h.render();
  assert.equal(h.state.released[0], h.state.stream);
  assert.equal(h.context().busy, false);
  assert.equal(h.state.api.filter(request => request.body?.action === 'leave').length, 1);
  h.cleanup();
});

test('cancelling before late permission completion cannot create a server call', async () => {
  const h = harness();
  let finish;
  h.state.acquire = (_mode, isCurrent) => new Promise(resolve => { finish = () => resolve(isCurrent() ? h.state.stream : null); });
  const pending = h.context().start(invitation.threadId, 'video');
  h.render(); h.button('Cancel')(); finish(); await pending; h.render();
  assert.equal(h.state.api.some(request => request.body?.action === 'start'), false);
  assert.equal(h.context().busy, false);
  h.cleanup();
});

test('an in-flight call that completes after cancellation is immediately left', async () => {
  const h = harness();
  const normal = h.state.respond;
  let finish;
  h.state.respond = (url, body) => body?.action === 'start' ? new Promise(resolve => { finish = () => resolve({ ok: true, call: invitation, memberId: 'member-local' }); }) : normal(url, body);
  const pending = h.context().start(invitation.threadId, 'audio');
  await flush(); h.render(); h.button('Cancel')(); finish(); await pending; await flush(); h.render();
  assert.equal(h.state.api.filter(request => request.body?.action === 'leave').length, 1);
  assert.equal(h.state.api.filter(request => request.body?.action === 'ice').length, 0);
  assert.equal(h.context().busy, false);
  assert.equal(h.state.released.length, 1);
  h.cleanup();
});

test('permission-dialog inactivity keeps a call, but actual backgrounding closes it without automatic resume', async () => {
  const h = harness();
  await h.context().start(invitation.threadId, 'video'); h.render(); await flush();
  h.appState('inactive');
  assert.equal(h.state.released.length, 0);
  h.appState('background'); h.render(); await flush();
  assert.equal(h.state.released.length, 1);
  assert.equal(h.context().busy, false);
  h.appState('active'); await flush(); h.render();
  assert.equal(h.state.media.length, 1);
  h.cleanup();
});

test('principal teardown closes media, aborts pending requests and never leaves using a replacement login', async () => {
  const h = harness();
  await h.context().start(invitation.threadId, 'video'); h.render(); await flush();
  h.cleanup();
  assert.equal(h.state.released.length, 1);
  assert.equal(h.state.peerCloses, 1);
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.api.filter(request => request.body?.action === 'leave').length, 0);
  assert.equal(h.intervals.size, 0);
});

test('expired notification invitations cannot acquire media or open a different active call', async () => {
  const h = harness();
  h.state.respond = async () => ({ ok: true, call: { ...invitation, id: 'different-call' } });
  await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id });
  h.render();
  assert.equal(h.state.media.length, 0);
  assert.ok(h.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('This call is no longer available')));
  assert.equal(h.hasButton('Answer'), false);
  h.cleanup();
});

test('denied media has Retry, voice-only and device settings actions entirely inside TLink', async () => {
  const h = harness();
  h.state.acquire = async () => { const error = new Error('Allow microphone and camera in Settings.'); error.name = 'NotAllowedError'; throw error; };
  await h.context().start(invitation.threadId, 'video'); h.render();
  assert.ok(h.button('Retry'));
  assert.ok(h.button('Use voice only'));
  h.button('Open device settings')(); await flush();
  assert.equal(h.state.settings, 1);
  assert.equal(h.state.api.some(request => request.body?.action === 'start'), false);
  h.cleanup();
});

test('native incoming calls use system UI without playing a second ringtone or acquiring media', async () => {
  const h = harness({ native: true }); await flush(); h.render(); await flush();
  assert.equal(h.state.rings, 0); assert.equal(h.system.shown.length, 1); assert.deepEqual(h.state.media, []);
  h.button('Decline')(); await flush(); assert.ok(h.system.ended.includes(invitation.id)); h.cleanup();
});

test('muted native notifications do not ring but explicit Answer still activates the system call with the full server lease', async () => {
  const h = harness({ native: true }); h.state.notificationMuted = true; await flush(); h.render(); await flush();
  assert.deepEqual(h.system.shown, []); assert.equal(h.state.rings, 0);
  await h.button('Answer')(); await flush();
  assert.deepEqual(h.system.answers, [invitation.id]); assert.equal(h.system.shown[0].expiresAt, invitation.expiresAt);
  assert.deepEqual(h.state.audioStarts, []); h.cleanup();
});

test('an answered system call keeps audio while backgrounded and disables video until explicitly reenabled', async () => {
  const h = harness({ native: true }); await h.context().start(invitation.threadId, 'video'); h.render(); await flush();
  assert.equal(h.system.started.length, 1); assert.deepEqual(h.state.audioStarts, []);
  h.appState('background'); h.render(); await flush();
  assert.equal(h.state.released.length, 0); assert.equal(h.context().busy, true); assert.equal(h.state.stream.getVideoTracks()[0].enabled, false);
  h.appState('active'); await flush(); h.render();
  assert.equal(h.state.stream.getVideoTracks()[0].enabled, false); assert.ok(h.button('Camera on')); h.cleanup();
});

test('system Answer revalidates current invitation and starts voice only when iOS remains in background', async () => {
  const h = harness({ native: true }); h.appState('background'); await flush(); h.render();
  await h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  h.render(); await flush();
  assert.deepEqual(h.state.media, ['audio']); assert.deepEqual(h.system.answers, [invitation.id]);
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1); h.cleanup();
});

test('system Answer cannot acquire media for a stale notification or unauthorized call', async () => {
  const h = harness({ native: true }); h.state.respond = async () => ({ ok: true, calls: [] });
  await h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  assert.deepEqual(h.state.media, []); assert.ok(h.system.ended.includes(invitation.id)); h.cleanup();
});

test('system End during permission acquisition cancels the pending answer before server join', async () => {
  const h = harness({ native: true }); let resolve;
  h.state.acquire = (_mode, current) => new Promise(done => { resolve = () => done(current() ? h.state.stream : null); });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); await h.systemEvent({ type: 'end', callId: invitation.id }); resolve(); await pending;
  assert.equal(h.state.api.some(item => item.body?.action === 'join'), false); h.cleanup();
});

test('system End during invitation authorization prevents a late Answer from reopening media', async () => {
  const h = harness({ native: true }); await flush(); let resolve;
  h.state.respond = () => new Promise(done => { resolve = done; });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); await h.systemEvent({ type: 'end', callId: invitation.id });
  resolve({ ok: true, calls: [invitation] }); await pending;
  assert.deepEqual(h.state.media, []); assert.equal(h.state.api.some(item => item.body?.action === 'join'), false); h.cleanup();
});

test('native heartbeat polls an active background call so the server lease does not silently expire', async () => {
  const h = harness({ native: true }); await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  h.appState('background'); await flush(); const before = h.state.api.filter(item => item.url.includes('callId=')).length;
  await h.systemEvent({ type: 'heartbeat', callId: invitation.id });
  assert.equal(h.state.api.filter(item => item.url.includes('callId=')).length, before + 1); h.cleanup();
});
