import test from "node:test";
import assert from "node:assert/strict";
import { text, nodes, catalogue, masterForm, button, edit, flush, harness } from "./helpers/creditex-master-editor-fixture.mjs";

const clone = value => structuredClone(value);
const draft = (overrides = {}) => ({ id: "draft-copy-1", activityTemplateId: "veu-6", variantId: "", title: "Heating draft", revision: 1, baseMasterVersion: 2,
  status: "draft", createdAt: "2026-09-24T01:00:00Z", updatedAt: "2026-09-24T01:00:00Z", currentMasterVersion: 2, baseIsCurrent: true,
  form: { ...clone(masterForm), title: "Heating draft" }, ...overrides });
const phone = tree => nodes(tree, node => node.type === "phone-preview")[0];
const control = (tree, label, tag = "input") => {
  const container = nodes(tree, node => node.type === "label" && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children) === label)[0];
  assert.ok(container, `${label} is displayed`);
  const input = nodes(container, node => node.type === tag)[0]; assert.ok(input, `${label} has a ${tag}`); return input;
};
const posts = h => h.calls.filter(call => call.body).map(call => call.body);
async function click(h, tree, label) {
  const target = button(tree, label); assert.ok(target, `${label} is displayed`); assert.ok(!target.props.disabled, `${label} is enabled`);
  target.props.onClick(); await flush(); return h.render();
}
function fixture({ canAuthor = true, initialDrafts = [draft()], saveError = "", publishError = "", createError = "", publishedForm = masterForm } = {}) {
  let published = clone(publishedForm);
  const saved = new Map(initialDrafts.map(value => [value.id, clone(value)]));
  const h = harness({ actorMode: "creditex", canAuthor, respond: async (path, init) => {
    const url = new URL(path, "https://test.invalid");
    if (!init?.body) {
      if (url.searchParams.get("view") === "master_drafts") return { draft: clone(saved.get(url.searchParams.get("draftId"))) };
      if (url.searchParams.has("activityTemplateId")) return { form: clone(published), expectedVersion: published.version };
      return { catalogue, drafts: [...saved.values()].map(clone) };
    }
    const body = JSON.parse(init.body);
    if (body.action === "create_master_draft") {
      if (createError) throw new Error(createError);
      const form = body.startFrom === "activity_template" ? { ...clone(masterForm), title: body.title } : clone(published);
      const copy = draft({ id: "created-copy", title: form.title, form }); saved.set(copy.id, copy); return { draft: clone(copy) };
    }
    const copy = saved.get(body.draftId);
    assert.ok(copy, "draft mutation references a known saved copy");
    assert.equal(body.expectedRevision, copy.revision, "draft mutation includes the loaded revision");
    if (body.action === "save_master_draft") {
      if (saveError) throw new Error(saveError);
      const next = { ...copy, form: clone(body.form), title: body.form.title, revision: copy.revision + 1 };
      saved.set(next.id, next); return { draft: clone(next) };
    }
    if (body.action === "publish_master_draft") {
      if (publishError) throw new Error(publishError);
      published = { ...clone(copy.form), version: published.version + 1 }; saved.delete(copy.id); return { form: clone(published), expectedVersion: published.version };
    }
    if (body.action === "discard_master_draft") { saved.delete(copy.id); return { draft: { ...clone(copy), status: "discarded" } }; }
    throw new Error(`Unexpected UI request ${body.action}`);
  } });
  return { h, saved, get published() { return published; } };
}

test("saved drafts are listed separately, can be filtered and reopen their retained form", async () => {
  const { h } = fixture(); let tree = await h.mount();
  assert.match(text(tree), /Saved drafts/); assert.match(text(tree), /Heating draft/); assert.match(text(tree), /Based on published version\s+2/);
  control(tree, "Program", "select").props.onChange({ target: { value: "SRES" } }); tree = h.render(); assert.equal(button(tree, "Continue draft"), undefined);
  tree = await click(h, tree, "Clear filters"); tree = await click(h, tree, "Continue draft");
  assert.equal(phone(tree).props.form.title, "Heating draft"); assert.match(text(tree), /Draft copy 1 \| Saved/);
  assert.match(h.requests.at(-1), /view=master_drafts&actorMode=creditex&draftId=draft-copy-1/);
  assert.deepEqual(posts(h), []);
});

