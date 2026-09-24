import assert from 'node:assert/strict';
import test from 'node:test';
import { text, nodes, catalogue, masterForm, button, edit, flush, harness } from './helpers/creditex-master-editor-fixture.mjs';

const phone = tree => nodes(tree, node => node.type === 'phone-preview')[0].props.form;
const map = tree => nodes(tree, node => node.type === 'form-mind-map')[0];
const input = (tree, value) => nodes(tree, node => node.type === 'input' && node.props.value === value)[0];
async function opened(options = {}) {
  const h = harness({ respond: async (path, init) => init?.method === 'POST'
    ? { form: JSON.parse(init.body).form, expectedVersion: 3 }
    : path.includes('activityTemplateId') ? { form: masterForm, expectedVersion: 2 } : { catalogue }, ...options });
  const tree = await h.mount();
  nodes(tree, node => node.type === 'button' && /^(Edit|Preview) VEU/.test(node.props['aria-label'] || ''))[0].props.onClick();
  await flush();
  return h;
}

test('typing is one undo step, restores saved state and supports a new edit branch', async () => {
  const h = await opened(); let tree = h.render();
  assert.equal(button(tree, 'Undo').props.disabled, true);
  input(tree, 'Extra comment').props.onChange({ target: { value: 'First' } }); tree = h.render();
  input(tree, 'First').props.onChange({ target: { value: 'First draft' } }); tree = h.render();
  button(tree, 'Undo').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields[0].label, 'Extra comment');
  assert.equal(button(tree, 'Save and publish master').props.disabled, true);
  assert.equal(button(tree, 'Undo').props.disabled, true);
  button(tree, 'Redo').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields[0].label, 'First draft');
  button(tree, 'Undo').props.onClick(); tree = h.render();
  input(tree, 'Extra comment').props.onChange({ target: { value: 'Alternative' } }); tree = h.render();
  assert.equal(button(tree, 'Redo').props.disabled, true);
  assert.equal(phone(tree).fields[0].label, 'Alternative');
});

test('map deletion can be undone and redone without leaving the map or writing to the API', async () => {
  const h = await opened(); let tree = h.render();
  nodes(tree, node => node.type === 'button' && text(node).includes('TLink Mind Map'))[0].props.onClick(); tree = h.render();
  map(tree).props.onDelete('question', 'custom.comment'); tree = h.render();
  button(map(tree).props.editor, 'Confirm delete question').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields.some(field => field.key === 'custom.comment'), false);
  button(map(tree).props.historyControls, 'Undo').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields[0].key, 'custom.comment');
  assert.equal(button(tree, 'Form editor').props['aria-pressed'], false);
  assert.equal(button(tree, 'Save and publish master').props.disabled, true);
  button(map(tree).props.historyControls, 'Redo').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields.some(field => field.key === 'custom.comment'), false);
  assert.equal(h.calls.some(call => call.body), false);
});

test('saving resets history and carries only the current restored form to the API', async () => {
  const h = await opened(); let tree = h.render();
  input(tree, 'Extra comment').props.onChange({ target: { value: 'Accepted edit' } }); tree = h.render();
  button(tree, 'Save and publish master').props.onClick(); tree = h.render();
  assert.equal(button(tree, 'Undo').props.disabled, true);
  await flush(); tree = h.render();
  assert.equal(h.calls.at(-1).body.form.fields[0].label, 'Accepted edit');
  assert.equal(button(tree, 'Undo').props.disabled, true);
  assert.equal(button(tree, 'Redo').props.disabled, true);
  assert.equal(button(tree, 'Save and publish master').props.disabled, true);
  button(tree, 'Back to all forms').props.onClick(); tree = h.render();
  edit(tree).props.onClick(); await flush(); tree = h.render();
  assert.equal(phone(tree).fields[0].label, 'Extra comment');
  assert.equal(button(tree, 'Undo').props.disabled, true);
});

test('failed saving keeps undo available; read-only form has no history controls', async () => {
  const h = await opened({ respond: async (path, init) => {
    if (init?.method === 'POST') throw new Error('Save unavailable');
    return path.includes('activityTemplateId') ? { form: masterForm, expectedVersion: 2 } : { catalogue };
  } });
  let tree = h.render();
  input(tree, 'Extra comment').props.onChange({ target: { value: 'Recover me' } }); tree = h.render();
  button(tree, 'Save and publish master').props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Save unavailable/);
  assert.equal(button(tree, 'Undo').props.disabled, false);
  button(tree, 'Undo').props.onClick(); tree = h.render();
  assert.equal(phone(tree).fields[0].label, 'Extra comment');
  const readOnly = await opened({ canAuthor: false });
  assert.equal(button(readOnly.render(), 'Undo'), undefined);
  assert.equal(button(readOnly.render(), 'Redo'), undefined);
});
