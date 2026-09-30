import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const allowed = { notificationsAllowed: true, channelImportance: 4, channelSoundEnabled: true, fullScreenAllowed: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes)
  : [node, ...nodes(node.props?.children)];
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label);
const callButtons = tree => ['Allow call notifications', 'Incoming call alerts', 'Allow lock-screen calls']
  .filter(label => button(tree, label));

function harness({ platform = 'android', muted = false, status = allowed, nativeModule, missingOpener = false } = {}) {
  const slots = [], effects = [], pendingEffects = [], listeners = new Set();
  let cursor = 0, mounted = true, tree;
  const observed = { statusReads: 0, deviceReads: 0, opened: [], appSettings: 0, lateWrites: 0, requests: [] };
  const current = {
    status, readStatus: async () => current.status,
    readDelivery: async () => ({ native: { configured: true, registered: true } }),
    openSettings: async () => undefined,
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => {
        if (!mounted) observed.lateWrites++;
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!effects[i] || !same(effects[i].deps, deps)) {
        const previous = effects[i]; effects[i] = { deps };
        pendingEffects.push(() => { previous?.cleanup?.(); effects[i].cleanup = fn(); });
      }
    },
  };
  const native = nativeModule === undefined ? {
    callNotificationStatus: async () => { observed.statusReads++; return current.readStatus(); },
    ...(!missingOpener ? { openCallNotificationSettings: async target => { observed.opened.push(target); await current.openSettings(); } } : {}),
    configure: () => assert.fail('Checking notification settings must not configure native calls'),
  } : nativeModule;
  const bridge = load('../src/lib/native-system-calls.ts', { expo: { requireOptionalNativeModule: () => native } });
  const request = async (path, init) => {
    assert.equal(init, undefined, 'Reading settings must not register devices or mutate permissions');
    observed.requests.push(path);
    return current.readDelivery();
  };
  const jsx = (type, props) => ({ type, props });
  const component = load('../src/components/device-notification-settings.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Platform: { OS: platform }, StyleSheet: { create: value => value }, Switch: 'Switch', Text: 'Text', View: 'View',
      Linking: { openSettings: async () => { observed.appSettings++; } },
      AppState: { addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
    },
    '@/components/field-button': { FieldButton: 'Button' },
    '@/lib/use-business-api': { useBusinessApi: () => request },
    '@/providers/app-provider': { useApp: () => ({ sync: { online: true }, waitForNotificationRegistrations: async () => undefined }) },
    '@/lib/native-system-calls': bridge,
    '@/lib/device': {
      notificationDeviceState: async () => { observed.deviceReads++; return { granted: true, muted, physicalDevice: true, canAskAgain: true }; },
      getDeviceId: async () => 'device-123456',
      getNativePushToken: () => assert.fail('Settings reads must not request notification permission'),
      deviceRegistration: () => assert.fail('Settings reads must not register a device'),
      setNotificationsMuted: () => assert.fail('Call settings buttons must not change the notification mute preference'),
    },
    '@/lib/sync': { resolveFieldAccessModes: async () => ['trade_team'] },
    '@/lib/theme': { colours: {}, radius: {}, spacing: {} },
  });
  const render = () => {
    assert.equal(mounted, true); cursor = 0; tree = component.DeviceNotificationSettings();
    for (const effect of pendingEffects.splice(0)) effect();
    return tree;
  };
  return {
    observed, current, listeners, render,
    foreground: value => { for (const listener of listeners) listener(value || 'active'); },
    unmount: () => { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    async settle() { for (let i = 0; i < 4; i++) { render(); await tick(); } return tree; },
  };
}

