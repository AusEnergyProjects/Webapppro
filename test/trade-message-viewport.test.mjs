import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/components/TradeMessagesWorkspace.tsx', import.meta.url), 'utf8');
const hook = source.slice(source.indexOf('function useConversationViewport'), source.indexOf('function TeamConversation'));
const compiled = ts.transpileModule(hook, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ active = true, mobile = true, supported = true } = {}) {
  const viewport = Object.assign(new EventTarget(), { height: 800, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const media = Object.assign(new EventTarget(), { matches: mobile });
  const styles = new Map(), frames = new Map(); let nextFrame = 0, cleanup;
  const element = Object.assign(new EventTarget(), { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) }, contains: target => Boolean(target?.inside) });
  const document = { activeElement: null, documentElement: { clientHeight: 800 } };
  const window = Object.assign(new EventTarget(), { visualViewport: supported ? viewport : null, innerWidth: 390, innerHeight: 800,
    matchMedia: () => media, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) });
  const invoke = new Function('useRef', 'useEffect', 'window', 'document', `${compiled}; return useConversationViewport;`)(
    () => ({ current: element }), callback => { cleanup = callback(); }, window, document);
  invoke(active);
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const focus = (detail = true) => {
    const input = { inside: true, value: 'Saved draft', selectionStart: 5, selectionEnd: 5, matches: () => true, closest: () => detail ? element : null };
    document.activeElement = input; element.dispatchEvent(new Event('focusin')); flush(); return input;
  };
  const resize = (height, offsetTop = 0, offsetLeft = 0) => {
    Object.assign(viewport, { height, offsetTop, offsetLeft }); viewport.dispatchEvent(new Event('resize')); flush();
  };
  flush();
  return { viewport, media, element, document, window, styles, frames, flush, focus, resize, cleanup: () => cleanup?.() };
}

test('team and customer editing follow the actual keyboard viewport and preserve the editor draft and selection', () => {
  for (const conversation of ['team', 'customer']) {
    const f = fixture(); const editor = f.focus(); f.resize(310, 37, 4);
    assert.equal(f.element.dataset.keyboard, 'true', conversation);
    assert.equal(f.styles.get('--message-viewport-height'), '310px');
    assert.equal(f.styles.get('--message-viewport-top'), '37px');
    assert.equal(f.styles.get('--message-viewport-left'), '4px');
    assert.equal(f.styles.get('--message-viewport-width'), '390px');
    f.viewport.offsetTop = 51; f.viewport.dispatchEvent(new Event('scroll')); f.flush();
    assert.equal(f.styles.get('--message-viewport-top'), '51px');
    assert.equal(f.document.activeElement, editor); assert.equal(editor.value, 'Saved draft'); assert.equal(editor.selectionStart, 5);
    f.cleanup();
  }
});

test('keyboard dismissal and leaving the conversation restore normal layout even if the textarea stays focused', () => {
  const f = fixture(); f.focus(); f.resize(300); f.resize(800);
  assert.equal(f.element.dataset.keyboard, undefined); assert.equal(f.styles.size, 0);
  f.resize(280); f.document.activeElement = null; f.element.dispatchEvent(new Event('focusout')); f.flush();
  assert.equal(f.element.dataset.keyboard, undefined); assert.equal(f.styles.size, 0); f.cleanup();
});

test('desktop, search, inactive conversations, unsupported browsers and pinch zoom keep normal page behavior', () => {
  for (const options of [{ mobile: false }, { active: false }, { supported: false }]) {
    const f = fixture(options); f.focus(); f.resize(300); assert.equal(f.styles.size, 0); f.cleanup();
  }
  const f = fixture(); f.focus(false); f.resize(300); assert.equal(f.styles.size, 0);
  f.focus(); f.viewport.scale = 2; f.resize(250); assert.equal(f.styles.size, 0); f.cleanup();
});

test('content-resizing keyboards and rotation respect viewport geometry without subtracting keyboard height twice', () => {
  const f = fixture(); f.focus(); f.window.innerHeight = 320; f.document.documentElement.clientHeight = 320; f.resize(320);
  assert.equal(f.styles.get('--message-viewport-height'), '320px');
  f.window.innerWidth = 720; f.window.innerHeight = 390; f.document.documentElement.clientHeight = 390; f.viewport.width = 720; f.resize(200);
  assert.equal(f.styles.get('--message-viewport-width'), '720px'); assert.equal(f.styles.get('--message-viewport-height'), '200px');
  f.resize(390); assert.equal(f.styles.size, 0); f.cleanup();
});

test('focus transfer to Send retains the frame, while desktop changes and teardown cancel pending measurements', () => {
  const f = fixture(); f.focus(); f.resize(320); f.document.activeElement = { inside: true };
  f.element.dispatchEvent(new Event('focusout')); f.flush(); assert.equal(f.element.dataset.keyboard, 'true');
  f.media.matches = false; f.media.dispatchEvent(new Event('change')); f.flush(); assert.equal(f.styles.size, 0);
  f.media.matches = true; f.viewport.dispatchEvent(new Event('resize')); assert.equal(f.frames.size, 1);
  f.cleanup(); assert.equal(f.frames.size, 0); f.resize(200); assert.equal(f.styles.size, 0);
});

test('keyboard CSS removes the mobile height floor and retains balance, scrolling history and readable customer inputs', () => {
  const css = fs.readFileSync(new URL('../src/components/TradeMessagesWorkspace.module.css', import.meta.url), 'utf8');
  const keyboard = css.slice(css.indexOf('.workspace[data-keyboard="true"]'));
  assert.match(keyboard, /> \.layout \{[^}]*height: auto; min-height: 0;/);
  assert.doesNotMatch(keyboard, /420px|100dvh/);
  assert.match(keyboard, /\.creditButton \{[^}]*min-height: 36px/);
  assert.match(css, /\.messages \{[^}]*min-height: 0; overflow-y: auto/);
  assert.match(keyboard, /\[data-message-detail\] textarea \{ font-size: 16px/);
});