test("copies of a built-in form do not advertise a nonexistent published version zero", async () => {
  const { h } = fixture({ initialDrafts: [draft({ baseMasterVersion: 0, currentMasterVersion: 0 })] });
  let tree = await h.mount(); assert.match(text(tree), /Based on built-in form/); assert.doesNotMatch(text(tree), /published version\s+0/i);
  tree = await click(h, tree, "Continue draft"); tree = await click(h, tree, "Replace published form");
  assert.doesNotMatch(text(tree), /published version\s+0/i); assert.match(text(tree), /built-in form/);
});

test("a copy closed in another session is not reopened as an editable draft", async () => {
  for (const status of ["published", "discarded"]) {
    const f = fixture(); const { h } = f; let tree = await h.mount();
    f.saved.set("draft-copy-1", draft({ status }));
    tree = await click(h, tree, "Continue draft");
    assert.match(text(tree), /already been published or discarded/);
    assert.equal(phone(tree), undefined);
    assert.deepEqual(posts(h), []);
  }
});

test("Duplicate creates a server-saved copy from the exact published version without publishing it", async () => {
  const f = fixture({ initialDrafts: [] }); const { h } = f; let tree = await h.mount();
  nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Duplicate VEU 6: Heating and cooling")[0].props.onClick();
  await flush(); tree = h.render();
  assert.deepEqual(posts(h), [{ action: "create_master_draft", actorMode: "creditex", activityTemplateId: "veu-6", variantId: "", expectedVersion: 2 }]);
  assert.equal(f.saved.size, 1); assert.equal(f.published.version, 2); assert.match(text(tree), /Draft copy saved/);
  assert.equal(button(tree, "Save draft").props.disabled, true); assert.equal(button(tree, "Replace published form").props.disabled, false);
});

test("New form creates a named activity draft directly, then supports editing, phone preview, saving and publication", async () => {
  const f = fixture({ initialDrafts: [] }); const { h } = f; let tree = await h.mount();
  tree = await click(h, tree, "New form");
  assert.match(text(tree), /required program questions and signatures/); assert.match(text(tree), /one published form/);
  assert.equal(button(tree, "Create draft").props.disabled, true);
  assert.deepEqual(nodes(control(tree, "Activity", "select"), node => node.type === "option").map(node => node.props.value), ["", "veu-6"]);
  control(tree, "Activity", "select").props.onChange({ target: { value: "veu-6" } }); await flush(); tree = h.render();
  assert.equal(button(tree, "Create draft").props.disabled, true);
  control(tree, "Form name").props.onChange({ target: { value: "  Creditex installation checks  " } }); tree = h.render();
  tree = await click(h, tree, "Create draft");
  assert.deepEqual(posts(h), [{ action: "create_master_draft", actorMode: "creditex", startFrom: "activity_template", title: "Creditex installation checks", activityTemplateId: "veu-6", variantId: "", expectedVersion: 2 }]);
  assert.match(text(tree), /New form saved as a draft/); assert.equal(phone(tree).props.form.title, "Creditex installation checks");
  assert.equal(f.published.title, masterForm.title); assert.equal(button(tree, "New form"), undefined);
  tree = await click(h, tree, "Add page");
  const newKey = phone(tree).props.selectedFieldKey; assert.match(newKey, /^custom\./);
  control(tree, "Question").props.onChange({ target: { value: "Describe any access constraints" } }); tree = h.render();
  assert.equal(phone(tree).props.form.fields.find(field => field.key === newKey).label, "Describe any access constraints");
  assert.equal(button(tree, "Replace published form").props.disabled, true);
  tree = await click(h, tree, "Save draft"); tree = await click(h, tree, "Back to all forms");
  assert.match(text(tree), /Creditex installation checks/); tree = await click(h, tree, "Continue draft");
  assert.equal(phone(tree).props.form.fields.find(field => field.key === newKey).label, "Describe any access constraints");
  tree = await click(h, tree, "Replace published form"); tree = await click(h, tree, "Confirm replacement");
  assert.equal(f.published.title, "Creditex installation checks"); assert.equal(f.published.fields.find(field => field.key === newKey).label, "Describe any access constraints");
  assert.deepEqual(posts(h).map(body => body.action), ["create_master_draft", "save_master_draft", "publish_master_draft"]);
  assert.match(text(tree), /retained signed records keep their original form/);
});

