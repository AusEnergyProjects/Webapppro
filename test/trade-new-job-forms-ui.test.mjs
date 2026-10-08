import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { ENERGY_SERVICE_OPTIONS } from "../src/lib/energy-service-catalogue.mjs";

const nodes = (node, match) => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, match)) : [...(match(node) ? [node] : []), ...nodes(node.props?.children, match)];
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ").replace(/\s+/g, " ") : text(node.props?.children);
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const template = (key = "business-scope", version = 2) => ({ key, version, name: `Form ${key}`, jurisdiction: "AU", description: "Record the agreed scope", fieldCount: 4 });
const user = { uid: "actor", getIdToken: async () => "test-token" };

function harness(file, exportName, initialProps, dependencies = {}) {
  let cursor = 0, props = initialProps;
  const values = [], effects = [], pending = [];
  const changed = (before, after) => !before || before.length !== after.length || before.some((value, index) => value !== after[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return values[index] ||= { current: initial }; },
    useId() { cursor++; return "test-id"; },
    useMemo(callback, dependencies) { const index = cursor++; if (!values[index] || changed(values[index].dependencies, dependencies)) values[index] = { dependencies, value: callback() }; return values[index].value; },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) { const previous = effects[index]; effects[index] = { dependencies }; pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = callback(); }); } },
  };
  const imported = { react, "react/jsx-runtime": jsx, ...dependencies };
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  Function("require", "exports", "window", compiled)((id) => { assert.ok(imported[id], id); return imported[id]; }, exports, { requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} });
  const render = () => { cursor = 0; const tree = exports[exportName](props); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, update: (next) => { props = { ...props, ...next }; }, unmount: () => effects.forEach((effect) => effect?.cleanup?.()),
    async settle() { let tree; for (let index = 0; index < 4; index++) { tree = render(); await tick(); } return tree; } };
}

function picker({ respond = async () => Response.json({ ok: true, serviceCategory: "assessment", templates: [template()] }), selections = [], ...initial } = {}) {
  const requests = [], changes = [];
  let h;
  const fetch = async (url, init) => { requests.push({ url, init }); return respond(url, init); };
  h = harness("TradeNewJobFormsPicker.tsx", "TradeNewJobFormsPicker", { user, serviceCategory: "assessment", selections, ...initial,
    onChange(next) { changes.push(next); h.update({ selections: next }); } }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: "owner" }) },
  });
  return { ...h, requests, changes };
}

test("new-job picker loads the canonical business-scoped library and selects exact published identity once", async () => {
  const h = picker();
  let tree = await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/trade-job-forms?mode=library&serviceCategory=assessment");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(h.requests[0].init.cache, "no-store");
  button(tree, "Add form").props.onClick();
  tree = h.render();
  assert.deepEqual(h.changes, [[{ templateKey: "business-scope", templateVersion: 2, name: "Form business-scope" }]]);
  assert.equal(button(tree, "Selected").props.disabled, true);
  button(tree, "Selected").props.onClick();
  assert.equal(h.changes.length, 1);
});

test("library failure is truthful and a retry loads choices without changing selections", async () => {
  let calls = 0;
  const h = picker({ respond: async () => ++calls === 1 ? Response.json({ error: "Permission changed" }, { status: 403 }) : Response.json({ ok: true, serviceCategory: "assessment", templates: [template()] }) });
  let tree = await h.settle();
  assert.match(text(tree), /Permission changed/);
  assert.equal(nodes(tree, (node) => node.type === "article").length, 0);
  assert.equal(h.changes.length, 0);
  button(tree, "Retry form library").props.onClick();
  tree = await h.settle();
  assert.ok(button(tree, "Add form"));
  assert.equal(h.requests.length, 2);
});

