import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexFieldFormMasters.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const catalogue = [
  { activityTemplateId: "veu-6", programCode: "VEU", activityCode: "6", title: "Heating and cooling" },
  { activityTemplateId: "sres-pv", programCode: "SRES", activityCode: "PV", title: "Solar panels" },
];
const masterForm = {
  activityTemplateId: "veu-6", programCode: "VEU", variantId: "", variantOptions: [], title: "Heating and cooling", version: 2,
  fields: [
    { key: "custom.comment", label: "Extra comment", section: "Visit", type: "text", phase: "before", required: false, options: [], help: "" },
    { key: "required.photo", label: "Required photo", section: "Visit", type: "photo", phase: "before", required: true, options: [], help: "", sourceRequirementId: "government-evidence" },
  ],
  declarations: [
    { key: "custom.confirmation", title: "Extra confirmation", text: "I confirm the extra work.", role: "customer", phase: "after", required: false, sourceUrl: "", sourceTextSha256: "" },
    { key: "program.confirmation", title: "Program confirmation", text: "Required program wording.", role: "customer", phase: "after", required: true, sourceUrl: "https://example.invalid/rule", sourceTextSha256: "source-hash" },
  ], sources: [], reviewNotes: [],
};
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const edit = tree => nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Edit VEU 6: Heating and cooling")[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ canAuthor = true, actorMode = "admin", respond = async () => ({ catalogue }), confirm = true, onManageAccess, onDirtyChange } = {}) {
  const state = [], effects = [], requests = [], signals = []; let cursor = 0, mounted = true, lateStateWrites = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { if (!mounted) lateStateWrites++; state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) state[i] = { deps, callback }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) { state[i]?.cleanup?.(); state[i] = { deps }; effects.push(() => { state[i].cleanup = callback(); }); } },
  };
  const api = async (path, init) => { requests.push(path); signals.push(init?.signal); return respond(path, init); };
  const exports = {};
  const window = { confirm: () => confirm, addEventListener() {}, removeEventListener() {} };
  Function("require", "exports", "window", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./CreditexFormPhonePreview" ? { CreditexFormPhonePreview: "phone-preview" } : id.endsWith(".module.css") ? { default: {} } : (() => { throw Error(id); })(), exports, window);
  const render = () => { cursor = 0; const tree = exports.CreditexFieldFormMasters({ api, actorMode, canAuthor, onManageAccess, onDirtyChange }); effects.splice(0).forEach(run => run()); return tree; };
  return { requests, signals, render, setConfirm(value) { confirm = value; }, get lateStateWrites() { return lateStateWrites; }, unmount() { mounted = false; for (const slot of state) slot?.cleanup?.(); }, async mount() { render(); await flush(); return render(); } };
}

test("every form is immediately listed by program with its own Edit action", async () => {
  const h = harness(); let tree = await h.mount();
  assert.deepEqual(h.requests, ["/api/trade-activity-forms?view=masters&actorMode=admin"]);
  assert.match(text(tree), /Heating and cooling/); assert.match(text(tree), /Solar panels/);
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Edit").length, 2);
  assert.equal(nodes(tree, node => node.type === "li").length, 2);
  assert.deepEqual(nodes(tree, node => node.type === "h3").map(text), ["SRES", "VEU"]);
  assert.match(text(tree), /Program forms stay available/);
  nodes(tree, node => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value: "solar" } });
  tree = h.render();
  assert.match(text(tree), /Solar panels/); assert.doesNotMatch(text(tree), /Heating and cooling/);
  assert.equal(h.requests.length, 1, "search stays local to the loaded catalogue");
});

test("optional program and search filters combine, and clear restores all forms", async () => {
  const h = harness(); let tree = await h.mount();
  nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "VEU" } });
  tree = h.render(); assert.equal(nodes(tree, node => node.type === "li").length, 1); assert.ok(edit(tree));
  nodes(tree, node => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value: "solar" } });
  tree = h.render(); assert.equal(nodes(tree, node => node.type === "li").length, 0); assert.match(text(tree), /No forms match these filters/);
  button(tree, "Clear filters").props.onClick(); tree = h.render(); assert.equal(nodes(tree, node => node.type === "li").length, 2);
  assert.equal(h.requests.length, 1);
});

