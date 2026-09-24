import test from "node:test";
import assert from "node:assert/strict";
import { text, nodes, catalogue, masterForm, edit, flush, harness } from "./helpers/creditex-master-editor-fixture.mjs";

const question = (key, section, extra = {}) => ({ key, section, label: key, type: "text", phase: "after", required: false, options: [], help: "", ...extra });
const base = () => ({ ...structuredClone(masterForm), fields: [question("custom.first", "Review"), question("custom.second", "Review"), question("custom.third", "Extras")], declarations: [] });
const phone = tree => nodes(tree, node => node.type === "phone-preview")[0];
const normalText = value => text(value).replace(/\s+/g, " ").trim();
const button = (tree, label) => nodes(tree, node => node.type === "button" && normalText(node) === label)[0];
const control = (tree, label, tag = "input") => {
  const container = nodes(tree, node => node.type === "label" && normalText((Array.isArray(node.props.children) ? node.props.children : [node.props.children]).filter(child => !["input", "select", "textarea"].includes(child?.type))) === label)[0];
  assert.ok(container, `${label} is displayed`);
  const input = nodes(container, node => node.type === tag)[0]; assert.ok(input, `${label} has a ${tag}`); return input;
};
const options = select => nodes(select, node => node.type === "option");
const posts = h => h.calls.filter(call => call.body).map(call => call.body);
async function click(h, tree, label) {
  const target = button(tree, label); assert.ok(target, `${label} is displayed`); assert.ok(!target.props.disabled, `${label} is enabled`);
  target.props.onClick(); await flush(); return h.render();
}
function fixture({ form = base(), canAuthor = true, openAsDraft = false, normalizeSavedForm = form => form } = {}) {
  let savedForm = structuredClone(form);
  let revision = 1;
  const copy = () => ({ id: "page-draft", activityTemplateId: savedForm.activityTemplateId, variantId: savedForm.variantId, title: savedForm.title,
    revision, baseMasterVersion: 2, currentMasterVersion: 2, baseIsCurrent: true, status: "draft", createdAt: "2026-09-24T01:00:00Z", updatedAt: "2026-09-24T01:00:00Z", form: structuredClone(savedForm) });
  const h = harness({ canAuthor, actorMode: "creditex", respond: async (path, init) => {
    const query = new URL(path, "https://test.invalid").searchParams;
    if (init?.body) {
      const body = JSON.parse(init.body);
      assert.equal(body.action, "save_master_draft", "page work stays in the saved draft until explicitly published");
      assert.equal(body.draftId, "page-draft"); assert.equal(body.expectedRevision, revision);
      savedForm = normalizeSavedForm(structuredClone(body.form)); revision++; return { draft: copy() };
    }
    if (query.get("view") === "master_drafts") return { draft: copy() };
    if (query.has("activityTemplateId")) return { form: structuredClone(form), expectedVersion: 2 };
    return { catalogue, drafts: openAsDraft ? [copy()] : [] };
  } });
  return { h, async open() {
    let tree = await h.mount();
    if (openAsDraft) return click(h, tree, canAuthor ? "Continue draft" : "Preview draft");
    const target = canAuthor ? edit(tree) : nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Preview VEU 6: Heating and cooling")[0];
    assert.ok(target); target.props.onClick(); await flush(); tree = h.render(); return tree;
  } };
}

test("the Pages selector opens the selected page and synchronises the phone selection", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open();
  assert.match(text(tree), /Pages/);
  const pages = control(tree, "Page to edit", "select");
  const extras = options(pages).find(option => /Extras/.test(text(option))); assert.ok(extras);
  pages.props.onChange({ target: { value: String(extras.props.value) } }); tree = h.render();
  assert.equal(phone(tree).props.selectedFieldKey, "custom.third");
  assert.deepEqual(posts(h), []);
});

test("Add page creates a distinct page with one editable question and selects it", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open();
  const before = phone(tree).props.form;
  tree = await click(h, tree, "Add page");
  const next = phone(tree).props.form;
  const added = next.fields.filter(field => !before.fields.some(previous => previous.key === field.key));
  assert.equal(added.length, 1); assert.match(added[0].key, /^custom\./);
  assert.ok(!before.fields.some(field => field.section === added[0].section));
  assert.equal(phone(tree).props.selectedFieldKey, added[0].key);
  tree = await click(h, tree, "Add page");
  const newest = phone(tree).props.form.fields.filter(field => !next.fields.some(previous => previous.key === field.key));
  assert.equal(newest.length, 1); assert.notEqual(newest[0].section, added[0].section);
  assert.deepEqual(posts(h), []);
});