test("changing work type aborts stale library responses and displays only matching current choices", async () => {
  let resolveOld;
  const h = picker({ respond: async (url) => url.endsWith("assessment") ? new Promise((resolve) => { resolveOld = resolve; }) : Response.json({ ok: true, serviceCategory: "insulation", templates: [template("insulation")] }) });
  h.render(); await tick();
  h.update({ serviceCategory: "insulation" });
  let tree = await h.settle();
  assert.equal(h.requests[0].init.signal.aborted, true);
  resolveOld(Response.json({ ok: true, serviceCategory: "assessment", templates: [template("old")] }));
  tree = await h.settle();
  assert.match(text(tree), /Form insulation/);
  assert.doesNotMatch(text(tree), /Form old/);
  h.unmount();
  assert.equal(h.requests[1].init.signal.aborted, true);
});

test("mismatched library category never offers a template from another work type", async () => {
  const h = picker({ respond: async () => Response.json({ ok: true, serviceCategory: "solar", templates: [template("wrong-category")] }) });
  const tree = await h.settle();
  assert.match(text(tree), /did not match this work type/);
  assert.equal(nodes(tree, (node) => node.type === "article").length, 0);
});

test("busy and selection bounds prevent extra selections, including another version of the same key", async () => {
  const h = picker({ selections: [{ templateKey: "business-scope", templateVersion: 1, name: "Earlier" }] });
  let tree = await h.settle();
  assert.equal(button(tree, "Selected").props.disabled, true);
  button(tree, "Selected").props.onClick();
  assert.equal(h.changes.length, 0);
  h.update({ selections: Array.from({ length: 20 }, (_, index) => ({ templateKey: `form-${index}`, templateVersion: 1, name: "Selected" })) });
  tree = h.render();
  assert.equal(button(tree, "Add form").props.disabled, true);
  button(tree, "Add form").props.onClick();
  assert.equal(h.changes.length, 0);
  h.update({ selections: [], disabled: true });
  tree = h.render();
  assert.equal(button(tree, "Add form").props.disabled, true);
  button(tree, "Add form").props.onClick();
  assert.equal(h.changes.length, 0);
});

function wizard(extra = {}) {
  let lazyIndex = 0;
  const fetch = async () => Response.json({});
  return harness("TradeNewJobForm.tsx", "TradeNewJobForm", { user, templates: [], teamMembers: [{ id: "self", displayName: "Actor", status: "active", isSelf: true }], allowCustomerSearch: false, canAssignJobs: false, busy: false, onSubmit() {}, ...extra }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch },
    "./SearchableLookup": { SearchableLookup: "customer-search" },
    "./AustralianAddressLookup": { AustralianAddressLookup: "address-picker" },
    "./RecoverableTradeWorkspace": { recoverableTradeWorkspace: () => lazyIndex++ === 0 ? "schedule-workspace" : "form-picker" },
    "@/lib/trade-schedule": { nextAppointmentSlot: () => "2026-10-09T09:00", scheduleProposalKey: () => "proposal" },
    "@/lib/australian-government-program-catalogue": { GOVERNMENT_ACTIVITY_TEMPLATES: [], GOVERNMENT_PROGRAM_TEMPLATES: [] },
    "@/lib/australian-certificate-calculation-catalogue": { GOVERNMENT_ACTIVITY_CALCULATION_METHODS: [] },
    "@/lib/rental-safety-visit.mjs": { RENTAL_VISIT_PRESETS: [] },
    "@/lib/energy-service-catalogue.mjs": { ENERGY_SERVICE_OPTIONS },
    "@/lib/trade-compliance-intent": { activityPremisesVariantId: () => "", activityRequiresPremisesVariant: () => false },
  });
}

async function openForms(h) {
  let tree = h.render();
  button(tree, "Add customer").props.onClick();
  tree = h.render();
  button(tree, "Choose program").props.onClick();
  tree = await h.settle();
  button(tree, "Add form").props.onClick();
  return h.render();
}

