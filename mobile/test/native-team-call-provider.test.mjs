import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/providers/native-team-call-provider.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const contract = {};
new Function('exports', ts.transpileModule(fs.readFileSync(new URL('../../src/lib/trade-team-calls.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(contract);
const invitation = { id: 'call-123456', threadId: 'thread-123456', threadName: 'Install team', mode: 'video', status: 'active', hasBeenAnswered: false, participants: [], createdByMemberId: 'member-remote', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };

function harness({ native = false, platform = 'ios', initialAppState = 'active', enabled = true, principal = null } = {}) {
  const slots = [], effects = [], pendingEffects = [], pendingLayoutEffects = [], intervals = new Set(), intervalDelays = new Map(), listeners = new Set(), pushListeners = new Set(), presenceListeners = new Set();
  let cursor = 0, tree;
  const identityListeners = new Set();
  const state = { enabled, principal, capabilities: [], api: [], media: [], audioStarts: [], stops: 0, released: [], settings: 0, peerCloses: 0, peers: [], rings:0, ringStops:0, ringbacks:0, ringbackStops:0, notificationMuted:false, audioModes:[], requestLifetimes: [], keyboardDismissals: 0,
    respond: async (url, body) => body?.action === 'start' || body?.action === 'join' ? { ok: true, call: invitation, memberId: 'member-local' }
      : body?.action === 'ice' ? { ok: true, iceServers: [{ urls: 'turn:relay.test' }] }
        : url.includes('view=incoming') ? { ok: true, calls: [invitation] } : { ok: true, call: invitation },
  };
  const system = { shown: [], answers: [], ended: [], started: [], connecting: [], connected: [], listeners: new Set(), connect: async () => undefined, answer: async () => undefined };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createContext: () => ({ Provider: 'context' }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || !same(effects[i].deps, deps)) { const old = effects[i]; effects[i] = { deps, cleanup: null }; pendingEffects.push(() => { old?.cleanup?.(); effects[i].cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!effects[i] || !same(effects[i].deps, deps)) { const old = effects[i]; effects[i] = { deps, cleanup: null }; pendingLayoutEffects.push(() => { old?.cleanup?.(); effects[i].cleanup = fn(); }); } },
  };
  const stream = { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] };
  const audio = { enabled: true, kind: 'audio' }, video = { enabled: true, kind: 'video', applyConstraints: async () => undefined };
  state.stream = stream;
  state.acquire = async (mode, isCurrent) => isCurrent() ? stream : null;
  class ApiError extends Error {}
  let audioReleased = false;
  const ringtone = {pause:()=>{assert.equal(native,false,'Expo pause must not deactivate CallKit audio');assert.equal(audioReleased,false,'released audio player used during cleanup');state.ringStops++;},play:()=>{assert.equal(native,false,'native ringing is system-owned');state.rings++;},seekTo:async()=>{},loop:false,volume:1};
  const dependencies = {
    react,
    '../../../src/lib/trade-team-calls': contract,
    '@expo/vector-icons/MaterialCommunityIcons': 'MaterialCommunityIcons',
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-crypto': { randomUUID: () => 'random-session-123456' },
    'expo-audio': {useAudioPlayer:()=>{react.useEffect(()=>()=>{audioReleased=true;},[]);return ringtone;},setAudioModeAsync:async value=>{state.audioModes.push(value);}},
    'expo-notifications': {addNotificationReceivedListener:fn=>{pushListeners.add(fn);return {remove:()=>pushListeners.delete(fn)};}},
    '../../assets/sounds/tlink-call-soft.wav':1,
    'react-native': { Platform: { OS: platform }, ActivityIndicator: 'ActivityIndicator', AppState: { currentState: initialAppState, addEventListener: (_event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } },
      Keyboard: { dismiss: () => { state.keyboardDismissals++; } },
      DeviceEventEmitter:{addListener:(name,fn)=>{const listeners=name==='tlink:call-identity-invalidated'?identityListeners:presenceListeners;listeners.add(fn);return {remove:()=>listeners.delete(fn)};}},
      Linking: { openSettings: async () => { state.settings++; } }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } } },
    'react-native-incall-manager': { start: value => state.audioStarts.push(value), stop: () => state.stops++, startRingback: () => state.ringbacks++, stopRingback: () => state.ringbackStops++, setKeepScreenOn: () => undefined, setForceSpeakerphoneOn: () => undefined },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-screens': { FullWindowOverlay: 'FullWindowOverlay' },
    'react-native-webrtc': { mediaDevices: { enumerateDevices: async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }] }, RTCView: 'RTCView' },
    '@/components/field-button': { FieldButton: 'FieldButton' },
    '@/lib/api': { ApiError, createTeamCallRequest: (signal, capability) => { state.requestLifetimes.push(signal); state.capabilities.push(capability); return async (query, options) => {
      assert.equal(signal.aborted, false, 'an invalidated call identity cannot send');
      const url = `/api/trade-team-calls${query ? `?${query}` : ''}`;
      const body = options.body ? JSON.parse(options.body) : null; state.api.push({ url, body, signal: options.signal }); return state.respond(url, body);
    }; } },
    '@/lib/device':{notificationsMuted:async()=>state.notificationMuted},
    '@/lib/team-messages':{teamNotificationTarget:value=>value?.type==='team_call'?{threadId:value.threadId,callId:value.callId}:null},
    '@/lib/native-team-call-client': { NativeTeamCallConnections: class { constructor(options) { state.peers.push(options); } async sync() {} async receive() {} close() { state.peerCloses++; } } },
    '@/lib/native-team-call-media': { acquireNativeCallMedia: (...args) => { state.media.push(args[0]); return state.acquire(...args); }, releaseNativeCallMedia: media => { if (media) state.released.push(media); }, nativeCallError: error => ({ message: error.message, settings: error.name === 'NotAllowedError' }) },
    '@/lib/native-system-calls': {
      nativeSystemCallsAvailable: native, currentSystemCall: event => Date.parse(event.expiresAt) > Date.now(),
      showSystemCall: async call => system.shown.push(call), answerSystemCall: async id => { system.answers.push(id); await system.answer(id); },
      startSystemCall: async call => system.started.push(call), endSystemCall: async id => system.ended.push(id),
      markSystemCallConnecting: async id => system.connecting.push(id),
      connectSystemCall: async id => { system.connected.push(id); await system.connect(id); }, setSystemCallSpeaker: async () => undefined,
      subscribeSystemCalls: listener => { system.listeners.add(listener); return () => system.listeners.delete(listener); },
    },
    '@/lib/theme': { colours: {}, radius: {}, spacing: {} },
    '@/providers/app-provider': { useApp: () => ({ user: { localOwnerKey: 'owner:member' }, access: { status: 'approved' }, loading: false }) },
  };
  const exports = {};
  new Function('require', 'exports', 'setInterval', 'clearInterval', `${compiled}\nexports.TestSession = NativeTeamCallSession; exports.TestTile = CallTile; exports.TestPresentation = CallPresentation; exports.styles = styles;`)(id => {
    assert.ok(id in dependencies, `unexpected dependency ${id}`); return dependencies[id];
  }, exports, (fn,delay) => { intervals.add(fn); intervalDelays.set(fn,delay); return fn; }, fn => { intervals.delete(fn); intervalDelays.delete(fn); });
  function commitLayout() { while (pendingLayoutEffects.length) pendingLayoutEffects.shift()(); }
  function commitPassive() { while (pendingEffects.length) pendingEffects.shift()(); }
  function render({ commit = true } = {}) { cursor = 0; tree = exports.TestSession({ enabled: state.enabled, principal: state.principal, children: 'app' }); if (commit) { commitLayout(); commitPassive(); } return tree; }
  function visit(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(2).flatMap(child => visit(child))]; }
  function nodes() { return visit(tree); }
  const hasLabel = (node, label) => (node.type === 'FieldButton' && node.props.children === label) || (node.type?.name === 'CallControl' && node.props.label === label);
  function button(label) { const match = nodes().find(node => hasLabel(node, label)); assert.ok(match, `Missing button ${label}`); return match.props.onPress; }
  function hasButton(label) { return nodes().some(node => hasLabel(node, label)); }
  function context() { return tree.props.value; }
  function presentation() { const surface = nodes().find(node => node.type?.name === 'CallPresentation'); return surface ? exports.TestPresentation(surface.props) : null; }
  function underlying() { return nodes().find(node => node.type === 'View' && node.props.children === 'app'); }
  function appState(value) { for (const listener of [...listeners]) listener(value); }
  function cleanup() { for (const effect of effects) effect?.cleanup?.(); }
  render();
  return { state, render, commitLayout, commitPassive, nodes, button, hasButton, context, appState, cleanup, intervals,intervalDelays,ringtone, system, exports, presentation, underlying,
    systemEvent: async event => { for (const listener of [...system.listeners]) await listener(event); },
    receivePush:()=>{for(const listener of pushListeners)listener({request:{content:{data:{type:'team_call',threadId:invitation.threadId,callId:invitation.id}}}});},
    presence:status=>{for(const listener of presenceListeners)listener({status});},
    invalidate:()=>{for(const listener of identityListeners)listener();},
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

test('unanswered foreground ringtone and invitation expire after 45 seconds', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h = harness();
  await h.context().openInvitation({threadId:invitation.threadId,callId:invitation.id});h.render();await flush();
  const stopped = h.state.ringStops;
  t.mock.timers.tick(45_000);await flush();h.render();
  assert.ok(h.state.ringStops>stopped);assert.equal(h.hasButton('Answer'),false);assert.deepEqual(h.state.media,[]);assert.ok(h.system.ended.includes(invitation.id));h.cleanup();
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

test('relay readiness immediately reads signalling, negotiates quickly, and restores normal polling after connection', async () => {
  const h=harness({native:true});await flush();
  assert.deepEqual([...h.intervalDelays.values()],[5000]);
  const normal=h.state.respond;let relayReady;
  h.state.respond=(url,body)=>body?.action==='ice'?new Promise(resolve=>{relayReady=()=>resolve({ok:true,iceServers:[{urls:'turn:relay.test'}]});}):normal(url,body);
  const pending=h.context().start(invitation.threadId,'audio');await flush();h.render();await flush();
  assert.deepEqual([...h.intervalDelays.values()],[300]);
  const statusReads=()=>h.state.api.filter(request=>request.url.includes('callId=')&&!request.body).length;
  assert.equal(statusReads(),0,'No signalling starts before the authenticated relay is ready');
  relayReady();await pending;await flush();
  assert.equal(statusReads(),1,'Do not wait for the next polling interval after relay setup');
  h.state.peers[0].changed([{state:'connected',memberId:'member-remote'}]);h.render();await flush();
  assert.deepEqual([...h.intervalDelays.values()],[1500]);
  h.state.peers[0].changed([{state:'connected',memberId:'member-remote'},{state:'connecting',memberId:'member-next'}]);h.render();await flush();
  assert.deepEqual([...h.intervalDelays.values()],[300],'A later group participant still gets prompt signalling');
  h.button('End call')();h.render();await flush();assert.deepEqual([...h.intervalDelays.values()],[5000]);
  h.cleanup();assert.equal(h.intervals.size,0);assert.equal(h.intervalDelays.size,0);
});

test('switching polling cadence preserves the in-flight guard and never duplicates signal processing', async () => {
  const h=harness({native:true});await flush();await h.context().start(invitation.threadId,'audio');await flush();h.render();await flush();
  const normal=h.state.respond;let respond,reads=0;
  h.state.respond=(url,body)=>url.includes('callId=')&&!body?new Promise(resolve=>{reads++;respond=resolve;}):normal(url,body);
  for(const tick of h.intervals)tick();await flush();assert.equal(reads,1);
  h.state.peers[0].changed([{state:'connected',memberId:'member-remote'}]);h.render();await flush();
  for(const tick of h.intervals)tick();await flush();assert.equal(reads,1,'The cadence change must not replace a pending processor');
  respond({ok:true,call:{...invitation,hasBeenAnswered:true,participants:[{memberId:'member-remote'}]},signals:[]});await flush();h.cleanup();
  assert.equal(h.intervals.size,0);
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

test('system End during permission acquisition leaves the accepted session and never opens late media', async () => {
  const h = harness({ native: true }); let resolve;
  h.state.acquire = (_mode, current) => new Promise(done => { resolve = () => done(current() ? h.state.stream : null); });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); await h.systemEvent({ type: 'end', callId: invitation.id }); resolve(); await pending;
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 1);
  assert.deepEqual(h.state.peers, []); h.cleanup();
});

test('an invitation timer cannot end an explicit Answer while its microphone request is pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) + 44_000 });
  const h = harness({ native: true }); await flush(); h.render(); await flush();
  let finish;
  h.state.acquire = (_mode, current) => new Promise(resolve => { finish = () => resolve(current() ? h.state.stream : null); });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); t.mock.timers.tick(1_000);
  assert.deepEqual(h.system.ended, []);
  finish(); await pending;
  assert.deepEqual(h.system.answers, [invitation.id]);
  h.cleanup();
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

test('a system Answer while iOS is inactive requests voice, never a locked camera', async () => {
  const h = harness({ native: true, initialAppState: 'inactive' });
  await h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  assert.deepEqual(h.state.media, ['audio']);
  assert.deepEqual(h.state.audioModes, []);
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
  h.cleanup();
});

test('backgrounding during an authenticated native Answer preserves preparation and keeps late camera tracks disabled', async () => {
  const h = harness({ native: true }); let finish;
  h.state.acquire = (_mode, current) => new Promise(resolve => { finish = () => resolve(current() ? h.state.stream : null); });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); h.appState('inactive'); h.appState('background'); finish(); await pending; h.render();
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
  assert.equal(h.state.released.length, 0);
  assert.equal(h.state.stream.getAudioTracks()[0].enabled, true);
  assert.equal(h.state.stream.getVideoTracks()[0].enabled, false);
  assert.equal(h.hasButton('Camera on'), false, 'hidden calls must not mount an invisible control surface');
  assert.equal(h.presentation(), null);
  h.appState('active'); await flush(); h.render(); h.button('Camera on')();
  assert.equal(h.state.stream.getVideoTracks()[0].enabled, true);
  h.cleanup();
});

test('Android native calls keep microphone capture across backgrounding and leave ringback to the service', async () => {
  const h = harness({ native: true, platform: 'android' });
  await h.context().start(invitation.threadId, 'video'); h.render(); await flush();
  h.appState('background'); h.render(); await flush();
  assert.equal(h.context().busy, true);
  assert.equal(h.state.released.length, 0);
  assert.equal(h.state.stream.getAudioTracks()[0].enabled, true);
  assert.equal(h.state.stream.getVideoTracks()[0].enabled, false);
  assert.equal(h.state.ringbacks, 0);
  h.cleanup();
});

test('outgoing unanswered calls stop at the server-created 45-second deadline, including setup time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) + 15_000 });
  const h = harness({ native: true });
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  assert.equal(h.system.started[0].expiresAt, new Date(Date.parse(invitation.createdAt) + 45_000).toISOString());
  t.mock.timers.tick(29_999); h.render(); assert.equal(h.context().busy, true);
  t.mock.timers.tick(1); await flush(); h.render();
  assert.equal(h.context().busy, false);
  assert.equal(h.state.released.length, 1);
  assert.ok(h.nodes().some(node => node.type === 'Text' && String(node.props.children).startsWith('No answer.')));
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 1);
  h.cleanup();
});