test("Edit opens the exact form and Back preserves unsaved changes unless discard is confirmed", async () => {
  const h = harness({ respond: async path => new URL(path, "https://test.invalid").searchParams.has("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue }, confirm: false });
  let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  assert.match(h.requests[1], /activityTemplateId=veu-6/);
  assert.equal(nodes(tree, node => node.type === "li").length, 0); assert.ok(button(tree, "Back to all forms"));
  const title = nodes(tree, node => node.type === "input" && node.props.value === "Heating and cooling")[0];
  title.props.onChange({ target: { value: "Edited title" } }); tree = h.render();
  button(tree, "Back to all forms").props.onClick(); tree = h.render(); assert.match(text(tree), /Unsaved changes/); assert.match(text(tree), /Edited title/);
  h.setConfirm(true); button(tree, "Back to all forms").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "li").length, 2); assert.equal(button(tree, "Back to all forms"), undefined);
  assert.equal(h.requests.length, 2, "returning to the catalogue does not save or reload the edited master");
});

test("custom questions and declarations remain deletable while program requirements stay protected", async () => {
  const h = harness({ respond: async path => path.includes("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue } });
  let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  assert.equal(button(tree, "Delete question").props.disabled, false);
  const declarationButtons = nodes(tree, node => node.type === "button" && text(node) === "Delete declaration");
  assert.deepEqual(declarationButtons.map(node => node.props.disabled), [false, true]);
  declarationButtons[0].props.onClick(); tree = h.render(); assert.doesNotMatch(text(tree), /Extra confirmation/); assert.match(text(tree), /Program confirmation/);
  button(tree, "Delete question").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Delete question").props.disabled, true); assert.match(text(tree), /regulator requirement/);
  assert.equal(h.requests.length, 2, "question edits stay local until Save and publish master is chosen");
});

test("read-only Creditex members can preview forms while edit and publication remain disabled", async () => {
  const h = harness({ canAuthor: false, actorMode: "creditex", respond: async path => path.includes("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue } });
  let tree = await h.mount();
  assert.deepEqual(h.requests, ["/api/trade-activity-forms?view=masters&actorMode=creditex"]);
  assert.equal(button(tree, "Refresh forms").props.disabled, false);
  assert.match(text(tree), /Shared-mailbox and auditor accounts are read-only/);
  const preview = nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Preview VEU 6: Heating and cooling")[0];
  preview.props.onClick(); await flush(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "phone-preview").length, 1);
  assert.equal(nodes(tree, node => node.type === "phone-preview")[0].props.canEdit, false);
  assert.equal(nodes(nodes(tree, node => node.type === "fieldset")[0], node => node.type === "phone-preview").length, 0);
  assert.equal(button(tree, "Submitted field records"), undefined);
  assert.equal(h.requests.length, 2);
});

test("phone preview follows unsaved question edits and selecting a phone question opens its editor", async () => {
  const h = harness({ respond: async path => path.includes("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue } });
  let tree = await h.mount(); edit(tree).props.onClick(); await flush(); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.value === "Extra comment")[0].props.onChange({ target: { value: "Describe the installation" } });
  tree = h.render();
  const preview = nodes(tree, node => node.type === "phone-preview")[0];
  assert.equal(preview.props.form.fields[0].label, "Describe the installation");
  assert.equal(preview.props.selectedFieldKey, "custom.comment");
  assert.equal(preview.props.canEdit, true);
  preview.props.onSelectField("required.photo"); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "phone-preview")[0].props.selectedFieldKey, "required.photo");
  assert.equal(h.requests.length, 2, "typing and testing do not publish the master");
});

test("form access setup and unsaved-change state are connected to the parent workspace", async () => {
  let accessOpened = 0; const dirtyStates = [];
  const h = harness({ onManageAccess: () => accessOpened++, onDirtyChange: value => dirtyStates.push(value), respond: async path => path.includes("activityTemplateId") ? { form: masterForm, expectedVersion: 2 } : { catalogue } });
  let tree = await h.mount(); button(tree, "Set up form editors").props.onClick(); assert.equal(accessOpened, 1);
  edit(tree).props.onClick(); await flush(); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.value === "Heating and cooling")[0].props.onChange({ target: { value: "Updated" } });
  h.render(); assert.equal(dirtyStates.at(-1), true);
  h.unmount(); assert.equal(dirtyStates.at(-1), false);
});

test("failed automatic loading shows the error and allows an explicit refresh", async () => {
  let attempts = 0;
  const h = harness({ respond: async () => { if (++attempts === 1) throw Error("Forms temporarily unavailable"); return { catalogue }; } });
  let tree = await h.mount(); assert.match(text(tree), /Forms temporarily unavailable/);
  nodes(tree, node => node.type === "button" && text(node) === "Refresh forms")[0].props.onClick();
  tree = h.render();
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Loading forms...")[0].props.disabled, true);
  await flush(); tree = h.render();
  assert.match(text(tree), /Heating and cooling/); assert.doesNotMatch(text(tree), /Forms temporarily unavailable/);
  assert.equal(h.requests.length, 2);
});

test("initial loading is visible and an unmounted catalogue request cannot update state", async () => {
  let resolveRequest;
  const h = harness({ respond: () => new Promise(resolve => { resolveRequest = resolve; }) });
  const tree = h.render();
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Loading forms...")[0].props.disabled, true);
  assert.equal(h.signals[0].aborted, false);
  h.unmount();
  assert.equal(h.signals[0].aborted, true);
  resolveRequest({ catalogue });
  await flush();
  assert.equal(h.lateStateWrites, 0);
});