test("desktop wizard exposes Add form beside Add activity and includes exact selection in create payload and review", async () => {
  const h = wizard();
  let tree = await openForms(h);
  const formPicker = nodes(tree, (node) => node.type === "form-picker")[0];
  assert.equal(formPicker.props.serviceCategory, "assessment");
  const toolbar = nodes(tree, (node) => node.props?.className === "crm-wizard-actions crm-add-activity-action")[0];
  assert.equal(button(toolbar, "Add activity").type, "button");
  assert.ok(button(toolbar, "Close form library"));
  formPicker.props.onChange([{ templateKey: "scope", templateVersion: 3, name: "Business scope" }]);
  tree = h.render();
  const input = nodes(tree, (node) => node.type === "input" && node.props.name === "formSelectionsJson")[0];
  assert.deepEqual(JSON.parse(input.props.value), [{ templateKey: "scope", templateVersion: 3 }]);
  const review = nodes(tree, (node) => node.props?.["data-step"] === "5")[0];
  assert.match(text(review), /Business scope \| Version 3/);
  button(tree, "Remove Business scope").props.onClick();
  assert.equal(nodes(h.render(), (node) => node.props?.name === "formSelectionsJson")[0].props.value, "[]");
});

test("changing desktop job work type clears incompatible selections and closes the old form library", async () => {
  const h = wizard();
  let tree = await openForms(h);
  nodes(tree, (node) => node.type === "form-picker")[0].props.onChange([{ templateKey: "scope", templateVersion: 3, name: "Old scope" }]);
  tree = h.render();
  nodes(tree, (node) => node.type === "select" && node.props.name === "serviceCategory")[0].props.onChange({ target: { value: "insulation" } });
  tree = h.render();
  assert.equal(nodes(tree, (node) => node.props?.name === "formSelectionsJson")[0].props.value, "[]");
  assert.equal(nodes(tree, (node) => node.type === "form-picker").length, 0);
  assert.doesNotMatch(text(tree), /Old scope/);
});

test("restricted desktop creator has no form attachment controls and retains ordinary job setup", () => {
  const h = wizard({ canManageFieldEvidence: false });
  const tree = h.render();
  assert.equal(button(tree, "Add form"), undefined);
  assert.ok(button(tree, "Add customer"));
  assert.equal(nodes(tree, (node) => node.props?.name === "formSelectionsJson")[0].props.value, "[]");
});

test("saved-job Add form can explicitly open and close the canonical attachment library", async () => {
  const requests = [];
  const fetch = async (url, init) => { requests.push({ url, init }); return Response.json({ ok: true, serviceCategory: "assessment", templates: [template()], forms: [] }); };
  let h;
  h = harness("TradeJobFormsPanel.tsx", "TradeJobFormsPanel", { user, workOrderId: "saved-job", libraryOpen: false, onLibraryOpenChange: (open) => h.update({ libraryOpen: open }) }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: "owner" }) },
    "@/lib/trade-business-form-design": {}, "@/lib/trade-form-library.mjs": {},
    "./TradeWorkTimeTracking": {}, "./WattzunFormAssistButton": {}, "@/lib/wattzun-form-client": {},
  });
  let tree = await h.settle();
  const details = () => nodes(tree, (node) => node.type === "details")[0];
  assert.equal(details().props.open, false);
  h.update({ libraryOpen: true });
  tree = h.render();
  assert.equal(details().props.open, true);
  await button(tree, "Add to job").props.onClick();
  await tick();
  assert.deepEqual(JSON.parse(requests[1].init.body), { templateKey: "business-scope", templateVersion: 2, workOrderId: "saved-job" });
  tree = await h.settle();
  assert.match(text(tree), /Field form added to this job/);
  details().props.onToggle({ currentTarget: { open: false } });
  tree = h.render();
  assert.equal(details().props.open, false);
});