test('legacy outgoing ringback stops on connection and connected calls survive the ringing deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) });
  const h = harness();
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  assert.equal(h.state.ringbacks, 1);
  h.state.peers[0].changed([{ memberId: 'member-remote', name: 'Teammate', state: 'connected', stream: null }]);
  assert.equal(h.state.ringbackStops, 1);
  t.mock.timers.tick(45_000); await flush(); h.render();
  assert.equal(h.context().busy, true);
  assert.deepEqual(h.system.connected, [invitation.id]);
  h.cleanup();
});

test('an authenticated answer just before 45 seconds enters native connection grace without claiming RTC connected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) });
  const h = harness({ native: true }); const normal = h.state.respond;
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  t.mock.timers.tick(44_000);
  h.state.respond = (url, body) => url.includes('callId=') ? Promise.resolve({ ok: true, call: { ...invitation,
    participants: [{ memberId: 'member-remote', sessionId: 'remote-session', name: 'Teammate', joinedAt: new Date().toISOString() }] }, signals: [] }) : normal(url, body);
  await h.systemEvent({ type: 'heartbeat' });
  assert.deepEqual(h.system.connecting, [invitation.id]); assert.deepEqual(h.system.connected, []);
  t.mock.timers.tick(2_000); h.render();
  assert.equal(h.context().busy, true);
  await h.systemEvent({ type: 'heartbeat' });
  assert.equal(h.system.connecting.length, 1, 'status polling cannot keep extending native connection grace');
  h.state.peers[0].changed([{ memberId: 'member-remote', name: 'Teammate', state: 'connected', stream: null }]);
  assert.deepEqual(h.system.connected, [invitation.id]);
  h.cleanup();
});