test("Add question stays in the selected page and respects the eight-question page limit", async () => {
  const form = { ...base(), fields: [...Array.from({ length: 7 }, (_, index) => question(`custom.question-${index}`, "Review")), question("custom.other", "Extras")] };
  const f = fixture({ form }); const { h } = f; let tree = await f.open();
  tree = await click(h, tree, "Add question");
  const next = phone(tree).props.form; const added = next.fields.find(field => !form.fields.some(previous => previous.key === field.key));
  assert.ok(added); assert.equal(added.section, "Review"); assert.equal(added.phase, "after"); assert.equal(phone(tree).props.selectedFieldKey, added.key);
  assert.equal(next.fields.filter(field => field.section === "Review").length, 8);
  assert.equal(button(tree, "Add question").props.disabled, true);
  assert.equal(button(tree, "Add page").props.disabled, false);
});

test("renaming a page changes its questions together without changing the form title or other pages", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open();
  const initial = phone(tree).props.form;
  tree = await click(h, tree, "Rename page");
  assert.equal(control(tree, "Page name").props.value, "Review");
  control(tree, "Page name").props.onChange({ target: { value: "  Installation review  " } }); tree = h.render();
  tree = await click(h, tree, "Apply page name");
  const renamed = phone(tree).props.form;
  assert.equal(renamed.title, initial.title);
  assert.deepEqual(renamed.fields.map(field => [field.key, field.section]), [["custom.first", "Installation review"], ["custom.second", "Installation review"], ["custom.third", "Extras"]]);
  assert.equal(phone(tree).props.selectedFieldKey, "custom.first");
  assert.ok(options(control(tree, "Page to edit", "select")).some(option => /Installation review/.test(text(option))));
  assert.equal(button(tree, "Apply page name"), undefined);
  assert.deepEqual(posts(h), []);
});

test("cancelled page names and removal confirmations preserve the form", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open();
  const initial = structuredClone(phone(tree).props.form);
  tree = await click(h, tree, "Rename page");
  control(tree, "Page name").props.onChange({ target: { value: "Abandoned name" } }); tree = h.render();
  tree = await click(h, tree, "Cancel rename");
  tree = await click(h, tree, "Delete page"); tree = await click(h, tree, "Keep page");
  tree = await click(h, tree, "Delete question"); tree = await click(h, tree, "Keep question");
  assert.deepEqual(phone(tree).props.form, initial);
  assert.equal(button(tree, "Confirm delete question"), undefined);
  assert.equal(button(tree, "Confirm delete page"), undefined);
  assert.deepEqual(posts(h), []);
});

test("moving a question changes only its page and keeps that question selected in the editor and phone", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open();
  const initial = structuredClone(phone(tree).props.form.fields.find(field => field.key === "custom.first"));
  const move = control(tree, "Move to page", "select");
  const destination = options(move).find(option => /Extras/.test(text(option))); assert.ok(destination); assert.ok(!destination.props.disabled);
  move.props.onChange({ target: { value: String(destination.props.value) } }); tree = h.render();
  const moved = phone(tree).props.form.fields.find(field => field.key === "custom.first");
  assert.deepEqual(moved, { ...initial, section: "Extras" });
  assert.deepEqual(phone(tree).props.form.fields.filter(field => field.section === "Review").map(field => field.key), ["custom.second"]);
  assert.equal(phone(tree).props.selectedFieldKey, "custom.first");
  const picker = control(tree, "Page to edit", "select");
  assert.match(text(options(picker).find(option => option.props.value === picker.props.value)), /Extras/);
  assert.equal(control(tree, "Question").props.value, "custom.first");
  assert.deepEqual(posts(h), []);
});

