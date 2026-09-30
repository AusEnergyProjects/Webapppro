import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/components/TradeMessagesWorkspace.tsx', import.meta.url), 'utf8');
const hook = source.slice(source.indexOf('function useConversationViewport'), source.indexOf('function TeamConversation'));
const compiled = ts.transpileModule(hook, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ active = true, mobile = true, supported = true, height = 800, alreadyFocused = false } = {}) {
  const viewport = Object.assign(new EventTarget(), { height, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const media = Object.assign(new EventTarget(), { matches: mobile });
  const styles = new Map(), frames = new Map(); let nextFrame = 0, cleanup;
  const element = Object.assign(new EventTarget(), { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) }, contains: target => Boolean(target?.inside) });
  const editor = detail => ({ inside: true, value: 'Saved draft', selectionStart: 5, selectionEnd: 5, matches: () => true, closest: () => detail ? element : null });
  const document = { activeElement: alreadyFocused ? editor(true) : null, documentElement: { clientHeight: height } };
  const window = Object.assign(new EventTarget(), { visualViewport: supported ? viewport : null, innerWidth: 390, innerHeight: height,
    matchMedia: () => media, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) });
  const invoke = new Function('useRef', 'useEffect', 'window', 'document', `${compiled}; return useConversationViewport;`)(
    () => ({ current: element }), callback => { cleanup = callback(); }, window, document);
  invoke(active);
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const focus = (detail = true) => {
    const input = editor(detail);
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

test('keyboard dismissal keeps the focused draft stable and leaving the editor restores normal layout', () => {
  const f = fixture(); f.focus(); f.resize(300); f.resize(800);
  assert.equal(f.element.dataset.keyboard, 'true'); assert.equal(f.styles.get('--message-viewport-height'), '800px');
  f.resize(280); f.document.activeElement = null; f.element.dispatchEvent(new Event('focusout')); f.flush();
  assert.equal(f.element.dataset.keyboard, undefined); assert.equal(f.styles.size, 0); f.cleanup();
});

test('desktop, search, inactive conversations and pinch zoom keep normal page behavior', () => {
  for (const options of [{ mobile: false }, { active: false }]) {
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
  f.resize(390); assert.equal(f.styles.get('--message-viewport-height'), '390px'); f.cleanup();
});

test('an editor mounted after Android has already resized the window still fits above the keyboard', () => {
  const f = fixture({ height: 308, alreadyFocused: true });
  assert.equal(f.element.dataset.keyboard, 'true');
  assert.equal(f.styles.get('--message-viewport-height'), '308px');
  assert.equal(f.document.activeElement.value, 'Saved draft');
  assert.equal(f.document.activeElement.selectionStart, 5);
  f.cleanup();
});

test('resize before focus and focus before resize produce the same fitted composer without a baseline guess', () => {
  for (const resizeFirst of [true, false]) {
    const f = fixture();
    if (!resizeFirst) f.focus();
    f.window.innerHeight = 308; f.document.documentElement.clientHeight = 308; f.resize(308, 24);
    if (resizeFirst) f.focus();
    assert.equal(f.element.dataset.keyboard, 'true');
    assert.equal(f.styles.get('--message-viewport-top'), '24px');
    assert.equal(f.styles.get('--message-viewport-height'), '308px');
    f.cleanup();
  }
});

test('browsers without visualViewport use the resized window and remove the fallback listeners on exit', () => {
  const f = fixture({ supported: false }); f.focus();
  f.window.innerHeight = 310; f.window.dispatchEvent(new Event('resize')); f.flush();
  assert.equal(f.styles.get('--message-viewport-height'), '310px');
  assert.equal(f.styles.get('--message-viewport-top'), '0px');
  assert.equal(f.styles.get('--message-viewport-width'), '390px');
  f.cleanup(); f.window.dispatchEvent(new Event('resize')); assert.equal(f.frames.size, 0);
});

test('focus transfer to Send retains the frame, while desktop changes and teardown cancel pending measurements', () => {
  const f = fixture(); f.focus(); f.resize(320); f.document.activeElement = { inside: true, matches: () => false };
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
  assert.match(keyboard, /\.detail \{[^}]*overflow: hidden/);
  assert.match(keyboard, /\.back \{[^}]*position: absolute/);
  assert.match(keyboard, /safe-area-inset-top/);
  assert.match(keyboard, /\[data-message-detail\] textarea \{ font-size: 16px/);
  const sms = fs.readFileSync(new URL('../src/components/TradeSms.module.css', import.meta.url), 'utf8');
  assert.match(sms, /\[data-keyboard="true"\][^\n]*\.textComposer \{[^}]*safe-area-inset-bottom/);
});
