import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compiled = ts.transpileModule(read('../src/components/messages-ui.tsx'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function harness(initialKeyboard) {
  const state = { y: 132, height: 620, held: [], defer: false, writes: 0 };
  const slots = []; const effects = []; const listeners = new Map(); const frames = new Map();
  let cursor = 0; let sequence = 0;
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: initial => {
      const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; state.writes++; }];
    },
    useEffect: callback => { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(callback); } },
  };
  const element = (type, props) => ({ type, props });
  const exports = {};
  new Function('require', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', compiled)(id => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (id === '@expo/vector-icons/MaterialCommunityIcons') return { default: 'Icon' };
    if (id === '@/lib/theme') return { colours: {}, radius: {} };
    if (id === 'react-native') return { View: 'View', StyleSheet: { create: value => value }, Keyboard: {
      metrics: () => initialKeyboard,
      addListener: (event, listener) => { listeners.set(event, listener); return { remove: () => listeners.delete(event) }; },
    } };
    throw new Error(`Unexpected dependency ${id}`);
  }, exports, callback => { const id = ++sequence; frames.set(id, callback); return id; }, id => frames.delete(id));
  const draft = { body: 'Keep this unsent draft', requestId: 'pending-send-1' };
  const render = () => {
    cursor = 0;
    return exports.MessageKeyboardView({ children: draft, style: { flex: 1, gap: 8 } });
  };
  const root = render();
  root.props.ref.current = { measureInWindow: callback => {
    if (state.defer) state.held.push(callback);
    else callback(0, state.y, 390, state.height);
  } };
  const cleanups = effects.map(effect => effect());
  const settle = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const inset = () => render().props.children.props.style.at(-1).marginBottom;
  const event = (name, screenY = 480, height = 320) => listeners.get(name)?.({ endCoordinates: { screenY, height } });
  return { state, root, draft, render, settle, inset, event, listeners, frames, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test('overlay keyboards move the entire composer above the keyboard using actual header and safe-area geometry', () => {
  const h = harness(); h.settle(); assert.equal(h.inset(), 0);
  h.event('keyboardDidShow'); h.settle();
  assert.equal(h.state.y + h.state.height - h.inset(), 480);
  assert.equal(h.inset(), 272, 'reserve overlap only, not the full 320px keyboard height');
  assert.equal(h.render().props.children.props.children, h.draft, 'layout never remounts or changes the draft');
});

test('Android resize removes the overlay inset instead of adding a second keyboard-sized gap', () => {
  const h = harness(); h.event('keyboardDidShow'); h.settle(); assert.equal(h.inset(), 272);
  h.state.height = 348; h.root.props.onLayout(); h.settle();
  assert.equal(h.inset(), 0);
  assert.equal(h.state.y + h.state.height, 480);
});

test('a modal opened with the keyboard visible measures its own window and reflows for emoji and rotation', () => {
  const h = harness({ screenY: 500, height: 300 });
  h.state.y = 52; h.state.height = 716; h.settle(); assert.equal(h.inset(), 268);
  h.event('keyboardDidChangeFrame', 400, 400); h.settle(); assert.equal(h.inset(), 368);
  h.state.y = 24; h.state.height = 340; h.event('keyboardWillChangeFrame', 220, 170);
  h.root.props.onLayout(); h.settle(); assert.equal(h.inset(), 144);
  h.event('keyboardDidHide'); h.settle(); assert.equal(h.inset(), 0);
});

test('late measurements cannot restore an obsolete inset after keyboard hide or unmount', () => {
  const h = harness(); h.settle(); h.state.defer = true;
  h.event('keyboardDidShow'); h.settle();
  h.event('keyboardDidHide'); h.state.held.shift()(0, 132, 390, 620); assert.equal(h.inset(), 0);
  h.state.defer = false; h.settle(); assert.equal(h.inset(), 0);
  h.state.defer = true; h.event('keyboardDidShow'); h.settle();
  const writes = h.state.writes; h.unmount(); h.state.held.shift()(0, 132, 390, 620);
  assert.equal(h.state.writes, writes); assert.equal(h.listeners.size, 0); assert.equal(h.frames.size, 0);
});

test('both conversation and new-chat footer use one measured viewport with no fixed keyboard offset', () => {
  const conversation = read('../src/components/messages-conversation.tsx');
  const screen = read('../src/app/(tabs)/messages.tsx');
  for (const source of [conversation, screen]) {
    assert.match(source, /<MessageKeyboardView\b/);
    assert.doesNotMatch(source, /KeyboardAvoidingView|keyboardVerticalOffset/);
  }
  assert.match(conversation, /automaticallyAdjustKeyboardInsets=\{false\}/);
  assert.match(conversation, /keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"/);
});