test("move destinations stay within the question stage and repeated item, and full pages are disabled", async () => {
  const form = { ...base(), fields: [question("custom.source", "Source"), question("custom.open", "Open page"),
    question("custom.before", "Before-only page", { phase: "before" }),
    question("custom.unit", "Repeated-only page", { repeatGroup: "equipment" }),
    ...Array.from({ length: 8 }, (_, index) => question(`custom.full-${index}`, "Full page"))] };
  const f = fixture({ form }); const { h } = f; let tree = await f.open();
  phone(tree).props.onSelectField("custom.source"); tree = h.render();
  const destinations = options(control(tree, "Move to page", "select"));
  assert.ok(destinations.some(option => /Open page/.test(text(option)) && !option.props.disabled));
  assert.ok(!destinations.some(option => /Before-only|Repeated-only/.test(text(option))));
  const full = destinations.find(option => /Full page/.test(text(option))); assert.ok(full); assert.equal(full.props.disabled, true);
  assert.equal(phone(tree).props.form.fields.length, form.fields.length); assert.deepEqual(posts(h), []);
});

test("deleting a question requires inline confirmation and leaves other questions intact", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open(); h.setConfirm(false);
  tree = await click(h, tree, "Delete question");
  assert.equal(phone(tree).props.form.fields.length, 3); assert.ok(button(tree, "Confirm delete question"));
  tree = await click(h, tree, "Confirm delete question");
  assert.deepEqual(phone(tree).props.form.fields.map(field => field.key), ["custom.second", "custom.third"]);
  assert.ok(phone(tree).props.form.fields.some(field => field.key === phone(tree).props.selectedFieldKey));
  assert.deepEqual(posts(h), []);
});

test("deleting a signing item requires inline confirmation and updates the phone selection", async () => {
  const form = { ...base(), declarations: [structuredClone(masterForm.declarations[0])] };
  const f = fixture({ form }); const { h } = f; let tree = await f.open(); h.setConfirm(false);
  phone(tree).props.onSelectDeclaration("custom.confirmation"); tree = h.render();
  tree = await click(h, tree, "Delete signature"); assert.equal(phone(tree).props.form.declarations.length, 1);
  tree = await click(h, tree, "Confirm delete signature");
  assert.deepEqual(phone(tree).props.form.declarations, []); assert.equal(phone(tree).props.selectedDeclarationKey, undefined);
  assert.ok(phone(tree).props.selectedFieldKey); assert.deepEqual(posts(h), []);
});

test("deleting a page confirms the question count and removes only the selected eligible page", async () => {
  const f = fixture(); const { h } = f; let tree = await f.open(); h.setConfirm(false);
  tree = await click(h, tree, "Delete page");
  assert.equal(phone(tree).props.form.fields.length, 3);
  const confirmation = nodes(tree, node => node.props?.role === "alert" && button(node, "Confirm delete page"))[0];
  assert.ok(confirmation); assert.match(normalText(confirmation), /removes the page and its 2 questions/);
  assert.deepEqual(nodes(confirmation, node => node.type === "li").map(normalText), ["custom.first", "custom.second"]);
  tree = await click(h, tree, "Confirm delete page");
  assert.deepEqual(phone(tree).props.form.fields.map(field => field.key), ["custom.third"]);
  assert.equal(phone(tree).props.selectedFieldKey, "custom.third"); assert.deepEqual(posts(h), []);
});

test("governed questions and pages cannot be deleted and the editor explains the restriction", async () => {
  const form = { ...base(), fields: [question("required.photo", "Required evidence", { type: "photo", required: true, sourceRequirementId: "official-photo" }), question("custom.other", "Extras")] };
  const f = fixture({ form }); const { h } = f; const tree = await f.open();
  assert.equal(button(tree, "Delete question").props.disabled, true); assert.equal(button(tree, "Delete page").props.disabled, true);
  assert.match(text(tree), /governed|regulator|required evidence/i);
  assert.equal(phone(tree).props.form.fields.length, 2); assert.deepEqual(posts(h), []);
});

test("questions used by routing elsewhere cannot be deleted individually or with their page", async () => {
  const form = { ...base(), fields: [question("custom.source", "Source"), question("custom.dependent", "Elsewhere", { condition: { fieldKey: "custom.source", equals: "yes" } })] };
  const f = fixture({ form }); const { h } = f; const tree = await f.open();
  assert.equal(button(tree, "Delete question").props.disabled, true); assert.equal(button(tree, "Delete page").props.disabled, true);
  assert.match(text(tree), /routing|linked|reference/i); assert.deepEqual(posts(h), []);
});