test("saved-job Add activity opens the existing selector even when a rental form is already attached", async () => {
  const fetch = async () => Response.json({ ok: true, revision: 4, canAdd: true, rentalModules: [{ id: "minimum_standards", title: "Rental minimum standards", added: true, unavailableReason: "" }] });
  let h;
  h = harness("TradeRentalActivityPicker.tsx", "TradeRentalActivityPicker", { user, workOrderId: "saved-job", refreshKey: 4, readOnly: false, active: true, initiallyAttached: true,
    open: false, onOpenChange: (open) => h.update({ open }), onChanged: async () => {}, onAttachmentChanged() {} }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch }, "./TradeRentalInspectionPanel": { TradeRentalInspectionPanel: "rental-form" },
  });
  let tree = await h.settle();
  assert.equal(nodes(tree, (node) => node.type === "details")[0].props.open, false);
  h.update({ open: true }); tree = h.render();
  const details = nodes(tree, (node) => node.type === "details")[0];
  assert.equal(details.props.open, true);
  assert.ok(button(tree, "Add to this job"));
  assert.equal(nodes(tree, (node) => node.type === "rental-form").length, 1);
  details.props.onToggle({ currentTarget: { open: false } }); tree = h.render();
  assert.equal(nodes(tree, (node) => node.type === "details")[0].props.open, false);
  h.update({ readOnly: true }); tree = h.render();
  assert.equal(nodes(tree, (node) => node.type === "details").length, 0);
});

function createJobHarness({ result = { ok: true, id: "saved-job", workNumber: "TLJ-SAVED", attachedFormCount: 2 }, refresh = async () => {} } = {}) {
  const source = readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "createJob") declaration = node; else ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(declaration);
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast);
  const compiled = ts.transpileModule(printed, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const changes = [], requests = [];
  let resets = 0, loads = 0;
  const context = { user, fetch: async (url, init) => { requests.push({ url, init }); return Response.json(result, { status: result.ok ? 200 : 400 }); },
    setBookingTraining: (value) => changes.push(["training", value]), setBusy: (value) => changes.push(["busy", value]),
    setStatus: (...values) => changes.push(["status", ...values]), isMfaRequiredResponse: () => false, setMfaRequired() {},
    load: async () => { loads++; await refresh(); }, setRefreshNonce() {}, setNewJobSeed() {}, setCreating: (value) => changes.push(["creating", value]),
    setView: (value) => changes.push(["view", value]), navigationTarget: null, openFocusedJob() {},
    FormData: class { *[Symbol.iterator]() { yield ["formSelectionsJson", '[{"templateKey":"scope","templateVersion":2}]']; } },
  };
  const create = Function(...Object.keys(context), `${compiled}; return createJob;`)(...Object.values(context));
  return { changes, requests, get resets() { return resets; }, get loads() { return loads; },
    run: () => create({ preventDefault() {}, currentTarget: { reset() { resets++; } } }) };
}

test("confirmed job and form creation closes setup even if workspace refresh fails", async () => {
  const h = createJobHarness({ refresh: async () => { throw new Error("Network unavailable"); } });
  await h.run();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { action: "create_scheduled_job", formSelectionsJson: '[{"templateKey":"scope","templateVersion":2}]' });
  assert.equal(h.resets, 1);
  assert.ok(h.changes.some(([kind, value]) => kind === "creating" && value === ""));
  const status = h.changes.filter(([kind]) => kind === "status").at(-1);
  assert.equal(status[2], "warning");
  assert.match(status[1], /TLJ-SAVED created and scheduled.*2 job forms were attached.*job is saved.*could not be refreshed/);
  assert.ok(!h.changes.some(([kind, , level]) => kind === "status" && level === "error"));
});

test("rejected initial form selections keep job setup open and never claim saved attachment", async () => {
  const h = createJobHarness({ result: { ok: false, error: "Selected form is no longer published" } });
  await h.run();
  assert.equal(h.resets, 0);
  assert.equal(h.loads, 0);
  assert.ok(!h.changes.some(([kind]) => kind === "creating"));
  assert.deepEqual(h.changes.filter(([kind]) => kind === "status").at(-1), ["status", "Selected form is no longer published", "error"]);
});
