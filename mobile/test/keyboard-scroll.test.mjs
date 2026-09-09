import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../src/lib/keyboard-scroll.ts');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', output)(exports);
const { keyboardScrollAdjustment, createKeyboardScrollCoordinator } = exports;

function harness() {
  const state = { viewport: { x: 0, y: 128, width: 400, height: 620 }, inputFrame: { x: 24, y: 600, width: 340, height: 50 },
    offset: 0, space: 0, measurements: 0, scrolls: [], frames: new Map(), sequence: 0 };
  const input = { measureInWindow(callback) {
    const { x, y, width, height } = state.inputFrame; callback(x, y, width, height);
  } };
  state.focused = input;
  const coordinator = createKeyboardScrollCoordinator({
    getFocusedInput: () => state.focused,
    measureViewport: (callback) => {
      state.measurements++;
      if (state.holdMeasurement) { state.heldMeasurement = callback; return; }
      const { x, y, width, height } = state.viewport; callback(x, y, width, height);
    },
    getOffset: () => state.offset,
    scrollTo: (y) => { state.scrolls.push(y); state.inputFrame.y -= y - state.offset; state.offset = y; },
    setBottomSpace: (height) => { state.space = height; },
    requestFrame: (callback) => { const id = ++state.sequence; state.frames.set(id, callback); return id; },
    cancelFrame: (id) => state.frames.delete(id),
  });
  const frame = () => { const callbacks = [...state.frames.values()]; state.frames.clear(); callbacks.forEach((callback) => callback()); };
  const settle = () => { for (let i = 0; i < 10 && state.frames.size; i++) frame(); assert.equal(state.frames.size, 0); };
  return { state, coordinator, input, frame, settle };
}

test('nested wizard geometry includes its header offset and scrolls the covered input above the actual keyboard', () => {
  const adjustment = keyboardScrollAdjustment({ x: 0, y: 128, width: 400, height: 620 },
    { x: 24, y: 600, width: 340, height: 50 }, { screenY: 500, height: 300 }, 100);
  assert.deepEqual(adjustment, { bottomSpace: 264, scrollY: 266, needsScroll: true });
});

test('Android resized viewport adds only a small gap rather than a second keyboard-height inset', () => {
  const adjustment = keyboardScrollAdjustment({ x: 0, y: 128, width: 400, height: 372 },
    { x: 24, y: 450, width: 340, height: 50 }, { screenY: 500, height: 300 }, 80);
  assert.deepEqual(adjustment, { bottomSpace: 16, scrollY: 96, needsScroll: true });
});

test('modal geometry uses the actual sheet viewport, without screen-height or fixed keyboard assumptions', () => {
  const adjustment = keyboardScrollAdjustment({ x: 0, y: 340, width: 400, height: 400 },
    { x: 24, y: 520, width: 340, height: 48 }, { screenY: 540, height: 260 }, 0);
  assert.deepEqual(adjustment, { bottomSpace: 216, scrollY: 44, needsScroll: true });
});

test('focus before the keyboard animation is remeasured after keyboardDidShow and layout', () => {
  const h = harness(); h.coordinator.focus();
  assert.equal(h.state.measurements, 0);
  h.frame(); assert.equal(h.state.measurements, 0, 'do not measure in the same focus frame');
  h.frame(); assert.equal(h.state.scrolls.length, 0, 'field is initially visible before the keyboard');
  h.coordinator.keyboardChanged({ screenY: 500, height: 300 });
  h.state.viewport.height = 372; h.coordinator.layoutChanged();
  h.settle();
  assert.equal(h.state.offset, 166);
  assert.equal(h.state.space, 16);
  assert.ok(h.state.inputFrame.y + h.state.inputFrame.height <= 500 - 16);
});

test('a taller keyboard or emoji panel remeasures the focused input without requiring another focus', () => {
  const h = harness(); h.coordinator.focus({ screenY: 560, height: 240 }); h.settle();
  const originalOffset = h.state.offset;
  h.coordinator.keyboardChanged({ screenY: 420, height: 380 }); h.settle();
  assert.equal(h.state.offset - originalOffset, 140);
  assert.ok(h.state.inputFrame.y + h.state.inputFrame.height <= 404);
});

test('content layout changes while typing keep the same focused input visible', () => {
  const h = harness(); h.coordinator.focus({ screenY: 500, height: 300 }); h.settle();
  h.state.inputFrame.height = 110; h.coordinator.layoutChanged(); h.settle();
  assert.ok(h.state.inputFrame.y + h.state.inputFrame.height <= 484);
});

test('blur and a different modal input cancel stale native measurement callbacks', () => {
  const h = harness(); h.state.holdMeasurement = true;
  h.coordinator.focus({ screenY: 500, height: 300 }); h.settle();
  const callback = h.state.heldMeasurement;
  h.coordinator.blur(); h.state.focused = { measureInWindow() { throw new Error('An unrelated modal input must not be measured here'); } };
  callback(0, 128, 400, 620);
  h.coordinator.keyboardChanged({ screenY: 400, height: 400 }); h.settle();
  assert.equal(h.state.scrolls.length, 0);
});