test("page edits survive saving and reopening their draft without publishing the source form", async () => {
  const f = fixture({ openAsDraft: true }); const { h } = f; let tree = await f.open();
  tree = await click(h, tree, "Add page"); const newKey = phone(tree).props.selectedFieldKey;
  control(tree, "Question").props.onChange({ target: { value: "Remember this page question" } }); tree = h.render();
  tree = await click(h, tree, "Rename page");
  control(tree, "Page name").props.onChange({ target: { value: "Retained draft page" } }); tree = h.render();
  tree = await click(h, tree, "Apply page name");
  const newPage = phone(tree).props.form.fields.find(field => field.key === newKey).section;
  assert.equal(newPage, "Retained draft page");
  tree = await click(h, tree, "Save draft");
  tree = await click(h, tree, "Back to all forms"); tree = await click(h, tree, "Continue draft");
  const retained = phone(tree).props.form.fields.find(field => field.key === newKey);
  assert.ok(retained); assert.equal(retained.section, newPage); assert.equal(retained.label, "Remember this page question");
  assert.deepEqual(posts(h).map(body => body.action), ["save_master_draft"]);
});

test("saving retains the selected question by stable key when the server returns reordered fields", async () => {
  const f = fixture({ openAsDraft: true, normalizeSavedForm: form => ({ ...form, fields: [form.fields[2], form.fields[0], form.fields[1]] }) });
  const { h } = f; let tree = await f.open();
  phone(tree).props.onSelectField("custom.third"); tree = h.render();
  control(tree, "Question").props.onChange({ target: { value: "Keep editing this question" } }); tree = h.render();
  const selectedKey = phone(tree).props.selectedFieldKey;
  const previousIndex = phone(tree).props.form.fields.findIndex(field => field.key === selectedKey);
  tree = await click(h, tree, "Save draft");
  const returnedIndex = phone(tree).props.form.fields.findIndex(field => field.key === selectedKey);
  assert.notEqual(returnedIndex, previousIndex, "the saved server response actually reordered the selected question");
  assert.equal(phone(tree).props.selectedFieldKey, selectedKey);
  assert.equal(control(tree, "Question").props.value, "Keep editing this question");
  const pagePicker = control(tree, "Page to edit", "select");
  assert.match(text(options(pagePicker).find(option => option.props.value === pagePicker.props.value)), /Extras/);
  assert.deepEqual(posts(h).map(body => body.action), ["save_master_draft"]);
});

test("read-only members can select pages and signing items while mutation controls remain unavailable", async () => {
  const form = { ...base(), declarations: [structuredClone(masterForm.declarations[0])] };
  const f = fixture({ form, canAuthor: false }); const { h } = f; let tree = await f.open();
  const pagePicker = control(tree, "Page to preview", "select");
  assert.ok(!pagePicker.props.disabled);
  const extras = options(pagePicker).find(option => /Extras/.test(text(option))); assert.ok(extras);
  pagePicker.props.onChange({ target: { value: String(extras.props.value) } }); tree = h.render();
  assert.equal(phone(tree).props.selectedFieldKey, "custom.third"); assert.equal(phone(tree).props.canEdit, false);
  for (const label of ["Add page", "Add question", "Rename page", "Delete page", "Delete question"]) {
    const target = button(tree, label);
    if (target) assert.ok(target.props.disabled || nodes(tree, node => node.type === "fieldset" && node.props.disabled).some(fieldset => nodes(fieldset, node => node === target).length), `${label} must be unavailable`);
  }
  phone(tree).props.onSelectDeclaration("custom.confirmation"); tree = h.render();
  assert.equal(phone(tree).props.selectedDeclarationKey, "custom.confirmation");
  const deletion = button(tree, "Delete signature");
  if (deletion) assert.ok(deletion.props.disabled || nodes(tree, node => node.type === "fieldset" && node.props.disabled).some(fieldset => nodes(fieldset, node => node === deletion).length));
  assert.deepEqual(posts(h), []);
});