test('a pending status response for an answer at 44.9 seconds wins over the 45-second caller timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) });
  const h = harness({ native: true }); const normal = h.state.respond;
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  t.mock.timers.tick(44_900);
  let finish;
  h.state.respond = (url, body) => url.includes('callId=') ? new Promise(resolve => { finish = () => resolve({ ok: true, call: { ...invitation,
    participants: [{ memberId: 'member-remote', sessionId: 'remote-session', name: 'Teammate', joinedAt: new Date(Date.parse(invitation.createdAt) + 44_900).toISOString() }] }, signals: [] }); }) : normal(url, body);
  const status = h.systemEvent({ type: 'heartbeat' }); await flush();
  t.mock.timers.tick(100); h.render();
  assert.equal(h.context().busy, true); assert.deepEqual(h.system.ended, []);
  t.mock.timers.tick(500); finish(); await status; h.render();
  assert.equal(h.context().busy, true);
  assert.deepEqual(h.system.connecting, [invitation.id]); assert.deepEqual(h.system.connected, []);
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 0);
  h.cleanup();
});

test('a stale predeadline no-answer response arriving after 45 seconds triggers fresh confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) });
  const h = harness({ native: true }); const normal = h.state.respond;
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  t.mock.timers.tick(44_000);
  let finish, statusReads = 0;
  h.state.respond = (url, body) => {
    if (!url.includes('callId=')) return normal(url, body);
    statusReads++;
    if (statusReads === 1) return new Promise(resolve => { finish = () => resolve({ ok: true, call: invitation, signals: [] }); });
    return Promise.resolve({ ok: true, call: { ...invitation, hasBeenAnswered: true,
      participants: [{ memberId: 'member-remote', sessionId: 'remote-session', name: 'Teammate', joinedAt: new Date(Date.parse(invitation.createdAt) + 44_900).toISOString() }] }, signals: [] });
  };
  const status = h.systemEvent({ type: 'heartbeat' }); await flush();
  t.mock.timers.tick(1_100); finish(); await status; await flush(); h.render();
  assert.equal(statusReads, 2);
  assert.equal(h.context().busy, true); assert.deepEqual(h.system.ended, []);
  assert.deepEqual(h.system.connecting, [invitation.id]); h.cleanup();
});