test("New form restricts activity choices to the selected program and keeps premises bound to the loaded activity", async () => {
  const variantOptions = [{ id: "residential", label: "Residential premises" }, { id: "business", label: "Business premises" }];
  const h = harness({ actorMode: "creditex", respond: async (path, init) => {
    if (init?.body) throw Error("Creation not expected in this selection test");
    const params = new URL(path, "https://test.invalid").searchParams;
    return params.has("activityTemplateId") ? { form: { ...masterForm, variantOptions, variantId: params.get("variantId") || "residential" }, expectedVersion: params.get("variantId") === "business" ? 4 : 2 } : { catalogue };
  } });
  let tree = await h.mount(); tree = await click(h, tree, "New form");
  control(tree, "Activity", "select").props.onChange({ target: { value: "veu-6" } }); await flush(); tree = h.render();
  assert.equal(control(tree, "Premises", "select").props.value, "residential");
  control(tree, "Premises", "select").props.onChange({ target: { value: "business" } }); await flush(); tree = h.render();
  assert.match(h.requests.at(-1), /activityTemplateId=veu-6&variantId=business/); assert.equal(control(tree, "Premises", "select").props.value, "business");
  control(tree, "Form name").props.onChange({ target: { value: "Retained name" } }); tree = h.render();
  control(tree, "Program", "select").props.onChange({ target: { value: "SRES" } }); tree = h.render();
  assert.equal(control(tree, "Activity", "select").props.value, "");
  assert.deepEqual(nodes(control(tree, "Activity", "select"), node => node.type === "option").map(node => node.props.value), ["", "sres-pv"]);
  assert.equal(button(tree, "Create draft").props.disabled, true); assert.equal(control(tree, "Form name").props.value, "Retained name");
  assert.equal(nodes(tree, node => node.type === "label" && text(node).startsWith("Premises")).length, 0);
  tree = await click(h, tree, "Cancel new form"); assert.equal(button(tree, "Create draft"), undefined); assert.deepEqual(posts(h), []);
});

test("New form creation errors retain the user's name and activity without claiming a saved draft", async () => {
  const f = fixture({ initialDrafts: [], createError: "The published form changed. Try again with the current form." }); const { h } = f;
  let tree = await h.mount(); tree = await click(h, tree, "New form");
  control(tree, "Activity", "select").props.onChange({ target: { value: "veu-6" } }); await flush(); tree = h.render();
  control(tree, "Form name").props.onChange({ target: { value: "My new form" } }); tree = h.render();
  tree = await click(h, tree, "Create draft");
  assert.match(text(tree), /published form changed/); assert.doesNotMatch(text(tree), /New form saved/);
  assert.equal(control(tree, "Form name").props.value, "My new form"); assert.equal(control(tree, "Activity", "select").props.value, "veu-6");
  assert.equal(phone(tree), undefined); assert.equal(f.saved.size, 0); assert.equal(f.published.version, 2);
  tree = await click(h, tree, "Reload activity");
  assert.match(h.requests.at(-1), /activityTemplateId=veu-6/); assert.equal(control(tree, "Form name").props.value, "My new form");
  assert.doesNotMatch(text(tree), /published form changed/);
});

