import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { normalizeTradeFormAnswers, tradeFormCompletion } from '../../src/lib/trade-form-library.mjs';

const source = fs.readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
function action(name, dependencies) {
  const ast = ts.createSourceFile('job.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

test('document picking excludes double taps and clears its guard after cancellation or picker failure', async () => {
  for (const fail of [false, true]) {
    let finishPicker;
    let pickerCalls = 0;
    const alerts = [];
    const busy = [];
    const pickingDocument = { current: false };
    const choose = action('chooseDocument', {
      job: { id: 'job' }, pickingDocument, evidenceIdentifiers: () => ({}),
      evidenceBusyKey: () => 'document:general', setBusy: (value) => busy.push(value), setSavedMessage: () => {},
      ALLOWED_EVIDENCE_TYPES: new Set(['application/pdf']), DEFAULT_DOCUMENT_TYPES: ['application/pdf'],
      DocumentPicker: { getDocumentAsync: () => { pickerCalls++; return new Promise((resolve, reject) => { finishPicker = () => fail ? reject(new Error('Picker failed')) : resolve({ canceled: true }); }); } },
      Alert: { alert: (...args) => alerts.push(args) },
    });
    const first = choose();
    await choose();
    assert.equal(pickerCalls, 1);
    assert.equal(pickingDocument.current, true);
    finishPicker();
    await first;
    assert.equal(pickingDocument.current, false);
    assert.deepEqual(busy, ['document:general', '']);
    assert.equal(alerts.length, fail ? 1 : 0);
  }
});

test('time saving preserves input on failure and releases busy state', async () => {
  const busy = [];
  const alerts = [];
  let cleared = false;
  const addTime = action('addTime', {
    job: { id: 'job', revision: 4 }, duration: '60', notes: 'Work complete',
    setBusy: (value) => busy.push(value), setSavedMessage: () => {}, localWorkDate: () => '2026-09-10',
    saveAction: async () => { throw new Error('Device storage unavailable'); },
    setDuration: () => { cleared = true; }, setNotes: () => { cleared = true; },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  await addTime();
  assert.equal(cleared, false);
  assert.deepEqual(busy, ['time', '']);
  assert.equal(alerts[0][0], 'Time could not be saved');
});

test('an incomplete required form rejects the save instead of advancing its caller', async () => {
  let wrote = false;
  const save = action('saveForm', { job: { id: 'job' }, normalizeTradeFormAnswers, tradeFormCompletion, saveAction: async () => { wrote = true; } });
  await assert.rejects(save({ template: { fields: [{ key: 'name', label: 'Name', required: true, type: 'text' }] } }, { name: ' ' }, true), /Finish the required fields: Name/);
  assert.equal(wrote, false);
});


function renderJobCard(title, overrides = {}) {
  const ast = ts.createSourceFile('job.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let card;
  function find(node) {
    if (ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.card}>'
      && node.children.some(child => ts.isJsxElement(child) && child.getText(ast).includes('>' + title + '</Text>'))) card = node;
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(card, title);
  const destinations = [];
  const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
  const dependencies = { React: { createElement: jsx, Fragment: 'Fragment' }, View: 'View', Text: 'Text', TextInput: 'TextInput', FieldButton: 'FieldButton', Pressable: 'Pressable',
    FieldSwmsFiles: 'FieldSwmsFiles', styles: {}, job: { id: 'job', media: [] }, busy: '', syntheticManual: false, complianceCases: [], creditexManual: false,
    sync: { online: true }, duration: '', notes: '', setDuration() {}, setNotes() {}, setActiveFormId: value => destinations.push(value), ...overrides };
  const code = ts.transpileModule('const tree = (' + card.getText(ast) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const tree = Function(...Object.keys(dependencies), code + ';return tree;')(...Object.values(dependencies));
  const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
  const label = value => Array.isArray(value) ? value.map(label).join('') : value && typeof value === 'object' ? label(value.props?.children) : typeof value === 'string' ? value : '';
  return { destinations, button: name => flatten(tree).find(node => node.type === 'FieldButton' && label(node) === name) };
}

test('job actions prioritise Files while optional manual time lives inside Files', () => {
  const overview = renderJobCard('Job actions');
  assert.equal(overview.button('Record time'), undefined);
  assert.equal(overview.button('Add manual time'), undefined);
  overview.button('Files').props.onPress(); assert.deepEqual(overview.destinations, ['files']);
  const files = renderJobCard('Photos and documents');
  files.button('Add manual time').props.onPress(); assert.deepEqual(files.destinations, ['time']);
  assert.equal(renderJobCard('Photos and documents', { creditexManual: true }).button('Add manual time'), undefined);
  const time = renderJobCard('Add manual time');
  time.button('Back to Files').props.onPress(); assert.deepEqual(time.destinations, ['files']);
});