test('caller stops ringing when a teammate answered and left between status polls', async () => {
  const h = harness(); const normal = h.state.respond;
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  h.state.respond = (url, body) => url.includes('callId=') ? Promise.resolve({ ok: true, call: { ...invitation, hasBeenAnswered: true }, signals: [] }) : normal(url, body);
  await h.systemEvent({ type: 'heartbeat' }); h.render();
  assert.equal(h.context().busy, false); assert.equal(h.state.ringbackStops, 1);
  assert.ok(h.nodes().some(node => node.type === 'Text' && node.props.children === 'Your teammate left the call.')); h.cleanup();
});

test('an already answered group call remains manually joinable after 45 seconds without ringing again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) + 120_000 });
  for (const native of [false, true]) {
    const h = harness({ native }); const normal = h.state.respond;
    const running = { ...invitation, hasBeenAnswered: true,
      participants: [{ memberId: 'member-remote', name: 'Teammate', sessionId: 'remote-session', joinedAt: invitation.createdAt }] };
    h.state.respond = (url, body) => url.includes('view=incoming') ? Promise.resolve({ ok: true, calls: [running] })
      : body?.action === 'join' || url.includes('callId=') ? Promise.resolve({ ok: true, call: running, memberId: 'member-local' }) : normal(url, body);
    await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id }); h.render(); await flush();
    assert.equal(h.state.rings, 0); assert.deepEqual(h.system.shown, []);
    assert.ok(h.button('Join call')); assert.ok(h.button('Join with voice only'));
    t.mock.timers.tick(10_000); h.render(); assert.ok(h.button('Join call'));
    await h.button('Join with voice only')(); await flush(); h.render();
    assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
    assert.equal(h.context().busy, true); assert.equal(h.state.rings, 0);
    assert.deepEqual(h.system.connecting, [invitation.id]); h.cleanup();
  }
});