test('Android full-screen denial has an explicit lock-screen grant action and never opens settings automatically', async t => {
  const h = harness({ status: { ...allowed, fullScreenAllowed: false } }); t.after(h.unmount);
  const tree = await h.settle();
  assert.match(text(tree), /Allow full-screen alerts/);
  assert.deepEqual(callButtons(tree), ['Allow lock-screen calls']);
  assert.deepEqual(h.observed.opened, []); assert.equal(h.observed.appSettings, 0);
  button(tree, 'Allow lock-screen calls').props.onPress(); await tick();
  assert.deepEqual(h.observed.opened, ['fullScreen']); assert.equal(h.observed.appSettings, 0);
});

for (const [reason, status, explanation] of [
  ['low channel importance', { ...allowed, channelImportance: 3 }, /pop up on screen and play a ringtone/],
  ['muted channel sound', { ...allowed, channelSoundEnabled: false }, /ringtone is muted/],
]) {
  test(`Android ${reason} opens the incoming-call channel only after a tap`, async t => {
    const h = harness({ status }); t.after(h.unmount);
    const tree = await h.settle(); assert.match(text(tree), explanation);
    assert.deepEqual(callButtons(tree), ['Incoming call alerts']); assert.deepEqual(h.observed.opened, []);
    button(tree, 'Incoming call alerts').props.onPress(); await tick();
    assert.deepEqual(h.observed.opened, ['channel']); assert.equal(h.observed.appSettings, 0);
  });
}

test('Android app-level notification blocking directs the user to app notification settings', async t => {
  const h = harness({ status: { ...allowed, notificationsAllowed: false } }); t.after(h.unmount);
  const tree = await h.settle();
  assert.match(text(tree), /Android is blocking TLink notifications/);
  assert.deepEqual(callButtons(tree), ['Allow call notifications']);
  button(tree, 'Allow call notifications').props.onPress(); await tick();
  assert.deepEqual(h.observed.opened, ['app']); assert.equal(h.observed.appSettings, 0);
});

test('allowed Android settings describe permission without promising call delivery', async t => {
  const h = harness(); t.after(h.unmount);
  const tree = await h.settle(), content = text(tree);
  assert.match(content, /Incoming call pop-ups and ringtone are enabled/);
  assert.match(content, /Lock-screen call access is allowed/);
  assert.match(content, /Silent mode, Do Not Disturb.*battery restrictions can still silence or delay calls/);
  assert.doesNotMatch(content, /guaranteed|will ring|will receive/i);
  assert.deepEqual(callButtons(tree), []); assert.deepEqual(h.observed.opened, []); assert.equal(h.observed.appSettings, 0);
});

test('muted phones suppress incoming-call permission controls', async t => {
  const h = harness({ muted: true, status: { ...allowed, notificationsAllowed: false, fullScreenAllowed: false } }); t.after(h.unmount);
  const tree = await h.settle();
  assert.match(text(tree), /Muted on this phone/); assert.doesNotMatch(text(tree), /Incoming calls|Lock-screen call access/);
  assert.deepEqual(callButtons(tree), []); assert.deepEqual(h.observed.opened, []);
});

test('iOS neither reads Android native settings nor renders Android settings controls', async t => {
  const h = harness({ platform: 'ios', status: { ...allowed, fullScreenAllowed: false } }); t.after(h.unmount);
  let tree = await h.settle(); h.foreground(); tree = await h.settle();
  assert.equal(h.observed.statusReads, 0);
  assert.doesNotMatch(text(tree), /Incoming calls|full-screen alerts|Lock-screen call/);
  assert.deepEqual(callButtons(tree), []); assert.deepEqual(h.observed.opened, []);
});

test('returning to the foreground reflects changed Android settings without launching another settings page', async t => {
  const h = harness({ status: { ...allowed, fullScreenAllowed: false } }); t.after(h.unmount);
  const before = await h.settle(); assert.ok(button(before, 'Allow lock-screen calls'));
  const reads = h.observed.statusReads; h.foreground('background'); await tick(); assert.equal(h.observed.statusReads, reads);
  h.current.status = { ...allowed }; h.foreground();
  const after = await h.settle(); assert.equal(h.observed.statusReads, reads + 1);
  assert.equal(button(after, 'Allow lock-screen calls'), undefined); assert.match(text(after), /Lock-screen call access is allowed/);
  assert.deepEqual(h.observed.opened, []); assert.equal(h.observed.appSettings, 0);
});

