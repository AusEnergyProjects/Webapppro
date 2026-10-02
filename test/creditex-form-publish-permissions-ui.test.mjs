import assert from "node:assert/strict";
import test from "node:test";
import { text, nodes, catalogue, masterForm, button, flush, harness } from "./helpers/creditex-master-editor-fixture.mjs";

const phone = tree => nodes(tree, node => node.type === "phone-preview")[0];
const input = (tree, value) => nodes(tree, node => node.type === "input" && node.props.value === value)[0];
const posts = h => h.calls.filter(call => call.body).map(call => call.body);
function setup({ canAuthor = true, canPublish = false, savedDraft = false } = {}) {
  let form = structuredClone(masterForm), revision = 1;
  const draft = () => ({ id: "draft-one", activityTemplateId: form.activityTemplateId, variantId: "", title: form.title,
    revision, baseMasterVersion: 2, currentMasterVersion: 2, baseIsCurrent: true, status: "draft",
    createdAt: "2026-10-03T01:00:00Z", updatedAt: "2026-10-03T01:00:00Z", form: structuredClone(form) });
  const h = harness({ actorMode: "creditex", canAuthor, canPublish, respond: async (path, init) => {
    const query = new URL(path, "https://test.invalid").searchParams;
    if (init?.body) {
      const payload = JSON.parse(init.body);
      if (payload.action === "create_master_draft") return { draft: draft() };
      if (payload.action === "save_master_draft") { form = structuredClone(payload.form); revision++; return { draft: draft() }; }
      if (payload.action === "publish_master_draft") return { form, expectedVersion: 3 };
      if (payload.action === "discard_master_draft") return { ok: true };
      if (payload.action === "save_master") return { form: payload.form, expectedVersion: 3 };
      assert.fail(`Unexpected action ${payload.action}`);
    }
    if (query.get("view") === "master_drafts") return { draft: draft() };
    if (query.has("activityTemplateId")) return { form: structuredClone(masterForm), expectedVersion: 2 };
    return { catalogue, drafts: savedDraft ? [draft()] : [] };
  } });
  return h;
}
async function openPublished(h) {
  let tree = await h.mount();
  nodes(tree, node => node.type === "button" && /^(Edit|Preview) VEU 6:/.test(node.props["aria-label"] || ""))[0].props.onClick();
  await flush(); return h.render();
}

test("draft editors preview published forms without mutation, save or publication controls", async () => {
  const h = setup(); let tree = await openPublished(h);
  assert.equal(phone(tree).props.canEdit, false);
  assert.equal(button(tree, "Save and publish master"), undefined);
  assert.equal(button(tree, "Add page"), undefined);
  assert.equal(button(tree, "Undo"), undefined);
  assert.ok(button(tree, "Duplicate to draft"));
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  input(tree, masterForm.title).props.onChange({ target: { value: "Blocked edit" } }); tree = h.render();
  assert.equal(phone(tree).props.form.title, masterForm.title, "mutation handler also rejects edits to published forms");
  nodes(tree, node => node.type === "button" && text(node).includes("TLink Mind Map"))[0].props.onClick(); tree = h.render();
  const map = nodes(tree, node => node.type === "form-mind-map")[0];
  assert.equal(map.props.editable, false); map.props.onAddPage(); tree = h.render();
  assert.deepEqual(phone(tree).props.form.fields, masterForm.fields); assert.deepEqual(posts(h), []);
});

test("draft editors duplicate, edit and save while publication controls remain absent", async () => {
  const h = setup(); let tree = await openPublished(h);
  button(tree, "Duplicate to draft").props.onClick(); await flush(); tree = h.render();
  assert.equal(phone(tree).props.canEdit, true);
  input(tree, masterForm.title).props.onChange({ target: { value: "Saved draft title" } }); tree = h.render();
  assert.ok(button(tree, "Add page")); assert.equal(button(tree, "Replace published form"), undefined);
  button(tree, "Save draft").props.onClick(); await flush(); tree = h.render();
  assert.deepEqual(posts(h).map(body => body.action), ["create_master_draft", "save_master_draft"]);
  assert.equal(posts(h)[1].form.title, "Saved draft title"); assert.equal(posts(h)[1].expectedRevision, 1);
  assert.equal(button(tree, "Save draft").props.disabled, true);
  assert.equal(button(tree, "Save and publish master"), undefined);
  assert.equal(button(tree, "Replace published form"), undefined);
  assert.match(text(tree), /team member with publishing permission/);
});

test("draft-only users can create an activity draft and reopen or discard a saved copy", async () => {
  const h = setup({ savedDraft: true }); let tree = await h.mount();
  assert.ok(button(tree, "New form")); assert.ok(button(tree, "Continue draft"));
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Edit").length, 0);
  button(tree, "Continue draft").props.onClick(); await flush(); tree = h.render();
  assert.equal(phone(tree).props.canEdit, true); assert.equal(button(tree, "Replace published form"), undefined);
  button(tree, "Discard draft").props.onClick(); tree = h.render();
  button(tree, "Confirm discard").props.onClick(); await flush(); tree = h.render();
  assert.deepEqual(posts(h).map(body => body.action), ["discard_master_draft"]);
  assert.equal(button(tree, "Back to all forms"), undefined);
  button(tree, "New form").props.onClick(); await flush(); tree = h.render();
  assert.ok(button(tree, "Create draft")); assert.equal(button(tree, "Confirm replacement"), undefined);
});

test("publish permission preserves direct publication and explicit replacement, then disappears on revocation", async () => {
  const h = setup({ canPublish: true }); let tree = await openPublished(h);
  input(tree, masterForm.title).props.onChange({ target: { value: "Published update" } }); tree = h.render();
  button(tree, "Save and publish master").props.onClick(); await flush(); tree = h.render();
  assert.equal(posts(h)[0].action, "save_master");
  button(tree, "Duplicate to draft").props.onClick(); await flush(); tree = h.render();
  button(tree, "Replace published form").props.onClick(); tree = h.render();
  assert.ok(button(tree, "Confirm replacement"));
  h.setCanPublish(false); tree = h.render();
  assert.equal(button(tree, "Confirm replacement"), undefined); assert.equal(button(tree, "Replace published form"), undefined);
  assert.equal(phone(tree).props.canEdit, true, "losing publish access preserves draft editing");
  assert.deepEqual(posts(h).map(body => body.action), ["save_master", "create_master_draft"]);
  h.setCanPublish(true); tree = h.render();
  button(tree, "Confirm replacement").props.onClick(); await flush();
  assert.equal(posts(h).at(-1).action, "publish_master_draft");
});

test("publication permission alone cannot create, edit or publish without author permission", async () => {
  const h = setup({ canAuthor: false, canPublish: true, savedDraft: true }); let tree = await h.mount();
  assert.equal(button(tree, "New form"), undefined); assert.equal(button(tree, "Continue draft"), undefined);
  button(tree, "Preview draft").props.onClick(); await flush(); tree = h.render();
  assert.equal(phone(tree).props.canEdit, false); assert.equal(button(tree, "Replace published form"), undefined);
  assert.equal(button(tree, "Save draft"), undefined); assert.equal(button(tree, "Discard draft"), undefined);
  assert.deepEqual(posts(h), []);
});