test('failed authoritative confirmation after the ring deadline releases a legacy call and stops its tone', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(invitation.createdAt) });
  const h = harness(); const normal = h.state.respond;
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  h.state.respond = (url, body) => url.includes('callId=') ? Promise.reject(new Error('Network unavailable')) : normal(url, body);
  t.mock.timers.tick(45_000); await flush(); h.render();
  assert.equal(h.state.ringbackStops, 1); assert.equal(h.context().busy, false);
  assert.equal(h.state.released.length, 1); h.cleanup();
});

test('legacy outgoing ringback stops on setup failure and never plays for the answerer', async () => {
  const h = harness(); const normal = h.state.respond;
  h.state.respond = (url, body) => body?.action === 'ice' ? Promise.reject(new Error('Relay unavailable')) : normal(url, body);
  await h.context().start(invitation.threadId, 'audio'); h.render();
  assert.equal(h.state.ringbacks, 1); assert.equal(h.state.ringbackStops, 1); assert.equal(h.context().busy, false);
  h.state.respond = normal;
  await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id }); h.render();
  await h.button('Answer with voice only')(); await flush();
  assert.equal(h.state.ringbacks, 1, 'answering must not play caller ringback');
  h.cleanup();
});

test('a stale system audio failure cannot terminate a replacement call', async () => {
  const h = harness({ native: true }); let reject;
  h.system.connect = () => new Promise((_resolve, fail) => { reject = fail; });
  await h.context().start(invitation.threadId, 'audio'); h.render();
  h.state.peers[0].changed([{ memberId: 'member-remote', name: 'Teammate', state: 'connected', stream: null }]);
  h.button('End call')(); h.render();
  await h.context().start(invitation.threadId, 'audio'); h.render();
  reject(new Error('Old CallKit transaction failed')); await flush(); h.render();
  assert.equal(h.context().busy, true);
  assert.equal(h.state.released.length, 1);
  h.cleanup();
});

test('all call requests share one bounded identity lifetime, aborted on principal teardown', async () => {
  const h = harness({ native: true }); await flush();
  await h.context().start(invitation.threadId, 'audio'); h.render(); await flush();
  h.appState('background'); await h.systemEvent({ type: 'heartbeat' });
  assert.equal(h.state.requestLifetimes.length, 1);
  assert.equal(h.state.requestLifetimes[0].aborted, false);
  h.cleanup();
  assert.equal(h.state.requestLifetimes[0].aborted, true);
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 0);
});

test('remote cameras occupy the call canvas while self video stays in a small overlay outside the remote scroll', async () => {
  const h = harness({ native: true }); await h.context().start(invitation.threadId, 'video');
  h.state.peers[0].changed(['One', 'Two'].map((name, i) => ({ memberId: `remote-${i}`, name, state: 'connected', stream: null })));
  h.render();
  const scroll = h.nodes().find(node => node.type === 'ScrollView' && node.props.style === h.exports.styles.remoteScroll);
  const remoteTiles = scroll.props.children.flat(2).filter(node => node?.type?.name === 'CallTile');
  assert.deepEqual(remoteTiles.map(node => node.props.name), ['One', 'Two']);
  assert.ok(remoteTiles.every(node => !node.props.local));
  const preview = h.nodes().find(node => node.props.style === h.exports.styles.selfPreview);
  assert.equal(preview.props.children.props.local, true);
  assert.equal(preview.props.style.position, 'absolute');
  assert.equal(preview.props.style.width, 104); assert.equal(preview.props.style.height, 144);
  const tile = h.exports.TestTile({ stream: { ...h.state.stream, toURL: () => 'local-stream' }, name: 'You', local: true });
  assert.equal(tile.props.children.find(node => node?.type === 'RTCView').props.zOrder, 1);
  assert.ok(h.button('End call')); assert.ok(h.button('Camera off'));
  h.cleanup();
});