test("New form waits for server creation before opening the saved draft editor", async () => {
  let resolveCreate;
  const h = harness({ actorMode: "creditex", respond: async (path, init) => {
    if (init?.body) return new Promise(resolve => { resolveCreate = resolve; });
    return path.includes("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue };
  } });
  let tree = await h.mount(); tree = await click(h, tree, "New form");
  control(tree, "Activity", "select").props.onChange({ target: { value: "veu-6" } }); await flush(); tree = h.render();
  control(tree, "Form name").props.onChange({ target: { value: "Pending form" } }); tree = h.render();
  button(tree, "Create draft").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Preparing form...").props.disabled, true); assert.equal(phone(tree), undefined);
  assert.equal(button(tree, "Cancel new form").props.disabled, true); assert.doesNotMatch(text(tree), /New form saved/);
  resolveCreate({ draft: draft({ title: "Pending form", form: { ...masterForm, title: "Pending form" } }) }); await flush(); tree = h.render();
  assert.equal(phone(tree).props.form.title, "Pending form"); assert.match(text(tree), /New form saved/);
});

test("New form activity-load failures remain retryable without submitting a draft", async () => {
  let failLoad = true;
  const h = harness({ actorMode: "creditex", respond: async path => {
    if (!path.includes("activityTemplateId")) return { catalogue };
    if (failLoad) throw Error("Activity temporarily unavailable");
    return { form: masterForm, expectedVersion: 2 };
  } });
  let tree = await h.mount(); tree = await click(h, tree, "New form");
  control(tree, "Form name").props.onChange({ target: { value: "Keep this name" } }); tree = h.render();
  control(tree, "Activity", "select").props.onChange({ target: { value: "veu-6" } }); await flush(); tree = h.render();
  assert.equal(button(tree, "Create draft").props.disabled, true); assert.match(text(tree), /Activity temporarily unavailable/);
  failLoad = false; tree = await click(h, tree, "Reload activity");
  assert.equal(button(tree, "Create draft").props.disabled, false); assert.equal(control(tree, "Form name").props.value, "Keep this name");
  assert.deepEqual(posts(h), []);
});

test("saving a draft persists edits for reopening and never sends the published-master save action", async () => {
  const f = fixture(); const { h } = f; let tree = await h.mount(); tree = await click(h, tree, "Continue draft");
  control(tree, "Form title").props.onChange({ target: { value: "Revised saved draft" } }); tree = h.render();
  assert.equal(button(tree, "Replace published form").props.disabled, true);
  tree = await click(h, tree, "Save draft"); assert.match(text(tree), /Draft copy 2 \| Saved/);
  assert.equal(posts(h)[0].action, "save_master_draft"); assert.equal(posts(h)[0].form.title, "Revised saved draft"); assert.equal(f.published.title, masterForm.title);
  tree = await click(h, tree, "Back to all forms"); assert.match(text(tree), /Revised saved draft/);
  tree = await click(h, tree, "Continue draft"); assert.equal(control(tree, "Form title").props.value, "Revised saved draft");
  assert.equal(button(tree, "Replace published form").props.disabled, false); assert.equal(posts(h).some(body => body.action === "save_master"), false);
});

test("replacing a published form requires explicit confirmation and changes the view only after success", async () => {
  const f = fixture(); const { h } = f; let tree = await h.mount(); tree = await click(h, tree, "Continue draft");
  tree = await click(h, tree, "Replace published form"); assert.match(text(tree), /Replace published version 2 with this saved draft/); assert.deepEqual(posts(h), []);
  tree = await click(h, tree, "Keep editing"); assert.equal(button(tree, "Confirm replacement"), undefined); assert.deepEqual(posts(h), []);
  tree = await click(h, tree, "Replace published form"); tree = await click(h, tree, "Confirm replacement");
  assert.deepEqual(posts(h), [{ action: "publish_master_draft", actorMode: "creditex", draftId: "draft-copy-1", expectedRevision: 1 }]);
  assert.equal(f.published.title, "Heating draft"); assert.equal(f.published.version, 3); assert.equal(f.saved.size, 0);
  assert.match(text(tree), /Published\. New records use this version/); assert.equal(button(tree, "Replace published form"), undefined);
  tree = await click(h, tree, "Back to all forms"); assert.equal(button(tree, "Continue draft"), undefined);
});

test("editing after opening replacement confirmation prevents replacing with an older saved copy", async () => {
  const { h } = fixture(); let tree = await h.mount(); tree = await click(h, tree, "Continue draft"); tree = await click(h, tree, "Replace published form");
  control(tree, "Form title").props.onChange({ target: { value: "Unsaved after confirmation" } }); tree = h.render();
  assert.equal(button(tree, "Confirm replacement").props.disabled, true);
  assert.match(text(tree), /Save your draft before replacing/); assert.deepEqual(posts(h), []);
});

test("stale copies remain editable and saved but cannot replace a newer published form", async () => {
  const { h } = fixture({ initialDrafts: [draft({ baseIsCurrent: false, currentMasterVersion: 4 })] });
  let tree = await h.mount(); tree = await click(h, tree, "Continue draft");
  assert.equal(button(tree, "Replace published form").props.disabled, true); assert.match(text(tree), /published form has changed since this copy was created/);
  control(tree, "Form title").props.onChange({ target: { value: "Keep stale draft work" } }); tree = h.render();
  tree = await click(h, tree, "Save draft"); assert.equal(phone(tree).props.form.title, "Keep stale draft work");
  assert.equal(button(tree, "Replace published form").props.disabled, true);
});

test("save revision conflicts retain the user's edits and prevent publication of unsaved work", async () => {
  const f = fixture({ saveError: "This draft changed in another session. Reopen it before saving." }); const { h } = f;
  let tree = await h.mount(); tree = await click(h, tree, "Continue draft");
  control(tree, "Question").props.onChange({ target: { value: "Do not lose this question" } }); tree = h.render();
  tree = await click(h, tree, "Save draft");
  assert.equal(control(tree, "Question").props.value, "Do not lose this question"); assert.match(text(tree), /another session/); assert.match(text(tree), /Unsaved changes/);
  assert.equal(button(tree, "Replace published form").props.disabled, true); assert.equal(f.saved.get("draft-copy-1").revision, 1); assert.equal(f.published.version, 2);
});

test("publish conflicts keep the saved copy and show failure without claiming success", async () => {
  const f = fixture({ publishError: "The published form changed. Create a copy of the current version." }); const { h } = f;
  let tree = await h.mount(); tree = await click(h, tree, "Continue draft"); tree = await click(h, tree, "Replace published form"); tree = await click(h, tree, "Confirm replacement");
  assert.equal(phone(tree).props.form.title, "Heating draft"); assert.match(text(tree), /published form changed/); assert.doesNotMatch(text(tree), /Published\. New records use/);
  assert.equal(button(tree, "Confirm replacement"), undefined); assert.equal(f.saved.size, 1); assert.equal(f.published.version, 2);
});

test("read-only members may open draft previews but cannot create, save, replace or discard drafts", async () => {
  const { h } = fixture({ canAuthor: false }); let tree = await h.mount();
  assert.equal(button(tree, "Duplicate"), undefined); assert.equal(button(tree, "New form"), undefined); tree = await click(h, tree, "Preview draft");
  assert.equal(phone(tree).props.canEdit, false); assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  for (const label of ["Replace published form", "Discard draft", "Add signature", "Duplicate to draft"]) assert.equal(button(tree, label), undefined);
  assert.deepEqual(posts(h), []);
});

test("discarding a draft requires confirmation and leaves its published source unchanged", async () => {
  const f = fixture(); const { h } = f; let tree = await h.mount(); tree = await click(h, tree, "Continue draft");
  tree = await click(h, tree, "Discard draft"); assert.deepEqual(posts(h), []); assert.match(text(tree), /unsaved edits in this copy will be discarded/);
  tree = await click(h, tree, "Keep editing"); assert.ok(button(tree, "Discard draft"));
  tree = await click(h, tree, "Discard draft"); tree = await click(h, tree, "Confirm discard");
  assert.equal(f.saved.size, 0); assert.equal(f.published.title, masterForm.title); assert.equal(f.published.version, 2); assert.equal(button(tree, "Continue draft"), undefined);
});

test("choosing Signature converts only a custom unreferenced question into a real declaration", async () => {
  const { h } = fixture(); let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  control(tree, "Instructions", "textarea").props.onChange({ target: { value: "I acknowledge these recorded works." } }); tree = h.render();
  control(tree, "Answer type", "select").props.onChange({ target: { value: "signature" } }); tree = h.render();
  const preview = phone(tree);
  assert.equal(preview.props.selectedDeclarationKey, "custom.comment"); assert.equal(preview.props.selectedFieldKey, undefined);
  assert.equal(preview.props.form.fields.some(field => field.key === "custom.comment" || field.type === "signature"), false);
  assert.deepEqual(preview.props.form.declarations.find(item => item.key === "custom.comment"), { key: "custom.comment", title: "Extra comment", text: "I acknowledge these recorded works.", role: "customer", phase: "before", required: false, sourceUrl: "", sourceTextSha256: "" });
  assert.equal(control(tree, "Wording", "textarea").props.value, "I acknowledge these recorded works."); assert.deepEqual(posts(h), []);
});

test("governed and referenced fields cannot be converted into signatures", async () => {
  const referenced = clone(masterForm); referenced.fields[1].condition = { fieldKey: "custom.comment", equals: "show" };
  const { h } = fixture({ publishedForm: referenced }); let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  assert.equal(control(tree, "Answer type", "select").props.disabled, true);
  control(tree, "Answer type", "select").props.onChange({ target: { value: "signature" } }); tree = h.render(); assert.equal(phone(tree).props.form.fields.length, 2);
  phone(tree).props.onSelectField("required.photo"); tree = h.render(); assert.equal(control(tree, "Answer type", "select").props.disabled, true);
  assert.equal(nodes(control(tree, "Answer type", "select"), node => node.type === "option" && node.props.value === "signature")[0].props.disabled, true);
});

test("signature conversion is unavailable for a fixed-value question or the form's only question", async () => {
  for (const fields of [[{ ...masterForm.fields[0], requiredValue: "confirmed" }, masterForm.fields[1]], [masterForm.fields[0]]]) {
    const { h } = fixture({ publishedForm: { ...clone(masterForm), fields: clone(fields) } });
    let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
    const answerType = control(tree, "Answer type", "select");
    assert.equal(nodes(answerType, node => node.type === "option" && node.props.value === "signature")[0].props.disabled, true);
    answerType.props.onChange({ target: { value: "signature" } }); tree = h.render();
    assert.equal(phone(tree).props.form.fields.length, fields.length);
    assert.equal(phone(tree).props.selectedDeclarationKey, undefined);
  }
});

test("Add signature opens its wording and routes the live phone to that signing item", async () => {
  const { h } = fixture(); let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  tree = await click(h, tree, "Add signature"); const key = phone(tree).props.selectedDeclarationKey; assert.match(key, /^custom\./);
  control(tree, "Wording", "textarea").props.onChange({ target: { value: "Live signature wording." } }); tree = h.render();
  assert.equal(phone(tree).props.form.declarations.find(item => item.key === key).text, "Live signature wording.");
  phone(tree).props.onSelectField("custom.comment"); tree = h.render(); assert.equal(phone(tree).props.selectedDeclarationKey, undefined);
  phone(tree).props.onSelectDeclaration(key); tree = h.render(); assert.equal(control(tree, "Wording", "textarea").props.value, "Live signature wording.");
  assert.deepEqual(posts(h), []);
});
