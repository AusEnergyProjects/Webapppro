import assert from "node:assert/strict";
import test from "node:test";
import {
  createEditorFormHistory, changeEditorFormHistory, endEditorFormHistoryGroup,
  undoEditorFormHistory, redoEditorFormHistory,
} from "../src/lib/creditex-form-history.ts";

const field = (key, extra = {}) => ({ key, label: key, section: "Checks", phase: "before", type: "boolean",
  required: false, options: [], help: "", ...extra });
const fixture = () => ({ id: "history", title: "Creditex form", version: 1, activityTemplateId: "test", programCode: "TEST",
  variantId: "", variantOptions: [], fields: [field("custom.answer"), field("custom.followup", { section: "Details",
    condition: { fieldKey: "custom.answer", equals: false } })], declarations: [{ key: "custom.signature", title: "Confirm",
    text: "I agree.", role: "customer", phase: "after", required: false, sourceUrl: "", sourceTextSha256: "" }],
  sources: [], reviewNotes: [] });
const withLabel = (form, label) => ({ ...form, fields: form.fields.map((item, index) => index === 0 ? { ...item, label } : item) });
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("deleting a page and signature can be undone and redone without mutating snapshots", () => {
  const original = freeze(fixture());
  const initial = freeze(createEditorFormHistory(original));
  const deleted = freeze({ ...original, fields: original.fields.slice(0, 1), declarations: [] });
  const changed = freeze(changeEditorFormHistory(initial, deleted));
  const undone = freeze(undoEditorFormHistory(changed));
  assert.equal(undone.form, original);
  assert.equal(undone.savedForm, original);
  assert.equal(undone.dirty, false);
  assert.equal(redoEditorFormHistory(undone).form, deleted);
  assert.equal(changed.form.fields.length, 1);
  assert.equal(initial.past.length, 0);
  assert.equal(original.fields.length, 2);
  assert.equal(original.declarations.length, 1);
});

test("answer branches, page membership and question ordering restore as one discrete edit each", () => {
  const original = fixture();
  const connected = { ...original, fields: original.fields.map((item, index) => index === 1
    ? { ...item, condition: { fieldKey: "custom.answer", equals: true } } : item) };
  const moved = { ...connected, fields: connected.fields.map(item => ({ ...item, section: "One page" })) };
  const reordered = { ...moved, fields: [...moved.fields].reverse() };
  let history = createEditorFormHistory(original);
  for (const form of [connected, moved, reordered]) history = changeEditorFormHistory(history, form);
  assert.equal(history.past.length, 3);
  for (const form of [moved, connected, original]) { history = undoEditorFormHistory(history); assert.deepEqual(history.form, form); }
  for (const form of [connected, moved, reordered]) { history = redoEditorFormHistory(history); assert.deepEqual(history.form, form); }
});

test("consecutive typing coalesces until blur, a different group or a discrete change", () => {
  const original = fixture();
  let history = createEditorFormHistory(original);
  for (const label of ["A", "An", "Answer"]) history = changeEditorFormHistory(history, withLabel(history.form, label), "label:answer");
  assert.equal(history.past.length, 1);
  assert.equal(undoEditorFormHistory(history).form, original);
  history = endEditorFormHistoryGroup(history);
  history = changeEditorFormHistory(history, withLabel(history.form, "Answer now"), "label:answer");
  assert.equal(history.past.length, 2);
  history = changeEditorFormHistory(history, { ...history.form, title: "Renamed" }, "title");
  assert.equal(history.past.length, 3);
  history = changeEditorFormHistory(history, { ...history.form, declarations: [] });
  assert.equal(history.past.length, 4);
  assert.equal(history.group, "");
  history = changeEditorFormHistory(history, { ...history.form, title: "Renamed again" }, "title");
  assert.equal(history.past.length, 5);
});

test("dirty follows content against the saved baseline through edits, undo and redo", () => {
  const original = fixture();
  let history = changeEditorFormHistory(createEditorFormHistory(original), withLabel(original, "Changed"));
  assert.equal(history.dirty, true);
  history = changeEditorFormHistory(history, structuredClone(original));
  assert.equal(history.dirty, false);
  history = undoEditorFormHistory(history);
  assert.equal(history.dirty, true);
  assert.equal(history.group, "");
  history = redoEditorFormHistory(history);
  assert.equal(history.dirty, false);
  assert.equal(history.savedForm, original);
});

test("editing after undo drops redo and starts a new step even with the previous typing group", () => {
  const original = fixture();
  let history = changeEditorFormHistory(createEditorFormHistory(original), withLabel(original, "Old branch"), "label");
  history = undoEditorFormHistory(history);
  assert.equal(history.future.length, 1);
  history = changeEditorFormHistory(history, withLabel(original, "New branch"), "label");
  assert.equal(history.future.length, 0);
  assert.equal(history.past.length, 1);
  assert.equal(undoEditorFormHistory(history).form, original);
  assert.equal(redoEditorFormHistory(history).form.fields[0].label, "New branch");
  assert.equal(redoEditorFormHistory(history).group, "");
});

test("identical content is a no-op that preserves redo, dirty state and typing group", () => {
  const original = fixture();
  let history = changeEditorFormHistory(createEditorFormHistory(original), withLabel(original, "Changed"), "label");
  assert.equal(changeEditorFormHistory(history, structuredClone(history.form), "other"), history);
  history = undoEditorFormHistory(history);
  const reorderedProperties = Object.fromEntries(Object.entries(structuredClone(history.form)).reverse());
  assert.equal(changeEditorFormHistory(history, reorderedProperties, "new group"), history);
  assert.equal(history.future.length, 1);
  assert.equal(history.dirty, false);
  assert.equal(redoEditorFormHistory(history).dirty, true);
});

test("history caps past at 100 edits while retaining the original saved baseline", () => {
  const original = fixture();
  let history = createEditorFormHistory(original);
  for (let index = 1; index <= 105; index++) history = changeEditorFormHistory(history, { ...history.form, title: `Revision ${index}` });
  assert.equal(history.past.length, 100);
  assert.equal(history.savedForm, original);
  for (let index = 0; index < 100; index++) history = undoEditorFormHistory(history);
  assert.equal(history.form.title, "Revision 5");
  assert.equal(history.dirty, true);
  assert.equal(undoEditorFormHistory(history), history);
  for (let index = 0; index < 100; index++) history = redoEditorFormHistory(history);
  assert.equal(history.form.title, "Revision 105");
  assert.equal(history.past.length, 100);
  assert.equal(history.future.length, 0);
});

test("load or successful save resets history; empty history operations are safe", () => {
  const empty = createEditorFormHistory(null);
  assert.equal(empty.form, null);
  assert.equal(empty.savedForm, null);
  assert.equal(empty.dirty, false);
  assert.equal(undoEditorFormHistory(empty), empty);
  assert.equal(redoEditorFormHistory(empty), empty);
  assert.equal(endEditorFormHistoryGroup(empty), empty);
  const original = fixture();
  let history = changeEditorFormHistory(createEditorFormHistory(original), withLabel(original, "Saved edit"), "label");
  history = createEditorFormHistory(history.form);
  assert.equal(history.dirty, false);
  assert.equal(history.form, history.savedForm);
  assert.deepEqual(history.past, []);
  assert.deepEqual(history.future, []);
  assert.equal(history.group, "");
  assert.equal(undoEditorFormHistory(history), history);
});
