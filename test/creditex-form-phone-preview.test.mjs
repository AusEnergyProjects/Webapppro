import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import { activityFieldWorkerForm } from '../src/lib/trade-activity-field-policy.ts';

const source = readFileSync(new URL('../src/components/CreditexFormPhonePreview.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const field = (key, type = 'text', extra = {}) => ({ key, type, label: key, section: 'Equipment', phase: 'after', required: true, options: [], help: '', ...extra });
const form = (fields) => ({ id: 'preview-test', version: 1, activityTemplateId: 'preview-test', variantId: 'default', programCode: 'VEU', title: 'Synthetic test form', sources: [], reviewNotes: [], variantOptions: [], fields, declarations: [] });

// Execute the actual component and event handlers with deterministic hook storage.
// Browser checks separately cover CSS, focus controls and rendering in the editor.
function preview(props) {
  const state = [];
  let cursor = 0;
  let changed = false;
  const exports = {};
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; changed = true; }];
    },
    useRef: () => ({ current: null }), useEffect: () => {}, useMemo: (run) => run(), useId: () => 'phone-test',
  };
  const element = (type, props) => ({ type, props: props || {} });
  new Function('exports', 'require', compiled)(exports, (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'fragment' };
    if (name.endsWith('trade-activity-form-flow')) return flow;
    if (name.endsWith('trade-activity-field-policy')) return { activityFieldWorkerForm };
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name.endsWith('TradeWorkPackSignaturePad')) return { TradeWorkPackSignaturePad: 'signature-pad' };
    throw new Error(`Unexpected preview dependency: ${name}`);
  });
  let tree;
  const nodes = (root) => Array.isArray(root) ? root.flatMap(nodes) : root && typeof root === 'object'
    ? [root, ...nodes(root.props?.children)] : [];
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object'
    ? text(node.props?.children) : node === undefined || node === null || typeof node === 'boolean' ? '' : String(node);
  const render = () => {
    let renders = 0;
    do { changed = false; cursor = 0; tree = exports.CreditexFormPhonePreview(props); } while (changed && ++renders < 5);
    assert.ok(renders < 5, 'preview stabilises after selection changes');
    return tree;
  };
  render();
  return {
    text: (node = tree) => text(node), nodes: () => nodes(tree),
    update(next) { props = { ...props, ...next }; render(); },
    button(label) { return nodes(tree).find((node) => node.type === 'button' && text(node) === label); },
    click(label) { const button = this.button(label); assert.ok(button, `button ${label} exists`); assert.ok(!button.props.disabled); button.props.onClick(); render(); },
    answer(key, value) { const control = nodes(tree).find((node) => ['input', 'select'].includes(node.type) && node.props.id === `phone-test-${key}`); assert.ok(control, `answer control ${key} exists`); control.props.onChange({ target: { value } }); render(); },
    jump(key) { this.answer('page', key); },
  };
}

test('phone uses the actual worker projection including capacity labels and office-only fields', () => {
  const raw = { ...form([field('installed_product.indoor_heating_kw', 'number', { label: 'Old indoor capacity', condition: { fieldKey: 'multi', equals: true } }), field('benefit_payment.gross_price')]), activityTemplateId: 'veu-6' };
  const view = preview({ form: raw });
  assert.match(view.text(), /Total installed heating capacity \(kW\)/);
  assert.doesNotMatch(view.text(), /Old indoor capacity|benefit_payment.gross_price/);
  assert.equal(raw.fields[0].label, 'Old indoor capacity', 'projection never mutates the editable draft');
});

test('unsaved edits update labels and discard answers made invalid by option changes', () => {
  const draft = form([field('choice', 'select', { label: 'Original question', options: ['yes', 'no'] })]);
  const view = preview({ form: draft });
  view.answer('choice', 'yes');
  view.update({ form: { ...draft, fields: [{ ...draft.fields[0], label: 'Changed question', options: ['other'] }] } });
  assert.match(view.text(), /Changed question/);
  assert.doesNotMatch(view.text(), /Original question/);
  view.click('Check these answers');
  assert.match(view.text(), /Complete this required question/);
});