test('changing focus before the queued frames measures only the latest field', () => {
  const h = harness(); h.coordinator.focus({ screenY: 500, height: 300 });
  h.coordinator.blur(); h.state.inputFrame.y = 300;
  h.coordinator.focus({ screenY: 500, height: 300 }); h.settle();
  assert.equal(h.state.scrolls.length, 0);
});

test('keyboard hiding removes its scroll space and unmount cancels pending frames', () => {
  const h = harness(); h.coordinator.focus({ screenY: 500, height: 300 }); h.settle();
  assert.ok(h.state.space > 0);
  h.coordinator.keyboardHidden(); h.settle(); assert.equal(h.state.space, 0);
  h.coordinator.layoutChanged(); h.coordinator.dispose(); h.settle();
  const count = h.state.measurements;
  h.coordinator.keyboardChanged({ screenY: 400, height: 400 }); h.settle(); assert.equal(h.state.measurements, count);
});

test('React development effect remount can reactivate the coordinator without stale callbacks', () => {
  const h = harness(); h.coordinator.dispose(); h.coordinator.activate();
  h.coordinator.focus({ screenY: 500, height: 300 }); h.settle();
  assert.equal(h.state.offset, 166);
});

test('the shared component handles settled keyboard events and measures both actual native window frames', () => {
  const component = read('../src/components/keyboard-aware-scroll-view.tsx');
  assert.match(component, /keyboardDidShow/); assert.match(component, /keyboardDidChangeFrame/); assert.match(component, /keyboardDidHide/);
  assert.match(component, /getNativeScrollRef\(\)\?\.measureInWindow/);
  assert.match(component, /currentlyFocusedInput\(\)/);
  assert.match(component, /onLayout=.*coordinator\.layoutChanged/);
  assert.match(component, /onContentSizeChange=.*coordinator\.layoutChanged/);
  assert.match(component, /automaticallyAdjustKeyboardInsets=\{false\}/);
  assert.doesNotMatch(component, /scrollResponderScrollNativeHandleToKeyboard/);
});

test('a modal or nested scroll owns focus without activating its parent scroll', () => {
  const component = read('../src/components/keyboard-aware-scroll-view.tsx');
  const jsx = ts.transpileModule(component, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const controllers = [];
  const fakeRequire = (name) => {
    if (name === 'react') return { forwardRef: (render) => render, useEffect() {}, useImperativeHandle() {},
      useRef: (current) => ({ current }), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Keyboard: { metrics: () => ({ screenY: 500, height: 300 }) }, ScrollView: 'ScrollView', View: 'View' };
    if (name === '@/lib/keyboard-scroll') return { createKeyboardScrollCoordinator: () => {
      const controller = { focuses: 0, blurs: 0, focus() { this.focuses++; }, blur() { this.blurs++; } };
      controllers.push(controller); return controller;
    } };
    throw new Error(`Unexpected dependency ${name}`);
  };
  const componentExports = {};
  new Function('exports', 'require', jsx)(componentExports, fakeRequire);
  const outer = componentExports.KeyboardAwareScrollView({}, null);
  let customFocus = 0;
  const inner = componentExports.KeyboardAwareScrollView({ onFocus: () => customFocus++ }, null);
  for (const handler of ['onFocus', 'onBlur']) {
    const event = { stopped: false, stopPropagation() { this.stopped = true; } };
    inner.props[handler](event);
    if (!event.stopped) outer.props[handler](event);
  }
  assert.equal(controllers[0].focuses, 0); assert.equal(controllers[0].blurs, 0);
  assert.equal(controllers[1].focuses, 1); assert.equal(controllers[1].blurs, 1);
  assert.equal(customFocus, 1, 'preserve the viewport caller focus callback');
});

test('app form scroll containers and the search modal share one keyboard adjustment implementation', () => {
  for (const path of ['../src/components/screen.tsx', '../src/components/ActivityFieldFormWizard.tsx', '../src/app/(tabs)/work.tsx', '../src/components/field-select.tsx']) {
    const component = read(path); assert.match(component, /<KeyboardAwareScrollView\b/, path);
    assert.doesNotMatch(component, /scrollResponderScrollNativeHandleToKeyboard/, path);
  }
  const select = read('../src/components/field-select.tsx');
  assert.ok(select.indexOf('<KeyboardAwareScrollView') < select.indexOf('<TextInput'), 'the modal search itself must be inside the scroll viewport');
  assert.doesNotMatch(read('../src/app/index.tsx'), /KeyboardAvoidingView/, 'login must not apply a second independent keyboard inset');
});