test('iOS lock-screen Answer mounts no UI while inactive or background and restores reachable controls on return', async () => {
  for (const initialAppState of ['inactive', 'background']) {
    const h = harness({ native: true, initialAppState });
    await h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt }); h.render();
    assert.equal(h.context().busy, true); assert.equal(h.presentation(), null);
    assert.equal(h.underlying().props.pointerEvents, 'auto'); assert.equal(h.underlying().props.accessibilityElementsHidden, false);
    assert.equal(h.hasButton('End call'), false);
    h.appState('active'); h.render();
    const surface = h.presentation();
    assert.equal(surface.type, 'FullWindowOverlay', 'iOS must not use UIViewController Modal presentation');
    assert.equal(surface.props.children.type, 'View');
    assert.equal(surface.props.children.props.accessibilityViewIsModal, true);
    assert.equal(surface.props.children.props.style.position, 'absolute');
    assert.equal(h.underlying().props.pointerEvents, 'none'); assert.equal(h.underlying().props.importantForAccessibility, 'no-hide-descendants');
    assert.ok(h.button('End call')); assert.ok(h.button('Mute'));
    h.appState('inactive'); h.render(); assert.equal(h.presentation(), null);
    h.appState('background'); h.render(); assert.equal(h.presentation(), null);
    assert.equal(h.state.released.length, 0, 'UI lifecycle must not stop background audio');
    h.appState('active'); h.render(); assert.equal(h.presentation().type, 'FullWindowOverlay');
    assert.equal(h.state.media.length, 1); assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
    h.button('End call')(); h.render();
    assert.equal(h.presentation(), null); assert.equal(h.underlying().props.pointerEvents, 'auto');
    assert.equal(h.state.released.length, 1); h.cleanup();
  }
});

test('minimizing stays minimized while active, exposes Return to call and automatically expands after foreground reentry', async () => {
  const h = harness({ native: true }); await h.context().start(invitation.threadId, 'audio'); h.render();
  h.button('Minimise')(); h.render();
  assert.equal(h.presentation(), null); assert.equal(h.underlying().props.pointerEvents, 'auto');
  const returnButton = () => h.nodes().find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Return to team call');
  assert.ok(returnButton());
  h.appState('active'); h.render(); assert.equal(h.presentation(), null, 'duplicate active events must preserve explicit minimization');
  returnButton().props.onPress(); h.render(); assert.equal(h.presentation().type, 'FullWindowOverlay');
  h.button('Minimise')(); h.render(); h.appState('background'); h.render();
  assert.equal(h.presentation(), null); assert.equal(returnButton(), undefined);
  h.appState('active'); h.render(); assert.equal(h.presentation().type, 'FullWindowOverlay');
  assert.ok(h.button('End call')); assert.equal(h.state.released.length, 0); h.cleanup();
});

test('foreground call presentation dismisses an existing keyboard once so bottom controls stay reachable', async () => {
  const h = harness({ native: true, initialAppState: 'background' });
  await h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt }); h.render();
  assert.equal(h.state.keyboardDismissals, 0, 'background call work must not manipulate the app input');
  h.appState('active'); h.render(); assert.equal(h.state.keyboardDismissals, 1);
  h.render(); assert.equal(h.state.keyboardDismissals, 1, 'polling and rerenders must not repeatedly resign unrelated inputs');
  h.button('Minimise')(); h.render(); assert.equal(h.state.keyboardDismissals, 1);
  const button = h.nodes().find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Return to team call');
  button.props.onPress(); h.render(); assert.equal(h.state.keyboardDismissals, 2);
  assert.ok(h.button('End call')); h.cleanup();
});

test('pending background Answer becomes cancellable on foreground before permission setup finishes', async () => {
  const h = harness({ native: true, initialAppState: 'background' }); let finish;
  h.state.acquire = (_mode, current) => new Promise(resolve => { finish = () => resolve(current() ? h.state.stream : null); });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); h.render(); assert.equal(h.presentation(), null);
  h.appState('active'); h.render(); assert.equal(h.presentation().type, 'FullWindowOverlay');
  h.button('Cancel')(); h.render(); finish(); await pending;
  assert.equal(h.context().busy, false); assert.equal(h.presentation(), null);
  assert.equal(h.underlying().props.pointerEvents, 'auto');
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 1);
  assert.ok(h.system.ended.includes(invitation.id)); h.cleanup();
});

test('Android keeps its native modal and hardware Back minimizes the call without ending audio', async () => {
  const h = harness({ native: true, platform: 'android' }); await h.context().start(invitation.threadId, 'audio'); h.render();
  const modal = h.presentation(); assert.equal(modal.type, 'Modal'); assert.equal(modal.props.visible, true);
  modal.props.onRequestClose(); h.render(); assert.equal(h.presentation(), null);
  assert.equal(h.context().busy, true); assert.equal(h.state.released.length, 0);
  h.appState('background'); h.render(); assert.equal(h.presentation(), null);
  h.appState('active'); h.render(); assert.equal(h.presentation().type, 'Modal');
  h.button('End call')(); h.render(); assert.equal(h.presentation(), null);
  assert.equal(h.underlying().props.pointerEvents, 'auto'); h.cleanup();
});

