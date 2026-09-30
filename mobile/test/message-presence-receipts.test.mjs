import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies, expose = '') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(`${source}\n${expose}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, exports, dependencies.timers?.setInterval || setInterval, dependencies.timers?.clearInterval || clearInterval,
  dependencies.timers?.setTimeout || setTimeout, dependencies.timers?.clearTimeout || clearTimeout);
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
const colours = { green: '#54e3b2', amber: '#f0b34d', muted: '#9ab0b5', blue: '#6cb7ef' };
const jsx = (type, props) => ({ type, props });

function hooks() {
  const slots = [], effects = [], pending = [], intervals = new Set(), timeouts = new Set(), listeners = new Set();
  let cursor = 0, focusEffect, focusCleanup, focused = true, mounted = true, lateWrites = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { if (!mounted) lateWrites++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || !same(effects[i].deps, deps)) { const previous = effects[i]; effects[i] = { deps }; pending.push(() => { previous?.cleanup?.(); effects[i].cleanup = fn(); }); } },
  };
  const AppState = { currentState: 'active', addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
  const timers = { setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn), setTimeout: fn => { timeouts.add(fn); return fn; }, clearTimeout: fn => timeouts.delete(fn) };
  const dependencies = {
    react, timers, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState, View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', FlatList: 'FlatList', Pressable: 'Pressable', Modal: 'Modal', StyleSheet: { create: value => value } },
    'expo-router': { useFocusEffect: fn => react.useEffect(() => { focusEffect = fn; if (focused) focusCleanup = fn(); return () => { focusCleanup?.(); focusCleanup = undefined; }; }, [fn]), useLocalSearchParams: () => ({}), useRootNavigationState: () => ({ key: 'navigation' }), router: { setParams() {}, push() {} } },
    '@expo/vector-icons/MaterialCommunityIcons': 'Icon', '@/lib/theme': { colours, radius: {} },
  };
  return {
    dependencies, intervals, listeners, AppState,
    render: fn => { cursor = 0; const tree = fn(); for (const effect of pending.splice(0)) effect(); return tree; },
    timeout: () => { for (const fn of [...timeouts]) { timeouts.delete(fn); fn(); } },
    poll: () => { for (const fn of [...intervals]) fn(); },
    appState: value => { AppState.currentState = value; for (const listener of listeners) listener(value); },
    focus: value => { if (focused === value) return; focused = value; if (focused) focusCleanup = focusEffect?.(); else { focusCleanup?.(); focusCleanup = undefined; } },
    unmount: () => { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    get lateWrites() { return lateWrites; },
  };
}

function uiHarness() {
  const h = hooks();
  return { h, ui: load('../src/components/messages-ui.tsx', h.dependencies) };
}

test('individual teammate dots use manual availability with accessible labels and never invent a customer or group status', () => {
  const { ui } = uiHarness();
  for (const [status, label, colour] of [['online', 'Online', colours.green], ['busy', 'Busy', colours.amber], ['offline', 'Offline', colours.muted]]) {
    const dot = ui.MessagePresence({ name: 'Katja', status });
    assert.equal(dot.props.accessibilityLabel, `Katja: ${label}`); assert.equal(dot.props.style.at(-1).backgroundColor, colour);
    assert.equal(nodes(ui.MessageAvatar({ name: 'Katja', presence: status })).filter(node => node.type === ui.MessagePresence).length, 1);
  }
  for (const status of [null, undefined]) assert.equal(ui.MessagePresence({ name: 'Former member', status }), null);
  for (const options of [{ customer: true }, { group: true }]) assert.equal(nodes(ui.MessageAvatar({ name: 'Group', presence: 'online', ...options })).filter(node => node.type === ui.MessagePresence).length, 0);
  const roster = ui.MessageParticipants({ members: [{ id: 'one', name: 'Katja', presence: 'busy' }, { id: 'two', name: 'James', presence: 'offline' }, { id: 'old', name: 'Former', presence: null, active: false }] });
  assert.deepEqual(nodes(roster).filter(node => node.type === ui.MessagePresence).map(node => node.props.status), ['busy', 'offline', null]);
  assert.match(text(roster), /Former member/);
});

test('sent, delivered and read ticks follow authoritative receipts, including unknown historical read times', () => {
  for (const status of ['sent', 'delivered', 'read']) {
    const { h, ui } = uiHarness();
    const receipt = { status, recipientCount: 1, deliveredCount: status === 'sent' ? 0 : 1, readCount: status === 'read' ? 1 : 0, readAt: status === 'read' ? '2026-09-30T08:45:00Z' : null, recipients: [] };
    const tree = h.render(() => ui.MessageReceipt({ receipt })), icon = nodes(tree).find(node => node.type === 'Icon');
    assert.equal(icon.props.name, status === 'sent' ? 'check' : 'check-all');
    assert.equal(icon.props.color, status === 'read' ? colours.blue : colours.muted);
    if (status === 'read') { assert.match(text(tree), /Read.*30 Sept?/); assert.doesNotMatch(text(tree), /time unavailable/); }
    const historical = h.render(() => ui.MessageReceipt({ receipt: { ...receipt, status: 'read', readAt: null } }));
    assert.match(text(historical), /Read · time unavailable/); assert.doesNotMatch(text(historical), /unread/i);
  }
});

test('partial group receipts keep a single aggregate sent tick and expose each recipient read time', () => {
  const { h, ui } = uiHarness();
  const receipt = { status: 'sent', recipientCount: 3, deliveredCount: 2, readCount: 1, readAt: null, recipients: [
    { memberId: 'one', name: 'Katja', status: 'read', readAt: '2026-09-30T08:45:00Z' },
    { memberId: 'two', name: 'James', status: 'delivered', deliveredAt: '2026-09-30T08:40:00Z' },
    { memberId: 'three', name: 'Alex', status: 'sent' },
  ] };
  let tree = h.render(() => ui.MessageReceipt({ receipt }));
  assert.equal(nodes(tree).find(node => node.type === 'Icon').props.name, 'check'); assert.match(text(tree), /1\/3 read · 2\/3 delivered/);
  nodes(tree).find(node => node.type === 'Pressable').props.onPress(); tree = h.render(() => ui.MessageReceipt({ receipt }));
  assert.match(text(tree), /Katja.*Read.*30 Sept?/); assert.match(text(tree), /James.*Delivered/); assert.match(text(tree), /Alex.*Sent/);
});

test('SMS ticks require carrier sent or delivered status and never expose a read tick', () => {
  const { ui } = uiHarness();
  for (const status of ['accepted', 'queued', 'sending', 'reserved', 'failed', 'undelivered', 'unknown', 'canceled', 'received', 'read']) assert.equal(ui.SmsMessageReceipt({ status }), null, status);
  for (const status of ['sent', 'delivered']) {
    const tree = ui.SmsMessageReceipt({ status }), icon = nodes(tree).find(node => node.type === 'Icon');
    assert.equal(icon.props.name, status === 'sent' ? 'check' : 'check-all'); assert.equal(icon.props.color, colours.muted); assert.doesNotMatch(text(tree), /Read/);
  }
});

const thread = { id: 'thread-1234', kind: 'dm', subject: '', members: [{ id: 'self', name: 'Me', presence: 'online' }, { id: 'peer', name: 'Katja', presence: 'online' }] };
const incoming = { id: 'message-2', sequence: 2, senderName: 'Katja', senderMemberId: 'peer', mine: false, body: 'Hello', requestId: 'request-2', createdAt: '2026-09-30T08:00:00Z', attachments: [] };
class ApiError extends Error { constructor(status) { super('Access denied'); this.status = status; } }

function conversationHarness({ group = false } = {}) {
  const h = hooks(), requests = [], readEvents = [];
  const state = { callsPresented: false, metadata: { ...thread, kind: group ? 'group' : 'dm' }, history: async () => ({ messages: [incoming], hasOlder: false }), acknowledge: async () => ({ ok: true }) };
  const clients = load('../src/lib/messages-client.ts', {
    'expo-crypto': { randomUUID: () => 'request-id' },
    '@/lib/api': { ApiError, apiRequest: async (url, options = {}) => {
      if (options.method === 'POST') { const body = JSON.parse(options.body); requests.push(body); return state.acknowledge(body); }
      if (url.includes('view=thread')) return { ok: true, thread: state.metadata };
      return { ok: true, ...await state.history() };
    } },
  });
  const ui = Object.fromEntries(['MessageAvatar', 'MessageIconButton', 'MessageKeyboardView', 'MessageLoading', 'MessageNotice', 'MessageParticipants', 'MessageReceipt', 'SmsMessageReceipt'].map(name => [name, name]));
  const component = load('../src/components/messages-conversation.tsx', { ...h.dependencies,
    '@/lib/api': { ApiError }, '@/lib/messages-client': clients,
    '@/providers/native-team-call-provider': { useNativeTeamCalls: () => ({ busy: false, presented: state.callsPresented, start() {} }) },
    '@/components/field-button': { FieldButton: 'Button' }, '@/components/messages-media': { MessageMedia: 'Media', MessageMediaComposer: 'MediaComposer' },
    '@/components/messages-ui': { ...ui, customerColour: '#blue', messageStyles: {}, messagePresenceLabel: status => status ? status[0].toUpperCase() + status.slice(1) : '' },
  });
  const props = { selection: { kind: 'team', thread: state.metadata }, memberId: 'self', draft: clients.emptyMessageDraft(), onDraft() {}, onBack() {}, onRead: () => readEvents.push(true), online: true };
  let tree;
  const render = () => { tree = h.render(() => component.MessagesConversation(props)); return tree; };
  return { h, state, requests, readEvents, render,
    async settle() { for (let i = 0; i < 4; i++) { render(); await tick(); } return tree; },
    visible: () => { const list = nodes(tree).find(node => node.type === 'FlatList'); list.props.onViewableItemsChanged({ viewableItems: list.props.data.map(item => ({ item, isViewable: true })) }); },
  };
}

test('conversation fetch acknowledges delivery, while read requires an active focused visible list', async t => {
  const f = conversationHarness(); t.after(f.h.unmount); let tree = await f.settle();
  assert.deepEqual(f.requests, [{ action: 'delivered', threadId: thread.id, throughSequence: 2 }]);
  assert.equal(f.readEvents.length, 0); assert.equal(nodes(tree).find(node => node.type === 'FlatList').props.viewabilityConfig.minimumViewTime, 400);
  f.h.focus(false); f.visible(); await tick(); assert.equal(f.requests.length, 1);
  f.h.appState('background'); f.h.focus(true); f.visible(); await tick(); assert.equal(f.requests.length, 1);
  f.h.appState('active'); tree = await f.settle();
  assert.equal(f.requests.filter(item => item.action === 'read').length, 1); assert.equal(f.readEvents.length, 1);
  f.visible(); await tick(); assert.equal(f.requests.filter(item => item.action === 'read').length, 1);
  assert.equal(nodes(tree).find(node => node.type === 'MessageAvatar').props.presence, 'online');
});

test('late history after blur cannot mark a message read and open-conversation presence refreshes from server metadata', async t => {
  const f = conversationHarness(); t.after(f.h.unmount); let finish;
  f.state.history = () => new Promise(resolve => { finish = resolve; }); f.render(); await tick();
  f.h.focus(false); finish({ messages: [incoming], hasOlder: false }); await f.settle(); f.visible(); await tick();
  assert.equal(f.requests.some(item => item.action === 'read'), false);
  f.state.history = async () => ({ messages: [incoming], hasOlder: false });
  f.state.metadata = { ...thread, members: thread.members.map(member => member.id === 'peer' ? { ...member, presence: 'busy' } : member) };
  f.h.focus(true); const tree = await f.settle();
  assert.equal(nodes(tree).find(node => node.type === 'MessageAvatar').props.presence, 'busy'); assert.match(text(tree), /Team chat · Busy/);
});

test('a full-screen call blocks read receipts, including an older in-flight history callback, until the conversation is visible again', async t => {
  const f = conversationHarness(); t.after(f.h.unmount);
  await f.settle(); f.h.focus(false); f.visible(); f.h.focus(true);
  await tick();
  // Begin a later refresh while the conversation is visible, then cover it before it resolves.
  let finish;
  f.state.history = () => new Promise(resolve => { finish = resolve; });
  f.h.poll(); await tick();
  f.state.callsPresented = true; f.render();
  const before = f.requests.filter(item => item.action === 'read').length;
  f.visible();
  finish({ messages: [incoming, { ...incoming, id: 'message-3', sequence: 3 }], hasOlder: false });
  await f.settle(); f.visible(); await tick();
  assert.equal(f.requests.filter(item => item.action === 'read').length, before);
  assert.equal(f.requests.filter(item => item.action === 'delivered').at(-1).throughSequence, 3);
  f.state.callsPresented = false; f.render(); f.visible(); await tick();
  assert.equal(f.requests.filter(item => item.action === 'read').at(-1).throughSequence, 3);
});

test('expanded photo visibility blocks conversation reads and close or unmount restores eligibility', async t => {
  const f = conversationHarness(); t.after(f.h.unmount);
  const attachment = { id: 'photo-1', kind: 'image', contentType: 'image/jpeg' };
  f.state.history = async () => ({ messages: [{ ...incoming, attachments: [attachment] }], hasOlder: false });
  const tree = await f.settle(), list = nodes(tree).find(node => node.type === 'FlatList');
  const media = nodes(list.props.renderItem({ item: list.props.data[0] })).find(node => node.type === 'Media');
  const h = hooks(); t.after(h.unmount);
  class CacheFile { constructor() { this.uri = 'file:///private/test-photo.jpg'; this.exists = true; } write() {} delete() { this.exists = false; } }
  const { MessageMedia } = load('../src/components/messages-media.tsx', { ...h.dependencies,
    'expo-audio': {}, 'expo-crypto': { randomUUID: () => 'photo-cache' },
    'expo-file-system': { File: CacheFile, Paths: { cache: 'cache' } }, 'expo-image-manipulator': {}, 'expo-image-picker': {},
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/api': { apiDownloadMessageMedia: async () => ({ contentType: 'image/jpeg', bytes: new Uint8Array([1]) }) },
    '@/lib/messages-client': {}, '@/components/field-button': { FieldButton: 'Button' },
    '@/components/messages-ui': { MessageIconButton: 'IconButton', MessageLoading: 'Loading', MessageNotice: 'Notice', messageStyles: {} },
  });
  const render = () => h.render(() => MessageMedia(media.props));
  render(); await tick(); let photo = render();
  nodes(photo).find(node => node.type === 'Pressable').props.onPress(); photo = render();
  assert.equal(nodes(photo).find(node => node.type === 'Modal').props.visible, true);
  f.visible(); f.h.poll(); await f.settle();
  assert.equal(f.requests.some(item => item.action === 'read'), false);
  nodes(photo).find(node => node.type === 'Modal').props.onRequestClose(); photo = render();
  assert.equal(nodes(photo).find(node => node.type === 'Modal').props.visible, false);
  f.visible(); await tick(); assert.equal(f.requests.filter(item => item.action === 'read').at(-1).throughSequence, 2);
  nodes(photo).find(node => node.type === 'Pressable').props.onPress(); render();
  f.state.history = async () => ({ messages: [{ ...incoming, id: 'message-3', sequence: 3, attachments: [attachment] }], hasOlder: false });
  f.h.poll(); await f.settle(); f.visible(); await tick();
  assert.equal(f.requests.filter(item => item.action === 'read').at(-1).throughSequence, 2);
  h.unmount(); f.visible(); await tick();
  assert.equal(f.requests.filter(item => item.action === 'read').at(-1).throughSequence, 3);
});

test('failed read acknowledgement retries while visible without falsely advancing the confirmed cursor', async t => {
  const f = conversationHarness(); t.after(f.h.unmount); let fail = true;
  f.state.acknowledge = async body => { if (body.action === 'read' && fail) throw new Error('Offline'); return { ok: true }; };
  await f.settle(); f.visible(); await tick(); assert.equal(f.readEvents.length, 0);
  fail = false; f.h.poll(); await f.settle(); assert.equal(f.readEvents.length, 1);
  assert.equal(f.requests.filter(item => item.action === 'read').length, 2);
});

test('group conversation shows individual members and sender receipts, never a group availability dot', async t => {
  const f = conversationHarness({ group: true }); t.after(f.h.unmount);
  const receipt = { status: 'read', readAt: '2026-09-30T08:45:00Z', recipientCount: 1, deliveredCount: 1, readCount: 1, recipients: [] };
  f.state.history = async () => ({ messages: [incoming, { ...incoming, id: 'mine', sequence: 3, mine: true, receipt }], hasOlder: false });
  const tree = await f.settle(); assert.equal(nodes(tree).find(node => node.type === 'MessageAvatar').props.presence, undefined);
  assert.deepEqual(nodes(tree).find(node => node.type === 'MessageParticipants').props.members, f.state.metadata.members);
  const list = nodes(tree).find(node => node.type === 'FlatList');
  assert.equal(nodes(list.props.renderItem({ item: list.props.data.find(item => item.mine) })).find(node => node.type === 'MessageReceipt').props.receipt, receipt);
  assert.equal(nodes(list.props.renderItem({ item: list.props.data.find(item => !item.mine) })).some(node => node.type === 'MessageReceipt'), false);
});

function navigationHarness() {
  const h = hooks(), pushes = new Set(), responses = new Set(), requests = [];
  const state = {
    app: { user: { localOwnerKey: 'owner:member' }, access: { status: 'approved' }, sync: { online: true } },
    modes: ['trade_team'], unread: async () => ({ threads: [{ id: 'thread-1234', sequence: 2 }] }),
    acknowledge: async () => ({ ok: true }),
  };
  const clients = load('../src/lib/messages-client.ts', { 'expo-crypto': {}, '@/lib/api': { ApiError, apiRequest: async (url, options = {}) => {
    requests.push({ url, signal: options.signal, body: options.body && JSON.parse(options.body) });
    return options.method === 'POST' ? state.acknowledge(JSON.parse(options.body)) : { ok: true, ...await state.unread() };
  } } });
  const component = load('../src/components/notification-navigation.tsx', {
    ...h.dependencies, '@/lib/messages-client': clients,
    '@/lib/notifications': { notificationResponseTarget: () => null }, '@/lib/team-messages': load('../src/lib/team-messages.ts', {}),
    '@/lib/sync': { resolveFieldAccessModes: async () => state.modes }, '@/providers/app-provider': { useApp: () => state.app },
    'expo-notifications': {
      getLastNotificationResponse: () => null,
      addNotificationResponseReceivedListener: fn => { responses.add(fn); return { remove: () => responses.delete(fn) }; },
      addNotificationReceivedListener: fn => { pushes.add(fn); return { remove: () => pushes.delete(fn) }; },
    },
  });
  const render = () => h.render(() => component.NotificationNavigation());
  return { h, state, requests, render, pushes,
    push: data => { for (const fn of pushes) fn({ request: { content: { data } } }); },
    async settle() { for (let i = 0; i < 4; i++) { render(); await tick(); } },
  };
}

test('the global native watcher acknowledges delivery while another screen is open and never marks read', async t => {
  const f = navigationHarness(); t.after(f.h.unmount); await f.settle();
  assert.deepEqual(f.requests.filter(item => item.body).map(item => item.body), [{ action: 'delivered', threadId: 'thread-1234', throughSequence: 2 }]);
  f.h.poll(); await f.settle(); assert.equal(f.requests.filter(item => item.body).length, 1);
  const count = f.requests.length; f.push({ type: 'team_message', threadId: '../invalid' }); await tick(); assert.equal(f.requests.length, count);
  f.state.unread = async () => ({ threads: [{ id: 'thread-1234', sequence: 3 }] });
  f.push({ type: 'team_message', threadId: 'thread-1234' }); await f.settle();
  assert.equal(f.requests.at(-1).body.throughSequence, 3);
  assert.ok(f.requests.filter(item => item.body).every(item => item.body.action === 'delivered'));
});

test('global receipts are gated by authentication, trade access, network and foreground state', async () => {
  for (const configure of [f => { f.state.app.user = null; }, f => { f.state.app.access.status = 'pending'; }, f => { f.state.app.sync.online = false; }, f => { f.state.modes = ['creditex_manual']; }, f => f.h.appState('background')]) {
    const f = navigationHarness(); configure(f); await f.settle(); assert.equal(f.requests.length, 0); f.h.unmount();
  }
});

test('a whole-refresh deadline releases a stalled unread request and ignores its late response', async t => {
  const f = navigationHarness(); t.after(f.h.unmount); let finish;
  f.state.unread = () => new Promise(resolve => { finish = resolve; });
  f.render(); await tick(); const stalled = f.requests[0];
  f.h.timeout(); await tick(); assert.equal(stalled.signal.aborted, true);
  f.state.unread = async () => ({ threads: [{ id: 'new-thread', sequence: 4 }] }); f.h.poll(); await f.settle();
  assert.deepEqual(f.requests.filter(item => item.body).map(item => item.body.threadId), ['new-thread']);
  finish({ threads: [{ id: 'stale-thread', sequence: 99 }] }); await tick();
  assert.deepEqual(f.requests.filter(item => item.body).map(item => item.body.threadId), ['new-thread']);
});

test('changing identity aborts old delivery work and no old unread response can acknowledge under the new member', async t => {
  const f = navigationHarness(); t.after(f.h.unmount); let finish;
  f.state.unread = () => new Promise(resolve => { finish = resolve; }); f.render(); await tick();
  const previous = f.requests[0]; f.state.app.user = { localOwnerKey: 'other:member' };
  f.state.unread = async () => ({ threads: [{ id: 'other-thread', sequence: 2 }] }); await f.settle();
  assert.equal(previous.signal.aborted, true); finish({ threads: [{ id: 'private-thread', sequence: 5 }] }); await tick();
  assert.deepEqual(f.requests.filter(item => item.body).map(item => item.body.threadId), ['other-thread']);
});

test('delivery failure does not overlap a new poll while another acknowledgement remains in flight', async t => {
  const f = navigationHarness(); t.after(f.h.unmount); let finish;
  f.state.unread = async () => ({ threads: [{ id: 'fail-thread', sequence: 2 }, { id: 'slow-thread', sequence: 3 }] });
  f.state.acknowledge = body => body.threadId === 'fail-thread' ? Promise.reject(new Error('Offline')) : new Promise(resolve => { finish = resolve; });
  f.render(); await tick(); assert.equal(f.requests.length, 3);
  f.h.poll(); await tick(); assert.equal(f.requests.length, 3);
  finish({ ok: true }); await tick(); f.state.acknowledge = async () => ({ ok: true }); f.h.poll(); await f.settle();
  assert.equal(f.requests.filter(item => item.body?.threadId === 'slow-thread').length, 1);
  assert.equal(f.requests.filter(item => item.body?.threadId === 'fail-thread').length, 2);
});

function inboxHarness() {
  const h = hooks(), requests = [];
  const state = { contacts: { members: [{ id: 'peer', name: 'Katja', presence: 'online' }], customerThreads: [{ customerId: 'customer', workOrderId: 'job', name: 'Customer' }] },
    overview: { memberId: 'self', canUseSms: true, threads: [{ ...thread, latestSequence: 2 }], members: thread.members },
  };
  const clients = load('../src/lib/messages-client.ts', { 'expo-crypto': { randomUUID: () => 'request-1234' }, '@/lib/api': { ApiError, apiRequest: async (url, options = {}) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) });
    return { ok: true, ...(url.includes('view=contacts') ? state.contacts : state.overview) };
  } } });
  const ui = Object.fromEntries(['MessageAvatar', 'MessageIconButton', 'MessageKeyboardView', 'MessageLoading', 'MessageNotice'].map(name => [name, name]));
  const component = load('../src/app/(tabs)/messages.tsx', { ...h.dependencies,
    'expo-crypto': { randomUUID: () => 'request-1234' }, '@/lib/api': { ApiError }, '@/lib/messages-client': clients,
    '@/components/device-notification-settings': { DeviceNotificationSettings: 'Settings' }, '@/components/field-button': { FieldButton: 'Button' },
    '@/components/messages-conversation': { MessagesConversation: 'Conversation' }, '@/components/screen': { Screen: 'Screen' },
    '@/components/messages-ui': { ...ui, customerColour: '#blue', messageStyles: {}, messagePresenceLabel: status => status ? status[0].toUpperCase() + status.slice(1) : '' },
    '@/lib/team-messages': { teamNotificationTarget: () => null }, '@/providers/app-provider': { useApp: () => ({}) },
    '@/providers/native-team-call-provider': { useNativeTeamCalls: () => ({ openInvitation() {} }) },
  }, 'exports.TestNewChat = NewChat; exports.TestInbox = NativeMessages;');
  let tree;
  return { h, state, requests,
    async settle(kind) { for (let i = 0; i < 4; i++) { tree = h.render(() => kind === 'contacts' ? component.TestNewChat({ overview: state.overview, online: true, onSelect() {}, onClose() {} }) : component.TestInbox({ online: true })); h.timeout(); await tick(); } return tree; },
  };
}

test('New chat shows current teammate dots, refreshes availability, and gives customers no presence', async t => {
  const f = inboxHarness(); t.after(f.h.unmount); let tree = await f.settle('contacts');
  let list = nodes(tree).find(node => node.type === 'FlatList');
  const teammate = nodes(list.props.renderItem({ item: list.props.data[0] })).find(node => node.type === 'MessageAvatar'); assert.equal(teammate.props.presence, 'online');
  const customer = nodes(list.props.renderItem({ item: list.props.data[1] })).find(node => node.type === 'MessageAvatar'); assert.equal(customer.props.customer, true); assert.equal(customer.props.presence, undefined);
  f.state.contacts = { ...f.state.contacts, members: [{ id: 'peer', name: 'Katja', presence: 'busy' }] }; f.h.poll(); tree = await f.settle('contacts'); list = nodes(tree).find(node => node.type === 'FlatList');
  const row = list.props.renderItem({ item: list.props.data[0] }); assert.equal(nodes(row).find(node => node.type === 'MessageAvatar').props.presence, 'busy'); assert.match(text(row), /Team · Busy/);
});

test('DM inbox dots use the other member and acknowledge received summaries without marking read', async t => {
  const f = inboxHarness(); t.after(f.h.unmount);
  f.state.overview.threads[0] = { ...thread, latestSequence: 2, members: [{ id: 'self', name: 'Me', presence: 'online' }, { id: 'peer', name: 'Katja', presence: 'offline' }] };
  const tree = await f.settle('inbox'), list = nodes(tree).find(node => node.type === 'FlatList');
  const row = list.props.renderItem({ item: list.props.data[0] }); assert.equal(nodes(row).find(node => node.type === 'MessageAvatar').props.presence, 'offline');
  assert.deepEqual(f.requests.filter(item => item.body).map(item => item.body), [{ action: 'delivered', threadId: thread.id, throughSequence: 2 }]);
});
