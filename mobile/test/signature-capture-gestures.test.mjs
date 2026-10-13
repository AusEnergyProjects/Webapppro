import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/SignatureCapture.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const visit = node => Array.isArray(node) ? node.flatMap(visit)
  : !node || typeof node !== 'object' ? [] : [node, ...visit(node.props?.children)];
const event = (x = 20, y = 30, touches = 1) => ({ nativeEvent: {
  locationX: x, locationY: y, force: 0.5, touches: Array.from({ length: touches }, () => ({})),
} });

function fixture(overrides = {}) {
  const slots = [], effects = [], layouts = [], drawing = [], changes = [];
  let cursor = 0, dirty = false, tree, responder;
  const props = {
    signerRole: { roleKey: 'customer', label: 'Customer', capacity: 'Owner', identityRequirements: [] },
    declaration: 'Synthetic declaration',
    value: { signerRoleKey: 'customer', signerName: 'Synthetic Owner', signerCapacity: 'Owner', identity: {}, capturedAt: '', strokes: [] },
    onDrawingChange: active => drawing.push(active),
    onChange: value => { changes.push(value); props.value = value; },
    ...overrides,
  };
  const changed = (previous, next) => !previous || previous.length !== next.length
    || next.some((value, index) => !Object.is(value, previous[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps, pending) => {
    const index = cursor++, previous = slots[index];
    if (!previous || changed(previous.deps, deps)) {
      slots[index] = { deps, cleanup: previous?.cleanup };
      pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
    }
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: (callback, deps) => effect(callback, deps, effects),
    useLayoutEffect: (callback, deps) => effect(callback, deps, layouts),
  };
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: (type, value) => ({ type, props: value }), jsxs: (type, value) => ({ type, props: value }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'react-native': { PanResponder: { create: config => { responder = config; return { panHandlers: {} }; } },
      Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@/lib/theme': { colours: {}, radius: {}, spacing: {} },
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, exports);
  function render() {
    let passes = 0;
    do {
      assert.ok(passes++ < 10, 'Hook effects must converge'); dirty = false; cursor = 0;
      tree = exports.SignatureCapture(props);
      while (layouts.length) layouts.shift()();
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  const nodes = () => visit(tree);
  const pad = () => nodes().find(node => node.props.accessibilityLabel?.endsWith('signature drawing area'));
  render(); pad().props.onLayout({ nativeEvent: { layout: { width: 300, height: 220 } } }); render();
  return { props, drawing, changes, render, pad, responder: () => responder,
    strokes: () => nodes().filter(node => node.type?.name === 'Stroke').map(node => node.props.stroke),
    update(next) { Object.assign(props, next); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('enabled single-touch ink owns scrolling only until release, preserving the vector packet', () => {
  const h = fixture(), pan = h.responder();
  assert.equal(pan.onStartShouldSetPanResponderCapture(event()), true);
  assert.equal(pan.onMoveShouldSetPanResponderCapture(event()), true);
  assert.equal(pan.onShouldBlockNativeResponder(), false);
  pan.onPanResponderGrant(event()); h.render();
  assert.deepEqual(h.drawing, [true]); assert.equal(pan.onShouldBlockNativeResponder(), true);
  assert.equal(pan.onPanResponderTerminationRequest(), false);
  pan.onPanResponderMove(event(100, 120)); h.render();
  pan.onPanResponderRelease(event(100, 120, 0)); h.render();
  assert.deepEqual(h.drawing, [true, false]); assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].signerRoleKey, 'customer'); assert.equal(h.changes[0].signerName, 'Synthetic Owner');
  assert.equal(h.changes[0].strokes[0].points.length, 3);
  assert.equal(h.changes[0].strokes[0].points[2].x, 100 / 300);
  assert.equal(h.changes[0].strokes[0].points[2].y, 120 / 220);
  assert.equal(pan.onShouldBlockNativeResponder(), false); assert.equal(pan.onPanResponderTerminationRequest(), true);
  pan.onPanResponderRelease(event()); assert.equal(h.changes.length, 1);
  h.unmount(); assert.deepEqual(h.drawing, [true, false]);
});

test('equivalent parent objects and stable callbacks keep the same active native responder', () => {
  const h = fixture(), pan = h.responder();
  pan.onPanResponderGrant(event()); h.render();
  h.update({ signerRole: structuredClone(h.props.signerRole), value: structuredClone(h.props.value) });
  assert.equal(h.responder(), pan); assert.deepEqual(h.drawing, [true]);
  pan.onPanResponderMove(event(120, 140)); pan.onPanResponderRelease(event()); h.render();
  assert.deepEqual(h.drawing, [true, false]); assert.equal(h.changes[0].strokes[0].points.length, 3);
});

test('disabled, display-only, multi-touch and invalid coordinates never lock scrolling or create ink', () => {
  for (const props of [{ disabled: true }, { displayOnly: true }]) {
    const h = fixture(props), pan = h.responder();
    assert.equal(pan.onStartShouldSetPanResponderCapture(event()), false);
    pan.onPanResponderGrant(event()); pan.onPanResponderMove(event(100, 100)); pan.onPanResponderRelease(event()); h.render();
    assert.deepEqual(h.drawing, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.strokes(), []);
  }
  for (const touch of [event(20, 30, 0), event(20, 30, 2), event(NaN, 30), event(20, Infinity)]) {
    const h = fixture(), pan = h.responder();
    assert.equal(pan.onStartShouldSetPanResponderCapture(touch), false);
    pan.onPanResponderGrant(touch); pan.onPanResponderMove(event(100, 100)); pan.onPanResponderRelease(event()); h.render();
    assert.deepEqual(h.drawing, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.strokes(), []);
  }
});

test('termination, native cancellation, rejection and unmount always release the parent scroll lock', () => {
  for (const ending of ['terminate', 'cancel', 'reject', 'unmount']) {
    const h = fixture(), pan = h.responder();
    pan.onPanResponderGrant(event()); pan.onPanResponderMove(event(100, 100)); h.render();
    if (ending === 'terminate') pan.onPanResponderTerminate(event());
    else if (ending === 'cancel') h.pad().props.onTouchCancel(event());
    else if (ending === 'reject') pan.onPanResponderReject(event());
    else h.unmount();
    assert.deepEqual(h.drawing, [true, false], ending);
    assert.equal(h.changes.length, ending === 'terminate' ? 1 : 0, ending);
    pan.onPanResponderRelease(event()); assert.deepEqual(h.drawing, [true, false]);
    if (ending !== 'unmount') h.render();
    if (ending === 'cancel' || ending === 'reject') assert.deepEqual(h.strokes(), []);
  }
});

test('permission, signer-role and identity changes discard unfinished ink and reject stale native callbacks', () => {
  for (const change of [
    h => ({ disabled: true }), h => ({ displayOnly: true }),
    h => ({ signerRole: { ...h.props.signerRole, roleKey: 'installer' } }),
    h => ({ value: { ...h.props.value, signerName: 'Different Owner', strokes: [], capturedAt: '' } }),
    h => ({ value: { ...h.props.value, identity: { authority: 'Different authority' }, strokes: [], capturedAt: '' } }),
  ]) {
    const h = fixture(), oldPan = h.responder();
    oldPan.onPanResponderGrant(event()); oldPan.onPanResponderMove(event(100, 100)); h.render();
    h.update(change(h)); assert.deepEqual(h.drawing, [true, false]); assert.deepEqual(h.strokes(), []);
    oldPan.onPanResponderMove(event(200, 180)); oldPan.onPanResponderRelease(event()); oldPan.onPanResponderGrant(event()); h.render();
    assert.deepEqual(h.changes, []); assert.deepEqual(h.drawing, [true, false]); assert.deepEqual(h.strokes(), []);
  }
});

test('a second finger cancels the unfinished stroke without appending to earlier captured ink', () => {
  const h = fixture(), pan = h.responder();
  pan.onPanResponderGrant(event()); pan.onPanResponderMove(event(100, 100)); pan.onPanResponderRelease(event()); h.render();
  const original = structuredClone(h.changes[0].strokes);
  h.responder().onPanResponderGrant(event(150, 130)); h.responder().onPanResponderMove(event(170, 150, 2)); h.render();
  h.responder().onPanResponderMove(event(220, 190)); h.responder().onPanResponderRelease(event()); h.render();
  assert.deepEqual(h.drawing, [true, false, true, false]); assert.equal(h.changes.length, 1);
  assert.deepEqual(h.strokes(), original);
});

test('stroke and point caps do not acquire scrolling or append out-of-bound ink', () => {
  for (const strokes of [
    Array.from({ length: 32 }, (_, index) => ({ strokeKey: `saved-${index}`, points: [event(), event()] })),
    [{ strokeKey: 'full', points: Array.from({ length: 1_024 }, () => ({ x: 0.1, y: 0.1, capturedAtMs: 1, pressure: null })) }],
  ]) {
    const h = fixture(); h.update({ value: { ...h.props.value, strokes } });
    const pan = h.responder(); assert.equal(pan.onStartShouldSetPanResponderCapture(event()), false);
    pan.onPanResponderGrant(event()); pan.onPanResponderMove(event(100, 100)); pan.onPanResponderRelease(event());
    assert.deepEqual(h.drawing, []); assert.deepEqual(h.changes, []);
  }
});