test('Android hardware Back declines an invitation and cancels a pending opening session', async () => {
  const h = harness({ native: true, platform: 'android' }); await flush(); h.render();
  h.presentation().props.onRequestClose(); h.render(); assert.equal(h.presentation(), null);
  assert.ok(h.system.ended.includes(invitation.id));
  let finish;
  h.state.acquire = (_mode, current) => new Promise(resolve => { finish = () => resolve(current() ? h.state.stream : null); });
  const pending = h.context().start(invitation.threadId, 'audio'); h.render();
  h.presentation().props.onRequestClose(); h.render(); finish(); await pending;
  assert.equal(h.context().busy, false); assert.equal(h.presentation(), null);
  assert.equal(h.state.api.some(item => item.body?.action === 'start'), false); h.cleanup();
});

test('a stalled native Answer setup releases within 60 seconds and late completion cannot reopen the call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ native: true, initialAppState: 'inactive' }); let finish;
  h.system.answer = () => new Promise(resolve => { finish = resolve; });
  const pending = h.systemEvent({ type: 'answer', callId: invitation.id, threadId: invitation.threadId, expiresAt: invitation.expiresAt });
  await flush(); h.render(); assert.equal(h.context().busy, true); assert.equal(h.presentation(), null);
  h.appState('active'); h.render(); assert.ok(h.button('Cancel'));
  t.mock.timers.tick(60_000); await flush(); h.render();
  assert.equal(h.context().busy, false); assert.equal(h.state.released.length, 0, 'native Answer is acknowledged before requesting microphone');
  assert.equal(h.state.api.filter(item => item.body?.action === 'leave').length, 1);
  assert.ok(h.button('Close')); h.button('Close')(); h.render();
  assert.equal(h.presentation(), null); assert.equal(h.underlying().props.pointerEvents, 'auto');
  finish(); await pending; h.render();
  assert.equal(h.context().busy, false); assert.equal(h.presentation(), null);
  assert.equal(h.state.api.some(item => item.body?.action === 'ice'), false); h.cleanup();
});

test('completed setup clears its watchdog and missing media cannot leave an opening screen indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ native: true }); await h.context().start(invitation.threadId, 'audio'); h.render();
  h.state.peers[0].changed([{ memberId: 'member-remote', name: 'Teammate', state: 'connected', stream: null }]);
  t.mock.timers.tick(60_000); await flush(); h.render(); assert.equal(h.context().busy, true);
  h.button('End call')(); h.render();
  h.state.acquire = async () => null;
  await h.context().start(invitation.threadId, 'audio'); h.render();
  assert.equal(h.context().busy, false); assert.ok(h.button('Retry')); assert.ok(h.button('Close'));
  h.button('Close')(); h.render(); assert.equal(h.presentation(), null); h.cleanup();
});

const pushAnswer = () => ({ type: 'answer', callId: invitation.id, threadId: invitation.threadId,
  expiresAt: invitation.expiresAt, answerToken: 'synthetic-call-only-capability', callerName: 'James Morris' });
const restoredPrincipal = { ownerId: 'business-owner', memberId: 'member-local', localOwnerKey: 'field:business-owner:member-local' };
function callCapabilityResponses(h) {
  const normal = h.state.respond;
  h.state.respond = async (url, body) => ({ ...await normal(url, body), ownerUid: restoredPrincipal.ownerId, memberId: restoredPrincipal.memberId });
}

test('cold locked Answer connects through invitation capability before the private workspace restores', async () => {
  const h = harness({ native: true, enabled: false, initialAppState: 'background' });
  callCapabilityResponses(h);
  h.state.acquire = async (_mode, current) => {
    assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1, 'authenticated acceptance precedes capture');
    assert.deepEqual(h.system.answers, [invitation.id], 'CallKit activation is acknowledged before WebRTC capture');
    return current() ? h.state.stream : null;
  };
  await flush(); assert.deepEqual(h.state.api, [], 'locked workspace cannot cause ordinary call polling');
  await h.systemEvent(pushAnswer()); h.render(); await flush();
  assert.equal(h.context().busy, true); assert.deepEqual(h.state.media, ['audio']);
  assert.equal(h.state.capabilities.length, 1); assert.equal(h.state.capabilities[0].answerToken, pushAnswer().answerToken);
  assert.deepEqual(h.system.connected, [], 'accepted does not claim peer media connected');
  h.state.peers[0].changed([{ memberId: 'member-remote', name: 'James Morris', state: 'connected', stream: null }]);
  assert.deepEqual(h.system.connected, [invitation.id]);
  h.state.enabled = true; h.state.principal = restoredPrincipal; h.appState('active'); h.render(); await flush();
  assert.equal(h.context().busy, true); assert.equal(h.state.released.length, 0, 'unlock must preserve this recipient call');
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1);
  assert.ok(h.button('End call')); h.cleanup();
});