test('a stale async Android settings read cannot replace a newer foreground result', async t => {
  const h = harness(); t.after(h.unmount);
  let finish; h.current.readStatus = () => new Promise(resolve => { finish = resolve; });
  h.render(); await tick();
  h.current.readStatus = async () => ({ ...allowed }); h.foreground();
  await h.settle(); finish({ ...allowed, fullScreenAllowed: false, channelSoundEnabled: false });
  const tree = await h.settle();
  assert.deepEqual(callButtons(tree), []); assert.match(text(tree), /Lock-screen call access is allowed/);
});

test('unmount cancels scheduled reads, removes foreground listeners and ignores pending settings results', async () => {
  const immediate = harness(); immediate.render(); immediate.unmount(); await tick();
  assert.equal(immediate.observed.deviceReads, 0); assert.equal(immediate.observed.statusReads, 0);
  assert.equal(immediate.listeners.size, 0); assert.equal(immediate.observed.lateWrites, 0);
  const pending = harness(); let finish;
  pending.current.readStatus = () => new Promise(resolve => { finish = resolve; });
  pending.render(); await tick(); pending.unmount(); finish({ ...allowed }); await tick();
  assert.equal(pending.observed.lateWrites, 0); assert.equal(pending.observed.requests.length, 0); assert.equal(pending.listeners.size, 0);
});

test('an in-flight delivery check cannot update settings after unmount', async () => {
  const h = harness(); let finish;
  h.current.readDelivery = () => new Promise(resolve => { finish = resolve; });
  h.render(); await tick(); assert.equal(h.observed.requests.length, 1);
  h.unmount(); finish({ native: { configured: true, registered: true } }); await tick();
  assert.equal(h.observed.lateWrites, 0);
});

test('older binaries without optional Android bridge methods show an honest unavailable state', async t => {
  for (const nativeModule of [{}, null]) {
    const h = harness({ nativeModule }); t.after(h.unmount);
    const tree = await h.settle();
    assert.match(text(tree), /Call settings could not be checked. Update TLink/);
    assert.doesNotMatch(text(tree), /Incoming call pop-ups and ringtone are enabled/);
    assert.deepEqual(callButtons(tree), []); assert.deepEqual(h.observed.opened, []); assert.equal(h.observed.appSettings, 0);
  }
});

test('a missing native settings opener falls back to phone settings only after the explicit action', async t => {
  const h = harness({ missingOpener: true, status: { ...allowed, fullScreenAllowed: false } }); t.after(h.unmount);
  const tree = await h.settle(); assert.equal(h.observed.appSettings, 0);
  button(tree, 'Allow lock-screen calls').props.onPress(); await tick();
  assert.equal(h.observed.appSettings, 1); assert.deepEqual(h.observed.opened, []);
});

test('native settings read and opening failures stay explicit without claiming permission was granted', async t => {
  const readFailure = harness(); t.after(readFailure.unmount);
  readFailure.current.readStatus = async () => { throw new Error('Native settings unavailable'); };
  const unavailable = await readFailure.settle();
  assert.match(text(unavailable), /Call settings could not be checked/); assert.deepEqual(callButtons(unavailable), []);
  const openFailure = harness({ status: { ...allowed, fullScreenAllowed: false } }); t.after(openFailure.unmount);
  openFailure.current.openSettings = async () => { throw new Error('No settings activity'); };
  let tree = await openFailure.settle(); button(tree, 'Allow lock-screen calls').props.onPress(); tree = await openFailure.settle();
  assert.match(text(tree), /Open your phone settings, choose TLink/); assert.ok(button(tree, 'Allow lock-screen calls'));
  assert.doesNotMatch(text(tree), /Lock-screen call access is allowed/);
});