test('conditional routing follows test answers while next always works with empty required answers', () => {
  const view = preview({ form: form([field('installed', 'boolean'), field('serial', 'text', { condition: { fieldKey: 'installed', equals: true } })]) });
  assert.doesNotMatch(view.text(), /serial/);
  view.click('Next');
  assert.match(view.text(), /required items remain in this test/);
  view.jump('installed');
  view.click('Check these answers');
  assert.match(view.text(), /Complete this required question/);
  view.click('Yes');
  assert.match(view.text(), /serial/);
  view.answer('serial', 'UNIT-001');
  view.click('Next');
  assert.match(view.text(), /Every visible required item is complete/);
  view.jump('installed');
  view.click('No');
  assert.doesNotMatch(view.text(), /serial/);
});

test('removing a repeat preserves same-index evidence in another repeat group', () => {
  const view = preview({ form: form([field('unitPhoto', 'photo', { repeatGroup: 'units' }), field('roomPhoto', 'photo', { repeatGroup: 'rooms', section: 'Rooms' })]) });
  view.click('Add test photo'); view.click('Add another unit'); view.click('Add test photo');
  view.jump('roomPhoto'); view.click('Add test photo'); view.click('Add another room'); view.click('Add test photo');
  view.jump('unitPhoto[1]'); view.click('Remove last unit');
  view.jump('roomPhoto[1]');
  assert.ok(view.button('Remove test photo'), 'room evidence survives unit removal');
  view.jump('unitPhoto'); view.click('Add another unit');
  assert.ok(view.button('Add test photo'), 'removed unit evidence is gone when adding the item again');
});

test('reset clears test answers, evidence and repeating items without saving anything', () => {
  const view = preview({ form: form([field('serial', 'text', { repeatGroup: 'units' }), field('photo', 'photo', { repeatGroup: 'units' })]) });
  view.answer('serial', 'TEST-1'); view.click('Add test photo'); view.click('Add another unit');
  view.click('Reset test');
  assert.ok(view.button('Add test photo'));
  assert.equal(view.button('Remove last unit'), undefined);
  assert.equal(view.nodes().find((node) => node.props.id === 'phone-test-serial').props.value, '');
  assert.match(view.text(), /Test answers stay in this preview/);
});

test('read-only selection remains interactive without offering editing or bypassing normal routing', () => {
  const selected = [];
  const draft = form([field('installed', 'boolean'), field('serial', 'text', { condition: { fieldKey: 'installed', equals: true } })]);
  const view = preview({ form: draft, selectedFieldKey: 'serial', canEdit: false, onSelectField: (key) => selected.push(key) });
  assert.match(view.text(), /hidden by its current routing/);
  view.click('Inspect selected question');
  assert.match(view.text(), /Question inspection/);
  view.click('Select this question');
  assert.deepEqual(selected, ['serial']);
  assert.equal(view.button('Edit this question'), undefined);
  view.click('Return to form flow');
  assert.doesNotMatch(view.text(), /Question inspection/);
});

test('selecting another question tracks its page while preserving test answers', () => {
  const draft = form([field('first'), field('last', 'text', { section: 'Last' })]);
  const view = preview({ form: draft, selectedFieldKey: 'first' });
  view.answer('first', 'Keep my test answer');
  view.update({ selectedFieldKey: 'last' });
  assert.ok(view.nodes().some((node) => node.props.id === 'phone-test-last'));
  view.update({ selectedFieldKey: 'first' });
  assert.equal(view.nodes().find((node) => node.props.id === 'phone-test-first').props.value, 'Keep my test answer');
});

test('preview next skips required declarations and signatures without entering test data', () => {
  const draft = { ...form([field('requiredAnswer')]), declarations: [{ key: 'sign', title: 'Customer declaration', text: 'Test declaration wording.', role: 'customer', phase: 'after', required: true, sourceUrl: '', sourceTextSha256: '' }] };
  const view = preview({ form: draft });
  view.click('Next');
  assert.match(view.text(), /Customer declaration/);
  view.click('Next');
  assert.match(view.text(), /2 required items remain in this test/);
  assert.match(view.text(), /Nothing is saved, signed or submitted/);
});