test('an invitation capability cannot join for a different restored principal and never opens media', async () => {
  const h = harness({ native: true, enabled: true, principal: { ...restoredPrincipal, memberId: 'another-member' }, initialAppState: 'background' });
  callCapabilityResponses(h); await h.systemEvent(pushAnswer()); h.render();
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 0);
  assert.deepEqual(h.state.media, []); assert.ok(h.system.ended.includes(invitation.id)); h.cleanup();
});

test('an uncommitted identity render cannot reject the current answer, and committing it revokes before passive effects', async () => {
  const h = harness({ native: true, principal: restoredPrincipal, initialAppState: 'background' });
  const normal = h.state.respond; let finishLookup;
  h.state.respond = (url, body) => url.includes('view=incoming')
    ? new Promise(resolve => { finishLookup = resolve; })
    : normal(url, body);
  const pending = h.systemEvent(pushAnswer()); await flush();
  h.state.principal = { ...restoredPrincipal, memberId: 'replacement-member' };
  h.render({ commit: false });
  finishLookup({ ok: true, calls: [invitation], ownerUid: restoredPrincipal.ownerId, memberId: restoredPrincipal.memberId });
  await pending;
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1, 'native callbacks still use the committed recipient');
  assert.deepEqual(h.state.media, ['audio']);
  assert.deepEqual(h.system.ended, [], 'a speculative render cannot alter the active native session');
  h.commitLayout();
  assert.equal(h.state.requestLifetimes[0].aborted, true);
  assert.equal(h.state.released.length, 1, 'a committed identity change releases media before passive subscriptions update');
  assert.ok(h.system.ended.includes(invitation.id));
  h.commitPassive(); h.render();
  assert.equal(h.context().busy, false); h.cleanup();
});

test('a replaced foreground invitation lookup cannot end the newer capability Answer', async () => {
  const h = harness({ native: true }); await flush(); let rejectIncoming;
  const normal = h.state.respond; let lookups = 0;
  h.state.respond = (url, body) => {
    if (url.includes('view=incoming') && lookups++ === 0) return new Promise((_resolve, reject) => { rejectIncoming = reject; });
    return normal(url, body).then(result => ({ ...result, ownerUid: restoredPrincipal.ownerId, memberId: restoredPrincipal.memberId }));
  };
  const incoming = h.systemEvent({ ...pushAnswer(), type: 'incoming' }); await flush();
  await h.systemEvent(pushAnswer()); h.render();
  rejectIncoming(new Error('Previous workspace request aborted')); await incoming; h.render();
  assert.equal(h.context().busy, true); assert.deepEqual(h.system.ended, []);
  assert.equal(h.state.api.filter(item => item.body?.action === 'join').length, 1); h.cleanup();
});

test('explicit sign-out cancels a pending capability lookup before it can join or capture', async () => {
  const h = harness({ native: true, enabled: false, initialAppState: 'background' }); let finish;
  h.state.respond = () => new Promise(resolve => { finish = resolve; });
  const pending = h.systemEvent(pushAnswer()); await flush(); h.invalidate();
  finish({ ok: true, calls: [invitation], ownerUid: restoredPrincipal.ownerId, memberId: restoredPrincipal.memberId });
  await pending; h.render();
  assert.deepEqual(h.state.media, []); assert.equal(h.state.api.some(item => item.body?.action === 'join'), false);
  assert.equal(h.state.requestLifetimes[0].aborted, true); h.cleanup();
});

test('identity invalidation clears visible invitations retained by the stable provider', async () => {
  const h = harness({ native: true, principal: restoredPrincipal }); await flush(); h.render();
  assert.ok(h.button('Answer'));
  h.state.enabled = false; h.state.principal = null; h.invalidate(); h.render();
  assert.equal(h.hasButton('Answer'), false); assert.equal(h.presentation(), null); h.cleanup();
});

test('a restored different business ends a call accepted before unlock', async () => {
  const h = harness({ native: true, enabled: false, initialAppState: 'background' }); callCapabilityResponses(h);
  await h.systemEvent(pushAnswer()); h.render(); assert.equal(h.context().busy, true);
  h.state.enabled = true; h.state.principal = { ...restoredPrincipal, ownerId: 'different-business' }; h.render(); h.render();
  assert.equal(h.context().busy, false); assert.equal(h.state.released.length, 1); assert.equal(h.state.requestLifetimes[0].aborted, true); h.cleanup();
});

test('native incoming presentations carry the actual caller name and outgoing carries the conversation name', async () => {
  const h = harness({ native: true }); const normal = h.state.respond;
  const named = { ...invitation, participants: [{ memberId: invitation.createdByMemberId, sessionId: 'remote-session', name: 'James Morris', joinedAt: invitation.createdAt }] };
  h.state.respond = async (url, body) => url.includes('view=incoming') ? { ok: true, calls: [named] } : normal(url, body);
  await h.context().openInvitation({ threadId: invitation.threadId, callId: invitation.id }); h.render(); await flush();
  assert.equal(h.system.shown.at(-1).callerName, 'James Morris');
  h.button('Decline')(); h.render();
  await h.context().start(invitation.threadId, 'audio'); h.render();
  assert.equal(h.system.started.at(-1).callerName, invitation.threadName); h.cleanup();
});
