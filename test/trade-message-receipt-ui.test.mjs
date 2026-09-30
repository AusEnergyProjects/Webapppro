import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function component(file) {
  const output = ts.transpileModule(readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  Function('require', 'exports', output)(name => name === 'react/jsx-runtime' ? jsx : { default: new Proxy({}, { get: (_, key) => key }) }, exports);
  return exports.default;
}
const Receipt = component('TradeMessageReceipt'), Dot = component('TradeTeamStatusDot');
const receipt = (status, readAt = null) => ({ status, recipientCount: 1, deliveredCount: status === 'sent' ? 0 : 1, readCount: status === 'read' ? 1 : 0, deliveredAt: null, readAt,
  recipients: [{ memberId: 'person', name: 'Katja', status, deliveredAt: null, readAt }] });

test('persisted sent messages show one tick, delivery two, and read coloured ticks with the real time', () => {
  const sent = renderToStaticMarkup(jsx.jsx(Receipt, { receipt: receipt('sent') }));
  const delivered = renderToStaticMarkup(jsx.jsx(Receipt, { receipt: receipt('delivered') }));
  const read = renderToStaticMarkup(jsx.jsx(Receipt, { receipt: receipt('read', '2026-09-30T08:01:00Z') }));
  assert.equal((sent.match(/<path/g) || []).length, 1);
  assert.equal((delivered.match(/<path/g) || []).length, 2);
  assert.equal((read.match(/<path/g) || []).length, 2);
  assert.match(read, /class="receipt read"/);
  assert.match(read, /Read.*30 Sept?/);
  assert.match(read, /Katja: Read/);
});

test('unknown old read times are not fabricated and group partial reads do not become all-read ticks', () => {
  assert.match(renderToStaticMarkup(jsx.jsx(Receipt, { receipt: receipt('read') })), /time unavailable/);
  assert.match(renderToStaticMarkup(jsx.jsx(Receipt, {})), /aria-label="Sent"/);
  const partial = { ...receipt('delivered'), recipientCount: 2, deliveredCount: 2, readCount: 1 };
  const html = renderToStaticMarkup(jsx.jsx(Receipt, { receipt: partial }));
  assert.match(html, /1\/2 read/); assert.doesNotMatch(html, /class="receipt read"/);
});

test('status dots expose meaningful labels, exact availability colours, and no invented online status', () => {
  for (const status of ['online', 'busy', 'offline']) {
    const html = renderToStaticMarkup(jsx.jsx(Dot, { presence: status, name: 'Katja' }));
    assert.match(html, new RegExp(`class="dot ${status}"`));
    assert.match(html, new RegExp(`Katja: Call status: ${status[0].toUpperCase() + status.slice(1)}`));
  }
  assert.match(renderToStaticMarkup(jsx.jsx(Dot, {})), /Status unavailable/);
  const inactive = renderToStaticMarkup(jsx.jsx(Dot, { presence: 'online', active: false }));
  assert.match(inactive, /Inactive/); assert.doesNotMatch(inactive, /dot online/);
});

const source = readFileSync(new URL('../src/components/TradeMessagesWorkspace.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    const list = history.current;');
assert.ok(start > 0);
const hook = ts.transpileModule(source.slice(start, source.indexOf('\n\n  async function older()', start)), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function visibleFixture({ visible = true, focused = true, offscreen = false, offscreenX = false, modal = false, covered = false, result } = {}) {
  const list = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ width: 400, height: 300, left: offscreenX ? 900 : 0, right: offscreenX ? 1300 : 400, top: offscreen ? 900 : 100, bottom: offscreen ? 1200 : 400 }),
    querySelectorAll: () => [1, 2, 3].map(sequence => ({ dataset: { messageSequence: String(sequence) }, contains: () => !covered, getBoundingClientRect: () => ({ left: 50, right: 350, top: sequence === 3 ? 410 : 150, bottom: sequence === 3 ? 450 : 200 }) })) });
  let frame, cleanup, refreshed = 0;
  const window = Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 600, requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame() {} });
  const document = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => focused, elementFromPoint: () => ({}), querySelectorAll: selector => {
    assert.match(selector, /dialog:modal/); assert.match(selector, /aria-modal="true"/);
    return modal ? [{ contains: () => false, getClientRects: () => [{}] }] : [];
  } });
  const lastRead = { current: 0 }, reading = { current: false }, alive = { current: true }, calls = [];
  const call = async (_, body) => { calls.push(body); return result ? await result : { response: { ok: true }, result: { ok: true } }; };
  const mount = () => Function('useEffect', 'history', 'messages', 'call', 'thread', 'onRead', 'lastRead', 'reading', 'alive', 'window', 'document', hook)(effect => { cleanup = effect(); }, { current: list }, [{ sequence: 1 }], call, { id: 'thread-a' }, () => { refreshed++; }, lastRead, reading, alive, window, document);
  mount();
  return { calls, lastRead, frame: () => frame(), cleanup: () => { alive.current = false; cleanup(); }, rerender: () => { cleanup(); mount(); }, list, window, document, refreshed: () => refreshed };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('read ACK waits for rendered visible messages in a focused conversation and excludes offscreen messages', async () => {
  const f = visibleFixture(); assert.equal(f.calls.length, 0); f.frame(); await settle();
  assert.deepEqual(f.calls, [{ action: 'read', threadId: 'thread-a', throughSequence: 2 }]);
  f.list.dispatchEvent(new Event('scroll')); await settle(); assert.equal(f.calls.length, 1); f.cleanup();
  for (const options of [{ visible: false }, { focused: false }, { offscreen: true }, { offscreenX: true }, { modal: true }, { covered: true }]) {
    const hidden = visibleFixture(options); hidden.frame(); await settle(); assert.equal(hidden.calls.length, 0); hidden.cleanup();
  }
});

test('a slow successful read ACK survives a history rerender without duplicate acknowledgements', async () => {
  let finish;
  const f = visibleFixture({ result: new Promise(resolve => { finish = resolve; }) });
  f.frame(); f.rerender(); f.frame(); assert.equal(f.calls.length, 1);
  finish({ response: { ok: true }, result: { ok: true } }); await settle();
  assert.equal(f.lastRead.current, 2); assert.equal(f.refreshed(), 1);
  f.list.dispatchEvent(new Event('scroll')); assert.equal(f.calls.length, 1); f.cleanup();
});

test('failed read ACK remains retryable and a late response after unmount cannot confirm state', async () => {
  const failed = visibleFixture({ result: { response: { ok: false }, result: { ok: false } } });
  failed.frame(); await settle(); assert.equal(failed.lastRead.current, 0);
  failed.list.dispatchEvent(new Event('scroll')); await settle(); assert.equal(failed.calls.length, 2); failed.cleanup();
  let finish;
  const f = visibleFixture({ result: new Promise(resolve => { finish = resolve; }) });
  f.frame(); f.cleanup(); finish({ response: { ok: true }, result: { ok: true } }); await settle();
  assert.equal(f.lastRead.current, 0); assert.equal(f.refreshed(), 0);
});
